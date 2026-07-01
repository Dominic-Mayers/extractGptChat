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
    const nextAnimationFrame = () => new Promise(r => requestAnimationFrame(() => r()));

    // ── Performance counters (reset each run, reported before export) ──
    let _perf = {};
    function _resetPerf() {
        _perf = {
            htmlToMarkdownCalls: 0, htmlToMarkdownMs: 0,
            snapshots: [],
            runStartMs: 0,
            containerTag: '', containerScrollH: 0, containerClientH: 0, containerIsDocEl: false,
            navItemCount: 0, navClickedIndex: -1, navClickScrollTop: 0, navClickScrollPct: 0,
            navFirstLabel: '', navLastLabel: '',
            navDiversionAttempted: false, navDiversionSettled: false,
            bootstrapRole: '', bootstrapWasIntersectingFalse: false,
            maxAdvancesWithoutProgress: 0, turnIdDedupSkips: 0, turnIdDedupMaxRun: 0,
            multiCandidatesInReadyContainer: 0, multiCandidatesMax: 0,
            readyContainerProbeMisses: { count: 0, above: 0, below: 0, overlapping: 0, nearOnly: 0, examples: [] },
            readyContainerModel: {
                checked: 0,
                containmentViolations: 0,
                overlappingNonMembers: 0,
                messageGapViolations: 0,
                maxMessageGap: 0,
                topEdgeViolations: 0,
                bottomEdgeViolations: 0,
                maxTopEdgeGap: 0,
                maxBottomEdgeGap: 0,
                maxTopEdgeWinner: null,
                maxBottomEdgeWinner: null,
                domOnlyMembers: 0,
                probeOnlyMembers: 0,
                slabStacksChecked: 0,
                slabItemsChecked: 0,
                unknownSlabItems: 0,
                slabGapViolations: 0,
                maxSlabGap: 0,
                delayedRechecksScheduled: 0,
                delayedRechecksResolved: 0,
                delayedRechecksChanged: 0,
                delayedRecheckExamples: [],
                examples: [],
                exampleMsgIds: [],
            },
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
            slabAdjacency: { checked: 0, maxGap: 0, maxOverlap: 0, violations: 0 },
            viewportMovesWorkZone: 0, viewportMovesForceEdge: 0,
            viewportMoveOperationsWorkZone: 0, viewportMoveOperationsForceEdge: 0,
            // Direct image-slab selector diagnostics. candidatesFound counts
            // discovery events because every successor query re-scans the
            // mounted DOM; byTurnId is the deduplicated view.
            imageOnlyTurns: { candidatesFound: 0, extracted: 0, byTurnId: {} },
            // Diagnostic for the canvas/textdoc-block extraction path
            // specifically — distinguishes "the element was never in the
            // DOM at all when checked" from "found but not geometrically
            // inside readyContainer yet" from "selected but htmlToMarkdown
            // returned empty", three very different failure modes that
            // would otherwise all look identical (no file saved).
            canvasBlocks: { seenGlobally: 0, candidatesFound: 0, extracted: 0, markdownEmpty: 0 },
            slabFiltering: {
                allowlisted: 0,
                unlisted: 0,
                byRule: {},
                examples: [],
            },
            intermediateDeckAdvances: 0,
            // Informational only — see maintainWorkZone: the room outcome
            // of the one move issued is no longer a gate, just observed.
            workZoneRoomShortfall: { count: 0, examples: [] },
            // Per-jump pacing inside maintainWorkZone's incremental jumping
            // loop: how many of the small scrollTop jumps actually had to wait for
            // scrollHeight to stop changing (vs. being already stable on
            // the first check), and how many hit the per-jump cap without
            // ever stabilizing. If `waitedFrames` stays near 0 across a
            // real run, this signal essentially never fires and isn't
            // doing anything — useful to know before trusting it as the fix.
            // sandwichedEmptySeen/sandwichedEmptyTimedOut/sandwichedEmptyExamples
            // are the separate scrollHeight-blind signal (see
            // findSandwichedEmptySlabInViewport) — Seen means the pattern was
            // observed at least once during some jump's wait; TimedOut means
            // it was *still* present when the per-jump cap was hit (either a
            // permanently-broken deck, or our cap being too short — examples
            // record framesWaited to help tell those apart empirically).
            workZoneJumpStability: {
                jumps: 0, steps: 0, waitedFrames: 0, timedOut: 0, maxFramesWaited: 0,
                maxJumpPx: 0, maxCalibratedJumpPx: 0, targetClampedJumps: 0,
                lastTargetClampedJumpPx: null, lastTargetClampedJumpRank: null,
                calibratedJumpCurrentJumps: 0, calibratedJumpCurrentMoves: 0,
                calibratedJumpMoveSequence: 0, calibratedJumpCurrentLastMoveSequence: null,
                targetClampedJumpPxSum: 0,
                jumpPxSum: 0, jumpMsSum: 0, jumpsAtMax: 0, adaptiveIncreases: 0, adaptiveResets: 0,
                // How often the final target clamp was smaller than the old
                // anti-near-hang floor. Informational only: the clamp now
                // honors the target exactly instead of overshooting it.
                subMinTargetClamps: 0,
                sandwichedEmptySeen: 0, sandwichedEmptyTimedOut: 0, sandwichedEmptyExamples: [],
                // See WORK_ZONE_JUMP_HIDDEN_RETRY_MS's comment: a "pure"
                // timeout (no sawSandwiched, no detached) that happened
                // while the tab was hidden gets one retry with a much
                // longer deadline, since live evidence points to tab-
                // backgrounding-induced requestAnimationFrame starvation
                // rather than a real failure. pureTimeoutHiddenRetries
                // counts every such retry across the whole run;
                // pureTimeoutHiddenExhausted counts how many times even
                // the extended wait still failed.
                pureTimeoutHiddenRetries: 0, pureTimeoutHiddenExhausted: 0,
                // Tests the assumption behind treating room as something
                // we can keep using after a wait without re-deriving it
                // from scratch: does an already-rendered slab's room
                // (measureRoom's value — distance from the viewport top to
                // current's top, for WALK_DIRECTION===-1) actually stay the
                // same between right-after-the-synchronous-jump and after
                // waitForLayoutStable resolves, or can the page settling
                // (new content mounting elsewhere, virtualization, etc.)
                // move it too? Measured every jump, not assumed — see
                // maintainWorkZone. Not "headroom" — that term already
                // means something else (distance from current's top to
                // the viewport's *bottom*, i.e. clientH - room), and using
                // it here for room itself caused real confusion. roomDriftSum
                // keeps sign (does it trend one direction); roomDriftAbsSum
                // is for a magnitude-only average; roomDriftLog is the full
                // (rightAfterJump, drift) pair for every jump, not just
                // outliers — needed to check whether drift correlates with
                // room's own size, which a pre-filtered sample of only the
                // large ones can't answer.
                roomDriftSum: 0, roomDriftAbsSum: 0, roomDriftMaxAbs: 0, roomDriftLog: [],
                // See WORK_ZONE_JUMP_SNAPSHOT_CAP — counts jumps that got
                // the full current+precedent+subsequent outerHTML capture,
                // so the cap can actually stop new ones once reached.
                fullSnapshotCount: 0,
            },
            // A candidate that findNextSlabInReadyDeck geometrically confirmed but
            // extractSlab() returned null for (htmlToMarkdown produced
            // no text — e.g. an image-generation turn whose container passed
            // the virtualization-readiness gate before the actual <img> ever
            // landed in the DOM). Before this counter existed, that case was
            // indistinguishable from success in the log: current/lastEl
            // still advanced past the element either way, silently dropping
            // it from the export forever with no error and no diagnostic.
            extractionFailures: { count: 0, examples: [] },
            // Tracks the slab-content fingerprint wait only — existence
            // (does a candidate exist at all) is a single synchronous
            // selector check with no wait, never counted here.
            slabDiscoveryWait: { waited: 0, alreadyReady: 0, resolvedAfterWait: 0, timedOut: 0, maxWaitMs: 0 },
            // Dedicated, independently-lived observers (see
            // watchForToComeFingerprint) attached the instant a turn is
            // found without a message element or image at the moment it's declared
            // ready. Unlike _activeLifecycleObserver (replaced/disconnected
            // the moment the walk moves to the next container, ~1s after
            // ready in the retry-loop case), these keep running independent
            // of the main walk, specifically to find what — if anything —
            // shows up between "ready" and the <img> actually landing.
            toComeFingerprint: { watches: [] },
            // Diagnostic only, not a gating fingerprint: logs the full
            // ordered sequence of distinct values primaryImageForSlab's
            // <img src> takes from the moment an image-type slab candidate
            // is first discovered, so a candidate readiness check (e.g.
            // "src is non-empty") can be tested after the fact against
            // whatever value actually preceded the final one — see
            // watchImageSrcHistory.
            imageSrcHistory: { watches: [] },
            // Same purpose as imageSrcHistory, but for a deck's own
            // data-is-intersecting attribute: lets an "Empty container"
            // placeholder show whether that flag ever flickered back to
            // false between deck entry and the moment the deck was found
            // empty, instead of only showing its value at the one instant
            // the placeholder was written.
            intersectingHistory: { watches: [] },
            scrollHeightGrowthCheck: { before: null, after: null, grewBy: null },
            // checks: how many containers got a coverage check at all (only
            // meaningful once we've actually drained every slab from one).
            // gaps: how many of those had at least one real, unaccounted-for
            // gap — direct evidence of missed content, independent of type.
            containerCoverage: { checks: 0, gaps: 0, examples: [], zeroSlabDecks: 0, zeroSlabDeckExamples: [] },
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
    let _reportedAllowlistedSlabItems = new WeakSet();
    let _reportedUnlistedSlabItems = new WeakSet();
    // Diagnostic only — tracks which image-type slab candidates already
    // have a watchImageSrcHistory() observer attached, so the repeated
    // querySelectedSlabCandidates() calls (one per main-loop iteration)
    // don't attach a second observer to the same element.
    let _watchedImageSrcHistory = new WeakSet();
    // Same de-duplication purpose, for watchIntersectingHistory() — a deck
    // can be re-entered as targetDeck more than once across retries, and
    // each entry shouldn't attach a second observer to the same element.
    let _watchedIntersectingHistory = new WeakSet();
    function totalViewportMoves() {
        return _perf.viewportMoveOperationsWorkZone + _perf.viewportMoveOperationsForceEdge;
    }

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

    function dryMarkdownFor(el) {
        const imageCounterBefore = _imageCounter;
        const pendingLengthBefore = _pendingImageDownloads.length;
        const callsBefore = _perf.htmlToMarkdownCalls;
        const msBefore = _perf.htmlToMarkdownMs;
        try {
            return htmlToMarkdown(el);
        } finally {
            _imageCounter = imageCounterBefore;
            _pendingImageDownloads.length = pendingLengthBefore;
            _perf.htmlToMarkdownCalls = callsBefore;
            _perf.htmlToMarkdownMs = msBefore;
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
            const promptDots = getNavMenuItems();
            const expected = promptDots.length;
            const exported = countPrompts(prompts);
            const tocStatus = expected === 0 ? 'not visible' : expected === exported ? 'OK' : 'MISMATCH';
            const issueLines = [];
            if (_perf.extractionFailures.count > 0) issueLines.push(`extraction-empty=${_perf.extractionFailures.count}`);
            if (_perf.containerCoverage.gaps > 0) issueLines.push(`coverage-gaps=${_perf.containerCoverage.gaps}`);
            if (_perf.containerCoverage.zeroSlabDecks > 0) issueLines.push(`zero-slab-decks=${_perf.containerCoverage.zeroSlabDecks}`);
            if (_perf.slabFiltering.unlisted > 0) issueLines.push(`unlisted-stack-items=${_perf.slabFiltering.unlisted}`);
            if (_perf.readyContainerModel.unknownSlabItems > 0) issueLines.push(`unknown-slab-items=${_perf.readyContainerModel.unknownSlabItems}`);
            if (_perf.workZoneJumpStability.sandwichedEmptySeen > 0) {
                issueLines.push(`SANDWICHED-EMPTY-SLAB=${_perf.workZoneJumpStability.sandwichedEmptySeen}`);
            }
            const sandwichedWarning = _perf.workZoneJumpStability.sandwichedEmptySeen > 0
                ? `    ⚠ SANDWICHED EMPTY SLAB DETECTED: a deck with no selectable slab was visible between ` +
                  `neighboring real-slab decks during work-zone stepping. This means browser/layout stability alone ` +
                  `did not prove ChatGPT-level slab readiness; the jump + stability approach needs a readiness patch.\n`
                : '';

            md += `    ── perf (v4.159) ──\n`
                + `    total ${(_ms/1000).toFixed(1)}s | sleep/wait ${(_sleep/1000).toFixed(1)}s (${Math.round(100*_sleep/_ms)}%)\n`
                + `    htmlToMarkdown: ${_perf.htmlToMarkdownCalls} calls, ${Math.round(_perf.htmlToMarkdownMs)}ms\n`
                + `    Exported ${exported}${expected ? `/${expected}` : ''} user prompts (${prompts.length} slabs/notes). TOC=${tocStatus}.\n`
                + `\n`
                + `    ── diag (v4.159) ──\n`
                + `    Missing-slab signals: ${issueLines.length ? issueLines.join(', ') : 'none'}\n`
                + sandwichedWarning
                + `    Slab discovery wait: checked=${_perf.slabDiscoveryWait.waited}, already=${_perf.slabDiscoveryWait.alreadyReady}, `
                  + `after-wait=${_perf.slabDiscoveryWait.resolvedAfterWait}, timed-out=${_perf.slabDiscoveryWait.timedOut}, `
                  + `maxWait=${Math.round(_perf.slabDiscoveryWait.maxWaitMs)}ms\n`
                + `    Non-message slabs: images extracted=${_perf.imageOnlyTurns.extracted}, ` +
                  `canvas extracted=${_perf.canvasBlocks.extracted}, canvas markdown-empty=${_perf.canvasBlocks.markdownEmpty}\n`
                + `    Geometry/model: deck-gap-violations=${_perf.containerGapViolations}, `
                  + `container-coverage-gaps=${_perf.containerCoverage.gaps}, slab-adjacency-violations=${_perf.slabAdjacency.violations}, `
                  + `model message-gaps=${_perf.readyContainerModel.messageGapViolations}, unknown slab items=${_perf.readyContainerModel.unknownSlabItems}\n`
                + `    Work-zone room shortfall (fatal on the unclamped path, see stop reason if >0): ${_perf.workZoneRoomShortfall.count}` +
                  (_perf.workZoneRoomShortfall.examples.length
                      ? `\n      ${_perf.workZoneRoomShortfall.examples.join('\n      ')}`
                      : '') + `\n`
                + `    Work-zone jump pacing: jumps=${_perf.workZoneJumpStability.jumps}, stability-checks=${_perf.workZoneJumpStability.steps}, waited=${_perf.workZoneJumpStability.waitedFrames}, `
                  + `capped-out=${_perf.workZoneJumpStability.timedOut}, maxFramesWaited=${_perf.workZoneJumpStability.maxFramesWaited}, `
                  + `avgJump=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.jumpPxSum / _perf.workZoneJumpStability.jumps) : 0}px, `
                  + `avgJumpTime=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.jumpMsSum / _perf.workZoneJumpStability.jumps) : 0}ms, `
                  + `avgTimePer120px=${_perf.workZoneJumpStability.jumpPxSum ? Math.round(_perf.workZoneJumpStability.jumpMsSum / (_perf.workZoneJumpStability.jumpPxSum / 120)) : 0}ms, `
                  + `maxJump=${_perf.workZoneJumpStability.maxJumpPx}px, maxCalibratedJump=${_perf.workZoneJumpStability.maxCalibratedJumpPx}px, `
                  + `jumpsAtMax=${_perf.workZoneJumpStability.jumpsAtMax}, targetClamped=${_perf.workZoneJumpStability.targetClampedJumps}, `
                  + `subMinTargetClamps=${_perf.workZoneJumpStability.subMinTargetClamps}, `
                  + `adaptiveIncreases=${_perf.workZoneJumpStability.adaptiveIncreases}, adaptiveResets=${_perf.workZoneJumpStability.adaptiveResets}, `
                  + `scrollAssignments=${_perf.viewportMovesWorkZone + _perf.viewportMovesForceEdge}\n`
                + `    Pure-timeout hidden-tab retries (see WORK_ZONE_JUMP_HIDDEN_RETRY_MS — timed out, not sandwiched, ` +
                  `not detached, tab was hidden during the wait): retries=${_perf.workZoneJumpStability.pureTimeoutHiddenRetries}, ` +
                  `exhausted-and-still-failed=${_perf.workZoneJumpStability.pureTimeoutHiddenExhausted}\n`
                + `    Room drift during wait (does an already-rendered slab's distance from the viewport edge hold ` +
                  `steady between right-after-the-jump and after waitForLayoutStable resolves? See maintainWorkZone): ` +
                  `avgAbs=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.roomDriftAbsSum / _perf.workZoneJumpStability.jumps) : 0}px, ` +
                  `netSum=${Math.round(_perf.workZoneJumpStability.roomDriftSum)}px, maxAbs=${Math.round(_perf.workZoneJumpStability.roomDriftMaxAbs)}px` +
                  (_perf.workZoneJumpStability.roomDriftLog.length
                      ? `\n      ${_perf.workZoneJumpStability.roomDriftLog.join('\n      ')}`
                      : '') + `\n`
                + `    Sandwiched-empty-slab readiness failure signal (see findSandwichedEmptySlabInViewport): ` +
                  `seen=${_perf.workZoneJumpStability.sandwichedEmptySeen}, capped-out-while-present=${_perf.workZoneJumpStability.sandwichedEmptyTimedOut}` +
                  (_perf.workZoneJumpStability.sandwichedEmptyExamples.length
                      ? `\n      ${_perf.workZoneJumpStability.sandwichedEmptyExamples.join('\n      ')}`
                      : '') + `\n`
                + `    Timer slip: samples=${_perf.sleepSlip.count}, avg=${_perf.sleepSlip.count ? Math.round(_perf.sleepSlip.sum / _perf.sleepSlip.count) : 0}ms, `
                  + `max=${Math.round(_perf.sleepSlip.max)}ms; tab hidden ${_perf.tabHidden.hideCount} time(s)\n`
                + `    Note: detailed missing slabs are inserted inline in the transcript near where they were detected.\n`;

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

    // Outer deck rectangles are the partition of the walkway. Their facing
    // edges should coincide; this small allowance exists only for fractional
    // layout coordinates and rounding, not for visible spacing.
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

    function requireDeckAdjacency(olderDeck, newerDeck) {
        const gap = adjacencyGap(
            WALK_DIRECTION,
            olderDeck.getBoundingClientRect(),
            newerDeck.getBoundingClientRect()
        );
        _perf.maxContainerGap = Math.max(_perf.maxContainerGap, Math.abs(gap));
        if (Math.abs(gap) <= DECK_ADJACENCY_TOLERANCE) return gap;
        _perf.containerGapViolations++;
        throw new Error(
            `Deck adjacency invariant failed: facing edges differ by ${Math.round(gap)}px ` +
            `(allowed ±${DECK_ADJACENCY_TOLERANCE}px). ` +
            `Current deck=${deckSequenceId(olderDeck) || '(none)'}, ` +
            `next deck=${deckSequenceId(newerDeck) || '(none)'}.`
        );
    }

    function checkSlabAdjacency(currentSlab, nextSlab) {
        const gap = adjacencyGap(
            WALK_DIRECTION,
            currentSlab.geometryElement.getBoundingClientRect(),
            nextSlab.geometryElement.getBoundingClientRect()
        );
        _perf.slabAdjacency.checked++;
        if (gap >= 0) {
            _perf.slabAdjacency.maxGap = Math.max(_perf.slabAdjacency.maxGap, gap);
        } else {
            _perf.slabAdjacency.maxOverlap = Math.max(_perf.slabAdjacency.maxOverlap, -gap);
        }
        if (gap <= SLAB_ADJACENCY_MAX_GAP && gap >= -SLAB_ADJACENCY_OVERLAP_TOLERANCE) return gap;
        _perf.slabAdjacency.violations++;
        console.warn(
            `[Extractor] Slab adjacency diagnostic between ${currentSlab.type} and ${nextSlab.type}: ` +
            `${gap >= 0 ? `${Math.round(gap)}px gap` : `${Math.round(-gap)}px overlap`} ` +
            `(allowed gap ≤${SLAB_ADJACENCY_MAX_GAP}px, overlap ≤${SLAB_ADJACENCY_OVERLAP_TOLERANCE}px). ` +
            `Current turn=${slabTurnId(currentSlab) || '(none)'} msg=${slabMessageId(currentSlab) || '(none)'}; ` +
            `next turn=${slabTurnId(nextSlab) || '(none)'} msg=${slabMessageId(nextSlab) || '(none)'}.`
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

    // Returns null when the deck's coverage is unremarkable, or a diagnostic
    // note to insert into the walkway when extracted slabs leave a real
    // coverage gap or when the deck yielded zero slabs. We deliberately do
    // not throw on a zero-slab deck: "no
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
    // Renders the gap between when a deck's readiness gate resolved and
    // the moment it was found empty — see deckEntryDiag in run() for why
    // this matters: a nonzero move count here means the work zone scrolled
    // again after the deck was confirmed ready but before it was searched,
    // which could itself be what re-unmounted the deck's content.
    function describeMovesSinceEntry(entryDiag) {
        if (!entryDiag) return 'deck-entry-diag=(unavailable)';
        const movesSince = totalViewportMoves() - entryDiag.movesAtEntry;
        const displacement = entryDiag.scrollPosNow != null && entryDiag.scrollPosAtEntry != null
            ? Math.round(entryDiag.scrollPosNow - entryDiag.scrollPosAtEntry)
            : '(unavailable)';
        return `viewport-moves-since-deck-entry=${movesSince}, scroll-displacement-since-deck-entry=${displacement}px, ` +
            `was-intersecting-at-entry="${entryDiag.isIntersectingAtEntry}"`;
    }

    // Looks up the matching watchIntersectingHistory() entry by turnId — by
    // the time a deck is found empty, the watch was attached one or more
    // loop iterations earlier, so this is found by id, not by reference.
    // Direct evidence for whether data-is-intersecting ever held a stable
    // true, or only ever touched it briefly before reverting.
    function describeIntersectingHistory(deckEl) {
        const turnId = deckSequenceId(deckEl) || '(none)';
        const watch = _perf.intersectingHistory.watches.find(w => w.turnId === turnId);
        if (!watch) return 'data-is-intersecting-history=(not watched)';
        const sequence = watch.values.map(v => `${v.value}@${v.atMs}ms`).join(' -> ');
        return `data-is-intersecting-history=[${sequence}]` +
            (watch.detachedAtMs !== null ? ` (detached at ${watch.detachedAtMs}ms)` : '') +
            (watch.timedOut ? ' (watch timed out)' : '');
    }

    function finishDeckCoverage(deckEl, ranges, current, entryDiag = null) {
        const deckRect = deckEl.getBoundingClientRect();
        _perf.containerCoverage.checks++;
        const gaps = findContainerCoverageGaps(ranges, deckRect.height);
        if (gaps.length > 0) {
            _perf.containerCoverage.gaps++;
            const gapText = gaps.map(g => `[${Math.round(g.from)}px–${Math.round(g.to)}px]`).join(', ');
            if (_perf.containerCoverage.examples.length < 10) {
                _perf.containerCoverage.examples.push(
                    `turnId=${deckSequenceId(deckEl) || '(none)'}: ${gaps.length} gap(s) — ` +
                    gapText +
                    ` not covered by any of the ${ranges.length} extracted slab(s)`
                );
            }
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
        _perf.containerCoverage.zeroSlabDecks++;
        if (_perf.containerCoverage.zeroSlabDeckExamples.length < 10) {
            _perf.containerCoverage.zeroSlabDeckExamples.push(
                `turnId=${deckSequenceId(deckEl) || '(none)'}, ` +
                `rect=[top=${Math.round(deckRect.top)},bottom=${Math.round(deckRect.bottom)},height=${Math.round(deckRect.height)}], ` +
                `current=${currentRect ? `${current.type}/${slabRole(current)} rect=[top=${Math.round(currentRect.top)},bottom=${Math.round(currentRect.bottom)}]` : '(unknown)'}, ` +
                `overlapping candidates: ${overlapping.length === 0 ? '(none)' : overlapping.join('; ')}, ` +
                `live structure:\n${dumpElementStructure(deckEl)}`
            );
        }
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
                `extractor bug; see the exported diagnostics. ${describeMovesSinceEntry(entryDiag)}, ` +
                `${describeIntersectingHistory(deckEl)}]*\n\n` +
                `${captureElementHtmlReference('empty-container-coverage', deckEl, deckEl.getAttribute('data-turn') || 'unknown', deckSequenceId(deckEl))}\n\n`,
            plainText: '[Empty container]',
            msgId: null,
            turnId: deckSequenceId(deckEl) || null,
        };
    }

    // Empirically measured floors (Compatibility Check panel, "Shortest
    // user/assistant message height"): 44px / 32px on a live conversation.
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
        _perf.turnIdDedupSkips += allCandidates.length - deckCandidates.length;
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

    function stopActiveLifecycleObserver() {
        if (_activeLifecycleObserver) {
            _activeLifecycleObserver.disconnect();
            _activeLifecycleObserver = null;
        }
        _activeLifecycleReadyDeclared = false;
        _activeLifecycleHadPreMutation = false;
        _activeLifecycleTurnEl = null;
        _activeLifecycleDiscoverySnapshot = null;
    }

    function watchContainerLifecycle(turnEl) {
        stopActiveLifecycleObserver();
        _activeLifecycleReadyDeclared = false;
        _activeLifecycleHadPreMutation = false;
        _activeLifecycleTurnEl = turnEl;
        _activeLifecycleDiscoverySnapshot = summarizeContainerCandidate(turnEl);
        _perf.discoverySnapshot.totalContainers++;
        if (_activeLifecycleDiscoverySnapshot.messageElementCount > 0) _perf.discoverySnapshot.alreadyHadMessageAtDiscovery++;
        // "While not intersecting" is tracked as its own explicit count,
        // not inferred from "this is the discovery moment so it's probably
        // still false" — that assumption isn't always true (e.g. a
        // re-derived candidate from the findNextDeck retry loop could already
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
        // compare against whatever extractSlab() ultimately captures for
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
                // Same message-element-vs-container scoping as summarizeMessageStructure:
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
        // Diagnostic only: image-generation turns carry no ordinary message
        // element, so snapshot the containing turn section separately. Runtime
        // selection no longer uses this broad scope; it directly selects
        // `.group/imagegen-image` slabs.
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
    // Attached the instant a turn is found without an ordinary message element (no
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

    // Diagnostic only — not a gating fingerprint, and does not change
    // extraction behavior. Logs the full ordered sequence of distinct
    // values primaryImageForSlab(slabEl)'s <img src> takes, from the
    // moment this candidate is first discovered. The point is to find out,
    // after the fact, whether a candidate readiness check (e.g. "src is
    // non-empty") would have been fooled by a value that existed before
    // the real final one — by testing that check against the actual
    // previous value in this log, not by guessing what the previous value
    // might look like.
    //
    // Observes slabEl itself, not just the <img> descendant, with
    // subtree+childList in addition to attributes: the failure mode this
    // guards against is the same scoping bug already found once for
    // watchForToComeFingerprint — if the real image lands via a *replaced*
    // node (old element removed, new one added) rather than a mutated
    // attribute on the same node, an observer bound only to one node's
    // attributes would see nothing. Re-resolving primaryImageForSlab(slabEl)
    // fresh on every mutation, instead of trusting one node reference,
    // means a node replacement is captured the same way an attribute change
    // would be.
    function watchImageSrcHistory(slabEl) {
        if (_watchedImageSrcHistory.has(slabEl)) return;
        _watchedImageSrcHistory.add(slabEl);
        const t0 = performance.now();
        const entry = {
            turnId: slabEl.closest('[data-turn]')?.getAttribute('data-turn-id') || '(none)',
            values: [],
            timedOut: false,
            detachedAtMs: null,
        };
        _perf.imageSrcHistory.watches.push(entry);
        const recordCurrent = () => {
            const image = primaryImageForSlab(slabEl);
            const src = image?.getAttribute('src') || '';
            const last = entry.values[entry.values.length - 1];
            if (last && last.value === src) return; // not a real change — skip
            entry.values.push({ value: src, atMs: Math.round(performance.now() - t0) });
        };
        recordCurrent(); // capture whatever's there (or absent) at watch start too, not just later changes
        let deadline, detachCheck;
        const finish = () => { obs.disconnect(); clearTimeout(deadline); clearInterval(detachCheck); };
        const obs = new MutationObserver(() => recordCurrent());
        obs.observe(slabEl, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
        detachCheck = setInterval(() => {
            if (!slabEl.isConnected && entry.detachedAtMs === null) {
                entry.detachedAtMs = Math.round(performance.now() - t0);
                finish();
            }
        }, 500);
        deadline = setTimeout(() => { entry.timedOut = true; finish(); }, TO_COME_TIMEOUT_MS);
    }

    // Records the actual value history of a deck's data-is-intersecting
    // attribute, from the moment we start waiting on it through to whatever
    // happens later — direct evidence for whether a deck that later shows
    // up as an "Empty container" ever held a stable true, or only ever
    // touched it briefly before reverting. Looked up by turnId from the
    // placeholder-building code, not passed by reference, since the deck
    // may be searched and found empty several loop iterations after this
    // watch was attached.
    function watchIntersectingHistory(readinessEl) {
        if (_watchedIntersectingHistory.has(readinessEl)) return;
        _watchedIntersectingHistory.add(readinessEl);
        const t0 = performance.now();
        const entry = {
            turnId: deckSequenceId(readinessEl) || '(none)',
            values: [],
            timedOut: false,
            detachedAtMs: null,
        };
        _perf.intersectingHistory.watches.push(entry);
        const recordCurrent = () => {
            const value = readinessEl.getAttribute('data-is-intersecting');
            const last = entry.values[entry.values.length - 1];
            if (last && last.value === value) return; // not a real change — skip
            entry.values.push({ value, atMs: Math.round(performance.now() - t0) });
        };
        recordCurrent(); // capture the value at watch start too, not just later changes
        let deadline, detachCheck;
        const finish = () => { obs.disconnect(); clearTimeout(deadline); clearInterval(detachCheck); };
        const obs = new MutationObserver(() => recordCurrent());
        obs.observe(readinessEl, { attributes: true, attributeFilter: ['data-is-intersecting'] });
        detachCheck = setInterval(() => {
            if (!readinessEl.isConnected && entry.detachedAtMs === null) {
                entry.detachedAtMs = Math.round(performance.now() - t0);
                finish();
            }
        }, 500);
        deadline = setTimeout(() => { entry.timedOut = true; finish(); }, TO_COME_TIMEOUT_MS);
        return entry;
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
            // Same multi-turn-per-container fix as the non-message candidate
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
    // viewport, not just at its boundary. The default reproduces the
    // original design's behavior exactly ("a minimum number of maximal
    // jumps"): advance close to a full work zone's worth, leaving just
    // WORK_ZONE_MARGIN_FRACTION of current still inside view. maintainWorkZone
    // takes this as an overridable parameter (not just a constant) so
    // different advance strategies — this maximal one, a minimal
    // "just enough room past the trigger margin" one, or anything between —
    // can be experimented with from call sites without touching this function.
    const WORK_ZONE_ADVANCE_FRACTION = 1 - WORK_ZONE_MARGIN_FRACTION;

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
    const WORK_ZONE_MOVE_JUMP_MAX_PX =600;
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
    function startBackgroundPositionSampler(getCurrent, container) {
        if (_samplerRunning) return;
        _samplerRunning = true;
        let lastTop = null, lastBottom = null, lastTurnId = null;
        let lastScrollPos = null, lastScrollHeight = null;
        const readScrollPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
        const readScrollHeight = () => container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
        // type included, not just turnId/deckSequenceId — deck-entry and
        // deck-exit (makeDeckEntryCurrent/makeDeckExitCurrent) share the
        // same deckSequenceId for one deck but are genuinely different
        // positions (the deck's leading vs trailing edge) with different
        // synthetic geometry. Without this, current legitimately flipping
        // entry->exit (or exit->the deck's first real slab) reads as a
        // huge, spurious "movement" of one stable identity, when it's
        // really just current correctly becoming something else.
        const identify = cur => {
            if (!cur) return '(none)';
            if (cur.element) return `${cur.type}:${slabTurnId(cur) || '(no turn-id)'}`;
            if (cur.deckElement) return `${cur.type}:${deckSequenceId(cur.deckElement) || '(no turn-id, deck)'}`;
            return '(synthetic)';
        };
        const tick = () => {
            if (!_samplerRunning) return;
            const cur = getCurrent();
            const turnId = identify(cur);
            if (cur?.geometryElement) {
                const r = cur.geometryElement.getBoundingClientRect();
                if (lastTurnId === turnId && lastTop !== null && (r.top !== lastTop || r.bottom !== lastBottom)) {
                    if (_perf.workZoneJumpStability.roomDriftLog.length < 2000) {
                        _perf.workZoneJumpStability.roomDriftLog.push(
                            `BACKGROUND SAMPLE: current (turnId=${turnId}) moved between two animation frames with ` +
                            `no tracked jump in between — top ${Math.round(lastTop)}->${Math.round(r.top)}px, ` +
                            `bottom ${Math.round(lastBottom)}->${Math.round(r.bottom)}px, ` +
                            `markerColor=${_stabilizationMarkerEl?.style.background || '(no marker)'}`
                        );
                    }
                }
                lastTop = r.top; lastBottom = r.bottom; lastTurnId = turnId;
            } else {
                lastTop = lastBottom = null; lastTurnId = turnId;
            }
            // The rawest possible signals, watched independently of
            // current entirely: the actual scrollTop/scrollY (compared
            // against _lastIntentionalScrollPos — what *we* last set it
            // to, via setPos — so a mismatch means something other than
            // our own scripted jump moved it) and scrollHeight (any
            // change at all, since we never set this ourselves — it's
            // purely a side effect of content mounting/unmounting). This
            // is what current's own rect alone can't catch: movement of
            // the viewport or page that doesn't happen to touch current
            // directly, like the neighboring-deck case found earlier.
            const scrollPos = readScrollPos();
            const scrollHeight = readScrollHeight();
            if (lastScrollPos !== null && scrollPos !== lastScrollPos && scrollPos !== _lastIntentionalScrollPos) {
                if (_perf.workZoneJumpStability.roomDriftLog.length < 2000) {
                    _perf.workZoneJumpStability.roomDriftLog.push(
                        `BACKGROUND SAMPLE: scroll position changed to something we did not set ourselves — ` +
                        `${Math.round(lastScrollPos)}->${Math.round(scrollPos)}px (last intentional set: ${Math.round(_lastIntentionalScrollPos ?? NaN)}px), ` +
                        `markerColor=${_stabilizationMarkerEl?.style.background || '(no marker)'}`
                    );
                }
            }
            if (lastScrollHeight !== null && scrollHeight !== lastScrollHeight) {
                if (_perf.workZoneJumpStability.roomDriftLog.length < 2000) {
                    _perf.workZoneJumpStability.roomDriftLog.push(
                        `BACKGROUND SAMPLE: scrollHeight changed — ${Math.round(lastScrollHeight)}->${Math.round(scrollHeight)}px, ` +
                        `markerColor=${_stabilizationMarkerEl?.style.background || '(no marker)'}`
                    );
                }
            }
            lastScrollPos = scrollPos;
            lastScrollHeight = scrollHeight;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }
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
                    _perf.workZoneJumpStability.steps++;
                    if (changed) _perf.workZoneJumpStability.waitedFrames++;
                    if (timedOut) _perf.workZoneJumpStability.timedOut++;
                    _perf.workZoneJumpStability.maxFramesWaited =
                        Math.max(_perf.workZoneJumpStability.maxFramesWaited, framesChecked);
                    if (sawSandwiched) {
                        _perf.workZoneJumpStability.sandwichedEmptySeen++;
                        if (timedOut && lastSandwiched) {
                            _perf.workZoneJumpStability.sandwichedEmptyTimedOut++;
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
                            if (_perf.workZoneJumpStability.sandwichedEmptyExamples.length < 5) {
                                _perf.workZoneJumpStability.sandwichedEmptyExamples.push(
                                    `role=${role} turnId=${tId || '(none)'}, framesWaited=${framesChecked}`
                                );
                            }
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
        _perf.workZoneJumpStability.pureTimeoutHiddenRetries++;
        console.warn(
            `[Extractor] work-zone stability wait timed out while the tab was hidden, with current still connected ` +
            `and no sandwiched-empty deck present — retrying once with the deadline extended to ` +
            `${WORK_ZONE_JUMP_HIDDEN_RETRY_MS / 1000}s, since requestAnimationFrame throttling while backgrounded ` +
            `can fully explain a short wait never seeing a settled frame.`
        );
        const retried = await attemptLayoutStable(container, current, WORK_ZONE_JUMP_HIDDEN_RETRY_MS);
        if (retried.timedOut && !retried.sawSandwiched && !retried.detached) {
            _perf.workZoneJumpStability.pureTimeoutHiddenExhausted++;
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
        _perf.viewportMoveOperationsForceEdge++;
        const readPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
        const setPos = v => {
            if (container === document.documentElement) window.scrollTo({ top: v, behavior: 'instant' });
            else container.scrollTop = v;
            _lastIntentionalScrollPos = v;
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
            _perf.viewportMovesWorkZone++;
            _perf.workZoneJumpStability.jumps++;
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
        let moveSequence = null;
        let outcome = 'advance-complete'; // overwritten below if the loop exits any other way
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
                _perf.workZoneRoomShortfall.count++;
                if (_perf.workZoneRoomShortfall.examples.length < 10) {
                    _perf.workZoneRoomShortfall.examples.push(
                        `steps=${jumpsTaken}, room=${Math.round(room)}px, required=${Math.round(extra)}px, ` +
                        `boundaryReached=${boundaryReached}, waited=${waitedMs}ms`
                    );
                }
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
            const curTop = readPos();
            const max = liveScrollMax(); // re-read live every step — the document's own scrollable range can shift mid-run, same as everything else
            // The calibrated jump size is the requested intervention size:
            // once calibration has reached 900px, a jump should really be
            // 900px whenever applying it would still leave current before
            // the work-zone target (room < advanceRoom, normally 0.9 *
            // viewport height). Only the final approach to advanceRoom is
            // clamped. This keeps the calibration semantics honest: a high
            // max tests high jumps, while geometry only prevents crossing
            // the explicit "current must remain inside the work zone"
            // boundary.
            //
            // _workZoneAdaptiveJumpPx grows purely from "was the last jump
            // clean" — it has no idea where current actually is right now.
            // If the calibrated jump would cross advanceRoom (capped at
            // clientH-1 specifically so current stays genuinely inside the
            // viewport), clamp only that final jump. Without this boundary,
            // a grown jump can take current from "inside the viewport" to
            // "fully behind it" in one leap, and ChatGPT's virtualizer may
            // detach the current node. getBoundingClientRect() then returns
            // an all-zero rect forever after, which reads as permanent
            // room=0 that no further jump can correct (observed live: a 30s
            // timeout with room stuck at exactly 0 across 101 jumps).
            //
            const remainingToAdvanceRoom = advanceRoom - room;
            const calibratedJumpPx = _workZoneAdaptiveJumpPx;
            const safeJumpPx = room + calibratedJumpPx < advanceRoom
                ? calibratedJumpPx
                : remainingToAdvanceRoom;
            _perf.workZoneJumpStability.maxCalibratedJumpPx =
                Math.max(_perf.workZoneJumpStability.maxCalibratedJumpPx, calibratedJumpPx);
            const targetClamped = safeJumpPx < calibratedJumpPx;
            const nextPos = Math.max(0, Math.min(max, curTop + jumpSign * safeJumpPx));
            if (nextPos === curTop) {
                // Genuinely can't move any further in the direction that
                // would help — a real document-boundary case, not a
                // failure to retry against. Not fatal even if room is
                // still <= extra: the caller decides whether to wait for
                // more mounted content or accept the boundary.
                boundaryReached = true;
                outcome = 'boundary';
                break;
            }
            if (moveSequence === null) {
                _perf.workZoneJumpStability.calibratedJumpMoveSequence++;
                moveSequence = _perf.workZoneJumpStability.calibratedJumpMoveSequence;
            }
            _perf.workZoneJumpStability.calibratedJumpCurrentJumps++;
            if (_perf.workZoneJumpStability.calibratedJumpCurrentLastMoveSequence !== moveSequence) {
                _perf.workZoneJumpStability.calibratedJumpCurrentLastMoveSequence = moveSequence;
                _perf.workZoneJumpStability.calibratedJumpCurrentMoves++;
            }
            setPos(nextPos);
            if (targetClamped) {
                _perf.workZoneJumpStability.targetClampedJumps++;
                _perf.workZoneJumpStability.lastTargetClampedJumpPx = Math.round(safeJumpPx);
                _perf.workZoneJumpStability.lastTargetClampedJumpRank = _perf.workZoneJumpStability.jumps;
                _perf.workZoneJumpStability.targetClampedJumpPxSum += safeJumpPx;
                if (safeJumpPx < WORK_ZONE_TINY_TARGET_CLAMP_PX) _perf.workZoneJumpStability.subMinTargetClamps++;
            }
            const appliedJumpPx = Math.round(Math.abs(nextPos - curTop));
            _perf.workZoneJumpStability.maxJumpPx = Math.max(_perf.workZoneJumpStability.maxJumpPx, appliedJumpPx);
            _perf.workZoneJumpStability.jumpPxSum += appliedJumpPx;
            if (appliedJumpPx >= WORK_ZONE_MOVE_JUMP_MAX_PX) _perf.workZoneJumpStability.jumpsAtMax++;
            jumpsTaken++;
            // Tests a narrower, specific assumption — not "nothing about a
            // move is predictable," but: immediately after setPos
            // (synchronous, exact — current's own room right then is pure
            // geometry, nothing async involved yet), is that same already-
            // rendered slab's room still the same number once we're done
            // *waiting* for the page to settle (new content mounting
            // elsewhere, virtualization, etc.)? That's an assumption, not
            // a guaranteed principle — measured directly
            // here, every jump, so the aggregate stats either confirm or
            // refute it with real numbers instead of a guess.
            const roomRightAfterJump = measureRoom();
            setStabilizationMarkerColor('#5ac8fa'); // light blue — exactly the real, unmodified waitForLayoutStable window, see its own comment
            // Tests a specific theory: action buttons (copy/regenerate/etc.)
            // under a message often mount later than the message text
            // itself, and if that doesn't change scrollHeight (e.g. the
            // turn already reserved the space), waitForLayoutStable's
            // scrollHeight check would never even notice it happening —
            // the same kind of blind spot already documented for
            // pre-reserved canvas/textdoc height. Counting actual <button>
            // elements (a stable tag, not a guess at ChatGPT's obfuscated
            // class names) near current, before and after the wait, tests
            // this directly instead of assuming it.
            const turnContainerForButtons = current?.element?.closest('[data-turn-id-container]') || current?.deckElement || null;
            const buttonsRightAfterJump = turnContainerForButtons ? turnContainerForButtons.querySelectorAll('button').length : null;
            // Real outerHTML (not trimmedCaptureHtml's identity-tag-only
            // version) of current's own turn container AND its immediate
            // neighbors (deck containers are siblings in the DOM, so
            // previous/nextElementSibling is enough — no full-document
            // scan needed), at both measurement instants. Tests a theory
            // that doesn't assume the cause lives in current's own content
            // at all: the reason a slab's room moves during the wait might
            // be something happening to the deck right above or below it
            // (still mid-mount, still being virtualized), not anything
            // about current itself — and might correlate with *position*
            // in the viewport rather than which specific message it is.
            // Captured for every jump (not just ones that already showed
            // drift), up to WORK_ZONE_JUMP_SNAPSHOT_CAP, precisely so the
            // non-drifting majority is in the same dataset as the
            // drifting minority — a position correlation can't be checked
            // against a sample that already excludes everything that
            // didn't drift.
            const precedentDeck = turnContainerForButtons?.previousElementSibling?.hasAttribute('data-turn-id-container')
                ? turnContainerForButtons.previousElementSibling : null;
            const subsequentDeck = turnContainerForButtons?.nextElementSibling?.hasAttribute('data-turn-id-container')
                ? turnContainerForButtons.nextElementSibling : null;
            // DOM-sibling order isn't the same as viewport position — the
            // precedent/subsequent above answer "what's adjacent in the
            // document," not "what's actually below current on screen."
            // findDeckBelow answers the latter directly, by geometry: scan
            // every deck currently in the DOM (not just siblings) and find
            // the one whose own top edge sits at or below current's
            // bottom edge, closest first. Tracked by turnId (not just
            // captured) so its identity — and whether it's the *same* deck
            // every run — can be checked across runs, the same way
            // current's own turnId already is in roomDriftLog.
            // Single scan per instant (queryDeckSequenceContainers does a
            // real document.querySelectorAll + a rect check on every
            // result) reused for above, below, AND a simple total count —
            // not just "what's the nearest neighbor" but "how many decks
            // are mounted in the whole document right now," to know
            // whether this local block is most of what's in the DOM or a
            // small fragment of something much larger.
            const findDeckBelow = decks => {
                if (!current?.geometryElement) return null;
                const r = current.geometryElement.getBoundingClientRect();
                let best = null, bestGap = Infinity;
                for (const deckEl of decks) {
                    const rect = deckEl.getBoundingClientRect();
                    const gap = rect.top - r.bottom;
                    if (gap >= 0 && gap < bestGap) { bestGap = gap; best = deckEl; }
                }
                return best;
            };
            // Mirror of findDeckBelow, but for what's actually relevant to
            // "is the viewport itself covered": current's own rect spans
            // from room down past clientH (it's taller than the
            // viewport), so it already fully covers room..clientH on its
            // own — anything below current is off-screen and can't be
            // what's visible. The part of the viewport that's genuinely in
            // question is *above* current: 0..room. findDeckAbove finds
            // whatever deck's bottom edge is closest to (at or above)
            // current's top, so that region's actual coverage (or lack of
            // it) can be checked directly instead of assumed from the
            // DOM-sibling precedent check (which mostly came back none,
            // but that's adjacency in the document, not coverage on screen).
            const findDeckAbove = decks => {
                if (!current?.geometryElement) return null;
                const r = current.geometryElement.getBoundingClientRect();
                let best = null, bestGap = Infinity;
                for (const deckEl of decks) {
                    const rect = deckEl.getBoundingClientRect();
                    const gap = r.top - rect.bottom;
                    if (gap >= 0 && gap < bestGap) { bestGap = gap; best = deckEl; }
                }
                return best;
            };
            // The "covered area" question, directly: not just where
            // current's leading edge (room) sits, but its actual rendered
            // extent (top *and* bottom — its real height), the below
            // deck's extent, and whether either leaves a genuine gap (no
            // rendered content at all) against the other or against the
            // viewport's own bottom edge. Relative to the container's own
            // top (liveContainerTop), the same frame room already uses, so
            // these numbers line up directly against room/clientH.
            const rectRelativeToContainer = el => {
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                const ct = liveContainerTop();
                return { top: rect.top - ct, bottom: rect.bottom - ct, height: rect.height };
            };
            const decksInDomRightAfterJump = queryDeckSequenceContainers();
            const deckBelowRightAfterJump = findDeckBelow(decksInDomRightAfterJump);
            const deckAboveRightAfterJump = findDeckAbove(decksInDomRightAfterJump);
            const currentGeomRightAfterJump = rectRelativeToContainer(current?.geometryElement);
            const belowGeomRightAfterJump = rectRelativeToContainer(deckBelowRightAfterJump);
            const aboveGeomRightAfterJump = rectRelativeToContainer(deckAboveRightAfterJump);
            const outerHtmlRightAfterJump = turnContainerForButtons?.outerHTML || null;
            const precedentHtmlRightAfterJump = precedentDeck?.outerHTML || null;
            const subsequentHtmlRightAfterJump = subsequentDeck?.outerHTML || null;
            const belowHtmlRightAfterJump = deckBelowRightAfterJump?.outerHTML || null;
            const belowTurnIdRightAfterJump = deckBelowRightAfterJump ? (deckSequenceId(deckBelowRightAfterJump) || '(no turn-id)') : '(none)';
            const aboveTurnIdRightAfterJump = deckAboveRightAfterJump ? (deckSequenceId(deckAboveRightAfterJump) || '(no turn-id)') : '(none)';
            const jumpStartedAt = performance.now();
            const stability = await waitForLayoutStable(container, current);
            _perf.workZoneJumpStability.jumpMsSum += performance.now() - jumpStartedAt;
            const buttonsAfterWait = turnContainerForButtons ? turnContainerForButtons.querySelectorAll('button').length : null;
            const outerHtmlAfterWait = turnContainerForButtons?.outerHTML || null;
            const precedentHtmlAfterWait = precedentDeck?.outerHTML || null;
            const subsequentHtmlAfterWait = subsequentDeck?.outerHTML || null;
            const decksInDomAfterWait = queryDeckSequenceContainers();
            const deckBelowAfterWait = findDeckBelow(decksInDomAfterWait);
            const deckAboveAfterWait = findDeckAbove(decksInDomAfterWait);
            const currentGeomAfterWait = rectRelativeToContainer(current?.geometryElement);
            const belowGeomAfterWait = rectRelativeToContainer(deckBelowAfterWait);
            const aboveGeomAfterWait = rectRelativeToContainer(deckAboveAfterWait);
            const belowHtmlAfterWait = deckBelowAfterWait?.outerHTML || null;
            const belowTurnIdAfterWait = deckBelowAfterWait ? (deckSequenceId(deckBelowAfterWait) || '(no turn-id)') : '(none)';
            const aboveTurnIdAfterWait = deckAboveAfterWait ? (deckSequenceId(deckAboveAfterWait) || '(no turn-id)') : '(none)';
            const belowChanged = belowTurnIdRightAfterJump !== belowTurnIdAfterWait || belowHtmlRightAfterJump !== belowHtmlAfterWait;
            await nextAnimationFrame();
            room = measureRoom();
            setStabilizationMarkerColor('#34c759'); // green — stabilization declared, one rendering cycle yielded before measuring room
            // Gap to whatever's below (real content if a deck was found,
            // otherwise the viewport's own bottom edge) — positive means
            // genuinely uncovered space (no rendered content there at
            // all), not just "not current," at each instant. current's own
            // rect already spans from room past clientH (taller than the
            // viewport), so room..clientH is always covered by current
            // itself — this is mostly diagnostic context, not where a real
            // gap could show up on screen.
            const gapBelowRightAfterJump = belowGeomRightAfterJump
                ? belowGeomRightAfterJump.top - (currentGeomRightAfterJump?.bottom ?? roomRightAfterJump)
                : clientH - (currentGeomRightAfterJump?.bottom ?? roomRightAfterJump);
            const gapBelowAfterWait = belowGeomAfterWait
                ? belowGeomAfterWait.top - (currentGeomAfterWait?.bottom ?? room)
                : clientH - (currentGeomAfterWait?.bottom ?? room);
            // Gap *above* current, within 0..room — the part of the
            // viewport actually in question (see findDeckAbove's comment):
            // is this region genuinely covered by a real mounted deck, or
            // empty? No deck found at all means the entire 0..room region
            // is uncovered, not just "not current's own content."
            const gapAboveRightAfterJump = aboveGeomRightAfterJump
                ? roomRightAfterJump - aboveGeomRightAfterJump.bottom
                : roomRightAfterJump;
            const gapAboveAfterWait = aboveGeomAfterWait
                ? room - aboveGeomAfterWait.bottom
                : room;
            const roomDriftDuringWait = room - roomRightAfterJump;
            _perf.workZoneJumpStability.roomDriftSum += roomDriftDuringWait;
            _perf.workZoneJumpStability.roomDriftAbsSum += Math.abs(roomDriftDuringWait);
            _perf.workZoneJumpStability.roomDriftMaxAbs =
                Math.max(_perf.workZoneJumpStability.roomDriftMaxAbs, Math.abs(roomDriftDuringWait));
            // Every jump, not just outliers — capturing only the large
            // drifts can't answer whether drift correlates with the size
            // of roomRightAfterJump itself (e.g. "only large room drifts,
            // small room holds steady"); that needs the full
            // (size, drift) pairing to actually check, not a pre-filtered
            // sample. Capped only as a safety net for very long runs, not
            // as a deliberate sample size. role/turnId identify *what*
            // current actually was at each measurement — same safe
            // element-vs-synthetic-marker handling as currentNotePlaceholder
            // — to test whether drift clusters around a particular content
            // type (e.g. images/canvas, which can still have sub-elements
            // settling after scrollHeight itself looks stable) rather than
            // correlating with room's own size.
            const currentRoleForDriftLog = current?.element
                ? slabRole(current)
                : (current?.deckElement?.getAttribute('data-turn') || current?.type || 'unknown');
            const currentTurnIdForDriftLog = current?.element
                ? slabTurnId(current)
                : (deckSequenceId(current?.deckElement) || null);
            if (_perf.workZoneJumpStability.roomDriftLog.length < 2000) {
                _perf.workZoneJumpStability.roomDriftLog.push(
                    `rightAfterJump=${Math.round(roomRightAfterJump)}px, afterWait=${Math.round(room)}px, ` +
                    `drift=${Math.round(roomDriftDuringWait)}px, role=${currentRoleForDriftLog}, ` +
                    `turnId=${currentTurnIdForDriftLog || '(none)'}, buttons=${buttonsRightAfterJump ?? 'n/a'}->${buttonsAfterWait ?? 'n/a'}, ` +
                    `belowTurnId=${belowTurnIdRightAfterJump}->${belowTurnIdAfterWait}, belowChanged=${belowChanged}, ` +
                    `currentBottom=${Math.round(currentGeomRightAfterJump?.bottom ?? NaN)}->${Math.round(currentGeomAfterWait?.bottom ?? NaN)}px, ` +
                    `gapBelowCurrent=${Math.round(gapBelowRightAfterJump)}->${Math.round(gapBelowAfterWait)}px, ` +
                    `aboveTurnId=${aboveTurnIdRightAfterJump}->${aboveTurnIdAfterWait}, ` +
                    `gapAboveCurrent(0..room, the part actually on screen)=${Math.round(gapAboveRightAfterJump)}->${Math.round(gapAboveAfterWait)}px, ` +
                    `decksInWholeDom=${decksInDomRightAfterJump.length}->${decksInDomAfterWait.length}`
                );
            }
            // Ungated by drift — every jump up to the cap, not just ones
            // that already showed drift, so the non-drifting majority is
            // in the same dataset as the drifting minority (see the
            // comment above precedentDeck for why). Each entry bundles
            // current + precedent + subsequent together (one entry per
            // timing instant) rather than three separate ones, and labels
            // room (the position) right in the heading, not just drift —
            // both are needed to check a position-based theory, not only
            // a content-based one.
            if (turnContainerForButtons && _perf.workZoneJumpStability.fullSnapshotCount < WORK_ZONE_JUMP_SNAPSHOT_CAP) {
                _perf.workZoneJumpStability.fullSnapshotCount++;
                const snapshotTurnId = currentTurnIdForDriftLog || '(none)';
                const bundle = (label, h) =>
                    `<!-- room=${Math.round(h.room)}px, drift=${Math.round(roomDriftDuringWait)}px, turnId=${snapshotTurnId}, ` +
                    `belowTurnId=${h.belowTurnId}, belowChangedFromOtherInstant=${belowChanged}, aboveTurnId=${h.aboveTurnId} -->\n` +
                    `<!-- current rect: top=${Math.round(h.currentGeom?.top ?? NaN)}px bottom=${Math.round(h.currentGeom?.bottom ?? NaN)}px ` +
                    `height=${Math.round(h.currentGeom?.height ?? NaN)}px (clientH=${Math.round(clientH)}px) -->\n` +
                    `<!-- below rect: top=${Math.round(h.belowGeom?.top ?? NaN)}px bottom=${Math.round(h.belowGeom?.bottom ?? NaN)}px, ` +
                    `gap to current's bottom (off-screen, real content vs viewport's own bottom edge) = ${Math.round(h.gapBelow)}px -->\n` +
                    `<!-- above rect: top=${Math.round(h.aboveGeom?.top ?? NaN)}px bottom=${Math.round(h.aboveGeom?.bottom ?? NaN)}px, ` +
                    `gap in 0..room (the part actually on screen above current) — positive means genuinely uncovered: ${Math.round(h.gapAbove)}px -->\n` +
                    `<!-- precedent deck (DOM sibling): -->\n${h.precedentHtml ?? '<!-- (none) -->'}\n` +
                    `<!-- current deck: -->\n${h.currentHtml ?? '<!-- (none) -->'}\n` +
                    `<!-- subsequent deck (DOM sibling): -->\n${h.subsequentHtml ?? '<!-- (none) -->'}\n` +
                    `<!-- deck geometrically below current (by position, not DOM order): -->\n${h.belowHtml ?? '<!-- (none) -->'}\n` +
                    `<!-- deck geometrically above current (by position, not DOM order): -->\n${h.aboveHtml ?? '<!-- (none) -->'}`;
                pushHtmlCaptures('jump-snapshot-right-after-jump', [{
                    turnId: snapshotTurnId,
                    role: currentRoleForDriftLog,
                    html: bundle('right-after-jump', {
                        room: roomRightAfterJump, currentHtml: outerHtmlRightAfterJump,
                        precedentHtml: precedentHtmlRightAfterJump, subsequentHtml: subsequentHtmlRightAfterJump,
                        belowHtml: belowHtmlRightAfterJump, belowTurnId: belowTurnIdRightAfterJump,
                        aboveHtml: deckAboveRightAfterJump?.outerHTML || null, aboveTurnId: aboveTurnIdRightAfterJump,
                        currentGeom: currentGeomRightAfterJump, belowGeom: belowGeomRightAfterJump, aboveGeom: aboveGeomRightAfterJump,
                        gapBelow: gapBelowRightAfterJump, gapAbove: gapAboveRightAfterJump,
                    }),
                }]);
                pushHtmlCaptures('jump-snapshot-after-wait', [{
                    turnId: snapshotTurnId,
                    role: currentRoleForDriftLog,
                    html: bundle('after-wait', {
                        room, currentHtml: outerHtmlAfterWait,
                        precedentHtml: precedentHtmlAfterWait, subsequentHtml: subsequentHtmlAfterWait,
                        belowHtml: belowHtmlAfterWait, belowTurnId: belowTurnIdAfterWait,
                        aboveHtml: deckAboveAfterWait?.outerHTML || null, aboveTurnId: aboveTurnIdAfterWait,
                        currentGeom: currentGeomAfterWait, belowGeom: belowGeomAfterWait, aboveGeom: aboveGeomAfterWait,
                        gapBelow: gapBelowAfterWait, gapAbove: gapAboveAfterWait,
                    }),
                }]);
            }
            // There used to be a check here comparing the post-wait room to
            // roomBeforeJump + appliedJumpPx and failing on a mismatch —
            // removed, since predicting the outcome of our own scripted
            // jump that way was never actually reliable (see
            // roomDriftDuringWait above for the assumption that
            // replaced it, and why it's measured instead of trusted). The
            // loop below already doesn't care whether any one jump hit an
            // expectation — it just keeps stepping, re-measuring room
            // fresh, until advanceRoom is reached or time runs out.
            // Detachment stays checked because it's a structural fact
            // (current.geometryElement is or isn't in the document), not a
            // comparison against a number we made up.
            //
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
                    _perf.workZoneJumpStability.calibratedJumpCurrentJumps = 0;
                    _perf.workZoneJumpStability.calibratedJumpCurrentMoves = 0;
                    _perf.workZoneJumpStability.calibratedJumpCurrentLastMoveSequence = null;
                    _perf.workZoneJumpStability.adaptiveIncreases++;
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
                    _perf.workZoneJumpStability.calibratedJumpCurrentJumps = 0;
                    _perf.workZoneJumpStability.calibratedJumpCurrentMoves = 0;
                    _perf.workZoneJumpStability.calibratedJumpCurrentLastMoveSequence = null;
                    _perf.workZoneJumpStability.adaptiveResets++;
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
            _perf.viewportMoveOperationsWorkZone++;
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
    // reports data-is-intersecting="false" while blank — the same
    // fingerprint the Compatibility Check panel inspects. Resolution is
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
    async function waitForTurnReady(container, turnEl, timeoutMs = 30_000, onTick = null) {
        if (turnEl.getAttribute('data-is-intersecting') !== 'false') {
            recordReadyMargin(container);
            markContainerReady();
            return; // already resolved
        }
        const deadline = Date.now() + timeoutMs;
        while (turnEl.getAttribute('data-is-intersecting') === 'false') {
            onTick?.();
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
        recordReadyMargin(container);
        markContainerReady();
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

    function scheduleReadyContainerGapRecheck(kind, readyContainer, firstEl, secondEl, initialGap, threshold, containerTurnId) {
        if (_perf.readyContainerModel.delayedRechecksScheduled >= 20) return;
        _perf.readyContainerModel.delayedRechecksScheduled++;
        const label = `${kind}: turnId=${containerTurnId}, initial=${Math.round(initialGap)}px, threshold=${Math.round(threshold)}px`;
        setTimeout(() => {
            if (!readyContainer.isConnected || !firstEl?.isConnected || (secondEl && !secondEl.isConnected)) {
                _perf.readyContainerModel.delayedRechecksResolved++;
                if (_perf.readyContainerModel.delayedRecheckExamples.length < 10) {
                    _perf.readyContainerModel.delayedRecheckExamples.push(`${label} → node detached before recheck`);
                }
                return;
            }
            const r = readyContainer.getBoundingClientRect();
            const firstRect = firstEl.getBoundingClientRect();
            const firstScopeRect = slabScopeForMessageElement(firstEl).getBoundingClientRect();
            const secondRect = secondEl?.getBoundingClientRect();
            const secondScopeRect = secondEl ? slabScopeForMessageElement(secondEl).getBoundingClientRect() : null;
            let recheckedGap;
            if (kind === 'top-message-inset') recheckedGap = firstRect.top - r.top;
            else if (kind === 'bottom-message-inset') recheckedGap = r.bottom - firstRect.bottom;
            else recheckedGap = secondRect.top - firstRect.bottom;
            const delta = recheckedGap - initialGap;
            _perf.readyContainerModel.delayedRechecksResolved++;
            if (Math.abs(delta) >= SMALL_EXTRA) _perf.readyContainerModel.delayedRechecksChanged++;
            if (_perf.readyContainerModel.delayedRecheckExamples.length < 10) {
                _perf.readyContainerModel.delayedRecheckExamples.push(
                    `${label} → after 500ms ${Math.round(recheckedGap)}px (Δ${Math.round(delta)}px), ` +
                    `containerRect=[${rectSummary(r)}], ` +
                    `firstMessageRect=[${rectSummary(firstRect)}], ` +
                    `firstSlabScopeRect=[${rectSummary(firstScopeRect)}]` +
                    (secondRect ? `, secondMessageRect=[${rectSummary(secondRect)}]` : '') +
                    (secondScopeRect ? `, secondSlabScopeRect=[${rectSummary(secondScopeRect)}]` : '')
                );
            }
        }, 500);
    }

    function checkReadyContainerModel(readyContainer, checkedModelContainers) {
        if (!readyContainer || checkedModelContainers.has(readyContainer)) return;
        checkedModelContainers.add(readyContainer);
        _perf.readyContainerModel.checked++;

        const r = readyContainer.getBoundingClientRect();
        const tolerance = 1;
        const messageGapThreshold = Math.max(shortestMountedMessageHeight(), MIN_ONE_LINE_MESSAGE_HEIGHT);
        const edgeGapThreshold = SLAB_ADJACENCY_MAX_GAP;
        const members = [];
        const containerTurnId = deckSequenceId(readyContainer) || '(none)';
        const domMembers = new Set(readyContainer.querySelectorAll('[data-message-author-role]'));
        const probeMembers = new Set();
        const rememberModelExampleMsgId = (label, msgId) => {
            if (!msgId || _perf.readyContainerModel.exampleMsgIds.length >= 20) return;
            _perf.readyContainerModel.exampleMsgIds.push({ label, msgId });
        };

        for (const el of document.querySelectorAll('[data-message-author-role]')) {
            const er = el.getBoundingClientRect();
            const probe = er.top + SMALL_EXTRA;
            const probeInside = probe > r.top && probe <= r.bottom;
            const overlapPx = Math.min(er.bottom, r.bottom) - Math.max(er.top, r.top);
            const overlaps = overlapPx > SMALL_EXTRA;
            if (probeInside) {
                probeMembers.add(el);
                members.push({ el, rect: er });
                if (er.top < r.top - tolerance || er.bottom > r.bottom + tolerance) {
                    _perf.readyContainerModel.containmentViolations++;
                    if (_perf.readyContainerModel.examples.length < 10) {
                        _perf.readyContainerModel.examples.push(
                            `containment: message rect[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}] ` +
                            `not fully inside container[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]; ` +
                            `role=${el.getAttribute('data-message-author-role') || '(none)'}, ` +
                            `msgId=${el.getAttribute('data-message-id') || '(none)'}, readyContainerTurnId=${containerTurnId}`
                        );
                    }
                }
            } else if (overlaps) {
                _perf.readyContainerModel.overlappingNonMembers++;
                if (_perf.readyContainerModel.examples.length < 10) {
                    _perf.readyContainerModel.examples.push(
                        `overlap-nonmember: message rect[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}] ` +
                        `overlaps container[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}] by ${Math.round(overlapPx)}px ` +
                        `but probe=${Math.round(probe)} is outside; ` +
                        `role=${el.getAttribute('data-message-author-role') || '(none)'}, ` +
                        `msgId=${el.getAttribute('data-message-id') || '(none)'}, readyContainerTurnId=${containerTurnId}`
                    );
                }
            }
        }

        for (const el of domMembers) {
            if (probeMembers.has(el)) continue;
            _perf.readyContainerModel.domOnlyMembers++;
            if (_perf.readyContainerModel.examples.length < 10) {
                const er = el.getBoundingClientRect();
                _perf.readyContainerModel.examples.push(
                    `dom-only-member: message is a DOM descendant but its probe is outside readyContainer; ` +
                    `message rect[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}], ` +
                    `container[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]; ` +
                    `role=${el.getAttribute('data-message-author-role') || '(none)'}, ` +
                    `msgId=${el.getAttribute('data-message-id') || '(none)'}, readyContainerTurnId=${containerTurnId}`
                );
            }
        }
        for (const el of probeMembers) {
            if (domMembers.has(el)) continue;
            _perf.readyContainerModel.probeOnlyMembers++;
            if (_perf.readyContainerModel.examples.length < 10) {
                const er = el.getBoundingClientRect();
                _perf.readyContainerModel.examples.push(
                    `probe-only-member: message probe is inside readyContainer but it is not a DOM descendant; ` +
                    `message rect[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}], ` +
                    `container[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]; ` +
                    `role=${el.getAttribute('data-message-author-role') || '(none)'}, ` +
                    `msgId=${el.getAttribute('data-message-id') || '(none)'}, readyContainerTurnId=${containerTurnId}`
                );
            }
        }

        const stacks = [...readyContainer.querySelectorAll('[data-conversation-screenshot-content]')]
            .map(scope => [...scope.children].find(child => child.matches?.('.flex.max-w-full.flex-col.gap-4.grow')))
            .filter(Boolean);
        for (const stack of stacks) {
            _perf.readyContainerModel.slabStacksChecked++;
            const slabItems = [...stack.children]
                .map((el, index) => ({ el, index, rect: el.getBoundingClientRect(), kind: classifySlabItem(el) }))
                .filter(item => item.rect.height > 0);
            _perf.readyContainerModel.slabItemsChecked += slabItems.length;
            for (const item of slabItems) {
                if (item.kind === 'unknown') {
                    _perf.readyContainerModel.unknownSlabItems++;
                    if (_perf.readyContainerModel.examples.length < 10) {
                        _perf.readyContainerModel.examples.push(
                            `unknown-slab-item: ${describeSlabItem(item.el, item.index)}, ` +
                            `readyContainerTurnId=${containerTurnId}`
                        );
                    }
                }
            }
            slabItems.sort((a, b) => a.rect.top - b.rect.top);
            for (let i = 1; i < slabItems.length; i++) {
                const gap = slabItems[i].rect.top - slabItems[i - 1].rect.bottom;
                if (gap > _perf.readyContainerModel.maxSlabGap) {
                    _perf.readyContainerModel.maxSlabGap = gap;
                }
                if (gap >= edgeGapThreshold) {
                    _perf.readyContainerModel.slabGapViolations++;
                    if (_perf.readyContainerModel.examples.length < 10) {
                        _perf.readyContainerModel.examples.push(
                            `slab-gap: ${Math.round(gap)}px between direct stack slabs ` +
                            `(threshold=${Math.round(edgeGapThreshold)}px); ` +
                            `readyContainerTurnId=${containerTurnId}, ` +
                            `prev=${describeSlabItem(slabItems[i - 1].el, slabItems[i - 1].index)}, ` +
                            `next=${describeSlabItem(slabItems[i].el, slabItems[i].index)}`
                        );
                    }
                }
            }
        }

        members.sort((a, b) => a.rect.top - b.rect.top);
        if (members.length > 0) {
            const topGap = members[0].rect.top - r.top;
            const bottomGap = r.bottom - members[members.length - 1].rect.bottom;
            if (topGap > _perf.readyContainerModel.maxTopEdgeGap) {
                _perf.readyContainerModel.maxTopEdgeGap = topGap;
                _perf.readyContainerModel.maxTopEdgeWinner = {
                    msgId: members[0].el.getAttribute('data-message-id') || '(none)',
                    role: members[0].el.getAttribute('data-message-author-role') || '(none)',
                    containerTurnId,
                    gap: Math.round(topGap),
                    containerRect: rectSummary(r),
                    messageRect: rectSummary(members[0].rect),
                    slabScopeRect: rectSummary(slabScopeForMessageElement(members[0].el).getBoundingClientRect()),
                    memberCount: members.length,
                };
            }
            if (bottomGap > _perf.readyContainerModel.maxBottomEdgeGap) {
                _perf.readyContainerModel.maxBottomEdgeGap = bottomGap;
                _perf.readyContainerModel.maxBottomEdgeWinner = {
                    msgId: members[members.length - 1].el.getAttribute('data-message-id') || '(none)',
                    role: members[members.length - 1].el.getAttribute('data-message-author-role') || '(none)',
                    containerTurnId,
                    gap: Math.round(bottomGap),
                    containerRect: rectSummary(r),
                    messageRect: rectSummary(members[members.length - 1].rect),
                    slabScopeRect: rectSummary(slabScopeForMessageElement(members[members.length - 1].el).getBoundingClientRect()),
                    memberCount: members.length,
                };
            }
            if (topGap >= edgeGapThreshold) {
                _perf.readyContainerModel.topEdgeViolations++;
                scheduleReadyContainerGapRecheck('top-message-inset', readyContainer, members[0].el, null, topGap, edgeGapThreshold, containerTurnId);
                if (_perf.readyContainerModel.examples.length < 10) {
                    const gapTop = r.top;
                    const gapBottom = members[0].rect.top;
                    const gapOccupants = [...document.querySelectorAll('[data-message-author-role]')]
                        .filter(el => el !== members[0].el)
                        .map(el => ({ el, rect: el.getBoundingClientRect() }))
                        .filter(({ rect }) => rect.bottom > gapTop && rect.top < gapBottom)
                        .sort((a, b) => b.rect.bottom - a.rect.bottom);
                    const nearestAbove = [...document.querySelectorAll('[data-message-author-role]')]
                        .filter(el => el !== members[0].el)
                        .map(el => ({ el, rect: el.getBoundingClientRect() }))
                        .filter(({ rect }) => rect.bottom <= gapBottom)
                        .sort((a, b) => b.rect.bottom - a.rect.bottom)[0] || null;
                    const nonMessageGapOccupants = [...readyContainer.querySelectorAll('*')]
                        .filter(el => !el.matches('[data-message-author-role]') && !el.closest('[data-message-author-role]'))
                        .map(el => {
                            const rect = el.getBoundingClientRect();
                            const overlap = Math.min(rect.bottom, gapBottom) - Math.max(rect.top, gapTop);
                            return { el, rect, overlap };
                        })
                        .filter(({ overlap }) => overlap > SMALL_EXTRA)
                        .sort((a, b) => b.overlap - a.overlap);
                    const nestedGapContainers = [...readyContainer.querySelectorAll('[data-turn-id-container]')]
                        .map(el => {
                            const rect = el.getBoundingClientRect();
                            const overlap = Math.min(rect.bottom, gapBottom) - Math.max(rect.top, gapTop);
                            return { el, rect, overlap };
                        })
                        .filter(({ overlap }) => overlap > SMALL_EXTRA)
                        .sort((a, b) => b.overlap - a.overlap);
                    const ancestorContainers = [];
                    for (let el = readyContainer.parentElement; el; el = el.parentElement) {
                        if (el.matches?.('[data-turn-id-container]')) {
                            const rect = el.getBoundingClientRect();
                            ancestorContainers.push({
                                id: el.getAttribute('data-turn-id-container') || '(none)',
                                rect,
                            });
                        }
                    }
                    const describeGapMessage = item => item
                        ? `role=${item.el.getAttribute('data-message-author-role') || '(none)'}, ` +
                          `msgId=${item.el.getAttribute('data-message-id') || '(none)'}, ` +
                          `rect=[top=${Math.round(item.rect.top)},bottom=${Math.round(item.rect.bottom)}], ` +
                          `containerId=${item.el.closest('[data-turn-id-container]')?.getAttribute('data-turn-id-container') || '(none)'}`
                        : '(none)';
                    const describeGapElement = item => item
                        ? `<${item.el.tagName.toLowerCase()}> overlap=${Math.round(item.overlap)}px, ` +
                          `rect=[top=${Math.round(item.rect.top)},bottom=${Math.round(item.rect.bottom)}], ` +
                          `class="${(item.el.className || '').slice(0, 80)}", ` +
                          `data="${[...item.el.attributes].filter(a => a.name.startsWith('data-')).map(a => a.value ? `${a.name}=${a.value}` : a.name).join(' ')}"`
                        : '(none)';
                    const describeGapContainer = item => item
                        ? `id=${item.el.getAttribute('data-turn-id-container') || '(none)'}, ` +
                          `overlap=${Math.round(item.overlap)}px, ` +
                          `rect=[top=${Math.round(item.rect.top)},bottom=${Math.round(item.rect.bottom)},height=${Math.round(item.rect.height)}]`
                        : '(none)';
                    _perf.readyContainerModel.examples.push(
                        `top-message-inset: ${Math.round(topGap)}px before first message slab in readyContainer ` +
                        `(threshold=${Math.round(edgeGapThreshold)}px); ` +
                        `firstMsgId=${members[0].el.getAttribute('data-message-id') || '(none)'}, ` +
                        `readyContainerTurnId=${containerTurnId}, ` +
                        `containerRect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)},height=${Math.round(r.height)}], ` +
                        `firstMessageRect=[top=${Math.round(members[0].rect.top)},bottom=${Math.round(members[0].rect.bottom)}], ` +
                        `firstSlabScopeRect=[${rectSummary(slabScopeForMessageElement(members[0].el).getBoundingClientRect())}], ` +
                        `memberCount=${members.length}, ` +
                        `gapOccupantCount=${gapOccupants.length}, ` +
                        `nearestGapOccupant=${describeGapMessage(gapOccupants[0])}, ` +
                        `nearestMessageAboveFirst=${describeGapMessage(nearestAbove)}, ` +
                        `nonMessageGapOccupantCount=${nonMessageGapOccupants.length}, ` +
                        `largestNonMessageGapOccupant=${describeGapElement(nonMessageGapOccupants[0])}, ` +
                        `nestedGapContainerCount=${nestedGapContainers.length}, ` +
                        `largestNestedGapContainer=${describeGapContainer(nestedGapContainers[0])}, ` +
                        `ancestorContainerCount=${ancestorContainers.length}, ` +
                        `nearestAncestorContainer=${ancestorContainers[0]
                            ? `id=${ancestorContainers[0].id}, rect=[top=${Math.round(ancestorContainers[0].rect.top)},bottom=${Math.round(ancestorContainers[0].rect.bottom)},height=${Math.round(ancestorContainers[0].rect.height)}]`
                            : '(none)'}, ` +
                        `siblingSlabCoverage=${describeSiblingSlabItemsInRange(members[0].el, gapTop, gapBottom)}, ` +
                        `slabScopeCandidates=${describeSlabScopeCandidatesForMessageElement(members[0].el, readyContainer)}`
                    );
                    rememberModelExampleMsgId('top-message-inset first', members[0].el.getAttribute('data-message-id'));
                }
            }
            if (bottomGap >= edgeGapThreshold) {
                _perf.readyContainerModel.bottomEdgeViolations++;
                scheduleReadyContainerGapRecheck('bottom-message-inset', readyContainer, members[members.length - 1].el, null, bottomGap, edgeGapThreshold, containerTurnId);
                if (_perf.readyContainerModel.examples.length < 10) {
                    _perf.readyContainerModel.examples.push(
                        `bottom-message-inset: ${Math.round(bottomGap)}px after last message slab in readyContainer ` +
                        `(threshold=${Math.round(edgeGapThreshold)}px); ` +
                        `lastMsgId=${members[members.length - 1].el.getAttribute('data-message-id') || '(none)'}, ` +
                        `readyContainerTurnId=${containerTurnId}, ` +
                        `containerRect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)},height=${Math.round(r.height)}], ` +
                        `lastMessageRect=[top=${Math.round(members[members.length - 1].rect.top)},bottom=${Math.round(members[members.length - 1].rect.bottom)}], ` +
                        `lastSlabScopeRect=[${rectSummary(slabScopeForMessageElement(members[members.length - 1].el).getBoundingClientRect())}], ` +
                        `memberCount=${members.length}, ` +
                        `siblingSlabCoverage=${describeSiblingSlabItemsInRange(members[members.length - 1].el, members[members.length - 1].rect.bottom, r.bottom)}, ` +
                        `slabScopeCandidates=${describeSlabScopeCandidatesForMessageElement(members[members.length - 1].el, readyContainer)}`
                    );
                    rememberModelExampleMsgId('bottom-message-inset last', members[members.length - 1].el.getAttribute('data-message-id'));
                }
            }
        }
        for (let i = 1; i < members.length; i++) {
            const gap = members[i].rect.top - members[i - 1].rect.bottom;
            if (gap > _perf.readyContainerModel.maxMessageGap) _perf.readyContainerModel.maxMessageGap = gap;
            if (gap >= messageGapThreshold) {
                _perf.readyContainerModel.messageGapViolations++;
                scheduleReadyContainerGapRecheck('message-gap', readyContainer, members[i - 1].el, members[i].el, gap, messageGapThreshold, containerTurnId);
                if (_perf.readyContainerModel.examples.length < 10) {
                    _perf.readyContainerModel.examples.push(
                        `message-gap: ${Math.round(gap)}px between adjacent message slabs in readyContainer ` +
                        `(threshold=${Math.round(messageGapThreshold)}px); ` +
                        `prevMsgId=${members[i - 1].el.getAttribute('data-message-id') || '(none)'}, ` +
                        `nextMsgId=${members[i].el.getAttribute('data-message-id') || '(none)'}, ` +
                        `readyContainerTurnId=${containerTurnId}, ` +
                        `siblingSlabCoverage=${describeSiblingSlabItemsInRange(members[i].el, members[i - 1].rect.bottom, members[i].rect.top)}, ` +
                        `prevSlabScopeCandidates=${describeSlabScopeCandidatesForMessageElement(members[i - 1].el, readyContainer)}, ` +
                        `nextSlabScopeCandidates=${describeSlabScopeCandidatesForMessageElement(members[i].el, readyContainer)}`
                    );
                    rememberModelExampleMsgId('message-gap prev', members[i - 1].el.getAttribute('data-message-id'));
                    rememberModelExampleMsgId('message-gap next', members[i].el.getAttribute('data-message-id'));
                }
            }
        }
    }

    function isCanvasBlock(el) {
        return Boolean(el?.id && el.id.startsWith('textdoc-message-'));
    }

    function recordNearbySlabCandidates(count) {
        if (count <= 1) return;
        _perf.multiCandidatesInReadyContainer++;
        _perf.multiCandidatesMax = Math.max(_perf.multiCandidatesMax, count);
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

    function recordFilteredSlabItem(el, rule = null) {
        if (rule) {
            if (_reportedAllowlistedSlabItems.has(el)) return;
            _reportedAllowlistedSlabItems.add(el);
            _perf.slabFiltering.allowlisted++;
            _perf.slabFiltering.byRule[rule.name] = (_perf.slabFiltering.byRule[rule.name] || 0) + 1;
            return;
        }
        if (_reportedUnlistedSlabItems.has(el)) return;
        _reportedUnlistedSlabItems.add(el);
        _perf.slabFiltering.unlisted++;
        const description = `UNLISTED filtered direct-stack item: ${describeSlabItem(el)}`;
        if (_perf.slabFiltering.examples.length < 20) {
            _perf.slabFiltering.examples.push(description);
        }
        console.warn(`[Extractor] ${description}`, el);
    }

    function inspectUnselectedStackItems(selectedCandidates, acceptsRect) {
        const selectedGeometry = new Set(selectedCandidates.map(candidate => candidate.geometryElement));
        const unlisted = [];
        for (const el of directStackItems()) {
            if (selectedGeometry.has(el) || selectedCandidates.some(candidate => el.contains(candidate.element))) continue;
            const rect = el.getBoundingClientRect();
            if (!acceptsRect(rect)) continue;
            const rule = filteredSlabRuleFor(el);
            recordFilteredSlabItem(el, rule);
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
            _perf.canvasBlocks.seenGlobally++;
            _perf.canvasBlocks.candidatesFound++;
            candidates.push(makeSlabCandidate('canvas', el));
        }
        for (const el of imageEls) {
            _perf.imageOnlyTurns.candidatesFound++;
            const turnId = el.closest('[data-turn]')?.getAttribute('data-turn-id') || null;
            if (turnId && !_perf.imageOnlyTurns.byTurnId[turnId]) {
                _perf.imageOnlyTurns.byTurnId[turnId] = {
                    verdict: 'direct-image-candidate',
                    dryTextLen: 0,
                    nearestUserMsgId: '(not applicable)',
                    nearestUserContainerId: '(not applicable)',
                    extracted: false,
                };
            }
            candidates.push(makeSlabCandidate('image', el));
            watchImageSrcHistory(el);
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
        recordNearbySlabCandidates(ranked.length);
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
    function findNextSlabInReadyDeck(deckEl, currentSlab, entryDiag = null) {
        const selectedCandidates = querySelectedSlabCandidates(deckEl);
        const stackItems = directStackItems(deckEl);
        const frame = measureSlabSearchFrame(deckEl, currentSlab, selectedCandidates, stackItems);
        if (frame.roomAhead <= SMALL_EXTRA) return { kind: 'end-of-deck' };

        if (selectedCandidates.length === 0) {
            const unlisted = [];
            for (const { el } of frame.stackItems) {
                const rule = filteredSlabRuleFor(el);
                recordFilteredSlabItem(el, rule);
                if (!rule) unlisted.push(el);
            }
            const detail = stackItems.length === 0
                ? ''
                : ` ${stackItems.length} direct-stack item(s) existed, but none matched a valid slab selector` +
                  (unlisted.length ? ` (${unlisted.length} unlisted); see diagnostics.` : '.');
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
                            `or an extractor bug; see the exported diagnostics.${detail} ` +
                            `${describeMovesSinceEntry(entryDiag)}, ${describeIntersectingHistory(deckEl)}]*\n\n` +
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
        recordNearbySlabCandidates(ranked.length);

        const selectedGeometry = new Set(selectedCandidates.map(candidate => candidate.geometryElement));
        const unlisted = [];
        for (const { el, distances } of frame.stackItems) {
            if (selectedGeometry.has(el) || selectedCandidates.some(candidate => el.contains(candidate.element))) continue;
            if (!distances) continue;
            const rule = filteredSlabRuleFor(el);
            recordFilteredSlabItem(el, rule);
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
    async function waitForNextSlabInReadyDeck(deckEl, currentSlab, getEntryDiag, onTick, timeoutMs = SLAB_FINISH_TIMEOUT_MS) {
        const selection = findNextSlabInReadyDeck(deckEl, currentSlab, getEntryDiag());
        if (selection.kind !== 'slab') return selection; // no fingerprint to wait for — final answer now
        _perf.slabDiscoveryWait.waited++;
        const startedAt = performance.now();
        const deadline = Date.now() + timeoutMs;
        let fp = slabFinishFingerprint(selection.slab, deckEl);
        while (!fp.ready) {
            if (Date.now() > deadline) {
                const waitedMs = Math.round(performance.now() - startedAt);
                _perf.slabDiscoveryWait.timedOut++;
                _perf.slabDiscoveryWait.maxWaitMs = Math.max(_perf.slabDiscoveryWait.maxWaitMs, waitedMs);
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
            onTick?.();
            await sleep(SLAB_FINISH_POLL_MS);
            fp = slabFinishFingerprint(selection.slab, deckEl);
        }
        const waitedMs = Math.round(performance.now() - startedAt);
        if (waitedMs < SLAB_FINISH_POLL_MS) _perf.slabDiscoveryWait.alreadyReady++;
        else _perf.slabDiscoveryWait.resolvedAfterWait++;
        _perf.slabDiscoveryWait.maxWaitMs = Math.max(_perf.slabDiscoveryWait.maxWaitMs, waitedMs);
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
                _perf.canvasBlocks.markdownEmpty++;
                return null;
            }
            _perf.canvasBlocks.extracted++;
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
        // the only stable identity they carry.
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

    async function run(ui, stopBtn, resumeState = null) {
        const isResume = !!resumeState;
        _pendingAutoRestart = false;
        stopActiveLifecycleObserver();
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
        _reportedAllowlistedSlabItems = new WeakSet();
        _reportedUnlistedSlabItems = new WeakSet();
        _watchedImageSrcHistory = new WeakSet();
        _watchedIntersectingHistory = new WeakSet();
        if (!isResume || !_perf.runStartMs) _perf.runStartMs = performance.now();
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

        const allPrompts = isResume ? resumeState.allPrompts : [];
        const checkedModelContainers = new WeakSet();
        let lastEl = resumeState?.lastEl || null;
        let stopReason = null; // non-null = stopped early; still export what we have
        // Cumulative across the whole run, unlike advancesWithoutProgress
        // (which resets on every real-progress event) — this is "how many
        // containers has the walk gone through in total," for the panel and
        // the snapshot table. Declared here (not next to its increment site)
        // so it's already in scope for the bootstrap's own status() call.
        let totalContainerAdvances = resumeState?.totalContainerAdvances || 0;
        // The total viewport-move count as of the last confirmed prompt —
        // comparing this against the current total when the *next* prompt
        // is confirmed is how "did a viewport move happen between these two
        // prompts" gets decided, for both the panel log and the split
        // gap-violation stats below.
        let viewportMovesAtLastPrompt = resumeState?.viewportMovesAtLastPrompt || 0;
        let readyContainer = resumeState?.readyContainer || null;
        let current = resumeState?.current || SLAB_WALK_START;
        let containerSlabRanges = resumeState?.containerSlabRanges || [];
        // The edge of a deck nearest the already-explored side of the walk —
        // i.e. where "light" first reaches it. direction=-1: walking upward,
        // so a new deck's bottom edge is the one adjacent to the deck just
        // finished; its top edge is the unexplored interior. Used by
        // containerReach below to measure how far past that entry edge
        // extraction actually finds a slab, as direct evidence for whether
        // readiness covers the whole deck or only the part nearest the
        // entry point.
        const containerNearEdge = el =>
            WALK_DIRECTION === -1 ? el.getBoundingClientRect().bottom : el.getBoundingClientRect().top;
        let containerEntryY = resumeState?.containerEntryY ?? (readyContainer ? containerNearEdge(readyContainer) : null);
        // Captured the instant a deck's own readiness gate (data-is-
        // intersecting) resolves, before any further scrolling happens —
        // lets an "Empty container" placeholder show whether the work zone
        // moved again (and how many times) between that resolution and the
        // moment the deck was searched and found empty, since a move in
        // between could itself be what pushed ChatGPT to re-unmount the
        // deck it had just mounted.
        let deckEntryDiag = resumeState?.deckEntryDiag || null;
        // Defensive cap: if ready decks keep yielding no extractable slab,
        // that's not "the conversation is just long." Fail fast with the
        // geometry that didn't match, rather than spin silently through every
        // remaining deck.
        let advancesWithoutProgress = resumeState?.advancesWithoutProgress || 0;
        const MAX_ADVANCES_WITHOUT_PROGRESS = 50;
        // Tracks how many consecutive advances stayed on the same
        // data-turn-id before genuinely moving to a different one — a
        // direct measure of how much duplicate-sibling traffic the turn-id
        // dedup filter is absorbing, independent of whether the run
        // ultimately succeeds or hits the advance cap.
        let lastAdvanceTurnId = resumeState?.lastAdvanceTurnId || null;
        let curTurnIdRun = resumeState?.curTurnIdRun || 0;
        // className/attributes of every deck advanced through without a
        // matching slab — rect coordinates alone don't say whether a long
        // run of zero-height decks are genuine (if sparse) turn wrappers or
        // some unrelated decorative/structural element that happens to
        // satisfy findNextDeck's geometric strip test. Cleared whenever real
        // progress resets advancesWithoutProgress, so a later failure's
        // report isn't contaminated by an earlier, unrelated stretch.
        let advanceChain = resumeState?.advanceChain || [];

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
        // the same page load (Restart, or switching between this and the
        // Compatibility Check panel) would otherwise bootstrap from wherever
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
        const currentScrollPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
        // Re-reads the scroll position fresh at the moment of an "Empty
        // container" check, alongside the position captured at deck entry —
        // the gap between the two is the actual realized displacement, not
        // just a count of move-calls we issued (see deckEntryDiag above).
        const diagAtFailure = () => deckEntryDiag ? { ...deckEntryDiag, scrollPosNow: currentScrollPos() } : null;
        const enterDeck = async (targetDeck) => {
            const readinessEl = readinessElementForDeck(targetDeck);
            if (!readyContainer) _perf.bootstrapWasIntersectingFalse = readinessEl.getAttribute('data-is-intersecting') === 'false';
            watchContainerLifecycle(readinessEl);
            watchIntersectingHistory(readinessEl);
            await waitForTurnReady(container, readinessEl, 30_000, maybeSnap);
            // scrollPosAtEntry lets a later "Empty container" placeholder show
            // the actual realized displacement since this deck was confirmed
            // ready, not just how many move-calls we issued — a queued/
            // batched scroll (browser scroll-anchoring or ChatGPT's own
            // scroll-restoration applying several of our retries at once)
            // could produce a large displacement from very few call-counted
            // moves, which a move-count alone would not reveal.
            deckEntryDiag = {
                movesAtEntry: totalViewportMoves(),
                isIntersectingAtEntry: readinessEl.getAttribute('data-is-intersecting'),
                scrollPosAtEntry: currentScrollPos(),
            };
            if (readyContainer) {
                if (readyContainer.isConnected) {
                    requireDeckAdjacency(readyContainer, targetDeck);
                } else {
                    _perf.containerGapSkippedDetached++;
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
            containerEntryY = containerNearEdge(readyContainer);
            current = makeDeckEntryCurrent(readyContainer);
            containerSlabRanges = [];
            totalContainerAdvances++;
            advanceChain.push({ desc: describeTurnContainer(readyContainer), el: readyContainer });
            const thisTurnId = deckSequenceId(readyContainer);
            curTurnIdRun = (thisTurnId && thisTurnId === lastAdvanceTurnId) ? curTurnIdRun + 1 : 1;
            lastAdvanceTurnId = thisTurnId;
            _perf.turnIdDedupMaxRun = Math.max(_perf.turnIdDedupMaxRun, curTurnIdRun);
            ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
            maybeSnap();
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
            // maintainWorkZone now either returns roomSatisfied:true, returns
            // a clamped boundaryReached result, or throws on a genuine
            // deviation — never roomSatisfied:false without boundaryReached,
            // so there's nothing left to retry here.
            const zoneStatus = await maintainWorkZone(container, current, SLAB_LOOKAHEAD_PX);
            if (zoneStatus.jumpsTaken > 0) {
                ui.log(`  work-zone move: ${zoneStatus.jumpsTaken} step(s), outcome=${zoneStatus.outcome}`);
            }
            if (!zoneStatus.roomSatisfied) {
                if (ui.total > 0 && countPrompts(allPrompts) < ui.total) {
                    const boundaryLabel = WALK_DIRECTION === -1 ? 'start' : 'end';
                    stopReason = `Reached the supplied ${boundaryLabel} with only ${countPrompts(allPrompts)}/${ui.total} ` +
                        `user prompts extracted. This is a count mismatch, not proof that more deck space exists; ` +
                        `earlier slab extraction likely missed prompt(s). ${describeCurrentForStop(current, readyContainer)}`;
                }
                break;
            }

            if (readyContainer) checkReadyContainerModel(readyContainer, checkedModelContainers);

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
                selection = await waitForNextSlabInReadyDeck(readyContainer, current, diagAtFailure, maybeSnap);
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
                if (readyContainer) {
                    const placeholder = finishDeckCoverage(readyContainer, containerSlabRanges, current, diagAtFailure());
                    if (placeholder) insertMsg(placeholder);
                    current = makeDeckExitCurrent(readyContainer);
                    const exitZoneStatus = await maintainWorkZone(container, current, SLAB_LOOKAHEAD_PX);
                    if (exitZoneStatus.jumpsTaken > 0) {
                        ui.log(`  work-zone move (deck exit): ${exitZoneStatus.jumpsTaken} step(s), outcome=${exitZoneStatus.outcome}`);
                    }
                    if (!exitZoneStatus.roomSatisfied) {
                        if (ui.total > 0 && countPrompts(allPrompts) < ui.total) {
                            const boundaryLabel = WALK_DIRECTION === -1 ? 'start' : 'end';
                            stopReason = `Reached the supplied ${boundaryLabel} with only ${countPrompts(allPrompts)}/${ui.total} ` +
                                `user prompts extracted. This is a count mismatch, not proof that more deck space exists; ` +
                                `earlier slab extraction likely missed prompt(s). ${describeCurrentForStop(current, readyContainer)}`;
                        }
                        break;
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
                    if (ui.total === 0 || countPrompts(allPrompts) >= ui.total) break;
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
                _perf.maxAdvancesWithoutProgress = Math.max(_perf.maxAdvancesWithoutProgress, advancesWithoutProgress);
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
            lastAdvanceTurnId = null;
            curTurnIdRun = 0;
            const vpNow = totalViewportMoves();
            const vpDelta = vpNow - viewportMovesAtLastPrompt;
            const msgId = slabMessageId(next);
            if (next.type === 'note') {
                recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
                insertMsg(next.note);
                lastEl = next.geometryElement;
                current = next;
                viewportMovesAtLastPrompt = vpNow;
                ui.log(`#${allPrompts.length} confirmed (note/${slabRole(next)}) — Δviewport ${vpDelta}`);
                ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
                maybeSnap();
                await sleep(30);
                continue;
            }
            // ── extract the slab once ──
            const msg = extractSlab(next);
            if (!msg) {
                _perf.extractionFailures.count++;
                if (_perf.extractionFailures.examples.length < 10) {
                    _perf.extractionFailures.examples.push(
                        `type=${next.type} role=${slabRole(next)} ` +
                        `turnId=${slabTurnId(next) || '(none)'} ` +
                        `msgId=${msgId || '(none)'} returned empty under current readiness fingerprint`
                    );
                }
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
                if (!_perf.bootstrapRole) _perf.bootstrapRole = slabRole(next);
                // Gated on byTurnId actually having this turnId, not just
                // turnId being truthy — canvas-block extractions also
                // carry a turnId (see extractSlab) but were never found
                // via the image-turn candidate loop, so they must not
                // inflate this image-only-turns counter.
                if (next.type === 'image' && msg.turnId && _perf.imageOnlyTurns.byTurnId[msg.turnId]) {
                    _perf.imageOnlyTurns.extracted++;
                    _perf.imageOnlyTurns.byTurnId[msg.turnId].extracted = true;
                }
                recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
                // Direct evidence for the whole-deck-readiness question:
                // how far past this deck's entry edge did extraction just
                // reach to find this slab? If readiness only ever
                // covered the area right at the entry edge, reach would
                // stay small/near-zero even for large decks; a reach
                // that grows to a large fraction of the deck's own
                // height is evidence the whole deck was actually ready,
                // not just the part nearest where light first hit it.
                {
                    const slabY = next.geometryElement.getBoundingClientRect().top;
                    const reach = WALK_DIRECTION === -1 ? containerEntryY - slabY : slabY - containerEntryY;
                    _perf.containerReach.count++;
                    _perf.containerReach.sum += reach;
                    if (reach > _perf.containerReach.max) {
                        _perf.containerReach.max = reach;
                        const containerHeight = readyContainer.getBoundingClientRect().height;
                        _perf.containerReach.maxWinner = {
                            turnId: deckSequenceId(readyContainer) || '(none)',
                            containerHeight: Math.round(containerHeight),
                            pct: containerHeight > 0 ? Math.round(100 * reach / containerHeight) : null,
                        };
                    }
                }
                insertMsg(msg);
            }
            // ── current = extracted slab ──
            lastEl = next.geometryElement;
            current = next;
            viewportMovesAtLastPrompt = vpNow;

            ui.log(`#${allPrompts.length} confirmed (${next.type}/${slabRole(next)}) — Δviewport ${vpDelta}`);
            ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
            maybeSnap();

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
                    containerEntryY,
                    deckEntryDiag,
                    totalContainerAdvances,
                    viewportMovesAtLastPrompt,
                    advancesWithoutProgress,
                    lastAdvanceTurnId,
                    curTurnIdRun,
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
        if (!stopReason) _resumeState = null;
        stopActiveLifecycleObserver();
        stopBackgroundPositionSampler();
        removeStabilizationMarker();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (_perf.readyContainerModel.delayedRechecksResolved < _perf.readyContainerModel.delayedRechecksScheduled) {
            await sleep(550);
        }

        const _totalMs = performance.now() - _perf.runStartMs;
        const _sleepMs = _totalMs - _perf.htmlToMarkdownMs;
        ui.log('── perf (v4.159) ──');
        ui.log(`total ${(_totalMs/1000).toFixed(1)}s | sleep/wait ${(_sleepMs/1000).toFixed(1)}s (${Math.round(100*_sleepMs/_totalMs)}%)`);
        ui.log(`htmlToMarkdown: ${_perf.htmlToMarkdownCalls} calls, ${Math.round(_perf.htmlToMarkdownMs)}ms`);
        ui.log(`${countPrompts(allPrompts)} prompts saved (${allPrompts.length} msgs total).`);
        ui.log(
            `Ready-container nearby message slabs outside deck: ${_perf.readyContainerProbeMisses.count} overlapping/near ` +
            `(overlapping=${_perf.readyContainerProbeMisses.overlapping}, near-only=${_perf.readyContainerProbeMisses.nearOnly}, ` +
            `above=${_perf.readyContainerProbeMisses.above}, below=${_perf.readyContainerProbeMisses.below})`
        );
        ui.log(
            `Ready-container model: ${_perf.readyContainerModel.checked} checked, ` +
            `containment=${_perf.readyContainerModel.containmentViolations}, ` +
            `overlap-nonmember=${_perf.readyContainerModel.overlappingNonMembers}, ` +
            `dom-only=${_perf.readyContainerModel.domOnlyMembers}, ` +
            `probe-only=${_perf.readyContainerModel.probeOnlyMembers}, ` +
            `message-gaps=${_perf.readyContainerModel.messageGapViolations}, ` +
            `maxMessageGap=${Math.round(_perf.readyContainerModel.maxMessageGap)}px, ` +
            `message-insets=${_perf.readyContainerModel.topEdgeViolations + _perf.readyContainerModel.bottomEdgeViolations} ` +
            `(top=${_perf.readyContainerModel.topEdgeViolations}, bottom=${_perf.readyContainerModel.bottomEdgeViolations}, ` +
            `maxTop=${Math.round(_perf.readyContainerModel.maxTopEdgeGap)}px, ` +
            `maxBottom=${Math.round(_perf.readyContainerModel.maxBottomEdgeGap)}px, ` +
            `maxBottomMsg=${_perf.readyContainerModel.maxBottomEdgeWinner?.msgId || '(none)'}), ` +
            `slabs=${_perf.readyContainerModel.slabItemsChecked}/${_perf.readyContainerModel.slabStacksChecked}, ` +
            `unknownSlabs=${_perf.readyContainerModel.unknownSlabItems}, ` +
            `slabGaps=${_perf.readyContainerModel.slabGapViolations}, ` +
            `maxSlabGap=${Math.round(_perf.readyContainerModel.maxSlabGap)}px, ` +
            `rechecks=${_perf.readyContainerModel.delayedRechecksResolved}/${_perf.readyContainerModel.delayedRechecksScheduled}, ` +
            `changed=${_perf.readyContainerModel.delayedRechecksChanged}`
        );
        ui.log(
            `Slab discovery wait: checked=${_perf.slabDiscoveryWait.waited}, ` +
            `already=${_perf.slabDiscoveryWait.alreadyReady}, ` +
            `after-wait=${_perf.slabDiscoveryWait.resolvedAfterWait}, ` +
            `timed-out=${_perf.slabDiscoveryWait.timedOut}, ` +
            `maxWait=${Math.round(_perf.slabDiscoveryWait.maxWaitMs)}ms`
        );
        ui.log(
            `Image src history watches: ${_perf.imageSrcHistory.watches.length}, ` +
            `multi-value=${_perf.imageSrcHistory.watches.filter(w => w.values.length > 1).length} ` +
            `(>1 distinct value seen — full sequence in the exported diagnostics)`
        );
        ui.log(
            `Filtered direct-stack items: allowlisted=${_perf.slabFiltering.allowlisted}, ` +
            `unlisted-reported=${_perf.slabFiltering.unlisted}, ` +
            `rules=${FILTERED_SLAB_RULES.map(rule => rule.name).join(', ') || '(none)'}` +
            (_perf.slabFiltering.unlisted > 0
                ? ` — inspect exported diagnostics for exact elements`
                : '')
        );
        ui.log(
            `Intermediate deck advances: ${_perf.intermediateDeckAdvances}`
        );
        ui.log(
            `Work-zone room shortfall (fatal on the unclamped path, see stop reason if >0): ${_perf.workZoneRoomShortfall.count}`
        );
        ui.log(
            `Work-zone jump pacing: jumps=${_perf.workZoneJumpStability.jumps}, stability-checks=${_perf.workZoneJumpStability.steps}, waited=${_perf.workZoneJumpStability.waitedFrames}, ` +
            `capped-out=${_perf.workZoneJumpStability.timedOut}, maxFramesWaited=${_perf.workZoneJumpStability.maxFramesWaited}, ` +
            `avgJump=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.jumpPxSum / _perf.workZoneJumpStability.jumps) : 0}px, ` +
            `avgJumpTime=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.jumpMsSum / _perf.workZoneJumpStability.jumps) : 0}ms, ` +
            `avgTimePer120px=${_perf.workZoneJumpStability.jumpPxSum ? Math.round(_perf.workZoneJumpStability.jumpMsSum / (_perf.workZoneJumpStability.jumpPxSum / 120)) : 0}ms, ` +
            `maxJump=${_perf.workZoneJumpStability.maxJumpPx}px, maxCalibratedJump=${_perf.workZoneJumpStability.maxCalibratedJumpPx}px, ` +
            `jumpsAtMax=${_perf.workZoneJumpStability.jumpsAtMax}, targetClamped=${_perf.workZoneJumpStability.targetClampedJumps}, ` +
            `subMinTargetClamps=${_perf.workZoneJumpStability.subMinTargetClamps}, ` +
            `adaptiveIncreases=${_perf.workZoneJumpStability.adaptiveIncreases}, adaptiveResets=${_perf.workZoneJumpStability.adaptiveResets}, ` +
            `scrollAssignments=${_perf.viewportMovesWorkZone + _perf.viewportMovesForceEdge}`
        );
        ui.log(
            `Pure-timeout hidden-tab retries: retries=${_perf.workZoneJumpStability.pureTimeoutHiddenRetries}, ` +
            `exhausted-and-still-failed=${_perf.workZoneJumpStability.pureTimeoutHiddenExhausted}`
        );
        ui.log(
            `Room drift during wait: avgAbs=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.roomDriftAbsSum / _perf.workZoneJumpStability.jumps) : 0}px, ` +
            `netSum=${Math.round(_perf.workZoneJumpStability.roomDriftSum)}px, maxAbs=${Math.round(_perf.workZoneJumpStability.roomDriftMaxAbs)}px`
        );
        ui.log(
            `Sandwiched-empty-slab readiness failure signal: seen=${_perf.workZoneJumpStability.sandwichedEmptySeen}, ` +
            `capped-out-while-present=${_perf.workZoneJumpStability.sandwichedEmptyTimedOut}`
        );
        if (_perf.workZoneJumpStability.sandwichedEmptySeen > 0) {
            ui.log(
                `⚠ SANDWICHED EMPTY SLAB DETECTED — browser/layout stability was not enough to prove ChatGPT-level readiness; ` +
                `the jump + stability approach needs a readiness patch.`
            );
        }
        ui.log(
            `Container coverage: ${_perf.containerCoverage.checks} checked, ${_perf.containerCoverage.gaps} gap(s), ` +
            `${_perf.containerCoverage.zeroSlabDecks} zero-slab deck(s) (placeholder inserted, not fatal — see exported diagnostics)`
        );
        ui.log(
            `Slab adjacency: checked=${_perf.slabAdjacency.checked}, ` +
            `maxGap=${Math.round(_perf.slabAdjacency.maxGap)}px, ` +
            `maxOverlap=${Math.round(_perf.slabAdjacency.maxOverlap)}px, ` +
            `violations=${_perf.slabAdjacency.violations}`
        );
        if (_perf.readyContainerModel.exampleMsgIds.length > 0) {
            const infoByMsgId = new Map();
            let previousUserMsgId = null;
            allPrompts.forEach((p, i) => {
                if (p.msgId && !infoByMsgId.has(p.msgId)) {
                    infoByMsgId.set(p.msgId, {
                        rank: i + 1,
                        role: p.role,
                        previousUserMsgId,
                    });
                }
                if (p.role === 'user' && p.msgId) previousUserMsgId = p.msgId;
            });
            ui.log(
                'Ready-container model ranks: ' +
                _perf.readyContainerModel.exampleMsgIds.slice(0, 5).map(({ label, msgId }) => {
                    const info = infoByMsgId.get(msgId);
                    return info
                        ? `${label}=#${info.rank}/${info.role}/prevUser:${info.previousUserMsgId ? `msg-${info.previousUserMsgId}` : 'none'}`
                        : `${label}=?`;
                }).join(', ')
            );
        }
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
            innerText: 'ChatGPT Extractor v4.159',
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
        const containersEl = Object.assign(document.createElement('div'), { innerText: 'Containers advanced : —' });
        const viewportsEl = Object.assign(document.createElement('div'), { innerText: 'Viewport moves : —' });
        const currentJumpEl = Object.assign(document.createElement('div'), {
            innerText: `${WORK_ZONE_MOVE_JUMP_PX}px jumps : —`,
        });
        const clampedJumpEl = Object.assign(document.createElement('div'), { innerText: 'Clamped jumps : —' });
        Object.assign(clampedJumpEl.style, {
            borderRadius: '4px',
            padding: '1px 4px',
            marginLeft: '-4px',
            marginRight: '-4px',
        });
        const jumpsEl = Object.assign(document.createElement('div'), { innerText: 'Total jumps : —' });
        statusEl.append(elapsedEl, promptsEl, msgsEl, containersEl, viewportsEl, currentJumpEl, clampedJumpEl, jumpsEl);

        const note = Object.assign(document.createElement('div'), {
            innerText: `Scroll to the ${WALK_DIRECTION === -1 ? 'BOTTOM' : 'TOP'} of the chat before starting.`,
        });
        Object.assign(note.style, {
            marginTop: '10px',
            color: '#f9e2af',
            fontSize: '13px',
            lineHeight: '1.35',
        });

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
        body.append(statusEl, diagRow, note, btnRow);

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
            get includeDiag() { return diagCheck.checked; },
            isAutoStart: _autoStartOnce,
            status(promptCount, msgCount, containerCount, viewportCount, jumpCount = _perf.workZoneJumpStability.jumps) {
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
                const avgJumpPx = jumpCount ? Math.round(_perf.workZoneJumpStability.jumpPxSum / jumpCount) : 0;
                const calibratedJumpStats =
                    `${_perf.workZoneJumpStability.calibratedJumpCurrentJumps} jumps / ` +
                    `${_perf.workZoneJumpStability.calibratedJumpCurrentMoves} moves`;
                const clampedJumpStats = _perf.workZoneJumpStability.targetClampedJumps === 0
                    ? '—'
                    : `Avg ${Math.round(_perf.workZoneJumpStability.targetClampedJumpPxSum / _perf.workZoneJumpStability.targetClampedJumps)}px / ` +
                      `${_perf.workZoneJumpStability.targetClampedJumps} total`;
                currentJumpEl.innerText = `${_workZoneAdaptiveJumpPx}px jumps : ${calibratedJumpStats}`;
                clampedJumpEl.innerText = `Clamped jumps : ${clampedJumpStats}`;
                clampedJumpEl.style.background =
                    _perf.workZoneJumpStability.targetClampedJumps === 0
                        ? 'transparent'
                        : 'rgba(137, 180, 250, 0.14)';
                jumpsEl.innerText      = `Total jumps : ${jumpCount} (Avg: ${avgJumpPx}px/jump)`;
                updateElapsed();
                console.log(`[Extractor] STATUS: prompts ${fmt(promptCount)} | msgs ${msgCount} | ` +
                    `containers ${containerCount} | viewport moves ${viewportCount} | ` +
                    `jumps ${_workZoneAdaptiveJumpPx}px: ${calibratedJumpStats} | ` +
                    `clamped jumps ${clampedJumpStats} | total jumps ${jumpCount} (Avg: ${avgJumpPx}px/jump)`);
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

        btn.onclick = async () => {
            let resumeState = _resumeState;
            _resumeState = null;
            _pendingAutoRestart = false;
            showRunningState();
            try {
                do {
                    await run(ui, stopBtn, resumeState);
                    resumeState = _resumeState;
                    _resumeState = null;
                } while (!ui.stopped && (resumeState || _pendingAutoRestart));
                showIdleState(resumeState ? 'Resume from current' : 'Restart',
                    ui.stopped || !!_savedState?.stopReason || !!resumeState);
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
                // that survive the same containment check findNextDeck uses
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
