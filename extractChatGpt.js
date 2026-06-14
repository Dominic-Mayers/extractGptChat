// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      3.15
// @description  Extracts a full ChatGPT conversation to Markdown via automated scrolling.
// @author       Claude
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ── Signal B: track /backend-api/ fetches (ChatGPT loads messages from server) ──
    let _pendingApiCalls = 0;
    const _apiIdleCallbacks = [];
    (function () {
        const origFetch = window.fetch;
        window.fetch = function (...args) {
            const url = typeof args[0] === 'string' ? args[0]
                : (args[0] instanceof Request ? args[0].url : '');
            if (!url.includes('/backend-api/')) return origFetch.apply(this, args);
            _pendingApiCalls++;
            return origFetch.apply(this, args).finally(() => {
                if (--_pendingApiCalls === 0) _apiIdleCallbacks.splice(0).forEach(fn => fn());
            });
        };
    }());

    function waitForApiIdle(timeoutMs) {
        if (_pendingApiCalls === 0) return Promise.resolve();
        return new Promise(resolve => {
            const t = setTimeout(() => {
                const i = _apiIdleCallbacks.indexOf(resolve);
                if (i >= 0) _apiIdleCallbacks.splice(i, 1);
                resolve();
            }, timeoutMs);
            _apiIdleCallbacks.push(() => { clearTimeout(t); resolve(); });
        });
    }

    // ── Signal A: wait for React to finish committing to DOM ─────────────────────
    // Resolves when no childList mutation has fired for `idleMs`, or `timeoutMs` elapses.
    // The MutationObserver fires on every React commit, so the idle period begins only
    // after the last DOM change — meaning we return as soon as rendering is done.
    function waitForDomSettle(container, idleMs = 8, timeoutMs = 150) {
        return new Promise(resolve => {
            const target = container === document.documentElement ? document.body : container;
            let done = false, idleTimer = null;
            const finish = () => {
                if (done) return; done = true;
                obs.disconnect(); clearTimeout(deadline); clearTimeout(idleTimer);
                resolve();
            };
            const deadline = setTimeout(finish, timeoutMs);
            const obs = new MutationObserver(() => {
                clearTimeout(idleTimer);
                idleTimer = setTimeout(finish, idleMs);
            });
            obs.observe(target, { childList: true, subtree: true });
            idleTimer = setTimeout(finish, idleMs);
        });
    }

    // ── Performance counters (reset each run, reported before export) ──
    let _perf = {};
    function _resetPerf() {
        _perf = {
            htmlToMarkdownCalls: 0, htmlToMarkdownMs: 0,
            mergeBlocksCalls: 0,    mergeBlocksMs: 0,
            blocksAdded: 0,         blocksSkipped: 0,
            forwardJumps: 0,
            gapsDetected: 0, gapsRecovered: 0,
            domSamples: [],
            runStartMs: 0,
            // diagnostic fields written to the output file
            containerTag: '', containerScrollH: 0, containerClientH: 0, containerIsDocEl: false,
            lastMsgIdFound: false,
            topAfterScrollToTop: -1,
            exitReason: 'none', exitIter: 0, exitPercent: 0, exitScrollH: 0,
        };
    }
    _resetPerf();

    // ════════════════════════════════════════════════════════════════
    // TASK 3 — Detect what content is available at a given time
    // ════════════════════════════════════════════════════════════════

    /**
     * Returns every message block currently present in the DOM.
     * @returns {{ role: string, text: string }[]}
     */
    function getVisibleBlocks() {
        // Primary: elements with explicit author role
        const primary = [...document.querySelectorAll('[data-message-author-role]')]
            .map(el => ({
                role: el.getAttribute('data-message-author-role'), // 'user' | 'assistant'
                text: htmlToMarkdown(el),
                msgId: el.getAttribute('data-message-id') || null,
            }))
            .filter(b => b.text.length > 0);

        // Fallback: [data-message-id] elements not inside any [data-message-author-role].
        // If present these are messages the primary selector silently skips; role is
        // unknown ('?') — they appear in dev output so we can confirm they exist.
        const extra = [...document.querySelectorAll('[data-message-id]')]
            .filter(el => !el.closest('[data-message-author-role]'))
            .map(el => ({ role: '?', text: el.innerText.trim(), msgId: el.getAttribute('data-message-id') || null }))
            .filter(b => b.text.length > 0);

        return [...primary, ...extra];
    }

    /** Flattens blocks into labelled lines for signature comparison. */
    function blocksToLines(blocks) {
        return blocks.flatMap(b =>
            b.text
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean)
                .map(l => `[${b.role.toUpperCase()}] ${l}`)
        );
    }

    // ════════════════════════════════════════════════════════════════
    // TASK 1 — Find the last 10 lines (or report fewer)
    // ════════════════════════════════════════════════════════════════

    /**
     * Samples the last `n` lines from the currently visible chat content.
     * Call this while the viewport is at the bottom of the chat.
     *
     * @param {number} n
     * @returns {{ ok: boolean, lines: string[], warning?: string, error?: string }}
     */
    function sampleEndSignature(n = 10) {
        const allLines = blocksToLines(getVisibleBlocks());

        if (allLines.length === 0)
            return { ok: false, error: 'No chat content found — is a conversation open?' };

        if (allLines.length < n)
            return {
                ok: true,
                lines: allLines,
                warning: `Chat has only ${allLines.length} lines (fewer than ${n} requested).`,
            };

        return { ok: true, lines: allLines.slice(-n) };
    }

    // ════════════════════════════════════════════════════════════════
    // TASK 2 — Find position relative to the chat / current content
    // ════════════════════════════════════════════════════════════════

    /**
     * Returns scroll metrics for the given container.
     * @returns {{ top: number, bottom: number, percent: number }}
     */
    function getScrollPosition(container) {
        const top    = container === document.documentElement ? window.scrollY : container.scrollTop;
        const range  = container.scrollHeight - container.clientHeight;
        const bottom = range - top;
        return { top, bottom, percent: range > 0 ? Math.round((top / range) * 100) : 100 };
    }

    // ════════════════════════════════════════════════════════════════
    // TASK 4 — Scroll down one step; returns { blocked: true } if scroll
    //          produced no position or fingerprint change
    // ════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════
    // TASK 3 (refined) — Viewport content vs DOM content
    //
    // getVisibleBlocks()  → entire DOM window (~40 messages). Used for
    //                       content accumulation (wider net = safer).
    // getViewportBlocks() → only elements physically on screen. Used for
    //                       end-of-chat detection and scroll change detection.
    //                       Cannot produce false positives from off-screen DOM.
    // ════════════════════════════════════════════════════════════════

    /**
     * Returns message blocks whose elements intersect the visible area of
     * `container` (i.e. what the user can actually see on screen).
     */
    function getViewportBlocks(container) {
        const cRect = container.getBoundingClientRect();
        const inViewport = el => {
            const r = el.getBoundingClientRect();
            return r.bottom > cRect.top && r.top < cRect.bottom;
        };

        const primary = [...document.querySelectorAll('[data-message-author-role]')]
            .filter(inViewport)
            .map(el => ({
                role: el.getAttribute('data-message-author-role'),
                text: el.innerText.trim(),
            }))
            .filter(b => b.text.length > 0);

        const extra = [...document.querySelectorAll('[data-message-id]')]
            .filter(el => !el.closest('[data-message-author-role]') && inViewport(el))
            .map(el => ({ role: '?', text: el.innerText.trim() }))
            .filter(b => b.text.length > 0);

        return [...primary, ...extra];
    }

    /**
     * Scrolls to targetTop in a single step, then waits for any server request
     * triggered by the scroll to complete and for the DOM to settle.
     */
    async function scrollDownStep(container, targetTop, ui) {
        const posBefore = getScrollPosition(container);

        if (Math.abs(posBefore.top - targetTop) <= 1)
            return { moved: true, position: posBefore };

        if (ui?.stopped) return { moved: true, position: posBefore };

        if (container === document.documentElement) window.scrollTo({ top: targetTop, behavior: 'instant' });
        else container.scrollTop = targetTop;

        await waitForApiIdle(15_000);
        await waitForDomSettle(container, 8, 2_000);

        return { moved: true, position: getScrollPosition(container) };
    }

    // ════════════════════════════════════════════════════════════════
    // TASK 5 — Move to the top of the chat
    // ════════════════════════════════════════════════════════════════

    /**
     * Scrolls the container to the very top and waits for the DOM to stabilize.
     * Longer wait compensates for lazy-loaded early messages.
     */
    async function scrollToTop(container, ui) {
        if (container === document.documentElement) window.scrollTo({ top: 0, behavior: 'instant' });
        else container.scrollTo({ top: 0, behavior: 'instant' });
        // Give ChatGPT a moment to initiate the fetch before we check for idle —
        // the API call fires slightly after the scroll, so polling immediately
        // would see zero pending calls and resolve before content starts loading.
        await sleep(400);
        await waitForApiIdle(30_000);
        // Increase timeout for very long chats where loading the top takes >2 s.
        await waitForDomSettle(container, 8, 8_000);
        return getScrollPosition(container);
    }

    // ════════════════════════════════════════════════════════════════
    // HELPERS — Container detection, dedup, end-of-chat check, export
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

    /**
     * Merges `incoming` blocks into `master`, skipping exact duplicates.
     * Dedup key: full role + full text (handles virtual-DOM partial renders).
     * @returns {number} count of newly added blocks
     */
    function mergeBlocks(master, incoming, seen) {
        const _t0 = performance.now();
        // Pre-build a key→index map for O(1) anchor lookups.
        // Updated after each splice to stay accurate.
        const masterMap = new Map(master.map((b, i) => [`${b.role}\x00${b.text}`, i]));
        let added = 0;
        let skipped = 0;
        for (let i = 0; i < incoming.length; i++) {
            const block = incoming[i];
            const key = `${block.role}\x00${block.text}`;
            if (seen.has(key)) { skipped++; continue; }
            seen.add(key);

            // Find insertion point using neighbours in the current snapshot as
            // anchors into master.  Two passes to handle blocks that appear at
            // the start of a snapshot (no known predecessor visible).
            let insertIndex = master.length;

            // Pass 1: nearest preceding neighbour → insert after it.
            for (let j = i - 1; j >= 0; j--) {
                const prevKey = `${incoming[j].role}\x00${incoming[j].text}`;
                const idx = masterMap.get(prevKey);
                if (idx !== undefined) { insertIndex = idx + 1; break; }
            }

            // Pass 2: if no backward anchor, use nearest following neighbour
            // → insert before it.
            if (insertIndex === master.length) {
                for (let j = i + 1; j < incoming.length; j++) {
                    const nextKey = `${incoming[j].role}\x00${incoming[j].text}`;
                    const idx = masterMap.get(nextKey);
                    if (idx !== undefined) { insertIndex = idx; break; }
                }
            }

            master.splice(insertIndex, 0, block);
            // Shift all map entries at or after insertIndex, then register the new block.
            for (const [k, v] of masterMap) {
                if (v >= insertIndex) masterMap.set(k, v + 1);
            }
            masterMap.set(key, insertIndex);
            added++;
        }
        _perf.mergeBlocksMs += performance.now() - _t0;
        _perf.mergeBlocksCalls++;
        return { added, skipped };
    }

    /** Returns true when the end signature appears at the tail of current visible content. */
    function endSignaturePresent(endSig, currentBlocks) {
        const lines = blocksToLines(currentBlocks);
        if (lines.length < endSig.length) return false;
        const tail = lines.slice(-endSig.length);
        return tail.every((line, i) => line === endSig[i]);
    }

    // ════════════════════════════════════════════════════════════════
    // MESSAGE-ID TERMINATION (primary, more reliable than text sig)
    // ════════════════════════════════════════════════════════════════

    /**
     * Returns the data-message-id of the last message currently in the DOM,
     * or null if the attribute is absent on this version of ChatGPT.
     */
    function getLastVisibleMessageId() {
        const msgs = [...document.querySelectorAll('[data-message-id]')];
        return msgs.length > 0 ? msgs[msgs.length - 1].getAttribute('data-message-id') : null;
    }

    /**
     * Returns true when the element with `id` is physically visible inside
     * the container's viewport — not merely present in the DOM.
     * This is the correct end-of-chat check: it can only be true when the
     * user has scrolled far enough to actually see the last message on screen.
     */
    function isLastMessageInViewport(id, container) {
        if (!id) return false;
        const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
        if (!el) return false;
        const cRect = container.getBoundingClientRect();
        const r     = el.getBoundingClientRect();
        return r.bottom > cRect.top && r.top < cRect.bottom;
    }

    function countPairs(blocks) {
        return blocks.filter(b => b.role === 'user').length;
    }

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
                return text.replace(/\n/g, ' ');
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            if (node.getAttribute('aria-hidden') === 'true') return '';
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
                    const fence = t.includes('`') ? '``' : '`';
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
                    return `\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
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
                    return href ? `[${inner}](${href})` : inner;
                }
                case 'img': {
                    const alt = node.getAttribute('alt') || '';
                    const src = node.getAttribute('src') || '';
                    return src ? `![${alt}](${src})` : alt ? `[image: ${alt}]` : '[image]';
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
                /([^\s/]+\.\w{2,6})\s*(?:File|Image|Document|Spreadsheet|Presentation|[A-Z]{2,6})/g,
                (_match, filename) => `\nUpload: ${filename}\n\n`
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

    /** Compiles master blocks to a Markdown document and triggers a download. */
    function hoistUploads(text) {
        const uploads = [];
        const body = text.replace(/\nUpload:([^\n]+)/g, (_m, name) => {
            uploads.push(`Upload:${name}`);
            return '';
        });
        if (!uploads.length) return text;
        return uploads.join('\n') + '\n\n' + body.replace(/^\n+/, '').trimStart();
    }

    async function exportMarkdown(blocks) {
        const questions = countPairs(blocks);
        const date  = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        const title = getChatTitle();

        // Count prompt navigation dots for the diagnostic (dot count vs exported count).
        const promptDots = getPromptDots();

        let md = `# ${title}\n_${questions} user prompts — ${date}_\n\n`;

        const userBlocks = blocks.filter(b => b.role === 'user');
        if (userBlocks.length > 0) {
            md += `### Table of Contents\n\n`;
            userBlocks.forEach((b, i) => {
                const firstLine = b.text.split('\n')
                    .map(l => l.replace(/[^\x20-\x7E]/g, '').trim())
                    .filter(l => l && !l.startsWith('Upload:'))
                    [0] || '(empty)';
                const label = firstLine.slice(0, 80);
                md += b.msgId
                    ? `${i + 1}. [${label}](#msg-${b.msgId})\n`
                    : `${i + 1}. ${label}\n`;
            });
            md += '\n';
        }

        md += `---\n\n`;

        for (const b of blocks) {
            const label = b.role === 'user' ? '### USER' : b.role === 'assistant' ? '### ASSISTANT' : '### UNKNOWN';
            const text  = b.role === 'user' ? hoistUploads(b.text) : b.text;
            const anchor = b.role === 'user' && b.msgId ? `<a id="msg-${b.msgId}"></a>\n\n` : '';
            md += `${anchor}${label}\n\n${text}\n\n---\n\n`;
        }
        if (_perf.runStartMs > 0) {
            const _ms    = performance.now() - _perf.runStartMs;
            const _sleep = _ms - _perf.htmlToMarkdownMs - _perf.mergeBlocksMs;
            const _dup   = _perf.htmlToMarkdownCalls
                ? Math.round(100 * _perf.blocksSkipped / _perf.htmlToMarkdownCalls) : 0;
            const _wast  = Math.round(_perf.htmlToMarkdownMs * _perf.blocksSkipped
                / Math.max(_perf.htmlToMarkdownCalls, 1));

            md += `    ── perf (v3.12) ──\n`
                + `    total ${(_ms/1000).toFixed(1)}s | sleep/wait ${(_sleep/1000).toFixed(1)}s (${Math.round(100*_sleep/_ms)}%)\n`
                + `    htmlToMarkdown: ${_perf.htmlToMarkdownCalls} calls, ${Math.round(_perf.htmlToMarkdownMs)}ms\n`
                + `    dups ${_perf.blocksSkipped}/${_perf.htmlToMarkdownCalls} (${_dup}%) → ~${_wast}ms wasted\n`
                + `    mergeBlocks: ${_perf.mergeBlocksCalls} calls, ${Math.round(_perf.mergeBlocksMs)}ms | new ${_perf.blocksAdded}\n`
                + `    Exported ${countPairs(blocks)} user prompts (${blocks.length} blocks).\n`
                + `\n`
                + `    ── diag (v3.12) ──\n`
                + `    container: <${_perf.containerTag}> scrollH=${_perf.containerScrollH} clientH=${_perf.containerClientH}${_perf.containerIsDocEl ? ' [FALLBACK-docEl]' : ''}\n`
                + `    top after scrollToTop: ${_perf.topAfterScrollToTop}px${_perf.topAfterScrollToTop > 10 ? ' [WARNING: did not reach top]' : ''}\n`
                + `    lastMsgId: ${_perf.lastMsgIdFound ? 'found' : 'NOT FOUND — used text sig'}\n`
                + `    exit: ${_perf.exitReason} (${_perf.exitPercent}%), scrollH at exit: ${_perf.exitScrollH}\n`
                + (_perf.forwardJumps > 0
                    ? `    WARNING: ${_perf.forwardJumps} forward position jump(s) detected — output may be incomplete\n`
                    : `    forward jumps: none\n`)
                + (_perf.gapsDetected > 0
                    ? `    gaps detected: ${_perf.gapsDetected}, recovered: ${_perf.gapsRecovered}\n`
                    : `    gap detection: no gaps found\n`)
                + (() => {
                    const dots = promptDots.length;
                    const exported = countPairs(blocks);
                    if (dots === 0) return `    prompt nav: dots not visible at export time\n`;
                    return `    prompt nav: ${dots} dots | exported: ${exported} → ${dots === exported ? 'OK' : 'MISMATCH'}\n`;
                })();
            if (_perf.domSamples.filter(s => s.w >= 0).length > 1) {
                const ds = _perf.domSamples.filter(s => s.w >= 0);
                const sizes = ds.map(s => s.d).sort((a, b) => a - b);
                const minD = sizes[0], maxD = sizes[sizes.length - 1];
                const avgD = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
                const q = [0.25, 0.5, 0.75].map(p => sizes[Math.floor(sizes.length * p)]);
                const bands = [
                    [`≤ ${q[0]}`,         s => s.d <= q[0]],
                    [`${q[0]+1}–${q[1]}`, s => s.d > q[0] && s.d <= q[1]],
                    [`${q[1]+1}–${q[2]}`, s => s.d > q[1] && s.d <= q[2]],
                    [`> ${q[2]}`,         s => s.d > q[2]],
                ];
                let out = `    ── dom size vs wait between changes (v3.14) ──\n`
                        + `    ${ds.length} changes | dom: min=${minD} avg=${avgD} max=${maxD}\n`;
                for (const [label, fn] of bands) {
                    const samp = ds.filter(fn);
                    if (!samp.length) continue;
                    const avg = Math.round(samp.reduce((a, s) => a + s.w, 0) / samp.length);
                    out += `    dom ${label}: avg ${avg}ms between changes (${samp.length} samples)\n`;
                }
                md += out;
            }
            const _hasPQ = _perf.domSamples.length > 0 && _perf.domSamples[0].p !== undefined;
            if (_hasPQ) {
                const ds = [..._perf.domSamples].sort((a, b) => a.p - b.p);
                const totalPrompts = countPairs(blocks);
                const qAt = pct => {
                    const s = ds.filter(s => s.p <= pct);
                    return s.length ? s[s.length - 1].q : 0;
                };
                const breaks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100];
                const _hasU = ds.some(s => s.uBefore !== undefined);
                let out = `    ── prompts at different scroll % (v3.15) ──\n`;
                // Column field widths (data determines width; header is padStart'd to same):
                //   pos%     : "100%"              = 4  → header "pos%"      = 4  → use 5
                //   Duration : "9h59m59s (+999s)"  = 16 → header "Duration"  = 8  → use 16
                //   rank#    : "999"               = 3  → header "rank#"     = 5  → use 5
                //   prompts# : "999 (+999)"        = 10 → header "prompts#"  = 8  → use 10
                //   prompts% : "100% (+100%)"      = 12 → header "prompts%"  = 8  → use 12
                //   above    : "  999"             = 5  → header "above"    = 5  → use 5
                //   below    : same as above → 5
                const _S  = '   '; // inter-column separator
                const _hasR = ds.some(s => s.r !== undefined);
                //                   pos%  Duration  rank#  prompts#  prompts%  above  below
                const _W  = _hasR ? [5, 16, 5, 10, 12, 5, 5] : [5, 16, 10, 12, 5, 5];
                const fQ  = (q, d) => `${String(q).padStart(3)} (+${String(d).padStart(3)})`; // 10 chars
                const fP  = (p, d) => `${(p + '%').padStart(4)} (+${String(d).padStart(3)}%)`; // 12 chars
                const fU  = n => String(n).padStart(5);                                         // 5 chars
                const fT  = (s, ds) => {
                    const fmt = t => {
                        const h = Math.floor(t / 3600);
                        const m = Math.floor((t % 3600) / 60);
                        const r = t % 60;
                        if (h > 0) return `${h}h${String(m).padStart(2,'0')}m${String(r).padStart(2,'0')}s`;
                        if (m > 0) return `${m}m${String(r).padStart(2,'0')}s`;
                        return `${r}s`;
                    };
                    return `${fmt(s).padStart(8)} (+${String(ds).padStart(3)}s)`; // 16 chars
                };
                const tAt = pct => {
                    let cum = 0;
                    for (const s of ds) { if (s.p > pct) break; if (s.w >= 0) cum += s.w; }
                    return cum;
                };
                const hdrs = _hasR
                    ? ['pos%', 'Duration', 'rank#', 'prompts#', 'prompts%', 'above', 'below']
                    : ['pos%', 'Duration', 'prompts#', 'prompts%', 'above', 'below'];
                let hdrLine = '    ' + hdrs.map((h, i) => h.padStart(_W[i])).join(_S);
                if (!_hasU) hdrLine = '    ' + hdrs.slice(0, _hasR ? 5 : 4).map((h, i) => h.padStart(_W[i])).join(_S);
                out += hdrLine + '\n';
                for (let i = 0; i < breaks.length; i++) {
                    const hi  = breaks[i];
                    const lo  = i > 0 ? breaks[i - 1] : null;
                    const cumQ   = qAt(hi);
                    const prevQ  = lo !== null ? qAt(lo) : 0;
                    const incQ   = cumQ - prevQ;
                    const cumPct = totalPrompts ? Math.round(100 * cumQ  / totalPrompts) : 0;
                    const prvPct = totalPrompts && lo !== null ? Math.round(100 * prevQ / totalPrompts) : 0;
                    const incPct = cumPct - prvPct;
                    const cumTs  = Math.round(tAt(hi) / 1000);
                    const prevTs = lo !== null ? Math.round(tAt(lo) / 1000) : 0;
                    const incTs  = cumTs - prevTs;
                    let line = '    ' + (hi + '%').padStart(_W[0])
                             + _S + fT(cumTs, incTs);
                    if (_hasR) {
                        const bandR = lo !== null
                            ? ds.filter(s => s.p > lo && s.p <= hi && s.r !== undefined)
                            : [];
                        const avgR = bandR.length
                            ? Math.round(bandR.reduce((a, s) => a + s.r, 0) / bandR.length)
                            : null;
                        const _defaultR = lo === null ? 1
                            : (hi === 100 && bandR.length === 0) ? totalPrompts : null;
                        const _dispR = avgR !== null ? avgR : _defaultR;
                        line += _S + (_dispR !== null ? String(_dispR).padStart(_W[2]) : ' '.repeat(_W[2]));
                    }
                    line += _S + fQ(cumQ, incQ)
                          + _S + fP(cumPct, incPct);
                    if (_hasU) {
                        if (lo === null) {
                            if (ds.length && ds[0].uAfter !== undefined)
                                line += _S + fU(0) + _S + fU((ds[0].uBefore || 0) + ds[0].uAfter);
                        } else {
                            const band = ds.filter(s => s.p > lo && s.p <= hi && s.uBefore !== undefined);
                            if (band.length) {
                                const avgB = Math.round(band.reduce((a, s) => a + s.uBefore, 0) / band.length);
                                const avgA = Math.round(band.reduce((a, s) => a + s.uAfter,  0) / band.length);
                                line += _S + fU(avgB) + _S + fU(avgA);
                            } else if (hi === 100) {
                                const _last = ds.length ? ds[ds.length - 1] : null;
                                if (_last && _last.uBefore !== undefined)
                                    line += _S + fU(_last.uBefore + _last.uAfter) + _S + fU(0);
                            }
                        }
                    }
                    out += line + '\n';
                }
                md += out;
            }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + md], { type: 'text/markdown;charset=utf-8' }));
        a.download = `${titleToSlug(title)}-${Date.now()}.md`;
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
     * Returns the ordered array of prompt navigation dot buttons.
     * Each button's aria-label is a snippet of the corresponding user prompt.
     * Primary: look inside the narrow vertical strip (div.w-9.max-h-[50lvh].no-scrollbar).
     * Fallback: match by button class (h-0.5 w-4.5 rounded-full).
     */
    function getPromptDots() {
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

    /**
     * Matches a viewport block's innerText to a 0-based panel snippet index.
     * Returns -1 if no match is found.
     * Checks the first 3 non-trivial lines of the block against all panel norms.
     */
    function findPanelIndex(blockInnerText, panelNorms) {
        const candidates = blockInnerText.split('\n')
            .map(l => l.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
            .filter(l => l.length > 3)
            .slice(0, 3);
        for (const bNorm of candidates) {
            for (let i = 0; i < panelNorms.length; i++) {
                const pNorm = panelNorms[i];
                if (pNorm.length < 5) continue;
                // Normal case: block starts with (truncated) panel snippet.
                // Short-prompt case: panel snippet starts with the full block text.
                if (bNorm.startsWith(pNorm) || pNorm.startsWith(bNorm)) return i;
            }
        }
        return -1;
    }

    /**
     * Returns true when panelNorm (a pre-normalised panel snippet) is present
     * somewhere in the full normalised text of a master user block.
     * Uses the same join-all-lines + includes() strategy as the export diagnostic.
     */
    function isInMaster(panelNorm, master) {
        if (!panelNorm) return true;
        // Strip markdown chars that htmlToMarkdown may remove from the extracted text
        // so that panel labels containing e.g. `code` or **bold** still match.
        const norm = panelNorm.replace(/[*`_#[\]]/g, '').replace(/\s+/g, ' ').trim();
        if (!norm) return true;
        return master.some(b => {
            if (b.role !== 'user') return false;
            const fullNorm = b.text.split('\n')
                .map(l => l.replace(/[^\x20-\x7E]/g, '').replace(/[*`_#[\]]/g, '').replace(/\s+/g, ' ').trim())
                .filter(l => l && !l.startsWith('Upload:'))
                .join(' ')
                .toLowerCase();
            return fullNorm.includes(norm);
        });
    }

    /**
     * Recovers a missing panel prompt by clicking its navigation dot,
     * waiting for ChatGPT to load the content, and merging into master.
     */
    async function recoverGap(missingPanelIdx, container, master, seen, ui) {
        const dots = getPromptDots();
        const dot = dots[missingPanelIdx];
        if (!dot) {
            ui.log(`GAP: dot at index ${missingPanelIdx} not found — cannot recover`);
            return;
        }
        dot.click();
        await sleep(400);
        await waitForApiIdle(30_000);
        await waitForDomSettle(container, 8, 8_000);
        const newBlocks = getVisibleBlocks();
        const { added } = mergeBlocks(master, newBlocks, seen);
        _perf.blocksAdded += added;
        ui.log(`GAP: navigated to prompt ${missingPanelIdx + 1}, merged ${added} new blocks`);
    }

    // ════════════════════════════════════════════════════════════════
    // ORCHESTRATION
    // ════════════════════════════════════════════════════════════════

    async function run(ui, stopBtn) {
        _resetPerf();
        _perf.runStartMs = performance.now();
        let container = findScrollContainer();
        _perf.containerTag      = container.tagName.toLowerCase();
        _perf.containerScrollH  = container.scrollHeight;
        _perf.containerClientH  = container.clientHeight;
        _perf.containerIsDocEl  = container === document.documentElement;

        // ── Phase 1: Sample termination anchors at the bottom of the chat ──
        ui.phase('1/4', 'Sampling end anchors');

        // Primary: last message UUID (immune to repeated text)
        const lastMsgId = getLastVisibleMessageId();
        _perf.lastMsgIdFound = !!lastMsgId;

        // Fallback: last 20 lines of visible text (doubled from 10 to reduce false matches)
        const sample = sampleEndSignature(20);
        if (!sample.ok) throw new Error(sample.error);
        if (sample.warning) ui.log(`Note: ${sample.warning}`);
        const endSig = sample.lines;

        // ── Phase 2: Move to top ──────────────────────────────────────────
        ui.phase('2/4', 'Scrolling to top');
        const topPos = await scrollToTop(container, ui);
        _perf.topAfterScrollToTop = topPos.top;
        if (topPos.top > 10) {
            ui.log(`WARNING: scroll top=${topPos.top} after scroll — container may be wrong.`);
        }
        if (topPos.top > 0) ui.log(`at top: ${topPos.top}px remaining`);

        // ── Phase 3: Scan downwards, accumulate unique content ────────────
        ui.phase('3/4', 'Scanning');
        const master = [];
        const seen = new Set();
        let iteration = 0;
        let scriptScrollTop = getScrollPosition(container).top;

        if (stopBtn) stopBtn.onclick = () => ui.stopAndExport(master);

        // stepPx is constant for the session — compute once outside the loop.
        const stepPx = container.clientHeight || 600;
        if (!container.clientHeight) {
            ui.log('WARNING: container.clientHeight is 0 — using 600 px fallback. Container may be wrong.');
        }

        // ── Collect panel snippets for runtime gap detection ──────────────────
        // Dot aria-labels are "Prompt N" at rest; they update to descriptive text
        // when the strip is hovered. Hover once at startup to capture real text,
        // then un-hover so the UI returns to its normal state.
        let runPanelNorms = null;
        let lastConfirmedPanelIndex = -1;
        {
            const gapDots = getPromptDots();
            if (gapDots.length > 0) {
                const strip = gapDots[0].closest('div[class*="no-scrollbar"]') || gapDots[0].parentElement;
                for (const t of ['pointerover', 'mouseover', 'mouseenter'])
                    strip.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
                await sleep(500);
                const labels = getPromptDots().map(b => b.getAttribute('aria-label') || '');
                const descriptive = labels.filter(l => !/^Prompt \d+$/i.test(l) && l.length > 3);
                if (descriptive.length > 0) {
                    runPanelNorms = labels.map(l =>
                        l.replace(/\s*(…|\.\.\.)$/, '')
                         .replace(/[^\x20-\x7E]/g, '')
                         .replace(/\s+/g, ' ')
                         .trim()
                         .toLowerCase()
                    ).filter(l => l && !/^prompt \d+$/i.test(l));
                    ui.total = runPanelNorms.length;
                    ui.log(`${runPanelNorms.length} user prompts from the menu`);
                } else {
                    ui.log('Gap detection: hover did not reveal text labels — disabled');
                }
                for (const t of ['pointerout', 'mouseout', 'mouseleave'])
                    strip.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
            } else {
                ui.log('Gap detection: prompt dots not found — disabled');
            }
        }

        let _lastChangeMs = -1; // performance.now() at the last iteration that added new blocks

        while (true) {
            iteration++;
            const _blocksAtIterStart = _perf.blocksAdded;

            if (ui.stopped) {
                const _sp = getScrollPosition(container);
                _perf.exitReason = 'stopped'; _perf.exitIter = iteration;
                _perf.exitPercent = _sp.percent; _perf.exitScrollH = container.scrollHeight;
                break;
            }

            // Re-acquire container if ChatGPT remounted it — a detached node
            // silently ignores scrollTop writes and causes a 30 s timeout.
            // Must happen before termination checks that call container.getBoundingClientRect().
            if (!document.contains(container)) {
                ui.log(`container detached — re-finding`);
                container = findScrollContainer();
                scriptScrollTop = getScrollPosition(container).top;
            }

            // Position guard: if the scroll landed significantly behind the expected
            // position (e.g. WheelEvent caused an unintended snap), skip content
            // capture this iteration to avoid inserting out-of-order messages.
            const { top: currentTop, percent: currentPercent } = getScrollPosition(container);
            if (currentTop > scriptScrollTop + stepPx * 2) {
                const gap = Math.round(currentTop - scriptScrollTop);
                _perf.forwardJumps++;
                ui.log(`WARNING: pos jumped forward ${gap}px — content gap likely`);
            }
            if (currentTop >= scriptScrollTop - 2 * stepPx) {
                const current = getVisibleBlocks();
                const { added, skipped } = mergeBlocks(master, current, seen);
                _perf.blocksAdded += added; _perf.blocksSkipped += skipped;
                ui.status(countPairs(master), currentPercent);
            } else {
                ui.status(countPairs(master), currentPercent);
            }

            // ── Runtime gap detection ─────────────────────────────────────────
            // Invariant: when panel prompt K is visible in the viewport, all prompts
            // 0..K-1 must already be in master. Process each visible user prompt in
            // ascending index order so no assumption is made about future visibility.
            // Stop after any gap recovery — DOM state may have changed.
            if (runPanelNorms && runPanelNorms.length > 0) {
                const vpUsers = getViewportBlocks(container).filter(b => b.role === 'user');
                const vpIndices = vpUsers
                    .map(b => findPanelIndex(b.text, runPanelNorms))
                    .filter(k => k > lastConfirmedPanelIndex)
                    .sort((a, b) => a - b);
                let recovered = false;
                for (const targetIdx of vpIndices) {
                    for (let J = lastConfirmedPanelIndex + 1; J < targetIdx; J++) {
                        if (!isInMaster(runPanelNorms[J], master)) {
                            _perf.gapsDetected++;
                            ui.log(`GAP: panel prompt ${J + 1} missing — recovering`);
                            const savedTop = scriptScrollTop;
                            await recoverGap(J, container, master, seen, ui);
                            _perf.gapsRecovered++;
                            scriptScrollTop = savedTop;
                            lastConfirmedPanelIndex = J;
                            recovered = true;
                            break;
                        }
                    }
                    if (recovered) break;
                    lastConfirmedPanelIndex = targetIdx;
                }
            }

            const pos = getScrollPosition(container);

            // Primary termination: last message UUID is physically on screen
            // AND we are within 3 viewport heights of the physical bottom.
            // The pos.bottom guard prevents false termination when lastMsgId was
            // captured from a partially-loaded chat whose scrollHeight later grew
            // (the ID element can appear in the DOM mid-chat for the old extent).
            if (isLastMessageInViewport(lastMsgId, container) && pos.bottom <= stepPx * 3) {
                const { added: _a, skipped: _s } = mergeBlocks(master, getVisibleBlocks(), seen);
                _perf.blocksAdded += _a; _perf.blocksSkipped += _s;
                _perf.exitReason = 'lastMsgId'; _perf.exitIter = iteration;
                _perf.exitPercent = pos.percent; _perf.exitScrollH = container.scrollHeight;
                ui.log(`Exit: last message in viewport (${pos.percent}%) — done.`);
                break;
            }

            // Fallback termination: end signature visible in the viewport
            // (used only when data-message-id is unavailable)
            if (!lastMsgId && endSignaturePresent(endSig, getViewportBlocks(container))) {
                _perf.exitReason = 'textSig'; _perf.exitIter = iteration;
                _perf.exitPercent = getScrollPosition(container).percent;
                _perf.exitScrollH = container.scrollHeight;
                ui.log(`Exit: text signature in viewport — done.`);
                break;
            }

            // Safety net: physical scroll bottom
            if (pos.bottom <= 2) {
                _perf.exitReason = 'physBottom'; _perf.exitIter = iteration;
                _perf.exitPercent = pos.percent; _perf.exitScrollH = container.scrollHeight;
                ui.log(`Exit: physical bottom (${pos.percent}%).`);
                break;
            }

            const targetTop = scriptScrollTop + stepPx;
            const step = await scrollDownStep(container, targetTop, ui);
            if (!step.moved) {
                _perf.exitReason = 'scrollTimeout'; _perf.exitIter = iteration;
                _perf.exitPercent = step.position.percent; _perf.exitScrollH = container.scrollHeight;
                ui.log('Scroll stuck for 30s — choose an action:');
                const decision = await ui.promptTimeout();
                if (decision === 'continue') {
                    _perf.exitReason = 'none';
                    continue;
                }
                if (decision === 'stop') ui.skipExport = true;
                break;
            }
            scriptScrollTop = Math.max(targetTop, step.position.top);
            const _confirmedAdvanced = lastConfirmedPanelIndex >= 0
                && (_perf.domSamples.length === 0
                    || _perf.domSamples[_perf.domSamples.length - 1].r !== lastConfirmedPanelIndex + 1);
            if (_perf.blocksAdded > _blocksAtIterStart || _confirmedAdvanced) {
                const _now  = performance.now();
                const _uEls  = [...document.querySelectorAll('[data-message-author-role="user"]')];
                const _cnorm = runPanelNorms && lastConfirmedPanelIndex >= 0
                    ? runPanelNorms[lastConfirmedPanelIndex] : null;
                const _cidx  = _cnorm !== null
                    ? _uEls.findIndex(el => el.innerText.toLowerCase().includes(_cnorm)) : -1;
                // _cidx >= 0  → confirmed prompt found: count by index
                // _cidx  < 0, lastConfirmedPanelIndex < 0 → very start: above=0, below=all DOM
                // _cidx  < 0, lastConfirmedPanelIndex >= 0 → not in DOM: fall back to viewport
                const _cRect = (_cidx < 0 && lastConfirmedPanelIndex >= 0)
                    ? container.getBoundingClientRect() : null;
                const _uBefore = _cidx >= 0 ? _cidx
                    : lastConfirmedPanelIndex < 0 ? 0
                    : _uEls.filter(el => el.getBoundingClientRect().bottom < _cRect.top).length;
                const _uAfter  = _cidx >= 0 ? _uEls.length - _cidx - 1
                    : lastConfirmedPanelIndex < 0 ? Math.max(0, _uEls.length - 1)
                    : _uEls.filter(el => el.getBoundingClientRect().top    > _cRect.bottom).length;
                _perf.domSamples.push({
                    d: document.getElementsByTagName('*').length,
                    w: _lastChangeMs >= 0 ? Math.round(_now - _lastChangeMs) : -1,
                    p: runPanelNorms && runPanelNorms.length > 0
                        ? (lastConfirmedPanelIndex < 0 ? 0 : Math.round(100 * (lastConfirmedPanelIndex + 1) / runPanelNorms.length))
                        : getScrollPosition(container).percent,
                    q: countPairs(master),
                    uBefore: _uBefore,
                    uAfter:  _uAfter,
                    r: lastConfirmedPanelIndex >= 0 ? lastConfirmedPanelIndex + 1 : undefined,
                });
                _lastChangeMs = _now;
            }
        }

        // Sentinel: capture any blocks added in the exit-path merge that
        // happened before the break and never got a sample pushed.
        // Use exitPercent (recorded at break time) rather than a live
        // getScrollPosition() call — scrollHeight may have grown since then,
        // which would make the computed percent too small and misplace the
        // sentinel in the wrong scroll band.
        {
            const _finalQ = countPairs(master);
            const _lastQ = _perf.domSamples.length ? _perf.domSamples[_perf.domSamples.length - 1].q : 0;
            if (_finalQ > _lastQ) {
                const _uEls  = [...document.querySelectorAll('[data-message-author-role="user"]')];
                const _cnorm = runPanelNorms && lastConfirmedPanelIndex >= 0
                    ? runPanelNorms[lastConfirmedPanelIndex] : null;
                const _cidx  = _cnorm !== null
                    ? _uEls.findIndex(el => el.innerText.toLowerCase().includes(_cnorm)) : -1;
                const _cRect = (_cidx < 0 && lastConfirmedPanelIndex >= 0)
                    ? container.getBoundingClientRect() : null;
                const _uBefore = _cidx >= 0 ? _cidx
                    : lastConfirmedPanelIndex < 0 ? 0
                    : _uEls.filter(el => el.getBoundingClientRect().bottom < _cRect.top).length;
                const _uAfter  = _cidx >= 0 ? _uEls.length - _cidx - 1
                    : lastConfirmedPanelIndex < 0 ? Math.max(0, _uEls.length - 1)
                    : _uEls.filter(el => el.getBoundingClientRect().top    > _cRect.bottom).length;
                _perf.domSamples.push({
                    d: document.getElementsByTagName('*').length,
                    w: -1,
                    p: runPanelNorms && runPanelNorms.length > 0 && lastConfirmedPanelIndex >= 0
                        ? Math.round(100 * (lastConfirmedPanelIndex + 1) / runPanelNorms.length)
                        : 100,
                    q: _finalQ,
                    uBefore: _uBefore,
                    uAfter:  _uAfter,
                    r: lastConfirmedPanelIndex >= 0 ? lastConfirmedPanelIndex + 1 : undefined,
                });
            }
        }

        // ── Phase 4: Export ───────────────────────────────────────────────
        ui.phase('4/4', 'Exporting');
        const _totalMs  = performance.now() - _perf.runStartMs;
        const _procMs   = _perf.htmlToMarkdownMs + _perf.mergeBlocksMs;
        const _sleepMs  = _totalMs - _procMs;
        const _dupPct   = _perf.htmlToMarkdownCalls
            ? Math.round(100 * _perf.blocksSkipped / _perf.htmlToMarkdownCalls) : 0;
        const _wastMs   = Math.round(_perf.htmlToMarkdownMs * _perf.blocksSkipped
            / Math.max(_perf.htmlToMarkdownCalls, 1));
        ui.log('── perf (v3.11) ──');
        ui.log(`total ${(_totalMs/1000).toFixed(1)}s | sleep/wait ${(_sleepMs/1000).toFixed(1)}s (${Math.round(100*_sleepMs/_totalMs)}%)`);
        ui.log(`htmlToMarkdown: ${_perf.htmlToMarkdownCalls} calls, ${Math.round(_perf.htmlToMarkdownMs)}ms`);
        ui.log(`  dups ${_perf.blocksSkipped}/${_perf.htmlToMarkdownCalls} (${_dupPct}%) → ~${_wastMs}ms wasted`);
        ui.log(`mergeBlocks: ${_perf.mergeBlocksCalls} calls, ${Math.round(_perf.mergeBlocksMs)}ms | new ${_perf.blocksAdded}`);
        if (_perf.gapsDetected > 0)
            ui.log(`gaps: ${_perf.gapsDetected} detected, ${_perf.gapsRecovered} recovered`);
        if (!ui.skipExport) {
            await exportMarkdown(master);
            ui.log(`Exported ${countPairs(master)} user prompts (${master.length} blocks).`);
        } else {
            ui.log('Export skipped by user.');
        }
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
            innerText: 'ChatGPT Extractor v3.12',
        });
        Object.assign(title.style, { fontWeight: 'bold', color: '#89b4fa' });

        const toggleBtn = Object.assign(document.createElement('button'), { innerText: '×' });
        Object.assign(toggleBtn.style, {
            background: 'none', border: 'none', color: '#89b4fa',
            cursor: 'pointer', fontSize: '16px', lineHeight: '1',
            padding: '0 2px', fontFamily: 'monospace',
        });

        titleRow.append(title, toggleBtn);

        const phaseEl  = Object.assign(document.createElement('div'), { innerText: 'Phase: Idle' });
        const statusEl = document.createElement('div');
        Object.assign(statusEl.style, { color: '#dde1f4', marginTop: '6px' });
        const promptsEl = Object.assign(document.createElement('div'), { innerText: 'User prompts : —' });
        const percentEl = Object.assign(document.createElement('div'), { innerText: 'Scrolled : —' });
        statusEl.append(promptsEl, percentEl);

        const logEl = document.createElement('div');
        Object.assign(logEl.style, {
            marginTop: '8px', maxHeight: '160px', overflowY: 'auto',
            background: '#181825', padding: '6px', borderRadius: '4px',
            fontSize: '11px', color: '#dde1f4',
        });

        const note = Object.assign(document.createElement('div'), {
            innerText: 'Scroll to the BOTTOM of the chat before starting.',
        });
        Object.assign(note.style, { marginTop: '8px', color: '#f9e2af', fontSize: '11px' });

        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, { display: 'flex', gap: '8px', marginTop: '10px' });

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

        btnRow.append(btn, stopBtn);

        const body = document.createElement('div');
        body.append(phaseEl, logEl, statusEl, note, btnRow);

        panel.append(titleRow, body);

        panel.style.display = 'none';
        document.body.appendChild(panel);

        GM_registerMenuCommand('Show / Hide Extractor Panel', () => {
            panel.style.display = panel.style.display === 'none' ? '' : 'none';
        });

        toggleBtn.onclick = () => {
            panel.style.display = 'none';
        };

        const ui = {
            stopped: false,
            skipExport: false,
            total: 0,
            phase(n, label) {
                phaseEl.innerText = `Phase ${n} — ${label}`;
                console.log(`[Extractor] PHASE ${n} — ${label}`);
            },
            status(prompts, percent) {
                promptsEl.innerText = `User prompts : ${prompts}${this.total ? ' / ' + this.total : ''}`;
                percentEl.innerText = `Scrolled : ${percent}%`;
                console.log(`[Extractor] STATUS: ${prompts} user prompts — ${percent}%`);
            },
            log(msg) {
                const line = Object.assign(document.createElement('div'), {
                    innerText: `> ${msg}`,
                });
                logEl.appendChild(line);
                logEl.scrollTop = logEl.scrollHeight;
                console.log(`[Extractor] ${msg}`);
            },
            async stopAndExport(master) {
                this.stopped = true;
                await exportMarkdown(master);
            },
            promptTimeout() {
                return new Promise(resolve => {
                    const row = document.createElement('div');
                    Object.assign(row.style, {
                        display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap',
                    });
                    const makeBtn = (label, bg) => {
                        const b = Object.assign(document.createElement('button'), { innerText: label });
                        Object.assign(b.style, {
                            flex: '1', padding: '6px 10px', background: bg, color: '#11111b',
                            border: 'none', borderRadius: '4px',
                            fontWeight: 'bold', cursor: 'pointer', fontFamily: 'monospace',
                        });
                        return b;
                    };
                    const exportBtn   = makeBtn('Export',    '#89b4fa');
                    const continueBtn = makeBtn('Continue',  '#a6e3a1');
                    const stopBtn     = makeBtn('Stop',      '#f38ba8');
                    const cleanup = () => row.remove();
                    exportBtn.onclick   = () => { cleanup(); resolve('export'); };
                    continueBtn.onclick = () => { cleanup(); resolve('continue'); };
                    stopBtn.onclick     = () => { cleanup(); resolve('stop'); };
                    row.append(exportBtn, continueBtn, stopBtn);
                    body.appendChild(row);
                });
            },
        };

        btn.onclick = async () => {
            btn.disabled = true;
            ui.stopped = false;
            Object.assign(btn.style, { background: '#45475a', color: '#585b70' });
            note.style.display = 'none';
            stopBtn.style.display = '';

            try {
                await run(ui, stopBtn);
                stopBtn.style.display = 'none';
                if (ui.stopped) {
                    ui.phase('Stopped', 'Partial export saved');
                    btn.disabled = false;
                    Object.assign(btn.style, { background: '#89b4fa', color: '#11111b' });
                    btn.innerText = 'Restart';
                    note.style.display = '';
                } else {
                    ui.phase('Done', 'Export complete');
                    btn.innerText = 'Done';
                }
            } catch (err) {
                stopBtn.style.display = 'none';
                ui.phase('Error', err.message);
                ui.log(`ERROR: ${err.message}`);
                btn.disabled = false;
                Object.assign(btn.style, { background: '#f38ba8', color: '#11111b' });
                btn.innerText = 'Retry';
                note.style.display = '';
            }
        };
    }

    buildUI();
})();
