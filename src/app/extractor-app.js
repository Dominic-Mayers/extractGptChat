import { attachAutoStartListener } from '../ui/listeners/auto-start.js';
import { attachExportListener } from '../ui/listeners/export.js';
import { attachStartExtractionListener } from '../ui/listeners/start-extraction.js';

export function installExtractorApp() {
    'use strict';

    
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const nextAnimationFrame = () => new Promise(r => requestAnimationFrame(() => r()));
    
    // Minimal run state reset each run.
    let _perf = {};
    function _resetPerf() {
        _perf = {
            runStartMs: 0,
            expectedUserPrompts: 0,
        };
    }
    _resetPerf();
    
    let _savedState = null;
    let _resumeState = null;
    let _pendingAutoRestart = false;
    // Fixed once per run (not per export click) — re-clicking "Export
    // again" against the same _savedState must keep reusing the same
    // timestamp, since any images already downloaded for this run have it
    // baked into their filenames; generating a fresh one per export would
    // make a later export's .md reference a timestamp that doesn't match
    // any file actually on disk.
    let _runTimestamp = null;
    
    // ════════════════════════════════════════════════════════════════
    // HELPERS — Container detection, end-of-chat check, export
    // ════════════════════════════════════════════════════════════════
    
    /**
     * Walks up from the first visible message to find the scrolling ancestor.
     * Falls back to document.documentElement if nothing suitable is found.
     */
    function findScrollContainer() {
        const messageEl = document.querySelector('[data-message-author-role]');
        if (messageEl) {
            let el = messageEl.parentElement;
            while (el && el !== document.body) {
                const { overflowY } = getComputedStyle(el);
                if ((overflowY === 'auto' || overflowY === 'scroll') &&
                    el.scrollHeight > el.clientHeight) {
                    return el;
                }
                el = el.parentElement;
            }
        }
        return document.documentElement;
    }
    
    function countPrompts(prompts) {
        return prompts.filter(pr => pr.role === 'user').length;
    }
    
    function formatUserMsgSummary(count, total) {
        return total
            ? `${count}/${total} (${Math.round(count * 100 / total)}%)`
            : `${count}`;
    }
    
    function rememberExpectedUserPrompts(total) {
        if (total > 0) {
            _perf.expectedUserPrompts = Math.max(_perf.expectedUserPrompts || 0, total);
        }
        return _perf.expectedUserPrompts || 0;
    }
    
    // ChatGPT's generated-image URLs (backend-api/estuary/content?...&sig=...)
    // are gated by a session cookie that's SameSite — fine for a top-level
    // navigation (clicking the link directly works) but stripped on a
    // cross-origin <img> subresource fetch, so the live URL never renders in
    // an external markdown viewer. htmlToMarkdown can't fetch them itself
    // (it's synchronous, called per-message mid-walk); instead it stashes
    // each one here under a unique placeholder token and returns that token
    // in place of the URL. exportMarkdown (already async, runs once at the
    // very end) downloads them for real — from the page's own authenticated
    // origin, so the cookie is sent normally — and replaces every placeholder
    // with the actual saved filename right before writing the .md file.
    let _pendingImageDownloads = [];
    let _imageCounter = 0;
    // Same deferred-token pattern as images, minus the network fetch: a
    // canvas/textdoc block's content is already local DOM, so the markdown
    // text is captured immediately at extraction time, not fetched later.
    // Deferred anyway, to the same export-time batch as images, purely for
    // filename consistency (slug+timestamp are only assembled there) and to
    // avoid mixing live-walk-time blob downloads with the already-throttled
    // image download spacing.
    let _pendingCanvasDownloads = [];
    let _canvasCounter = 0;
    // A second, parallel "version of the conversation" — real captured
    // outerHTML, not text extracted from it, written to its own .html file
    // at export time (see exportMarkdown) rather than inlined into the
    // markdown. One entry per deck as it's confirmed ready and entered
    // (enterDeck), plus work-zone-move/fatal-timeout captures for
    // whatever's intersecting the viewport at those moments — diagnostic
    // ground truth that numeric geometry deltas can't substitute for (see
    // memory). Each entry: { label, turnId, role, html }.
    let _htmlCaptures = [];
    // Decks the sandwiched-empty check (see findSandwichedEmptySlabInViewport)
    // has already waited out the full WORK_ZONE_JUMP_STABLE_MAX_MS for once
    // this run, without it ever resolving. A deck can stay "sandwiched" in
    // the viewport across many consecutive small steps (each only 120px) —
    // re-discovering and re-waiting the full cap on the *same* deck on every
    // one of those steps is pure waste, not added safety: the first
    // encounter already gave it a fair wait, and Step 3's own much longer,
    // fresh wait is still the authoritative check when extraction actually
    // reaches this slab. First real run: every one of 7 sandwiched-empty
    // detections capped out (100%), suggesting these are genuinely broken/
    // permanently-empty decks, not transient mid-render lag — exactly the
    // case this memoization is for.
    // Temporary, conversation-specific workaround: turnIds already
    // confirmed (not just suspected) to never render a selectable slab —
    // pre-seeded into _knownUnresolvableSandwichedTurnIds below so the
    // sandwiched-empty check skips them from the very first encounter
    // instead of discovering them fresh (and fatally failing on them) every
    // single run. 70e7d42f is the deck already named in
    // findSandwichedEmptySlabInViewport's own comment as the original
    // example of a permanently-broken deck; two separate runs on this
    // conversation both died on it with geometryElement.isConnected=true —
    // confirmed not a detachment/jump-size case. This list is meant to be
    // deleted once per-jump failure handling stops treating
    // sawSandwiched-without-detachment as fatal (see conversation) — it's a
    // patch to unblock this one conversation, not a general mechanism.
    const KNOWN_PERMANENTLY_BROKEN_TURN_IDS = ['70e7d42f-42df-4fa6-8c41-fb72b4aee15f'];
    let _knownUnresolvableSandwichedTurnIds = new Set(KNOWN_PERMANENTLY_BROKEN_TURN_IDS);
    
    const escLabel = s => s.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
    const escUrl   = s => s.replace(/>/g, '%3E');
    const escHtmlAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escHtmlText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    /** Converts a rendered ChatGPT message element to Markdown. */
    function htmlToMarkdown(el) {
        function walk(node, listDepth) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (!text.includes('\n')) return text;
                // In pre-wrap/pre-line containers (user message bubbles) newlines
                // are meaningful — preserve them. Elsewhere collapse to a space.
                const ws = node.parentElement
                    ? getComputedStyle(node.parentElement).whiteSpace
                    : '';
                if (ws === 'pre' || ws === 'pre-wrap' || ws === 'pre-line') {
                    // Indent every line by 4 spaces → Markdown indented code block.
                    // This preserves all alignment (arrows, ASCII diagrams, etc.).
                    return text.replace(/^/gm, '    ');
                }
                // A text node that's *purely* whitespace and contains a newline
                // is HTML source formatting between block-level siblings (e.g.
                // between </h2> and <p>), not meaningful content — drop it
                // entirely rather than collapsing it to a stray space.
                if (/^\s*$/.test(text)) return '';
                return text.replace(/\n/g, ' ');
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            if (node.getAttribute('aria-hidden') === 'true') return '';
            // Screen-reader-only labels (e.g. "ChatGPT said:" before an
            // image-generation turn) sit as siblings inside the turn section
            // itself, not inside [data-message-author-role] — invisible to
            // every extraction that targeted the narrower message element, but a real
            // leak now that image-only turns are extracted from their
            // section as a whole.
            if (/\bsr-only\b/.test(node.getAttribute('class') || '')) return '';
            // CodeMirror 6 code-block view, used inside canvas/textdoc
            // blocks — renders each line as its own <div class="cm-line">
            // sibling, not <pre><code>. Without this, the default case's
            // generic walkChildren would concatenate every line with no
            // separator at all, garbling the code (confirmed against a real
            // canvas sample: "resolveLineageContract(remoteRepository,
            // version, {" and "  hasWarning," etc. would run together with
            // zero whitespace between them). No language class is exposed
            // here the way <pre><code class="language-X"> provides one
            // elsewhere, so the fence carries no language tag.
            if (node.getAttribute('data-is-code-block-view') === 'true') {
                const extractLine = n => {
                    if (n.nodeType === Node.TEXT_NODE) return n.textContent;
                    if (n.tagName?.toLowerCase() === 'br') return '';
                    return [...n.childNodes].map(extractLine).join('');
                };
                const lines = [...node.querySelectorAll('.cm-line')].map(extractLine);
                const text = lines.join('\n').trimEnd();
                const maxRun = Math.max(2, ...([...text.matchAll(/`+/g)].map(m => m[0].length)));
                const fence = '`'.repeat(maxRun + 1);
                return `\n${fence}\n${text}\n${fence}\n\n`;
            }
            const tag = node.tagName.toLowerCase();
            switch (tag) {
                case 'script': case 'style': case 'noscript': return '';
                case 'br': return '\n';
                case 'hr': return '\n---\n\n';
                case 'p':  return walkChildren(node, listDepth).trim() + '\n\n';
                case 'strong': case 'b': {
                    const inner = walkChildren(node, listDepth).trim();
                    return inner ? `**${inner}**` : '';
                }
                case 'em': case 'i': {
                    const inner = walkChildren(node, listDepth).trim();
                    return inner ? `*${inner}*` : '';
                }
                case 'del': case 's': {
                    const inner = walkChildren(node, listDepth).trim();
                    return inner ? `~~${inner}~~` : '';
                }
                case 'code': {
                    if (node.closest('pre')) return node.textContent;
                    const t = node.textContent;
                    const maxRun = Math.max(0, ...([...t.matchAll(/`+/g)].map(m => m[0].length)));
                    const fence = '`'.repeat(maxRun + 1);
                    const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
                    return `${fence}${pad}${t}${pad}${fence}`;
                }
                case 'pre': {
                    const codeEl = node.querySelector('code');
                    const lang = (codeEl?.className || '').match(/language-(\S+)/)?.[1] || '';
                    // textContent drops <br> tags; walk children to preserve them as newlines.
                    const extractCode = n => {
                        if (n.nodeType === Node.TEXT_NODE) return n.textContent;
                        if (n.tagName?.toLowerCase() === 'br') return '\n';
                        return [...n.childNodes].map(extractCode).join('');
                    };
                    const text = extractCode(codeEl ?? node).trimEnd();
                    const maxRun = Math.max(2, ...([...text.matchAll(/`+/g)].map(m => m[0].length)));
                    const fence = '`'.repeat(maxRun + 1);
                    return `\n${fence}${lang}\n${text}\n${fence}\n\n`;
                }
                case 'blockquote': {
                    const inner = walkChildren(node, listDepth).trim();
                    return inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
                }
                case 'ul': return walkList(node, listDepth, false);
                case 'ol': return walkList(node, listDepth, true);
                case 'h1': return `# ${walkChildren(node, listDepth).trim()}\n\n`;
                case 'h2': return `## ${walkChildren(node, listDepth).trim()}\n\n`;
                case 'h3': return `### ${walkChildren(node, listDepth).trim()}\n\n`;
                case 'h4': return `#### ${walkChildren(node, listDepth).trim()}\n\n`;
                case 'h5': return `##### ${walkChildren(node, listDepth).trim()}\n\n`;
                case 'h6': return `###### ${walkChildren(node, listDepth).trim()}\n\n`;
                case 'a': {
                    // Drop links that only work inside the ChatGPT UI:
                    //   • truncated citation labels (text ending with …)
                    //   • fragment anchors (#cite-1, #source-2, …)
                    //   • javascript: and blob: pseudo-URLs
                    if (node.innerText.trim().endsWith('…')) return '';
                    const href = node.getAttribute('href') || '';
                    if (/^(#|javascript:|blob:)/i.test(href)) return '';
                    const inner = walkChildren(node, listDepth);
                    return href ? `[${escLabel(inner)}](<${escUrl(href)}>)` : inner;
                }
                case 'img': {
                    const alt = node.getAttribute('alt') || '';
                    const src = node.getAttribute('src') || '';
                    if (!src) return alt ? `[image: ${escLabel(alt)}]` : '[image]';
                    const token = `__IMG_PLACEHOLDER_${++_imageCounter}__`;
                    _pendingImageDownloads.push({ url: src, token });
                    // Raw HTML, not markdown image syntax: markdown has no
                    // way to constrain display size or make an image
                    // clickable through to full size, both of which the
                    // rendered conversation does (image shown shrunk to fit
                    // the message column, click opens it at full size) — and
                    // markdown happily passes raw HTML through untouched.
                    // The rect is read now, while node is still the actual
                    // rendered element in the live conversation, so the
                    // exported size matches what was actually on screen
                    // rather than guessing at ChatGPT's CSS classes.
                    const rect = node.getBoundingClientRect();
                    const w = Math.round(rect.width), h = Math.round(rect.height);
                    const dims = (w > 0 && h > 0) ? ` width="${w}" height="${h}"` : '';
                    return `<a href="${token}" target="_blank" rel="noopener"><img src="${token}" alt="${escHtmlAttr(alt)}"${dims}></a>`;
                }
                case 'button': {
                    // File-attachment buttons carry the clean full filename in aria-label.
                    const ariaLabel = node.getAttribute('aria-label');
                    if (ariaLabel && /\.\w{2,6}$/.test(ariaLabel.trim())) {
                        return `\nUpload: ${ariaLabel.trim()}\n\n`;
                    }
                    // Fallback for buttons whose innerText matches a file-attachment pattern.
                    const text = node.innerText.trim();
                    if (/\.\w{2,6}(?:\s*[A-Za-z]+)?$/.test(text)) {
                        const clean = text.replace(/(\.\w{2,6})\s*[A-Za-z]+$/, '$1')
                                          .replace(/[\r\n]+/g, '');
                        return `\nUpload: ${clean.trim()}\n\n`;
                    }
                    // All other buttons are UI controls (show more/less, copy, edit, …)
                    // — they have no meaning in the exported file.
                    return '';
                }
                case 'table': return tableToMd(node) + '\n\n';
                default: {
                    // File-attachment tile: div[role="group"] with aria-label = filename.
                    // Handle here so its visible-text children are not walked separately.
                    const tileLabel = node.getAttribute && node.getAttribute('aria-label');
                    if (node.getAttribute && node.getAttribute('role') === 'group' &&
                            tileLabel && /\.\w{2,6}$/.test(tileLabel.trim())) {
                        return `\nUpload: ${tileLabel.trim()}\n\n`;
                    }
                    return walkChildren(node, listDepth);
                }
            }
        }
        function walkChildren(node, listDepth) {
            return [...node.childNodes].map(c => walk(c, listDepth)).join('');
        }
        function walkList(listEl, listDepth, ordered) {
            const indent = '  '.repeat(listDepth);
            let counter = 1;
            let out = '';
            for (const child of listEl.childNodes) {
                if (child.nodeType !== Node.ELEMENT_NODE ||
                    child.tagName.toLowerCase() !== 'li') continue;
                let inline = '';
                let nested = '';
                // If the first element child is a heading, skip the bullet entirely —
                // "- ### text" does not render as a heading in Markdown renderers.
                const firstElem = [...child.childNodes].find(n => n.nodeType === Node.ELEMENT_NODE);
                if (firstElem && /^h[1-6]$/.test(firstElem.tagName.toLowerCase())) {
                    out += walkChildren(child, listDepth);
                    counter++;
                    continue;
                }
                for (const c of child.childNodes) {
                    const t = c.nodeType === Node.ELEMENT_NODE ? c.tagName.toLowerCase() : '';
                    if (t === 'ul' || t === 'ol') nested += walk(c, listDepth + 1);
                    else inline += walk(c, listDepth + 1);
                }
                const bullet = ordered ? `${counter++}.` : '-';
                out += `${indent}${bullet} ${inline.trim()}`;
                if (nested.trim()) out += '\n' + nested.trimEnd();
                out += '\n';
            }
            return out + '\n';
        }
        function tableToMd(table) {
            const rows = [...table.querySelectorAll('tr')];
            if (!rows.length) return '';
            const toCell = c => walk(c, 0).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ');
            const cells = rows.map(r => [...r.querySelectorAll('th,td')].map(toCell));
            if (!cells[0]?.length) return '';
            const header = `| ${cells[0].join(' | ')} |`;
            const sep    = `| ${cells[0].map(() => '---').join(' | ')} |`;
            const body   = cells.slice(1).map(r => `| ${r.join(' | ')} |`).join('\n');
            return [header, sep, ...(body ? [body] : [])].join('\n');
        }
        const _result = walk(el, 0)
            .trim()
            .replace(/\n{3,}/g, '\n\n')
            .replace(
                /^([^\s/]+\.\w{2,6})\s*(?:File|Image|Document|Spreadsheet|Presentation|[A-Z]{2,6})$/gm,
                (_match, filename) => `Upload: ${filename}`
            )
            .replace(/\n{3,}/g, '\n\n');
        return _result;
    }
    
    function dryMarkdownFor(el) {
        const imageCounterBefore = _imageCounter;
        const pendingLengthBefore = _pendingImageDownloads.length;
        try {
            return htmlToMarkdown(el);
        } finally {
            _imageCounter = imageCounterBefore;
            _pendingImageDownloads.length = pendingLengthBefore;
        }
    }
    
    function hasExtractableMarkdown(el) {
        return dryMarkdownFor(el).trim().length > 0;
    }
    
    /** Returns the chat title from the page, falling back to 'chat'. */
    function getChatTitle() {
        return document.title.replace(/\s*[|–—-]\s*ChatGPT\s*$/i, '').trim() || 'chat';
    }
    
    /** Converts a chat title to a safe filename fragment. */
    function titleToSlug(title) {
        return title
            .replace(/[/\\:*?"<>|]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
    }
    
    /** Compiles allPrompts prompts to a Markdown document and triggers a download. */
    function hoistUploads(text) {
        const uploads = [];
        const body = text.replace(/\nUpload:([^\n]+)/g, (_m, name) => {
            uploads.push(`Upload:${name}`);
            return '';
        });
        if (!uploads.length) return text;
        return uploads.join('\n') + '\n\n' + body.replace(/^\n+/, '').trimStart();
    }
    
    async function exportMarkdown(ui, prompts, exportTimestamp = Date.now()) {
        const questions = countPrompts(prompts);
        const date  = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        const title = getChatTitle();
        // Shared by the .md filename and every image filename below, fixed
        // once per RUN (passed in by the caller, see _runTimestamp) rather
        // than generated fresh here — re-clicking "Export again" against the
        // same run must keep reusing the same timestamp, since any images
        // already downloaded for this run have it baked into their
        // filenames already on disk.
        let md = `# ${title}\n_${questions} user prompts — ${date}_\n\n`;
    
        const userPrompts = prompts.filter(pr => pr.role === 'user');
        if (userPrompts.length > 0) {
            md += `### Table of Contents\n\n`;
            userPrompts.forEach((pr, i) => {
                const firstLine = (pr.plainText || pr.text).split('\n')
                    .map(l => l.replace(/[^\x20-\x7E]/g, '').trim())
                    .filter(l => l && !l.startsWith('Upload:'))
                    [0] || '(empty)';
                const label = escLabel(firstLine.slice(0, 80));
                md += pr.msgId
                    ? `${i + 1}. [${label}](#msg-${pr.msgId})\n`
                    : `${i + 1}. ${label}\n`;
            });
            md += '\n';
        }
    
        md += `---\n\n`;
    
        for (const pr of prompts) {
            const label = pr.role === 'user' ? '### USER' : pr.role === 'assistant' ? '### ASSISTANT' : '### UNKNOWN';
            const text  = pr.role === 'user' ? hoistUploads(pr.text) : pr.text;
            const anchor = pr.role === 'user' && pr.msgId ? `<a id="msg-${pr.msgId}"></a>\n\n` : '';
            md += `${anchor}${label}\n\n${text}\n\n---\n\n`;
        }
        if (_pendingImageDownloads.length > 0) {
            // Fetched from inside this page's own session (chatgpt.com), not
            // referenced as a live <img src> — the auth cookie gating these
            // URLs is SameSite, so it's sent for this same-origin fetch but
            // would be stripped on a cross-origin embed in an external
            // markdown viewer (confirmed: the URL works when navigated to
            // directly, but never rendered as an embedded image).
            const slug = titleToSlug(title);
            // "Export again" calls this same function against the same
            // _pendingImageDownloads list without re-running the walk —
            // re-fetching and re-triggering a fresh download of every image
            // on each click would be wasteful and would litter the Downloads
            // folder with duplicates. Memoize the resolved filename onto the
            // entry itself so a repeat export just reuses it.
            const toFetch = _pendingImageDownloads.filter(e => !e.filename);
            if (toFetch.length > 0) {
                ui.log(`Downloading ${toFetch.length} image(s) from this session so they'll actually render in the exported file...`);
            }
            let downloaded = 0;
            for (let i = 0; i < _pendingImageDownloads.length; i++) {
                const entry = _pendingImageDownloads[i];
                if (!entry.filename) {
                    // Fallback: keep the live URL reference if the download
                    // fails. HTML-escaped (not URL-escaped) because the
                    // token it replaces sits inside an href/src attribute
                    // now, not markdown link syntax — an unescaped "&" in
                    // the query string would otherwise sit unescaped in HTML.
                    entry.filename = escHtmlAttr(entry.url);
                    try {
                        const resp = await fetch(entry.url, { credentials: 'include' });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        const blob = await resp.blob();
                        const ext = (blob.type.split('/')[1] || 'png').split(';')[0].replace('jpeg', 'jpg');
                        entry.filename = `${slug}-${exportTimestamp}-img-${String(i + 1).padStart(3, '0')}.${ext}`;
                        const imgHref = URL.createObjectURL(blob);
                        const imgA = document.createElement('a');
                        imgA.href = imgHref;
                        imgA.download = entry.filename;
                        document.body.appendChild(imgA);
                        imgA.click();
                        imgA.remove();
                        setTimeout(() => URL.revokeObjectURL(imgHref), 100);
                        downloaded++;
                        // Browsers block/throttle rapid automatic multi-file
                        // downloads (observed as silently-skipped saves, not
                        // an error) — spacing these out keeps every one of
                        // them landing as an actual file instead of being
                        // swallowed.
                        await sleep(300);
                    } catch (e) {
                        ui.log(`  ⚠ image ${i + 1} download failed (${e.message}) — kept as a live URL reference instead`);
                    }
                }
                md = md.split(entry.token).join(entry.filename);
            }
            if (toFetch.length > 0) {
                ui.log(`  ${downloaded}/${toFetch.length} image(s) saved alongside the .md file — same folder, same name prefix.`);
            }
        }
        if (_pendingCanvasDownloads.length > 0) {
            // Same memoize-by-filename discipline as images, for the same
            // reason: "export again" must not re-trigger a fresh download
            // of every canvas block on each click.
            const slug = titleToSlug(title);
            const toSave = _pendingCanvasDownloads.filter(e => !e.filename);
            if (toSave.length > 0) {
                ui.log(`Saving ${toSave.length} canvas/textdoc block(s) as separate .md file(s)...`);
            }
            for (let i = 0; i < _pendingCanvasDownloads.length; i++) {
                const entry = _pendingCanvasDownloads[i];
                if (!entry.filename) {
                    entry.filename = `${slug}-${exportTimestamp}-canvas-${String(i + 1).padStart(3, '0')}.md`;
                    const canvasHref = URL.createObjectURL(new Blob(['﻿' + entry.text], { type: 'text/markdown;charset=utf-8' }));
                    const canvasA = document.createElement('a');
                    canvasA.href = canvasHref;
                    canvasA.download = entry.filename;
                    document.body.appendChild(canvasA);
                    canvasA.click();
                    canvasA.remove();
                    setTimeout(() => URL.revokeObjectURL(canvasHref), 100);
                    // Same browser multi-download throttling as images —
                    // see the comment at that loop.
                    await sleep(300);
                }
                md = md.split(entry.token).join(entry.filename);
            }
            if (toSave.length > 0) {
                ui.log(`  ${toSave.length} canvas/textdoc block(s) saved alongside the .md file — same folder, same name prefix.`);
            }
        }
        if (_htmlCaptures.length > 0) {
            // A second, parallel record of the walk — most entries are not
            // full visual snapshots (see trimmedCaptureHtml): the captured
            // deck's own opening tag, the first slab's opening tag, and a
            // very small first-slab preview, kept trimmed since a single
            // deck's full content can run to several KB on its own
            // (confirmed live). The 'room-drift-right-after-jump' /
            // 'room-drift-after-wait' labels are the deliberate exception —
            // real, untrimmed outerHTML (see maintainWorkZone), because the
            // whole point there is diffing the actual DOM at two specific
            // instants, which trimmedCaptureHtml's identity-tag-only output
            // can't show. Plain string concatenation, not appended via DOM
            // nodes/innerHTML — this never touches the live page's DOM,
            // only builds a standalone document to hand to the browser as
            // a download.
            const slug = titleToSlug(title);
            const sections = _htmlCaptures.map((c, i) =>
                `<h2>#${i + 1} — label=${escHtmlAttr(c.label)} role=${escHtmlAttr(c.role)} turnId=${escHtmlAttr(c.turnId)}</h2>\n` +
                `${c.html}\n<hr>`
            ).join('\n');
            const htmlDoc =
                `<!DOCTYPE html>\n<html><head><meta charset="utf-8">` +
                `<title>${escHtmlAttr(title)} — captured deck identities</title></head><body>\n` +
                `<h1>${escHtmlAttr(title)} — captured deck identities (${_htmlCaptures.length})</h1>\n` +
                `<p>Companion to the .md export — trimmed identity markup (deck's own opening tag + first slab's ` +
                `opening tag, both self-closed) plus a small first-slab preview. Message previews keep only the first ` +
                `sentence; image/canvas previews use compact link-style placeholders.</p>\n<hr>\n` +
                `${sections}\n</body></html>`;
            const htmlA = document.createElement('a');
            htmlA.href = URL.createObjectURL(new Blob([htmlDoc], { type: 'text/html;charset=utf-8' }));
            htmlA.download = `${slug}-${exportTimestamp}.html`;
            document.body.appendChild(htmlA);
            htmlA.click();
            setTimeout(() => { URL.revokeObjectURL(htmlA.href); htmlA.remove(); }, 100);
            ui.log(`  ${_htmlCaptures.length} captured deck identity record(s) saved as a separate .html file — same folder, same name prefix.`);
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + md], { type: 'text/markdown;charset=utf-8' }));
        a.download = `${titleToSlug(title)}-${exportTimestamp}.md`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
    }
    
    // ════════════════════════════════════════════════════════════════
    // MENU DIAGNOSTIC
    // ════════════════════════════════════════════════════════════════
    
    
    // ════════════════════════════════════════════════════════════════
    // RUNTIME GAP DETECTION HELPERS
    // ════════════════════════════════════════════════════════════════
    
    /**
     * Returns the ordered array of prompt navigation dot buttons. Each
     * button's aria-label is just a generic "Prompt N" — not usable to
     * identify which conversation turn it points to.
     * Primary: look inside the narrow vertical strip (div.w-9.max-h-[50lvh].no-scrollbar).
     * Fallback: match by button class (h-0.5 w-4.5 rounded-full).
     */
    function getNavMenuItems() {
        const strip = [...document.querySelectorAll('div')]
            .find(d => d.className.includes('w-9') &&
                       d.className.includes('max-h-[50lvh]') &&
                       d.className.includes('no-scrollbar'));
        if (strip) return [...strip.querySelectorAll('button')];
        return [...document.querySelectorAll('button')]
            .filter(b => b.className.includes('h-0.5') &&
                         b.className.includes('w-4.5') &&
                         b.className.includes('rounded-full'));
    }
    
    // ════════════════════════════════════════════════════════════════
    // ORCHESTRATION
    // ════════════════════════════════════════════════════════════════
    
    // -1 = walk upward from the bottom toward the start of the conversation
    //      (the only behavior before this constant existed — default, tested).
    // +1 = walk downward from the top toward the end. Flipping this constant
    //      switches which boundary we bootstrap from and which side the
    //      adjacent-turn search looks at; everything else in the chain walk
    //      (isInViewport, waitForTurnReady, and the deck-scoped successor
    //      search) already works unmodified in either direction.
    const WALK_DIRECTION = -1;
    
    // 30s, not longer: the user pointed out directly that the image in
    // question is visibly there well before 30s in ordinary use, so a
    // longer wall-clock budget was the wrong axis to test — ruled out by
    // argument before it was even worth running. What's actually still
    // untested is *position*, not time: data-is-intersecting is ChatGPT's
    // own virtualization flag (subtree mounted, replacing the lazy
    // placeholder) — it says nothing about whether this exact element
    // sits inside the real, visible viewport rectangle right now. If the
    // image-gen component has its own internal IntersectionObserver keyed
    // to genuine viewport visibility, separate from the outer flag, the
    // script's edge-pinning scroll logic could satisfy the outer flag
    // while leaving the element just outside the real visible rect —
    // never tripping the inner trigger, no matter how long we wait.
    const TO_COME_TIMEOUT_MS = 5_000;
    
    // Deck identity is data-turn-id-container, full stop — data-turn/
    // data-turn-id on inner elements are only ever used to read attributes
    // not present on the container itself, never to identify a deck.
    function deckSequenceId(el) {
        return el?.getAttribute?.('data-turn-id-container') || null;
    }
    
    function queryDeckSequenceContainers() {
        const byId = new Map();
        for (const el of document.querySelectorAll('[data-turn-id-container]')) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            const id = el.getAttribute('data-turn-id-container');
            const existing = byId.get(id);
            if (!existing || el.contains(existing)) byId.set(id, el);
        }
        return [...byId.values()];
    }
    
    function readinessElementForDeck(deckEl) {
        const id = deckSequenceId(deckEl);
        let el = deckEl;
        while (el && el !== document.body) {
            if (el.matches?.('[data-turn-id-container]') &&
                el.hasAttribute('data-is-intersecting') &&
                (!id || deckSequenceId(el) === id)) {
                return el;
            }
            el = el.parentElement;
        }
        return deckEl;
    }
    
    // One-time bootstrap only: find the deck/container whose entry edge is
    // visible at the viewport boundary. After this, the regular chain walk
    // finds adjacent containers by geometry against the current container.
    function findBootstrapContainer(container, direction) {
        const vb = container === document.documentElement
            ? { top: 0, bottom: window.innerHeight }
            : container.getBoundingClientRect();
        const inRange = r => direction === -1
            ? (r.bottom > vb.top && r.bottom <= vb.bottom)
            : (r.top    < vb.bottom && r.top    >= vb.top);
        const candidates = queryDeckSequenceContainers()
            .filter(el => inRange(el.getBoundingClientRect()));
        if (candidates.length === 0) return null;
        const edgeValue = el => {
            const r = el.getBoundingClientRect();
            return direction === -1 ? r.bottom : r.top;
        };
        const better = (a, b) => {
            const ae = edgeValue(a), be = edgeValue(b);
            if (ae !== be) return direction === -1 ? ae > be : ae < be;
            return a.getBoundingClientRect().height > b.getBoundingClientRect().height;
        };
        return candidates.reduce((a, b) => better(b, a) ? b : a);
    }
    
    // Outer deck rectangles are expected to be close. A small CSS/layout gap is
    // not the absence of a next deck; the loop should stop only when no next
    // deck is found.
    const DECK_ADJACENCY_TOLERANCE = 2;
    
    // Selected slabs need a looser rule. Tool/control elements are
    // intentionally not extracted, so the facing edges of two extracted
    // slabs may have a real positive gap. They should not overlap beyond
    // ordinary subpixel geometry, however.
    const SLAB_ADJACENCY_MAX_GAP = 150;
    const SLAB_ADJACENCY_OVERLAP_TOLERANCE = 2;
    
    // Returns the signed facing-edge difference: positive means a gap;
    // negative means overlap.
    function adjacencyGap(direction, olderRect, newerRect) {
        return direction === -1
            ? olderRect.top - newerRect.bottom
            : newerRect.top - olderRect.bottom;
    }
    
    function checkDeckAdjacency(olderDeck, newerDeck) {
        const gap = adjacencyGap(
            WALK_DIRECTION,
            olderDeck.getBoundingClientRect(),
            newerDeck.getBoundingClientRect()
        );
        return gap;
    }
    
    function checkSlabAdjacency(currentSlab, nextSlab) {
        const gap = adjacencyGap(
            WALK_DIRECTION,
            currentSlab.geometryElement.getBoundingClientRect(),
            nextSlab.geometryElement.getBoundingClientRect()
        );
        return gap;
    }
    
    // Generic, content-type-agnostic completeness check: instead of asking
    // "does this look like an image/canvas/whatever we know how to detect,"
    // ask "did the slabs we actually extracted from this container account
    // for all of its vertical space." Anything occupying real space inside
    // a container that no extracted slab's rect touches is direct, structural
    // proof something was missed — regardless of what it turns out to be.
    // Catches the canvas-block case (a mixed container with one ordinary
    // message slab and one non-message block we never registered as a candidate at
    // all) the same way it would catch any future content type we haven't
    // even seen yet, without needing to special-case any of them.
    //
    // Coordinates are relative to the container's own top, not absolute
    // viewport position — recordSlabRange captures both rects together, in
    // the same synchronous snapshot, at the moment each slab is extracted,
    // so the relative offsets stay valid even though the page scrolls (and
    // the container's absolute viewport position changes) between one
    // slab's extraction and the next.
    // Tolerate ordinary inter-message padding/margin and ChatGPT's own
    // per-message UI chrome (the Copy/Edit or Copy/Good/Bad/Share actions
    // row rendered below every message, inside the same deck, never
    // covered by the extracted slab's own rect) — confirmed false-positive
    // live: a one-line user message ("Can you tell why I cannot branch
    // this conversation?") reproducibly flagged an 86px trailing gap on
    // every run, verified against the real conversation to have nothing
    // missing. Short messages are exactly where this misfires most, since
    // the actions row's height is ~fixed regardless of message length,
    // so it dominates a short message's trailing space. Raised from 80 to
    // comfortably clear that 86px case while staying well under the real
    // canvas-block miss this check actually needs to catch (~370px) —
    // chosen as a reasoned middle point between the two observed
    // data points, not measured against the actions row's exact height.
    const CONTAINER_COVERAGE_GAP_THRESHOLD = 160;
    function recordSlabRange(containerEl, slabEl, ranges) {
        const cRect = containerEl.getBoundingClientRect();
        const sRect = slabEl.getBoundingClientRect();
        ranges.push({ top: sRect.top - cRect.top, bottom: sRect.bottom - cRect.top });
    }
    function findContainerCoverageGaps(ranges, containerHeight) {
        if (ranges.length === 0) {
            return containerHeight > CONTAINER_COVERAGE_GAP_THRESHOLD ? [{ from: 0, to: containerHeight }] : [];
        }
        const sorted = [...ranges].sort((a, b) => a.top - b.top);
        const gaps = [];
        let coveredTo = 0;
        for (const r of sorted) {
            if (r.top - coveredTo > CONTAINER_COVERAGE_GAP_THRESHOLD) gaps.push({ from: coveredTo, to: r.top });
            coveredTo = Math.max(coveredTo, r.bottom);
        }
        if (containerHeight - coveredTo > CONTAINER_COVERAGE_GAP_THRESHOLD) gaps.push({ from: coveredTo, to: containerHeight });
        return gaps;
    }
    
    // Returns null when the deck's coverage is unremarkable, or a note to
    // insert into the walkway when extracted slabs leave a real coverage gap
    // or when the deck yielded zero slabs. We deliberately do not throw on a
    // zero-slab deck: "no
    // slab detected" is a statement about our own extraction, not about the
    // conversation — the conversation itself is always correct, a turn
    // happened, a response was expected — but we have no way to distinguish,
    // from inside the script, a deck that ChatGPT genuinely never rendered
    // anything into (confirmed possible: directly observed once via live
    // manual inspection, and again automatically via the zero-overlapping-
    // candidates check below) from a deck where our own selection logic has
    // a real bug. Aborting the whole run on every occurrence would lose
    // every other, recoverable turn in the conversation over one we already
    // cannot fix either way. So instead: log it, and leave a visible note in
    // the actual exported transcript rather than silently skipping past it —
    // the gap stays honest and visible without sacrificing everything else.
    function finishDeckCoverage(deckEl, ranges, current) {
        const deckRect = deckEl.getBoundingClientRect();
        const gaps = findContainerCoverageGaps(ranges, deckRect.height);
        if (gaps.length > 0) {
            const gapText = gaps.map(g => `[${Math.round(g.from)}px–${Math.round(g.to)}px]`).join(', ');
            if (ranges.length > 0) {
                return {
                    role: 'unknown',
                    text: `*[Possible missing slab — deck coverage had ${gaps.length} uncovered gap(s): ` +
                        `${gapText}. turnId=${deckSequenceId(deckEl) || 'unknown'}.]*\n\n`,
                    plainText: '[Possible missing slab]',
                    msgId: null,
                    turnId: deckSequenceId(deckEl) || null,
                };
            }
        }
        if (ranges.length > 0) return null;
        // Same evidence as a thrown error would have carried, kept for
        // diagnosability even though this is no longer fatal: which selected
        // candidates' rects actually overlap this deck's rect right
        // now (distinguishes "a real candidate is in here and our geometry
        // missed it" from "no candidate exists here at all"), a live
        // structural dump of the deck, and whether each overlapping candidate
        // is ahead of current at all.
        const currentRect = current ? current.geometryElement.getBoundingClientRect() : null;
        const overlapping = querySelectedSlabCandidates().filter(candidate => {
            const er = candidate.geometryElement.getBoundingClientRect();
            return Math.min(er.bottom, deckRect.bottom) - Math.max(er.top, deckRect.top) > SMALL_EXTRA;
        }).map(candidate => {
            const er = candidate.geometryElement.getBoundingClientRect();
            const distance = currentRect ? slabDistanceAhead(currentRect, er) : undefined;
            const distanceNote = !currentRect ? 'current unknown'
                : distance === null ? 'behind current, not ahead'
                : `${Math.round(distance)}px ahead of current — should already have been found`;
            return `${candidate.type}/${slabRole(candidate)} rect=[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}] (${distanceNote})`;
        });
        return {
            // Unlike canvas/image extraction below, there's no type-based
            // certainty here — the missing content could have been either
            // role. Defaulting to 'assistant' when the attribute itself is
            // unreadable would silently misattribute a user turn (observed
            // live: turnId=febac401, a known user turn, rendered as an
            // assistant note and so never counted toward the user-prompt
            // total) — 'unknown' keeps that honest instead.
            role: deckEl.getAttribute('data-turn') || 'unknown',
            text: `*[Empty container — no slab could be detected for this turn (turnId=` +
                `${deckSequenceId(deckEl) || 'unknown'}). This may be a ChatGPT rendering failure or an ` +
                `extractor bug.]*\n\n` +
                `${captureElementHtmlReference('empty-container-coverage', deckEl, deckEl.getAttribute('data-turn') || 'unknown', deckSequenceId(deckEl))}\n\n`,
            plainText: '[Empty container]',
            msgId: null,
            turnId: deckSequenceId(deckEl) || null,
        };
    }
    
    // Empirically measured floors from a live conversation: 44px / 32px for
    // shortest user/assistant message heights.
    // smallExtra must stay under the smaller of the two (the next prompt
    // could be either role) so the probe point can never overshoot past the
    // immediately-adjacent message into the one before it.
    const SMALL_EXTRA = 28;
    const MIN_ONE_LINE_MESSAGE_HEIGHT = 90;
    // Strictly below the smaller of the two measured one-line floors above
    // (32px) — a real message with at least one line of text always
    // measures above that; only a bubble with zero lines (padding alone)
    // can fall under it. Used to tell "permanently empty by design" apart
    // from "not yet rendered" without waiting: a deck's own
    // --last-known-height is a real measurement from the last time it was
    // actually, fully rendered, not a guess about its current state.
    const EMPTY_BUBBLE_HEIGHT_CEILING = 24;
    
    function lastKnownHeightPx(deckEl) {
        const raw = deckEl?.style?.getPropertyValue('--last-known-height');
        if (!raw) return null;
        const value = parseFloat(raw);
        return Number.isFinite(value) ? value : null;
    }
    
    // Finds the adjacent deck by geometry, not DOM-sibling structure. Deck
    // sequencing uses the outer data-turn-id-container rectangles; slab
    // discovery inside the selected deck is a later, separate request.
    function findNextDeck(turnEl, direction) {
        const r = turnEl.getBoundingClientRect();
        const edge = direction === -1 ? r.top : r.bottom;
        const currentDeckId = deckSequenceId(turnEl);
        const allCandidates = queryDeckSequenceContainers().filter(el => el !== turnEl);
        const deckCandidates = allCandidates.filter(el => !currentDeckId || deckSequenceId(el) !== currentDeckId);
        for (let h = 8; h <= 400; h *= 2) {
            const candidates = deckCandidates.filter(el => {
                const er = el.getBoundingClientRect();
                return direction === -1
                    ? (er.bottom >= edge - h && er.top <= edge)
                    : (er.top <= edge + h && er.bottom >= edge);
            });
            if (candidates.length > 0) {
                return direction === -1
                    ? candidates.reduce((a, b) => a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b)
                    : candidates.reduce((a, b) => a.getBoundingClientRect().top    < b.getBoundingClientRect().top    ? a : b);
            }
        }
        const candidatesOnSide = deckCandidates.filter(el => {
            const er = el.getBoundingClientRect();
            return direction === -1 ? er.bottom <= edge : er.top >= edge;
        });
        if (candidatesOnSide.length > 0) {
            return direction === -1
                ? candidatesOnSide.reduce((a, b) => a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b)
                : candidatesOnSide.reduce((a, b) => a.getBoundingClientRect().top    < b.getBoundingClientRect().top    ? a : b);
        }
        return null; // no deck on that side — genuine start/end of conversation
    }
    
    // Which edge counts as "strictly inside the viewport" (touching the
    // near boundary doesn't count, to stay clear of exact-boundary
    // ambiguity) depends on direction, not just on using top unconditionally.
    // Walking upward (direction=-1), target is conceptually earlier/above —
    // scrolling toward it reveals its bottom edge first and its top edge
    // last, so requiring top specifically means substantial exposure, not a
    // sliver. Walking downward (+1), target is later/below — top arrives
    // first and bottom last, so checking top there (the original,
    // upward-only formula, reused unconditionally) was satisfied the moment
    // a sliver of target peeked in, long before enough of it was exposed to
    // reliably trigger ChatGPT's real IntersectionObserver. Used by
    // waitForTurnReady's diagnostic when a deck isn't intersecting.
    function isInViewport(container, target) {
        const vTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
        const vBottom = container === document.documentElement ? window.innerHeight : container.getBoundingClientRect().bottom;
        const r = target.getBoundingClientRect();
        const edge = WALK_DIRECTION === -1 ? r.top : r.bottom;
        return edge > vTop && edge <= vBottom;
    }
    
    // How far past the viewport's leading edge is ChatGPT's own renderer
    // already willing to call something ready (data-is-intersecting not
    // "false"), at this exact moment — i.e. how much further than one
    // clientHeight a single move could safely jump next time and still find
    // everything in between already lit. Purely a measurement: doesn't move
    // anything, doesn't affect behavior, just answers "how big is the
    // render margin" so a larger-step policy can be sized correctly instead
    // of guessed.
    function measureReadyMargin(container, direction) {
        const vTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
        const vBottom = container === document.documentElement ? window.innerHeight : container.getBoundingClientRect().bottom;
        const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
        let margin = 0;
        let winner = null;
        for (const el of queryDeckSequenceContainers()) {
            // Confirmed live (identically, twice, on the same conversation):
            // the very first message's container has no data-is-intersecting
            // attribute at all — it's mounted eagerly before lazy-loading
            // wraps later content, never entering the tracked system. Absent
            // is not the same claim as "intersecting" or even "true"; treating
            // it as ready was inflating this measurement with a structural
            // outlier rather than genuine pre-rendered content.
            if (!el.hasAttribute('data-is-intersecting')) continue;
            if (el.getAttribute('data-is-intersecting') === 'false') continue; // not ready — doesn't extend the lit margin
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue; // detached
            const m = direction === -1 ? vTop - r.top : r.bottom - vBottom;
            if (m > margin) { margin = m; winner = el; }
        }
        // Identify *what* is contributing the margin, not just its size, using
        // only the same-frame viewport-relative rectangles that produced the
        // margin.
        let winnerInfo = null;
        if (winner) {
            const r = winner.getBoundingClientRect();
            winnerInfo = {
                hadAttr: winner.hasAttribute('data-is-intersecting'),
                attrValue: winner.getAttribute('data-is-intersecting'),
                turnId: deckSequenceId(winner) || '(none)',
                rectTop: r.top,
                rectBottom: r.bottom,
                viewportTop: vTop,
                viewportBottom: vBottom,
            };
        }
        return { margin, winnerInfo };
    }
    
    // Captures the message structure that must be stable before extraction.
    function summarizeMessageStructure(el, container) {
        // [data-message-author-role] is the extraction scope for ordinary
        // message slabs, not just a point marker. Images are treated more
        // cautiously here because ChatGPT can expose generated-image content
        // as a separate slab type or as nearby deck content. If a container
        // holds exactly one message, it is safe to include container images
        // in that message's readiness signature; otherwise, attributing an
        // image to the right message would need geometric reasoning and is
        // intentionally not guessed here.
        const imageScope = imageScopeFor(el, container);
        return {
            textLen: el.innerText.length,
            childCount: el.children.length,
            rectHeight: Math.round(el.getBoundingClientRect().height),
            codeBlocks: el.querySelectorAll('pre, code').length,
            images: imageScope.querySelectorAll('img').length,
            tables: el.querySelectorAll('table').length,
            placeholders: el.querySelectorAll('[class*="skeleton"], [class*="placeholder"], [data-placeholder]').length,
        };
    }
    function imageScopeFor(el, container) {
        const singleMessageContainer = container && container.querySelectorAll('[data-message-author-role]').length === 1;
        return singleMessageContainer ? container : el;
    }
    // The "images" count above only tests whether an <img> element exists —
    // it can't catch the failure mode that actually matters for this script:
    // ChatGPT swapping the SAME <img>'s src (e.g. a low-res/transient URL
    // during generation → the final signed estuary URL once ready) without
    // changing the element count at all. htmlToMarkdown() reads src directly
    // (it's what gets queued for download), so a src-only change is exactly
    // the kind of "looks ready, isn't" gap the composite-fingerprint
    // experiment is supposed to catch — the count alone is blind to it.
    function imageSrcsFor(el, container) {
        return [...imageScopeFor(el, container).querySelectorAll('img')].map(img => img.getAttribute('src') || '');
    }
    
    function canvasContentRoot(el) {
        if (!isCanvasBlock(el)) return null;
        return el.querySelector('#prosemirror-editor-container .ProseMirror');
    }
    
    const SLAB_FINISH_TIMEOUT_MS = 30_000;
    const SLAB_FINISH_POLL_MS = 100;
    
    function primaryImageForSlab(el) {
        return el.querySelector('img:not([aria-hidden="true"])');
    }
    
    function slabFinishFingerprint(slab, container) {
        const el = slab.element;
        if (slab.type === 'canvas') {
            const contentRoot = canvasContentRoot(el);
            if (!contentRoot) {
                return {
                    ready: false,
                    reason: 'canvas content surface missing',
                    summary: summarizeMessageStructure(el, container),
                    imageSrcs: [],
                };
            }
            const markdown = dryMarkdownFor(contentRoot).trim();
            return {
                ready: markdown.length > 0,
                reason: markdown.length > 0 ? 'ready' : 'canvas content surface empty',
                summary: {
                    ...summarizeMessageStructure(el, container),
                    canvasMarkdownLength: markdown.length,
                },
                imageSrcs: [],
            };
        }
        if (slab.type === 'image') {
            const image = primaryImageForSlab(el);
            const src = image?.getAttribute('src') || '';
            return {
                ready: Boolean(image && src),
                reason: !image ? 'primary generated image missing' : (src ? 'ready' : 'primary generated image without src'),
                summary: summarizeMessageStructure(el, container),
                imageSrcs: src ? [src] : [],
            };
        }
        const summary = summarizeMessageStructure(el, container);
        const imageSrcs = imageSrcsFor(el, container);
        const hasContent = summary.textLen > 0 || imageSrcs.length > 0;
        const imagesHaveSrc = imageSrcs.every(Boolean);
        // A message with no text and no image is ambiguous on its own —
        // mid-render with nothing painted yet, or genuinely, permanently
        // empty by design (an interrupted response, an attachment chip
        // with no <img> tag). The deck's own remembered height resolves
        // it without waiting: it's a real measurement from the last time
        // this exact turn was fully rendered, not a guess about now.
        const permanentlyEmpty = !hasContent &&
            (() => { const h = lastKnownHeightPx(container); return h !== null && h <= EMPTY_BUBBLE_HEIGHT_CEILING; })();
        const ready = (hasContent || permanentlyEmpty) && summary.placeholders === 0 && imagesHaveSrc;
        const reason = permanentlyEmpty
            ? 'ready (permanently empty by design)'
            : !hasContent
                ? 'no text or image'
                : summary.placeholders > 0
                    ? `${summary.placeholders} placeholder(s)`
                    : !imagesHaveSrc
                        ? 'image without src'
                        : 'ready';
        return { ready, reason, summary, imageSrcs };
    }
    function dumpElementStructure(root) {
        const lines = [];
        const walk = (el, depth) => {
            if (lines.length >= 60) return; // cap — this is a diagnostic, not a full serialization
            const bg = getComputedStyle(el).backgroundImage;
            const cls = (el.className || '').toString().slice(0, 60);
            const id = el.id ? ` id="${el.id}"` : '';
            const bgNote = bg && bg !== 'none' ? ` [background-image: ${bg.slice(0, 80)}]` : '';
            lines.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${id} class="${cls}">${bgNote}`);
            for (const child of el.children) walk(child, depth + 1);
        };
        walk(root, 0);
        return lines.join('\n');
    }
    
    // How much light must stay ahead of current, beyond the bare minimum,
    // expressed as a fraction of the viewport's own height so it scales
    // with whatever clientHeight actually is.
    const WORK_ZONE_MARGIN_FRACTION = 0.1;
    
    // How far a triggered move advances, separate from WORK_ZONE_MARGIN_FRACTION
    // (which only decides *when* a move triggers). Expressed as a fraction of
    // clientH: this is how much fresh room past current the move aims to
    // create. 1.0 would put current's leading edge exactly on the new work
    // zone's edge (no overlap at all, current effectively out of view) — not
    // a real option, since current needs to stay genuinely inside the new
    // viewport, not just at its boundary. The default keeps the move more
    // conservative: advance until current has about half a viewport of room
    // ahead, unless the explicit slab lookahead minimum needs more.
    // maintainWorkZone takes this as an overridable parameter (not just a constant) so
    // different advance strategies — this maximal one, a minimal
    // "just enough room past the trigger margin" one, or anything between —
    // can be experimented with from call sites without touching this function.
    const WORK_ZONE_ADVANCE_FRACTION = 0.5;
    
    // A single large, blind scrollTop jump has no guarantee ChatGPT's own
    // virtualizer reacts to it — ordinary incremental scrolling (wheel,
    // trackpad) is the one interaction pattern it must support reliably,
    // since that's the default way every real user scrolls. So the work
    // zone starts with a conservative wheel-like step, then earns larger
    // steps as jumps come back clean. This keeps the default interaction
    // human-like while letting clean runs discover a larger safe buffer
    // ahead of the viewport.
    //
    // Calibration state machine: the jump size lives on a ladder of 60px
    // states (360, 420, 480, ..., WORK_ZONE_MOVE_JUMP_MAX_PX). A clean jump
    // advances one state immediately — no streak requirement, the jump size
    // alone is the calibration state and fully determines what happens
    // next. A failed jump is fatal (no automatic retry — see
    // maintainWorkZone) but first retreats WORK_ZONE_MOVE_JUMP_RETREAT_STATES
    // states (2 × 60px = 120px) rather than collapsing all the way back to
    // the floor, floored at WORK_ZONE_MOVE_JUMP_PX, so the size is already
    // smaller by the time the user manually retries via the panel's Restart
    // button.
    const WORK_ZONE_MOVE_JUMP_PX = 360;
    const WORK_ZONE_MOVE_JUMP_MAX_PX =720;
    const WORK_ZONE_MOVE_JUMP_GROW_PX = 60;
    const WORK_ZONE_MOVE_JUMP_RETREAT_STATES = 2;
    // Diagnostic threshold for tiny final target clamps. The jump logic no
    // longer floors these values: if the calibrated jump would cross the
    // work-zone target, the final jump is exactly the remaining distance to
    // that target. This threshold only counts how often the old anti-near-hang
    // floor would have changed behavior.
    const WORK_ZONE_TINY_TARGET_CLAMP_PX = 8;
    // A room-prediction check used to live here: compare room after a jump
    // to roomBeforeJump + appliedJumpPx, flag a mismatch beyond a tolerance
    // as a failure. Removed — the outcome of our own scripted jump isn't
    // something we can predict in the first place. ChatGPT's own reactive
    // behavior (the same "stay near the latest content" correction
    // forceScrollToEdge already has to fight) can move things by an amount
    // unrelated to appliedJumpPx as completely normal operation, not a
    // fault. current.geometryElement getting detached (all-zero rect)
    // stays checked — that's a structural fact (is it in the document or
    // not), not a comparison against a number we made up. See
    // maintainWorkZone's cleanJump for where this is actually used.
    let _workZoneAdaptiveJumpPx = WORK_ZONE_MOVE_JUMP_PX;
    
    // Visual aid for video-recording a real run, nothing more — a small,
    // fixed-position dot, persistent for the whole run (created once,
    // never removed/recreated mid-run), that just toggles color: green by
    // default, light blue for exactly the real, unmodified duration of
    // waitForLayoutStable's own wait (set right after the jump's
    // synchronous scroll assignment, cleared right when room is
    // re-measured after that wait resolves — no added delay of any kind,
    // since adding delay is never behavior-neutral in a loop this timing-
    // sensitive — see memory). The viewport visibly jumping is the cue
    // for "about to turn light blue." Any other visible movement seen while the
    // dot is green — i.e. not during that real wait — is then direct,
    // unambiguous visual evidence that "stable" was declared too early
    // (or that something moved for a reason that has nothing to do with
    // our own jump at all): the dot's color is exactly synced to real
    // waitForLayoutStable timing, with nothing of ours added or removed
    // from that timing to produce it. Fixed position, high z-index,
    // pointer-events:none, no text/animation, so showing it costs nothing
    // and can't interfere with anything being filmed.
    let _stabilizationMarkerEl = null;
    function setStabilizationMarkerColor(color) {
        if (!_stabilizationMarkerEl) {
            _stabilizationMarkerEl = document.createElement('div');
            Object.assign(_stabilizationMarkerEl.style, {
                position: 'fixed', top: '10px', right: '10px', width: '18px', height: '18px',
                borderRadius: '50%', boxShadow: '0 0 0 2px #fff, 0 0 6px rgba(0,0,0,0.5)',
                zIndex: '2147483647', pointerEvents: 'none',
            });
            document.body.appendChild(_stabilizationMarkerEl);
        }
        _stabilizationMarkerEl.style.background = color;
    }
    function removeStabilizationMarker() {
        if (_stabilizationMarkerEl) {
            _stabilizationMarkerEl.remove();
            _stabilizationMarkerEl = null;
        }
    }
    
    // Set by every setPos (maintainWorkZone and forceScrollToEdge) right
    // when we ourselves assign scrollTop/scrollY — the one fact the
    // background sampler below needs to tell "we just moved this" apart
    // from "something else moved it." null until the very first scripted
    // jump of the run.
    let _lastIntentionalScrollPos = null;
    
    // Confirmed live: movement does happen with no dot showing at all —
    // more than once in a single green period. This watches for it
    // without repeating the earlier mistake (see memory: delay is never
    // behavior-neutral). It's a requestAnimationFrame loop the main walk
    // never awaits — nothing here can hold up or reorder anything the
    // extraction actually does, since the main loop never once looks at
    // this loop's progress or result. getCurrent is a closure over run()'s
    // own `current` binding (passed in, not copied), so this always reads
    // whatever current actually is at that instant, with no separate
    // module-level variable to keep manually in sync at every one of the
    // several places `current` gets reassigned. Logged to the same
    // roomDriftLog as everything else, with the marker's own current
    // color included, so a movement can be directly checked against
    // whether it happened during light blue, green, or (if this fires between
    // current changing and the marker's own next color change) neither.
    let _samplerRunning = false;
    function startBackgroundPositionSampler(getCurrent, container) {}

    function stopBackgroundPositionSampler() {
        _samplerRunning = false;
    }
    
    // maintainWorkZone's per-step pacing gate (see waitForLayoutStable):
    // how many consecutive animation frames scrollHeight must hold still
    // for before the next step is allowed to fire, and the hard cap on how
    // long any single step will wait for that before giving up and moving
    // on anyway. First real full run (174/174 prompts, 2801 total steps):
    // only 319 steps (~11%) ever saw any change at all across every frame
    // checked — the other ~89% paid the full multi-frame requirement for
    // nothing. Dropped from 3 to 1: a single clean frame already is what
    // distinguishes the "nothing happening" majority from the "something
    // changed" minority (which resets the counter regardless of what this
    // value is) — there's no evidence in that run that requiring more
    // consecutive confirmations ever caught a real multi-frame wobble.
    const WORK_ZONE_JUMP_STABLE_FRAMES = 1;
    const WORK_ZONE_JUMP_STABLE_MAX_MS = 1500;
    // Retrying a *short* wait several times (the first version of this)
    // turned out to be the wrong shape for the problem. The reason isn't
    // just "give it more chances" — it's that maintainWorkZone's whole
    // stepping model depends on knowing the real, settled room value
    // before it can decide anything about the next step: if the viewport
    // (or content around current) genuinely drifted while we weren't
    // looking, the stabilized state IS the new ground truth current must
    // be measured against, not a number we can route around. So there are
    // only two honest outcomes for a timeout: wait for an actual settled
    // value, or fail and say why. A handful of repeats of the same short
    // 1500ms window doesn't really do either — if the cause is
    // backgrounding, requestAnimationFrame stays throttled across retries
    // too, so most or all of them just burn the same dead time again.
    // What's actually known to throttle rAF is the tab being hidden
    // (document.hidden — see the existing visibilitychange listener in
    // run()), which is directly, cheaply checkable. So: a "pure" timeout
    // (timedOut, neither sawSandwiched nor detached) that happened while
    // the tab was hidden at some point during the wait gets exactly one
    // retry, with the deadline extended to WORK_ZONE_JUMP_HIDDEN_RETRY_MS —
    // long enough for even a heavily-throttled rAF to tick a meaningful
    // number of times. A pure timeout with no such explanatory sign just
    // fails immediately; waiting longer with no reason to expect anything
    // different is not the same thing as waiting for a real value.
    //
    // document.hidden is only the one delay-explaining sign known and
    // checkable today — the structure here (check signs, extend once if
    // any apply, otherwise fail) is meant to take more without rework if
    // other such signs turn up later.
    const WORK_ZONE_JUMP_HIDDEN_RETRY_MS = SLAB_FINISH_TIMEOUT_MS; // reuse the existing "give it a real, generous chance" duration rather than invent a new one
    // Safety net for the per-jump current+precedent+subsequent outerHTML
    // capture in maintainWorkZone — bounds the .html export's size on a
    // long/complete run, not a deliberate sample size. Each jump captured
    // is 2 entries (right-after-jump, after-wait), each bundling up to 3
    // real deck snapshots, so this is already generous before the export
    // gets unwieldy.
    const WORK_ZONE_JUMP_SNAPSHOT_CAP = 150;
    
    // waitForLayoutStable's scrollHeight check can only ever catch a mount
    // that changes the *total* document height. ChatGPT pre-reserves exact
    // pixel height for a turn before its real content mounts (the
    // `--last-known-height` custom property observed on deck containers in
    // captured page HTML elsewhere in this project) — so swapping a
    // placeholder for real content inside an already-correctly-sized box
    // changes nothing about scrollHeight at all. "scrollHeight hasn't
    // moved" is therefore not the same claim as "nothing is happening."
    // Confirmed directly via screen recording of a real run: a deck with
    // no real slab selector match yet, sitting between two decks that
    // already have one — lasting up to ~5 video frames (real-time
    // duration unknown; see workZoneJumpStability.sandwichedEmptyExamples'
    // framesWaited for how that maps to rAF frames once measured). The
    // neighbor requirement (not just "any blank deck in the viewport") is
    // what makes this safe to use where the reverted findBlankDeckInViewport
    // wasn't (see memory): that one had no way to tell "still
    // transitioning" apart from "permanently broken" (a deck that will
    // never render, like turnId 70e7d42f, also looks blank forever). A
    // permanently-broken deck can still happen to satisfy this stricter
    // pattern if both neighbors are real — this narrows the classification
    // problem, it doesn't solve it — so it's used the same non-fatal,
    // bounded way as everything else downstream (Step 3's fingerprint wait
    // already has to make this same judgment call, for the same reason).
    function findSandwichedEmptySlabInViewport(container) {
        const viewTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
        const viewBottom = viewTop + (container === document.documentElement ? window.innerHeight : container.clientHeight);
        const decks = queryDeckSequenceContainers();
        const hasRealSlab = deckEl => !!deckEl.querySelector(
            '[data-message-author-role], [id^="textdoc-message-"], .group\\/imagegen-image'
        );
        for (let i = 1; i < decks.length - 1; i++) {
            const deckEl = decks[i];
            const r = deckEl.getBoundingClientRect();
            if (r.bottom <= viewTop || r.top >= viewBottom) continue; // not actually in the viewport
            if (hasRealSlab(deckEl)) continue; // not empty
            if (!hasRealSlab(decks[i - 1]) || !hasRealSlab(decks[i + 1])) continue; // not sandwiched between two real ones
            const sectionEl = deckEl.matches('[data-turn]') ? deckEl : deckEl.querySelector('[data-turn]');
            return { deckEl, sectionEl };
        }
        return null;
    }
    
    // Diagnostic captures only need enough to identify *what* was there —
    // the container's own identity (its tag + attributes: turn-id, role,
    // etc.) plus the first real message's identity inside it — not the
    // full nested content. A single deck can hold multiple stacked
    // messages plus a large code block (confirmed live: turnId
    // 78a011c7-...  ran to several KB of outerHTML on its own, just from
    // one deck), which is exactly what made captures balloon in size. This
    // builds opening tags from el.attributes directly (not by slicing
    // outerHTML as a string, which a stray '>' inside a quoted attribute
    // value could throw off) and immediately self-closes them — so a
    // capture is always well-formed, empty-bodied markup, never the real
    // content, and never leaves an unclosed tag that would swallow
    // whatever capture comes after it once many of these are concatenated
    // into one .html document.
    function elementIdentityTag(el) {
        const attrs = [...el.attributes].map(a => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' ');
        const tag = el.tagName.toLowerCase();
        return `<${tag}${attrs ? ' ' + attrs : ''}></${tag}>`;
    }
    
    function selfAndDescendantsMatching(el, selector) {
        const found = [];
        if (el.matches?.(selector)) found.push(el);
        found.push(...(el.querySelectorAll?.(selector) || []));
        return found;
    }
    
    function firstCapturedSlab(el) {
        const slabs = [
            ...selfAndDescendantsMatching(el, '[data-message-author-role]').map(element => ({ type: 'message', element })),
            ...selfAndDescendantsMatching(el, '[id^="textdoc-message-"]').map(element => ({ type: 'canvas', element })),
            ...selfAndDescendantsMatching(el, '.group\\/imagegen-image').map(element => ({ type: 'image', element })),
        ];
        if (!slabs.length) return null;
        slabs.sort((a, b) => {
            if (a.element === b.element) return 0;
            const pos = a.element.compareDocumentPosition(b.element);
            return pos & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
        });
        return slabs[0];
    }
    
    function firstSentence(text, maxLen = 180) {
        const flat = (text || '').replace(/\s+/g, ' ').trim();
        if (!flat) return '';
        const sentence = flat.match(/^(.+?[.!?])(?:\s|$)/)?.[1] || flat;
        return sentence.length > maxLen ? sentence.slice(0, maxLen - 1).trimEnd() + '…' : sentence;
    }
    
    function firstSlabPreviewHtml(slab) {
        if (!slab) return '';
        if (slab.type === 'message') {
            const sentence = firstSentence(dryMarkdownFor(slab.element));
            return sentence
                ? `<div data-first-slab-preview="message">${escHtmlText(sentence)}</div>`
                : `<div data-first-slab-preview="message">(empty message preview)</div>`;
        }
        if (slab.type === 'image') {
            const image = primaryImageForSlab(slab.element);
            const src = image?.getAttribute('src') || '';
            const alt = image?.getAttribute('alt') || 'Generated image';
            return src
                ? `<div data-first-slab-preview="image"><a href="${escHtmlAttr(src)}">Image: ${escHtmlText(firstSentence(alt, 80) || 'Generated image')}</a></div>`
                : `<div data-first-slab-preview="image">Image: ${escHtmlText(firstSentence(alt, 80) || 'Generated image')}</div>`;
        }
        if (slab.type === 'canvas') {
            const titleEl = slab.element.querySelector('span.font-semibold, [class*="font-semibold"]');
            const title = (titleEl?.textContent || 'Canvas document').trim();
            return `<div data-first-slab-preview="canvas"><a href="#">Canvas: ${escHtmlText(firstSentence(title, 120) || 'Canvas document')}</a></div>`;
        }
        return '';
    }
    
    function trimmedCaptureHtml(el) {
        if (!el) return '(no element reference captured)';
        const parts = [elementIdentityTag(el)];
        const firstSlab = firstCapturedSlab(el);
        if (firstSlab && firstSlab.element !== el) {
            parts.push(elementIdentityTag(firstSlab.element));
        }
        const preview = firstSlabPreviewHtml(firstSlab);
        if (preview) parts.push(preview);
        return parts.join('\n');
    }
    
    // Diagnostic only — ground truth in place of geometry inference. A
    // numeric room/scrollMax delta after a move can't be trusted to mean
    // any one specific thing: any number of unrelated DOM changes could
    // produce the same numbers, and reverse-engineering a story from them
    // (see memory: the v4.142/v4.143 incident) is not reliable. The actual
    // identity of whatever's intersecting the viewport right after a
    // move's last step is real, checkable evidence instead — captured once
    // per completed maintainWorkZone call (not per step) and fed to
    // pushHtmlCaptures below, which is what actually accumulates it for the
    // separate .html export — this function just collects, it doesn't
    // format or store.
    function capturedIntersectingDecksHtml(container) {
        const viewTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
        const viewBottom = viewTop + (container === document.documentElement ? window.innerHeight : container.clientHeight);
        const captured = [];
        for (const deckEl of queryDeckSequenceContainers()) {
            const r = deckEl.getBoundingClientRect();
            if (r.bottom <= viewTop || r.top >= viewBottom) continue; // not actually in the viewport
            const sectionEl = deckEl.matches('[data-turn]') ? deckEl : deckEl.querySelector('[data-turn]');
            captured.push({
                turnId: deckSequenceId(deckEl) || '(none)',
                role: sectionEl?.getAttribute('data-turn') || deckEl.getAttribute('data-turn') || 'unknown',
                html: trimmedCaptureHtml(sectionEl || deckEl),
            });
        }
        return captured;
    }
    
    // Feeds _htmlCaptures, the accumulator behind the separate .html export
    // (see exportMarkdown) — real captured markup goes there now, not
    // inline in the markdown text, per the user's direction: keep the two
    // exports separate so the markdown stays clean and the HTML can
    // actually be opened and viewed rendered. `label` distinguishes the
    // capture's origin (deck-entry / work-zone-move / work-zone-fatal) for
    // the reader scanning the combined file later.
    function pushHtmlCaptures(label, captured) {
        for (const c of captured) _htmlCaptures.push({ label, ...c });
    }
    
    function captureElementHtmlReference(label, el, role = 'unknown', turnId = null) {
        if (!el) return '(no element reference captured)';
        const resolvedTurnId = turnId || deckSequenceId(el) || el.getAttribute?.('data-turn-id') || '(none)';
        _htmlCaptures.push({
            label,
            turnId: resolvedTurnId,
            role: role || el.getAttribute?.('data-turn') || el.getAttribute?.('data-message-author-role') || 'unknown',
            html: trimmedCaptureHtml(el),
        });
        return `Captured HTML: see companion .html snapshot #${_htmlCaptures.length} ` +
            `(label=${label}, turnId=${resolvedTurnId}).`;
    }
    
    // The same isConnected test describeCurrentAttachment uses for its
    // diagnostic string, factored out as a boolean so waitForLayoutStable
    // can act on it, not just report it. A real slab's geometryElement is
    // an actual DOM node, so isConnected is meaningful directly. The
    // deck-entry/deck-exit synthetic markers (see makeDeckEntryCurrent/
    // makeDeckExitCurrent) hand back a plain object with a
    // getBoundingClientRect method but no isConnected of its own — for
    // those, the thing that could actually get unmounted is the deck
    // element they wrap, so that's what's checked instead.
    function isCurrentDetached(current) {
        if (current?.geometryElement && 'isConnected' in current.geometryElement) {
            return !current.geometryElement.isConnected;
        }
        if (current?.deckElement) return !current.deckElement.isConnected;
        return false; // nothing real to check against (e.g. SLAB_WALK_START) — never reaches the work-zone loop anyway
    }
    
    // Per-step pacing signal for maintainWorkZone's stepping loop: waits for
    // the container's scrollHeight to stop changing across a few consecutive animation
    // frames, AND for no sandwiched-empty-slab to be present (see
    // findSandwichedEmptySlabInViewport just above — this is the part that
    // actually targets "ChatGPT busy mid-swap," which scrollHeight alone
    // can't see), before the next step is allowed to fire. Just yielding a
    // fixed number of frames (the original version of this, before the
    // sandwiched-empty check existed) only proved the small jumps land as
    // separate scroll events instead of being coalesced into one teleport —
    // it said nothing about whether ChatGPT's virtualizer had actually
    // reacted to what each step revealed before the next one ran past it,
    // which is the same gap that made the original one-big-jump activation
    // unreliable in the first place. Bounded by WORK_ZONE_JUMP_STABLE_MAX_MS
    // so a page with continuous, unrelated layout churn (or a permanently-
    // broken sandwiched deck — see findSandwichedEmptySlabInViewport) can't
    // hang a single step forever.
    function attemptLayoutStable(container, current, maxMs = WORK_ZONE_JUMP_STABLE_MAX_MS) {
        const readHeight = () => container === document.documentElement
            ? document.documentElement.scrollHeight
            : container.scrollHeight;
        return new Promise(resolve => {
            const deadline = performance.now() + maxMs;
            let lastHeight = readHeight();
            let stableFrames = 0;
            let framesChecked = 0;
            let changed = false;
            let sawSandwiched = false;
            let lastSandwiched = null;
            let detached = false;
            let wasHidden = document.hidden;
            function tick() {
                framesChecked++;
                if (document.hidden) wasHidden = true; // sticky: even a brief hide during this wait can explain a stall
                const h = readHeight();
                if (h === lastHeight) {
                    stableFrames++;
                } else {
                    stableFrames = 0;
                    lastHeight = h;
                    changed = true;
                }
                const timedOut = performance.now() > deadline;
                // Both checks below only make sense once the frame itself
                // has settled (or we're out of patience) — there's nothing
                // to learn from either one before that point, since the
                // page is still mid-change. findSandwichedEmptySlabInViewport
                // also scans every deck in the whole document and calls
                // getBoundingClientRect() on each one — real, forced-layout
                // cost that scales with conversation length — so checking
                // only here, instead of every frame, avoids paying that
                // dozens of times per step for no benefit too.
                let readyToResolve = stableFrames >= WORK_ZONE_JUMP_STABLE_FRAMES || timedOut;
                if (readyToResolve) {
                    // Detachment is checked first and is decisive the
                    // instant it's seen: unlike the sandwiched-empty pattern
                    // below, it is not a transient rendering state that more
                    // waiting at this same scroll position could resolve —
                    // it means the jump pushed current's element far enough
                    // behind the viewport that ChatGPT's virtualizer
                    // unmounted it (see the calibrated-jump boundary comment and
                    // isCurrentDetached). No point also paying for the
                    // sandwiched-empty scan in that case.
                    detached = isCurrentDetached(current);
                    const sandwiched = detached ? null : findSandwichedEmptySlabInViewport(container);
                    // A deck stays "sandwiched" in the viewport across many
                    // consecutive small steps (each only 120px) — once one
                    // has already been waited out the full cap this run
                    // without resolving (see _knownUnresolvableSandwichedTurnIds),
                    // re-discovering and re-waiting on the *same* deck on
                    // every subsequent step is pure waste, not added safety.
                    const sandwichedTurnId = sandwiched ? deckSequenceId(sandwiched.deckEl) : null;
                    const alreadyKnownUnresolvable = sandwichedTurnId && _knownUnresolvableSandwichedTurnIds.has(sandwichedTurnId);
                    if (sandwiched && !alreadyKnownUnresolvable) {
                        sawSandwiched = true;
                        lastSandwiched = sandwiched;
                        stableFrames = 0; // not actually settled — keep waiting
                        readyToResolve = timedOut; // still finalize on timeout even if found
                    }
                }
                if (readyToResolve) {
                    if (sawSandwiched) {
                        if (timedOut && lastSandwiched) {
                            const role = lastSandwiched.sectionEl?.getAttribute('data-turn') ||
                                lastSandwiched.deckEl.getAttribute('data-turn') || 'unknown';
                            const tId = deckSequenceId(lastSandwiched.deckEl);
                            // Never wait the full cap on this exact deck
                            // again this run (see _knownUnresolvableSandwichedTurnIds)
                            // — and capture its real markup so "permanently
                            // broken" is something the user can actually
                            // verify in the .html export, not just infer
                            // from a 100% cap-out rate.
                            if (tId) _knownUnresolvableSandwichedTurnIds.add(tId);
                            pushHtmlCaptures('sandwiched-empty-timed-out', [{
                                turnId: tId || '(none)',
                                role,
                                html: trimmedCaptureHtml(lastSandwiched.sectionEl || lastSandwiched.deckEl),
                            }]);
                        }
                    }
                    resolve({ changed, timedOut, sawSandwiched, detached, wasHidden, framesChecked });
                } else {
                    requestAnimationFrame(tick);
                }
            }
            requestAnimationFrame(tick);
        });
    }
    
    // Wraps attemptLayoutStable per WORK_ZONE_JUMP_HIDDEN_RETRY_MS's
    // comment: a "pure" timeout (neither sawSandwiched nor detached) is
    // retried — once, with a much longer deadline, not several times with
    // the same short one — only when document.hidden explains why the
    // wait might not have reflected reality. With no such sign, there is
    // no positive reason to expect a retry to behave any differently, so
    // it fails immediately instead of guessing. Reported either way, not
    // silent: this is meant to be visible evidence of how often this
    // actually happens, not a safety net to hide it.
    async function waitForLayoutStable(container, current) {
        const result = await attemptLayoutStable(container, current);
        if (!result.timedOut || result.sawSandwiched || result.detached) return { ...result, hiddenRetried: false };
        if (!result.wasHidden) return { ...result, hiddenRetried: false }; // no explanatory sign — nothing to gain by waiting again
        const retried = await attemptLayoutStable(container, current, WORK_ZONE_JUMP_HIDDEN_RETRY_MS);
        if (retried.timedOut && !retried.sawSandwiched && !retried.detached) {
        }
        return { ...retried, hiddenRetried: true };
    }
    
    // Forces the scroll position to a boundary edge (bottom for direction=-1,
    // top for +1) and keeps re-asserting it until it actually holds — a
    // one-time assignment isn't enough. Observed live: clicking the
    // correctly-labeled "Prompt 1" nav dot produced 54s of genuine scroll
    // activity (not a no-op) that nonetheless settled back at the opposite
    // edge — something (most likely ChatGPT's own "stay near the latest
    // content" behavior) was actively reverting it. A plain "wait until it
    // stops moving" can't distinguish "stopped because it arrived" from
    // "stopped because something pulled it back," so this re-issues the
    // target on every check instead of trusting one assignment.
    // Requiring several consecutive checks to agree (not just one) also
    // means continuously re-asserting can outlast a reversion that only
    // fires after some idle period — never giving it the chance.
    async function forceScrollToEdge(container, direction, timeoutMs = 30_000) {
        const readPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
        const setPos = v => {
            if (container === document.documentElement) window.scrollTo({ top: v, behavior: 'instant' });
            else container.scrollTop = v;
            _lastIntentionalScrollPos = v;
        };
        const target = () => {
            const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            const clientH = container === document.documentElement ? window.innerHeight : container.clientHeight;
            return direction === -1 ? scrollH - clientH : 0;
        };
        const deadline = Date.now() + timeoutMs;
        let stableCount = 0;
        const STABLE_NEEDED = 3;
        while (true) {
            const t = target();
            setPos(t);
            await sleep(150);
            const achieved = readPos();
            if (Math.abs(achieved - t) <= 2) {
                stableCount++;
                if (stableCount >= STABLE_NEEDED) return;
            } else {
                stableCount = 0;
            }
            if (Date.now() > deadline) {
                throw new Error(
                    `Could not hold the scroll position at the ${direction === -1 ? 'bottom' : 'top'} edge within ` +
                    `${timeoutMs / 1000}s (target=${Math.round(t)}, last achieved=${Math.round(achieved)}) — ` +
                    `something is repeatedly reverting it, not just slow to settle.`
                );
            }
        }
    }
    
    // Checked once per slab-selection attempt, before any search runs —
    // the decision lives at the slab level, not tied to any particular
    // deck's own readiness fingerprint. current's leading edge (the side
    // facing unexplored territory) only ever advances, one slab at a time;
    // the work zone's own leading edge stays exactly where it is until
    // this moves it. So current's advance is guaranteed to eventually
    // close the gap down to the margin — that moment is what triggers a
    // move, never a deck's fingerprint. *Whether* to move (room <= extra)
    // is unchanged from the original design. *How far* it tries to advance
    // is the advanceFraction parameter (see WORK_ZONE_ADVANCE_FRACTION) —
    // independent of the trigger margin and deliberately overridable, so
    // call sites can experiment with maximal-jump vs just-enough-room
    // advance strategies without touching this function.
    //
    // There used to be a separate "move to a precomputed target, then
    // separately wait/poll for room" two-phase design (moveWorkZoneTo +
    // a doubleRAF-paced settle loop — see memory). That fell apart on a
    // real run: a precomputed target/scrollMax snapshot can go stale
    // during the time spent reaching and then waiting on it (layout above
    // current shifting by 1000+px mid-wait, see memory), and the doubleRAF
    // settle phase had zero stability awareness of its own — it just
    // polled a number with no way to tell "still genuinely converging"
    // from "stuck." This version is one continuous loop instead: take one
    // small step toward more room, wait for it via the same
    // waitForLayoutStable used everywhere else (browser+ChatGPT-stability,
    // not just a frame count), re-measure room live, and decide whether to
    // take another step — never computing a destination in advance, never
    // trusting any position/height snapshot beyond the instant it was read.
    async function maintainWorkZone(container, current, minimumRoomAhead = 0, advanceFraction = WORK_ZONE_ADVANCE_FRACTION) {
        if (current.type === 'start') return { roomSatisfied: true, boundaryReached: false, room: Infinity, required: 0 }; // no deck/slab reference yet
        const readPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
        const setPos = v => {
            if (container === document.documentElement) window.scrollTo({ top: v, behavior: 'instant' });
            else container.scrollTop = v;
            _lastIntentionalScrollPos = v;
        };
        const clientH = container === document.documentElement ? window.innerHeight : container.clientHeight;
        // Room ahead of current, read fresh from the live DOM every single
        // time this is called — never cached, never reused across a step.
        // This used to read containerTop once, outside this function, and
        // reuse that snapshot for every jump in the whole call — directly
        // contradicting this comment's own claim. If container isn't
        // document.documentElement (findScrollContainer can return a
        // nested scrollable div), its own position on the page is exactly
        // as capable of drifting mid-call (a header, banner, or the
        // composer box changing height) as anything else here. Reading it
        // fresh on every call closes that gap; if container really is
        // document.documentElement this costs nothing extra and always
        // yields exactly 0.
        const liveContainerTop = () => container === document.documentElement ? 0 : container.getBoundingClientRect().top;
        const measureRoom = () => {
            const containerTop = liveContainerTop();
            const r = current.geometryElement.getBoundingClientRect();
            return WALK_DIRECTION === -1 ? (r.top - containerTop) : (clientH - (r.bottom - containerTop));
        };
        const liveScrollMax = () => {
            const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            return Math.max(0, scrollH - clientH);
        };
        const extra = Math.max(clientH * WORK_ZONE_MARGIN_FRACTION, minimumRoomAhead);
        let room = measureRoom();
        if (room > extra) return { roomSatisfied: true, boundaryReached: false, room, required: extra }; // still plenty of light ahead of current
        // advanceRoom is aspirational, not a destination to walk straight
        // to and stop at: how much fresh room past current we'd like to
        // end up with if nothing stops us, floored at `extra` (a step that
        // didn't even clear the trigger margin wouldn't be worth taking)
        // and capped just short of clientH (current must stay genuinely
        // inside the viewport, not sit exactly on its edge). The loop below
        // keeps stepping toward this, but is content to stop as soon as
        // `extra` is cleared if it runs out of patience or room first —
        // exactly the same bar the original design judged success against.
        const advanceRoom = Math.min(clientH - 1, Math.max(extra, clientH * advanceFraction));
        const jumpSign = WALK_DIRECTION === -1 ? -1 : 1; // direction of scrollTop change that increases room
        const startedAt = performance.now();
        const deadline = Date.now() + SLAB_FINISH_TIMEOUT_MS;
        let boundaryReached = false;
        let jumpsTaken = 0;
        let outcome = 'advance-complete'; // overwritten below if the loop exits any other way

        // ── moveWorkZone geometric sub-functions ─────────────────────────
        // Phase 1: thin wrappers over the existing jump geometry so the loop
        // body reads as the architecture. No algorithmic change — every line
        // inside each wrapper is the existing code, just named and grouped.

        // Returns the safe jump in px, or null to signal "already past the
        // trigger minimum — skip the sub-pixel final approach."
        function clampJump(room) {
            // The calibrated jump is used in full whenever it would still
            // leave current before advanceRoom. Only the final approach is
            // clamped, to keep current genuinely inside the viewport.
            // Without this boundary a grown jump can take current fully
            // behind the viewport in one leap, causing detachment (observed:
            // 30 s timeout with room stuck at 0 across 101 jumps).
            const remainingToAdvanceRoom = advanceRoom - room;
            if (remainingToAdvanceRoom < WORK_ZONE_TINY_TARGET_CLAMP_PX && room > extra) return null;
            return room + _workZoneAdaptiveJumpPx < advanceRoom
                ? _workZoneAdaptiveJumpPx
                : remainingToAdvanceRoom;
        }

        // Performs the scroll jump. Returns { hitBoundary: true } when the
        // viewport is already at the document edge and can't move further;
        // sets boundaryReached (closure) when the jump reaches that edge.
        function performJump(safeJumpPx) {
            const curTop = readPos();
            const max = liveScrollMax(); // re-read live — scrollable range can shift mid-run
            const intendedPos = curTop + jumpSign * safeJumpPx;
            const hitScrollBoundary = jumpSign < 0 ? intendedPos <= 0 : intendedPos >= max;
            const nextPos = Math.max(0, Math.min(max, intendedPos));
            if (nextPos === curTop) {
                // Genuinely can't move any further — a real document-boundary
                // case, not a failure to retry against.
                return { hitBoundary: true };
            }
            if (hitScrollBoundary) boundaryReached = true;
            setPos(nextPos);
            jumpsTaken++;
            return { hitBoundary: false };
        }

        // Waits for the layout to stabilise after a jump. Returns the
        // stability object from waitForLayoutStable.
        async function waitLayoutStable() {
            setStabilizationMarkerColor('#5ac8fa');
            const stability = await waitForLayoutStable(container, current);
            await nextAnimationFrame();
            setStabilizationMarkerColor('#34c759');
            return stability;
        }

        // ── moveWorkZone loop ─────────────────────────────────────────────
        // No automatic retry here. A failure ends this run and surfaces one
        // complete diagnostic. Detached current is decisive evidence that
        // the jump was too aggressive, so it retreats the adaptive jump size
        // before stopping. Non-detached failures keep the live cursor and
        // offer a panel Resume instead of rebuilding from the conversation
        // edge or silently retrying inside this loop.
        while (room < advanceRoom) {
            if (room > extra && Date.now() > deadline) { outcome = 'satisfied-timeout'; break; } // good enough already, not worth chasing the aspirational extra any further
            if (room <= extra && Date.now() > deadline) {
                const waitedMs = Math.round(performance.now() - startedAt);
                // Numeric geometry (room/scrollMax deltas) isn't trustworthy
                // diagnostic evidence on its own — any number of unrelated
                // DOM changes could produce the same numbers (see memory).
                // The outerHTML of whatever's actually intersecting the
                // viewport right now is real, checkable ground truth
                // instead — captured to the separate .html export (not
                // inlined into this message) so the markdown stays clean.
                pushHtmlCaptures('work-zone-fatal-timeout', capturedIntersectingDecksHtml(container));
                // Not retreating the jump size here: the overall deadline is
                // a cumulative-time signal, not one correlated specifically
                // with the jump size just used (unlike timedOut/
                // sawSandwiched/detached, each checked once per jump — see
                // cleanJump below), so there's no evidence here that a
                // smaller size would even help next time.
                const message =
                    `Timed out after ${SLAB_FINISH_TIMEOUT_MS / 1000}s stepping toward work-zone room ahead of current ` +
                    `(${jumpsTaken} small step(s) taken, room=${Math.round(room)}px, required=${Math.round(extra)}px, ` +
                    `boundaryReached=${boundaryReached}). ${describeCurrentAttachment(current)}. ` +
                    `See the separate .html export for the intersecting deck(s) captured at this moment.`;
                const err = new Error(message);
                err.placeholder = currentNotePlaceholder(current, message);
                err.resumeFromCurrent = !isCurrentDetached(current);
                throw err;
            }

            const safeJumpPx = clampJump(room);
            if (safeJumpPx === null) break;

            const { hitBoundary } = performJump(safeJumpPx);
            if (hitBoundary) { boundaryReached = true; outcome = 'boundary'; break; }

            const stability = await waitLayoutStable();
            room = measureRoom();

            if (boundaryReached) {
                outcome = 'boundary';
                break;
            }
            // "Clean" does not mean "nothing changed." Mounting newly
            // revealed content is exactly the normal case we are pacing for.
            // A jump is clean if the page reached a stable state without
            // hitting the per-jump cap, without seeing the stronger
            // sandwiched-empty signal, and without current having been
            // detached.
            const cleanJump = stability && !stability.timedOut && !stability.sawSandwiched && !stability.detached;
            if (cleanJump) {
                // Calibration state machine: jump size alone determines what
                // happens next, so a clean jump advances one 60px state
                // immediately — no streak gate.
                if (_workZoneAdaptiveJumpPx < WORK_ZONE_MOVE_JUMP_MAX_PX) {
                    _workZoneAdaptiveJumpPx = Math.min(WORK_ZONE_MOVE_JUMP_MAX_PX, _workZoneAdaptiveJumpPx + WORK_ZONE_MOVE_JUMP_GROW_PX);
                }
            } else {
                // Fatal, no in-loop retry. If current detached, retreat the
                // calibration state 2 steps (120px) from the size that just
                // failed — floored at the base, not a full collapse — so a
                // later fresh run starts smaller instead of repeating the
                // one that just failed. If current is still connected, keep
                // the calibration and let the panel offer Resume from this
                // cursor instead.
                //
                // This is a minor convenience, not load-bearing: the actual
                // fix is detecting the failure (above, via
                // stability.detached/sawSandwiched/timedOut) fast and
                // accurately. Without this retreat, a retry would just
                // restart at the floor and slowly regrow instead of
                // resuming near the size that failed — slower, never
                // wrong. If this ever gets in the way of keeping the code
                // simple, it can be deleted (along with run()'s matching
                // "deliberately not reset" comment) with nothing lost but
                // that bit of regrowth time.
                const reasonParts = [];
                if (stability?.detached) reasonParts.push('current detached (signature of a too-large jump)');
                if (stability?.sawSandwiched) reasonParts.push('sandwiched-empty deck still present');
                if (stability?.timedOut) {
                    reasonParts.push(
                        stability.hiddenRetried
                            ? `per-jump stability timeout (tab was hidden during the wait; still timed out after a ` +
                              `${WORK_ZONE_JUMP_HIDDEN_RETRY_MS / 1000}s retry)`
                            : stability.wasHidden
                            ? 'per-jump stability timeout (tab was hidden during the wait)'
                            : 'per-jump stability timeout'
                    );
                }
                if (!stability) reasonParts.push('stability check did not resolve');
                // Only detachment is actually evidence of a too-large jump
                // (a structural fact, not a comparison against a predicted
                // number — see the comment above cleanJump for why that
                // comparison was removed). sawSandwiched/timedOut alone,
                // with current still connected, is consistent instead with
                // the separate, already-documented sandwiched-empty-deck
                // gap (see findSandwichedEmptySlabInViewport / the exported
                // diag's "needs a readiness patch" note): ChatGPT hasn't
                // finished rendering this content yet, independent of jump
                // size. Confirmed live: a 540px jump (well under the old
                // 600px cap) failed this way with geometryElement.isConnected
                // still true — retreating the jump size would not have
                // been the fix there. Don't claim a confidence the
                // evidence doesn't support.
                const detachedCause = !!stability?.detached;
                const failedJumpPx = _workZoneAdaptiveJumpPx;
                if (detachedCause) {
                    _workZoneAdaptiveJumpPx = Math.max(
                        WORK_ZONE_MOVE_JUMP_PX,
                        _workZoneAdaptiveJumpPx - WORK_ZONE_MOVE_JUMP_RETREAT_STATES * WORK_ZONE_MOVE_JUMP_GROW_PX
                    );
                }
                pushHtmlCaptures('work-zone-jump-failed', capturedIntersectingDecksHtml(container));
                const explanation = detachedCause
                    ? `This looks like the jump itself pushing current too far behind the viewport for ChatGPT's ` +
                      `renderer to keep up — clicking Restart retries at the smaller ${_workZoneAdaptiveJumpPx}px and is likely to get past it.`
                    : `current is not detached, so this may not be a jump-size problem at all — it's consistent with ` +
                      `the known sandwiched-empty-deck/content-readiness gap (ChatGPT hasn't finished rendering this ` +
                      `content yet). The current slab is still connected, so Resume can continue from this cursor ` +
                      `instead of rebuilding from the conversation edge.`;
                const message =
                    `Work-zone jump (${failedJumpPx}px) failed: ${reasonParts.join(', ') || 'unknown'} ` +
                    `(${jumpsTaken} small step(s) taken this move, room=${Math.round(room)}px, required=${Math.round(extra)}px). ` +
                    `${describeCurrentAttachment(current)}. ${explanation} ` +
                    `See the separate .html export for the intersecting deck(s) captured at this moment.`;
                const err = new Error(message);
                err.placeholder = currentNotePlaceholder(current, message);
                err.resumeFromCurrent = !detachedCause;
                err.autoRestart = detachedCause;
                throw err;
            }
        }
        // Capture only when a move actually happened — most calls find
        // room > extra immediately above and return before this point.
        // Goes to the separate .html export (pushHtmlCaptures), not the
        // markdown — the markdown stays clean text, the real captured
        // markup lives in its own file. jumpsTaken/outcome are still
        // returned so the caller can log them live without needing the
        // capture itself.
        if (jumpsTaken > 0) {
            pushHtmlCaptures('work-zone-move', capturedIntersectingDecksHtml(container));
        }
        return { roomSatisfied: room > extra, boundaryReached, room, required: extra, jumpsTaken, outcome };
    }
    
    // current can be a real slab (element set) or a synthetic deck-entry/
    // deck-exit marker (element: null, only deckElement set) — this covers
    // both, the same way describeCurrentForStop already does, so a fatal
    // note about "current" never crashes on the synthetic case.
    function currentNotePlaceholder(current, reason) {
        const el = current?.element || current?.deckElement || null;
        const role = current?.element
            ? slabRole(current)
            : (current?.deckElement?.getAttribute('data-turn') || 'unknown');
        const turnId = current?.element
            ? slabTurnId(current)
            : (deckSequenceId(current?.deckElement) || null);
        return {
            role,
            text: `*[${reason}]*\n\n${captureElementHtmlReference('current-note-placeholder', el, role, turnId)}\n\n`,
            plainText: '[Work-zone move came up short]',
            msgId: null,
            turnId,
        };
    }
    
    // Direct test of two competing explanations for a stuck/broken current:
    // (a) current.geometryElement was detached — isConnected false on a real
    // (non-synthetic) slab; (b) ChatGPT's own readiness fingerprint
    // (data-is-intersecting on the [data-turn-id-container] deck — the same
    // attribute waitForTurnReady/measureReadyMargin already trust) still
    // reads "false", meaning we're sitting in not-yet-rendered placeholder
    // territory rather than current having been unmounted at all. Shared by
    // both the fatal-timeout throw and describeCurrentForStop — a broken
    // current can surface through either path (reaching a boundary while
    // room is still short exits via 'boundary', never hitting the timeout
    // throw at all).
    function describeCurrentAttachment(current) {
        const geometryIsConnected = (current?.geometryElement && 'isConnected' in current.geometryElement)
            ? current.geometryElement.isConnected
            : '(synthetic marker, n/a)';
        const deckEl = current?.deckElement || current?.element?.closest?.('[data-turn-id-container]') || null;
        const deckConnected = deckEl ? deckEl.isConnected : '(no deck found)';
        const deckFingerprint = deckEl
            ? (deckEl.hasAttribute('data-is-intersecting')
                ? deckEl.getAttribute('data-is-intersecting')
                : '(attribute absent — already considered ready)')
            : '(no deck found)';
        return `geometryElement.isConnected=${geometryIsConnected}, deck.isConnected=${deckConnected}, ` +
            `deck data-is-intersecting=${deckFingerprint}`;
    }
    
    function describeCurrentForStop(current, readyContainer) {
        const rect = current?.geometryElement?.getBoundingClientRect?.();
        return `current=${current?.type || '(none)'}/${current?.element ? slabRole(current) : '(synthetic)'}` +
            ` turnId=${current?.element ? (slabTurnId(current) || '(none)') : '(none)'}` +
            ` msgId=${current?.element ? (slabMessageId(current) || '(none)') : '(none)'}` +
            (rect ? ` rect=[top=${Math.round(rect.top)},bottom=${Math.round(rect.bottom)}]` : '') +
            ` deckId=${deckSequenceId(readyContainer) || '(none)'}` +
            ` ${describeCurrentAttachment(current)}`;
    }
    
    // Mechanism A — is the deck found by findNextDeck actually loaded?
    // ChatGPT's own lazy placeholder wrapper, [data-turn-id-container],
    // reports data-is-intersecting="false" while blank. Resolution is
    // intersection-driven, so only move the viewport if it's still blank
    // (moving it is purely to trigger that), then wait for it to clear.
    // Same 30s-then-fail discipline as everywhere else: trust the source,
    // but don't wait forever.
    // The work zone is moved exactly once per loop iteration — but that
    // move is an activation signal to the supplier (ChatGPT's own
    // virtualization), not a guarantee the deck is mounted the instant it
    // returns. The supplier's response is asynchronous and takes real
    // time. Waiting for it here is not a second movement attempt — nothing
    // in this loop ever scrolls — it's just observing the outcome of the
    // one request already made. Only genuine non-response within the
    // timeout is the real algorithm violation worth stopping on; nudging
    // or re-scrolling to force a response would be compensating for a
    // violation instead of surfacing it (the same silent leniency this
    // file has already been corrected away from once — see
    // finishDeckCoverage's history).
    async function waitForTurnReady(container, turnEl, timeoutMs = 30_000) {
        if (turnEl.getAttribute('data-is-intersecting') !== 'false') {
            return; // already resolved
        }
        const deadline = Date.now() + timeoutMs;
        while (turnEl.getAttribute('data-is-intersecting') === 'false') {
            if (!turnEl.isConnected)
                throw new Error('Target deck node detached from the document while waiting for it to mount — reacquire needed, not a timeout.');
            if (Date.now() > deadline) {
                const stillInViewport = isInViewport(container, turnEl);
                const r = turnEl.getBoundingClientRect();
                throw new Error(
                    `Unexpected: deck never mounted within ${Math.round(timeoutMs / 1000)}s of the work-zone move's ` +
                    `activation signal — data-is-intersecting="${turnEl.getAttribute('data-is-intersecting')}", in viewport ` +
                    `(script geometry)=${stillInViewport}, rect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]. ` +
                    `This is a deviation from the algorithm's invariant, not something more waiting would fix.`
                );
            }
            await sleep(100);
        }
    }
    
    // Geometry-model diagnostics below inspect ready decks in detail. The
    // traversal's real successor operation is separate and appears later:
    // findNextSlabInReadyDeck(deckEl, currentSlab).
    function shortestMountedMessageHeight() {
        const heights = [...document.querySelectorAll('[data-message-author-role]')]
            .map(el => el.getBoundingClientRect().height)
            .filter(h => h > 0);
        return heights.length ? Math.min(...heights) : SLAB_ADJACENCY_MAX_GAP;
    }
    
    function slabStackForMessageElement(messageEl) {
        const scope = messageEl.closest('[data-conversation-screenshot-content]');
        if (!scope) return null;
        return [...scope.children].find(child => child.contains(messageEl)) || null;
    }
    
    function slabItemForMessageElement(messageEl) {
        const stack = slabStackForMessageElement(messageEl);
        if (!stack) return null;
        return [...stack.children].find(child => child.contains(messageEl)) || null;
    }
    
    function slabScopeForMessageElement(el) {
        return slabItemForMessageElement(el) || el;
    }
    
    function rectSummary(rect) {
        return `top=${Math.round(rect.top)},bottom=${Math.round(rect.bottom)},height=${Math.round(rect.height)}`;
    }
    
    function elementSignature(el) {
        const dataAttrs = [...el.attributes]
            .filter(a => a.name.startsWith('data-'))
            .slice(0, 5)
            .map(a => a.value ? `${a.name}=${a.value}` : a.name)
            .join(' ');
        return `<${el.tagName.toLowerCase()}>` +
            (el.id ? `#${el.id}` : '') +
            (dataAttrs ? ` data="${dataAttrs}"` : '') +
            (el.className ? ` class="${String(el.className).slice(0, 80)}"` : '');
    }
    
    function describeSlabScopeCandidatesForMessageElement(messageEl, stopAt) {
        const out = [];
        for (let el = messageEl, depth = 0; el && depth < 8; el = el.parentElement, depth++) {
            const rect = el.getBoundingClientRect();
            const messageCount = el.matches('[data-message-author-role]')
                ? 1
                : el.querySelectorAll('[data-message-author-role]').length;
            const marker = el === messageEl ? 'messageElement' : (el === stopAt ? 'readyContainer' : `ancestor+${depth}`);
            out.push(
                `${marker}:${elementSignature(el)}, rect=[${rectSummary(rect)}], messages=${messageCount}`
            );
            if (el === stopAt) break;
        }
        return out.join(' | ');
    }
    
    function classifySlabItem(el) {
        if (el.matches('[data-message-author-role]')) return el.getAttribute('data-message-author-role') || 'message';
        const messageEl = el.querySelector('[data-message-author-role]');
        if (messageEl) return messageEl.getAttribute('data-message-author-role') || 'contains-message';
        if (el.querySelector('[id^="textdoc-message-"], #prosemirror-editor-container, .ProseMirror')) return 'textdoc/canvas';
        if (el.querySelector('.group\\/imagegen-image, [data-testid^="image-gen-"], img')) return 'image';
        if (el.matches('.group\\/tool-message') || el.querySelector('.group\\/tool-message')) return 'tool-message';
        return 'unknown';
    }
    
    function describeSlabItem(el, index = null) {
        const rect = el.getBoundingClientRect();
        const role = classifySlabItem(el);
        const msgId = el.getAttribute('data-message-id') ||
            el.querySelector('[data-message-id]')?.getAttribute('data-message-id') ||
            '(none)';
        const imageCount = el.querySelectorAll('img').length;
        const textLen = (el.innerText || el.textContent || '').trim().length;
        const testIds = [...el.querySelectorAll('[data-testid]')]
            .slice(0, 4)
            .map(testEl => testEl.getAttribute('data-testid'))
            .join(',');
        const childHints = [...el.children]
            .slice(0, 4)
            .map(elementSignature)
            .join(' || ');
        // Direct test of whether this item (e.g. a tool-message/unknown slab
        // sitting in a gap) would be picked up as its own separate deck by
        // queryDeckSequenceContainers — only an issue if it carries its OWN
        // data-turn-id-container value, distinct from its ancestor's. If it
        // merely reuses the ancestor's id, the dedup-by-id logic there
        // already keeps only the outer element, so it's not a separate deck.
        const ownTurnIdContainer = el.getAttribute('data-turn-id-container');
        const ancestorTurnIdContainer = el.parentElement?.closest('[data-turn-id-container]')?.getAttribute('data-turn-id-container') || null;
        const deckIdNote = ownTurnIdContainer
            ? (ownTurnIdContainer === ancestorTurnIdContainer
                ? `data-turn-id-container=${ownTurnIdContainer} (reuses ancestor's id — already deduped, not a separate deck)`
                : `data-turn-id-container=${ownTurnIdContainer} (DIFFERS from ancestor's ${ancestorTurnIdContainer || '(none)'} — WOULD be treated as its own separate deck)`)
            : 'no own data-turn-id-container';
        return `${index === null ? '' : `#${index}/`}${role}/msgId=${msgId}/imgs=${imageCount}/` +
            `textLen=${textLen}` +
            (testIds ? `/testids=${testIds}` : '') +
            (childHints ? `/children=${childHints}` : '') +
            `/${elementSignature(el)}/rect=[${rectSummary(rect)}]/${deckIdNote}`;
    }
    
    function describeSiblingSlabItemsInRange(messageEl, top, bottom) {
        const stack = slabStackForMessageElement(messageEl);
        const messageSlab = slabItemForMessageElement(messageEl);
        if (!stack) return 'stack=(none)';
        const items = [...stack.children]
            .map((el, i) => {
                const rect = el.getBoundingClientRect();
                const overlap = Math.min(rect.bottom, bottom) - Math.max(rect.top, top);
                return { el, i, rect, overlap };
            })
            .filter(item => item.el !== messageSlab && item.overlap > SMALL_EXTRA)
            .sort((a, b) => b.overlap - a.overlap);
        const stackRect = stack.getBoundingClientRect();
        return `stackRect=[${rectSummary(stackRect)}], stackChildren=${stack.children.length}, ` +
            `overlappingSiblingSlabs=${items.length}` +
            (items.length ? `, ${items.slice(0, 4).map(item =>
                `${describeSlabItem(item.el, item.i)}/overlap=${Math.round(item.overlap)}px`
            ).join(' || ')}` : '');
    }
    
    function isCanvasBlock(el) {
        return Boolean(el?.id && el.id.startsWith('textdoc-message-'));
    }
    
    const FILTERED_SLAB_RULES = [
        {
            name: 'tool-message',
            matches: el => el.matches('.group\\/tool-message') || Boolean(el.querySelector('.group\\/tool-message')),
        },
    ];
    
    function filteredSlabRuleFor(el) {
        return FILTERED_SLAB_RULES.find(rule => rule.matches(el)) || null;
    }
    
    function directStackItems(root = document) {
        const items = [];
        for (const scope of root.querySelectorAll('[data-conversation-screenshot-content]')) {
            const stack = [...scope.children].find(child => child.matches?.('.flex.max-w-full.flex-col.gap-4.grow'));
            if (stack) items.push(...stack.children);
        }
        return items;
    }
    
    function inspectUnselectedStackItems(selectedCandidates, acceptsRect) {
        const selectedGeometry = new Set(selectedCandidates.map(candidate => candidate.geometryElement));
        const unlisted = [];
        for (const el of directStackItems()) {
            if (selectedGeometry.has(el) || selectedCandidates.some(candidate => el.contains(candidate.element))) continue;
            const rect = el.getBoundingClientRect();
            if (!acceptsRect(rect)) continue;
            const rule = filteredSlabRuleFor(el);
            if (!rule) unlisted.push({ el, rect });
        }
        return unlisted;
    }
    
    function slabItemForElement(el) {
        const scope = el.closest('[data-conversation-screenshot-content]');
        const stack = scope
            ? [...scope.children].find(child => child.matches?.('.flex.max-w-full.flex-col.gap-4.grow'))
            : null;
        return stack ? ([...stack.children].find(child => child.contains(el)) || el) : el;
    }
    
    function makeSlabCandidate(type, element) {
        const geometryElement = type === 'message' ? slabItemForElement(element) : element;
        return { type, element, geometryElement };
    }
    
    // Stands in for "current" before the very first real slab has been
    // found, so the walk never needs a separate bootstrap case: every real
    // candidate is, by construction, ahead of this sentinel (it has no
    // element of its own to be ahead of), and whichever real candidate is
    // nearest the start of the conversation is found the same way any other
    // "next" slab is. Its geometryElement is not a DOM node — it's a fixed
    // value standing for "before the conversation begins" — so it never
    // needs to be (and never is) read again once a real current exists.
    const SLAB_WALK_START = {
        type: 'start',
        element: null,
        geometryElement: {
            getBoundingClientRect: () => (
                WALK_DIRECTION === -1
                    ? { top: Infinity, bottom: Infinity, left: 0, right: 0, width: 0, height: 0 }
                    : { top: -Infinity, bottom: -Infinity, left: 0, right: 0, width: 0, height: 0 }
            ),
        },
    };
    
    function makeDeckEntryCurrent(deckEl) {
        return {
            type: 'deck-entry',
            element: null,
            deckElement: deckEl,
            geometryElement: {
                getBoundingClientRect: () => {
                    const r = deckEl.getBoundingClientRect();
                    const edge = WALK_DIRECTION === -1 ? r.bottom : r.top;
                    return { top: edge, bottom: edge, left: r.left, right: r.right, width: r.width, height: 0 };
                },
            },
        };
    }
    
    function makeDeckExitCurrent(deckEl) {
        return {
            type: 'deck-exit',
            element: null,
            deckElement: deckEl,
            geometryElement: {
                getBoundingClientRect: () => {
                    const r = deckEl.getBoundingClientRect();
                    const edge = WALK_DIRECTION === -1 ? r.top : r.bottom;
                    return { top: edge, bottom: edge, left: r.left, right: r.right, width: r.width, height: 0 };
                },
            },
        };
    }
    
    function slabRole(slab) {
        return slab.element.getAttribute('data-message-author-role') ||
            slab.element.closest('[data-turn]')?.getAttribute('data-turn') ||
            slab.type;
    }
    
    function slabTurnId(slab) {
        return slab.element.closest('[data-turn]')?.getAttribute('data-turn-id') ||
            slab.element.getAttribute('data-turn-id') ||
            null;
    }
    
    function slabMessageId(slab) {
        return slab.element.getAttribute('data-message-id') || null;
    }
    
    function querySelectedSlabCandidates(root = document) {
        const candidates = [];
        const messageEls = root.querySelectorAll('[data-message-author-role]');
        const canvasEls = root.querySelectorAll('[id^="textdoc-message-"]');
        const imageEls = root.querySelectorAll('.group\\/imagegen-image');
        for (const el of messageEls) candidates.push(makeSlabCandidate('message', el));
        for (const el of canvasEls) {
            candidates.push(makeSlabCandidate('canvas', el));
        }
        for (const el of imageEls) {
            candidates.push(makeSlabCandidate('image', el));
        }
        // The turn's own section wrapper (data-turn) exists as soon as the
        // deck mounts, before any of the three precise selectors above have
        // rendered anything — using it as a 'message' candidate here means
        // the existing, justified content-readiness wait
        // (slabFinishFingerprint) applies to "not rendered yet" the same
        // way it already applies to "found but incomplete", instead of
        // treating "nothing found at all" as a final answer with no
        // fingerprint to wait on. Only tried when genuinely nothing of any
        // type was found (a real canvas/image candidate, once it exists,
        // always takes precedence over this guess) and when root is a
        // specific deck, not the whole document (the diagnostic call site
        // below still wants a real "nothing anywhere" answer).
        if (candidates.length === 0 && root !== document) {
            const turnSection = root.matches?.('[data-turn]') ? root : root.querySelector('[data-turn]');
            if (turnSection) candidates.push(makeSlabCandidate('message', turnSection));
        }
        return candidates;
    }
    
    const SLAB_LOOKAHEAD_PX = Math.max(
        SLAB_ADJACENCY_MAX_GAP + MIN_ONE_LINE_MESSAGE_HEIGHT,
        MIN_ONE_LINE_MESSAGE_HEIGHT * 2
    );
    
    // Distance helper retained for diagnostics and coverage checks. The real
    // successor operation below is now bounded by SLAB_LOOKAHEAD_PX and scoped
    // to the current ready deck.
    function slabDistanceAhead(currentRect, candidateRect) {
        if (WALK_DIRECTION === -1) {
            if (candidateRect.top >= currentRect.top) return null;
            return Math.max(0, currentRect.top - candidateRect.bottom);
        }
        if (candidateRect.bottom <= currentRect.bottom) return null;
        return Math.max(0, candidateRect.top - currentRect.bottom);
    }
    
    function closestCandidateAhead(currentSlab, candidates) {
        const currentRect = currentSlab.geometryElement.getBoundingClientRect();
        const ranked = candidates
            .map(candidate => ({
                candidate,
                rect: candidate.geometryElement.getBoundingClientRect(),
            }))
            .map(item => ({
                ...item,
                distance: slabDistanceAhead(currentRect, item.rect),
            }))
            .filter(item => item.distance !== null)
            .sort((a, b) => {
                if (a.distance !== b.distance) return a.distance - b.distance;
                return WALK_DIRECTION === -1
                    ? b.rect.bottom - a.rect.bottom
                    : a.rect.top - b.rect.top;
            });
        return ranked[0]?.candidate || null;
    }
    
    function slabBelongsToDeck(slab, deckEl) {
        if (!slab || !deckEl) return false;
        if (slab.deckElement === deckEl) return true;
        if (!slab.element) return false;
        if (slab.element === deckEl || deckEl.contains(slab.element)) return true;
        const slabDeckId = slab.element.closest?.('[data-turn-id-container]')?.getAttribute('data-turn-id-container') || null;
        return Boolean(slabDeckId && slabDeckId === deckSequenceId(deckEl));
    }
    
    function roomAheadInDeck(deckRect, currentRect) {
        if (!currentRect) return deckRect.height;
        return WALK_DIRECTION === -1
            ? currentRect.top - deckRect.top
            : deckRect.bottom - currentRect.bottom;
    }
    
    // Direct geometric answer to "can the current ready deck still contain
    // the next slab" — used to decide *before* searching whether deck
    // administration (closing this one, opening the next) is needed,
    // rather than discovering it indirectly via findNextSlabInReadyDeck's
    // own 'end-of-deck' result. Same primitive (roomAheadInDeck) that
    // function uses internally, so the two checks can't disagree.
    function deckHasRoomAhead(deckEl, currentSlab) {
        const deckRect = deckEl.getBoundingClientRect();
        const currentRect = slabBelongsToDeck(currentSlab, deckEl)
            ? currentSlab.geometryElement.getBoundingClientRect()
            : null;
        return roomAheadInDeck(deckRect, currentRect) > SMALL_EXTRA;
    }
    
    function distanceAheadFromReference(currentRect, candidateRect) {
        if (!currentRect) return 0;
        return slabDistanceAhead(currentRect, candidateRect);
    }
    
    function candidateDistanceFacts(deckRect, currentRect, rect) {
        const insideDeckDistance = Math.max(0, deckRect.top - rect.bottom, rect.top - deckRect.bottom);
        if (insideDeckDistance > SMALL_EXTRA) return null;
        const aheadDistance = distanceAheadFromReference(currentRect, rect);
        if (aheadDistance === null || aheadDistance > SLAB_LOOKAHEAD_PX) return null;
        return { aheadDistance, insideDeckDistance };
    }
    
    function measureSlabSearchFrame(deckEl, currentSlab, selectedCandidates, stackItems) {
        const deckRect = deckEl.getBoundingClientRect();
        const currentRect = slabBelongsToDeck(currentSlab, deckEl)
            ? currentSlab.geometryElement.getBoundingClientRect()
            : null;
        return {
            roomAhead: roomAheadInDeck(deckRect, currentRect),
            candidates: selectedCandidates.map(candidate => ({
                candidate,
                distances: candidateDistanceFacts(deckRect, currentRect, candidate.geometryElement.getBoundingClientRect()),
            })),
            stackItems: stackItems.map(el => ({
                el,
                distances: candidateDistanceFacts(deckRect, currentRect, el.getBoundingClientRect()),
            })),
        };
    }
    
    // Successor selection is deck-scoped by design. The deck must already be
    // ready/mounted before this runs; this function only asks which selected
    // slab in that ready deck is nearest by same-frame distance ahead of
    // current, within the bounded lookahead distance. Unknown direct-stack
    // items are reported, not silently treated as valid slabs.
    function findNextSlabInReadyDeck(deckEl, currentSlab) {
        const selectedCandidates = querySelectedSlabCandidates(deckEl);
        const stackItems = directStackItems(deckEl);
        const frame = measureSlabSearchFrame(deckEl, currentSlab, selectedCandidates, stackItems);
        if (frame.roomAhead <= SMALL_EXTRA) return { kind: 'end-of-deck' };
    
        if (selectedCandidates.length === 0) {
            const unlisted = [];
            for (const { el } of frame.stackItems) {
                const rule = filteredSlabRuleFor(el);
                if (!rule) unlisted.push(el);
            }
            const detail = stackItems.length === 0
                ? ''
                : ` ${stackItems.length} direct-stack item(s) existed, but none matched a valid slab selector` +
                  (unlisted.length ? ` (${unlisted.length} unlisted).` : '.');
            return {
                kind: 'note',
                slab: {
                    type: 'note',
                    element: deckEl,
                    geometryElement: deckEl,
                    note: {
                        // See finishDeckCoverage's identical fix — no
                        // type-based certainty here, so an unreadable
                        // attribute is reported as 'unknown', not guessed
                        // as 'assistant'.
                        role: deckEl.getAttribute('data-turn') || 'unknown',
                        text: `*[Empty container — no slab could be detected for this turn (turnId=` +
                            `${deckSequenceId(deckEl) || 'unknown'}). This may be a ChatGPT rendering failure ` +
                            `or an extractor bug.${detail}]*\n\n` +
                            `${captureElementHtmlReference('empty-container-selection', deckEl, deckEl.getAttribute('data-turn') || 'unknown', deckSequenceId(deckEl))}\n\n`,
                        plainText: '[Empty container]',
                        msgId: null,
                        turnId: deckSequenceId(deckEl) || null,
                    },
                },
                unlisted: [],
            };
        }
        const ranked = frame.candidates
            .filter(item => item.distances)
            .sort((a, b) => {
                if (a.distances.aheadDistance !== b.distances.aheadDistance) {
                    return a.distances.aheadDistance - b.distances.aheadDistance;
                }
                return a.distances.insideDeckDistance - b.distances.insideDeckDistance;
            });
        const selectedGeometry = new Set(selectedCandidates.map(candidate => candidate.geometryElement));
        const unlisted = [];
        for (const { el, distances } of frame.stackItems) {
            if (selectedGeometry.has(el) || selectedCandidates.some(candidate => el.contains(candidate.element))) continue;
            if (!distances) continue;
            const rule = filteredSlabRuleFor(el);
            if (!rule) unlisted.push({ el, distances });
        }
    
        if (ranked[0]) return { kind: 'slab', slab: ranked[0].candidate, unlisted };
        return { kind: 'end-of-deck', unlisted };
    }
    
    // Selectors are used synchronously, with no wait: findNextSlabInReadyDeck
    // is called exactly once here. There is no anterior fingerprint that
    // justifies expecting a candidate to appear if the selector finds none
    // right now (room permitting) — that's the algorithm's own answer for
    // this deck, not a timing gap, so 'note'/'end-of-deck' return
    // immediately. A found candidate is different: its own in-progress
    // signal (a skeleton class, an image with no src yet) is a fingerprint
    // we know will resolve, so only that gets a real wait loop, checked
    // repeatedly on the same already-found element.
    async function waitForNextSlabInReadyDeck(deckEl, currentSlab, timeoutMs = SLAB_FINISH_TIMEOUT_MS) {
        const selection = findNextSlabInReadyDeck(deckEl, currentSlab);
        if (selection.kind !== 'slab') return selection; // no fingerprint to wait for — final answer now
        const startedAt = performance.now();
        const deadline = Date.now() + timeoutMs;
        let fp = slabFinishFingerprint(selection.slab, deckEl);
        while (!fp.ready) {
            if (Date.now() > deadline) {
                const waitedMs = Math.round(performance.now() - startedAt);
                // A candidate that was found but never passes its own
                // content fingerprint within the same patience every other
                // slab gets is a valid empty slab, not a reason to stop the
                // whole run — the same outcome the 'note' placeholder above
                // already covers for "nothing here at all", just reached
                // after waiting instead of immediately. Note it and
                // proceed exactly like that case: current advances past it.
                const next = selection.slab;
                return {
                    kind: 'note',
                    slab: {
                        type: 'note',
                        element: next.element,
                        geometryElement: next.geometryElement,
                        note: {
                            role: slabRole(next),
                            text: `*[Empty slab — selector found a ${next.type}/${slabRole(next)} slab ` +
                                `(turnId=${slabTurnId(next) || 'unknown'}), but it never passed its own content ` +
                                `fingerprint within ${Math.round(timeoutMs / 1000)}s: last=${fp.reason}, ` +
                                `summary=${JSON.stringify(fp.summary)}]*\n\n` +
                                `${captureElementHtmlReference('empty-slab-fingerprint-timeout', next.element, slabRole(next), slabTurnId(next))}\n\n`,
                            plainText: '[Empty slab]',
                            msgId: slabMessageId(next) || null,
                            turnId: slabTurnId(next) || null,
                        },
                    },
                };
            }
            await sleep(SLAB_FINISH_POLL_MS);
            fp = slabFinishFingerprint(selection.slab, deckEl);
        }
        return selection;
    }
    
    function extractSlab(slab) {
        let el = slab.element;
        // Canvas/textdoc blocks: saved as their own separate .md file at
        // export time (same deferred-token pattern as images — see
        // _pendingCanvasDownloads above), linked from here. Mirrors how the
        // conversation already treats a generated image instead of inlining
        // a potentially huge nested document into the surrounding
        // conversation flow. Checked first and returns early — canvas
        // elements never go through the ordinary message-based path below
        // (no data-message-id of their own). The outer canvas also contains
        // title and action controls, so serialization targets the mounted
        // ProseMirror content surface rather than the shell.
        if (slab.type === 'canvas') {
            const contentRoot = canvasContentRoot(el);
            const text = contentRoot ? htmlToMarkdown(contentRoot) : '';
            if (!text) {
                return null;
            }
            const titleEl = el.querySelector('span.font-semibold, [class*="font-semibold"]');
            const title = (titleEl?.textContent || 'Canvas document').trim();
            const token = `__CANVAS_PLACEHOLDER_${++_canvasCounter}__`;
            _pendingCanvasDownloads.push({ text, token, title });
            const turnSection = el.closest('[data-turn]');
            return {
                role: turnSection?.getAttribute('data-turn') || 'assistant',
                text: `[${title}](${token})\n\n`,
                plainText: title,
                msgId: null,
                turnId: turnSection?.getAttribute('data-turn-id') || null,
            };
        }
        if (slab.type === 'image') {
            const image = primaryImageForSlab(el);
            const text = image ? htmlToMarkdown(image) : '';
            if (!text) return null;
            const turnSection = el.closest('[data-turn]');
            return {
                role: turnSection?.getAttribute('data-turn') || 'assistant',
                text: text + '\n\n',
                plainText: image.getAttribute('alt') || 'Generated image',
                msgId: null,
                turnId: turnSection?.getAttribute('data-turn-id') || null,
            };
        }
        // querySelectedSlabCandidates falls back to the turn-section wrapper
        // as the candidate when [data-message-author-role] hasn't rendered
        // yet — by the time extraction runs, the content fingerprint has
        // already confirmed real content exists, so the precise element
        // should now be findable as a descendant. Resolving down here keeps
        // the rest of this branch (and htmlToMarkdown itself) targeting the
        // actual message, not the whole turn shell.
        if (!el.matches('[data-message-author-role]')) {
            const messageEl = el.querySelector('[data-message-author-role]');
            if (!messageEl) return null;
            el = messageEl;
        }
        const text = htmlToMarkdown(el);
        if (!text) return null;
        const msgId = el.getAttribute('data-message-id') || null;
        // Image-generation turns have no data-message-id — data-turn-id is
        // the only stable identity they carry.
        const turnId = msgId ? null : (el.getAttribute('data-turn-id') || null);
        return {
            role: el.getAttribute('data-message-author-role') || el.getAttribute('data-turn'),
            text,
            plainText: el.innerText.trim(),
            msgId,
            turnId,
        };
    }
    
    async function run(ui, stopBtn, resumeState = null) {
        const isResume = !!resumeState;
        _pendingAutoRestart = false;
        if (isResume && resumeState.perf) _perf = resumeState.perf;
        else _resetPerf();
        setStabilizationMarkerColor('#34c759'); // green from the very start, so the first jump's switch to light blue is visible as a real transition, not the dot just appearing
        if (isResume) {
            _pendingImageDownloads = resumeState.pendingImageDownloads || [];
            _imageCounter = resumeState.imageCounter || 0;
            _pendingCanvasDownloads = resumeState.pendingCanvasDownloads || [];
            _canvasCounter = resumeState.canvasCounter || 0;
            _htmlCaptures = resumeState.htmlCaptures || [];
            _runTimestamp = resumeState.timestamp || Date.now();
        } else {
            _pendingImageDownloads = [];
            _imageCounter = 0;
            _pendingCanvasDownloads = [];
            _canvasCounter = 0;
            _htmlCaptures = [];
            _runTimestamp = Date.now();
        }
        _knownUnresolvableSandwichedTurnIds = new Set(
            isResume
                ? (resumeState.knownUnresolvableSandwichedTurnIds || KNOWN_PERMANENTLY_BROKEN_TURN_IDS)
                : KNOWN_PERMANENTLY_BROKEN_TURN_IDS
        );
        // Deliberately NOT reset here. If a previous detached-current jump
        // failure retreated this to a smaller size before throwing (see
        // maintainWorkZone), a later fresh run should keep that calibration
        // instead of repeating the same size that just failed. It only ever
        // starts at WORK_ZONE_MOVE_JUMP_PX because that's its declared
        // initial value, for a genuinely first run since the page loaded.
        //
        // Minor convenience, not load-bearing — see the matching comment in
        // maintainWorkZone's failure branch. Safe to delete (reverting to an
        // unconditional reset here) if it's ever in the way; the worst case
        // without it is a slower regrow from the floor on retry, never a
        // correctness problem.
        if (!isResume || !_perf.runStartMs) _perf.runStartMs = performance.now();
        ui.total = rememberExpectedUserPrompts(getNavMenuItems().length);
        const container = findScrollContainer();

        const onVisibilityChange = () => {
            if (document.hidden) ui.log('  tab went to background; timers may stall while hidden');
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
    
        const allPrompts = isResume ? resumeState.allPrompts : [];
        let lastEl = resumeState?.lastEl || null;
        let stopReason = null; // non-null = stopped early; still export what we have
        // Cumulative across the whole run, unlike advancesWithoutProgress
        // (which resets on every real-progress event) — this is "how many
        // containers has the walk gone through in total," for the panel and
        // the snapshot table. Declared here (not next to its increment site)
        // so it's already in scope for the bootstrap's own status() call.
        let totalContainerAdvances = resumeState?.totalContainerAdvances || 0;
        let readyContainer = resumeState?.readyContainer || null;
        let current = resumeState?.current || SLAB_WALK_START;
        let containerSlabRanges = resumeState?.containerSlabRanges || [];
        // Defensive cap: if ready decks keep yielding no extractable slab,
        // that's not "the conversation is just long." Fail fast with the
        // geometry that didn't match, rather than spin silently through every
        // remaining deck.
        let advancesWithoutProgress = resumeState?.advancesWithoutProgress || 0;
        const MAX_ADVANCES_WITHOUT_PROGRESS = 50;
        // className/attributes of every deck advanced through without a
        // matching slab — rect coordinates alone don't say whether a long
        // run of zero-height decks are genuine (if sparse) turn wrappers or
        // some unrelated decorative/structural element that happens to
        // satisfy findNextDeck's geometric strip test. Cleared whenever real
        // progress resets advancesWithoutProgress, so a later failure's
        // report isn't contaminated by an earlier, unrelated stretch.
        let advanceChain = resumeState?.advanceChain || [];
    
        if (stopBtn) stopBtn.onclick = () => { ui.stopped = true; };
    
        // The bootstrap sequence below (nav click, scroll settle, viewport
        // scan) and the chain-walk loop further down are now one single try
        // — a bootstrap failure used to throw before _savedState was ever
        // set, discarding every diagnostic this run collected (Nav click
        // info, scroll container info, etc.) in favor of a bare error
        // string. Folding it into the same try the loop already uses means
        // a bootstrap failure gets the same treatment as a mid-walk one:
        // recorded as stopReason, with the full diag block still exported.
        // Shared by every insertion site (a real extracted slab, or a
        // finishDeckCoverage/no-valid-slab placeholder) so the direction-aware
        // ordering logic exists in exactly one place. direction=-1 walks
        // newest-to-oldest, so within any one deck holding more than one
        // slab, findNextSlabInReadyDeck discovers them bottom-to-top (whichever is
        // nearest the current — below this deck — is found first) — the
        // reverse of normal top-to-bottom reading order. A plain unshift
        // each time corrects exactly that: every new same-deck discovery
        // lands ahead of the previous one, restoring top-to-bottom order
        // within the deck while still landing the whole deck's batch ahead
        // of everything already collected from later (already-walked) decks.
        // direction=+1 doesn't need this: push always appends at the end,
        // and discovery there already runs top-to-bottom. Declared above the
        // try so it's also reachable from the catch below (a fatal timeout's
        // captured-outerHTML placeholder is inserted from there).
        const insertMsg = (msg) => {
            if (WALK_DIRECTION === -1) {
                allPrompts.unshift(msg);
            } else {
                allPrompts.push(msg);
            }
        };
    
        try {
    
        // ── Land on the prompt at the walk's starting edge via the
        // matching nav dot — the last dot (bottom) for an upward walk, the
        // first dot (top) for a downward one. Needed because a second run in
        // the same page load would otherwise bootstrap from wherever
        // the *previous* run's walk left the scroll position, instead of the
        // actual edge this run needs to start from.
        // Two genuinely different things can go wrong here, and they call
        // for different responses — conflating them (e.g. by retrying the
        // slab check for a while just in case) hides which one actually
        // happened. So they get separate throws:
        //   1. The container/scroll itself never settles — a timing/loading
        //      problem. Worth waiting for (up to 30s, matching every other
        //      readiness wait in this file), since it may just be slow.
        //   2. The scroll settles but no prompt is found — this is not a
        //      timing problem. Every chat has at least one user prompt by
        //      construction; if the viewport-overlap check still finds none
        //      once the scroll has genuinely stopped moving, that's a
        //      detection-logic bug to investigate, not something more
        //      waiting would fix. So this check has no retry at all.
        if (isResume) {
            if (isCurrentDetached(resumeState.current)) {
                throw new Error(`Cannot resume from current cursor: ${describeCurrentAttachment(resumeState.current)}.`);
            }
            if (resumeState.readyContainer && !resumeState.readyContainer.isConnected) {
                throw new Error('Cannot resume from current cursor: ready deck is detached.');
            }
            ui.log(`Resuming from current cursor — ${describeCurrentForStop(resumeState.current, resumeState.readyContainer)}`);
        } else {
            const navItems = getNavMenuItems();
            if (navItems.length > 0) {
                // aria-label is the one independent signal for what a dot
                // actually points to — not inferred from a click's side effect,
                // which can be confounded by a no-op click leaving the scroll
                // wherever a previous run left it. Captured for both ends
                // regardless of which one gets clicked, so a failure report can
                // show whether the labels even distinguish position at all.
                const clickedIndex = WALK_DIRECTION === -1 ? navItems.length - 1 : 0;
                const oppositeIndex = navItems.length - 1 - clickedIndex;
                // Visit the opposite end first, and dwell there, before the real
                // bootstrap click below. The page tends to load already settled
                // near one edge (typically the bottom), so that edge's
                // containers can still be fully rendered from page load itself —
                // never having gone through a not-ready→ready transition at all
                // — by the time the walk starts. That's the same "vacuous test"
                // problem already seen in composite-fingerprint candidates with
                // near-zero discovery-to-ready delay. Whatever mechanism decides
                // to eagerly fill content near the viewport is presumably
                // time-dependent, not just position-dependent — a quick
                // click-away-and-back could land back at the target edge before
                // that edge has actually been torn down, defeating the point.
                // So this isn't a courtesy pause, it's the actual mechanism:
                // speed here is the failure mode, not an inefficiency to trim.
                //
                // None of that risk exists when this run immediately followed a
                // fresh full-page reload (ui.isAutoStart): nothing has rendered
                // yet at all when the script starts watching, at either edge —
                // the freshness this diversion manufactures artificially is
                // already guaranteed for free by the reload itself. The risk is
                // specifically about a page that's been open and settled for an
                // arbitrary stretch before a manual Start Extraction click, so
                // that's the only case this still needs to run for.
                if (oppositeIndex !== clickedIndex && !ui.isAutoStart) {
                    navItems[oppositeIndex].click();
                    try {
                        await forceScrollToEdge(container, -WALK_DIRECTION, 10_000);
                    } catch (e) {
                        // Best-effort: if the opposite edge won't settle, proceed
                        // to the real bootstrap anyway rather than failing the
                        // whole run over a diversion that was never the actual goal.
                    }
                    await sleep(2000);
                }
                navItems[clickedIndex].click();
            }
            // The click alone isn't trusted to land us at the right edge and
            // stay there (see forceScrollToEdge's comment) — it's still issued
            // above in case it does something useful (e.g. registering the
            // navigation with ChatGPT's own state), but the actual position is
            // guaranteed here regardless of whether a nav dot existed at all.
            await forceScrollToEdge(container, WALK_DIRECTION, 30_000);
            // Recorded for every run, not just failures, so a successful run's
            // diag block still shows where this actually landed.
            {
                const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
                const clientH = container === document.documentElement ? window.innerHeight : container.clientHeight;
                const range = scrollH - clientH;
                // forceScrollToEdge's own stability check only requires 3
                // checks 150ms apart (450ms total) to agree with *whatever*
                // scrollHeight currently is — it never confirms scrollHeight
                // itself has stopped growing. A still-settling tail (e.g. a
                // multi-message image-gen reply not yet fully measured into
                // layout) could make it lock onto an edge that looks stable
                // for that brief window but isn't actually the true end yet.
                // Direct check: re-measure scrollHeight a few seconds later,
                // with no further scrolling in between, and see if it moved.
                await sleep(5000);
                const scrollHAfter = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            }
        }
    
        // No separate bootstrap for a fresh run: SLAB_WALK_START stands in
        // for "current" before any real slab has been found, so the first
        // real slab is simply "the next one after that." On resume, current
        // and readyContainer were restored before the try block so the catch
        // can save them again if this segment also stops.
        startBackgroundPositionSampler(() => current, container); // see its own comment — never awaited, can't affect timing
        const describeTurnContainer = el => {
            const r = el.getBoundingClientRect();
            const attrs = [...el.attributes]
                .filter(a => a.name.startsWith('data-'))
                .map(a => a.value ? `${a.name}="${a.value}"` : a.name)
                .join(' ');
            return `height=${Math.round(r.height)} class="${(el.className || '').slice(0, 60)}" ${attrs}`;
        };
    
        // Moves into the deck that should host the next slab — the only
        // place a deck's own readiness flag is checked, always before any
        // search runs against it, never an individual slab's own readiness
        // (that stays a separate, later check). When readyContainer is still
        // null (no real deck entered yet), targetDeck comes from the
        // viewport edge rather than adjacency, since there is nothing yet to
        // be adjacent to.
        const enterDeck = async (targetDeck) => {
            const readinessEl = readinessElementForDeck(targetDeck);
            await waitForTurnReady(container, readinessEl, 30_000);
            if (readyContainer) {
                if (readyContainer.isConnected) {
                    checkDeckAdjacency(readyContainer, targetDeck);
                }
            }
            readyContainer = targetDeck;
            // One capture per deck, here, at the moment it's confirmed
            // ready and entered — the main source of entries in the
            // separate .html export (see _htmlCaptures), matching the
            // markdown's own one-deck-at-a-time walk so the two exports
            // stay roughly parallel in density/coverage.
            const entrySectionEl = targetDeck.matches('[data-turn]') ? targetDeck : targetDeck.querySelector('[data-turn]');
            pushHtmlCaptures('deck-entry', [{
                turnId: deckSequenceId(targetDeck) || '(none)',
                role: entrySectionEl?.getAttribute('data-turn') || targetDeck.getAttribute('data-turn') || 'unknown',
                html: trimmedCaptureHtml(entrySectionEl || targetDeck),
            }]);
            current = makeDeckEntryCurrent(readyContainer);
            containerSlabRanges = [];
            totalContainerAdvances++;
            advanceChain.push({ desc: describeTurnContainer(readyContainer), el: readyContainer });
            ui.status(countPrompts(allPrompts), allPrompts.length);
        };
    
        // The loop below is organized slab-to-slab, matching the actual
        // invariant being maintained: keep the work zone ahead of current,
        // then find/extract the next slab. Deck ("supply batch")
        // administration is not the loop's driver — it's a detail that
        // only matters at the boundary between two adjacent slabs, when
        // the deck currently hosting `current` can no longer also host
        // the next one. That boundary case is checked explicitly, by
        // geometry, before searching — not discovered indirectly by
        // attempting the search and reading an 'end-of-deck' result back.
        while (!ui.stopped && !stopReason) {
            // ── ensure work-zone room ahead of current slab ──
            // maintainWorkZone reports the outcome of the intervention, not
            // the end of traversal. If the physical scroll boundary is reached,
            // no further jump can create more room, but structural selection
            // may still find the next visible deck/slab.
            const zoneStatus = await maintainWorkZone(container, current, SLAB_LOOKAHEAD_PX);
            if (zoneStatus.jumpsTaken > 0) {
                ui.log(`  work-zone move: ${zoneStatus.jumpsTaken} step(s), outcome=${zoneStatus.outcome}`);
            }
            if (!zoneStatus.roomSatisfied && !zoneStatus.boundaryReached) {
                if (ui.total > 0 && countPrompts(allPrompts) < ui.total) {
                    const boundaryLabel = WALK_DIRECTION === -1 ? 'start' : 'end';
                    stopReason = `Reached the supplied ${boundaryLabel} with only ${countPrompts(allPrompts)}/${ui.total} ` +
                        `user prompts extracted. This is a count mismatch, not proof that more deck space exists; ` +
                        `earlier slab extraction likely missed prompt(s). ${describeCurrentForStop(current, readyContainer)}`;
                }
                break;
            } else if (!zoneStatus.roomSatisfied) {
                ui.log(`  scroll boundary reached during work-zone move; continuing with deck/slab geometry search`);
            }
            // ── if the current supply batch cannot contain the next slab,
            // close it / open the next one — otherwise go straight to
            // finding the next slab in it. waitForNextSlabInReadyDeck's own
            // 'end-of-deck' is still honored as a fallback (its internal
            // retries can occasionally cross the same boundary mid-wait),
            // so this can never disagree with the search itself — only
            // pre-empt the common case of having to run it at all. ──
            let needsNewBatch = !readyContainer || !deckHasRoomAhead(readyContainer, current);
            let selection = null;
            if (!needsNewBatch) {
                selection = await waitForNextSlabInReadyDeck(readyContainer, current);
                needsNewBatch = selection.kind === 'end-of-deck';
            }
    
            if (needsNewBatch) {
                // === batch administration: close old, open next — supply/
                // batching detail, not the conceptual loop driver ===
                if (!readyContainer) {
                    const bootstrapDeck = findBootstrapContainer(container, WALK_DIRECTION);
                    if (bootstrapDeck) {
                        await enterDeck(bootstrapDeck);
                        continue;
                    }
                }
    
                // The current ready deck (if any) has no remaining
                // lookahead area ahead of current. Finish its coverage,
                // then move into the next adjacent deck (by viewport-edge
                // geometry if none has been entered yet, by adjacency
                // otherwise). If no next deck exists, that is either the
                // genuine boundary or a real bug, and those get told apart
                // below — never papered over with a blind retry.
                let reachedDocumentBoundaryForNextDeck = false;
                if (readyContainer) {
                    const placeholder = finishDeckCoverage(readyContainer, containerSlabRanges, current);
                    if (placeholder) insertMsg(placeholder);
                    current = makeDeckExitCurrent(readyContainer);
                    const exitZoneStatus = await maintainWorkZone(container, current, SLAB_LOOKAHEAD_PX);
                    reachedDocumentBoundaryForNextDeck = exitZoneStatus.boundaryReached;
                    if (exitZoneStatus.jumpsTaken > 0) {
                        ui.log(`  work-zone move (deck exit): ${exitZoneStatus.jumpsTaken} step(s), outcome=${exitZoneStatus.outcome}`);
                    }
                    if (!exitZoneStatus.roomSatisfied && !exitZoneStatus.boundaryReached) {
                        if (ui.total > 0 && countPrompts(allPrompts) < ui.total) {
                            const boundaryLabel = WALK_DIRECTION === -1 ? 'start' : 'end';
                            stopReason = `Reached the supplied ${boundaryLabel} with only ${countPrompts(allPrompts)}/${ui.total} ` +
                                `user prompts extracted. This is a count mismatch, not proof that more deck space exists; ` +
                                `earlier slab extraction likely missed prompt(s). ${describeCurrentForStop(current, readyContainer)}`;
                        }
                        break;
                    } else if (!exitZoneStatus.roomSatisfied) {
                        ui.log(`  scroll boundary reached at deck exit; searching for adjacent deck`);
                    }
                }
                let nextDeck = readyContainer
                    ? findNextDeck(readyContainer, WALK_DIRECTION)
                    : findBootstrapContainer(container, WALK_DIRECTION);
                if (!nextDeck && !readyContainer) {
                    // No deck has ever been entered yet, and none is visible at
                    // the viewport edge right now — give content a brief chance
                    // to mount before concluding there's truly nothing there
                    // (the page may not have finished its own initial render).
                    const bootstrapDeadline = Date.now() + 30_000;
                    while (!nextDeck && Date.now() < bootstrapDeadline) {
                        await sleep(100);
                        nextDeck = findBootstrapContainer(container, WALK_DIRECTION);
                    }
                }
                if (!nextDeck) {
                    if (readyContainer && !reachedDocumentBoundaryForNextDeck) {
                        stopReason = `No next deck found before the viewport reached the document boundary. ` +
                            `This is not a normal completion condition. ` +
                            `${countPrompts(allPrompts)}/${ui.total || 'unknown'} user slabs exported.`;
                        break;
                    }
                    if (ui.total === 0) {
                        stopReason = `No next deck found, but the expected user slab count was unknown during traversal. ` +
                            `${countPrompts(allPrompts)} user slabs exported. This is not a confirmed normal completion.`;
                        break;
                    }
                    if (countPrompts(allPrompts) >= ui.total) break;
                    const boundaryLabel = WALK_DIRECTION === -1 ? 'start' : 'end';
                    if (readyContainer) {
                        const r = readyContainer.getBoundingClientRect();
                        stopReason = `Reached the supplied ${boundaryLabel} with no next deck found, but only ` +
                            `${countPrompts(allPrompts)}/${ui.total} user prompts extracted. This is a count mismatch, ` +
                            `not proof that more deck space exists; earlier slab extraction likely missed prompt(s). ` +
                            `Last deck rect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}].`;
                    } else {
                        const totalContainers = queryDeckSequenceContainers().length;
                        stopReason = `No deck found at the viewport edge after waiting 30s, and only ` +
                            `${countPrompts(allPrompts)}/${ui.total} user prompts confirmed. ` +
                            `${totalContainers} deck sequence container(s) exist in the document — finding none at ` +
                            `the viewport edge means the bootstrap geometry check needs investigating, not a longer wait.`;
                    }
                    break;
                }
    
                // nextDeck's candidate is a snapshot of geometry at one moment.
                // On a large, still-resolving conversation, upstream placeholders
                // can correct while we walk toward it, leaving it permanently
                // out of reach in the one direction we ever scroll (observed
                // live: 73 steps, target.top never shrank — the target had
                // moved to the wrong side of the viewport entirely). Re-deriving the
                // candidate fresh and retrying handles that, instead of
                // committing to one possibly-stale pick.
                const MAX_NEXT_DECK_RETRIES = 3;
                let nextDeckAttempt = 0;
                while (true) {
                    try {
                        await enterDeck(nextDeck);
                        break;
                    } catch (e) {
                        nextDeckAttempt++;
                        if (nextDeckAttempt >= MAX_NEXT_DECK_RETRIES)
                            throw new Error(`${e.message} (gave up after ${nextDeckAttempt} candidate deck(s))`);
                        const fresh = readyContainer
                            ? findNextDeck(readyContainer, WALK_DIRECTION)
                            : findBootstrapContainer(container, WALK_DIRECTION);
                        if (!fresh) throw e; // can't even re-find a candidate — propagate the original failure
                        nextDeck = fresh;
                    }
                }
    
                advancesWithoutProgress++;
                if (advancesWithoutProgress > MAX_ADVANCES_WITHOUT_PROGRESS) {
                    const r = readyContainer.getBoundingClientRect();
                    // Find the [data-message-author-role] element geometrically
                    // closest to this deck's range, to show the actual mismatch
                    // distance rather than just "nothing matched".
                    const allMsgs = [...document.querySelectorAll('[data-message-author-role]')];
                    let closest = null, closestDist = Infinity;
                    for (const el of allMsgs) {
                        const mr = el.getBoundingClientRect();
                        const dist = mr.top < r.top ? r.top - mr.top : (mr.top > r.bottom ? mr.top - r.bottom : 0);
                        if (dist < closestDist) { closestDist = dist; closest = mr; }
                    }
                    const curR = current.geometryElement.getBoundingClientRect();
                    // Deduped, not raw, because a long run is almost always the
                    // same handful of element shapes repeated — a flat 51-line
                    // dump would bury the one distinguishing detail (do these
                    // have a real message inside their height, or are they all
                    // the same zero-height marker?) in noise. Object identity,
                    // not just the attribute dump, decides between two very
                    // different bugs: if every entry in a group is the same
                    // handful of distinct elements (turn-id dedup should have
                    // skipped past them but isn't), that's a bug in
                    // findNextDeck's exclusion logic. If it's genuinely a large
                    // number of distinct elements all carrying the same turn-id,
                    // the dedup filter is working exactly as designed and the
                    // real problem is that ChatGPT renders that many distinct
                    // same-turn-id nodes in the first place — a different fix
                    // entirely.
                    const chainGroups = new Map();
                    for (const { desc, el } of advanceChain) {
                        if (!chainGroups.has(desc)) chainGroups.set(desc, new Set());
                        chainGroups.get(desc).add(el);
                    }
                    const chainSummary = [...chainGroups.entries()]
                        .map(([desc, els]) => {
                            const total = advanceChain.filter(a => a.desc === desc).length;
                            return `        ×${total} (${els.size} distinct element(s)) ${desc}`;
                        })
                        .join('\n');
                    stopReason = `Advanced through ${advancesWithoutProgress} decks with no matching slab. ` +
                        `Last deck rect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)},height=${Math.round(r.height)}]. ` +
                        `Current (last confirmed) message rect=[top=${Math.round(curR.top)},bottom=${Math.round(curR.bottom)}]. ` +
                        (closest
                            ? `Closest of ${allMsgs.length} [data-message-author-role] elements: rect=[top=${Math.round(closest.top)},bottom=${Math.round(closest.bottom)}], distance=${Math.round(closestDist)}px from deck range.`
                            : `No [data-message-author-role] elements found in the document at all.`) +
                        `\n    Chain walked (${advanceChain.length} decks, deduped):\n${chainSummary}`;
                    break;
                }
                await sleep(30);
                continue;
            }
    
            // ── find next slab in the current ready batch + wait for the
            // slab fingerprint: both already done by waitForNextSlabInReadyDeck
            // above (one merged readiness loop — see its own comment) — by
            // this point selection.kind is guaranteed 'slab' or 'note'. ──
            const next = selection.slab;
            // current has no element of its own the very first time
            // through (see SLAB_WALK_START) — nothing real to compare
            // its adjacency against yet.
            if (current.element && current.type !== 'note') checkSlabAdjacency(current, next);
            advancesWithoutProgress = 0;
            advanceChain = [];
            const msgId = slabMessageId(next);
            if (next.type === 'note') {
                recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
                insertMsg(next.note);
                lastEl = next.geometryElement;
                current = next;
                ui.log(`#${allPrompts.length} confirmed (note/${slabRole(next)})`);
                ui.status(countPrompts(allPrompts), allPrompts.length);
                await sleep(30);
                continue;
            }
            // ── extract the slab once ──
            const msg = extractSlab(next);
            if (!msg) {
                ui.log(`  ⚠ extraction returned empty under current readiness fingerprint for ` +
                    `${next.type}/${slabRole(next)} — content permanently lost, advancing past it`);
                const missingRole = slabRole(next);
                const missingNote = {
                    role: missingRole === 'user' ? 'user' : missingRole === 'assistant' ? 'assistant' : 'unknown',
                    text: `*[Missing slab — selector found a ${next.type}/${missingRole} slab, ` +
                        `but extraction returned empty after the readiness fingerprint passed. ` +
                        `turnId=${slabTurnId(next) || 'unknown'}, msgId=${msgId || 'none'}.]*\n\n`,
                    plainText: '[Missing slab]',
                    msgId: msgId || null,
                    turnId: slabTurnId(next) || null,
                };
                recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
                insertMsg(missingNote);
            }
            if (msg) {
                recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
                insertMsg(msg);
            }
            // ── current = extracted slab ──
            lastEl = next.geometryElement;
            current = next;
    
            ui.log(`#${allPrompts.length} confirmed (${next.type}/${slabRole(next)})`);
            ui.status(countPrompts(allPrompts), allPrompts.length);
    
            // Throttle: a pace-limiter, not a content wait (this branch
            // never scrolls at all — readyContainer is already loaded).
            // Many prompts resolve from the same deck with no scrolling
            // whatsoever, so an unthrottled loop can still advance far
            // faster than intended elsewhere in the run.
            await sleep(30);
        }
        } catch (e) {
            stopReason = e.message;
            const canResumeFromCurrent =
                e.resumeFromCurrent &&
                current &&
                !isCurrentDetached(current) &&
                (!readyContainer || readyContainer.isConnected);
            if (canResumeFromCurrent) {
                _resumeState = {
                    current,
                    readyContainer,
                    allPrompts,
                    containerSlabRanges,
                    totalContainerAdvances,
                    advancesWithoutProgress,
                    advanceChain,
                    lastEl,
                    pendingImageDownloads: _pendingImageDownloads,
                    imageCounter: _imageCounter,
                    pendingCanvasDownloads: _pendingCanvasDownloads,
                    canvasCounter: _canvasCounter,
                    htmlCaptures: _htmlCaptures,
                    timestamp: _runTimestamp,
                    knownUnresolvableSandwichedTurnIds: [..._knownUnresolvableSandwichedTurnIds],
                    perf: _perf,
                };
                ui.log('Resume available from current cursor; no missing-slab note inserted yet.');
            } else {
                _resumeState = null;
                if (e.placeholder) insertMsg(e.placeholder);
                _pendingAutoRestart = !!e.autoRestart;
            }
        }
        if (!stopReason && !ui.stopped) {
            const expectedAtEnd = rememberExpectedUserPrompts(getNavMenuItems().length);
            const exportedAtEnd = countPrompts(allPrompts);
            if (expectedAtEnd > 0 && exportedAtEnd < expectedAtEnd) {
                stopReason = `Traversal ended after ${exportedAtEnd}/${expectedAtEnd} user slabs. ` +
                    `The loop reached an end condition, but the exported count is still incomplete. ` +
                    `Review the slab-loop end criteria; this is not a clean conversation boundary.`;
            }
        }
        if (!stopReason) _resumeState = null;
        stopBackgroundPositionSampler();
        removeStabilizationMarker();
        document.removeEventListener('visibilitychange', onVisibilityChange);
    
        ui.log(`${countPrompts(allPrompts)} prompts saved (${allPrompts.length} msgs total).`);
        if (stopReason) ui.log(`Stopped early: ${stopReason}`);
        // stopReason travels with the saved state (not just ui.stopped, which
        // only tracks the manual Stop button) so the caller can tell a clean
        // finish apart from an early stop and still offer export
        // either way.
        _savedState = { allPrompts, stopped: ui.stopped, stopReason, timestamp: _runTimestamp };
    }
    
    // ════════════════════════════════════════════════════════════════
    // UI PANEL
    // ════════════════════════════════════════════════════════════════
    
    function buildUI() {
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'fixed', top: '20px', right: '20px', zIndex: '99999',
            padding: '16px', background: '#1e1e2e', color: '#cdd6f4',
            border: '2px solid #89b4fa', borderRadius: '8px',
            fontFamily: 'monospace', fontSize: '12px', width: '340px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)', lineHeight: '1.6',
        });
    
        const titleRow = document.createElement('div');
        Object.assign(titleRow.style, {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '6px',
        });
    
        const title = Object.assign(document.createElement('div'), {
            innerText: 'ChatGPT Extractor v4.162',
        });
        Object.assign(title.style, { fontWeight: 'bold', color: '#89b4fa' });
    
        const toggleBtn = Object.assign(document.createElement('button'), { innerText: '×' });
        Object.assign(toggleBtn.style, {
            background: 'none', border: 'none', color: '#89b4fa',
            cursor: 'pointer', fontSize: '16px', lineHeight: '1',
            padding: '0 2px', fontFamily: 'monospace',
        });
    
        titleRow.append(title, toggleBtn);
    
        const statusEl = document.createElement('div');
        Object.assign(statusEl.style, { color: '#dde1f4', marginTop: '6px' });
        // ChatGPT's own term for a turn (either role) is "message"; this
        // script reserves "prompt" specifically for a user message, since
        // every prompt is confirmed as soon as it's found — there's no
        // separate confirmed-vs-total distinction to show for it.
        const elapsedEl = Object.assign(document.createElement('div'), { innerText: 'Elapsed : —' });
        const promptsEl = Object.assign(document.createElement('div'), { innerText: 'User msgs : —' });
        const msgsEl = Object.assign(document.createElement('div'), { innerText: 'All msgs : —' });
        statusEl.append(elapsedEl, promptsEl, msgsEl);
    
        const note = Object.assign(document.createElement('div'), {
            innerText: `Scroll to the ${WALK_DIRECTION === -1 ? 'BOTTOM' : 'TOP'} of the chat before starting.`,
        });
        Object.assign(note.style, {
            marginTop: '10px',
            color: '#f9e2af',
            fontSize: '13px',
            lineHeight: '1.35',
        });
    
        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' });
    
        const btn = Object.assign(document.createElement('button'), {
            innerText: 'Start Extraction',
        });
        Object.assign(btn.style, {
            flex: '1', padding: '6px 10px',
            background: '#89b4fa', color: '#11111b',
            border: 'none', borderRadius: '4px',
            fontWeight: 'bold', cursor: 'pointer', fontFamily: 'monospace',
        });
    
        const stopBtn = Object.assign(document.createElement('button'), {
            innerText: 'Stop',
        });
        Object.assign(stopBtn.style, {
            padding: '6px 10px',
            background: '#f38ba8', color: '#11111b',
            border: 'none', borderRadius: '4px',
            fontWeight: 'bold', cursor: 'pointer', fontFamily: 'monospace',
            display: 'none',
        });
    
        const exportBtn = Object.assign(document.createElement('button'), {
            innerText: 'Export',
        });
        Object.assign(exportBtn.style, {
            flex: '1', padding: '6px 10px',
            background: '#a6e3a1', color: '#11111b',
            border: 'none', borderRadius: '4px',
            fontWeight: 'bold', cursor: 'pointer', fontFamily: 'monospace',
            display: 'none',
        });
    
        btnRow.append(btn, stopBtn, exportBtn);
    
        const body = document.createElement('div');
        body.append(statusEl, note, btnRow);
    
        panel.append(titleRow, body);
    
        panel.style.display = 'none';
        document.body.appendChild(panel);
    
        GM_registerMenuCommand('Show / Hide Extractor Panel', () => {
            panel.style.display = panel.style.display === 'none' ? '' : 'none';
        });
    
        // sessionStorage (not GM_setValue) is the right store here: it
        // survives exactly one reload of this tab and is gone the moment
        // the tab/window closes, so there's no separate "turn it back off"
        // step to remember — consuming the flag below on the very next load
        // is the only cleanup needed.
        const AUTO_START_ONCE_KEY = 'extractorAutoStartOnce';
        const _autoStartOnce = sessionStorage.getItem(AUTO_START_ONCE_KEY) === '1';
        if (_autoStartOnce) sessionStorage.removeItem(AUTO_START_ONCE_KEY); // consume now — only this load gets it
        console.log('[Extractor] one-shot auto-start consumed at this load =', _autoStartOnce);
        GM_registerMenuCommand('Reload and Auto-Start (this load only)', () => {
            sessionStorage.setItem(AUTO_START_ONCE_KEY, '1');
            location.reload();
        });
    
        toggleBtn.onclick = () => {
            panel.style.display = 'none';
        };
    
        let elapsedTimer = null;
        const formatElapsed = ms => {
            const totalSeconds = Math.max(0, Math.floor(ms / 1000));
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = String(totalSeconds % 60).padStart(2, '0');
            return `${minutes}:${seconds}`;
        };
        const updateElapsed = () => {
            elapsedEl.innerText = _perf.runStartMs > 0
                ? `Elapsed : ${formatElapsed(performance.now() - _perf.runStartMs)}`
                : 'Elapsed : —';
        };
        const stopElapsedTimer = () => {
            if (elapsedTimer !== null) {
                clearInterval(elapsedTimer);
                elapsedTimer = null;
            }
        };
    
        const ui = {
            stopped: false,
            total: 0,
            isAutoStart: _autoStartOnce,
            status(promptCount, msgCount) {
                // this.total is the nav-dot count — a count of prompts, not
                // messages — so only the prompt line has a meaningful
                // percentage to show against it.
                this.total = rememberExpectedUserPrompts(this.total || getNavMenuItems().length);
                const userMsgSummary = formatUserMsgSummary(promptCount, this.total);
                promptsEl.innerText    = `User msgs: ${userMsgSummary}`;
                msgsEl.innerText       = `All msgs : ${msgCount}`;
                updateElapsed();
                console.log(`[Extractor] STATUS: user msgs ${userMsgSummary} | msgs ${msgCount}`);
            },
            log(msg) {
                updateElapsed();
                console.log(`[Extractor] ${msg}`);
            },
        };
    
        const showRunningState = () => {
            ui.stopped = false;
            elapsedEl.innerText = 'Elapsed : 0:00';
            stopElapsedTimer();
            elapsedTimer = setInterval(updateElapsed, 1000);
            btn.disabled = true;
            Object.assign(btn.style, { background: '#45475a', color: '#585b70' });
            note.style.display = 'none';
            stopBtn.style.display = '';
            exportBtn.style.display = 'none';
        };
    
        const setIdleNote = (label, stopped) => {
            if (label === 'Resume from current') {
                note.innerText = 'Resume continues from the saved current slab. The adaptive jump size is not reduced for this non-detached stop.';
            } else if (label === 'Retry') {
                note.innerText = 'Retry starts a fresh attempt. If current detached, the adaptive jump size was already reduced before stopping.';
            } else if (stopped) {
                note.innerText = 'Restart starts again from the conversation edge. Export is available for the partial or completed result.';
            } else {
                note.innerText = `Scroll to the ${WALK_DIRECTION === -1 ? 'BOTTOM' : 'TOP'} of the chat before starting.`;
            }
        };
    
        const showIdleState = (label, stopped) => {
            updateElapsed();
            stopElapsedTimer();
            stopBtn.style.display = 'none';
            exportBtn.style.display = _savedState ? '' : 'none';
            btn.disabled = false;
            Object.assign(btn.style, { background: '#89b4fa', color: '#11111b' });
            btn.innerText = label;
            setIdleNote(label, stopped);
            if (stopped) note.style.display = '';
        };
    
        attachStartExtractionListener({
            button: btn,
            stopButton: stopBtn,
            ui,
            showRunningState,
            showIdleState,
            run,
            getResumeState: () => _resumeState,
            setResumeState: value => { _resumeState = value; },
            getPendingAutoRestart: () => _pendingAutoRestart,
            setPendingAutoRestart: value => { _pendingAutoRestart = value; },
            getSavedState: () => _savedState,
        });
    
        attachExportListener({
            button: exportBtn,
            ui,
            getSavedState: () => _savedState,
            exportMarkdown,
            countPrompts,
        });
    
        // Exists specifically to minimize dwell time at whichever edge the
        // page loads scrolled to (normally the bottom) before extraction's
        // own opposite-edge diversion (see run()) gets a chance to act —
        // waiting for a manual click leaves an arbitrary, often multi-second
        // gap for ChatGPT's own eager-render behavior to settle in
        // unbothered. Polls rather than assumes readiness, since the page's
        // own hydration time is exactly the part of the dwell window this
        // can't shrink any further.
        attachAutoStartListener({
            enabled: _autoStartOnce,
            panel,
            startButton: btn,
            sleep,
            getNavMenuItems,
        });
    }
    
    buildUI();
    
}
