// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      4.65
// @description  Extracts a full ChatGPT conversation to Markdown via automated scrolling.
// @author       Claude
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // Measures actual setTimeout delay minus requested delay on every single
    // sleep() call in the script (there's one definition, called everywhere)
    // — a direct symptom of event-loop starvation, regardless of whether the
    // cause is CPU contention, a backgrounded tab, or anything else that
    // makes the browser late to fire a timer it already scheduled.
    const sleep = ms => new Promise(r => {
        const t0 = performance.now();
        setTimeout(() => {
            const slip = performance.now() - t0 - ms;
            _perf.sleepSlip.count++;
            _perf.sleepSlip.sum += slip;
            if (slip > _perf.sleepSlip.max) _perf.sleepSlip.max = slip;
            r();
        }, ms);
    });

    // ── Performance counters (reset each run, reported before export) ──
    let _perf = {};
    function _resetPerf() {
        _perf = {
            htmlToMarkdownCalls: 0, htmlToMarkdownMs: 0,
            blankWaits: 0,
            snapshots: [],
            runStartMs: 0,
            containerTag: '', containerScrollH: 0, containerClientH: 0, containerIsDocEl: false,
            navItemCount: 0, navClickedIndex: -1, navClickScrollTop: 0, navClickScrollPct: 0,
            navFirstLabel: '', navLastLabel: '',
            navDiversionAttempted: false, navDiversionSettled: false,
            bootstrapRole: '', bootstrapWasIntersectingFalse: false,
            maxAdvancesWithoutProgress: 0, turnIdDedupSkips: 0, turnIdDedupMaxRun: 0,
            multiCandidatesInReadyContainer: 0, multiCandidatesMax: 0,
            readyMargin: { count: 0, sum: 0, max: 0, maxWinner: null },
            containerReach: { count: 0, sum: 0, max: 0, maxWinner: null },
            sleepSlip: { count: 0, sum: 0, max: 0 },
            tabHidden: { wasHidden: false, hideCount: 0 },
            contentChangedAfterExtraction: { count: 0, examples: [] },
            postReadyMutations: { count: 0, examples: [] },
            preReadyMutations: {
                count: 0, examples: [], containersWithAny: 0,
                readyDelayMs: { count: 0, sum: 0, max: 0 },
            },
            discoverySnapshot: {
                totalContainers: 0, alreadyHadMessageAtDiscovery: 0,
                alreadyHadNonEmptyTextAtDiscovery: 0, textAtDiscoveryWhileNotIntersecting: 0,
                alreadyHadImageAtDiscovery: 0, imageAtDiscoveryWhileNotIntersecting: 0,
                diffExamples: [],
            },
            compositeFingerprint: {
                candidates: 0, matchedFinalText: 0, mismatchedFinalText: 0,
                matchedFirst: 0, mismatchedFirst: 0, matchedLater: 0, mismatchedLater: 0,
                // The join: of the candidates whose container's own readiness
                // flag (data-is-intersecting) was still 'false' at the exact
                // moment this candidate registered, how many matched anyway?
                // This is the direct evidence for "content existing despite
                // the flag still saying not-ready is safely sufficient for
                // readiness" — not inferred from two separate aggregate
                // counts that were never actually joined before this.
                matchedWhileNotIntersecting: 0, mismatchedWhileNotIntersecting: 0,
                fieldExercised: { codeBlocks: 0, images: 0, tables: 0, placeholders: 0 },
                imageCandidateDetails: [],
                examples: [],
            },
            maxContainerGap: 0, containerGapViolations: 0, containerGapSkippedDetached: 0,
            viewportMovesBringIntoView: 0, viewportMovesStimulate: 0, viewportMovesForceEdge: 0,
            // Diagnoses whether the image-only-turn fallback (no
            // [data-message-author-role] anywhere in the container) ever
            // actually engages: anchorlessContainers counts how many times
            // findNextPromptIn/findBootstrapMessage saw a container with no
            // anchor at all; turnElementMissing counts how many of those had
            // no [data-turn] element either (self or descendant) to use as a
            // fallback candidate; candidatesFound/extracted track whether a
            // found candidate actually made it into allPrompts.
            imageOnlyTurns: { anchorlessContainers: 0, turnElementMissing: 0, candidatesFound: 0, extracted: 0 },
            // A candidate that findNextPromptIn geometrically confirmed but
            // extractMessage(el) returned null for (htmlToMarkdown produced
            // no text — e.g. an image-generation turn whose container passed
            // the virtualization-readiness gate before the actual <img> ever
            // landed in the DOM). Before this counter existed, that case was
            // indistinguishable from success in the log: current/lastEl
            // still advanced past the element either way, silently dropping
            // it from the export forever with no error and no diagnostic.
            extractionFailures: { count: 0, examples: [] },
            // Dedicated, independently-lived observers (see
            // watchForToComeFingerprint) attached the instant a turn is
            // found anchorless-and-imageless at the moment it's declared
            // ready. Unlike _activeLifecycleObserver (replaced/disconnected
            // the moment the walk moves to the next container, ~1s after
            // ready in the retry-loop case), these keep running independent
            // of the main walk, specifically to find what — if anything —
            // shows up between "ready" and the <img> actually landing.
            toComeFingerprint: { watches: [] },
            scrollHeightGrowthCheck: { before: null, after: null, grewBy: null },
        };
    }
    _resetPerf();

    let _savedState = null;
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
        const anchor = document.querySelector('[data-message-author-role]');
        if (anchor) {
            let el = anchor.parentElement;
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

    function totalViewportMoves() {
        return _perf.viewportMovesBringIntoView + _perf.viewportMovesStimulate + _perf.viewportMovesForceEdge;
    }

    const escLabel = s => s.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
    const escUrl   = s => s.replace(/>/g, '%3E');
    const escHtmlAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
            // every extraction that targeted the narrower anchor, but a real
            // leak now that image-only turns are extracted from their
            // section as a whole (see findNextPromptIn/findBootstrapMessage).
            if (/\bsr-only\b/.test(node.getAttribute('class') || '')) return '';
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
        _perf.htmlToMarkdownCalls++;
        const _t0 = performance.now();
        const _result = walk(el, 0)
            .trim()
            .replace(/\n{3,}/g, '\n\n')
            .replace(
                /^([^\s/]+\.\w{2,6})\s*(?:File|Image|Document|Spreadsheet|Presentation|[A-Z]{2,6})$/gm,
                (_match, filename) => `Upload: ${filename}`
            )
            .replace(/\n{3,}/g, '\n\n');
        _perf.htmlToMarkdownMs += performance.now() - _t0;
        return _result;
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

    async function exportMarkdown(ui, prompts, includeDiag = false, stopped = false, exportTimestamp = Date.now()) {
        const questions = countPrompts(prompts);
        const date  = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        const title = getChatTitle();
        // Shared by the .md filename and every image filename below, fixed
        // once per RUN (passed in by the caller, see _runTimestamp) rather
        // than generated fresh here — re-clicking "Export again" against the
        // same run must keep reusing the same timestamp, since any images
        // already downloaded for this run have it baked into their
        // filenames already on disk.

        // Count prompt navigation dots for the diagnostic (dot count vs exported count).
        const promptDots = getNavMenuItems();

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
        if (includeDiag && _perf.runStartMs > 0) {
            const _ms    = performance.now() - _perf.runStartMs;
            const _sleep = _ms - _perf.htmlToMarkdownMs;

            md += `    ── perf (v4.65) ──\n`
                + `    total ${(_ms/1000).toFixed(1)}s | sleep/wait ${(_sleep/1000).toFixed(1)}s (${Math.round(100*_sleep/_ms)}%) | blank waits ${_perf.blankWaits}\n`
                + `    htmlToMarkdown: ${_perf.htmlToMarkdownCalls} calls, ${Math.round(_perf.htmlToMarkdownMs)}ms\n`
                + `    Exported ${countPrompts(prompts)} prompts (${prompts.length} msgs).\n`
                + `\n`
                + `    ── diag (v4.65) ──\n`
                + `    Timer slip (actual setTimeout delay minus requested — large values mean the event loop ` +
                  `was starved, by CPU contention or a backgrounded tab; everything else in this diag block ` +
                  `should be read with that in mind if slip is high): ${_perf.sleepSlip.count} sample(s), ` +
                  `avg ${_perf.sleepSlip.count ? Math.round(_perf.sleepSlip.sum / _perf.sleepSlip.count) : 0}ms, ` +
                  `max ${Math.round(_perf.sleepSlip.max)}ms\n`
                + `    Tab visibility: went to background ${_perf.tabHidden.hideCount} time(s) during this run` +
                  (_perf.tabHidden.wasHidden ? ' — readiness-timing conclusions below are confounded by this\n' : ' (stayed visible throughout)\n')
                + `    Content changed after extraction (tests whether a message's own text was still populating when ` +
                  `the container-ready flag said it was safe to extract — a few checks scheduled near the very end of ` +
                  `the run may not have resolved yet): ${_perf.contentChangedAfterExtraction.count} occurrence(s)\n` +
                  _perf.contentChangedAfterExtraction.examples.slice(0, 5).map(e => `      ${e}\n`).join('')
                + `    Discovery snapshot vs ready snapshot (catches a fingerprint that's already in its final state ` +
                  `the moment a container is first discovered — never mutates at all during the wait, so the mutation ` +
                  `log below is structurally blind to it): of ${_perf.discoverySnapshot.totalContainers} container(s), ` +
                  `${_perf.discoverySnapshot.alreadyHadMessageAtDiscovery} already had a [data-message-author-role] ` +
                  `element at discovery and ${_perf.discoverySnapshot.alreadyHadNonEmptyTextAtDiscovery} of those ` +
                  `already had non-empty text — ${_perf.discoverySnapshot.textAtDiscoveryWhileNotIntersecting} of those ` +
                  `specifically while data-is-intersecting was still 'false' (not inferred, directly measured). Same check ` +
                  `for images: ${_perf.discoverySnapshot.alreadyHadImageAtDiscovery} container(s) already had an <img> at ` +
                  `discovery, ${_perf.discoverySnapshot.imageAtDiscoveryWhileNotIntersecting} of those specifically while ` +
                  `data-is-intersecting was still 'false' — this is the direct answer to whether the img tag can precede ` +
                  `the container's own readiness flag, the same way text already does\n` +
                  _perf.discoverySnapshot.diffExamples.map(e => `      ${e}\n`).join('')
                + `    Composite fingerprint test (message exists + non-empty text + no skeleton class, checked at ` +
                  `discovery — does the full structural signature at that early moment, including code blocks/` +
                  `images/tables/placeholders, match what's actually extracted after the full wait?): ` +
                  `${_perf.compositeFingerprint.candidates} candidate(s), ` +
                  `${_perf.compositeFingerprint.matchedFinalText} matched, ` +
                  `${_perf.compositeFingerprint.mismatchedFinalText} mismatched` +
                  (_perf.compositeFingerprint.mismatchedFinalText > 0 ? ', examples below:\n' : '\n') +
                  `      breakdown — first-in-container: ${_perf.compositeFingerprint.matchedFirst} matched, ` +
                  `${_perf.compositeFingerprint.mismatchedFirst} mismatched | later sibling in a multi-candidate ` +
                  `container: ${_perf.compositeFingerprint.matchedLater} matched, ` +
                  `${_perf.compositeFingerprint.mismatchedLater} mismatched\n` +
                  `      breakdown — while the CONTAINER's own data-is-intersecting was still 'false' at this exact ` +
                  `candidate's discovery (the direct test of "content existing despite the flag still saying ` +
                  `not-ready is safely sufficient for readiness", not inferred from separate aggregates): ` +
                  `${_perf.compositeFingerprint.matchedWhileNotIntersecting} matched, ` +
                  `${_perf.compositeFingerprint.mismatchedWhileNotIntersecting} mismatched\n` +
                  `      field exercise (how many comparisons actually had a non-zero value for this field — a clean ` +
                  `result on a field that was never exercised proves nothing about that field): ` +
                  Object.entries(_perf.compositeFingerprint.fieldExercised).map(([k, v]) => `${k}=${v}`).join(', ') + '\n' +
                  (_perf.compositeFingerprint.imageCandidateDetails.length > 0
                    ? `      image candidates (near-zero delay means already-rendered at discovery — not a real test of ` +
                      `the not-ready→ready cycle for that message; a substantial delay means it actually was):\n` +
                      _perf.compositeFingerprint.imageCandidateDetails.map(e => `        ${e}\n`).join('')
                    : '') +
                  _perf.compositeFingerprint.examples.map(e => `      ${e}\n`).join('')
                + `    Mutations BEFORE container declared ready (the not-ready→ready transition itself — this, not ` +
                  `the post-ready section below, is where an undiscovered message-level readiness fingerprint would ` +
                  `actually live): ${_perf.preReadyMutations.count} occurrence(s) across ` +
                  `${_perf.preReadyMutations.containersWithAny} container(s); discovery-to-ready delay avg ` +
                  `${_perf.preReadyMutations.readyDelayMs.count ? Math.round(_perf.preReadyMutations.readyDelayMs.sum / _perf.preReadyMutations.readyDelayMs.count) : 0}ms, ` +
                  `max ${_perf.preReadyMutations.readyDelayMs.max}ms` +
                  (_perf.preReadyMutations.count > 0 ? ', first examples below:\n' : ' — no mutations seen before readiness on any container this run\n') +
                  _perf.preReadyMutations.examples.map(e => `      ${e}\n`).join('')
                + `    Mutations after container declared ready (discovery instrumentation — any DOM change in a ` +
                  `container's subtree after we already trusted it; useful for spotting deferred UI work like editors, ` +
                  `not for finding a readiness fingerprint, since by definition this is all post-readiness): ` +
                  `${_perf.postReadyMutations.count} occurrence(s)` +
                  (_perf.postReadyMutations.count > 0 ? ', first examples below:\n' : ' — none observed this run\n') +
                  _perf.postReadyMutations.examples.map(e => `      ${e}\n`).join('')
                + (() => {
                    const n = promptDots.length;
                    const exported = countPrompts(prompts);
                    if (n === 0) return `    TOC count: not visible at export time | exported: ${exported}\n`;
                    const status = n === exported ? 'OK' : stopped ? 'STOPPED' : 'MISMATCH';
                    return `    TOC count: ${n} prompts | exported: ${exported} → ${status}\n`;
                })()
                + `    Scroll container: <${_perf.containerTag}> scrollH=${_perf.containerScrollH} clientH=${_perf.containerClientH}` +
                  (_perf.containerIsDocEl ? ' — FALLBACK (no scrollable ancestor found; using <html>)\n' : '\n')
                + `    Nav click: ${_perf.navItemCount} item(s), clicked index ${_perf.navClickedIndex} → ` +
                  `landed at scrollTop=${_perf.navClickScrollTop} (${_perf.navClickScrollPct}% through document)\n`
                + `    Scroll-height growth check (forceScrollToEdge's own stability check only confirms the position held for ` +
                  `450ms against whatever scrollHeight was at that instant — it never confirms scrollHeight itself stopped ` +
                  `growing; re-measured 5s later with no further scrolling to check directly): before=${_perf.scrollHeightGrowthCheck.before}, ` +
                  `after=${_perf.scrollHeightGrowthCheck.after}, grew by ${_perf.scrollHeightGrowthCheck.grewBy}px` +
                  (_perf.scrollHeightGrowthCheck.grewBy > 0
                    ? ' — IT WAS STILL GROWING, the locked-in edge was likely premature\n'
                    : ' — stable, no further growth detected\n')
                + `    Nav labels: first="${_perf.navFirstLabel}" last="${_perf.navLastLabel}"\n`
                + (_perf.navDiversionAttempted
                    ? `    Nav diversion: visited the opposite edge before bootstrap and dwelled 2s — settled=${_perf.navDiversionSettled} ` +
                      `(intended to force the target edge's containers through a real unmount before the walk starts)\n`
                    : `    Nav diversion: skipped${ui.isAutoStart ? ' — auto-start run, freshness already guaranteed by the reload itself' : ''}\n`)
                + `    Bootstrap: role=${_perf.bootstrapRole}, container was data-is-intersecting="false"=${_perf.bootstrapWasIntersectingFalse}\n`
                + `    Turn-id dedup: ${_perf.turnIdDedupSkips} candidate(s) skipped, longest same-turn-id run ${_perf.turnIdDedupMaxRun}, ` +
                  `max consecutive advances-without-progress ${_perf.maxAdvancesWithoutProgress}\n`
                + `    Image-only turns (no [data-message-author-role] in container): anchorless containers seen ` +
                  `${_perf.imageOnlyTurns.anchorlessContainers}, missing [data-turn] element ${_perf.imageOnlyTurns.turnElementMissing}, ` +
                  `candidates found ${_perf.imageOnlyTurns.candidatesFound}, extracted ${_perf.imageOnlyTurns.extracted}\n`
                + `    Extraction failures (candidate confirmed geometrically but extractMessage returned empty even ` +
                  `after retrying — permanent content loss, not just a slow render): ${_perf.extractionFailures.count} ` +
                  `occurrence(s)${_perf.extractionFailures.count > 0 ? ', examples below:\n' : '\n'}` +
                  _perf.extractionFailures.examples.map(e => `      ${e}\n`).join('')
                + `    To-come fingerprint watches (anchorless + imageless turns at the exact moment they were declared ` +
                  `ready — independent of the retry loop above, watched for up to ${Math.round(TO_COME_TIMEOUT_MS / 1000)}s to see what, ` +
                  `if anything, shows up before the <img> does): ${_perf.toComeFingerprint.watches.length} watch(es)\n` +
                  _perf.toComeFingerprint.watches.map(w => {
                    const elapsedMs = Math.round(performance.now() - w.startedAt);
                    const status = w.resolvedMs !== null ? `<img> arrived at +${w.resolvedMs}ms`
                      : w.detachedAtMs !== null ? `node detached/remounted at +${w.detachedAtMs}ms — likely virtualization, not "nothing happened"`
                      : w.timedOut ? `never arrived within ${Math.round(TO_COME_TIMEOUT_MS / 1000)}s (node stayed connected throughout)`
                      : `STILL PENDING at export time (+${elapsedMs}ms of ${TO_COME_TIMEOUT_MS}ms budget elapsed) — re-check this export later, or wait longer before exporting, for a conclusive result`;
                    return `      turnId=${w.turnId}: ${status}, ` +
                      `${w.events.length} event(s) observed${w.events.length > 0 ? ':\n' : '\n'}` +
                      `        rect at watch start: ${w.rectAtStart}\n` +
                      `        scope check: ${w.scopeCheck}\n` +
                      w.events.map(e => `        ${e}\n`).join('') +
                      (w.domDumpAtTimeout
                        ? `        DOM dump at timeout (every descendant — only an <img> tag is currently extracted, so anything ` +
                          `else here, e.g. a non-none background-image, is exactly what's currently invisible to extraction):\n` +
                          w.domDumpAtTimeout.split('\n').map(l => `          ${l}\n`).join('')
                        : '');
                  }).join('')
                + `    Adjacency (container): max gap ${Math.round(_perf.maxContainerGap)}px, ${_perf.containerGapViolations} violation(s) over ` +
                  `${ADJACENCY_MARGIN}px, ${_perf.containerGapSkippedDetached} skipped (readyContainer was detached)\n`
                + `    Viewport moves: ${_perf.viewportMovesBringIntoView} (bringIntoView) + ${_perf.viewportMovesStimulate} (stimulate) + ` +
                  `${_perf.viewportMovesForceEdge} (forceScrollToEdge) = ${totalViewportMoves()} total\n`
                + `    Ready-container multi-candidate: ${_perf.multiCandidatesInReadyContainer} occurrence(s), max ${_perf.multiCandidatesMax} candidate(s) at once ` +
                  `— ${_perf.multiCandidatesInReadyContainer > 0 ? 'DOM-order draining invariant was exercised; verify export order around these points' : 'invariant never exercised (always ≤1 candidate) on this run'}\n`
                + `    Ready margin (how far past the viewport edge content is already lit when a turn resolves): ` +
                  `${_perf.readyMargin.count} sample(s), avg ${_perf.readyMargin.count ? Math.round(_perf.readyMargin.sum / _perf.readyMargin.count) : 0}px, ` +
                  `max ${Math.round(_perf.readyMargin.max)}px (clientHeight=${_perf.containerClientH}px)\n`
                + (_perf.readyMargin.maxWinner
                    ? `      max-margin winner: data-turn-id=${_perf.readyMargin.maxWinner.turnId}, ` +
                      `had data-is-intersecting attr=${_perf.readyMargin.maxWinner.hadAttr} (value="${_perf.readyMargin.maxWinner.attrValue}"), ` +
                      `absolute position ${Math.round(_perf.readyMargin.maxWinner.absTop)}px of ${_perf.readyMargin.maxWinner.scrollH}px document ` +
                      `(${Math.round(100 * _perf.readyMargin.maxWinner.absTop / _perf.readyMargin.maxWinner.scrollH)}%)\n`
                    : '')
                + `    Container reach (how far past a container's own entry edge extraction found a slab — ` +
                  `direct evidence for/against whole-container readiness, not just near-edge readiness): ` +
                  `${_perf.containerReach.count} sample(s), avg ${_perf.containerReach.count ? Math.round(_perf.containerReach.sum / _perf.containerReach.count) : 0}px, ` +
                  `max ${Math.round(_perf.containerReach.max)}px\n`
                + (_perf.containerReach.maxWinner
                    ? `      max-reach winner: data-turn-id=${_perf.containerReach.maxWinner.turnId}, container height=${_perf.containerReach.maxWinner.containerHeight}px ` +
                      `(reach = ${_perf.containerReach.maxWinner.pct}% of that one container's own height)\n`
                    : '');
            if (_perf.snapshots.length > 0) {
                const snaps = _perf.snapshots;

                // Select one representative snapshot per 10% position in the
                // recorded chronological sequence — not per 10% of q (prompt
                // count). Bucketing by q breaks down the moment q stalls: a
                // run that confirms only a handful of prompts before getting
                // stuck (common under contention) has every later, time-
                // triggered snapshot compute to the same pct=100% relative to
                // the final q, so the very first one to reach it greedily
                // fills all remaining rows and every subsequent snapshot —
                // exactly the new ones the time-based ticker exists to
                // capture — gets silently discarded. Indexing by position
                // instead guarantees bp=0 is always the first snapshot,
                // bp=100 is always the last, and the rows in between are
                // spread evenly across real elapsed time regardless of
                // whether q ever moves.
                const BKPTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
                const displaySnaps = BKPTS.map(bp => ({
                    snap: snaps[Math.min(snaps.length - 1, Math.round(bp / 100 * (snaps.length - 1)))],
                    bp,
                }));

                const IND = '    ';
                const hdrs = ['bp', 'dur', 'all', 'user', 'cont', 'view', 'size', '↑', '↓'];
                const caps = [10, 18, 11, 9, 9, 9, 8, 4, 4];
                // bp/dur/all/user/cont/view form the left half, size/↑/↓ the
                // right half — generalized (not hardcoded indices) since
                // adding cont/view/user changed the split from 3+3 to 6+3.
                const LEFT_COLS = 6;

                const clip = (s, w) => {
                    s = String(s);
                    return s.length <= w ? s : s.slice(0, Math.max(0, w - 1)) + '…';
                };
                const cell = (s, w, left = false) => {
                    s = clip(s, w);
                    return left ? s.padEnd(w) : s.padStart(w);
                };
                const border = (l, m, r, w) =>
                    IND + l + w.map(n => '─'.repeat(n)).join(m) + r + '\n';
                const row = (xs, w) =>
                    IND + '│' + xs.map((x, i) => cell(x, w[i], i >= 1 && i < LEFT_COLS)).join('│') + '│\n';

                const fQ = (q, d) => `${q}(+${d})`;
                const fT = (s, ds) => {
                    const fmt = t => {
                        const h = Math.floor(t / 3600);
                        const m = Math.floor((t % 3600) / 60);
                        const r = t % 60;
                        if (h > 0) return `${h}h${String(m).padStart(2,'0')}m${String(r).padStart(2,'0')}s`;
                        if (m > 0) return `${m}m${String(r).padStart(2,'0')}s`;
                        return `${r}s`;
                    };
                    return `${fmt(s)}(+${fmt(ds)})`;
                };

                const rows = [];
                for (let i = 0; i < displaySnaps.length; i++) {
                    const { snap, bp } = displaySnaps[i];
                    const prev = i > 0 ? displaySnaps[i - 1].snap : null;
                    const cumTs  = Math.round(snap.t / 1000);
                    const prevTs = prev ? Math.round(prev.t / 1000) : 0;
                    const incM   = prev ? snap.m - prev.m : snap.m;
                    const incQ   = prev ? snap.q - prev.q : snap.q;
                    const incC   = prev ? snap.c - prev.c : snap.c;
                    const incV   = prev ? snap.v - prev.v : snap.v;
                    rows.push([
                        `${bp}%`,
                        fT(cumTs, cumTs - prevTs),
                        fQ(snap.m, incM),
                        fQ(snap.q, incQ),
                        fQ(snap.c, incC),
                        fQ(snap.v, incV),
                        String(snap.d),
                        String(snap.uBefore),
                        String(snap.uAfter),
                    ]);
                }

                const widths = hdrs.map((h, i) =>
                    Math.min(caps[i], Math.max(h.length, ...rows.map(r => r[i].length)))
                );
                const sumWidths = (from, to) => widths.slice(from, to).reduce((a, b) => a + b, 0);
                // colW = leftSum+3; need colW >= 29 for legend items → leftSum >= 26
                const leftSum = sumWidths(0, LEFT_COLS);
                if (leftSum < 26) widths[1] += 26 - leftSum;
                const innerW = widths.reduce((a, b) => a + b, 0) + widths.length - 1;
                const spanBorder  = (l, r) => IND + l + '─'.repeat(innerW) + r + '\n';
                const spanContent = text  => IND + '│' + clip(text.padEnd(innerW), innerW) + '│\n';
                const legendItems = [
                    'bp=timeline position', 'dur=elapsed(+Δ)',  'all=all messages', 'user=user messages',
                    'cont=containers advanced', 'view=viewport moves',  'size=DOM elements',
                    '↑=user msgs above', '↓=user msgs below',
                ];
                const colW = Math.floor(innerW / 2);
                const legendRow = (l, r) => {
                    const left  = clip((l || '').padEnd(colW), colW);
                    const right = clip((r || '').padEnd(innerW - colW), innerW - colW);
                    return IND + '│' + left + right + '│\n';
                };
                let out = spanBorder('┌', '┐');
                out += spanContent('Prompt discovery snapshots (▲ up pass)');
                out += spanContent('');
                const half = Math.ceil(legendItems.length / 2);
                for (let i = 0; i < half; i++)
                    out += legendRow(legendItems[i], legendItems[i + half]);
                out += border('├', '┬', '┤', widths);
                out += row(hdrs, widths);
                out += border('├', '┼', '┤', widths);
                for (let i = 0; i < rows.length; i++) {
                    out += row(rows[i], widths);
                }
                out += border('└', '┴', '┘', widths);
                md += out;
            }
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
    //      (bringIntoView, isInViewport, waitForTurnReady, findNextPromptIn's
    //      containment test) already works unmodified in either direction.
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
    const TO_COME_TIMEOUT_MS = 30_000;

    // One-time bootstrap only: find the deepest (bottom-most, direction=-1)
    // or shallowest (topmost, direction=+1) message currently visible in the
    // viewport, to seed the sequential chain walk. This is the only place
    // that scans the viewport for a message directly — every subsequent
    // prompt is found by geometric containment against a confirmed-ready
    // turn-container (see findNextPromptIn), never by scanning the viewport
    // again. A prompt only ever enters allPrompts as the verified
    // predecessor/successor of one already confirmed.
    function findBootstrapMessage(container, direction) {
        const vb = container === document.documentElement
            ? { top: 0, bottom: window.innerHeight }
            : container.getBoundingClientRect();
        // Filtering on "any overlap with the viewport" let a message whose
        // far edge bleeds well past it (e.g. a tall reply that starts above
        // the viewport and merely pokes into the bottom of it) win the
        // reduce below — its top could be far more negative than the true
        // topmost on-screen message's, even though that top edge was never
        // actually in view. The edge that matters is the one nearer the
        // walk's starting boundary — bottom for upward (direction=-1), top
        // for downward (+1) — so only elements where THAT edge is genuinely
        // inside the viewport are eligible, matching the stricter test
        // isInViewport already uses elsewhere in this file.
        const inRange = r => direction === -1
            ? (r.bottom > vb.top && r.bottom <= vb.bottom)
            : (r.top    < vb.bottom && r.top    >= vb.top);
        const candidates = [...document.querySelectorAll('[data-message-author-role]')]
            .filter(el => inRange(el.getBoundingClientRect()));
        // Image-generation turns carry no [data-message-author-role] at all
        // (confirmed via direct DOM inspection — only data-turn-id-container/
        // data-turn-id/data-turn live on the turn's own section). Only
        // relevant if the conversation's very first/last on-screen turn is a
        // standalone generated image with no anchor-based candidate at all.
        if (candidates.length === 0) {
            for (const turnContainer of document.querySelectorAll('[data-turn-id-container]')) {
                if (turnContainer.querySelectorAll('[data-message-author-role]').length > 0) continue;
                const turnSection = turnContainer.matches('[data-turn]') ? turnContainer : turnContainer.querySelector('[data-turn]');
                if (turnSection && inRange(turnSection.getBoundingClientRect())) candidates.push(turnSection);
            }
        }
        if (candidates.length === 0) return null;
        return direction === -1
            ? candidates.reduce((a, b) => a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b)
            : candidates.reduce((a, b) => a.getBoundingClientRect().top    < b.getBoundingClientRect().top    ? a : b);
    }

    // How far apart two supposedly-adjacent elements' facing edges are
    // allowed to sit (ordinary CSS margin/padding between messages, not a
    // sign anything is wrong) before it's worth recording as notable.
    // Verifies the core stability assumption the whole walk depends on: once
    // an element is confirmed/ready, its position relative to its immediate
    // neighbor doesn't drift. direction=-1: newer element is earlier
    // (above), so its bottom should sit near the older element's top.
    // direction=+1: newer element is later (below), so its top should sit
    // near the older element's bottom. Returns the signed gap (positive =
    // ordinary spacing, negative = overlap) so callers can log the actual
    // distance, not just whether it passed.
    const ADJACENCY_MARGIN = 150;
    function adjacencyGap(direction, olderRect, newerRect) {
        return direction === -1
            ? olderRect.top - newerRect.bottom
            : newerRect.top - olderRect.bottom;
    }

    // Empirically measured floors (Compatibility Check panel, "Shortest
    // user/assistant message height"): 44px / 32px on a live conversation.
    // smallExtra must stay under the smaller of the two (the next prompt
    // could be either role) so the probe point can never overshoot past the
    // immediately-adjacent message into the one before it.
    const SMALL_EXTRA = 28;

    // Finds the turn-container immediately adjacent to turnEl by geometry,
    // not DOM-sibling assumption (confirmed broken: previousElementSibling
    // returned null on the very first hop in a live test, even though 13
    // more messages existed). Queries all currently-existing
    // [data-turn-id-container] elements directly (cheap, attribute-scoped)
    // and keeps any whose rect overlaps a strip just past turnEl's edge —
    // above its top edge when walking upward (direction=-1, "previous" turn,
    // closer to the start), below its bottom edge when walking downward
    // (direction=+1, "next" turn, closer to the end). The strip height
    // escalates (8px → ... → 400px) only if nothing is found yet — handles
    // both a normal adjacent turn (found immediately) and a near-zero-height
    // unresolved placeholder (needs a larger strip to bridge to it) without
    // needing to guess which case we're in. If more than one candidate
    // overlaps, "nearest" (largest bottom edge upward / smallest top edge
    // downward) disambiguates rather than relying on the strip being
    // precisely sized. For direction=-1 this matched the original
    // upward-only findPrevTurn exactly until the turn-id dedup filter below
    // was added — a genuine behavior change for both directions, not a
    // direction-specific patch, since duplicate sibling wrappers for the
    // same turn are not a property of which way the walk is going.
    function findPrevTurn(turnEl, direction) {
        const r = turnEl.getBoundingClientRect();
        const edge = direction === -1 ? r.top : r.bottom;
        const turnId = turnEl.getAttribute('data-turn-id');
        for (let h = 8; h <= 400; h *= 2) {
            const afterContainment = [...document.querySelectorAll('[data-turn-id-container]')]
                // [data-turn-id-container] nests at more than one level for
                // the same logical turn (confirmed live: ~2 containers per
                // message). An ancestor/descendant of turnEl is still the
                // *same* turn wrapped differently, not an earlier/later one —
                // only a structurally unrelated container is a genuine
                // predecessor/successor.
                .filter(el => el !== turnEl && !el.contains(turnEl) && !turnEl.contains(el));
                // The above only catches duplicates that are literally
                // nested inside one another. Observed live: a single turn
                // can also have many *sibling* wrapper elements sharing the
                // identical data-turn-id (26 of them for one turn, 25 for
                // the next, in one failure) — not ancestor/descendant of
                // each other, so the filter above doesn't exclude them, and
                // each one gets "discovered" as if it were a new turn one at
                // a time, burning the entire advance budget on ~2 real
                // turns. A candidate sharing turnEl's own turn-id is never a
                // real predecessor/successor regardless of DOM position.
                // Counted (afterContainment.length minus this filter's
                // output) so even successful runs reveal how often this
                // matters, not just the runs that hit the advance cap.
            const dedupedByTurnId = afterContainment
                .filter(el => !turnId || el.getAttribute('data-turn-id') !== turnId);
            _perf.turnIdDedupSkips += afterContainment.length - dedupedByTurnId.length;
            const candidates = dedupedByTurnId.filter(el => {
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
        return null; // nothing within range — genuine start/end of conversation
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
    // reliably trigger ChatGPT's real IntersectionObserver. Shared by
    // bringIntoView's stopping condition and by waitForTurnReady's re-check
    // while polling for resolution.
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
        for (const el of document.querySelectorAll('[data-turn-id-container]')) {
            // Confirmed live: a sentinel-like element with no data-turn-id
            // at all, permanently pinned near document position 0 with
            // data-is-intersecting="true", was winning this measurement —
            // some virtualization libraries plant a boundary marker that
            // matches the same selector but isn't a real turn. Excluding
            // anything without an actual turn-id is what separates "ready
            // because it's a genuinely pre-rendered upcoming turn" from
            // "matched the selector but was never a turn to begin with."
            if (!el.hasAttribute('data-turn-id')) continue;
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
        // Identify *what* is contributing the margin, not just its size —
        // a measurement that turned out to imply ~99% of the document is
        // "ready" needs to show its work: is the winner something never
        // marked at all (hasAttribute false — never touched by the
        // observer, a different thing entirely from "resolved ready"), and
        // how far through the document does it actually sit (absolute
        // position, not viewport-relative) — that's what tells apart
        // "genuine render-ahead buffer" from "stale/already-passed/never-
        // placeholdered content being miscounted as lit."
        let winnerInfo = null;
        if (winner) {
            winnerInfo = {
                hadAttr: winner.hasAttribute('data-is-intersecting'),
                attrValue: winner.getAttribute('data-is-intersecting'),
                turnId: winner.getAttribute('data-turn-id') || '(none)',
                absTop: absoluteY(container, winner),
                scrollH,
            };
        }
        return { margin, winnerInfo };
    }

    function recordReadyMargin(container) {
        const { margin, winnerInfo } = measureReadyMargin(container, WALK_DIRECTION);
        _perf.readyMargin.count++;
        _perf.readyMargin.sum += margin;
        if (margin > _perf.readyMargin.max) {
            _perf.readyMargin.max = margin;
            _perf.readyMargin.maxWinner = winnerInfo;
        }
    }

    // Discovery instrumentation, not a behavior change. Unlike a version
    // that starts watching only once a container is already trusted ready,
    // this starts the instant a container is first identified as the next
    // candidate — before we know anything about its readiness — and keeps
    // watching straight through the not-ready→ready transition. A
    // message-level fingerprint, if one exists, has to live in that
    // transition, not after it: watching only afterward can never find it,
    // by construction, regardless of how many clean runs come back empty.
    // markContainerReady() (called from inside waitForTurnReady at the exact
    // moment data-is-intersecting flips, or is already not 'false') splits
    // every mutation this session sees into a pre-ready bucket and a
    // post-ready bucket on the same timeline, so "what changed before we
    // trusted it" and "what changed after" are both visible, separately.
    // Event-driven, not polled — costs nothing between mutations. Replaced
    // each time a new container becomes the current candidate, so cost stays
    // bounded to one container's subtree at a time.
    // Complements the mutation observer above rather than replacing it: a
    // MutationObserver only ever reports changes, so a fingerprint that's
    // already in its final state the instant a container is first
    // discovered — e.g. the message wrapper already exists with non-empty
    // text while data-is-intersecting is still 'false' — would never
    // generate a mutation at all and is invisible to it by construction.
    // Snapshotting the candidate's own message-relevant properties at
    // discovery and again at the ready-declared moment, then diffing them
    // directly, is the only way to catch that case.
    //
    // Keyed by the message element itself (not msgId) so a lookup at actual
    // extraction time needs no bookkeeping beyond "was this exact node ever
    // a composite-fingerprint candidate" — entries are removed once compared,
    // and any left over for elements that never get extracted are reclaimed
    // normally once the element is garbage-collected.
    const _compositeSnapshots = new WeakMap();
    // Plain innerText equality (what the composite-fingerprint test originally
    // compared) only proves visible text stopped changing — it says nothing
    // about whether images have finished loading, code blocks are still being
    // syntax-highlighted, or tables are still being assembled, all of which
    // are part of what htmlToMarkdown() actually extracts. A message could
    // pass the text-equality test while still being structurally incomplete.
    // This captures the richer per-message signature so the comparison can
    // catch that gap instead of just text length.
    function summarizeMessageStructure(el, container) {
        // [data-message-author-role] is an anchor — a point marking where a
        // message starts — not necessarily the area holding everything
        // visually part of it. Text happens to nest inside the anchor's own
        // subtree (which is why text extraction has always worked), but a
        // media element positioned absolutely can render as a sibling
        // outside that subtree entirely, invisible to a search scoped to
        // the anchor. The container is the actual content area. Only trusted
        // when the container holds exactly one message, though: attributing
        // an image to the right one of several messages in a shared
        // container would need the same geometric reasoning
        // findNextPromptIn already applies to anchors — deferred rather
        // than guessed at here, so the multi-message case falls back to the
        // anchor-scoped search (undercounts there, but doesn't miscount).
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
    function summarizeContainerCandidate(turnEl) {
        const msgEls = turnEl.querySelectorAll('[data-message-author-role]');
        const firstMsg = msgEls[0] || null;
        return {
            dataIsIntersecting: turnEl.getAttribute('data-is-intersecting'),
            className: turnEl.className,
            childCount: turnEl.children.length,
            rectHeight: Math.round(turnEl.getBoundingClientRect().height),
            messageElementCount: msgEls.length,
            firstMessageTextLen: firstMsg ? firstMsg.innerText.length : null,
            // Whole-container check (not the message/imageScope-level scoping
            // summarizeMessageStructure uses) — this is a coarse discovery-
            // vs-ready diagnostic, not an extraction-accuracy one, so it only
            // needs to answer "did an <img> exist anywhere in here yet."
            hasImage: turnEl.querySelectorAll('img').length > 0,
        };
    }
    let _activeLifecycleObserver = null;
    let _activeLifecycleReadyDeclared = false;
    let _activeLifecycleT0 = 0;
    let _activeLifecycleHadPreMutation = false;
    let _activeLifecycleTurnEl = null;
    let _activeLifecycleDiscoverySnapshot = null;
    function watchContainerLifecycle(turnEl) {
        if (_activeLifecycleObserver) _activeLifecycleObserver.disconnect();
        _activeLifecycleReadyDeclared = false;
        _activeLifecycleHadPreMutation = false;
        _activeLifecycleTurnEl = turnEl;
        _activeLifecycleDiscoverySnapshot = summarizeContainerCandidate(turnEl);
        _perf.discoverySnapshot.totalContainers++;
        if (_activeLifecycleDiscoverySnapshot.messageElementCount > 0) _perf.discoverySnapshot.alreadyHadMessageAtDiscovery++;
        // "While not intersecting" is tracked as its own explicit count,
        // not inferred from "this is the discovery moment so it's probably
        // still false" — that assumption isn't always true (e.g. a
        // re-derived candidate from the findPrevTurn retry loop could already
        // be intersecting by the time it's re-registered here), so the claim
        // that content precedes the container's own readiness flag needs its
        // own direct measurement, not a coincidence of when this runs.
        if (_activeLifecycleDiscoverySnapshot.firstMessageTextLen > 0) {
            _perf.discoverySnapshot.alreadyHadNonEmptyTextAtDiscovery++;
            if (_activeLifecycleDiscoverySnapshot.dataIsIntersecting === 'false') _perf.discoverySnapshot.textAtDiscoveryWhileNotIntersecting++;
        }
        if (_activeLifecycleDiscoverySnapshot.hasImage) {
            _perf.discoverySnapshot.alreadyHadImageAtDiscovery++;
            if (_activeLifecycleDiscoverySnapshot.dataIsIntersecting === 'false') _perf.discoverySnapshot.imageAtDiscoveryWhileNotIntersecting++;
        }
        // Tests the proposed composite fingerprint (message exists + non-empty
        // text + no known skeleton class) directly, rather than by intuition:
        // if it holds at discovery, record the exact text right now, then
        // compare against whatever extractMessage() ultimately captures for
        // this same element after the FULL wait resolves. That natural
        // discovery-to-extraction interval (hundreds of ms to tens of
        // seconds) is a stronger stability test than a deliberate 2-3-poll
        // check would be, and costs nothing extra — no new delay introduced,
        // no change to wait/gating behavior.
        //
        // Snapshots every [data-message-author-role] element present at
        // discovery, not just the first: a multi-candidate container drains
        // several siblings across later loop iterations, and the first
        // candidate matching reliably says nothing about whether the 2nd,
        // 3rd, or 4th sibling is just as safe to trust early — that needs
        // its own evidence, tagged separately below.
        // Deliberately NOT gated on the container's own skeleton class: a
        // container can still show its height-placeholder while a message
        // inside it has already rendered — slower content like a generated
        // image is plausibly more likely to leave its container in that
        // state than text is, since rendering takes longer. Gating
        // registration on the container would skip exactly that case,
        // silently undoing the per-message OR-condition fix below. The
        // per-message skeleton/placeholder check a few lines down already
        // filters out genuinely-incomplete messages; a container with no
        // messages at all simply yields an empty querySelectorAll, so
        // nothing is lost by not checking the container's class first.
        {
            let idx = 0;
            for (const msgEl of turnEl.querySelectorAll('[data-message-author-role]')) {
                const isFirst = idx === 0;
                idx++;
                // Non-empty text OR a present image qualifies: a generated
                // image with no caption has innerText.length === 0 (an <img>
                // alt attribute doesn't count toward innerText), so requiring
                // text alone would silently exclude exactly the messages most
                // likely to actually contain an image — never registering
                // them as candidates, regardless of how many images they have.
                // Same anchor-vs-container scoping as summarizeMessageStructure:
                // only trusted for a single-message container, since that's
                // the only case where "an image exists somewhere in here"
                // unambiguously means "this message has an image".
                const singleMessageContainer = turnEl.querySelectorAll('[data-message-author-role]').length === 1;
                const hasImage = (singleMessageContainer ? turnEl : msgEl).querySelectorAll('img').length > 0;
                const hasContent = msgEl.innerText.length > 0 || hasImage;
                if (hasContent &&
                    !msgEl.querySelector('[class*="skeleton"], [class*="placeholder"], [data-placeholder]')) {
                    _perf.compositeFingerprint.candidates++;
                    _compositeSnapshots.set(msgEl, {
                        ...summarizeMessageStructure(msgEl, turnEl), isFirst, discoveredAt: performance.now(),
                        imageSrcs: imageSrcsFor(msgEl, turnEl),
                        // Joins this candidate to the discovery-snapshot stats
                        // above: was the *container's* readiness flag already
                        // reporting 'false' at the exact moment this candidate
                        // registered? Read from the same synchronous snapshot
                        // (no time has passed), so this is the container's
                        // state at this candidate's own discovery, not a
                        // coincidence of when watchContainerLifecycle runs.
                        containerWasNotIntersectingAtDiscovery: _activeLifecycleDiscoverySnapshot.dataIsIntersecting === 'false',
                    });
                }
            }
        }
        // Image-generation turns carry no [data-message-author-role] at all
        // — registered separately, keyed by the turn section itself (the
        // same element findNextPromptIn/findBootstrapMessage hand to
        // extractMessage), since the loop above never iterates for them.
        // A single container can hold more than one [data-turn] section (the
        // "Ready-container multi-candidate" diag stat confirms this happens
        // live) — querySelectorAll, not querySelector, the same fix already
        // applied to findNextPromptIn's anchorless branch below. Using
        // querySelector here (singular) would silently register only the
        // first such section per container, leaving any sibling permanently
        // unregistered — not a hypothetical, this was actually catching the
        // wrong (or no) turn for the original investigated failure.
        if (turnEl.querySelectorAll('[data-message-author-role]').length === 0) {
            const turnSections = turnEl.matches('[data-turn]')
                ? [turnEl, ...turnEl.querySelectorAll('[data-turn]')]
                : [...turnEl.querySelectorAll('[data-turn]')];
            for (const turnSection of turnSections) {
                const hasImage = turnSection.querySelectorAll('img').length > 0;
                const hasContent = turnSection.innerText.length > 0 || hasImage;
                if (hasContent &&
                    !turnSection.querySelector('[class*="skeleton"], [class*="placeholder"], [data-placeholder]')) {
                    _perf.compositeFingerprint.candidates++;
                    _compositeSnapshots.set(turnSection, {
                        ...summarizeMessageStructure(turnSection, turnEl), isFirst: true, discoveredAt: performance.now(),
                        imageSrcs: imageSrcsFor(turnSection, turnEl),
                        containerWasNotIntersectingAtDiscovery: _activeLifecycleDiscoverySnapshot.dataIsIntersecting === 'false',
                    });
                }
            }
        }
        const t0 = _activeLifecycleT0 = performance.now();
        const describe = m => {
            const tgt = m.target;
            const tag = tgt.nodeType === Node.ELEMENT_NODE
                ? `<${tgt.tagName.toLowerCase()}${tgt.getAttribute?.('data-message-id') ? ` msgId=${tgt.getAttribute('data-message-id')}` : ''}>`
                : '(text node)';
            const detail = m.type === 'attributes'
                ? `attr "${m.attributeName}" ${m.oldValue !== null ? `"${m.oldValue}"` : '(absent)'} → ` +
                  `"${tgt.getAttribute?.(m.attributeName)}"`
                : m.type === 'childList'
                    ? `${m.addedNodes.length} node(s) added, ${m.removedNodes.length} removed`
                    : `text changed`;
            return `${m.type} on ${tag}: ${detail}`;
        };
        const obs = new MutationObserver(mutations => {
            const dt = Math.round(performance.now() - t0);
            const bucket = _activeLifecycleReadyDeclared ? _perf.postReadyMutations : _perf.preReadyMutations;
            if (!_activeLifecycleReadyDeclared) _activeLifecycleHadPreMutation = true;
            for (const m of mutations) {
                bucket.count++;
                if (bucket.examples.length < 30) bucket.examples.push(`+${dt}ms ${describe(m)}`);
            }
        });
        obs.observe(turnEl, {
            subtree: true, childList: true,
            attributes: true, attributeOldValue: true,
            characterData: true, characterDataOldValue: true,
        });
        _activeLifecycleObserver = obs;
    }
    // Attached the instant a turn is found anchorless (no
    // [data-message-author-role]) and imageless (no <img> yet) at the exact
    // moment its container is declared ready — i.e. exactly the precondition
    // that produced the original silent-drop bug. Deliberately a separate
    // MutationObserver instance from _activeLifecycleObserver: that one gets
    // disconnected the moment watchContainerLifecycle is next called for a
    // different container, which in the retry-loop case happens only ~1s
    // after ready — far too soon to see a slower arrival. This one lives on
    // its own, independent of wherever the main walk goes next, until either
    // an <img> shows up or a generous timeout elapses.
    function watchForToComeFingerprint(turnSection, containerEl) {
        if (!turnSection) return;
        if (turnSection.querySelectorAll('[data-message-author-role]').length > 0) return;
        if (turnSection.querySelectorAll('img').length > 0) return;
        // The actual gap this guards against: turnSection might not be the
        // right scope at all. If the rendered image lands as a *sibling* of
        // turnSection rather than a descendant — somewhere else inside the
        // broader container — neither this gate nor a MutationObserver
        // scoped to turnSection would ever see it, no matter how long we
        // wait. Checked directly here, not assumed: if the container has an
        // <img> that turnSection's own narrower check missed, that's the
        // scoping bug confirmed, not "nothing happened."
        const containerHasImgTurnSectionMissed = !!(containerEl && containerEl.querySelectorAll('img').length > 0);
        // Observe the broader container, not just turnSection — covers
        // turnSection's own subtree too (it's a descendant), so this is a
        // strict widening, not a different check, and it's the only way to
        // catch an image landing as a sibling instead of inside turnSection.
        const watchRoot = containerEl || turnSection;
        const t0 = performance.now();
        // The direct test for the position hypothesis above: is this
        // element actually inside the visible viewport rectangle right now,
        // not just past ChatGPT's own virtualization gate? rect.top/bottom
        // are viewport-relative already (getBoundingClientRect's normal
        // behavior) — compared against window.innerHeight here, not against
        // the scroll container's own bounds, since what matters for a real
        // browser-level IntersectionObserver is the actual viewport, not
        // any particular scrollable ancestor.
        const r0 = turnSection.getBoundingClientRect();
        const entry = {
            turnId: turnSection.getAttribute('data-turn-id') || turnSection.closest('[data-turn]')?.getAttribute('data-turn-id') || '(none)',
            events: [], resolvedMs: null, detachedAtMs: null, timedOut: false, startedAt: t0,
            rectAtStart: `top=${Math.round(r0.top)} bottom=${Math.round(r0.bottom)} height=${Math.round(r0.height)} ` +
                `(viewport height=${window.innerHeight}) — ${r0.bottom <= 0 || r0.top >= window.innerHeight ? 'OUTSIDE visible viewport' : 'inside visible viewport'}`,
            scopeCheck: containerHasImgTurnSectionMissed
                ? 'SCOPING BUG CONFIRMED — container already has an <img> that turnSection\'s own check missed; it landed outside turnSection, not "nothing happened"'
                : 'no discrepancy at watch start — container and turnSection agreed (both 0 images)',
            domDumpAtTimeout: null,
        };
        _perf.toComeFingerprint.watches.push(entry);
        const describe = node => {
            if (node.nodeType !== 1) return '(text node)';
            const cls = (node.className || '').toString().slice(0, 70);
            return `<${node.tagName.toLowerCase()} class="${cls}">`;
        };
        const ATTR_WHITELIST = new Set(['class', 'src', 'data-is-intersecting']);
        let deadline, detachCheck;
        const finish = () => { obs.disconnect(); clearTimeout(deadline); clearInterval(detachCheck); };
        const obs = new MutationObserver(muts => {
            const dt = Math.round(performance.now() - t0);
            for (const m of muts) {
                if (m.type === 'childList') {
                    for (const n of m.addedNodes) {
                        if (n.nodeType !== 1) continue;
                        entry.events.push(`+${dt}ms added ${describe(n)}`);
                        if (n.tagName === 'IMG' || n.querySelector?.('img')) entry.resolvedMs = dt;
                    }
                } else if (m.type === 'attributes' && ATTR_WHITELIST.has(m.attributeName)) {
                    entry.events.push(`+${dt}ms attr "${m.attributeName}" on ${describe(m.target)} -> "${m.target.getAttribute(m.attributeName)}"`);
                }
            }
            if (entry.resolvedMs !== null) finish();
        });
        obs.observe(watchRoot, { subtree: true, childList: true, attributes: true });
        // A MutationObserver is bound to this exact node object — if React
        // replaces it wholesale (a remount, same data-turn-id but a new
        // node) rather than mutating it in place, removal happens on the
        // PARENT's childList, which this observer (scoped to turnSection
        // itself) never sees. Without this check, a remount and "genuinely
        // nothing happened" both look identical: 0 events, timeout reached.
        // Confirmed not hypothetical: the first real watch reported 0
        // events for a turn the user then confirmed shows a working image
        // live — virtualization remounting it mid-export, after our watcher
        // attached to the now-orphaned old node, is the most likely cause.
        detachCheck = setInterval(() => {
            if (!watchRoot.isConnected && entry.detachedAtMs === null) {
                entry.detachedAtMs = Math.round(performance.now() - t0);
                finish();
            }
        }, 500);
        deadline = setTimeout(() => {
            entry.timedOut = true;
            // The browser only ever paints what's actually in the DOM — if
            // the image is visible elsewhere, *something* represents it
            // here, even if it isn't an <img> tag. Every check so far
            // (gate, scope check, MutationObserver) only ever looked for
            // 'img' elements specifically; a CSS background-image, an SVG
            // <image>, or a <canvas> would be invisible to all of them
            // regardless of container scope. Dumped only on a genuine
            // timeout (not every watch) since this walks every descendant —
            // cheap for one event, wasteful to do unconditionally.
            entry.domDumpAtTimeout = dumpElementStructure(watchRoot);
            finish();
        }, TO_COME_TIMEOUT_MS);
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
    function markContainerReady() {
        if (_activeLifecycleReadyDeclared) return; // already marked for this session
        _activeLifecycleReadyDeclared = true;
        const dt = Math.round(performance.now() - _activeLifecycleT0);
        _perf.preReadyMutations.readyDelayMs.count++;
        _perf.preReadyMutations.readyDelayMs.sum += dt;
        if (dt > _perf.preReadyMutations.readyDelayMs.max) _perf.preReadyMutations.readyDelayMs.max = dt;
        if (_activeLifecycleHadPreMutation) _perf.preReadyMutations.containersWithAny++;
        if (_activeLifecycleTurnEl && _activeLifecycleTurnEl.isConnected && _activeLifecycleDiscoverySnapshot) {
            const after = summarizeContainerCandidate(_activeLifecycleTurnEl);
            const before = _activeLifecycleDiscoverySnapshot;
            for (const key of Object.keys(after)) {
                if (JSON.stringify(before[key]) !== JSON.stringify(after[key]) && _perf.discoverySnapshot.diffExamples.length < 30) {
                    _perf.discoverySnapshot.diffExamples.push(
                        `${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])} (discovery-to-ready ${dt}ms)`
                    );
                }
            }
        }
        if (_activeLifecycleTurnEl && _activeLifecycleTurnEl.isConnected) {
            // Same multi-turn-per-container fix as the anchorless candidate
            // registration above — querySelector (singular) would watch only
            // the first [data-turn] section, silently missing a sibling.
            // This is not hypothetical: it's the likely reason the first
            // to-come watch on a real run reported 0 events for 30s on a
            // turn the user confirmed shows a real, working image in the
            // live page — the watcher most likely had the wrong element.
            const turnSections = _activeLifecycleTurnEl.matches('[data-turn]')
                ? [_activeLifecycleTurnEl, ..._activeLifecycleTurnEl.querySelectorAll('[data-turn]')]
                : [..._activeLifecycleTurnEl.querySelectorAll('[data-turn]')];
            for (const turnSection of turnSections) watchForToComeFingerprint(turnSection, _activeLifecycleTurnEl);
        }
    }

    // target's offset within container's own scrollable content — distinct
    // from getBoundingClientRect().top, which is always viewport-relative
    // and therefore not comparable across calls if curTop itself changes.
    // Needed to answer a question none of the existing diagnostics could:
    // when bringIntoView times out, was target's true document position
    // stable the whole time (meaning it was never reachable by scrolling
    // this direction — a findPrevTurn selection bug) or did it genuinely
    // drift by a large amount during the attempt (consistent with upstream
    // content resolving) — those call for different fixes, and guessing
    // "contention" without this evidence risks papering over the former.
    function absoluteY(container, el) {
        const containerTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
        const containerScroll = container === document.documentElement ? window.scrollY : container.scrollTop;
        return (el.getBoundingClientRect().top - containerTop) + containerScroll;
    }

    // Moves the viewport exactly one height at a time — never a single big
    // jump — until target is in the viewport per isInViewport. This is the
    // only thing scrolling is for: triggering ChatGPT's intersection-driven
    // loading. A pause after each step keeps us from outrunning React's
    // virtualization the way an unthrottled scroll loop did on a large
    // conversation before. Bidirectional: isInViewport's stopping test never
    // assumed a direction, and neither should the step — the bottom-to-top
    // walk's steady state is "target is above," but a wrong-side candidate
    // or a disoriented retry can leave target genuinely below, and always
    // stepping up in that case just walks confidently away from it for the
    // whole timeout, not closer.
    async function bringIntoView(container, target, timeoutMs = 30_000, onTick = null) {
        const deadline = Date.now() + timeoutMs;
        const initialAbsY = absoluteY(container, target);
        // A single no-movement reading isn't proof of being stuck at a
        // boundary — observed live on a large conversation far from the
        // top (curTop in the tens of thousands of px): the position reverted
        // to its exact prior value after being set, consistent with the
        // browser's scroll anchoring (or ChatGPT's own scroll-restoration)
        // actively fighting our programmatic scroll while nearby content is
        // still resizing, not a hard clamp. Retry with a settle pause before
        // concluding it's genuinely stuck; a real boundary fails the same
        // way every time, a transient conflict shouldn't.
        let stuckCount = 0;
        const MAX_STUCK_RETRIES = 5;
        // Tracked purely for diagnosis if the 30s deadline fires below —
        // an intermittent "timed out" with no further detail is a guess
        // generator, not a diagnosis. These let the error report exactly
        // how it got there instead.
        let stepsAttempted = 0;
        let totalStuckEvents = 0;
        let maxStuckStreak = 0;
        let directionFlips = 0;
        let lastDirection = 0;
        while (true) {
            onTick?.(); // a long stall here is otherwise invisible to the run-level snapshot trajectory
            if (isInViewport(container, target)) return;
            const vTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
            const vBottom = container === document.documentElement ? window.innerHeight : container.getBoundingClientRect().bottom;
            if (Date.now() > deadline) {
                const curTop = container === document.documentElement ? window.scrollY : container.scrollTop;
                const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
                const finalAbsY = absoluteY(container, target);
                throw new Error(
                    `Timed out moving the viewport to reach the previous turn after ${stepsAttempted} step(s), ` +
                    `${totalStuckEvents} no-movement event(s) (longest streak ${maxStuckStreak}), ${directionFlips} direction flip(s) — ` +
                    `curTop=${curTop}, scrollHeight=${scrollH}, target.top=${Math.round(target.getBoundingClientRect().top)}, ` +
                    `viewport=[${Math.round(vTop)},${Math.round(vBottom)}]. target absolute position: ` +
                    `${Math.round(initialAbsY)} at start, ${Math.round(finalAbsY)} at timeout (moved by ${Math.round(finalAbsY - initialAbsY)}px). ` +
                    (Math.abs(finalAbsY - initialAbsY) < vBottom - vTop
                        ? `Target barely moved — it was likely never reachable by scrolling this direction (selection issue), not a loading delay.`
                        : `Target's position shifted substantially during the attempt — consistent with upstream content still resolving, not a fixed selection error.`)
                );
            }
            const curTop = container === document.documentElement ? window.scrollY : container.scrollTop;
            const stepHeight = container === document.documentElement ? window.innerHeight : container.clientHeight;
            // isInViewport asks whether target is currently visible — it
            // checks WALK_DIRECTION's edge for thoroughness, but doesn't
            // care which side target is actually on right now. The step
            // below, by contrast, must care: it used to assume the answer
            // is always "scroll up" (bottom-to-top walk direction), which
            // only holds in steady state. If target
            // is ever actually below the viewport — a wrong-side findPrevTurn
            // pick, a disoriented retry after a failed chase, or just drift —
            // always subtracting walks further from it, confidently, for the
            // full timeout, no matter how patient the retry logic is. Pick
            // the direction from where target actually is right now instead.
            const elTop = target.getBoundingClientRect().top;
            const direction = elTop <= vTop ? -1 : 1; // -1 = target above viewport, scroll up; +1 = target below, scroll down
            if (direction !== lastDirection && lastDirection !== 0) directionFlips++;
            lastDirection = direction;
            const nextTop = curTop + direction * stepHeight;
            if (container === document.documentElement) window.scrollTo({ top: nextTop, behavior: 'instant' });
            else container.scrollTop = nextTop;
            _perf.viewportMovesBringIntoView++;
            stepsAttempted++;
            await sleep(30);
            const achievedTop = container === document.documentElement ? window.scrollY : container.scrollTop;
            if (achievedTop === curTop) {
                stuckCount++;
                totalStuckEvents++;
                maxStuckStreak = Math.max(maxStuckStreak, stuckCount);
                if (stuckCount >= MAX_STUCK_RETRIES) {
                    const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
                    throw new Error(
                        `Scroll position stuck at ${curTop} for ${stuckCount} consecutive attempts while trying ` +
                        `to scroll ${direction < 0 ? 'up' : 'down'} (${stepsAttempted} step(s), ${directionFlips} ` +
                        `direction flip(s) attempted total) — target.top=${Math.round(target.getBoundingClientRect().top)}, ` +
                        `scrollHeight=${scrollH}, viewport=[${Math.round(vTop)},${Math.round(vBottom)}]. Genuine ` +
                        `boundary if curTop is near 0 (top) or near scrollHeight (bottom); otherwise likely a ` +
                        `scroll-anchoring/reflow conflict.`
                    );
                }
                await sleep(100); // let any conflicting scroll-anchoring/reflow settle before retrying
            } else {
                stuckCount = 0; // made progress — reset
            }
        }
    }

    // isInViewport is our own geometric proxy (one edge, chosen per
    // WALK_DIRECTION — see its definition) for "should be near enough to
    // trigger ChatGPT's own IntersectionObserver". It is not the same
    // condition as ChatGPT's actual trigger (different root, threshold, or
    // rootMargin are all possible), so isInViewport()===true is not proof the real observer
    // ever saw an intersection event. When a placeholder sits unresolved
    // despite passing our proxy, nudge the scroll position a few times —
    // small, fast, deliberately not a single big jump — to provoke a fresh
    // intersection transition in case the original one never fired or was
    // missed (e.g. the element was already inside our requested position
    // before the observer attached, so no edge-crossing event occurred).
    // Only runs after the placeholder has already been stuck for a bit, so
    // normal runs that resolve immediately never pay for this.
    async function stimulateIntersection(container, target) {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        _perf.viewportMovesStimulate++;
        await sleep(120);
        const curTop = container === document.documentElement ? window.scrollY : container.scrollTop;
        for (const delta of [-80, 160, -80]) {
            if (container === document.documentElement) window.scrollTo({ top: curTop + delta, behavior: 'instant' });
            else container.scrollTop = curTop + delta;
            _perf.viewportMovesStimulate++;
            await sleep(120);
        }
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        _perf.viewportMovesStimulate++;
        await sleep(250);
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
    // target on every check instead of trusting one assignment, the same
    // stuck-retry discipline bringIntoView already relies on against a
    // single target element, applied here to a raw boundary coordinate.
    // Requiring several consecutive checks to agree (not just one) also
    // means continuously re-asserting can outlast a reversion that only
    // fires after some idle period — never giving it the chance.
    async function forceScrollToEdge(container, direction, timeoutMs = 30_000) {
        const readPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
        const setPos = v => {
            if (container === document.documentElement) window.scrollTo({ top: v, behavior: 'instant' });
            else container.scrollTop = v;
            _perf.viewportMovesForceEdge++;
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

    // Mechanism A — is prevTurn (found by findPrevTurn) actually loaded?
    // ChatGPT's own lazy placeholder wrapper, [data-turn-id-container],
    // reports data-is-intersecting="false" while blank — the same
    // fingerprint the Compatibility Check panel inspects. Resolution is
    // intersection-driven, so only move the viewport if it's still blank
    // (moving it is purely to trigger that), then wait for it to clear.
    // Same 30s-then-fail discipline as everywhere else: trust the source,
    // but don't wait forever.
    async function waitForTurnReady(container, turnEl, timeoutMs = 30_000, onTick = null) {
        if (turnEl.getAttribute('data-is-intersecting') !== 'false') {
            recordReadyMargin(container);
            markContainerReady();
            return; // already resolved
        }
        await bringIntoView(container, turnEl, timeoutMs, onTick);
        const deadline = Date.now() + timeoutMs;
        let counted = false;
        let pollCount = 0;
        let pulledBackCount = 0; // how many times it had drifted out of light and needed re-pulling
        let stimulusCount = 0;
        let lastStimulusMs = 0;
        while (turnEl.getAttribute('data-is-intersecting') === 'false') {
            pollCount++;
            onTick?.(); // same reason as in bringIntoView — a long resolve-wait stall must stay visible
            // A detached node will never have its attribute updated by
            // anything — React replaced it with a different node (the same
            // remount risk discussed for dedup keys elsewhere). Waiting out
            // the full timeout here would just be a slower way to fail with
            // a misleading diagnosis; the right response is to reacquire the
            // previous turn from the current ready container, not to wait.
            if (!turnEl.isConnected)
                throw new Error('Previous turn node detached from the document while waiting for it to resolve — reacquire needed, not a timeout.');
            if (Date.now() > deadline) {
                const stillInViewport = isInViewport(container, turnEl);
                const r = turnEl.getBoundingClientRect();
                throw new Error(
                    `Timed out waiting for the previous turn to resolve after ${pollCount} poll(s), ` +
                    `${pulledBackCount} re-pull(s) back into light, ${stimulusCount} intersection-stimulus attempt(s) — ` +
                    `data-is-intersecting="${turnEl.getAttribute('data-is-intersecting')}", currently in viewport=${stillInViewport}, ` +
                    `rect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]. ` +
                    (stillInViewport
                        ? `Placeholder visible by script geometry (isInViewport) the whole time, but ChatGPT never marked it intersecting — our geometric proxy is not proof of ChatGPT's actual IntersectionObserver condition.`
                        : `Currently out of light — drifted out and the last re-pull didn't resolve it before timeout.`)
                );
            }
            if (!counted) { _perf.blankWaits++; counted = true; }
            // Light and ready are independent: being in the viewport is what
            // triggers resolution, but nothing guarantees it stays there
            // while we wait. A nearby placeholder resizing could shift it
            // back out before its own trigger ever fires — then we'd just
            // burn the rest of the timeout waiting on a trigger that can no
            // longer happen. Re-check and pull it back if that happens,
            // rather than trusting the one bringIntoView call to hold.
            if (!isInViewport(container, turnEl)) {
                pulledBackCount++;
                await bringIntoView(container, turnEl, Math.max(0, deadline - Date.now()), onTick);
            }
            const now = Date.now();
            if (now - lastStimulusMs > 1500) {
                lastStimulusMs = now;
                stimulusCount++;
                await stimulateIntersection(container, turnEl);
            }
            await sleep(50);
        }
        recordReadyMargin(container);
        markContainerReady();
    }

    // Mechanism B — given a ready container, find the next prompt by
    // geometric containment, not DOM nesting: among all currently-existing
    // [data-message-author-role] elements (the confirmed signal — never
    // assume a parent/child relationship to the container), find the one
    // whose own top + SMALL_EXTRA falls inside readyContainer's bounds
    // (top edge excluded, same boundary-exclusion principle as everywhere
    // else here). No waiting — readyContainer being ready already
    // guarantees any message geometrically inside it is fully rendered.
    // Returns every unextracted message whose probe point falls inside
    // readyContainer, not just the first — the walk only ever consumes
    // candidates[0] (DOM order), but that's only correct if DOM order
    // matches walk order whenever more than one candidate exists here.
    // That invariant is assumed, never verified, so the caller counts
    // occurrences where it was actually exercised instead of silently
    // trusting it.
    function findNextPromptIn(readyContainer, current, seenIds) {
        const r = readyContainer.getBoundingClientRect();
        const candidates = [];
        for (const el of document.querySelectorAll('[data-message-author-role]')) {
            if (el === current) continue;
            const msgId = el.getAttribute('data-message-id');
            if (msgId && seenIds.has(msgId)) continue;
            const probe = el.getBoundingClientRect().top + SMALL_EXTRA;
            if (probe > r.top && probe <= r.bottom) candidates.push(el);
        }
        // Image-generation turns carry no [data-message-author-role] at all
        // (confirmed via direct DOM inspection of a real export) — only
        // checked for a container that has none, since a container with a
        // real anchor is already fully covered by the loop above, and we
        // haven't established whether a container can mix an image turn
        // with other anchored messages.
        if (readyContainer.querySelectorAll('[data-message-author-role]').length === 0) {
            _perf.imageOnlyTurns.anchorlessContainers++;
            // readyContainer can itself BE the [data-turn] element (confirmed
            // live: the turn's own <section> carries data-turn-id-container
            // on itself, not just on a separate ancestor wrapper) —
            // querySelectorAll alone would never match readyContainer itself,
            // only its descendants, silently missing this case.
            const turnEls = readyContainer.matches('[data-turn]')
                ? [readyContainer, ...readyContainer.querySelectorAll('[data-turn]')]
                : [...readyContainer.querySelectorAll('[data-turn]')];
            if (turnEls.length === 0) _perf.imageOnlyTurns.turnElementMissing++;
            for (const el of turnEls) {
                if (el === current) continue;
                const turnId = el.getAttribute('data-turn-id');
                if (turnId && seenIds.has('turn:' + turnId)) continue;
                const probe = el.getBoundingClientRect().top + SMALL_EXTRA;
                if (probe > r.top && probe <= r.bottom) {
                    candidates.push(el);
                    _perf.imageOnlyTurns.candidatesFound++;
                }
            }
        }
        return candidates;
    }

    function extractMessage(el) {
        // Resolves the composite-fingerprint experiment for this element, if
        // it was ever a candidate: compares the full structural signature
        // (text length, child count, height, code blocks, images, tables,
        // placeholders) present back when the fingerprint first held (message
        // exists, non-empty text, no skeleton class) against the same
        // signature now, after the full wait — recomputed BEFORE
        // htmlToMarkdown runs so this comparison can't be skewed by anything
        // htmlToMarkdown itself mutates. Text-length equality alone can't
        // tell you whether an image, code block, or table was still loading
        // at the early moment; this can. A match across many occurrences is
        // direct evidence the fingerprint would have been safe to act on
        // early; any mismatch shows exactly which dimension would have been
        // wrong and by how much.
        if (_compositeSnapshots.has(el)) {
            const snap = _compositeSnapshots.get(el);
            const final = summarizeMessageStructure(el, el.closest('[data-turn-id-container]'));
            _compositeSnapshots.delete(el);
            // Tallied regardless of match/mismatch: a clean result on
            // codeBlocks/images/tables only means something if those fields
            // were actually non-zero somewhere — otherwise there was no
            // opportunity for them to diverge, and the comparison was
            // effectively only testing textLen again.
            //
            // Checked at EITHER snapshot, not just the early one: a candidate
            // can only register with placeholders === 0 at discovery (that's
            // the registration gate itself), so checking the early value only
            // would make this field read 0 in every run forever, regardless
            // of what the page actually does — not a finding, just an
            // artifact of the gate. The interesting case for that field is
            // the reverse direction (one appearing later), which only shows
            // up in the final snapshot.
            for (const k of Object.keys(_perf.compositeFingerprint.fieldExercised)) {
                if (snap[k] > 0 || final[k] > 0) _perf.compositeFingerprint.fieldExercised[k]++;
            }
            const diffs = Object.keys(final).filter(k => final[k] !== snap[k]);
            // images (the count above) only catches an <img> appearing or
            // disappearing — it's blind to ChatGPT swapping the SAME <img>'s
            // src (e.g. transient/low-res during generation → final signed
            // estuary URL once ready), which is the actual failure mode that
            // matters since htmlToMarkdown() reads src directly. Checked
            // separately, outside the generic key loop above, because src
            // lists are arrays — `!==` on them would always be true (distinct
            // references) regardless of content, corrupting every other
            // field's comparison if folded into the same object.
            const finalImageSrcs = imageSrcsFor(el, el.closest('[data-turn-id-container]'));
            const srcsEqual = snap.imageSrcs.length === finalImageSrcs.length &&
                snap.imageSrcs.every((s, i) => s === finalImageSrcs[i]);
            if (!srcsEqual) diffs.push('imageSrcs');
            const matched = diffs.length === 0;
            // Specifically for images: a near-zero delay here means this
            // candidate was already fully rendered at discovery (e.g. a tail
            // message still sitting in the DOM from before the walk started),
            // so its clean match proves nothing about surviving a real
            // not-ready→ready cycle. A substantial delay means it actually
            // went through virtualization and back, which is the case that
            // matters.
            if ((snap.images > 0 || final.images > 0) && _perf.compositeFingerprint.imageCandidateDetails.length < 10) {
                const sinceDiscoveryMs = Math.round(performance.now() - snap.discoveredAt);
                _perf.compositeFingerprint.imageCandidateDetails.push(
                    `msgId=${el.getAttribute('data-message-id') || '(none)'}: images ${snap.images}→${final.images}, ` +
                    `srcsMatched=${srcsEqual}, discovery-to-extraction ${sinceDiscoveryMs}ms, matched=${matched}`
                );
            }
            if (matched) {
                _perf.compositeFingerprint.matchedFinalText++;
                if (snap.isFirst) _perf.compositeFingerprint.matchedFirst++;
                else _perf.compositeFingerprint.matchedLater++;
                if (snap.containerWasNotIntersectingAtDiscovery) _perf.compositeFingerprint.matchedWhileNotIntersecting++;
            } else {
                _perf.compositeFingerprint.mismatchedFinalText++;
                if (snap.isFirst) _perf.compositeFingerprint.mismatchedFirst++;
                else _perf.compositeFingerprint.mismatchedLater++;
                if (snap.containerWasNotIntersectingAtDiscovery) _perf.compositeFingerprint.mismatchedWhileNotIntersecting++;
                if (_perf.compositeFingerprint.examples.length < 10) {
                    _perf.compositeFingerprint.examples.push(
                        `msgId=${el.getAttribute('data-message-id') || '(none)'} (${snap.isFirst ? 'first' : 'later'} sibling in container): ` +
                        diffs.map(k => k === 'imageSrcs'
                            ? `imageSrcs ${JSON.stringify(snap.imageSrcs)}→${JSON.stringify(finalImageSrcs)}`
                            : `${k} ${snap[k]}→${final[k]}`).join(', ')
                    );
                }
            }
        }
        const text = htmlToMarkdown(el);
        if (!text) return null;
        const msgId = el.getAttribute('data-message-id') || null;
        // Image-generation turns have no data-message-id — data-turn-id is
        // the only identity they carry, used as seenIds' dedup key for them.
        const turnId = msgId ? null : (el.getAttribute('data-turn-id') || null);
        // Fire-and-forget, not awaited: tests whether the container-ready
        // flag can flip true before THIS message's own content has finished
        // populating — a failure mode none of the existing diagnostics would
        // catch, since they only check whether a slab was found, not whether
        // its captured text was final. Reads el.innerText.length again later,
        // off the critical path, so it costs nothing in the walk's hot loop.
        if (el.isConnected) {
            const lenAtExtraction = el.innerText.length;
            setTimeout(() => {
                if (!el.isConnected) return;
                if (el.innerText.length !== lenAtExtraction) {
                    _perf.contentChangedAfterExtraction.count++;
                    _perf.contentChangedAfterExtraction.examples.push(
                        `msgId=${msgId || '(none)'} ${lenAtExtraction}→${el.innerText.length} chars`
                    );
                }
            }, 500);
        }
        return {
            role: el.getAttribute('data-message-author-role') || el.getAttribute('data-turn'),
            text,
            plainText: el.innerText.trim(),
            msgId,
            turnId,
        };
    }

    async function run(ui, stopBtn) {
        _resetPerf();
        _pendingImageDownloads = [];
        _imageCounter = 0;
        _runTimestamp = Date.now();
        _perf.runStartMs = performance.now();
        ui.total = getNavMenuItems().length;
        const container = findScrollContainer();
        _perf.containerTag     = container.tagName.toLowerCase();
        _perf.containerScrollH = container.scrollHeight;
        _perf.containerClientH = container.clientHeight;
        _perf.containerIsDocEl = container === document.documentElement;

        // Distinguishes "the tab was backgrounded" from "the tab was visible
        // but the event loop was still starved" (CPU contention) — both
        // produce the same symptom (sleepSlip), but only this tells us which
        // one actually happened during THIS run.
        const onVisibilityChange = () => {
            if (document.hidden) {
                _perf.tabHidden.wasHidden = true;
                _perf.tabHidden.hideCount++;
                ui.log(`  ⚠ tab went to background (${_perf.tabHidden.hideCount}) — timers may stall while hidden`);
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        const allPrompts = [];
        const seenIds = new Set();
        let lastEl = null;
        let stopReason = null; // non-null = stopped early; still export what we have
        // Cumulative across the whole run, unlike advancesWithoutProgress
        // (which resets on every real-progress event) — this is "how many
        // containers has the walk gone through in total," for the panel and
        // the snapshot table. Declared here (not next to its increment site)
        // so it's already in scope for the bootstrap's own status() call.
        let totalContainerAdvances = 0;
        // The total viewport-move count as of the last confirmed prompt —
        // comparing this against the current total when the *next* prompt
        // is confirmed is how "did a viewport move happen between these two
        // prompts" gets decided, for both the panel log and the split
        // gap-violation stats below.
        let viewportMovesAtLastPrompt = 0;

        if (stopBtn) stopBtn.onclick = () => { ui.stopped = true; };

        const takeSnap = (p) => {
            const _uEls = [...document.querySelectorAll('[data-message-author-role="user"]')];
            const _curR = lastEl?.getBoundingClientRect()
                       ?? (container === document.documentElement
                               ? { top: 0, bottom: window.innerHeight }
                               : container.getBoundingClientRect());
            _perf.snapshots.push({
                p,
                t: Math.round(performance.now() - _perf.runStartMs),
                m: allPrompts.length,
                q: countPrompts(allPrompts),
                c: totalContainerAdvances,
                v: totalViewportMoves(),
                d: document.getElementsByTagName('*').length,
                uBefore: _uEls.filter(el => el.getBoundingClientRect().bottom < _curR.top).length,
                uAfter:  _uEls.filter(el => el.getBoundingClientRect().top   > _curR.bottom).length,
            });
        };

        let bp = 0;
        // Count-percent breakpoints alone go dark on a slow run: reaching
        // even the first 10% breakpoint requires confirming ~ui.total/10
        // prompts, so a run that stalls or crawls under contention at, say,
        // 5% of ui.total never crosses bp=10 at all — only one snapshot
        // (at bp=0) ever gets recorded, no matter how many more minutes the
        // run keeps going. The diagnostic table then has nothing real to
        // show for that whole stretch. A periodic time-based snapshot keeps
        // a real trajectory visible even when count-progress is too slow
        // relative to ui.total to cross another round threshold.
        let lastSnapMs = performance.now();
        const SNAP_INTERVAL_MS = 10_000;
        const maybeSnap = () => {
            const pct = ui.total > 0 ? Math.round(100 * countPrompts(allPrompts) / ui.total) : 0;
            while (bp <= 100 && pct >= bp) { takeSnap(bp); bp += 10; lastSnapMs = performance.now(); }
            const now = performance.now();
            if (now - lastSnapMs >= SNAP_INTERVAL_MS) { takeSnap(bp); lastSnapMs = now; }
        };

        // The bootstrap sequence below (nav click, scroll settle, viewport
        // scan) and the chain-walk loop further down are now one single try
        // — a bootstrap failure used to throw before _savedState was ever
        // set, discarding every diagnostic this run collected (Nav click
        // info, scroll container info, etc.) in favor of a bare error
        // string. Folding it into the same try the loop already uses means
        // a bootstrap failure gets the same treatment as a mid-walk one:
        // recorded as stopReason, with the full diag block still exported.
        try {

        // ── Land on the prompt at the walk's starting edge via the
        // matching nav dot — the last dot (bottom) for an upward walk, the
        // first dot (top) for a downward one. Needed because a second run in
        // the same page load (Restart, or switching between this and the
        // Compatibility Check panel) would otherwise bootstrap from wherever
        // the *previous* run's walk left the scroll position, instead of the
        // actual edge this run needs to start from.
        // Two genuinely different things can go wrong here, and they call
        // for different responses — conflating them (e.g. by retrying the
        // prompt check for a while just in case) hides which one actually
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
        const navItems = getNavMenuItems();
        _perf.navItemCount = navItems.length;
        if (navItems.length > 0) {
            // aria-label is the one independent signal for what a dot
            // actually points to — not inferred from a click's side effect,
            // which can be confounded by a no-op click leaving the scroll
            // wherever a previous run left it. Captured for both ends
            // regardless of which one gets clicked, so a failure report can
            // show whether the labels even distinguish position at all.
            _perf.navFirstLabel = navItems[0].getAttribute('aria-label') || '(none)';
            _perf.navLastLabel  = navItems[navItems.length - 1].getAttribute('aria-label') || '(none)';
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
                _perf.navDiversionAttempted = true;
                navItems[oppositeIndex].click();
                try {
                    await forceScrollToEdge(container, -WALK_DIRECTION, 10_000);
                    _perf.navDiversionSettled = true;
                } catch (e) {
                    // Best-effort: if the opposite edge won't settle, proceed
                    // to the real bootstrap anyway rather than failing the
                    // whole run over a diversion that was never the actual goal.
                }
                await sleep(2000);
            }
            _perf.navClickedIndex = clickedIndex;
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
        _perf.navClickScrollTop = container === document.documentElement ? window.scrollY : container.scrollTop;
        {
            const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            const clientH = container === document.documentElement ? window.innerHeight : container.clientHeight;
            const range = scrollH - clientH;
            _perf.navClickScrollPct = range > 0 ? Math.round(100 * _perf.navClickScrollTop / range) : 100;
            // forceScrollToEdge's own stability check only requires 3
            // checks 150ms apart (450ms total) to agree with *whatever*
            // scrollHeight currently is — it never confirms scrollHeight
            // itself has stopped growing. A still-settling tail (e.g. a
            // multi-message image-gen reply not yet fully measured into
            // layout) could make it lock onto an edge that looks stable
            // for that brief window but isn't actually the true end yet.
            // Direct check: re-measure scrollHeight a few seconds later,
            // with no further scrolling in between, and see if it moved.
            _perf.scrollHeightGrowthCheck.before = scrollH;
            await sleep(5000);
            const scrollHAfter = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            _perf.scrollHeightGrowthCheck.after = scrollHAfter;
            _perf.scrollHeightGrowthCheck.grewBy = scrollHAfter - scrollH;
        }

        // This is the only viewport scan in the whole run — everything
        // after this finds the next prompt purely by geometry against
        // confirmed signals, never DOM nesting/sibling relationships.
        // forceScrollToEdge above only proves the *position* is correct —
        // it says nothing about whether content has actually mounted there
        // yet. waitForTurnReady already treats that render lag as real for
        // every subsequent turn in the chain walk (it waits on
        // data-is-intersecting rather than trusting a freshly-scrolled-to
        // container immediately); there's no principled reason this first
        // message would be exempt just because it's the bootstrap rather
        // than turn N. So poll for it instead of checking once — applied
        // the same way for both directions even though the upward case
        // hasn't needed it in practice (chats already render near the
        // bottom by default), since there's no guarantee that holds in
        // every case.
        const bootstrapDeadline = Date.now() + 30_000;
        let bootstrap = findBootstrapMessage(container, WALK_DIRECTION);
        while (!bootstrap && Date.now() < bootstrapDeadline) {
            await sleep(100);
            bootstrap = findBootstrapMessage(container, WALK_DIRECTION);
        }
        if (!bootstrap) {
            const top = container === document.documentElement ? window.scrollY : container.scrollTop;
            const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            const clientH = container === document.documentElement ? window.innerHeight : container.clientHeight;
            const totalMsgs = document.querySelectorAll('[data-message-author-role]').length;
            throw new Error(
                `No message found in the current viewport after the scroll settled at the ` +
                `${WALK_DIRECTION === -1 ? 'bottom' : 'top'} (top=${Math.round(top)}, scrollH=${Math.round(scrollH)}, clientH=${Math.round(clientH)}), ` +
                `even after waiting 30s for content to render there. ` +
                `${totalMsgs} [data-message-author-role] element(s) exist in the document — a chat always has at ` +
                `least one, so finding zero overlapping the viewport even after that wait means the viewport-overlap ` +
                `check in findBootstrapMessage needs investigating, not a longer wait.`
            );
        }
        // Same retry-before-giving-up treatment as the main walk loop below
        // (see extractRetries there for the full rationale) — bootstrap is
        // geometrically confirmed the same way every other turn is, so it's
        // just as exposed to the virtualization-ready-but-content-not-yet
        // race, and `current = bootstrap` a few lines down would otherwise
        // silently and permanently drop it the same way.
        let bootstrapMsg = extractMessage(bootstrap);
        let bootstrapExtractRetries = 0;
        while (!bootstrapMsg && bootstrapExtractRetries < 5) {
            bootstrapExtractRetries++;
            await sleep(200);
            bootstrapMsg = extractMessage(bootstrap);
        }
        if (!bootstrapMsg) {
            _perf.extractionFailures.count++;
            if (_perf.extractionFailures.examples.length < 10) {
                _perf.extractionFailures.examples.push(
                    `role=${bootstrap.getAttribute('data-message-author-role') || '(anchorless)'} (bootstrap) ` +
                    `turnId=${bootstrap.closest('[data-turn]')?.getAttribute('data-turn-id') || bootstrap.getAttribute('data-turn-id') || '(none)'} ` +
                    `after ${bootstrapExtractRetries} retries`
                );
            }
            ui.log(`  ⚠ bootstrap extraction returned empty after ${bootstrapExtractRetries} retries — content permanently lost`);
        }
        if (bootstrapMsg) {
            if (bootstrapMsg.msgId) seenIds.add(bootstrapMsg.msgId);
            else if (bootstrapMsg.turnId) { seenIds.add('turn:' + bootstrapMsg.turnId); _perf.imageOnlyTurns.extracted++; }
            allPrompts.push(bootstrapMsg);
        }
        lastEl = bootstrap;
        ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
        maybeSnap();

        // The edge of a container nearest the already-explored side of the
        // walk — i.e. where "light" first reaches it. direction=-1: walking
        // upward, so a new container's bottom edge is the one adjacent to
        // the container just finished; its top edge is the unexplored
        // interior. Used by containerReach below to measure how far past
        // that entry edge extraction actually finds a slab, as direct
        // evidence for whether readiness covers the whole container or only
        // the part nearest the entry point.
        const containerNearEdge = el =>
            WALK_DIRECTION === -1 ? el.getBoundingClientRect().bottom : el.getBoundingClientRect().top;

        let current = bootstrap;
        let readyContainer = current.closest('[data-turn-id-container]');
        // Tracks where the *next* sibling found in the current readyContainer
        // should land, for direction=-1 only. A plain unshift(msg) per find is
        // only correct when exactly one message is drained per container —
        // when multiple are (see multiCandidatesInReadyContainer), each
        // unshift lands ahead of the one before it, reversing the whole batch.
        // Advancing this index after every insert keeps siblings in their
        // discovery (DOM) order while the batch as a whole still lands ahead
        // of everything already collected, same as a single unshift would.
        // direction=+1 doesn't need this: push always appends at the end, so
        // discovery order is preserved automatically.
        let containerInsertAt = 0;
        _perf.bootstrapRole = bootstrap.getAttribute('data-message-author-role') || '(none)';
        if (!readyContainer) {
            stopReason = 'Bootstrap message has no [data-turn-id-container] ancestor — cannot start the chain walk.';
        } else {
            // Recorded before the wait below resolves it, to find out
            // empirically whether the gap this wait closes (see comment)
            // ever actually mattered — i.e. whether the bootstrap's own
            // container was ever genuinely unresolved, as opposed to this
            // being a defensive check that never fires in practice.
            _perf.bootstrapWasIntersectingFalse = readyContainer.getAttribute('data-is-intersecting') === 'false';
            // Started before waitForTurnReady, not after: this is the
            // earliest point readyContainer is identified at all, so it's
            // the only place that can observe the full not-ready→ready
            // transition rather than just what happens afterward.
            watchContainerLifecycle(readyContainer);
            // Every later container in the chain walk gets verified ready
            // via waitForTurnReady before findNextPromptIn/findPrevTurn
            // trust it — the bootstrap's own container never got that same
            // treatment, despite being reached by exactly the kind of
            // fresh-scroll-and-poll sequence the render-lag reasoning above
            // already applies to the message itself. No reason its
            // container would be exempt from the same check.
            await waitForTurnReady(container, readyContainer, 30_000, maybeSnap);
        }
        let containerEntryY = readyContainer ? containerNearEdge(readyContainer) : 0;
        viewportMovesAtLastPrompt = totalViewportMoves();
        ui.log(`#1 confirmed (bootstrap, ${_perf.bootstrapRole}) — viewport moves so far: ${viewportMovesAtLastPrompt}`);

        // Defensive cap: if findNextPromptIn never matches anything despite
        // many consecutive container advances, that's not "the conversation
        // is just long" — it's a containment-logic mismatch (e.g. a turn
        // rendering at the 50vh fallback height before --last-known-height
        // is cached, putting the message far from its container's own top).
        // Fail fast with the geometry that didn't match, rather than spin
        // silently through every remaining container.
        let advancesWithoutProgress = 0;
        const MAX_ADVANCES_WITHOUT_PROGRESS = 50;
        // Tracks how many consecutive advances stayed on the same
        // data-turn-id before genuinely moving to a different one — a
        // direct measure of how much duplicate-sibling traffic the turn-id
        // dedup filter is absorbing, independent of whether the run
        // ultimately succeeds or hits the advance cap.
        let lastAdvanceTurnId = null;
        let curTurnIdRun = 0;
        // className/attributes of every container advanced through without a
        // matching prompt — rect coordinates alone don't say whether a long
        // run of zero-height containers are genuine (if sparse) turn wrappers
        // or some unrelated decorative/structural element that happens to
        // satisfy findPrevTurn's geometric strip test. Cleared whenever real
        // progress resets advancesWithoutProgress, so a later failure's
        // report isn't contaminated by an earlier, unrelated stretch.
        let advanceChain = [];
        const describeTurnContainer = el => {
            const r = el.getBoundingClientRect();
            const attrs = [...el.attributes]
                .filter(a => a.name.startsWith('data-'))
                .map(a => a.value ? `${a.name}="${a.value}"` : a.name)
                .join(' ');
            return `height=${Math.round(r.height)} class="${(el.className || '').slice(0, 60)}" ${attrs}`;
        };

        // The whole loop body shares the bootstrap sequence's try above, not
        // just the waitForTurnReady call — any exception here, anticipated
        // or not, must still leave allPrompts and a diagnostic message
        // intact for _savedState below. Without this, an unanticipated throw
        // from e.g. extractMessage or findPrevTurn would skip straight past
        // _savedState entirely and silently lose everything accumulated so far.
            while (!ui.stopped && !stopReason) {
                const candidates = findNextPromptIn(readyContainer, current, seenIds);
                if (candidates.length > 1) {
                    _perf.multiCandidatesInReadyContainer++;
                    _perf.multiCandidatesMax = Math.max(_perf.multiCandidatesMax, candidates.length);
                    ui.log(`  ⚠ readyContainer has ${candidates.length} unextracted candidates — DOM-order draining assumed correct`);
                }
                const next = candidates[0] || null;
                if (next) {
                    advancesWithoutProgress = 0;
                    advanceChain = [];
                    lastAdvanceTurnId = null;
                    curTurnIdRun = 0;
                    const vpNow = totalViewportMoves();
                    const vpDelta = vpNow - viewportMovesAtLastPrompt;
                    const msgId = next.getAttribute('data-message-id');
                    // extractMessage can return null even for a geometrically
                    // confirmed candidate — virtualization-readiness
                    // (data-is-intersecting) says nothing about whether an
                    // image-generation turn's actual <img> has landed in the
                    // DOM yet. Retrying a few times catches that lag for
                    // free; lastEl/current still advance past this element
                    // unconditionally below regardless of outcome (there's
                    // no mechanism to revisit it later), so if it's still
                    // null after retrying, that's permanent data loss —
                    // logged loudly rather than silently, which is what
                    // happened before this fix (the #N confirmed line below
                    // printed unconditionally either way, with the same N
                    // as the previous line, indistinguishable from a normal
                    // multi-candidate container in the log).
                    let msg = extractMessage(next);
                    let extractRetries = 0;
                    while (!msg && extractRetries < 5) {
                        extractRetries++;
                        await sleep(200);
                        msg = extractMessage(next);
                    }
                    if (!msg) {
                        _perf.extractionFailures.count++;
                        if (_perf.extractionFailures.examples.length < 10) {
                            _perf.extractionFailures.examples.push(
                                `role=${next.getAttribute('data-message-author-role') || '(anchorless)'} ` +
                                `turnId=${next.closest('[data-turn]')?.getAttribute('data-turn-id') || next.getAttribute('data-turn-id') || '(none)'} ` +
                                `msgId=${msgId || '(none)'} after ${extractRetries} retries`
                            );
                        }
                        ui.log(`  ⚠ extraction returned empty after ${extractRetries} retries for ` +
                            `${next.getAttribute('data-message-author-role') || '(anchorless turn)'} — content permanently lost, advancing past it`);
                    }
                    if (msg) {
                        if (msgId) seenIds.add(msgId);
                        else if (msg.turnId) { seenIds.add('turn:' + msg.turnId); _perf.imageOnlyTurns.extracted++; }
                        // Direct evidence for the whole-container-readiness
                        // question: how far past this container's entry edge
                        // did extraction just reach to find this slab? If
                        // readiness only ever covered the area right at the
                        // entry edge, reach would stay small/near-zero even
                        // for large containers; a reach that grows to a
                        // large fraction of the container's own height is
                        // evidence the whole container was actually ready,
                        // not just the part nearest where light first hit it.
                        {
                            const slabY = next.getBoundingClientRect().top;
                            const reach = WALK_DIRECTION === -1 ? containerEntryY - slabY : slabY - containerEntryY;
                            _perf.containerReach.count++;
                            _perf.containerReach.sum += reach;
                            if (reach > _perf.containerReach.max) {
                                _perf.containerReach.max = reach;
                                const containerHeight = readyContainer.getBoundingClientRect().height;
                                _perf.containerReach.maxWinner = {
                                    turnId: readyContainer.getAttribute('data-turn-id') || '(none)',
                                    containerHeight: Math.round(containerHeight),
                                    pct: containerHeight > 0 ? Math.round(100 * reach / containerHeight) : null,
                                };
                            }
                        }
                        // direction=-1: walking toward the start, so this
                        // container's messages as a group are earlier than
                        // everything already collected — but multiple
                        // siblings from the same container must keep their
                        // own discovery order relative to each other (see
                        // containerInsertAt's definition above).
                        // direction=+1: walking toward the end, so push's
                        // natural append-order is already correct.
                        if (WALK_DIRECTION === -1) {
                            allPrompts.splice(containerInsertAt, 0, msg);
                            containerInsertAt++;
                        } else {
                            allPrompts.push(msg);
                        }
                    }
                    lastEl = next;
                    current = next;
                    viewportMovesAtLastPrompt = vpNow;

                    ui.log(`#${allPrompts.length} confirmed (${next.getAttribute('data-message-author-role') || '?'}) — Δviewport ${vpDelta}`);
                    ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
                    maybeSnap();

                    // Throttle: a pace-limiter, not a content wait (this branch
                    // never scrolls at all — readyContainer is already loaded).
                    // Many prompts resolve from the same container with no
                    // scrolling whatsoever, so an unthrottled loop can still
                    // advance far faster than intended elsewhere in the run.
                    await sleep(30);
                    continue;
                }

                // findNextPromptIn found nothing — but a height-based
                // "is the leftover area big enough to expect a prompt"
                // estimate is itself just a proxy, and a noisy one: ordinary
                // CSS padding/margin around a message can easily produce a
                // leftover gap that clears the shortest-prompt threshold
                // without containing any actual message (observed live: an
                // 86px leftover against a 68px threshold, which is exactly
                // the size of plausible container padding, not a hidden
                // turn). The direct, unambiguous test is to look for an
                // actual [data-message-author-role] element — not current,
                // not already extracted — whose rect genuinely overlaps
                // readyContainer. If one exists, the probe-offset test in
                // findNextPromptIn should have found it and didn't, which is
                // real evidence of a miss. If none exists, the leftover
                // space is just layout, not a missed prompt, no matter how
                // large it looks.
                const _rcRect = readyContainer.getBoundingClientRect();
                const _missed = [...document.querySelectorAll('[data-message-author-role]')].filter(el => {
                    if (el === current) return false;
                    const msgId = el.getAttribute('data-message-id');
                    if (msgId && seenIds.has(msgId)) return false;
                    const er = el.getBoundingClientRect();
                    return er.bottom > _rcRect.top && er.top < _rcRect.bottom;
                });
                if (_missed.length > 0) {
                    const mr = _missed[0].getBoundingClientRect();
                    throw new Error(
                        `No prompt found by findNextPromptIn, but an unextracted [data-message-author-role] ` +
                        `element genuinely overlaps readyContainer — the containment test missed it. ` +
                        `Container rect=[top=${Math.round(_rcRect.top)},bottom=${Math.round(_rcRect.bottom)}]. ` +
                        `Missed element rect=[top=${Math.round(mr.top)},bottom=${Math.round(mr.bottom)}] ` +
                        `(${_missed.length} such element(s) found total).`
                    );
                }

                // Nothing left to confirm in readyContainer — advance to the
                // adjacent turn (before it when walking up, after it when
                // walking down).
                let prevTurn = findPrevTurn(readyContainer, WALK_DIRECTION);
                if (!prevTurn) {
                    // "No adjacent turn" only means the genuine start/end of
                    // the conversation if we've actually found everything the
                    // nav-dot count says exists. Without this check, landing on
                    // the wrong starting message (wrong scroll position, or any
                    // other structural miss) looks identical to a correct
                    // finish — same clean exit, wrong count, no diagnosis.
                    if (ui.total === 0 || countPrompts(allPrompts) >= ui.total) break;
                    const r = readyContainer.getBoundingClientRect();
                    const edgeLabel = WALK_DIRECTION === -1 ? 'previous' : 'next';
                    const boundaryLabel = WALK_DIRECTION === -1 ? 'start' : 'end';
                    stopReason = `No ${edgeLabel} turn found, but only ${countPrompts(allPrompts)}/${ui.total} user ` +
                        `prompts confirmed — this is not the genuine ${boundaryLabel}. Last container rect=` +
                        `[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}].`;
                    break;
                }

                // findPrevTurn's candidate is a snapshot of geometry at one
                // moment. On a large, still-resolving conversation, upstream
                // placeholders can correct while we walk toward it, leaving
                // it permanently out of reach in the one direction we ever
                // scroll (observed live: 73 steps, target.top never shrank —
                // it had drifted to the wrong side of the viewport entirely).
                // Re-deriving the candidate fresh against current geometry
                // and retrying handles that, instead of committing to one
                // possibly-stale pick for the rest of the run.
                const MAX_PREV_TURN_RETRIES = 3;
                let prevTurnAttempt = 0;
                watchContainerLifecycle(prevTurn); // discovery moment — before, not after, readiness is known
                while (true) {
                    try {
                        await waitForTurnReady(container, prevTurn, 30_000, maybeSnap);
                        break;
                    } catch (e) {
                        prevTurnAttempt++;
                        if (prevTurnAttempt >= MAX_PREV_TURN_RETRIES)
                            throw new Error(`${e.message} (gave up after ${prevTurnAttempt} candidate(s) for the adjacent turn)`);
                        const fresh = findPrevTurn(readyContainer, WALK_DIRECTION);
                        if (!fresh) throw e; // can't even re-find a candidate — propagate the original failure
                        prevTurn = fresh;
                        watchContainerLifecycle(prevTurn); // re-derived candidate is a new discovery moment too
                    }
                }
                if (!readyContainer.isConnected) {
                    // Same reasoning as the message-level check: the
                    // waitForTurnReady call just above can itself scroll far
                    // enough to unmount the container we're comparing from.
                    _perf.containerGapSkippedDetached++;
                } else {
                    const gap = adjacencyGap(WALK_DIRECTION, readyContainer.getBoundingClientRect(), prevTurn.getBoundingClientRect());
                    _perf.maxContainerGap = Math.max(_perf.maxContainerGap, Math.abs(gap));
                    if (Math.abs(gap) > ADJACENCY_MARGIN) _perf.containerGapViolations++;
                }
                readyContainer = prevTurn;
                containerInsertAt = 0; // new container — its siblings form a fresh batch
                containerEntryY = containerNearEdge(readyContainer);
                totalContainerAdvances++;
                advanceChain.push({ desc: describeTurnContainer(readyContainer), el: readyContainer });
                {
                    const thisTurnId = readyContainer.getAttribute('data-turn-id');
                    curTurnIdRun = (thisTurnId && thisTurnId === lastAdvanceTurnId) ? curTurnIdRun + 1 : 1;
                    lastAdvanceTurnId = thisTurnId;
                    _perf.turnIdDedupMaxRun = Math.max(_perf.turnIdDedupMaxRun, curTurnIdRun);
                }
                // Container advances don't confirm a new message, so without
                // this the panel's counts would sit frozen for an entire
                // stretch of container-only progress, even though real work
                // (and viewport movement) is happening.
                ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
                maybeSnap(); // container-advance path — needed so the time-based snapshot check ever runs during a long stretch with no new prompt confirmed

                advancesWithoutProgress++;
                _perf.maxAdvancesWithoutProgress = Math.max(_perf.maxAdvancesWithoutProgress, advancesWithoutProgress);
                if (advancesWithoutProgress > MAX_ADVANCES_WITHOUT_PROGRESS) {
                    const r = readyContainer.getBoundingClientRect();
                    // Find the [data-message-author-role] element geometrically
                    // closest to this container's range, to show the actual
                    // mismatch distance rather than just "nothing matched".
                    const allMsgs = [...document.querySelectorAll('[data-message-author-role]')];
                    let closest = null, closestDist = Infinity;
                    for (const el of allMsgs) {
                        const mr = el.getBoundingClientRect();
                        const dist = mr.top < r.top ? r.top - mr.top : (mr.top > r.bottom ? mr.top - r.bottom : 0);
                        if (dist < closestDist) { closestDist = dist; closest = mr; }
                    }
                    const curR = current.getBoundingClientRect();
                    // Deduped, not raw, because a long run is almost always
                    // the same handful of element shapes repeated — a flat
                    // 51-line dump would bury the one distinguishing detail
                    // (do these have a real message inside their height, or
                    // are they all the same zero-height marker?) in noise.
                    // Object identity, not just the attribute dump, decides
                    // between two very different bugs: if every entry in a
                    // group is the same handful of distinct elements (turn-id
                    // dedup should have skipped past them but isn't), that's
                    // a bug in findPrevTurn's exclusion logic. If it's
                    // genuinely a large number of distinct elements all
                    // carrying the same turn-id, the dedup filter is working
                    // exactly as designed and the real problem is that
                    // ChatGPT renders that many distinct same-turn-id nodes
                    // in the first place — a different fix entirely.
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
                    stopReason = `Advanced through ${advancesWithoutProgress} containers with no matching prompt. ` +
                        `Last container rect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)},height=${Math.round(r.height)}]. ` +
                        `Current (last confirmed) message rect=[top=${Math.round(curR.top)},bottom=${Math.round(curR.bottom)}]. ` +
                        (closest
                            ? `Closest of ${allMsgs.length} [data-message-author-role] elements: rect=[top=${Math.round(closest.top)},bottom=${Math.round(closest.bottom)}], distance=${Math.round(closestDist)}px from container range.`
                            : `No [data-message-author-role] elements found in the document at all.`) +
                        `\n    Chain walked (${advanceChain.length} containers, deduped):\n${chainSummary}`;
                    break;
                }
                await sleep(30);
            }
        } catch (e) {
            stopReason = e.message;
        }
        document.removeEventListener('visibilitychange', onVisibilityChange);

        const _totalMs = performance.now() - _perf.runStartMs;
        const _sleepMs = _totalMs - _perf.htmlToMarkdownMs;
        ui.log('── perf (v4.65) ──');
        ui.log(`total ${(_totalMs/1000).toFixed(1)}s | sleep/wait ${(_sleepMs/1000).toFixed(1)}s (${Math.round(100*_sleepMs/_totalMs)}%) | blank waits ${_perf.blankWaits}`);
        ui.log(`htmlToMarkdown: ${_perf.htmlToMarkdownCalls} calls, ${Math.round(_perf.htmlToMarkdownMs)}ms`);
        ui.log(`${countPrompts(allPrompts)} prompts saved (${allPrompts.length} msgs total).`);
        if (stopReason) ui.log(`Stopped early — diagnosis: ${stopReason}`);
        // stopReason travels with the saved state (not just ui.stopped, which
        // only tracks the manual Stop button) so the caller can tell a clean
        // finish apart from an early, diagnosed stop and still offer export
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
            innerText: 'ChatGPT Extractor v4.65',
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
        const promptsEl = Object.assign(document.createElement('div'), { innerText: 'User msgs : —' });
        const msgsEl = Object.assign(document.createElement('div'), { innerText: 'All msgs : —' });
        const containersEl = Object.assign(document.createElement('div'), { innerText: 'Containers advanced : —' });
        const viewportsEl = Object.assign(document.createElement('div'), { innerText: 'Viewport moves : —' });
        statusEl.append(promptsEl, msgsEl, containersEl, viewportsEl);

        const logEl = document.createElement('div');
        Object.assign(logEl.style, {
            marginTop: '8px', maxHeight: '160px', overflowY: 'auto',
            background: '#181825', padding: '6px', borderRadius: '4px',
            fontSize: '11px', color: '#dde1f4',
        });

        const note = Object.assign(document.createElement('div'), {
            innerText: `Scroll to the ${WALK_DIRECTION === -1 ? 'BOTTOM' : 'TOP'} of the chat before starting.`,
        });
        Object.assign(note.style, { marginTop: '8px', color: '#f9e2af', fontSize: '11px' });

        const diagCheck = Object.assign(document.createElement('input'), {
            type: 'checkbox', id: 'extractor-diag-check',
        });
        const diagLabel = Object.assign(document.createElement('label'), {
            htmlFor: 'extractor-diag-check', innerText: 'Include diagnostics in export',
        });
        Object.assign(diagLabel.style, { cursor: 'pointer' });
        const diagRow = document.createElement('div');
        Object.assign(diagRow.style, {
            display: 'flex', alignItems: 'center', gap: '6px',
            marginTop: '8px', fontSize: '11px', color: '#dde1f4',
        });
        diagRow.append(diagCheck, diagLabel);

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
        body.append(logEl, statusEl, note, diagRow, btnRow);

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
        // Reload-and-auto-start is specifically the unattended path — nobody
        // is sitting at the checkbox to remember to tick it before Export
        // runs. Defaulting it on only here (not for a normal manual start,
        // where the checkbox keeps its plain unchecked default) means an
        // auto-started run never silently loses its diag block the way a
        // forgotten manual click just did.
        if (_autoStartOnce) diagCheck.checked = true;
        GM_registerMenuCommand('Reload and Auto-Start (this load only)', () => {
            sessionStorage.setItem(AUTO_START_ONCE_KEY, '1');
            location.reload();
        });

        toggleBtn.onclick = () => {
            panel.style.display = 'none';
        };

        const ui = {
            stopped: false,
            total: 0,
            get includeDiag() { return diagCheck.checked; },
            isAutoStart: _autoStartOnce,
            status(promptCount, msgCount, containerCount, viewportCount) {
                // this.total is the nav-dot count — a count of prompts, not
                // messages — so only the prompt line has a meaningful
                // percentage to show against it.
                const fmt = n => this.total
                    ? `${n} / ${this.total} (${Math.round(100 * n / this.total)}%)`
                    : `${n}`;
                promptsEl.innerText    = `User msgs : ${fmt(promptCount)}`;
                msgsEl.innerText       = `All msgs : ${msgCount}`;
                containersEl.innerText = `Containers advanced : ${containerCount}`;
                viewportsEl.innerText  = `Viewport moves : ${viewportCount}`;
                console.log(`[Extractor] STATUS: prompts ${fmt(promptCount)} | msgs ${msgCount} | ` +
                    `containers ${containerCount} | viewport moves ${viewportCount}`);
            },
            log(msg) {
                const line = Object.assign(document.createElement('div'), {
                    innerText: `> ${msg}`,
                });
                line.style.whiteSpace = 'pre-wrap'; // diagnosis messages can carry embedded newlines (e.g. the advance-chain summary)
                logEl.appendChild(line);
                logEl.scrollTop = logEl.scrollHeight;
                console.log(`[Extractor] ${msg}`);
            },
        };

        const showRunningState = () => {
            ui.stopped = false;
            logEl.innerHTML = '';
            btn.disabled = true;
            Object.assign(btn.style, { background: '#45475a', color: '#585b70' });
            note.style.display = 'none';
            stopBtn.style.display = '';
            exportBtn.style.display = 'none';
        };

        const showIdleState = (label, stopped) => {
            stopBtn.style.display = 'none';
            exportBtn.style.display = _savedState ? '' : 'none';
            btn.disabled = false;
            Object.assign(btn.style, { background: '#89b4fa', color: '#11111b' });
            btn.innerText = label;
            if (stopped) note.style.display = '';
        };

        btn.onclick = async () => {
            showRunningState();
            try {
                await run(ui, stopBtn);
                showIdleState('Restart', ui.stopped || !!_savedState?.stopReason);
            } catch (err) {
                stopBtn.style.display = 'none';
                ui.log(`ERROR: ${err.message}`);
                showIdleState('Retry', true);
                Object.assign(btn.style, { background: '#f38ba8', color: '#11111b' });
            }
        };

        exportBtn.onclick = async () => {
            if (!_savedState) return;
            exportBtn.disabled = true;
            exportBtn.innerText = 'Exporting…';
            await exportMarkdown(ui, _savedState.allPrompts, ui.includeDiag, _savedState.stopped, _savedState.timestamp);
            const count = countPrompts(_savedState.allPrompts);
            ui.log(`Exported ${count} prompts (${_savedState.allPrompts.length} msgs).`);
            exportBtn.disabled = false;
            exportBtn.innerText = 'Export again';
        };

        // Exists specifically to minimize dwell time at whichever edge the
        // page loads scrolled to (normally the bottom) before extraction's
        // own opposite-edge diversion (see run()) gets a chance to act —
        // waiting for a manual click leaves an arbitrary, often multi-second
        // gap for ChatGPT's own eager-render behavior to settle in
        // unbothered. Polls rather than assumes readiness, since the page's
        // own hydration time is exactly the part of the dwell window this
        // can't shrink any further.
        if (_autoStartOnce) {
            console.log('[Extractor] auto-start: polling for nav items…');
            (async () => {
                const deadline = Date.now() + 30_000;
                while (getNavMenuItems().length === 0 && Date.now() < deadline) {
                    await sleep(100);
                }
                const found = getNavMenuItems().length;
                console.log('[Extractor] auto-start: nav items found =', found, '— clicking Start Extraction:', found > 0);
                if (found === 0) return; // page never became ready — don't force a click into a broken state
                panel.style.display = '';
                btn.click();
            })();
        }
    }

    buildUI();

    // ════════════════════════════════════════════════════════════════
    // COMPATIBILITY CHECK
    // ════════════════════════════════════════════════════════════════

    const _MARKUP_CHECKS = [
        { label: 'Ordered list',   pat: /^\d+\. /m,             prompt: 'List the three primary colors as a numbered list.' },
        { label: 'Unordered list', pat: /^- /m,                 prompt: 'List three types of fruit using bullet points.' },
        { label: 'Code block',     pat: /^```/m,                prompt: 'Write a Python function that returns the square of a number, with a docstring.' },
        { label: 'Inline code',    pat: /`[^`\n]+`/,            prompt: 'In one sentence, refer to the variable `count` using inline code.' },
        { label: 'Bold',           pat: /\*\*[^*\n]+\*\*/,     prompt: 'Write one sentence where the word "important" appears in bold.' },
        { label: 'Italic',         pat: /(?<!\*)\*[^*\s][^*\n]*\*(?!\*)/,  prompt: 'Write one sentence where the word "gently" appears in italic.' },
        { label: 'Table',          pat: /\| ?-+ ?\|/,           prompt: 'Make a table with columns Name and Score, and two data rows.' },
        { label: 'Blockquote',     pat: /^> /m,                 prompt: 'Write this sentence as a blockquote: To be or not to be.' },
        { label: 'Heading',        pat: /^#{1,6} /m,            prompt: 'Write a level-2 heading "Results" followed by one sentence.' },
    ];

    function buildDiagUI() {
        const DIAG_ID = 'chatgpt-extractor-diag';
        const existing = document.getElementById(DIAG_ID);
        if (existing) { existing.remove(); return; }

        const panel = document.createElement('div');
        panel.id = DIAG_ID;
        Object.assign(panel.style, {
            position: 'fixed', top: '20px', left: `${Math.max(0, window.innerWidth - 780)}px`, zIndex: '99999',
            padding: '14px', background: '#1e1e2e', color: '#cdd6f4',
            border: '2px solid #a6e3a1', borderRadius: '8px',
            fontFamily: 'monospace', fontSize: '11px', width: '400px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)', lineHeight: '1.5',
            maxHeight: '85vh', overflowY: 'auto',
        });

        const titleRow = document.createElement('div');
        Object.assign(titleRow.style, {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '10px', cursor: 'move', userSelect: 'none',
        });
        const title = Object.assign(document.createElement('div'), { innerText: 'Compatibility Check' });
        Object.assign(title.style, { fontWeight: 'bold', color: '#a6e3a1', fontSize: '13px' });
        const closeBtn = Object.assign(document.createElement('button'), { innerText: '×' });
        Object.assign(closeBtn.style, { background: 'none', border: 'none', color: '#a6e3a1', cursor: 'pointer', fontSize: '16px', fontFamily: 'monospace', padding: '0' });
        closeBtn.onclick = () => panel.remove();
        titleRow.append(title, closeBtn);

        { // drag
            let ox = 0, oy = 0;
            const onMove = e => {
                panel.style.left = `${e.clientX - ox}px`;
                panel.style.top  = `${e.clientY - oy}px`;
            };
            const onUp = () => document.removeEventListener('mousemove', onMove);
            titleRow.addEventListener('mousedown', e => {
                if (e.target === closeBtn) return;
                const r = panel.getBoundingClientRect();
                ox = e.clientX - r.left; oy = e.clientY - r.top;
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp, { once: true });
                e.preventDefault();
            });
        }

        // ── Structural section ────────────────────────────────────
        const structHead = Object.assign(document.createElement('div'), { innerText: '── Structural ──' });
        Object.assign(structHead.style, { color: '#89b4fa', marginBottom: '6px' });

        const structLog = document.createElement('div');
        Object.assign(structLog.style, { marginBottom: '10px' });

        const addLine = (log, ok, label, detail) => {
            const icon  = ok === null ? '[?]' : ok ? '[✓]' : '[✗]';
            const color = ok === null ? '#585b70' : ok ? '#a6e3a1' : '#f38ba8';
            const row = document.createElement('div');
            row.innerHTML = `<span style="color:${color};font-weight:bold">${icon}</span> ${label}`;
            log.appendChild(row);
            if (detail) {
                const det = document.createElement('div');
                det.innerText = '    ' + detail;
                Object.assign(det.style, { color: '#6c7086', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: '2px' });
                log.appendChild(det);
            }
        };

        const runStructural = () => {
            structLog.innerHTML = '';

            const container = findScrollContainer();
            const fallback = container === document.documentElement;
            addLine(structLog, !fallback, 'Scroll container',
                fallback ? 'FALLBACK: using <html> — container detection may be wrong'
                         : `<${container.tagName.toLowerCase()}> scrollH=${container.scrollHeight} clientH=${container.clientHeight}`);

            const strip = [...document.querySelectorAll('div')]
                .find(d => d.className.includes('w-9') && d.className.includes('max-h-[50lvh]') && d.className.includes('no-scrollbar'));
            addLine(structLog, !!strip, 'Nav menu container (primary selector)',
                strip ? 'div.w-9.max-h-[50lvh].no-scrollbar' : 'NOT FOUND — using button-class fallback');

            const navItems = getNavMenuItems();
            addLine(structLog, navItems.length > 0, 'Navigation menu items',
                navItems.length > 0 ? `${navItems.length} found` : 'NOT FOUND — navigation impossible');
            if (navItems.length > 0) {
                const label = navItems[0].getAttribute('aria-label');
                addLine(structLog, !!label, 'First nav item aria-label',
                    label ? label : 'MISSING — cannot identify first user prompt');
            }

            const msgs = document.querySelectorAll('[data-message-author-role]');
            addLine(structLog, msgs.length > 0, '[data-message-author-role]',
                msgs.length > 0 ? `${msgs.length} in DOM` : 'MISSING — cannot extract messages');

            const msgIds = document.querySelectorAll('[data-message-id]');
            addLine(structLog, msgIds.length > 0, '[data-message-id]',
                msgIds.length > 0 ? `${msgIds.length} in DOM` : 'MISSING — export TOC will have no anchors');

            // Shortest currently-mounted message height per role — the
            // empirical floor for calibrating the chain-walk's "small extra"
            // probe offset (must stay under this so the probe never
            // overshoots past the immediately-adjacent message). Filtered to
            // height>0 since a virtualized-away element reports a zero rect,
            // which would otherwise look like a (false) shortest match.
            for (const role of ['user', 'assistant']) {
                const heights = [...document.querySelectorAll(`[data-message-author-role="${role}"]`)]
                    .map(el => el.getBoundingClientRect().height)
                    .filter(h => h > 0);
                const min = heights.length ? Math.min(...heights) : null;
                addLine(structLog, min !== null, `Shortest ${role} message height`,
                    min !== null
                        ? `${Math.round(min)}px (n=${heights.length} mounted)`
                        : 'No mounted messages of this role to measure — scroll near some and re-check');
            }

            const allPH   = [...document.querySelectorAll('[data-turn-id-container]')];
            const blankPH = [...document.querySelectorAll('[data-turn-id-container][data-is-intersecting="false"]')];
            if (allPH.length === 0) {
                addLine(structLog, null, '[data-turn-id-container] (lazy placeholder)',
                    'None in DOM — scroll to the middle of a long conversation and re-check');
            } else {
                const p = allPH[0];
                const hasAttr = p.hasAttribute('data-is-intersecting');
                const cssVar  = getComputedStyle(p).getPropertyValue('--last-known-height').trim();
                addLine(structLog, hasAttr, '[data-turn-id-container] (lazy placeholder)',
                    [
                        `${allPH.length} total, ${blankPH.length} unloaded (blank)`,
                        hasAttr ? 'data-is-intersecting ✓' : 'data-is-intersecting MISSING ← blank detection broken',
                        p.className ? `class: "${p.className.slice(0, 70)}"` : 'class: (empty)',
                        cssVar ? `--last-known-height: ${cssVar}` : '--last-known-height: not set',
                    ].join('\n    ')
                );

                // A live snapshot of duplicate-*sibling* severity — the same
                // data-turn-id on multiple elements that are NOT ancestor/
                // descendant of each other. Nested wrappers for one message
                // (~2 containers each, already known and expected) share a
                // turn-id too but aren't the problem; only counting groups
                // that survive the same containment check findPrevTurn uses
                // avoids flagging that normal case as if it were the bug.
                const turnIdGroups = new Map();
                for (const el of allPH) {
                    const id = el.getAttribute('data-turn-id');
                    if (!id) continue;
                    if (!turnIdGroups.has(id)) turnIdGroups.set(id, []);
                    turnIdGroups.get(id).push(el);
                }
                let dupGroupCount = 0, maxDup = 0;
                for (const [, els] of turnIdGroups) {
                    // Count elements with no containment relationship to any
                    // earlier element sharing this turn-id — survivors are
                    // genuine siblings, not nested wrappers of one another.
                    const unrelated = els.filter((el, i) => els.slice(0, i).every(prev => !prev.contains(el) && !el.contains(prev)));
                    if (unrelated.length > 1) { dupGroupCount++; maxDup = Math.max(maxDup, unrelated.length); }
                }
                addLine(structLog, dupGroupCount === 0, 'Duplicate data-turn-id siblings',
                    dupGroupCount === 0
                        ? `${turnIdGroups.size} distinct turn-id(s), no sibling duplicates right now`
                        : `${dupGroupCount}/${turnIdGroups.size} turn-id(s) have sibling duplicates, largest group has ${maxDup} element(s)`
                );
            }
        };

        const recheckBtn = Object.assign(document.createElement('button'), { innerText: 'Re-check' });
        Object.assign(recheckBtn.style, {
            padding: '3px 8px', background: '#313244', color: '#cdd6f4',
            border: '1px solid #585b70', borderRadius: '4px', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: '10px', marginBottom: '10px',
        });
        recheckBtn.onclick = runStructural;

        // ── Markup fidelity section ───────────────────────────────
        const markupHead = Object.assign(document.createElement('div'), { innerText: '── Markup Fidelity ──' });
        Object.assign(markupHead.style, { color: '#89b4fa', marginBottom: '6px' });

        const intro = Object.assign(document.createElement('div'), {
            innerText: 'Start a new conversation and send these prompts one by one. After extraction, click Check:',
        });
        Object.assign(intro.style, { color: '#bac2de', marginBottom: '8px', lineHeight: '1.4' });

        const mkCopyBtn = (text) => {
            const b = Object.assign(document.createElement('button'), { innerText: 'Copy' });
            Object.assign(b.style, {
                padding: '2px 7px', background: '#313244', color: '#cdd6f4',
                border: '1px solid #585b70', borderRadius: '3px', cursor: 'pointer',
                fontFamily: 'monospace', fontSize: '10px', flexShrink: '0',
            });
            b.onclick = () => {
                navigator.clipboard.writeText(text);
                b.innerText = '✓';
                setTimeout(() => { b.innerText = 'Copy'; }, 1500);
            };
            return b;
        };

        const promptsContainer = document.createElement('div');
        Object.assign(promptsContainer.style, { marginBottom: '10px' });
        for (let i = 0; i < _MARKUP_CHECKS.length; i++) {
            const { label, prompt } = _MARKUP_CHECKS[i];
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'baseline', gap: '6px',
                marginBottom: '4px', background: '#181825',
                padding: '5px 7px', borderRadius: '4px',
            });
            const num = Object.assign(document.createElement('span'), { innerText: `${i + 1}.` });
            Object.assign(num.style, { color: '#6c7086', flexShrink: '0', minWidth: '14px' });
            const txt = Object.assign(document.createElement('span'), { innerText: prompt });
            Object.assign(txt.style, { flex: '1', lineHeight: '1.4' });
            row.append(num, txt, mkCopyBtn(prompt));
            promptsContainer.appendChild(row);
        }

        const checkBtn = Object.assign(document.createElement('button'), { innerText: 'Extract & Check' });
        Object.assign(checkBtn.style, {
            padding: '5px 12px', background: '#a6e3a1', color: '#11111b',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
            fontWeight: 'bold', fontFamily: 'monospace', fontSize: '11px', marginBottom: '8px',
        });

        const markupLog = document.createElement('div');

        checkBtn.onclick = async () => {
            markupLog.innerHTML = '';
            checkBtn.disabled = true;
            checkBtn.innerText = 'Extracting…';

            const addLog = (msg, color = '#6c7086') => {
                const line = document.createElement('div');
                line.innerText = msg;
                Object.assign(line.style, { color, fontSize: '10px', whiteSpace: 'pre-wrap' });
                markupLog.appendChild(line);
            };

            const diagUi = {
                stopped: false, total: 0,
                phase(n, label) { addLog(`Phase ${n} — ${label}`, '#89b4fa'); },
                status() {},
                log(msg) { addLog(`> ${msg}`); },
            };

            try {
                await run(diagUi, null);
            } catch (e) {
                addLog(`Error: ${e.message}`, '#f38ba8');
                checkBtn.disabled = false;
                checkBtn.innerText = 'Extract & Check';
                return;
            }

            if (_savedState?.stopReason) addLog(`Stopped early — diagnosis: ${_savedState.stopReason}`, '#f9e2af');

            const sep = document.createElement('div');
            sep.innerText = '──';
            Object.assign(sep.style, { color: '#585b70', margin: '4px 0' });
            markupLog.appendChild(sep);

            const text = (_savedState?.allPrompts ?? []).filter(pr => pr.role === 'assistant').map(pr => pr.text).join('\n');
            if (!text) {
                addLog('Extraction produced no assistant content.', '#f38ba8');
            } else {
                for (const { label, pat } of _MARKUP_CHECKS)
                    addLine(markupLog, pat.test(text), label, null);
            }

            checkBtn.disabled = false;
            checkBtn.innerText = 'Extract & Check';
        };

        panel.append(titleRow, structHead, structLog, recheckBtn, markupHead, intro, promptsContainer, checkBtn, markupLog);
        document.body.appendChild(panel);
        runStructural();
    }

    GM_registerMenuCommand('Compatibility Check', buildDiagUI);
})();
