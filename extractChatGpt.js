// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      4.161
// @description  Extracts a full ChatGPT conversation to Markdown via automated scrolling.
// @author       Claude
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  // src/ui/listeners/auto-start.js
  function attachAutoStartListener({
    enabled,
    panel,
    startButton,
    sleep,
    getNavMenuItems
  }) {
    if (!enabled) return;
    console.log("[Extractor] auto-start: polling for nav items...");
    (async () => {
      const deadline = Date.now() + 3e4;
      while (getNavMenuItems().length === 0 && Date.now() < deadline) {
        await sleep(100);
      }
      const found = getNavMenuItems().length;
      console.log("[Extractor] auto-start: nav items found =", found, "- clicking Start Extraction:", found > 0);
      if (found === 0) return;
      panel.style.display = "";
      startButton.click();
    })();
  }

  // src/ui/listeners/export.js
  function attachExportListener({
    button,
    ui,
    getSavedState,
    exportMarkdown,
    countPrompts
  }) {
    button.onclick = async () => {
      const savedState = getSavedState();
      if (!savedState) return;
      button.disabled = true;
      button.innerText = "Exporting...";
      await exportMarkdown(ui, savedState.allPrompts, ui.includeDiag, savedState.stopped, savedState.timestamp, savedState.stopReason);
      const count = countPrompts(savedState.allPrompts);
      ui.log(`Exported ${count} prompts (${savedState.allPrompts.length} msgs).`);
      button.disabled = false;
      button.innerText = "Export again";
    };
  }

  // src/ui/listeners/start-extraction.js
  function attachStartExtractionListener({
    button,
    stopButton,
    ui,
    showRunningState,
    showIdleState,
    run,
    getResumeState,
    setResumeState,
    getPendingAutoRestart,
    setPendingAutoRestart,
    getSavedState,
    incrementAutoResumeCount
  }) {
    button.onclick = async () => {
      let resumeState = getResumeState();
      setResumeState(null);
      setPendingAutoRestart(false);
      showRunningState();
      try {
        let autoResumeCount = 0;
        let runPass = 0;
        do {
          if (resumeState && runPass > 0) {
            const count = incrementAutoResumeCount();
            ui.log(`Auto-resuming from current cursor (${count}).`);
          }
          await run(ui, stopButton, resumeState);
          runPass++;
          resumeState = getResumeState();
          setResumeState(null);
          if (resumeState) autoResumeCount++;
        } while (!ui.stopped && (getPendingAutoRestart() || resumeState && autoResumeCount <= 1));
        const savedState = getSavedState();
        showIdleState(
          resumeState ? "Resume from current" : "Restart",
          ui.stopped || !!savedState?.stopReason || !!resumeState
        );
      } catch (err) {
        stopButton.style.display = "none";
        ui.log(`ERROR: ${err.message}`);
        showIdleState("Retry", true);
        Object.assign(button.style, { background: "#f38ba8", color: "#11111b" });
      }
    };
  }

  // src/app/extractor-app.js
  function installExtractorApp() {
    "use strict";
    const sleep = (ms) => new Promise((r) => {
      const t0 = performance.now();
      setTimeout(() => {
        const slip = performance.now() - t0 - ms;
        _perf.sleepSlip.count++;
        _perf.sleepSlip.sum += slip;
        if (slip > _perf.sleepSlip.max) _perf.sleepSlip.max = slip;
        r();
      }, ms);
    });
    const nextAnimationFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
    let _perf = {};
    function _resetPerf() {
      _perf = {
        htmlToMarkdownCalls: 0,
        htmlToMarkdownMs: 0,
        snapshots: [],
        runStartMs: 0,
        containerTag: "",
        containerScrollH: 0,
        containerClientH: 0,
        containerIsDocEl: false,
        navItemCount: 0,
        navClickedIndex: -1,
        navClickScrollTop: 0,
        navClickScrollPct: 0,
        navFirstLabel: "",
        navLastLabel: "",
        navDiversionAttempted: false,
        navDiversionSettled: false,
        bootstrapRole: "",
        bootstrapWasIntersectingFalse: false,
        maxAdvancesWithoutProgress: 0,
        turnIdDedupSkips: 0,
        turnIdDedupMaxRun: 0,
        multiCandidatesInReadyContainer: 0,
        multiCandidatesMax: 0,
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
          exampleMsgIds: []
        },
        readyMargin: { count: 0, sum: 0, max: 0, maxWinner: null },
        containerReach: { count: 0, sum: 0, max: 0, maxWinner: null },
        sleepSlip: { count: 0, sum: 0, max: 0 },
        tabHidden: { wasHidden: false, hideCount: 0 },
        expectedUserPrompts: 0,
        contentChangedAfterExtraction: { count: 0, examples: [] },
        postReadyMutations: { count: 0, examples: [] },
        preReadyMutations: {
          count: 0,
          examples: [],
          containersWithAny: 0,
          readyDelayMs: { count: 0, sum: 0, max: 0 }
        },
        discoverySnapshot: {
          totalContainers: 0,
          alreadyHadMessageAtDiscovery: 0,
          alreadyHadNonEmptyTextAtDiscovery: 0,
          textAtDiscoveryWhileNotIntersecting: 0,
          alreadyHadImageAtDiscovery: 0,
          imageAtDiscoveryWhileNotIntersecting: 0,
          diffExamples: []
        },
        compositeFingerprint: {
          candidates: 0,
          matchedFinalText: 0,
          mismatchedFinalText: 0,
          matchedFirst: 0,
          mismatchedFirst: 0,
          matchedLater: 0,
          mismatchedLater: 0,
          // The join: of the candidates whose container's own readiness
          // flag (data-is-intersecting) was still 'false' at the exact
          // moment this candidate registered, how many matched anyway?
          // This is the direct evidence for "content existing despite
          // the flag still saying not-ready is safely sufficient for
          // readiness" — not inferred from two separate aggregate
          // counts that were never actually joined before this.
          matchedWhileNotIntersecting: 0,
          mismatchedWhileNotIntersecting: 0,
          fieldExercised: { codeBlocks: 0, images: 0, tables: 0, placeholders: 0 },
          imageCandidateDetails: [],
          examples: []
        },
        maxContainerGap: 0,
        containerGapViolations: 0,
        containerGapSkippedDetached: 0,
        slabAdjacency: { checked: 0, maxGap: 0, maxOverlap: 0, violations: 0 },
        viewportMovesWorkZone: 0,
        viewportMovesForceEdge: 0,
        viewportMoveOperationsWorkZone: 0,
        viewportMoveOperationsForceEdge: 0,
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
          examples: []
        },
        intermediateDeckAdvances: 0,
        lifecycle: {
          autoResumesFromCurrent: 0
        },
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
          jumps: 0,
          steps: 0,
          waitedFrames: 0,
          timedOut: 0,
          maxFramesWaited: 0,
          maxJumpPx: 0,
          maxCalibratedJumpPx: 0,
          targetClampedJumps: 0,
          lastTargetClampedJumpPx: null,
          lastTargetClampedJumpRank: null,
          calibratedJumpCurrentJumps: 0,
          calibratedJumpCurrentMoves: 0,
          calibratedJumpMoveSequence: 0,
          calibratedJumpCurrentLastMoveSequence: null,
          requestedJumpBuckets: {},
          targetClampedJumpPxSum: 0,
          jumpPxSum: 0,
          jumpMsSum: 0,
          jumpsAtMax: 0,
          adaptiveIncreases: 0,
          adaptiveResets: 0,
          // How often the final target clamp was smaller than the old
          // anti-near-hang floor. Informational only: the clamp now
          // honors the target exactly instead of overshooting it.
          subMinTargetClamps: 0,
          sandwichedEmptySeen: 0,
          sandwichedEmptyTimedOut: 0,
          sandwichedEmptyExamples: [],
          // See WORK_ZONE_JUMP_HIDDEN_RETRY_MS's comment: a "pure"
          // timeout (no sawSandwiched, no detached) that happened
          // while the tab was hidden gets one retry with a much
          // longer deadline, since live evidence points to tab-
          // backgrounding-induced requestAnimationFrame starvation
          // rather than a real failure. pureTimeoutHiddenRetries
          // counts every such retry across the whole run;
          // pureTimeoutHiddenExhausted counts how many times even
          // the extended wait still failed.
          pureTimeoutHiddenRetries: 0,
          pureTimeoutHiddenExhausted: 0,
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
          roomDriftSum: 0,
          roomDriftAbsSum: 0,
          roomDriftMaxAbs: 0,
          roomDriftLog: [],
          // See WORK_ZONE_JUMP_SNAPSHOT_CAP — counts jumps that got
          // the full current+precedent+subsequent outerHTML capture,
          // so the cap can actually stop new ones once reached.
          fullSnapshotCount: 0
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
        containerCoverage: { checks: 0, gaps: 0, examples: [], zeroSlabDecks: 0, zeroSlabDeckExamples: [] }
      };
    }
    _resetPerf();
    let _savedState = null;
    let _resumeState = null;
    let _pendingAutoRestart = false;
    let _runTimestamp = null;
    function findScrollContainer() {
      const messageEl = document.querySelector("[data-message-author-role]");
      if (messageEl) {
        let el = messageEl.parentElement;
        while (el && el !== document.body) {
          const { overflowY } = getComputedStyle(el);
          if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
            return el;
          }
          el = el.parentElement;
        }
      }
      return document.documentElement;
    }
    function countPrompts(prompts) {
      return prompts.filter((pr) => pr.role === "user").length;
    }
    function formatUserMsgSummary(count, total) {
      return total ? `${count}/${total} (${Math.round(count * 100 / total)}%)` : `${count}`;
    }
    function rememberExpectedUserPrompts(total) {
      if (total > 0) {
        _perf.expectedUserPrompts = Math.max(_perf.expectedUserPrompts || 0, total);
      }
      return _perf.expectedUserPrompts || 0;
    }
    let _pendingImageDownloads = [];
    let _imageCounter = 0;
    let _pendingCanvasDownloads = [];
    let _canvasCounter = 0;
    let _htmlCaptures = [];
    const KNOWN_PERMANENTLY_BROKEN_TURN_IDS = ["70e7d42f-42df-4fa6-8c41-fb72b4aee15f"];
    let _knownUnresolvableSandwichedTurnIds = new Set(KNOWN_PERMANENTLY_BROKEN_TURN_IDS);
    let _reportedAllowlistedSlabItems = /* @__PURE__ */ new WeakSet();
    let _reportedUnlistedSlabItems = /* @__PURE__ */ new WeakSet();
    let _watchedImageSrcHistory = /* @__PURE__ */ new WeakSet();
    let _watchedIntersectingHistory = /* @__PURE__ */ new WeakSet();
    function totalViewportMoves() {
      return _perf.viewportMoveOperationsWorkZone + _perf.viewportMoveOperationsForceEdge;
    }
    const escLabel = (s) => s.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
    const escUrl = (s) => s.replace(/>/g, "%3E");
    const escHtmlAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escHtmlText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    function htmlToMarkdown(el) {
      function walk(node, listDepth) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          if (!text.includes("\n")) return text;
          const ws = node.parentElement ? getComputedStyle(node.parentElement).whiteSpace : "";
          if (ws === "pre" || ws === "pre-wrap" || ws === "pre-line") {
            return text.replace(/^/gm, "    ");
          }
          if (/^\s*$/.test(text)) return "";
          return text.replace(/\n/g, " ");
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        if (node.getAttribute("aria-hidden") === "true") return "";
        if (/\bsr-only\b/.test(node.getAttribute("class") || "")) return "";
        if (node.getAttribute("data-is-code-block-view") === "true") {
          const extractLine = (n) => {
            if (n.nodeType === Node.TEXT_NODE) return n.textContent;
            if (n.tagName?.toLowerCase() === "br") return "";
            return [...n.childNodes].map(extractLine).join("");
          };
          const lines = [...node.querySelectorAll(".cm-line")].map(extractLine);
          const text = lines.join("\n").trimEnd();
          const maxRun = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
          const fence = "`".repeat(maxRun + 1);
          return `
${fence}
${text}
${fence}

`;
        }
        const tag = node.tagName.toLowerCase();
        switch (tag) {
          case "script":
          case "style":
          case "noscript":
            return "";
          case "br":
            return "\n";
          case "hr":
            return "\n---\n\n";
          case "p":
            return walkChildren(node, listDepth).trim() + "\n\n";
          case "strong":
          case "b": {
            const inner = walkChildren(node, listDepth).trim();
            return inner ? `**${inner}**` : "";
          }
          case "em":
          case "i": {
            const inner = walkChildren(node, listDepth).trim();
            return inner ? `*${inner}*` : "";
          }
          case "del":
          case "s": {
            const inner = walkChildren(node, listDepth).trim();
            return inner ? `~~${inner}~~` : "";
          }
          case "code": {
            if (node.closest("pre")) return node.textContent;
            const t = node.textContent;
            const maxRun = Math.max(0, ...[...t.matchAll(/`+/g)].map((m) => m[0].length));
            const fence = "`".repeat(maxRun + 1);
            const pad = t.startsWith("`") || t.endsWith("`") ? " " : "";
            return `${fence}${pad}${t}${pad}${fence}`;
          }
          case "pre": {
            const codeEl = node.querySelector("code");
            const lang = (codeEl?.className || "").match(/language-(\S+)/)?.[1] || "";
            const extractCode = (n) => {
              if (n.nodeType === Node.TEXT_NODE) return n.textContent;
              if (n.tagName?.toLowerCase() === "br") return "\n";
              return [...n.childNodes].map(extractCode).join("");
            };
            const text = extractCode(codeEl ?? node).trimEnd();
            const maxRun = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
            const fence = "`".repeat(maxRun + 1);
            return `
${fence}${lang}
${text}
${fence}

`;
          }
          case "blockquote": {
            const inner = walkChildren(node, listDepth).trim();
            return inner.split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
          }
          case "ul":
            return walkList(node, listDepth, false);
          case "ol":
            return walkList(node, listDepth, true);
          case "h1":
            return `# ${walkChildren(node, listDepth).trim()}

`;
          case "h2":
            return `## ${walkChildren(node, listDepth).trim()}

`;
          case "h3":
            return `### ${walkChildren(node, listDepth).trim()}

`;
          case "h4":
            return `#### ${walkChildren(node, listDepth).trim()}

`;
          case "h5":
            return `##### ${walkChildren(node, listDepth).trim()}

`;
          case "h6":
            return `###### ${walkChildren(node, listDepth).trim()}

`;
          case "a": {
            if (node.innerText.trim().endsWith("\u2026")) return "";
            const href = node.getAttribute("href") || "";
            if (/^(#|javascript:|blob:)/i.test(href)) return "";
            const inner = walkChildren(node, listDepth);
            return href ? `[${escLabel(inner)}](<${escUrl(href)}>)` : inner;
          }
          case "img": {
            const alt = node.getAttribute("alt") || "";
            const src = node.getAttribute("src") || "";
            if (!src) return alt ? `[image: ${escLabel(alt)}]` : "[image]";
            const token = `__IMG_PLACEHOLDER_${++_imageCounter}__`;
            _pendingImageDownloads.push({ url: src, token });
            const rect = node.getBoundingClientRect();
            const w = Math.round(rect.width), h = Math.round(rect.height);
            const dims = w > 0 && h > 0 ? ` width="${w}" height="${h}"` : "";
            return `<a href="${token}" target="_blank" rel="noopener"><img src="${token}" alt="${escHtmlAttr(alt)}"${dims}></a>`;
          }
          case "button": {
            const ariaLabel = node.getAttribute("aria-label");
            if (ariaLabel && /\.\w{2,6}$/.test(ariaLabel.trim())) {
              return `
Upload: ${ariaLabel.trim()}

`;
            }
            const text = node.innerText.trim();
            if (/\.\w{2,6}(?:\s*[A-Za-z]+)?$/.test(text)) {
              const clean = text.replace(/(\.\w{2,6})\s*[A-Za-z]+$/, "$1").replace(/[\r\n]+/g, "");
              return `
Upload: ${clean.trim()}

`;
            }
            return "";
          }
          case "table":
            return tableToMd(node) + "\n\n";
          default: {
            const tileLabel = node.getAttribute && node.getAttribute("aria-label");
            if (node.getAttribute && node.getAttribute("role") === "group" && tileLabel && /\.\w{2,6}$/.test(tileLabel.trim())) {
              return `
Upload: ${tileLabel.trim()}

`;
            }
            return walkChildren(node, listDepth);
          }
        }
      }
      function walkChildren(node, listDepth) {
        return [...node.childNodes].map((c) => walk(c, listDepth)).join("");
      }
      function walkList(listEl, listDepth, ordered) {
        const indent = "  ".repeat(listDepth);
        let counter = 1;
        let out = "";
        for (const child of listEl.childNodes) {
          if (child.nodeType !== Node.ELEMENT_NODE || child.tagName.toLowerCase() !== "li") continue;
          let inline = "";
          let nested = "";
          const firstElem = [...child.childNodes].find((n) => n.nodeType === Node.ELEMENT_NODE);
          if (firstElem && /^h[1-6]$/.test(firstElem.tagName.toLowerCase())) {
            out += walkChildren(child, listDepth);
            counter++;
            continue;
          }
          for (const c of child.childNodes) {
            const t = c.nodeType === Node.ELEMENT_NODE ? c.tagName.toLowerCase() : "";
            if (t === "ul" || t === "ol") nested += walk(c, listDepth + 1);
            else inline += walk(c, listDepth + 1);
          }
          const bullet = ordered ? `${counter++}.` : "-";
          out += `${indent}${bullet} ${inline.trim()}`;
          if (nested.trim()) out += "\n" + nested.trimEnd();
          out += "\n";
        }
        return out + "\n";
      }
      function tableToMd(table) {
        const rows = [...table.querySelectorAll("tr")];
        if (!rows.length) return "";
        const toCell = (c) => walk(c, 0).trim().replace(/\|/g, "\\|").replace(/\n/g, " ");
        const cells = rows.map((r) => [...r.querySelectorAll("th,td")].map(toCell));
        if (!cells[0]?.length) return "";
        const header = `| ${cells[0].join(" | ")} |`;
        const sep = `| ${cells[0].map(() => "---").join(" | ")} |`;
        const body = cells.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n");
        return [header, sep, ...body ? [body] : []].join("\n");
      }
      _perf.htmlToMarkdownCalls++;
      const _t0 = performance.now();
      const _result = walk(el, 0).trim().replace(/\n{3,}/g, "\n\n").replace(
        /^([^\s/]+\.\w{2,6})\s*(?:File|Image|Document|Spreadsheet|Presentation|[A-Z]{2,6})$/gm,
        (_match, filename) => `Upload: ${filename}`
      ).replace(/\n{3,}/g, "\n\n");
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
    function getChatTitle() {
      return document.title.replace(/\s*[|–—-]\s*ChatGPT\s*$/i, "").trim() || "chat";
    }
    function titleToSlug(title) {
      return title.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    }
    function hoistUploads(text) {
      const uploads = [];
      const body = text.replace(/\nUpload:([^\n]+)/g, (_m, name) => {
        uploads.push(`Upload:${name}`);
        return "";
      });
      if (!uploads.length) return text;
      return uploads.join("\n") + "\n\n" + body.replace(/^\n+/, "").trimStart();
    }
    async function exportMarkdown(ui, prompts, includeDiag = false, stopped = false, exportTimestamp = Date.now(), stopReason = null) {
      const questions = countPrompts(prompts);
      const date = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19) + " UTC";
      const title = getChatTitle();
      const promptDots = getNavMenuItems();
      let md = `# ${title}
_${questions} user prompts \u2014 ${date}_

`;
      const userPrompts = prompts.filter((pr) => pr.role === "user");
      if (userPrompts.length > 0) {
        md += `### Table of Contents

`;
        userPrompts.forEach((pr, i) => {
          const firstLine = (pr.plainText || pr.text).split("\n").map((l) => l.replace(/[^\x20-\x7E]/g, "").trim()).filter((l) => l && !l.startsWith("Upload:"))[0] || "(empty)";
          const label = escLabel(firstLine.slice(0, 80));
          md += pr.msgId ? `${i + 1}. [${label}](#msg-${pr.msgId})
` : `${i + 1}. ${label}
`;
        });
        md += "\n";
      }
      md += `---

`;
      for (const pr of prompts) {
        const label = pr.role === "user" ? "### USER" : pr.role === "assistant" ? "### ASSISTANT" : "### UNKNOWN";
        const text = pr.role === "user" ? hoistUploads(pr.text) : pr.text;
        const anchor = pr.role === "user" && pr.msgId ? `<a id="msg-${pr.msgId}"></a>

` : "";
        md += `${anchor}${label}

${text}

---

`;
      }
      if (includeDiag && _perf.runStartMs > 0) {
        const _ms = performance.now() - _perf.runStartMs;
        const _sleep = _ms - _perf.htmlToMarkdownMs;
        const promptDots2 = getNavMenuItems();
        const expected = rememberExpectedUserPrompts(promptDots2.length);
        const exported = countPrompts(prompts);
        const tocStatus = expected === 0 ? "not visible" : expected === exported ? "OK" : "MISMATCH";
        const userMsgSummary = formatUserMsgSummary(exported, expected);
        const issueLines = [];
        if (tocStatus === "MISMATCH") issueLines.push(`toc-mismatch=${exported}/${expected}`);
        if (_perf.extractionFailures.count > 0) issueLines.push(`extraction-empty=${_perf.extractionFailures.count}`);
        if (_perf.containerCoverage.gaps > 0) issueLines.push(`coverage-gaps=${_perf.containerCoverage.gaps}`);
        if (_perf.containerCoverage.zeroSlabDecks > 0) issueLines.push(`zero-slab-decks=${_perf.containerCoverage.zeroSlabDecks}`);
        if (_perf.slabFiltering.unlisted > 0) issueLines.push(`unlisted-stack-items=${_perf.slabFiltering.unlisted}`);
        if (_perf.readyContainerModel.unknownSlabItems > 0) issueLines.push(`unknown-slab-items=${_perf.readyContainerModel.unknownSlabItems}`);
        if (_perf.workZoneJumpStability.sandwichedEmptySeen > 0) {
          issueLines.push(`SANDWICHED-EMPTY-SLAB=${_perf.workZoneJumpStability.sandwichedEmptySeen}`);
        }
        const sandwichedWarning = _perf.workZoneJumpStability.sandwichedEmptySeen > 0 ? `    \u26A0 SANDWICHED EMPTY SLAB DETECTED: a deck with no selectable slab was visible between neighboring real-slab decks during work-zone stepping. This means browser/layout stability alone did not prove ChatGPT-level slab readiness; the jump + stability approach needs a readiness patch.
` : "";
        md += `    \u2500\u2500 perf (v4.161) \u2500\u2500
    total ${(_ms / 1e3).toFixed(1)}s | sleep/wait ${(_sleep / 1e3).toFixed(1)}s (${Math.round(100 * _sleep / _ms)}%)
    htmlToMarkdown: ${_perf.htmlToMarkdownCalls} calls, ${Math.round(_perf.htmlToMarkdownMs)}ms
    User msgs: ${userMsgSummary}
    Exported ${exported}${expected ? `/${expected}` : ""} user prompts (${prompts.length} slabs/notes). TOC=${tocStatus}.
` + (stopReason ? `    Stop reason: ${stopReason}
` : "") + `    Lifecycle: auto-resumes-from-current=${_perf.lifecycle.autoResumesFromCurrent}

    \u2500\u2500 diag (v4.161) \u2500\u2500
    Missing-slab signals: ${issueLines.length ? issueLines.join(", ") : "none"}
` + sandwichedWarning + `    Slab discovery wait: checked=${_perf.slabDiscoveryWait.waited}, already=${_perf.slabDiscoveryWait.alreadyReady}, after-wait=${_perf.slabDiscoveryWait.resolvedAfterWait}, timed-out=${_perf.slabDiscoveryWait.timedOut}, maxWait=${Math.round(_perf.slabDiscoveryWait.maxWaitMs)}ms
    Non-message slabs: images extracted=${_perf.imageOnlyTurns.extracted}, canvas extracted=${_perf.canvasBlocks.extracted}, canvas markdown-empty=${_perf.canvasBlocks.markdownEmpty}
    Geometry/model: deck-gap-violations=${_perf.containerGapViolations}, container-coverage-gaps=${_perf.containerCoverage.gaps}, slab-adjacency-violations=${_perf.slabAdjacency.violations}, model message-gaps=${_perf.readyContainerModel.messageGapViolations}, unknown slab items=${_perf.readyContainerModel.unknownSlabItems}
    Work-zone room shortfall (fatal on the unclamped path, see stop reason if >0): ${_perf.workZoneRoomShortfall.count}` + (_perf.workZoneRoomShortfall.examples.length ? `
      ${_perf.workZoneRoomShortfall.examples.join("\n      ")}` : "") + `
    Work-zone jump pacing: jumps=${_perf.workZoneJumpStability.jumps}, stability-checks=${_perf.workZoneJumpStability.steps}, waited=${_perf.workZoneJumpStability.waitedFrames}, capped-out=${_perf.workZoneJumpStability.timedOut}, maxFramesWaited=${_perf.workZoneJumpStability.maxFramesWaited}, avgJump=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.jumpPxSum / _perf.workZoneJumpStability.jumps) : 0}px, avgJumpTime=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.jumpMsSum / _perf.workZoneJumpStability.jumps) : 0}ms, avgTimePer120px=${_perf.workZoneJumpStability.jumpPxSum ? Math.round(_perf.workZoneJumpStability.jumpMsSum / (_perf.workZoneJumpStability.jumpPxSum / 120)) : 0}ms, maxJump=${_perf.workZoneJumpStability.maxJumpPx}px, maxCalibratedJump=${_perf.workZoneJumpStability.maxCalibratedJumpPx}px, jumpsAtMax=${_perf.workZoneJumpStability.jumpsAtMax}, targetClamped=${_perf.workZoneJumpStability.targetClampedJumps}, subMinTargetClamps=${_perf.workZoneJumpStability.subMinTargetClamps}, adaptiveIncreases=${_perf.workZoneJumpStability.adaptiveIncreases}, adaptiveResets=${_perf.workZoneJumpStability.adaptiveResets}, scrollAssignments=${_perf.viewportMovesWorkZone + _perf.viewportMovesForceEdge}
    Requested jump sizes: ${formatRequestedJumpBuckets()}
    Clamped jumps: ${_perf.workZoneJumpStability.targetClampedJumps} total (avg ${_perf.workZoneJumpStability.targetClampedJumps ? Math.round(_perf.workZoneJumpStability.targetClampedJumpPxSum / _perf.workZoneJumpStability.targetClampedJumps) : 0}px)
    Pure-timeout hidden-tab retries (see WORK_ZONE_JUMP_HIDDEN_RETRY_MS \u2014 timed out, not sandwiched, not detached, tab was hidden during the wait): retries=${_perf.workZoneJumpStability.pureTimeoutHiddenRetries}, exhausted-and-still-failed=${_perf.workZoneJumpStability.pureTimeoutHiddenExhausted}
    Room drift during wait (does an already-rendered slab's distance from the viewport edge hold steady between right-after-the-jump and after waitForLayoutStable resolves? See maintainWorkZone): avgAbs=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.roomDriftAbsSum / _perf.workZoneJumpStability.jumps) : 0}px, netSum=${Math.round(_perf.workZoneJumpStability.roomDriftSum)}px, maxAbs=${Math.round(_perf.workZoneJumpStability.roomDriftMaxAbs)}px` + (_perf.workZoneJumpStability.roomDriftLog.length ? `
      ${_perf.workZoneJumpStability.roomDriftLog.join("\n      ")}` : "") + `
    Sandwiched-empty-slab readiness failure signal (see findSandwichedEmptySlabInViewport): seen=${_perf.workZoneJumpStability.sandwichedEmptySeen}, capped-out-while-present=${_perf.workZoneJumpStability.sandwichedEmptyTimedOut}` + (_perf.workZoneJumpStability.sandwichedEmptyExamples.length ? `
      ${_perf.workZoneJumpStability.sandwichedEmptyExamples.join("\n      ")}` : "") + `
    Timer slip: samples=${_perf.sleepSlip.count}, avg=${_perf.sleepSlip.count ? Math.round(_perf.sleepSlip.sum / _perf.sleepSlip.count) : 0}ms, max=${Math.round(_perf.sleepSlip.max)}ms; tab hidden ${_perf.tabHidden.hideCount} time(s)
    Note: detailed missing slabs are inserted inline in the transcript near where they were detected.
`;
        if (_perf.snapshots.length > 0) {
          const snaps = _perf.snapshots;
          const BKPTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
          const displaySnaps = BKPTS.map((bp) => ({
            snap: snaps[Math.min(snaps.length - 1, Math.round(bp / 100 * (snaps.length - 1)))],
            bp
          }));
          const IND = "    ";
          const hdrs = ["bp", "dur", "all", "user", "cont", "view", "size", "\u2191", "\u2193"];
          const caps = [10, 18, 11, 9, 9, 9, 8, 4, 4];
          const LEFT_COLS = 6;
          const clip = (s, w) => {
            s = String(s);
            return s.length <= w ? s : s.slice(0, Math.max(0, w - 1)) + "\u2026";
          };
          const cell = (s, w, left = false) => {
            s = clip(s, w);
            return left ? s.padEnd(w) : s.padStart(w);
          };
          const border = (l, m, r, w) => IND + l + w.map((n) => "\u2500".repeat(n)).join(m) + r + "\n";
          const row = (xs, w) => IND + "\u2502" + xs.map((x, i) => cell(x, w[i], i >= 1 && i < LEFT_COLS)).join("\u2502") + "\u2502\n";
          const fQ = (q, d) => `${q}(+${d})`;
          const fT = (s, ds) => {
            const fmt = (t) => {
              const h = Math.floor(t / 3600);
              const m = Math.floor(t % 3600 / 60);
              const r = t % 60;
              if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${String(r).padStart(2, "0")}s`;
              if (m > 0) return `${m}m${String(r).padStart(2, "0")}s`;
              return `${r}s`;
            };
            return `${fmt(s)}(+${fmt(ds)})`;
          };
          const rows = [];
          for (let i = 0; i < displaySnaps.length; i++) {
            const { snap, bp } = displaySnaps[i];
            const prev = i > 0 ? displaySnaps[i - 1].snap : null;
            const cumTs = Math.round(snap.t / 1e3);
            const prevTs = prev ? Math.round(prev.t / 1e3) : 0;
            const incM = prev ? snap.m - prev.m : snap.m;
            const incQ = prev ? snap.q - prev.q : snap.q;
            const incC = prev ? snap.c - prev.c : snap.c;
            const incV = prev ? snap.v - prev.v : snap.v;
            rows.push([
              `${bp}%`,
              fT(cumTs, cumTs - prevTs),
              fQ(snap.m, incM),
              fQ(snap.q, incQ),
              fQ(snap.c, incC),
              fQ(snap.v, incV),
              String(snap.d),
              String(snap.uBefore),
              String(snap.uAfter)
            ]);
          }
          const widths = hdrs.map(
            (h, i) => Math.min(caps[i], Math.max(h.length, ...rows.map((r) => r[i].length)))
          );
          const sumWidths = (from, to) => widths.slice(from, to).reduce((a2, b) => a2 + b, 0);
          const leftSum = sumWidths(0, LEFT_COLS);
          if (leftSum < 26) widths[1] += 26 - leftSum;
          const innerW = widths.reduce((a2, b) => a2 + b, 0) + widths.length - 1;
          const spanBorder = (l, r) => IND + l + "\u2500".repeat(innerW) + r + "\n";
          const spanContent = (text) => IND + "\u2502" + clip(text.padEnd(innerW), innerW) + "\u2502\n";
          const legendItems = [
            "bp=timeline position",
            "dur=elapsed(+\u0394)",
            "all=all messages",
            "user=user messages",
            "cont=containers advanced",
            "view=viewport moves",
            "size=DOM elements",
            "\u2191=user msgs above",
            "\u2193=user msgs below"
          ];
          const colW = Math.floor(innerW / 2);
          const legendRow = (l, r) => {
            const left = clip((l || "").padEnd(colW), colW);
            const right = clip((r || "").padEnd(innerW - colW), innerW - colW);
            return IND + "\u2502" + left + right + "\u2502\n";
          };
          let out = spanBorder("\u250C", "\u2510");
          out += spanContent("Prompt discovery snapshots (\u25B2 up pass)");
          out += spanContent("");
          const half = Math.ceil(legendItems.length / 2);
          for (let i = 0; i < half; i++)
            out += legendRow(legendItems[i], legendItems[i + half]);
          out += border("\u251C", "\u252C", "\u2524", widths);
          out += row(hdrs, widths);
          out += border("\u251C", "\u253C", "\u2524", widths);
          for (let i = 0; i < rows.length; i++) {
            out += row(rows[i], widths);
          }
          out += border("\u2514", "\u2534", "\u2518", widths);
          md += out;
        }
      }
      if (_pendingImageDownloads.length > 0) {
        const slug = titleToSlug(title);
        const toFetch = _pendingImageDownloads.filter((e) => !e.filename);
        if (toFetch.length > 0) {
          ui.log(`Downloading ${toFetch.length} image(s) from this session so they'll actually render in the exported file...`);
        }
        let downloaded = 0;
        for (let i = 0; i < _pendingImageDownloads.length; i++) {
          const entry = _pendingImageDownloads[i];
          if (!entry.filename) {
            entry.filename = escHtmlAttr(entry.url);
            try {
              const resp = await fetch(entry.url, { credentials: "include" });
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              const blob = await resp.blob();
              const ext = (blob.type.split("/")[1] || "png").split(";")[0].replace("jpeg", "jpg");
              entry.filename = `${slug}-${exportTimestamp}-img-${String(i + 1).padStart(3, "0")}.${ext}`;
              const imgHref = URL.createObjectURL(blob);
              const imgA = document.createElement("a");
              imgA.href = imgHref;
              imgA.download = entry.filename;
              document.body.appendChild(imgA);
              imgA.click();
              imgA.remove();
              setTimeout(() => URL.revokeObjectURL(imgHref), 100);
              downloaded++;
              await sleep(300);
            } catch (e) {
              ui.log(`  \u26A0 image ${i + 1} download failed (${e.message}) \u2014 kept as a live URL reference instead`);
            }
          }
          md = md.split(entry.token).join(entry.filename);
        }
        if (toFetch.length > 0) {
          ui.log(`  ${downloaded}/${toFetch.length} image(s) saved alongside the .md file \u2014 same folder, same name prefix.`);
        }
      }
      if (_pendingCanvasDownloads.length > 0) {
        const slug = titleToSlug(title);
        const toSave = _pendingCanvasDownloads.filter((e) => !e.filename);
        if (toSave.length > 0) {
          ui.log(`Saving ${toSave.length} canvas/textdoc block(s) as separate .md file(s)...`);
        }
        for (let i = 0; i < _pendingCanvasDownloads.length; i++) {
          const entry = _pendingCanvasDownloads[i];
          if (!entry.filename) {
            entry.filename = `${slug}-${exportTimestamp}-canvas-${String(i + 1).padStart(3, "0")}.md`;
            const canvasHref = URL.createObjectURL(new Blob(["\uFEFF" + entry.text], { type: "text/markdown;charset=utf-8" }));
            const canvasA = document.createElement("a");
            canvasA.href = canvasHref;
            canvasA.download = entry.filename;
            document.body.appendChild(canvasA);
            canvasA.click();
            canvasA.remove();
            setTimeout(() => URL.revokeObjectURL(canvasHref), 100);
            await sleep(300);
          }
          md = md.split(entry.token).join(entry.filename);
        }
        if (toSave.length > 0) {
          ui.log(`  ${toSave.length} canvas/textdoc block(s) saved alongside the .md file \u2014 same folder, same name prefix.`);
        }
      }
      if (_htmlCaptures.length > 0) {
        const slug = titleToSlug(title);
        const sections = _htmlCaptures.map(
          (c, i) => `<h2>#${i + 1} \u2014 label=${escHtmlAttr(c.label)} role=${escHtmlAttr(c.role)} turnId=${escHtmlAttr(c.turnId)}</h2>
${c.html}
<hr>`
        ).join("\n");
        const htmlDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtmlAttr(title)} \u2014 captured deck identities</title></head><body>
<h1>${escHtmlAttr(title)} \u2014 captured deck identities (${_htmlCaptures.length})</h1>
<p>Companion to the .md export \u2014 trimmed identity markup (deck's own opening tag + first slab's opening tag, both self-closed) plus a small first-slab preview. Message previews keep only the first sentence; image/canvas previews use compact link-style placeholders.</p>
<hr>
${sections}
</body></html>`;
        const htmlA = document.createElement("a");
        htmlA.href = URL.createObjectURL(new Blob([htmlDoc], { type: "text/html;charset=utf-8" }));
        htmlA.download = `${slug}-${exportTimestamp}.html`;
        document.body.appendChild(htmlA);
        htmlA.click();
        setTimeout(() => {
          URL.revokeObjectURL(htmlA.href);
          htmlA.remove();
        }, 100);
        ui.log(`  ${_htmlCaptures.length} captured deck identity record(s) saved as a separate .html file \u2014 same folder, same name prefix.`);
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["\uFEFF" + md], { type: "text/markdown;charset=utf-8" }));
      a.download = `${titleToSlug(title)}-${exportTimestamp}.md`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 100);
    }
    function getNavMenuItems() {
      const strip = [...document.querySelectorAll("div")].find((d) => d.className.includes("w-9") && d.className.includes("max-h-[50lvh]") && d.className.includes("no-scrollbar"));
      if (strip) return [...strip.querySelectorAll("button")];
      return [...document.querySelectorAll("button")].filter((b) => b.className.includes("h-0.5") && b.className.includes("w-4.5") && b.className.includes("rounded-full"));
    }
    const WALK_DIRECTION = -1;
    const TO_COME_TIMEOUT_MS = 5e3;
    function deckSequenceId(el) {
      return el?.getAttribute?.("data-turn-id-container") || null;
    }
    function queryDeckSequenceContainers() {
      const byId = /* @__PURE__ */ new Map();
      for (const el of document.querySelectorAll("[data-turn-id-container]")) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const id = el.getAttribute("data-turn-id-container");
        const existing = byId.get(id);
        if (!existing || el.contains(existing)) byId.set(id, el);
      }
      return [...byId.values()];
    }
    function readinessElementForDeck(deckEl) {
      const id = deckSequenceId(deckEl);
      let el = deckEl;
      while (el && el !== document.body) {
        if (el.matches?.("[data-turn-id-container]") && el.hasAttribute("data-is-intersecting") && (!id || deckSequenceId(el) === id)) {
          return el;
        }
        el = el.parentElement;
      }
      return deckEl;
    }
    function findBootstrapContainer(container, direction) {
      const vb = container === document.documentElement ? { top: 0, bottom: window.innerHeight } : container.getBoundingClientRect();
      const inRange = (r) => direction === -1 ? r.bottom > vb.top && r.bottom <= vb.bottom : r.top < vb.bottom && r.top >= vb.top;
      const candidates = queryDeckSequenceContainers().filter((el) => inRange(el.getBoundingClientRect()));
      if (candidates.length === 0) return null;
      const edgeValue = (el) => {
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
    const DECK_ADJACENCY_TOLERANCE = 2;
    const SLAB_ADJACENCY_MAX_GAP = 150;
    const SLAB_ADJACENCY_OVERLAP_TOLERANCE = 2;
    function adjacencyGap(direction, olderRect, newerRect) {
      return direction === -1 ? olderRect.top - newerRect.bottom : newerRect.top - olderRect.bottom;
    }
    function checkDeckAdjacency(olderDeck, newerDeck) {
      const gap = adjacencyGap(
        WALK_DIRECTION,
        olderDeck.getBoundingClientRect(),
        newerDeck.getBoundingClientRect()
      );
      _perf.maxContainerGap = Math.max(_perf.maxContainerGap, Math.abs(gap));
      if (Math.abs(gap) <= DECK_ADJACENCY_TOLERANCE) return gap;
      _perf.containerGapViolations++;
      console.warn(
        `[Extractor] Deck adjacency diagnostic: facing edges differ by ${Math.round(gap)}px (allowed \xB1${DECK_ADJACENCY_TOLERANCE}px). Current deck=${deckSequenceId(olderDeck) || "(none)"}, next deck=${deckSequenceId(newerDeck) || "(none)"}.`
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
        `[Extractor] Slab adjacency diagnostic between ${currentSlab.type} and ${nextSlab.type}: ${gap >= 0 ? `${Math.round(gap)}px gap` : `${Math.round(-gap)}px overlap`} (allowed gap \u2264${SLAB_ADJACENCY_MAX_GAP}px, overlap \u2264${SLAB_ADJACENCY_OVERLAP_TOLERANCE}px). Current turn=${slabTurnId(currentSlab) || "(none)"} msg=${slabMessageId(currentSlab) || "(none)"}; next turn=${slabTurnId(nextSlab) || "(none)"} msg=${slabMessageId(nextSlab) || "(none)"}.`
      );
      return gap;
    }
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
    function describeMovesSinceEntry(entryDiag) {
      if (!entryDiag) return "deck-entry-diag=(unavailable)";
      const movesSince = totalViewportMoves() - entryDiag.movesAtEntry;
      const displacement = entryDiag.scrollPosNow != null && entryDiag.scrollPosAtEntry != null ? Math.round(entryDiag.scrollPosNow - entryDiag.scrollPosAtEntry) : "(unavailable)";
      return `viewport-moves-since-deck-entry=${movesSince}, scroll-displacement-since-deck-entry=${displacement}px, was-intersecting-at-entry="${entryDiag.isIntersectingAtEntry}"`;
    }
    function describeIntersectingHistory(deckEl) {
      const turnId = deckSequenceId(deckEl) || "(none)";
      const watch = _perf.intersectingHistory.watches.find((w) => w.turnId === turnId);
      if (!watch) return "data-is-intersecting-history=(not watched)";
      const sequence = watch.values.map((v) => `${v.value}@${v.atMs}ms`).join(" -> ");
      return `data-is-intersecting-history=[${sequence}]` + (watch.detachedAtMs !== null ? ` (detached at ${watch.detachedAtMs}ms)` : "") + (watch.timedOut ? " (watch timed out)" : "");
    }
    function finishDeckCoverage(deckEl, ranges, current, entryDiag = null) {
      const deckRect = deckEl.getBoundingClientRect();
      _perf.containerCoverage.checks++;
      const gaps = findContainerCoverageGaps(ranges, deckRect.height);
      if (gaps.length > 0) {
        _perf.containerCoverage.gaps++;
        const gapText = gaps.map((g) => `[${Math.round(g.from)}px\u2013${Math.round(g.to)}px]`).join(", ");
        if (_perf.containerCoverage.examples.length < 10) {
          _perf.containerCoverage.examples.push(
            `turnId=${deckSequenceId(deckEl) || "(none)"}: ${gaps.length} gap(s) \u2014 ` + gapText + ` not covered by any of the ${ranges.length} extracted slab(s)`
          );
        }
        if (ranges.length > 0) {
          return {
            role: "unknown",
            text: `*[Possible missing slab \u2014 deck coverage had ${gaps.length} uncovered gap(s): ${gapText}. turnId=${deckSequenceId(deckEl) || "unknown"}.]*

`,
            plainText: "[Possible missing slab]",
            msgId: null,
            turnId: deckSequenceId(deckEl) || null
          };
        }
      }
      if (ranges.length > 0) return null;
      const currentRect = current ? current.geometryElement.getBoundingClientRect() : null;
      const overlapping = querySelectedSlabCandidates().filter((candidate) => {
        const er = candidate.geometryElement.getBoundingClientRect();
        return Math.min(er.bottom, deckRect.bottom) - Math.max(er.top, deckRect.top) > SMALL_EXTRA;
      }).map((candidate) => {
        const er = candidate.geometryElement.getBoundingClientRect();
        const distance = currentRect ? slabDistanceAhead(currentRect, er) : void 0;
        const distanceNote = !currentRect ? "current unknown" : distance === null ? "behind current, not ahead" : `${Math.round(distance)}px ahead of current \u2014 should already have been found`;
        return `${candidate.type}/${slabRole(candidate)} rect=[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}] (${distanceNote})`;
      });
      _perf.containerCoverage.zeroSlabDecks++;
      if (_perf.containerCoverage.zeroSlabDeckExamples.length < 10) {
        _perf.containerCoverage.zeroSlabDeckExamples.push(
          `turnId=${deckSequenceId(deckEl) || "(none)"}, rect=[top=${Math.round(deckRect.top)},bottom=${Math.round(deckRect.bottom)},height=${Math.round(deckRect.height)}], current=${currentRect ? `${current.type}/${slabRole(current)} rect=[top=${Math.round(currentRect.top)},bottom=${Math.round(currentRect.bottom)}]` : "(unknown)"}, overlapping candidates: ${overlapping.length === 0 ? "(none)" : overlapping.join("; ")}, live structure:
${dumpElementStructure(deckEl)}`
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
        role: deckEl.getAttribute("data-turn") || "unknown",
        text: `*[Empty container \u2014 no slab could be detected for this turn (turnId=${deckSequenceId(deckEl) || "unknown"}). This may be a ChatGPT rendering failure or an extractor bug; see the exported diagnostics. ${describeMovesSinceEntry(entryDiag)}, ${describeIntersectingHistory(deckEl)}]*

${captureElementHtmlReference("empty-container-coverage", deckEl, deckEl.getAttribute("data-turn") || "unknown", deckSequenceId(deckEl))}

`,
        plainText: "[Empty container]",
        msgId: null,
        turnId: deckSequenceId(deckEl) || null
      };
    }
    const SMALL_EXTRA = 28;
    const MIN_ONE_LINE_MESSAGE_HEIGHT = 90;
    const EMPTY_BUBBLE_HEIGHT_CEILING = 24;
    function lastKnownHeightPx(deckEl) {
      const raw = deckEl?.style?.getPropertyValue("--last-known-height");
      if (!raw) return null;
      const value = parseFloat(raw);
      return Number.isFinite(value) ? value : null;
    }
    function findNextDeck(turnEl, direction) {
      const r = turnEl.getBoundingClientRect();
      const edge = direction === -1 ? r.top : r.bottom;
      const currentDeckId = deckSequenceId(turnEl);
      const allCandidates = queryDeckSequenceContainers().filter((el) => el !== turnEl);
      const deckCandidates = allCandidates.filter((el) => !currentDeckId || deckSequenceId(el) !== currentDeckId);
      _perf.turnIdDedupSkips += allCandidates.length - deckCandidates.length;
      for (let h = 8; h <= 400; h *= 2) {
        const candidates = deckCandidates.filter((el) => {
          const er = el.getBoundingClientRect();
          return direction === -1 ? er.bottom >= edge - h && er.top <= edge : er.top <= edge + h && er.bottom >= edge;
        });
        if (candidates.length > 0) {
          return direction === -1 ? candidates.reduce((a, b) => a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b) : candidates.reduce((a, b) => a.getBoundingClientRect().top < b.getBoundingClientRect().top ? a : b);
        }
      }
      const candidatesOnSide = deckCandidates.filter((el) => {
        const er = el.getBoundingClientRect();
        return direction === -1 ? er.bottom <= edge : er.top >= edge;
      });
      if (candidatesOnSide.length > 0) {
        return direction === -1 ? candidatesOnSide.reduce((a, b) => a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b) : candidatesOnSide.reduce((a, b) => a.getBoundingClientRect().top < b.getBoundingClientRect().top ? a : b);
      }
      return null;
    }
    function isInViewport(container, target) {
      const vTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
      const vBottom = container === document.documentElement ? window.innerHeight : container.getBoundingClientRect().bottom;
      const r = target.getBoundingClientRect();
      const edge = WALK_DIRECTION === -1 ? r.top : r.bottom;
      return edge > vTop && edge <= vBottom;
    }
    function measureReadyMargin(container, direction) {
      const vTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
      const vBottom = container === document.documentElement ? window.innerHeight : container.getBoundingClientRect().bottom;
      const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
      let margin = 0;
      let winner = null;
      for (const el of queryDeckSequenceContainers()) {
        if (!el.hasAttribute("data-is-intersecting")) continue;
        if (el.getAttribute("data-is-intersecting") === "false") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const m = direction === -1 ? vTop - r.top : r.bottom - vBottom;
        if (m > margin) {
          margin = m;
          winner = el;
        }
      }
      let winnerInfo = null;
      if (winner) {
        const r = winner.getBoundingClientRect();
        winnerInfo = {
          hadAttr: winner.hasAttribute("data-is-intersecting"),
          attrValue: winner.getAttribute("data-is-intersecting"),
          turnId: deckSequenceId(winner) || "(none)",
          rectTop: r.top,
          rectBottom: r.bottom,
          viewportTop: vTop,
          viewportBottom: vBottom
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
    const _compositeSnapshots = /* @__PURE__ */ new WeakMap();
    function summarizeMessageStructure(el, container) {
      const imageScope = imageScopeFor(el, container);
      return {
        textLen: el.innerText.length,
        childCount: el.children.length,
        rectHeight: Math.round(el.getBoundingClientRect().height),
        codeBlocks: el.querySelectorAll("pre, code").length,
        images: imageScope.querySelectorAll("img").length,
        tables: el.querySelectorAll("table").length,
        placeholders: el.querySelectorAll('[class*="skeleton"], [class*="placeholder"], [data-placeholder]').length
      };
    }
    function imageScopeFor(el, container) {
      const singleMessageContainer = container && container.querySelectorAll("[data-message-author-role]").length === 1;
      return singleMessageContainer ? container : el;
    }
    function imageSrcsFor(el, container) {
      return [...imageScopeFor(el, container).querySelectorAll("img")].map((img) => img.getAttribute("src") || "");
    }
    function canvasContentRoot(el) {
      if (!isCanvasBlock(el)) return null;
      return el.querySelector("#prosemirror-editor-container .ProseMirror");
    }
    const SLAB_FINISH_TIMEOUT_MS = 3e4;
    const SLAB_FINISH_POLL_MS = 100;
    function primaryImageForSlab(el) {
      return el.querySelector('img:not([aria-hidden="true"])');
    }
    function slabFinishFingerprint(slab, container) {
      const el = slab.element;
      if (slab.type === "canvas") {
        const contentRoot = canvasContentRoot(el);
        if (!contentRoot) {
          return {
            ready: false,
            reason: "canvas content surface missing",
            summary: summarizeMessageStructure(el, container),
            imageSrcs: []
          };
        }
        const markdown = dryMarkdownFor(contentRoot).trim();
        return {
          ready: markdown.length > 0,
          reason: markdown.length > 0 ? "ready" : "canvas content surface empty",
          summary: {
            ...summarizeMessageStructure(el, container),
            canvasMarkdownLength: markdown.length
          },
          imageSrcs: []
        };
      }
      if (slab.type === "image") {
        const image = primaryImageForSlab(el);
        const src = image?.getAttribute("src") || "";
        return {
          ready: Boolean(image && src),
          reason: !image ? "primary generated image missing" : src ? "ready" : "primary generated image without src",
          summary: summarizeMessageStructure(el, container),
          imageSrcs: src ? [src] : []
        };
      }
      const summary = summarizeMessageStructure(el, container);
      const imageSrcs = imageSrcsFor(el, container);
      const hasContent = summary.textLen > 0 || imageSrcs.length > 0;
      const imagesHaveSrc = imageSrcs.every(Boolean);
      const permanentlyEmpty = !hasContent && (() => {
        const h = lastKnownHeightPx(container);
        return h !== null && h <= EMPTY_BUBBLE_HEIGHT_CEILING;
      })();
      const ready = (hasContent || permanentlyEmpty) && summary.placeholders === 0 && imagesHaveSrc;
      const reason = permanentlyEmpty ? "ready (permanently empty by design)" : !hasContent ? "no text or image" : summary.placeholders > 0 ? `${summary.placeholders} placeholder(s)` : !imagesHaveSrc ? "image without src" : "ready";
      return { ready, reason, summary, imageSrcs };
    }
    function summarizeContainerCandidate(turnEl) {
      const msgEls = turnEl.querySelectorAll("[data-message-author-role]");
      const firstMsg = msgEls[0] || null;
      return {
        dataIsIntersecting: turnEl.getAttribute("data-is-intersecting"),
        className: turnEl.className,
        childCount: turnEl.children.length,
        rectHeight: Math.round(turnEl.getBoundingClientRect().height),
        messageElementCount: msgEls.length,
        firstMessageTextLen: firstMsg ? firstMsg.innerText.length : null,
        // Whole-container check (not the message/imageScope-level scoping
        // summarizeMessageStructure uses) — this is a coarse discovery-
        // vs-ready diagnostic, not an extraction-accuracy one, so it only
        // needs to answer "did an <img> exist anywhere in here yet."
        hasImage: turnEl.querySelectorAll("img").length > 0
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
      if (_activeLifecycleDiscoverySnapshot.firstMessageTextLen > 0) {
        _perf.discoverySnapshot.alreadyHadNonEmptyTextAtDiscovery++;
        if (_activeLifecycleDiscoverySnapshot.dataIsIntersecting === "false") _perf.discoverySnapshot.textAtDiscoveryWhileNotIntersecting++;
      }
      if (_activeLifecycleDiscoverySnapshot.hasImage) {
        _perf.discoverySnapshot.alreadyHadImageAtDiscovery++;
        if (_activeLifecycleDiscoverySnapshot.dataIsIntersecting === "false") _perf.discoverySnapshot.imageAtDiscoveryWhileNotIntersecting++;
      }
      {
        let idx = 0;
        for (const msgEl of turnEl.querySelectorAll("[data-message-author-role]")) {
          const isFirst = idx === 0;
          idx++;
          const singleMessageContainer = turnEl.querySelectorAll("[data-message-author-role]").length === 1;
          const hasImage = (singleMessageContainer ? turnEl : msgEl).querySelectorAll("img").length > 0;
          const hasContent = msgEl.innerText.length > 0 || hasImage;
          if (hasContent && !msgEl.querySelector('[class*="skeleton"], [class*="placeholder"], [data-placeholder]')) {
            _perf.compositeFingerprint.candidates++;
            _compositeSnapshots.set(msgEl, {
              ...summarizeMessageStructure(msgEl, turnEl),
              isFirst,
              discoveredAt: performance.now(),
              imageSrcs: imageSrcsFor(msgEl, turnEl),
              // Joins this candidate to the discovery-snapshot stats
              // above: was the *container's* readiness flag already
              // reporting 'false' at the exact moment this candidate
              // registered? Read from the same synchronous snapshot
              // (no time has passed), so this is the container's
              // state at this candidate's own discovery, not a
              // coincidence of when watchContainerLifecycle runs.
              containerWasNotIntersectingAtDiscovery: _activeLifecycleDiscoverySnapshot.dataIsIntersecting === "false"
            });
          }
        }
      }
      if (turnEl.querySelectorAll("[data-message-author-role]").length === 0) {
        const turnSections = turnEl.matches("[data-turn]") ? [turnEl, ...turnEl.querySelectorAll("[data-turn]")] : [...turnEl.querySelectorAll("[data-turn]")];
        for (const turnSection of turnSections) {
          const hasImage = turnSection.querySelectorAll("img").length > 0;
          const hasContent = turnSection.innerText.length > 0 || hasImage;
          if (hasContent && !turnSection.querySelector('[class*="skeleton"], [class*="placeholder"], [data-placeholder]')) {
            _perf.compositeFingerprint.candidates++;
            _compositeSnapshots.set(turnSection, {
              ...summarizeMessageStructure(turnSection, turnEl),
              isFirst: true,
              discoveredAt: performance.now(),
              imageSrcs: imageSrcsFor(turnSection, turnEl),
              containerWasNotIntersectingAtDiscovery: _activeLifecycleDiscoverySnapshot.dataIsIntersecting === "false"
            });
          }
        }
      }
      const t0 = _activeLifecycleT0 = performance.now();
      const describe = (m) => {
        const tgt = m.target;
        const tag = tgt.nodeType === Node.ELEMENT_NODE ? `<${tgt.tagName.toLowerCase()}${tgt.getAttribute?.("data-message-id") ? ` msgId=${tgt.getAttribute("data-message-id")}` : ""}>` : "(text node)";
        const detail = m.type === "attributes" ? `attr "${m.attributeName}" ${m.oldValue !== null ? `"${m.oldValue}"` : "(absent)"} \u2192 "${tgt.getAttribute?.(m.attributeName)}"` : m.type === "childList" ? `${m.addedNodes.length} node(s) added, ${m.removedNodes.length} removed` : `text changed`;
        return `${m.type} on ${tag}: ${detail}`;
      };
      const obs = new MutationObserver((mutations) => {
        const dt = Math.round(performance.now() - t0);
        const bucket = _activeLifecycleReadyDeclared ? _perf.postReadyMutations : _perf.preReadyMutations;
        if (!_activeLifecycleReadyDeclared) _activeLifecycleHadPreMutation = true;
        for (const m of mutations) {
          bucket.count++;
          if (bucket.examples.length < 30) bucket.examples.push(`+${dt}ms ${describe(m)}`);
        }
      });
      obs.observe(turnEl, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true
      });
      _activeLifecycleObserver = obs;
    }
    function watchForToComeFingerprint(turnSection, containerEl) {
      if (!turnSection) return;
      if (turnSection.querySelectorAll("[data-message-author-role]").length > 0) return;
      if (turnSection.querySelectorAll("img").length > 0) return;
      const containerHasImgTurnSectionMissed = !!(containerEl && containerEl.querySelectorAll("img").length > 0);
      const watchRoot = containerEl || turnSection;
      const t0 = performance.now();
      const r0 = turnSection.getBoundingClientRect();
      const entry = {
        turnId: turnSection.getAttribute("data-turn-id") || turnSection.closest("[data-turn]")?.getAttribute("data-turn-id") || "(none)",
        events: [],
        resolvedMs: null,
        detachedAtMs: null,
        timedOut: false,
        startedAt: t0,
        rectAtStart: `top=${Math.round(r0.top)} bottom=${Math.round(r0.bottom)} height=${Math.round(r0.height)} (viewport height=${window.innerHeight}) \u2014 ${r0.bottom <= 0 || r0.top >= window.innerHeight ? "OUTSIDE visible viewport" : "inside visible viewport"}`,
        scopeCheck: containerHasImgTurnSectionMissed ? `SCOPING BUG CONFIRMED \u2014 container already has an <img> that turnSection's own check missed; it landed outside turnSection, not "nothing happened"` : "no discrepancy at watch start \u2014 container and turnSection agreed (both 0 images)",
        domDumpAtTimeout: null
      };
      _perf.toComeFingerprint.watches.push(entry);
      const describe = (node) => {
        if (node.nodeType !== 1) return "(text node)";
        const cls = (node.className || "").toString().slice(0, 70);
        return `<${node.tagName.toLowerCase()} class="${cls}">`;
      };
      const ATTR_WHITELIST = /* @__PURE__ */ new Set(["class", "src", "data-is-intersecting"]);
      let deadline, detachCheck;
      const finish = () => {
        obs.disconnect();
        clearTimeout(deadline);
        clearInterval(detachCheck);
      };
      const obs = new MutationObserver((muts) => {
        const dt = Math.round(performance.now() - t0);
        for (const m of muts) {
          if (m.type === "childList") {
            for (const n of m.addedNodes) {
              if (n.nodeType !== 1) continue;
              entry.events.push(`+${dt}ms added ${describe(n)}`);
              if (n.tagName === "IMG" || n.querySelector?.("img")) entry.resolvedMs = dt;
            }
          } else if (m.type === "attributes" && ATTR_WHITELIST.has(m.attributeName)) {
            entry.events.push(`+${dt}ms attr "${m.attributeName}" on ${describe(m.target)} -> "${m.target.getAttribute(m.attributeName)}"`);
          }
        }
        if (entry.resolvedMs !== null) finish();
      });
      obs.observe(watchRoot, { subtree: true, childList: true, attributes: true });
      detachCheck = setInterval(() => {
        if (!watchRoot.isConnected && entry.detachedAtMs === null) {
          entry.detachedAtMs = Math.round(performance.now() - t0);
          finish();
        }
      }, 500);
      deadline = setTimeout(() => {
        entry.timedOut = true;
        entry.domDumpAtTimeout = dumpElementStructure(watchRoot);
        finish();
      }, TO_COME_TIMEOUT_MS);
    }
    function watchImageSrcHistory(slabEl) {
      if (_watchedImageSrcHistory.has(slabEl)) return;
      _watchedImageSrcHistory.add(slabEl);
      const t0 = performance.now();
      const entry = {
        turnId: slabEl.closest("[data-turn]")?.getAttribute("data-turn-id") || "(none)",
        values: [],
        timedOut: false,
        detachedAtMs: null
      };
      _perf.imageSrcHistory.watches.push(entry);
      const recordCurrent = () => {
        const image = primaryImageForSlab(slabEl);
        const src = image?.getAttribute("src") || "";
        const last = entry.values[entry.values.length - 1];
        if (last && last.value === src) return;
        entry.values.push({ value: src, atMs: Math.round(performance.now() - t0) });
      };
      recordCurrent();
      let deadline, detachCheck;
      const finish = () => {
        obs.disconnect();
        clearTimeout(deadline);
        clearInterval(detachCheck);
      };
      const obs = new MutationObserver(() => recordCurrent());
      obs.observe(slabEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
      detachCheck = setInterval(() => {
        if (!slabEl.isConnected && entry.detachedAtMs === null) {
          entry.detachedAtMs = Math.round(performance.now() - t0);
          finish();
        }
      }, 500);
      deadline = setTimeout(() => {
        entry.timedOut = true;
        finish();
      }, TO_COME_TIMEOUT_MS);
    }
    function watchIntersectingHistory(readinessEl) {
      if (_watchedIntersectingHistory.has(readinessEl)) return;
      _watchedIntersectingHistory.add(readinessEl);
      const t0 = performance.now();
      const entry = {
        turnId: deckSequenceId(readinessEl) || "(none)",
        values: [],
        timedOut: false,
        detachedAtMs: null
      };
      _perf.intersectingHistory.watches.push(entry);
      const recordCurrent = () => {
        const value = readinessEl.getAttribute("data-is-intersecting");
        const last = entry.values[entry.values.length - 1];
        if (last && last.value === value) return;
        entry.values.push({ value, atMs: Math.round(performance.now() - t0) });
      };
      recordCurrent();
      let deadline, detachCheck;
      const finish = () => {
        obs.disconnect();
        clearTimeout(deadline);
        clearInterval(detachCheck);
      };
      const obs = new MutationObserver(() => recordCurrent());
      obs.observe(readinessEl, { attributes: true, attributeFilter: ["data-is-intersecting"] });
      detachCheck = setInterval(() => {
        if (!readinessEl.isConnected && entry.detachedAtMs === null) {
          entry.detachedAtMs = Math.round(performance.now() - t0);
          finish();
        }
      }, 500);
      deadline = setTimeout(() => {
        entry.timedOut = true;
        finish();
      }, TO_COME_TIMEOUT_MS);
      return entry;
    }
    function dumpElementStructure(root) {
      const lines = [];
      const walk = (el, depth) => {
        if (lines.length >= 60) return;
        const bg = getComputedStyle(el).backgroundImage;
        const cls = (el.className || "").toString().slice(0, 60);
        const id = el.id ? ` id="${el.id}"` : "";
        const bgNote = bg && bg !== "none" ? ` [background-image: ${bg.slice(0, 80)}]` : "";
        lines.push(`${"  ".repeat(depth)}<${el.tagName.toLowerCase()}${id} class="${cls}">${bgNote}`);
        for (const child of el.children) walk(child, depth + 1);
      };
      walk(root, 0);
      return lines.join("\n");
    }
    function markContainerReady() {
      if (_activeLifecycleReadyDeclared) return;
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
              `${key}: ${JSON.stringify(before[key])} \u2192 ${JSON.stringify(after[key])} (discovery-to-ready ${dt}ms)`
            );
          }
        }
      }
      if (_activeLifecycleTurnEl && _activeLifecycleTurnEl.isConnected) {
        const turnSections = _activeLifecycleTurnEl.matches("[data-turn]") ? [_activeLifecycleTurnEl, ..._activeLifecycleTurnEl.querySelectorAll("[data-turn]")] : [..._activeLifecycleTurnEl.querySelectorAll("[data-turn]")];
        for (const turnSection of turnSections) watchForToComeFingerprint(turnSection, _activeLifecycleTurnEl);
      }
    }
    const WORK_ZONE_MARGIN_FRACTION = 0.1;
    const WORK_ZONE_ADVANCE_FRACTION = 0.5;
    const WORK_ZONE_MOVE_JUMP_PX = 360;
    const WORK_ZONE_MOVE_JUMP_MAX_PX = 720;
    const WORK_ZONE_MOVE_JUMP_GROW_PX = 60;
    const WORK_ZONE_MOVE_JUMP_RETREAT_STATES = 2;
    const WORK_ZONE_TINY_TARGET_CLAMP_PX = 8;
    let _workZoneAdaptiveJumpPx = WORK_ZONE_MOVE_JUMP_PX;
    function ensureRequestedJumpBucket(size) {
      return _perf.workZoneJumpStability.requestedJumpBuckets[size] || (_perf.workZoneJumpStability.requestedJumpBuckets[size] = {
        jumps: 0,
        clamped: 0,
        clampedPxSum: 0
      });
    }
    function ensureRequestedJumpBucketLadder() {
      for (let size = WORK_ZONE_MOVE_JUMP_PX; size <= WORK_ZONE_MOVE_JUMP_MAX_PX; size += WORK_ZONE_MOVE_JUMP_GROW_PX) {
        ensureRequestedJumpBucket(size);
      }
    }
    function requestedJumpBucketEntries() {
      ensureRequestedJumpBucketLadder();
      return Object.entries(_perf.workZoneJumpStability.requestedJumpBuckets).map(([size, stats]) => [Number(size), stats]).sort(([a], [b]) => a - b);
    }
    function formatRequestedJumpBuckets(separator = " | ") {
      const entries = requestedJumpBucketEntries();
      if (entries.length === 0) return `${WORK_ZONE_MOVE_JUMP_PX}px : 0 full / 0 clamped (avg 0px)`;
      return entries.map(([size, stats]) => {
        const clampedAvgPx = stats.clamped ? Math.round(stats.clampedPxSum / stats.clamped) : 0;
        return `${size}px : ${stats.jumps} full / ${stats.clamped} clamped (avg ${clampedAvgPx}px)`;
      }).join(separator);
    }
    let _stabilizationMarkerEl = null;
    function setStabilizationMarkerColor(color) {
      if (!_stabilizationMarkerEl) {
        _stabilizationMarkerEl = document.createElement("div");
        Object.assign(_stabilizationMarkerEl.style, {
          position: "fixed",
          top: "10px",
          right: "10px",
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          boxShadow: "0 0 0 2px #fff, 0 0 6px rgba(0,0,0,0.5)",
          zIndex: "2147483647",
          pointerEvents: "none"
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
    let _lastIntentionalScrollPos = null;
    let _samplerRunning = false;
    function startBackgroundPositionSampler(getCurrent, container) {
      if (_samplerRunning) return;
      _samplerRunning = true;
      let lastTop = null, lastBottom = null, lastTurnId = null;
      let lastScrollPos = null, lastScrollHeight = null;
      const readScrollPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
      const readScrollHeight = () => container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
      const identify = (cur) => {
        if (!cur) return "(none)";
        if (cur.element) return `${cur.type}:${slabTurnId(cur) || "(no turn-id)"}`;
        if (cur.deckElement) return `${cur.type}:${deckSequenceId(cur.deckElement) || "(no turn-id, deck)"}`;
        return "(synthetic)";
      };
      const tick = () => {
        if (!_samplerRunning) return;
        const cur = getCurrent();
        const turnId = identify(cur);
        if (cur?.geometryElement) {
          const r = cur.geometryElement.getBoundingClientRect();
          if (lastTurnId === turnId && lastTop !== null && (r.top !== lastTop || r.bottom !== lastBottom)) {
            if (_perf.workZoneJumpStability.roomDriftLog.length < 2e3) {
              _perf.workZoneJumpStability.roomDriftLog.push(
                `BACKGROUND SAMPLE: current (turnId=${turnId}) moved between two animation frames with no tracked jump in between \u2014 top ${Math.round(lastTop)}->${Math.round(r.top)}px, bottom ${Math.round(lastBottom)}->${Math.round(r.bottom)}px, markerColor=${_stabilizationMarkerEl?.style.background || "(no marker)"}`
              );
            }
          }
          lastTop = r.top;
          lastBottom = r.bottom;
          lastTurnId = turnId;
        } else {
          lastTop = lastBottom = null;
          lastTurnId = turnId;
        }
        const scrollPos = readScrollPos();
        const scrollHeight = readScrollHeight();
        if (lastScrollPos !== null && scrollPos !== lastScrollPos && scrollPos !== _lastIntentionalScrollPos) {
          if (_perf.workZoneJumpStability.roomDriftLog.length < 2e3) {
            _perf.workZoneJumpStability.roomDriftLog.push(
              `BACKGROUND SAMPLE: scroll position changed to something we did not set ourselves \u2014 ${Math.round(lastScrollPos)}->${Math.round(scrollPos)}px (last intentional set: ${Math.round(_lastIntentionalScrollPos ?? NaN)}px), markerColor=${_stabilizationMarkerEl?.style.background || "(no marker)"}`
            );
          }
        }
        if (lastScrollHeight !== null && scrollHeight !== lastScrollHeight) {
          if (_perf.workZoneJumpStability.roomDriftLog.length < 2e3) {
            _perf.workZoneJumpStability.roomDriftLog.push(
              `BACKGROUND SAMPLE: scrollHeight changed \u2014 ${Math.round(lastScrollHeight)}->${Math.round(scrollHeight)}px, markerColor=${_stabilizationMarkerEl?.style.background || "(no marker)"}`
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
    const WORK_ZONE_JUMP_STABLE_FRAMES = 1;
    const WORK_ZONE_JUMP_STABLE_MAX_MS = 1500;
    const WORK_ZONE_JUMP_HIDDEN_RETRY_MS = SLAB_FINISH_TIMEOUT_MS;
    const WORK_ZONE_JUMP_SNAPSHOT_CAP = 150;
    function findSandwichedEmptySlabInViewport(container) {
      const viewTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
      const viewBottom = viewTop + (container === document.documentElement ? window.innerHeight : container.clientHeight);
      const decks = queryDeckSequenceContainers();
      const hasRealSlab = (deckEl) => !!deckEl.querySelector(
        '[data-message-author-role], [id^="textdoc-message-"], .group\\/imagegen-image'
      );
      for (let i = 1; i < decks.length - 1; i++) {
        const deckEl = decks[i];
        const r = deckEl.getBoundingClientRect();
        if (r.bottom <= viewTop || r.top >= viewBottom) continue;
        if (hasRealSlab(deckEl)) continue;
        if (!hasRealSlab(decks[i - 1]) || !hasRealSlab(decks[i + 1])) continue;
        const sectionEl = deckEl.matches("[data-turn]") ? deckEl : deckEl.querySelector("[data-turn]");
        return { deckEl, sectionEl };
      }
      return null;
    }
    function elementIdentityTag(el) {
      const attrs = [...el.attributes].map((a) => `${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join(" ");
      const tag = el.tagName.toLowerCase();
      return `<${tag}${attrs ? " " + attrs : ""}></${tag}>`;
    }
    function selfAndDescendantsMatching(el, selector) {
      const found = [];
      if (el.matches?.(selector)) found.push(el);
      found.push(...el.querySelectorAll?.(selector) || []);
      return found;
    }
    function firstCapturedSlab(el) {
      const slabs = [
        ...selfAndDescendantsMatching(el, "[data-message-author-role]").map((element) => ({ type: "message", element })),
        ...selfAndDescendantsMatching(el, '[id^="textdoc-message-"]').map((element) => ({ type: "canvas", element })),
        ...selfAndDescendantsMatching(el, ".group\\/imagegen-image").map((element) => ({ type: "image", element }))
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
      const flat = (text || "").replace(/\s+/g, " ").trim();
      if (!flat) return "";
      const sentence = flat.match(/^(.+?[.!?])(?:\s|$)/)?.[1] || flat;
      return sentence.length > maxLen ? sentence.slice(0, maxLen - 1).trimEnd() + "\u2026" : sentence;
    }
    function firstSlabPreviewHtml(slab) {
      if (!slab) return "";
      if (slab.type === "message") {
        const sentence = firstSentence(dryMarkdownFor(slab.element));
        return sentence ? `<div data-first-slab-preview="message">${escHtmlText(sentence)}</div>` : `<div data-first-slab-preview="message">(empty message preview)</div>`;
      }
      if (slab.type === "image") {
        const image = primaryImageForSlab(slab.element);
        const src = image?.getAttribute("src") || "";
        const alt = image?.getAttribute("alt") || "Generated image";
        return src ? `<div data-first-slab-preview="image"><a href="${escHtmlAttr(src)}">Image: ${escHtmlText(firstSentence(alt, 80) || "Generated image")}</a></div>` : `<div data-first-slab-preview="image">Image: ${escHtmlText(firstSentence(alt, 80) || "Generated image")}</div>`;
      }
      if (slab.type === "canvas") {
        const titleEl = slab.element.querySelector('span.font-semibold, [class*="font-semibold"]');
        const title = (titleEl?.textContent || "Canvas document").trim();
        return `<div data-first-slab-preview="canvas"><a href="#">Canvas: ${escHtmlText(firstSentence(title, 120) || "Canvas document")}</a></div>`;
      }
      return "";
    }
    function trimmedCaptureHtml(el) {
      if (!el) return "(no element reference captured)";
      const parts = [elementIdentityTag(el)];
      const firstSlab = firstCapturedSlab(el);
      if (firstSlab && firstSlab.element !== el) {
        parts.push(elementIdentityTag(firstSlab.element));
      }
      const preview = firstSlabPreviewHtml(firstSlab);
      if (preview) parts.push(preview);
      return parts.join("\n");
    }
    function capturedIntersectingDecksHtml(container) {
      const viewTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
      const viewBottom = viewTop + (container === document.documentElement ? window.innerHeight : container.clientHeight);
      const captured = [];
      for (const deckEl of queryDeckSequenceContainers()) {
        const r = deckEl.getBoundingClientRect();
        if (r.bottom <= viewTop || r.top >= viewBottom) continue;
        const sectionEl = deckEl.matches("[data-turn]") ? deckEl : deckEl.querySelector("[data-turn]");
        captured.push({
          turnId: deckSequenceId(deckEl) || "(none)",
          role: sectionEl?.getAttribute("data-turn") || deckEl.getAttribute("data-turn") || "unknown",
          html: trimmedCaptureHtml(sectionEl || deckEl)
        });
      }
      return captured;
    }
    function pushHtmlCaptures(label, captured) {
      for (const c of captured) _htmlCaptures.push({ label, ...c });
    }
    function captureElementHtmlReference(label, el, role = "unknown", turnId = null) {
      if (!el) return "(no element reference captured)";
      const resolvedTurnId = turnId || deckSequenceId(el) || el.getAttribute?.("data-turn-id") || "(none)";
      _htmlCaptures.push({
        label,
        turnId: resolvedTurnId,
        role: role || el.getAttribute?.("data-turn") || el.getAttribute?.("data-message-author-role") || "unknown",
        html: trimmedCaptureHtml(el)
      });
      return `Captured HTML: see companion .html snapshot #${_htmlCaptures.length} (label=${label}, turnId=${resolvedTurnId}).`;
    }
    function isCurrentDetached(current) {
      if (current?.geometryElement && "isConnected" in current.geometryElement) {
        return !current.geometryElement.isConnected;
      }
      if (current?.deckElement) return !current.deckElement.isConnected;
      return false;
    }
    function attemptLayoutStable(container, current, maxMs = WORK_ZONE_JUMP_STABLE_MAX_MS) {
      const readHeight = () => container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
      return new Promise((resolve) => {
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
          if (document.hidden) wasHidden = true;
          const h = readHeight();
          if (h === lastHeight) {
            stableFrames++;
          } else {
            stableFrames = 0;
            lastHeight = h;
            changed = true;
          }
          const timedOut = performance.now() > deadline;
          let readyToResolve = stableFrames >= WORK_ZONE_JUMP_STABLE_FRAMES || timedOut;
          if (readyToResolve) {
            detached = isCurrentDetached(current);
            const sandwiched = detached ? null : findSandwichedEmptySlabInViewport(container);
            const sandwichedTurnId = sandwiched ? deckSequenceId(sandwiched.deckEl) : null;
            const alreadyKnownUnresolvable = sandwichedTurnId && _knownUnresolvableSandwichedTurnIds.has(sandwichedTurnId);
            if (sandwiched && !alreadyKnownUnresolvable) {
              sawSandwiched = true;
              lastSandwiched = sandwiched;
              stableFrames = 0;
              readyToResolve = timedOut;
            }
          }
          if (readyToResolve) {
            _perf.workZoneJumpStability.steps++;
            if (changed) _perf.workZoneJumpStability.waitedFrames++;
            if (timedOut) _perf.workZoneJumpStability.timedOut++;
            _perf.workZoneJumpStability.maxFramesWaited = Math.max(_perf.workZoneJumpStability.maxFramesWaited, framesChecked);
            if (sawSandwiched) {
              _perf.workZoneJumpStability.sandwichedEmptySeen++;
              if (timedOut && lastSandwiched) {
                _perf.workZoneJumpStability.sandwichedEmptyTimedOut++;
                const role = lastSandwiched.sectionEl?.getAttribute("data-turn") || lastSandwiched.deckEl.getAttribute("data-turn") || "unknown";
                const tId = deckSequenceId(lastSandwiched.deckEl);
                if (tId) _knownUnresolvableSandwichedTurnIds.add(tId);
                pushHtmlCaptures("sandwiched-empty-timed-out", [{
                  turnId: tId || "(none)",
                  role,
                  html: trimmedCaptureHtml(lastSandwiched.sectionEl || lastSandwiched.deckEl)
                }]);
                if (_perf.workZoneJumpStability.sandwichedEmptyExamples.length < 5) {
                  _perf.workZoneJumpStability.sandwichedEmptyExamples.push(
                    `role=${role} turnId=${tId || "(none)"}, framesWaited=${framesChecked}`
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
    async function waitForLayoutStable(container, current) {
      const result = await attemptLayoutStable(container, current);
      if (!result.timedOut || result.sawSandwiched || result.detached) return { ...result, hiddenRetried: false };
      if (!result.wasHidden) return { ...result, hiddenRetried: false };
      _perf.workZoneJumpStability.pureTimeoutHiddenRetries++;
      console.warn(
        `[Extractor] work-zone stability wait timed out while the tab was hidden, with current still connected and no sandwiched-empty deck present \u2014 retrying once with the deadline extended to ${WORK_ZONE_JUMP_HIDDEN_RETRY_MS / 1e3}s, since requestAnimationFrame throttling while backgrounded can fully explain a short wait never seeing a settled frame.`
      );
      const retried = await attemptLayoutStable(container, current, WORK_ZONE_JUMP_HIDDEN_RETRY_MS);
      if (retried.timedOut && !retried.sawSandwiched && !retried.detached) {
        _perf.workZoneJumpStability.pureTimeoutHiddenExhausted++;
      }
      return { ...retried, hiddenRetried: true };
    }
    async function forceScrollToEdge(container, direction, timeoutMs = 3e4) {
      _perf.viewportMoveOperationsForceEdge++;
      const readPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
      const setPos = (v) => {
        if (container === document.documentElement) window.scrollTo({ top: v, behavior: "instant" });
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
            `Could not hold the scroll position at the ${direction === -1 ? "bottom" : "top"} edge within ${timeoutMs / 1e3}s (target=${Math.round(t)}, last achieved=${Math.round(achieved)}) \u2014 something is repeatedly reverting it, not just slow to settle.`
          );
        }
      }
    }
    async function maintainWorkZone(container, current, minimumRoomAhead = 0, advanceFraction = WORK_ZONE_ADVANCE_FRACTION) {
      if (current.type === "start") return { roomSatisfied: true, boundaryReached: false, room: Infinity, required: 0 };
      const readPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
      const setPos = (v) => {
        if (container === document.documentElement) window.scrollTo({ top: v, behavior: "instant" });
        else container.scrollTop = v;
        _lastIntentionalScrollPos = v;
        _perf.viewportMovesWorkZone++;
        _perf.workZoneJumpStability.jumps++;
      };
      const clientH = container === document.documentElement ? window.innerHeight : container.clientHeight;
      const liveContainerTop = () => container === document.documentElement ? 0 : container.getBoundingClientRect().top;
      const measureRoom = () => {
        const containerTop = liveContainerTop();
        const r = current.geometryElement.getBoundingClientRect();
        return WALK_DIRECTION === -1 ? r.top - containerTop : clientH - (r.bottom - containerTop);
      };
      const liveScrollMax = () => {
        const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
        return Math.max(0, scrollH - clientH);
      };
      const extra = Math.max(clientH * WORK_ZONE_MARGIN_FRACTION, minimumRoomAhead);
      let room = measureRoom();
      if (room > extra) return { roomSatisfied: true, boundaryReached: false, room, required: extra };
      const advanceRoom = Math.min(clientH - 1, Math.max(extra, clientH * advanceFraction));
      const jumpSign = WALK_DIRECTION === -1 ? -1 : 1;
      const startedAt = performance.now();
      const deadline = Date.now() + SLAB_FINISH_TIMEOUT_MS;
      let boundaryReached = false;
      let jumpsTaken = 0;
      let moveSequence = null;
      let outcome = "advance-complete";
      while (room < advanceRoom) {
        if (room > extra && Date.now() > deadline) {
          outcome = "satisfied-timeout";
          break;
        }
        if (room <= extra && Date.now() > deadline) {
          const waitedMs = Math.round(performance.now() - startedAt);
          pushHtmlCaptures("work-zone-fatal-timeout", capturedIntersectingDecksHtml(container));
          _perf.workZoneRoomShortfall.count++;
          if (_perf.workZoneRoomShortfall.examples.length < 10) {
            _perf.workZoneRoomShortfall.examples.push(
              `steps=${jumpsTaken}, room=${Math.round(room)}px, required=${Math.round(extra)}px, boundaryReached=${boundaryReached}, waited=${waitedMs}ms`
            );
          }
          const message = `Timed out after ${SLAB_FINISH_TIMEOUT_MS / 1e3}s stepping toward work-zone room ahead of current (${jumpsTaken} small step(s) taken, room=${Math.round(room)}px, required=${Math.round(extra)}px, boundaryReached=${boundaryReached}). ${describeCurrentAttachment(current)}. See the separate .html export for the intersecting deck(s) captured at this moment.`;
          const err = new Error(message);
          err.placeholder = currentNotePlaceholder(current, message);
          err.resumeFromCurrent = !isCurrentDetached(current);
          throw err;
        }
        const curTop = readPos();
        const max = liveScrollMax();
        const remainingToAdvanceRoom = advanceRoom - room;
        if (remainingToAdvanceRoom < WORK_ZONE_TINY_TARGET_CLAMP_PX && room > extra) break;
        const calibratedJumpPx = _workZoneAdaptiveJumpPx;
        const safeJumpPx = room + calibratedJumpPx < advanceRoom ? calibratedJumpPx : remainingToAdvanceRoom;
        _perf.workZoneJumpStability.maxCalibratedJumpPx = Math.max(_perf.workZoneJumpStability.maxCalibratedJumpPx, calibratedJumpPx);
        const targetClamped = safeJumpPx < calibratedJumpPx;
        const intendedPos = curTop + jumpSign * safeJumpPx;
        const hitScrollBoundary = jumpSign < 0 ? intendedPos <= 0 : intendedPos >= max;
        const nextPos = Math.max(0, Math.min(max, intendedPos));
        if (nextPos === curTop) {
          boundaryReached = true;
          outcome = "boundary";
          break;
        }
        if (hitScrollBoundary) boundaryReached = true;
        if (moveSequence === null) {
          _perf.workZoneJumpStability.calibratedJumpMoveSequence++;
          moveSequence = _perf.workZoneJumpStability.calibratedJumpMoveSequence;
        }
        _perf.workZoneJumpStability.calibratedJumpCurrentJumps++;
        if (_perf.workZoneJumpStability.calibratedJumpCurrentLastMoveSequence !== moveSequence) {
          _perf.workZoneJumpStability.calibratedJumpCurrentLastMoveSequence = moveSequence;
          _perf.workZoneJumpStability.calibratedJumpCurrentMoves++;
        }
        const requestedBucket = ensureRequestedJumpBucket(calibratedJumpPx);
        if (targetClamped) {
          requestedBucket.clamped++;
          requestedBucket.clampedPxSum += safeJumpPx;
        } else {
          requestedBucket.jumps++;
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
        const roomRightAfterJump = measureRoom();
        setStabilizationMarkerColor("#5ac8fa");
        const turnContainerForButtons = current?.element?.closest("[data-turn-id-container]") || current?.deckElement || null;
        const buttonsRightAfterJump = turnContainerForButtons ? turnContainerForButtons.querySelectorAll("button").length : null;
        const precedentDeck = turnContainerForButtons?.previousElementSibling?.hasAttribute("data-turn-id-container") ? turnContainerForButtons.previousElementSibling : null;
        const subsequentDeck = turnContainerForButtons?.nextElementSibling?.hasAttribute("data-turn-id-container") ? turnContainerForButtons.nextElementSibling : null;
        const findDeckBelow = (decks) => {
          if (!current?.geometryElement) return null;
          const r = current.geometryElement.getBoundingClientRect();
          let best = null, bestGap = Infinity;
          for (const deckEl of decks) {
            const rect = deckEl.getBoundingClientRect();
            const gap = rect.top - r.bottom;
            if (gap >= 0 && gap < bestGap) {
              bestGap = gap;
              best = deckEl;
            }
          }
          return best;
        };
        const findDeckAbove = (decks) => {
          if (!current?.geometryElement) return null;
          const r = current.geometryElement.getBoundingClientRect();
          let best = null, bestGap = Infinity;
          for (const deckEl of decks) {
            const rect = deckEl.getBoundingClientRect();
            const gap = r.top - rect.bottom;
            if (gap >= 0 && gap < bestGap) {
              bestGap = gap;
              best = deckEl;
            }
          }
          return best;
        };
        const rectRelativeToContainer = (el) => {
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
        const belowTurnIdRightAfterJump = deckBelowRightAfterJump ? deckSequenceId(deckBelowRightAfterJump) || "(no turn-id)" : "(none)";
        const aboveTurnIdRightAfterJump = deckAboveRightAfterJump ? deckSequenceId(deckAboveRightAfterJump) || "(no turn-id)" : "(none)";
        const jumpStartedAt = performance.now();
        const stability = await waitForLayoutStable(container, current);
        _perf.workZoneJumpStability.jumpMsSum += performance.now() - jumpStartedAt;
        const buttonsAfterWait = turnContainerForButtons ? turnContainerForButtons.querySelectorAll("button").length : null;
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
        const belowTurnIdAfterWait = deckBelowAfterWait ? deckSequenceId(deckBelowAfterWait) || "(no turn-id)" : "(none)";
        const aboveTurnIdAfterWait = deckAboveAfterWait ? deckSequenceId(deckAboveAfterWait) || "(no turn-id)" : "(none)";
        const belowChanged = belowTurnIdRightAfterJump !== belowTurnIdAfterWait || belowHtmlRightAfterJump !== belowHtmlAfterWait;
        await nextAnimationFrame();
        room = measureRoom();
        setStabilizationMarkerColor("#34c759");
        if (boundaryReached) {
          outcome = "boundary";
          break;
        }
        const gapBelowRightAfterJump = belowGeomRightAfterJump ? belowGeomRightAfterJump.top - (currentGeomRightAfterJump?.bottom ?? roomRightAfterJump) : clientH - (currentGeomRightAfterJump?.bottom ?? roomRightAfterJump);
        const gapBelowAfterWait = belowGeomAfterWait ? belowGeomAfterWait.top - (currentGeomAfterWait?.bottom ?? room) : clientH - (currentGeomAfterWait?.bottom ?? room);
        const gapAboveRightAfterJump = aboveGeomRightAfterJump ? roomRightAfterJump - aboveGeomRightAfterJump.bottom : roomRightAfterJump;
        const gapAboveAfterWait = aboveGeomAfterWait ? room - aboveGeomAfterWait.bottom : room;
        const roomDriftDuringWait = room - roomRightAfterJump;
        _perf.workZoneJumpStability.roomDriftSum += roomDriftDuringWait;
        _perf.workZoneJumpStability.roomDriftAbsSum += Math.abs(roomDriftDuringWait);
        _perf.workZoneJumpStability.roomDriftMaxAbs = Math.max(_perf.workZoneJumpStability.roomDriftMaxAbs, Math.abs(roomDriftDuringWait));
        const currentRoleForDriftLog = current?.element ? slabRole(current) : current?.deckElement?.getAttribute("data-turn") || current?.type || "unknown";
        const currentTurnIdForDriftLog = current?.element ? slabTurnId(current) : deckSequenceId(current?.deckElement) || null;
        if (_perf.workZoneJumpStability.roomDriftLog.length < 2e3) {
          _perf.workZoneJumpStability.roomDriftLog.push(
            `rightAfterJump=${Math.round(roomRightAfterJump)}px, afterWait=${Math.round(room)}px, drift=${Math.round(roomDriftDuringWait)}px, role=${currentRoleForDriftLog}, turnId=${currentTurnIdForDriftLog || "(none)"}, buttons=${buttonsRightAfterJump ?? "n/a"}->${buttonsAfterWait ?? "n/a"}, belowTurnId=${belowTurnIdRightAfterJump}->${belowTurnIdAfterWait}, belowChanged=${belowChanged}, currentBottom=${Math.round(currentGeomRightAfterJump?.bottom ?? NaN)}->${Math.round(currentGeomAfterWait?.bottom ?? NaN)}px, gapBelowCurrent=${Math.round(gapBelowRightAfterJump)}->${Math.round(gapBelowAfterWait)}px, aboveTurnId=${aboveTurnIdRightAfterJump}->${aboveTurnIdAfterWait}, gapAboveCurrent(0..room, the part actually on screen)=${Math.round(gapAboveRightAfterJump)}->${Math.round(gapAboveAfterWait)}px, decksInWholeDom=${decksInDomRightAfterJump.length}->${decksInDomAfterWait.length}`
          );
        }
        if (turnContainerForButtons && _perf.workZoneJumpStability.fullSnapshotCount < WORK_ZONE_JUMP_SNAPSHOT_CAP) {
          _perf.workZoneJumpStability.fullSnapshotCount++;
          const snapshotTurnId = currentTurnIdForDriftLog || "(none)";
          const bundle = (label, h) => `<!-- room=${Math.round(h.room)}px, drift=${Math.round(roomDriftDuringWait)}px, turnId=${snapshotTurnId}, belowTurnId=${h.belowTurnId}, belowChangedFromOtherInstant=${belowChanged}, aboveTurnId=${h.aboveTurnId} -->
<!-- current rect: top=${Math.round(h.currentGeom?.top ?? NaN)}px bottom=${Math.round(h.currentGeom?.bottom ?? NaN)}px height=${Math.round(h.currentGeom?.height ?? NaN)}px (clientH=${Math.round(clientH)}px) -->
<!-- below rect: top=${Math.round(h.belowGeom?.top ?? NaN)}px bottom=${Math.round(h.belowGeom?.bottom ?? NaN)}px, gap to current's bottom (off-screen, real content vs viewport's own bottom edge) = ${Math.round(h.gapBelow)}px -->
<!-- above rect: top=${Math.round(h.aboveGeom?.top ?? NaN)}px bottom=${Math.round(h.aboveGeom?.bottom ?? NaN)}px, gap in 0..room (the part actually on screen above current) \u2014 positive means genuinely uncovered: ${Math.round(h.gapAbove)}px -->
<!-- precedent deck (DOM sibling): -->
${h.precedentHtml ?? "<!-- (none) -->"}
<!-- current deck: -->
${h.currentHtml ?? "<!-- (none) -->"}
<!-- subsequent deck (DOM sibling): -->
${h.subsequentHtml ?? "<!-- (none) -->"}
<!-- deck geometrically below current (by position, not DOM order): -->
${h.belowHtml ?? "<!-- (none) -->"}
<!-- deck geometrically above current (by position, not DOM order): -->
${h.aboveHtml ?? "<!-- (none) -->"}`;
          pushHtmlCaptures("jump-snapshot-right-after-jump", [{
            turnId: snapshotTurnId,
            role: currentRoleForDriftLog,
            html: bundle("right-after-jump", {
              room: roomRightAfterJump,
              currentHtml: outerHtmlRightAfterJump,
              precedentHtml: precedentHtmlRightAfterJump,
              subsequentHtml: subsequentHtmlRightAfterJump,
              belowHtml: belowHtmlRightAfterJump,
              belowTurnId: belowTurnIdRightAfterJump,
              aboveHtml: deckAboveRightAfterJump?.outerHTML || null,
              aboveTurnId: aboveTurnIdRightAfterJump,
              currentGeom: currentGeomRightAfterJump,
              belowGeom: belowGeomRightAfterJump,
              aboveGeom: aboveGeomRightAfterJump,
              gapBelow: gapBelowRightAfterJump,
              gapAbove: gapAboveRightAfterJump
            })
          }]);
          pushHtmlCaptures("jump-snapshot-after-wait", [{
            turnId: snapshotTurnId,
            role: currentRoleForDriftLog,
            html: bundle("after-wait", {
              room,
              currentHtml: outerHtmlAfterWait,
              precedentHtml: precedentHtmlAfterWait,
              subsequentHtml: subsequentHtmlAfterWait,
              belowHtml: belowHtmlAfterWait,
              belowTurnId: belowTurnIdAfterWait,
              aboveHtml: deckAboveAfterWait?.outerHTML || null,
              aboveTurnId: aboveTurnIdAfterWait,
              currentGeom: currentGeomAfterWait,
              belowGeom: belowGeomAfterWait,
              aboveGeom: aboveGeomAfterWait,
              gapBelow: gapBelowAfterWait,
              gapAbove: gapAboveAfterWait
            })
          }]);
        }
        const cleanJump = stability && !stability.timedOut && !stability.sawSandwiched && !stability.detached;
        if (cleanJump) {
          if (_workZoneAdaptiveJumpPx < WORK_ZONE_MOVE_JUMP_MAX_PX) {
            _workZoneAdaptiveJumpPx = Math.min(WORK_ZONE_MOVE_JUMP_MAX_PX, _workZoneAdaptiveJumpPx + WORK_ZONE_MOVE_JUMP_GROW_PX);
            _perf.workZoneJumpStability.calibratedJumpCurrentJumps = 0;
            _perf.workZoneJumpStability.calibratedJumpCurrentMoves = 0;
            _perf.workZoneJumpStability.calibratedJumpCurrentLastMoveSequence = null;
            _perf.workZoneJumpStability.adaptiveIncreases++;
          }
        } else {
          const reasonParts = [];
          if (stability?.detached) reasonParts.push("current detached (signature of a too-large jump)");
          if (stability?.sawSandwiched) reasonParts.push("sandwiched-empty deck still present");
          if (stability?.timedOut) {
            reasonParts.push(
              stability.hiddenRetried ? `per-jump stability timeout (tab was hidden during the wait; still timed out after a ${WORK_ZONE_JUMP_HIDDEN_RETRY_MS / 1e3}s retry)` : stability.wasHidden ? "per-jump stability timeout (tab was hidden during the wait)" : "per-jump stability timeout"
            );
          }
          if (!stability) reasonParts.push("stability check did not resolve");
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
          pushHtmlCaptures("work-zone-jump-failed", capturedIntersectingDecksHtml(container));
          const explanation = detachedCause ? `This looks like the jump itself pushing current too far behind the viewport for ChatGPT's renderer to keep up \u2014 clicking Restart retries at the smaller ${_workZoneAdaptiveJumpPx}px and is likely to get past it.` : `current is not detached, so this may not be a jump-size problem at all \u2014 it's consistent with the known sandwiched-empty-deck/content-readiness gap (ChatGPT hasn't finished rendering this content yet). The current slab is still connected, so Resume can continue from this cursor instead of rebuilding from the conversation edge.`;
          const message = `Work-zone jump (${failedJumpPx}px) failed: ${reasonParts.join(", ") || "unknown"} (${jumpsTaken} small step(s) taken this move, room=${Math.round(room)}px, required=${Math.round(extra)}px). ${describeCurrentAttachment(current)}. ${explanation} See the separate .html export for the intersecting deck(s) captured at this moment.`;
          const err = new Error(message);
          err.placeholder = currentNotePlaceholder(current, message);
          err.resumeFromCurrent = !detachedCause;
          err.autoRestart = detachedCause;
          throw err;
        }
      }
      if (jumpsTaken > 0) {
        _perf.viewportMoveOperationsWorkZone++;
        pushHtmlCaptures("work-zone-move", capturedIntersectingDecksHtml(container));
      }
      return { roomSatisfied: room > extra, boundaryReached, room, required: extra, jumpsTaken, outcome };
    }
    function currentNotePlaceholder(current, reason) {
      const el = current?.element || current?.deckElement || null;
      const role = current?.element ? slabRole(current) : current?.deckElement?.getAttribute("data-turn") || "unknown";
      const turnId = current?.element ? slabTurnId(current) : deckSequenceId(current?.deckElement) || null;
      return {
        role,
        text: `*[${reason}]*

${captureElementHtmlReference("current-note-placeholder", el, role, turnId)}

`,
        plainText: "[Work-zone move came up short]",
        msgId: null,
        turnId
      };
    }
    function describeCurrentAttachment(current) {
      const geometryIsConnected = current?.geometryElement && "isConnected" in current.geometryElement ? current.geometryElement.isConnected : "(synthetic marker, n/a)";
      const deckEl = current?.deckElement || current?.element?.closest?.("[data-turn-id-container]") || null;
      const deckConnected = deckEl ? deckEl.isConnected : "(no deck found)";
      const deckFingerprint = deckEl ? deckEl.hasAttribute("data-is-intersecting") ? deckEl.getAttribute("data-is-intersecting") : "(attribute absent \u2014 already considered ready)" : "(no deck found)";
      return `geometryElement.isConnected=${geometryIsConnected}, deck.isConnected=${deckConnected}, deck data-is-intersecting=${deckFingerprint}`;
    }
    function describeCurrentForStop(current, readyContainer) {
      const rect = current?.geometryElement?.getBoundingClientRect?.();
      return `current=${current?.type || "(none)"}/${current?.element ? slabRole(current) : "(synthetic)"} turnId=${current?.element ? slabTurnId(current) || "(none)" : "(none)"} msgId=${current?.element ? slabMessageId(current) || "(none)" : "(none)"}` + (rect ? ` rect=[top=${Math.round(rect.top)},bottom=${Math.round(rect.bottom)}]` : "") + ` deckId=${deckSequenceId(readyContainer) || "(none)"} ${describeCurrentAttachment(current)}`;
    }
    async function waitForTurnReady(container, turnEl, timeoutMs = 3e4, onTick = null) {
      if (turnEl.getAttribute("data-is-intersecting") !== "false") {
        recordReadyMargin(container);
        markContainerReady();
        return;
      }
      const deadline = Date.now() + timeoutMs;
      while (turnEl.getAttribute("data-is-intersecting") === "false") {
        onTick?.();
        if (!turnEl.isConnected)
          throw new Error("Target deck node detached from the document while waiting for it to mount \u2014 reacquire needed, not a timeout.");
        if (Date.now() > deadline) {
          const stillInViewport = isInViewport(container, turnEl);
          const r = turnEl.getBoundingClientRect();
          throw new Error(
            `Unexpected: deck never mounted within ${Math.round(timeoutMs / 1e3)}s of the work-zone move's activation signal \u2014 data-is-intersecting="${turnEl.getAttribute("data-is-intersecting")}", in viewport (script geometry)=${stillInViewport}, rect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]. This is a deviation from the algorithm's invariant, not something more waiting would fix.`
          );
        }
        await sleep(100);
      }
      recordReadyMargin(container);
      markContainerReady();
    }
    function shortestMountedMessageHeight() {
      const heights = [...document.querySelectorAll("[data-message-author-role]")].map((el) => el.getBoundingClientRect().height).filter((h) => h > 0);
      return heights.length ? Math.min(...heights) : SLAB_ADJACENCY_MAX_GAP;
    }
    function slabStackForMessageElement(messageEl) {
      const scope = messageEl.closest("[data-conversation-screenshot-content]");
      if (!scope) return null;
      return [...scope.children].find((child) => child.contains(messageEl)) || null;
    }
    function slabItemForMessageElement(messageEl) {
      const stack = slabStackForMessageElement(messageEl);
      if (!stack) return null;
      return [...stack.children].find((child) => child.contains(messageEl)) || null;
    }
    function slabScopeForMessageElement(el) {
      return slabItemForMessageElement(el) || el;
    }
    function rectSummary(rect) {
      return `top=${Math.round(rect.top)},bottom=${Math.round(rect.bottom)},height=${Math.round(rect.height)}`;
    }
    function elementSignature(el) {
      const dataAttrs = [...el.attributes].filter((a) => a.name.startsWith("data-")).slice(0, 5).map((a) => a.value ? `${a.name}=${a.value}` : a.name).join(" ");
      return `<${el.tagName.toLowerCase()}>` + (el.id ? `#${el.id}` : "") + (dataAttrs ? ` data="${dataAttrs}"` : "") + (el.className ? ` class="${String(el.className).slice(0, 80)}"` : "");
    }
    function describeSlabScopeCandidatesForMessageElement(messageEl, stopAt) {
      const out = [];
      for (let el = messageEl, depth = 0; el && depth < 8; el = el.parentElement, depth++) {
        const rect = el.getBoundingClientRect();
        const messageCount = el.matches("[data-message-author-role]") ? 1 : el.querySelectorAll("[data-message-author-role]").length;
        const marker = el === messageEl ? "messageElement" : el === stopAt ? "readyContainer" : `ancestor+${depth}`;
        out.push(
          `${marker}:${elementSignature(el)}, rect=[${rectSummary(rect)}], messages=${messageCount}`
        );
        if (el === stopAt) break;
      }
      return out.join(" | ");
    }
    function classifySlabItem(el) {
      if (el.matches("[data-message-author-role]")) return el.getAttribute("data-message-author-role") || "message";
      const messageEl = el.querySelector("[data-message-author-role]");
      if (messageEl) return messageEl.getAttribute("data-message-author-role") || "contains-message";
      if (el.querySelector('[id^="textdoc-message-"], #prosemirror-editor-container, .ProseMirror')) return "textdoc/canvas";
      if (el.querySelector('.group\\/imagegen-image, [data-testid^="image-gen-"], img')) return "image";
      if (el.matches(".group\\/tool-message") || el.querySelector(".group\\/tool-message")) return "tool-message";
      return "unknown";
    }
    function describeSlabItem(el, index = null) {
      const rect = el.getBoundingClientRect();
      const role = classifySlabItem(el);
      const msgId = el.getAttribute("data-message-id") || el.querySelector("[data-message-id]")?.getAttribute("data-message-id") || "(none)";
      const imageCount = el.querySelectorAll("img").length;
      const textLen = (el.innerText || el.textContent || "").trim().length;
      const testIds = [...el.querySelectorAll("[data-testid]")].slice(0, 4).map((testEl) => testEl.getAttribute("data-testid")).join(",");
      const childHints = [...el.children].slice(0, 4).map(elementSignature).join(" || ");
      const ownTurnIdContainer = el.getAttribute("data-turn-id-container");
      const ancestorTurnIdContainer = el.parentElement?.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container") || null;
      const deckIdNote = ownTurnIdContainer ? ownTurnIdContainer === ancestorTurnIdContainer ? `data-turn-id-container=${ownTurnIdContainer} (reuses ancestor's id \u2014 already deduped, not a separate deck)` : `data-turn-id-container=${ownTurnIdContainer} (DIFFERS from ancestor's ${ancestorTurnIdContainer || "(none)"} \u2014 WOULD be treated as its own separate deck)` : "no own data-turn-id-container";
      return `${index === null ? "" : `#${index}/`}${role}/msgId=${msgId}/imgs=${imageCount}/textLen=${textLen}` + (testIds ? `/testids=${testIds}` : "") + (childHints ? `/children=${childHints}` : "") + `/${elementSignature(el)}/rect=[${rectSummary(rect)}]/${deckIdNote}`;
    }
    function describeSiblingSlabItemsInRange(messageEl, top, bottom) {
      const stack = slabStackForMessageElement(messageEl);
      const messageSlab = slabItemForMessageElement(messageEl);
      if (!stack) return "stack=(none)";
      const items = [...stack.children].map((el, i) => {
        const rect = el.getBoundingClientRect();
        const overlap = Math.min(rect.bottom, bottom) - Math.max(rect.top, top);
        return { el, i, rect, overlap };
      }).filter((item) => item.el !== messageSlab && item.overlap > SMALL_EXTRA).sort((a, b) => b.overlap - a.overlap);
      const stackRect = stack.getBoundingClientRect();
      return `stackRect=[${rectSummary(stackRect)}], stackChildren=${stack.children.length}, overlappingSiblingSlabs=${items.length}` + (items.length ? `, ${items.slice(0, 4).map(
        (item) => `${describeSlabItem(item.el, item.i)}/overlap=${Math.round(item.overlap)}px`
      ).join(" || ")}` : "");
    }
    function scheduleReadyContainerGapRecheck(kind, readyContainer, firstEl, secondEl, initialGap, threshold, containerTurnId) {
      if (_perf.readyContainerModel.delayedRechecksScheduled >= 20) return;
      _perf.readyContainerModel.delayedRechecksScheduled++;
      const label = `${kind}: turnId=${containerTurnId}, initial=${Math.round(initialGap)}px, threshold=${Math.round(threshold)}px`;
      setTimeout(() => {
        if (!readyContainer.isConnected || !firstEl?.isConnected || secondEl && !secondEl.isConnected) {
          _perf.readyContainerModel.delayedRechecksResolved++;
          if (_perf.readyContainerModel.delayedRecheckExamples.length < 10) {
            _perf.readyContainerModel.delayedRecheckExamples.push(`${label} \u2192 node detached before recheck`);
          }
          return;
        }
        const r = readyContainer.getBoundingClientRect();
        const firstRect = firstEl.getBoundingClientRect();
        const firstScopeRect = slabScopeForMessageElement(firstEl).getBoundingClientRect();
        const secondRect = secondEl?.getBoundingClientRect();
        const secondScopeRect = secondEl ? slabScopeForMessageElement(secondEl).getBoundingClientRect() : null;
        let recheckedGap;
        if (kind === "top-message-inset") recheckedGap = firstRect.top - r.top;
        else if (kind === "bottom-message-inset") recheckedGap = r.bottom - firstRect.bottom;
        else recheckedGap = secondRect.top - firstRect.bottom;
        const delta = recheckedGap - initialGap;
        _perf.readyContainerModel.delayedRechecksResolved++;
        if (Math.abs(delta) >= SMALL_EXTRA) _perf.readyContainerModel.delayedRechecksChanged++;
        if (_perf.readyContainerModel.delayedRecheckExamples.length < 10) {
          _perf.readyContainerModel.delayedRecheckExamples.push(
            `${label} \u2192 after 500ms ${Math.round(recheckedGap)}px (\u0394${Math.round(delta)}px), containerRect=[${rectSummary(r)}], firstMessageRect=[${rectSummary(firstRect)}], firstSlabScopeRect=[${rectSummary(firstScopeRect)}]` + (secondRect ? `, secondMessageRect=[${rectSummary(secondRect)}]` : "") + (secondScopeRect ? `, secondSlabScopeRect=[${rectSummary(secondScopeRect)}]` : "")
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
      const containerTurnId = deckSequenceId(readyContainer) || "(none)";
      const domMembers = new Set(readyContainer.querySelectorAll("[data-message-author-role]"));
      const probeMembers = /* @__PURE__ */ new Set();
      const rememberModelExampleMsgId = (label, msgId) => {
        if (!msgId || _perf.readyContainerModel.exampleMsgIds.length >= 20) return;
        _perf.readyContainerModel.exampleMsgIds.push({ label, msgId });
      };
      for (const el of document.querySelectorAll("[data-message-author-role]")) {
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
                `containment: message rect[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}] not fully inside container[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]; role=${el.getAttribute("data-message-author-role") || "(none)"}, msgId=${el.getAttribute("data-message-id") || "(none)"}, readyContainerTurnId=${containerTurnId}`
              );
            }
          }
        } else if (overlaps) {
          _perf.readyContainerModel.overlappingNonMembers++;
          if (_perf.readyContainerModel.examples.length < 10) {
            _perf.readyContainerModel.examples.push(
              `overlap-nonmember: message rect[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}] overlaps container[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}] by ${Math.round(overlapPx)}px but probe=${Math.round(probe)} is outside; role=${el.getAttribute("data-message-author-role") || "(none)"}, msgId=${el.getAttribute("data-message-id") || "(none)"}, readyContainerTurnId=${containerTurnId}`
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
            `dom-only-member: message is a DOM descendant but its probe is outside readyContainer; message rect[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}], container[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]; role=${el.getAttribute("data-message-author-role") || "(none)"}, msgId=${el.getAttribute("data-message-id") || "(none)"}, readyContainerTurnId=${containerTurnId}`
          );
        }
      }
      for (const el of probeMembers) {
        if (domMembers.has(el)) continue;
        _perf.readyContainerModel.probeOnlyMembers++;
        if (_perf.readyContainerModel.examples.length < 10) {
          const er = el.getBoundingClientRect();
          _perf.readyContainerModel.examples.push(
            `probe-only-member: message probe is inside readyContainer but it is not a DOM descendant; message rect[top=${Math.round(er.top)},bottom=${Math.round(er.bottom)}], container[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}]; role=${el.getAttribute("data-message-author-role") || "(none)"}, msgId=${el.getAttribute("data-message-id") || "(none)"}, readyContainerTurnId=${containerTurnId}`
          );
        }
      }
      const stacks = [...readyContainer.querySelectorAll("[data-conversation-screenshot-content]")].map((scope) => [...scope.children].find((child) => child.matches?.(".flex.max-w-full.flex-col.gap-4.grow"))).filter(Boolean);
      for (const stack of stacks) {
        _perf.readyContainerModel.slabStacksChecked++;
        const slabItems = [...stack.children].map((el, index) => ({ el, index, rect: el.getBoundingClientRect(), kind: classifySlabItem(el) })).filter((item) => item.rect.height > 0);
        _perf.readyContainerModel.slabItemsChecked += slabItems.length;
        for (const item of slabItems) {
          if (item.kind === "unknown") {
            _perf.readyContainerModel.unknownSlabItems++;
            if (_perf.readyContainerModel.examples.length < 10) {
              _perf.readyContainerModel.examples.push(
                `unknown-slab-item: ${describeSlabItem(item.el, item.index)}, readyContainerTurnId=${containerTurnId}`
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
                `slab-gap: ${Math.round(gap)}px between direct stack slabs (threshold=${Math.round(edgeGapThreshold)}px); readyContainerTurnId=${containerTurnId}, prev=${describeSlabItem(slabItems[i - 1].el, slabItems[i - 1].index)}, next=${describeSlabItem(slabItems[i].el, slabItems[i].index)}`
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
            msgId: members[0].el.getAttribute("data-message-id") || "(none)",
            role: members[0].el.getAttribute("data-message-author-role") || "(none)",
            containerTurnId,
            gap: Math.round(topGap),
            containerRect: rectSummary(r),
            messageRect: rectSummary(members[0].rect),
            slabScopeRect: rectSummary(slabScopeForMessageElement(members[0].el).getBoundingClientRect()),
            memberCount: members.length
          };
        }
        if (bottomGap > _perf.readyContainerModel.maxBottomEdgeGap) {
          _perf.readyContainerModel.maxBottomEdgeGap = bottomGap;
          _perf.readyContainerModel.maxBottomEdgeWinner = {
            msgId: members[members.length - 1].el.getAttribute("data-message-id") || "(none)",
            role: members[members.length - 1].el.getAttribute("data-message-author-role") || "(none)",
            containerTurnId,
            gap: Math.round(bottomGap),
            containerRect: rectSummary(r),
            messageRect: rectSummary(members[members.length - 1].rect),
            slabScopeRect: rectSummary(slabScopeForMessageElement(members[members.length - 1].el).getBoundingClientRect()),
            memberCount: members.length
          };
        }
        if (topGap >= edgeGapThreshold) {
          _perf.readyContainerModel.topEdgeViolations++;
          scheduleReadyContainerGapRecheck("top-message-inset", readyContainer, members[0].el, null, topGap, edgeGapThreshold, containerTurnId);
          if (_perf.readyContainerModel.examples.length < 10) {
            const gapTop = r.top;
            const gapBottom = members[0].rect.top;
            const gapOccupants = [...document.querySelectorAll("[data-message-author-role]")].filter((el) => el !== members[0].el).map((el) => ({ el, rect: el.getBoundingClientRect() })).filter(({ rect }) => rect.bottom > gapTop && rect.top < gapBottom).sort((a, b) => b.rect.bottom - a.rect.bottom);
            const nearestAbove = [...document.querySelectorAll("[data-message-author-role]")].filter((el) => el !== members[0].el).map((el) => ({ el, rect: el.getBoundingClientRect() })).filter(({ rect }) => rect.bottom <= gapBottom).sort((a, b) => b.rect.bottom - a.rect.bottom)[0] || null;
            const nonMessageGapOccupants = [...readyContainer.querySelectorAll("*")].filter((el) => !el.matches("[data-message-author-role]") && !el.closest("[data-message-author-role]")).map((el) => {
              const rect = el.getBoundingClientRect();
              const overlap = Math.min(rect.bottom, gapBottom) - Math.max(rect.top, gapTop);
              return { el, rect, overlap };
            }).filter(({ overlap }) => overlap > SMALL_EXTRA).sort((a, b) => b.overlap - a.overlap);
            const nestedGapContainers = [...readyContainer.querySelectorAll("[data-turn-id-container]")].map((el) => {
              const rect = el.getBoundingClientRect();
              const overlap = Math.min(rect.bottom, gapBottom) - Math.max(rect.top, gapTop);
              return { el, rect, overlap };
            }).filter(({ overlap }) => overlap > SMALL_EXTRA).sort((a, b) => b.overlap - a.overlap);
            const ancestorContainers = [];
            for (let el = readyContainer.parentElement; el; el = el.parentElement) {
              if (el.matches?.("[data-turn-id-container]")) {
                const rect = el.getBoundingClientRect();
                ancestorContainers.push({
                  id: el.getAttribute("data-turn-id-container") || "(none)",
                  rect
                });
              }
            }
            const describeGapMessage = (item) => item ? `role=${item.el.getAttribute("data-message-author-role") || "(none)"}, msgId=${item.el.getAttribute("data-message-id") || "(none)"}, rect=[top=${Math.round(item.rect.top)},bottom=${Math.round(item.rect.bottom)}], containerId=${item.el.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container") || "(none)"}` : "(none)";
            const describeGapElement = (item) => item ? `<${item.el.tagName.toLowerCase()}> overlap=${Math.round(item.overlap)}px, rect=[top=${Math.round(item.rect.top)},bottom=${Math.round(item.rect.bottom)}], class="${(item.el.className || "").slice(0, 80)}", data="${[...item.el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.value ? `${a.name}=${a.value}` : a.name).join(" ")}"` : "(none)";
            const describeGapContainer = (item) => item ? `id=${item.el.getAttribute("data-turn-id-container") || "(none)"}, overlap=${Math.round(item.overlap)}px, rect=[top=${Math.round(item.rect.top)},bottom=${Math.round(item.rect.bottom)},height=${Math.round(item.rect.height)}]` : "(none)";
            _perf.readyContainerModel.examples.push(
              `top-message-inset: ${Math.round(topGap)}px before first message slab in readyContainer (threshold=${Math.round(edgeGapThreshold)}px); firstMsgId=${members[0].el.getAttribute("data-message-id") || "(none)"}, readyContainerTurnId=${containerTurnId}, containerRect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)},height=${Math.round(r.height)}], firstMessageRect=[top=${Math.round(members[0].rect.top)},bottom=${Math.round(members[0].rect.bottom)}], firstSlabScopeRect=[${rectSummary(slabScopeForMessageElement(members[0].el).getBoundingClientRect())}], memberCount=${members.length}, gapOccupantCount=${gapOccupants.length}, nearestGapOccupant=${describeGapMessage(gapOccupants[0])}, nearestMessageAboveFirst=${describeGapMessage(nearestAbove)}, nonMessageGapOccupantCount=${nonMessageGapOccupants.length}, largestNonMessageGapOccupant=${describeGapElement(nonMessageGapOccupants[0])}, nestedGapContainerCount=${nestedGapContainers.length}, largestNestedGapContainer=${describeGapContainer(nestedGapContainers[0])}, ancestorContainerCount=${ancestorContainers.length}, nearestAncestorContainer=${ancestorContainers[0] ? `id=${ancestorContainers[0].id}, rect=[top=${Math.round(ancestorContainers[0].rect.top)},bottom=${Math.round(ancestorContainers[0].rect.bottom)},height=${Math.round(ancestorContainers[0].rect.height)}]` : "(none)"}, siblingSlabCoverage=${describeSiblingSlabItemsInRange(members[0].el, gapTop, gapBottom)}, slabScopeCandidates=${describeSlabScopeCandidatesForMessageElement(members[0].el, readyContainer)}`
            );
            rememberModelExampleMsgId("top-message-inset first", members[0].el.getAttribute("data-message-id"));
          }
        }
        if (bottomGap >= edgeGapThreshold) {
          _perf.readyContainerModel.bottomEdgeViolations++;
          scheduleReadyContainerGapRecheck("bottom-message-inset", readyContainer, members[members.length - 1].el, null, bottomGap, edgeGapThreshold, containerTurnId);
          if (_perf.readyContainerModel.examples.length < 10) {
            _perf.readyContainerModel.examples.push(
              `bottom-message-inset: ${Math.round(bottomGap)}px after last message slab in readyContainer (threshold=${Math.round(edgeGapThreshold)}px); lastMsgId=${members[members.length - 1].el.getAttribute("data-message-id") || "(none)"}, readyContainerTurnId=${containerTurnId}, containerRect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)},height=${Math.round(r.height)}], lastMessageRect=[top=${Math.round(members[members.length - 1].rect.top)},bottom=${Math.round(members[members.length - 1].rect.bottom)}], lastSlabScopeRect=[${rectSummary(slabScopeForMessageElement(members[members.length - 1].el).getBoundingClientRect())}], memberCount=${members.length}, siblingSlabCoverage=${describeSiblingSlabItemsInRange(members[members.length - 1].el, members[members.length - 1].rect.bottom, r.bottom)}, slabScopeCandidates=${describeSlabScopeCandidatesForMessageElement(members[members.length - 1].el, readyContainer)}`
            );
            rememberModelExampleMsgId("bottom-message-inset last", members[members.length - 1].el.getAttribute("data-message-id"));
          }
        }
      }
      for (let i = 1; i < members.length; i++) {
        const gap = members[i].rect.top - members[i - 1].rect.bottom;
        if (gap > _perf.readyContainerModel.maxMessageGap) _perf.readyContainerModel.maxMessageGap = gap;
        if (gap >= messageGapThreshold) {
          _perf.readyContainerModel.messageGapViolations++;
          scheduleReadyContainerGapRecheck("message-gap", readyContainer, members[i - 1].el, members[i].el, gap, messageGapThreshold, containerTurnId);
          if (_perf.readyContainerModel.examples.length < 10) {
            _perf.readyContainerModel.examples.push(
              `message-gap: ${Math.round(gap)}px between adjacent message slabs in readyContainer (threshold=${Math.round(messageGapThreshold)}px); prevMsgId=${members[i - 1].el.getAttribute("data-message-id") || "(none)"}, nextMsgId=${members[i].el.getAttribute("data-message-id") || "(none)"}, readyContainerTurnId=${containerTurnId}, siblingSlabCoverage=${describeSiblingSlabItemsInRange(members[i].el, members[i - 1].rect.bottom, members[i].rect.top)}, prevSlabScopeCandidates=${describeSlabScopeCandidatesForMessageElement(members[i - 1].el, readyContainer)}, nextSlabScopeCandidates=${describeSlabScopeCandidatesForMessageElement(members[i].el, readyContainer)}`
            );
            rememberModelExampleMsgId("message-gap prev", members[i - 1].el.getAttribute("data-message-id"));
            rememberModelExampleMsgId("message-gap next", members[i].el.getAttribute("data-message-id"));
          }
        }
      }
    }
    function isCanvasBlock(el) {
      return Boolean(el?.id && el.id.startsWith("textdoc-message-"));
    }
    function recordNearbySlabCandidates(count) {
      if (count <= 1) return;
      _perf.multiCandidatesInReadyContainer++;
      _perf.multiCandidatesMax = Math.max(_perf.multiCandidatesMax, count);
    }
    const FILTERED_SLAB_RULES = [
      {
        name: "tool-message",
        matches: (el) => el.matches(".group\\/tool-message") || Boolean(el.querySelector(".group\\/tool-message"))
      }
    ];
    function filteredSlabRuleFor(el) {
      return FILTERED_SLAB_RULES.find((rule) => rule.matches(el)) || null;
    }
    function directStackItems(root = document) {
      const items = [];
      for (const scope of root.querySelectorAll("[data-conversation-screenshot-content]")) {
        const stack = [...scope.children].find((child) => child.matches?.(".flex.max-w-full.flex-col.gap-4.grow"));
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
      const selectedGeometry = new Set(selectedCandidates.map((candidate) => candidate.geometryElement));
      const unlisted = [];
      for (const el of directStackItems()) {
        if (selectedGeometry.has(el) || selectedCandidates.some((candidate) => el.contains(candidate.element))) continue;
        const rect = el.getBoundingClientRect();
        if (!acceptsRect(rect)) continue;
        const rule = filteredSlabRuleFor(el);
        recordFilteredSlabItem(el, rule);
        if (!rule) unlisted.push({ el, rect });
      }
      return unlisted;
    }
    function slabItemForElement(el) {
      const scope = el.closest("[data-conversation-screenshot-content]");
      const stack = scope ? [...scope.children].find((child) => child.matches?.(".flex.max-w-full.flex-col.gap-4.grow")) : null;
      return stack ? [...stack.children].find((child) => child.contains(el)) || el : el;
    }
    function makeSlabCandidate(type, element) {
      const geometryElement = type === "message" ? slabItemForElement(element) : element;
      return { type, element, geometryElement };
    }
    const SLAB_WALK_START = {
      type: "start",
      element: null,
      geometryElement: {
        getBoundingClientRect: () => WALK_DIRECTION === -1 ? { top: Infinity, bottom: Infinity, left: 0, right: 0, width: 0, height: 0 } : { top: -Infinity, bottom: -Infinity, left: 0, right: 0, width: 0, height: 0 }
      }
    };
    function makeDeckEntryCurrent(deckEl) {
      return {
        type: "deck-entry",
        element: null,
        deckElement: deckEl,
        geometryElement: {
          getBoundingClientRect: () => {
            const r = deckEl.getBoundingClientRect();
            const edge = WALK_DIRECTION === -1 ? r.bottom : r.top;
            return { top: edge, bottom: edge, left: r.left, right: r.right, width: r.width, height: 0 };
          }
        }
      };
    }
    function makeDeckExitCurrent(deckEl) {
      return {
        type: "deck-exit",
        element: null,
        deckElement: deckEl,
        geometryElement: {
          getBoundingClientRect: () => {
            const r = deckEl.getBoundingClientRect();
            const edge = WALK_DIRECTION === -1 ? r.top : r.bottom;
            return { top: edge, bottom: edge, left: r.left, right: r.right, width: r.width, height: 0 };
          }
        }
      };
    }
    function slabRole(slab) {
      return slab.element.getAttribute("data-message-author-role") || slab.element.closest("[data-turn]")?.getAttribute("data-turn") || slab.type;
    }
    function slabTurnId(slab) {
      return slab.element.closest("[data-turn]")?.getAttribute("data-turn-id") || slab.element.getAttribute("data-turn-id") || null;
    }
    function slabMessageId(slab) {
      return slab.element.getAttribute("data-message-id") || null;
    }
    function querySelectedSlabCandidates(root = document) {
      const candidates = [];
      const messageEls = root.querySelectorAll("[data-message-author-role]");
      const canvasEls = root.querySelectorAll('[id^="textdoc-message-"]');
      const imageEls = root.querySelectorAll(".group\\/imagegen-image");
      for (const el of messageEls) candidates.push(makeSlabCandidate("message", el));
      for (const el of canvasEls) {
        _perf.canvasBlocks.seenGlobally++;
        _perf.canvasBlocks.candidatesFound++;
        candidates.push(makeSlabCandidate("canvas", el));
      }
      for (const el of imageEls) {
        _perf.imageOnlyTurns.candidatesFound++;
        const turnId = el.closest("[data-turn]")?.getAttribute("data-turn-id") || null;
        if (turnId && !_perf.imageOnlyTurns.byTurnId[turnId]) {
          _perf.imageOnlyTurns.byTurnId[turnId] = {
            verdict: "direct-image-candidate",
            dryTextLen: 0,
            nearestUserMsgId: "(not applicable)",
            nearestUserContainerId: "(not applicable)",
            extracted: false
          };
        }
        candidates.push(makeSlabCandidate("image", el));
        watchImageSrcHistory(el);
      }
      if (candidates.length === 0 && root !== document) {
        const turnSection = root.matches?.("[data-turn]") ? root : root.querySelector("[data-turn]");
        if (turnSection) candidates.push(makeSlabCandidate("message", turnSection));
      }
      return candidates;
    }
    const SLAB_LOOKAHEAD_PX = Math.max(
      SLAB_ADJACENCY_MAX_GAP + MIN_ONE_LINE_MESSAGE_HEIGHT,
      MIN_ONE_LINE_MESSAGE_HEIGHT * 2
    );
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
      const ranked = candidates.map((candidate) => ({
        candidate,
        rect: candidate.geometryElement.getBoundingClientRect()
      })).map((item) => ({
        ...item,
        distance: slabDistanceAhead(currentRect, item.rect)
      })).filter((item) => item.distance !== null).sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        return WALK_DIRECTION === -1 ? b.rect.bottom - a.rect.bottom : a.rect.top - b.rect.top;
      });
      recordNearbySlabCandidates(ranked.length);
      return ranked[0]?.candidate || null;
    }
    function slabBelongsToDeck(slab, deckEl) {
      if (!slab || !deckEl) return false;
      if (slab.deckElement === deckEl) return true;
      if (!slab.element) return false;
      if (slab.element === deckEl || deckEl.contains(slab.element)) return true;
      const slabDeckId = slab.element.closest?.("[data-turn-id-container]")?.getAttribute("data-turn-id-container") || null;
      return Boolean(slabDeckId && slabDeckId === deckSequenceId(deckEl));
    }
    function roomAheadInDeck(deckRect, currentRect) {
      if (!currentRect) return deckRect.height;
      return WALK_DIRECTION === -1 ? currentRect.top - deckRect.top : deckRect.bottom - currentRect.bottom;
    }
    function deckHasRoomAhead(deckEl, currentSlab) {
      const deckRect = deckEl.getBoundingClientRect();
      const currentRect = slabBelongsToDeck(currentSlab, deckEl) ? currentSlab.geometryElement.getBoundingClientRect() : null;
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
      const currentRect = slabBelongsToDeck(currentSlab, deckEl) ? currentSlab.geometryElement.getBoundingClientRect() : null;
      return {
        roomAhead: roomAheadInDeck(deckRect, currentRect),
        candidates: selectedCandidates.map((candidate) => ({
          candidate,
          distances: candidateDistanceFacts(deckRect, currentRect, candidate.geometryElement.getBoundingClientRect())
        })),
        stackItems: stackItems.map((el) => ({
          el,
          distances: candidateDistanceFacts(deckRect, currentRect, el.getBoundingClientRect())
        }))
      };
    }
    function findNextSlabInReadyDeck(deckEl, currentSlab, entryDiag = null) {
      const selectedCandidates = querySelectedSlabCandidates(deckEl);
      const stackItems = directStackItems(deckEl);
      const frame = measureSlabSearchFrame(deckEl, currentSlab, selectedCandidates, stackItems);
      if (frame.roomAhead <= SMALL_EXTRA) return { kind: "end-of-deck" };
      if (selectedCandidates.length === 0) {
        const unlisted2 = [];
        for (const { el } of frame.stackItems) {
          const rule = filteredSlabRuleFor(el);
          recordFilteredSlabItem(el, rule);
          if (!rule) unlisted2.push(el);
        }
        const detail = stackItems.length === 0 ? "" : ` ${stackItems.length} direct-stack item(s) existed, but none matched a valid slab selector` + (unlisted2.length ? ` (${unlisted2.length} unlisted); see diagnostics.` : ".");
        return {
          kind: "note",
          slab: {
            type: "note",
            element: deckEl,
            geometryElement: deckEl,
            note: {
              // See finishDeckCoverage's identical fix — no
              // type-based certainty here, so an unreadable
              // attribute is reported as 'unknown', not guessed
              // as 'assistant'.
              role: deckEl.getAttribute("data-turn") || "unknown",
              text: `*[Empty container \u2014 no slab could be detected for this turn (turnId=${deckSequenceId(deckEl) || "unknown"}). This may be a ChatGPT rendering failure or an extractor bug; see the exported diagnostics.${detail} ${describeMovesSinceEntry(entryDiag)}, ${describeIntersectingHistory(deckEl)}]*

${captureElementHtmlReference("empty-container-selection", deckEl, deckEl.getAttribute("data-turn") || "unknown", deckSequenceId(deckEl))}

`,
              plainText: "[Empty container]",
              msgId: null,
              turnId: deckSequenceId(deckEl) || null
            }
          },
          unlisted: []
        };
      }
      const ranked = frame.candidates.filter((item) => item.distances).sort((a, b) => {
        if (a.distances.aheadDistance !== b.distances.aheadDistance) {
          return a.distances.aheadDistance - b.distances.aheadDistance;
        }
        return a.distances.insideDeckDistance - b.distances.insideDeckDistance;
      });
      recordNearbySlabCandidates(ranked.length);
      const selectedGeometry = new Set(selectedCandidates.map((candidate) => candidate.geometryElement));
      const unlisted = [];
      for (const { el, distances } of frame.stackItems) {
        if (selectedGeometry.has(el) || selectedCandidates.some((candidate) => el.contains(candidate.element))) continue;
        if (!distances) continue;
        const rule = filteredSlabRuleFor(el);
        recordFilteredSlabItem(el, rule);
        if (!rule) unlisted.push({ el, distances });
      }
      if (ranked[0]) return { kind: "slab", slab: ranked[0].candidate, unlisted };
      return { kind: "end-of-deck", unlisted };
    }
    async function waitForNextSlabInReadyDeck(deckEl, currentSlab, getEntryDiag, onTick, timeoutMs = SLAB_FINISH_TIMEOUT_MS) {
      const selection = findNextSlabInReadyDeck(deckEl, currentSlab, getEntryDiag());
      if (selection.kind !== "slab") return selection;
      _perf.slabDiscoveryWait.waited++;
      const startedAt = performance.now();
      const deadline = Date.now() + timeoutMs;
      let fp = slabFinishFingerprint(selection.slab, deckEl);
      while (!fp.ready) {
        if (Date.now() > deadline) {
          const waitedMs2 = Math.round(performance.now() - startedAt);
          _perf.slabDiscoveryWait.timedOut++;
          _perf.slabDiscoveryWait.maxWaitMs = Math.max(_perf.slabDiscoveryWait.maxWaitMs, waitedMs2);
          const next = selection.slab;
          return {
            kind: "note",
            slab: {
              type: "note",
              element: next.element,
              geometryElement: next.geometryElement,
              note: {
                role: slabRole(next),
                text: `*[Empty slab \u2014 selector found a ${next.type}/${slabRole(next)} slab (turnId=${slabTurnId(next) || "unknown"}), but it never passed its own content fingerprint within ${Math.round(timeoutMs / 1e3)}s: last=${fp.reason}, summary=${JSON.stringify(fp.summary)}]*

${captureElementHtmlReference("empty-slab-fingerprint-timeout", next.element, slabRole(next), slabTurnId(next))}

`,
                plainText: "[Empty slab]",
                msgId: slabMessageId(next) || null,
                turnId: slabTurnId(next) || null
              }
            }
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
      if (slab.type === "canvas") {
        const contentRoot = canvasContentRoot(el);
        const text2 = contentRoot ? htmlToMarkdown(contentRoot) : "";
        if (!text2) {
          _perf.canvasBlocks.markdownEmpty++;
          return null;
        }
        _perf.canvasBlocks.extracted++;
        const titleEl = el.querySelector('span.font-semibold, [class*="font-semibold"]');
        const title = (titleEl?.textContent || "Canvas document").trim();
        const token = `__CANVAS_PLACEHOLDER_${++_canvasCounter}__`;
        _pendingCanvasDownloads.push({ text: text2, token, title });
        const turnSection = el.closest("[data-turn]");
        return {
          role: turnSection?.getAttribute("data-turn") || "assistant",
          text: `[${title}](${token})

`,
          plainText: title,
          msgId: null,
          turnId: turnSection?.getAttribute("data-turn-id") || null
        };
      }
      if (slab.type === "image") {
        const image = primaryImageForSlab(el);
        const text2 = image ? htmlToMarkdown(image) : "";
        if (!text2) return null;
        const turnSection = el.closest("[data-turn]");
        return {
          role: turnSection?.getAttribute("data-turn") || "assistant",
          text: text2 + "\n\n",
          plainText: image.getAttribute("alt") || "Generated image",
          msgId: null,
          turnId: turnSection?.getAttribute("data-turn-id") || null
        };
      }
      if (!el.matches("[data-message-author-role]")) {
        const messageEl = el.querySelector("[data-message-author-role]");
        if (!messageEl) return null;
        el = messageEl;
      }
      if (_compositeSnapshots.has(el)) {
        const snap = _compositeSnapshots.get(el);
        const final = summarizeMessageStructure(el, el.closest("[data-turn-id-container]"));
        _compositeSnapshots.delete(el);
        for (const k of Object.keys(_perf.compositeFingerprint.fieldExercised)) {
          if (snap[k] > 0 || final[k] > 0) _perf.compositeFingerprint.fieldExercised[k]++;
        }
        const diffs = Object.keys(final).filter((k) => final[k] !== snap[k]);
        const finalImageSrcs = imageSrcsFor(el, el.closest("[data-turn-id-container]"));
        const srcsEqual = snap.imageSrcs.length === finalImageSrcs.length && snap.imageSrcs.every((s, i) => s === finalImageSrcs[i]);
        if (!srcsEqual) diffs.push("imageSrcs");
        const matched = diffs.length === 0;
        if ((snap.images > 0 || final.images > 0) && _perf.compositeFingerprint.imageCandidateDetails.length < 10) {
          const sinceDiscoveryMs = Math.round(performance.now() - snap.discoveredAt);
          _perf.compositeFingerprint.imageCandidateDetails.push(
            `msgId=${el.getAttribute("data-message-id") || "(none)"}: images ${snap.images}\u2192${final.images}, srcsMatched=${srcsEqual}, discovery-to-extraction ${sinceDiscoveryMs}ms, matched=${matched}`
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
              `msgId=${el.getAttribute("data-message-id") || "(none)"} (${snap.isFirst ? "first" : "later"} sibling in container): ` + diffs.map((k) => k === "imageSrcs" ? `imageSrcs ${JSON.stringify(snap.imageSrcs)}\u2192${JSON.stringify(finalImageSrcs)}` : `${k} ${snap[k]}\u2192${final[k]}`).join(", ")
            );
          }
        }
      }
      const text = htmlToMarkdown(el);
      if (!text) return null;
      const msgId = el.getAttribute("data-message-id") || null;
      const turnId = msgId ? null : el.getAttribute("data-turn-id") || null;
      if (el.isConnected) {
        const lenAtExtraction = el.innerText.length;
        setTimeout(() => {
          if (!el.isConnected) return;
          if (el.innerText.length !== lenAtExtraction) {
            _perf.contentChangedAfterExtraction.count++;
            _perf.contentChangedAfterExtraction.examples.push(
              `msgId=${msgId || "(none)"} ${lenAtExtraction}\u2192${el.innerText.length} chars`
            );
          }
        }, 500);
      }
      return {
        role: el.getAttribute("data-message-author-role") || el.getAttribute("data-turn"),
        text,
        plainText: el.innerText.trim(),
        msgId,
        turnId
      };
    }
    async function run(ui, stopBtn, resumeState = null) {
      const isResume = !!resumeState;
      _pendingAutoRestart = false;
      stopActiveLifecycleObserver();
      if (isResume && resumeState.perf) _perf = resumeState.perf;
      else _resetPerf();
      setStabilizationMarkerColor("#34c759");
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
        isResume ? resumeState.knownUnresolvableSandwichedTurnIds || KNOWN_PERMANENTLY_BROKEN_TURN_IDS : KNOWN_PERMANENTLY_BROKEN_TURN_IDS
      );
      _reportedAllowlistedSlabItems = /* @__PURE__ */ new WeakSet();
      _reportedUnlistedSlabItems = /* @__PURE__ */ new WeakSet();
      _watchedImageSrcHistory = /* @__PURE__ */ new WeakSet();
      _watchedIntersectingHistory = /* @__PURE__ */ new WeakSet();
      if (!isResume || !_perf.runStartMs) _perf.runStartMs = performance.now();
      ui.total = rememberExpectedUserPrompts(getNavMenuItems().length);
      const container = findScrollContainer();
      _perf.containerTag = container.tagName.toLowerCase();
      _perf.containerScrollH = container.scrollHeight;
      _perf.containerClientH = container.clientHeight;
      _perf.containerIsDocEl = container === document.documentElement;
      const onVisibilityChange = () => {
        if (document.hidden) {
          _perf.tabHidden.wasHidden = true;
          _perf.tabHidden.hideCount++;
          ui.log(`  \u26A0 tab went to background (${_perf.tabHidden.hideCount}) \u2014 timers may stall while hidden`);
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      const allPrompts = isResume ? resumeState.allPrompts : [];
      const checkedModelContainers = /* @__PURE__ */ new WeakSet();
      let lastEl = resumeState?.lastEl || null;
      let stopReason = null;
      let totalContainerAdvances = resumeState?.totalContainerAdvances || 0;
      let viewportMovesAtLastPrompt = resumeState?.viewportMovesAtLastPrompt || 0;
      let readyContainer = resumeState?.readyContainer || null;
      let current = resumeState?.current || SLAB_WALK_START;
      let containerSlabRanges = resumeState?.containerSlabRanges || [];
      const containerNearEdge = (el) => WALK_DIRECTION === -1 ? el.getBoundingClientRect().bottom : el.getBoundingClientRect().top;
      let containerEntryY = resumeState?.containerEntryY ?? (readyContainer ? containerNearEdge(readyContainer) : null);
      let deckEntryDiag = resumeState?.deckEntryDiag || null;
      let advancesWithoutProgress = resumeState?.advancesWithoutProgress || 0;
      const MAX_ADVANCES_WITHOUT_PROGRESS = 50;
      let lastAdvanceTurnId = resumeState?.lastAdvanceTurnId || null;
      let curTurnIdRun = resumeState?.curTurnIdRun || 0;
      let advanceChain = resumeState?.advanceChain || [];
      if (stopBtn) stopBtn.onclick = () => {
        ui.stopped = true;
      };
      const takeSnap = (p) => {
        const _uEls = [...document.querySelectorAll('[data-message-author-role="user"]')];
        const _curR = lastEl?.getBoundingClientRect() ?? (container === document.documentElement ? { top: 0, bottom: window.innerHeight } : container.getBoundingClientRect());
        _perf.snapshots.push({
          p,
          t: Math.round(performance.now() - _perf.runStartMs),
          m: allPrompts.length,
          q: countPrompts(allPrompts),
          c: totalContainerAdvances,
          v: totalViewportMoves(),
          d: document.getElementsByTagName("*").length,
          uBefore: _uEls.filter((el) => el.getBoundingClientRect().bottom < _curR.top).length,
          uAfter: _uEls.filter((el) => el.getBoundingClientRect().top > _curR.bottom).length
        });
      };
      let bp = 0;
      let lastSnapMs = performance.now();
      const SNAP_INTERVAL_MS = 1e4;
      const maybeSnap = () => {
        const pct = ui.total > 0 ? Math.round(100 * countPrompts(allPrompts) / ui.total) : 0;
        while (bp <= 100 && pct >= bp) {
          takeSnap(bp);
          bp += 10;
          lastSnapMs = performance.now();
        }
        const now = performance.now();
        if (now - lastSnapMs >= SNAP_INTERVAL_MS) {
          takeSnap(bp);
          lastSnapMs = now;
        }
      };
      const insertMsg = (msg) => {
        if (WALK_DIRECTION === -1) {
          allPrompts.unshift(msg);
        } else {
          allPrompts.push(msg);
        }
      };
      try {
        if (isResume) {
          if (isCurrentDetached(resumeState.current)) {
            throw new Error(`Cannot resume from current cursor: ${describeCurrentAttachment(resumeState.current)}.`);
          }
          if (resumeState.readyContainer && !resumeState.readyContainer.isConnected) {
            throw new Error("Cannot resume from current cursor: ready deck is detached.");
          }
          ui.log(`Resuming from current cursor \u2014 ${describeCurrentForStop(resumeState.current, resumeState.readyContainer)}`);
        } else {
          const navItems = getNavMenuItems();
          _perf.navItemCount = navItems.length;
          if (navItems.length > 0) {
            _perf.navFirstLabel = navItems[0].getAttribute("aria-label") || "(none)";
            _perf.navLastLabel = navItems[navItems.length - 1].getAttribute("aria-label") || "(none)";
            const clickedIndex = WALK_DIRECTION === -1 ? navItems.length - 1 : 0;
            const oppositeIndex = navItems.length - 1 - clickedIndex;
            if (oppositeIndex !== clickedIndex && !ui.isAutoStart) {
              _perf.navDiversionAttempted = true;
              navItems[oppositeIndex].click();
              try {
                await forceScrollToEdge(container, -WALK_DIRECTION, 1e4);
                _perf.navDiversionSettled = true;
              } catch (e) {
              }
              await sleep(2e3);
            }
            _perf.navClickedIndex = clickedIndex;
            navItems[clickedIndex].click();
          }
          await forceScrollToEdge(container, WALK_DIRECTION, 3e4);
          _perf.navClickScrollTop = container === document.documentElement ? window.scrollY : container.scrollTop;
          {
            const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            const clientH = container === document.documentElement ? window.innerHeight : container.clientHeight;
            const range = scrollH - clientH;
            _perf.navClickScrollPct = range > 0 ? Math.round(100 * _perf.navClickScrollTop / range) : 100;
            _perf.scrollHeightGrowthCheck.before = scrollH;
            await sleep(5e3);
            const scrollHAfter = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            _perf.scrollHeightGrowthCheck.after = scrollHAfter;
            _perf.scrollHeightGrowthCheck.grewBy = scrollHAfter - scrollH;
          }
        }
        startBackgroundPositionSampler(() => current, container);
        const describeTurnContainer = (el) => {
          const r = el.getBoundingClientRect();
          const attrs = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.value ? `${a.name}="${a.value}"` : a.name).join(" ");
          return `height=${Math.round(r.height)} class="${(el.className || "").slice(0, 60)}" ${attrs}`;
        };
        const currentScrollPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
        const diagAtFailure = () => deckEntryDiag ? { ...deckEntryDiag, scrollPosNow: currentScrollPos() } : null;
        const enterDeck = async (targetDeck) => {
          const readinessEl = readinessElementForDeck(targetDeck);
          if (!readyContainer) _perf.bootstrapWasIntersectingFalse = readinessEl.getAttribute("data-is-intersecting") === "false";
          watchContainerLifecycle(readinessEl);
          watchIntersectingHistory(readinessEl);
          await waitForTurnReady(container, readinessEl, 3e4, maybeSnap);
          deckEntryDiag = {
            movesAtEntry: totalViewportMoves(),
            isIntersectingAtEntry: readinessEl.getAttribute("data-is-intersecting"),
            scrollPosAtEntry: currentScrollPos()
          };
          if (readyContainer) {
            if (readyContainer.isConnected) {
              checkDeckAdjacency(readyContainer, targetDeck);
            } else {
              _perf.containerGapSkippedDetached++;
            }
          }
          readyContainer = targetDeck;
          const entrySectionEl = targetDeck.matches("[data-turn]") ? targetDeck : targetDeck.querySelector("[data-turn]");
          pushHtmlCaptures("deck-entry", [{
            turnId: deckSequenceId(targetDeck) || "(none)",
            role: entrySectionEl?.getAttribute("data-turn") || targetDeck.getAttribute("data-turn") || "unknown",
            html: trimmedCaptureHtml(entrySectionEl || targetDeck)
          }]);
          containerEntryY = containerNearEdge(readyContainer);
          current = makeDeckEntryCurrent(readyContainer);
          containerSlabRanges = [];
          totalContainerAdvances++;
          advanceChain.push({ desc: describeTurnContainer(readyContainer), el: readyContainer });
          const thisTurnId = deckSequenceId(readyContainer);
          curTurnIdRun = thisTurnId && thisTurnId === lastAdvanceTurnId ? curTurnIdRun + 1 : 1;
          lastAdvanceTurnId = thisTurnId;
          _perf.turnIdDedupMaxRun = Math.max(_perf.turnIdDedupMaxRun, curTurnIdRun);
          ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
          maybeSnap();
        };
        while (!ui.stopped && !stopReason) {
          const zoneStatus = await maintainWorkZone(container, current, SLAB_LOOKAHEAD_PX);
          if (zoneStatus.jumpsTaken > 0) {
            ui.log(`  work-zone move: ${zoneStatus.jumpsTaken} step(s), outcome=${zoneStatus.outcome}`);
          }
          if (!zoneStatus.roomSatisfied && !zoneStatus.boundaryReached) {
            if (ui.total > 0 && countPrompts(allPrompts) < ui.total) {
              const boundaryLabel = WALK_DIRECTION === -1 ? "start" : "end";
              stopReason = `Reached the supplied ${boundaryLabel} with only ${countPrompts(allPrompts)}/${ui.total} user prompts extracted. This is a count mismatch, not proof that more deck space exists; earlier slab extraction likely missed prompt(s). ${describeCurrentForStop(current, readyContainer)}`;
            }
            break;
          } else if (!zoneStatus.roomSatisfied) {
            ui.log(`  scroll boundary reached during work-zone move; continuing with deck/slab geometry search`);
          }
          if (readyContainer) checkReadyContainerModel(readyContainer, checkedModelContainers);
          let needsNewBatch = !readyContainer || !deckHasRoomAhead(readyContainer, current);
          let selection = null;
          if (!needsNewBatch) {
            selection = await waitForNextSlabInReadyDeck(readyContainer, current, diagAtFailure, maybeSnap);
            needsNewBatch = selection.kind === "end-of-deck";
          }
          if (needsNewBatch) {
            if (!readyContainer) {
              const bootstrapDeck = findBootstrapContainer(container, WALK_DIRECTION);
              if (bootstrapDeck) {
                await enterDeck(bootstrapDeck);
                continue;
              }
            }
            let reachedDocumentBoundaryForNextDeck = false;
            if (readyContainer) {
              const placeholder = finishDeckCoverage(readyContainer, containerSlabRanges, current, diagAtFailure());
              if (placeholder) insertMsg(placeholder);
              current = makeDeckExitCurrent(readyContainer);
              const exitZoneStatus = await maintainWorkZone(container, current, SLAB_LOOKAHEAD_PX);
              reachedDocumentBoundaryForNextDeck = exitZoneStatus.boundaryReached;
              if (exitZoneStatus.jumpsTaken > 0) {
                ui.log(`  work-zone move (deck exit): ${exitZoneStatus.jumpsTaken} step(s), outcome=${exitZoneStatus.outcome}`);
              }
              if (!exitZoneStatus.roomSatisfied && !exitZoneStatus.boundaryReached) {
                if (ui.total > 0 && countPrompts(allPrompts) < ui.total) {
                  const boundaryLabel = WALK_DIRECTION === -1 ? "start" : "end";
                  stopReason = `Reached the supplied ${boundaryLabel} with only ${countPrompts(allPrompts)}/${ui.total} user prompts extracted. This is a count mismatch, not proof that more deck space exists; earlier slab extraction likely missed prompt(s). ${describeCurrentForStop(current, readyContainer)}`;
                }
                break;
              } else if (!exitZoneStatus.roomSatisfied) {
                ui.log(`  scroll boundary reached at deck exit; searching for adjacent deck`);
              }
            }
            let nextDeck = readyContainer ? findNextDeck(readyContainer, WALK_DIRECTION) : findBootstrapContainer(container, WALK_DIRECTION);
            if (!nextDeck && !readyContainer) {
              const bootstrapDeadline = Date.now() + 3e4;
              while (!nextDeck && Date.now() < bootstrapDeadline) {
                await sleep(100);
                nextDeck = findBootstrapContainer(container, WALK_DIRECTION);
              }
            }
            if (!nextDeck) {
              if (readyContainer && !reachedDocumentBoundaryForNextDeck) {
                stopReason = `No next deck found before the viewport reached the document boundary. This is not a normal completion condition. ${countPrompts(allPrompts)}/${ui.total || "unknown"} user slabs exported.`;
                break;
              }
              if (ui.total === 0) {
                stopReason = `No next deck found, but the expected user slab count was unknown during traversal. ${countPrompts(allPrompts)} user slabs exported. This is not a confirmed normal completion.`;
                break;
              }
              if (countPrompts(allPrompts) >= ui.total) break;
              const boundaryLabel = WALK_DIRECTION === -1 ? "start" : "end";
              if (readyContainer) {
                const r = readyContainer.getBoundingClientRect();
                stopReason = `Reached the supplied ${boundaryLabel} with no next deck found, but only ${countPrompts(allPrompts)}/${ui.total} user prompts extracted. This is a count mismatch, not proof that more deck space exists; earlier slab extraction likely missed prompt(s). Last deck rect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)}].`;
              } else {
                const totalContainers = queryDeckSequenceContainers().length;
                stopReason = `No deck found at the viewport edge after waiting 30s, and only ${countPrompts(allPrompts)}/${ui.total} user prompts confirmed. ${totalContainers} deck sequence container(s) exist in the document \u2014 finding none at the viewport edge means the bootstrap geometry check needs investigating, not a longer wait.`;
              }
              break;
            }
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
                const fresh = readyContainer ? findNextDeck(readyContainer, WALK_DIRECTION) : findBootstrapContainer(container, WALK_DIRECTION);
                if (!fresh) throw e;
                nextDeck = fresh;
              }
            }
            advancesWithoutProgress++;
            _perf.maxAdvancesWithoutProgress = Math.max(_perf.maxAdvancesWithoutProgress, advancesWithoutProgress);
            if (advancesWithoutProgress > MAX_ADVANCES_WITHOUT_PROGRESS) {
              const r = readyContainer.getBoundingClientRect();
              const allMsgs = [...document.querySelectorAll("[data-message-author-role]")];
              let closest = null, closestDist = Infinity;
              for (const el of allMsgs) {
                const mr = el.getBoundingClientRect();
                const dist = mr.top < r.top ? r.top - mr.top : mr.top > r.bottom ? mr.top - r.bottom : 0;
                if (dist < closestDist) {
                  closestDist = dist;
                  closest = mr;
                }
              }
              const curR = current.geometryElement.getBoundingClientRect();
              const chainGroups = /* @__PURE__ */ new Map();
              for (const { desc, el } of advanceChain) {
                if (!chainGroups.has(desc)) chainGroups.set(desc, /* @__PURE__ */ new Set());
                chainGroups.get(desc).add(el);
              }
              const chainSummary = [...chainGroups.entries()].map(([desc, els]) => {
                const total = advanceChain.filter((a) => a.desc === desc).length;
                return `        \xD7${total} (${els.size} distinct element(s)) ${desc}`;
              }).join("\n");
              stopReason = `Advanced through ${advancesWithoutProgress} decks with no matching slab. Last deck rect=[top=${Math.round(r.top)},bottom=${Math.round(r.bottom)},height=${Math.round(r.height)}]. Current (last confirmed) message rect=[top=${Math.round(curR.top)},bottom=${Math.round(curR.bottom)}]. ` + (closest ? `Closest of ${allMsgs.length} [data-message-author-role] elements: rect=[top=${Math.round(closest.top)},bottom=${Math.round(closest.bottom)}], distance=${Math.round(closestDist)}px from deck range.` : `No [data-message-author-role] elements found in the document at all.`) + `
    Chain walked (${advanceChain.length} decks, deduped):
${chainSummary}`;
              break;
            }
            await sleep(30);
            continue;
          }
          const next = selection.slab;
          if (current.element && current.type !== "note") checkSlabAdjacency(current, next);
          advancesWithoutProgress = 0;
          advanceChain = [];
          lastAdvanceTurnId = null;
          curTurnIdRun = 0;
          const vpNow = totalViewportMoves();
          const vpDelta = vpNow - viewportMovesAtLastPrompt;
          const msgId = slabMessageId(next);
          if (next.type === "note") {
            recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
            insertMsg(next.note);
            lastEl = next.geometryElement;
            current = next;
            viewportMovesAtLastPrompt = vpNow;
            ui.log(`#${allPrompts.length} confirmed (note/${slabRole(next)}) \u2014 \u0394viewport ${vpDelta}`);
            ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
            maybeSnap();
            await sleep(30);
            continue;
          }
          const msg = extractSlab(next);
          if (!msg) {
            _perf.extractionFailures.count++;
            if (_perf.extractionFailures.examples.length < 10) {
              _perf.extractionFailures.examples.push(
                `type=${next.type} role=${slabRole(next)} turnId=${slabTurnId(next) || "(none)"} msgId=${msgId || "(none)"} returned empty under current readiness fingerprint`
              );
            }
            ui.log(`  \u26A0 extraction returned empty under current readiness fingerprint for ${next.type}/${slabRole(next)} \u2014 content permanently lost, advancing past it`);
            const missingRole = slabRole(next);
            const missingNote = {
              role: missingRole === "user" ? "user" : missingRole === "assistant" ? "assistant" : "unknown",
              text: `*[Missing slab \u2014 selector found a ${next.type}/${missingRole} slab, but extraction returned empty after the readiness fingerprint passed. turnId=${slabTurnId(next) || "unknown"}, msgId=${msgId || "none"}.]*

`,
              plainText: "[Missing slab]",
              msgId: msgId || null,
              turnId: slabTurnId(next) || null
            };
            recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
            insertMsg(missingNote);
          }
          if (msg) {
            if (!_perf.bootstrapRole) _perf.bootstrapRole = slabRole(next);
            if (next.type === "image" && msg.turnId && _perf.imageOnlyTurns.byTurnId[msg.turnId]) {
              _perf.imageOnlyTurns.extracted++;
              _perf.imageOnlyTurns.byTurnId[msg.turnId].extracted = true;
            }
            recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
            {
              const slabY = next.geometryElement.getBoundingClientRect().top;
              const reach = WALK_DIRECTION === -1 ? containerEntryY - slabY : slabY - containerEntryY;
              _perf.containerReach.count++;
              _perf.containerReach.sum += reach;
              if (reach > _perf.containerReach.max) {
                _perf.containerReach.max = reach;
                const containerHeight = readyContainer.getBoundingClientRect().height;
                _perf.containerReach.maxWinner = {
                  turnId: deckSequenceId(readyContainer) || "(none)",
                  containerHeight: Math.round(containerHeight),
                  pct: containerHeight > 0 ? Math.round(100 * reach / containerHeight) : null
                };
              }
            }
            insertMsg(msg);
          }
          lastEl = next.geometryElement;
          current = next;
          viewportMovesAtLastPrompt = vpNow;
          ui.log(`#${allPrompts.length} confirmed (${next.type}/${slabRole(next)}) \u2014 \u0394viewport ${vpDelta}`);
          ui.status(countPrompts(allPrompts), allPrompts.length, totalContainerAdvances, totalViewportMoves());
          maybeSnap();
          await sleep(30);
        }
      } catch (e) {
        stopReason = e.message;
        const canResumeFromCurrent = e.resumeFromCurrent && current && !isCurrentDetached(current) && (!readyContainer || readyContainer.isConnected);
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
            perf: _perf
          };
          ui.log("Resume available from current cursor; no missing-slab note inserted yet.");
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
          stopReason = `Traversal ended after ${exportedAtEnd}/${expectedAtEnd} user slabs. The loop reached an end condition, but the exported count is still incomplete. Review the slab-loop end criteria; this is not a clean conversation boundary.`;
        }
      }
      if (!stopReason) _resumeState = null;
      stopActiveLifecycleObserver();
      stopBackgroundPositionSampler();
      removeStabilizationMarker();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (_perf.readyContainerModel.delayedRechecksResolved < _perf.readyContainerModel.delayedRechecksScheduled) {
        await sleep(550);
      }
      const _totalMs = performance.now() - _perf.runStartMs;
      const _sleepMs = _totalMs - _perf.htmlToMarkdownMs;
      ui.log("\u2500\u2500 perf (v4.161) \u2500\u2500");
      ui.log(`total ${(_totalMs / 1e3).toFixed(1)}s | sleep/wait ${(_sleepMs / 1e3).toFixed(1)}s (${Math.round(100 * _sleepMs / _totalMs)}%)`);
      ui.log(`htmlToMarkdown: ${_perf.htmlToMarkdownCalls} calls, ${Math.round(_perf.htmlToMarkdownMs)}ms`);
      ui.log(`${countPrompts(allPrompts)} prompts saved (${allPrompts.length} msgs total).`);
      ui.log(`Lifecycle: auto-resumes-from-current=${_perf.lifecycle.autoResumesFromCurrent}`);
      ui.log(
        `Ready-container nearby message slabs outside deck: ${_perf.readyContainerProbeMisses.count} overlapping/near (overlapping=${_perf.readyContainerProbeMisses.overlapping}, near-only=${_perf.readyContainerProbeMisses.nearOnly}, above=${_perf.readyContainerProbeMisses.above}, below=${_perf.readyContainerProbeMisses.below})`
      );
      ui.log(
        `Ready-container model: ${_perf.readyContainerModel.checked} checked, containment=${_perf.readyContainerModel.containmentViolations}, overlap-nonmember=${_perf.readyContainerModel.overlappingNonMembers}, dom-only=${_perf.readyContainerModel.domOnlyMembers}, probe-only=${_perf.readyContainerModel.probeOnlyMembers}, message-gaps=${_perf.readyContainerModel.messageGapViolations}, maxMessageGap=${Math.round(_perf.readyContainerModel.maxMessageGap)}px, message-insets=${_perf.readyContainerModel.topEdgeViolations + _perf.readyContainerModel.bottomEdgeViolations} (top=${_perf.readyContainerModel.topEdgeViolations}, bottom=${_perf.readyContainerModel.bottomEdgeViolations}, maxTop=${Math.round(_perf.readyContainerModel.maxTopEdgeGap)}px, maxBottom=${Math.round(_perf.readyContainerModel.maxBottomEdgeGap)}px, maxBottomMsg=${_perf.readyContainerModel.maxBottomEdgeWinner?.msgId || "(none)"}), slabs=${_perf.readyContainerModel.slabItemsChecked}/${_perf.readyContainerModel.slabStacksChecked}, unknownSlabs=${_perf.readyContainerModel.unknownSlabItems}, slabGaps=${_perf.readyContainerModel.slabGapViolations}, maxSlabGap=${Math.round(_perf.readyContainerModel.maxSlabGap)}px, rechecks=${_perf.readyContainerModel.delayedRechecksResolved}/${_perf.readyContainerModel.delayedRechecksScheduled}, changed=${_perf.readyContainerModel.delayedRechecksChanged}`
      );
      ui.log(
        `Slab discovery wait: checked=${_perf.slabDiscoveryWait.waited}, already=${_perf.slabDiscoveryWait.alreadyReady}, after-wait=${_perf.slabDiscoveryWait.resolvedAfterWait}, timed-out=${_perf.slabDiscoveryWait.timedOut}, maxWait=${Math.round(_perf.slabDiscoveryWait.maxWaitMs)}ms`
      );
      ui.log(
        `Image src history watches: ${_perf.imageSrcHistory.watches.length}, multi-value=${_perf.imageSrcHistory.watches.filter((w) => w.values.length > 1).length} (>1 distinct value seen \u2014 full sequence in the exported diagnostics)`
      );
      ui.log(
        `Filtered direct-stack items: allowlisted=${_perf.slabFiltering.allowlisted}, unlisted-reported=${_perf.slabFiltering.unlisted}, rules=${FILTERED_SLAB_RULES.map((rule) => rule.name).join(", ") || "(none)"}` + (_perf.slabFiltering.unlisted > 0 ? ` \u2014 inspect exported diagnostics for exact elements` : "")
      );
      ui.log(
        `Intermediate deck advances: ${_perf.intermediateDeckAdvances}`
      );
      ui.log(
        `Work-zone room shortfall (fatal on the unclamped path, see stop reason if >0): ${_perf.workZoneRoomShortfall.count}`
      );
      ui.log(
        `Work-zone jump pacing: jumps=${_perf.workZoneJumpStability.jumps}, stability-checks=${_perf.workZoneJumpStability.steps}, waited=${_perf.workZoneJumpStability.waitedFrames}, capped-out=${_perf.workZoneJumpStability.timedOut}, maxFramesWaited=${_perf.workZoneJumpStability.maxFramesWaited}, avgJump=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.jumpPxSum / _perf.workZoneJumpStability.jumps) : 0}px, avgJumpTime=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.jumpMsSum / _perf.workZoneJumpStability.jumps) : 0}ms, avgTimePer120px=${_perf.workZoneJumpStability.jumpPxSum ? Math.round(_perf.workZoneJumpStability.jumpMsSum / (_perf.workZoneJumpStability.jumpPxSum / 120)) : 0}ms, maxJump=${_perf.workZoneJumpStability.maxJumpPx}px, maxCalibratedJump=${_perf.workZoneJumpStability.maxCalibratedJumpPx}px, jumpsAtMax=${_perf.workZoneJumpStability.jumpsAtMax}, targetClamped=${_perf.workZoneJumpStability.targetClampedJumps}, subMinTargetClamps=${_perf.workZoneJumpStability.subMinTargetClamps}, adaptiveIncreases=${_perf.workZoneJumpStability.adaptiveIncreases}, adaptiveResets=${_perf.workZoneJumpStability.adaptiveResets}, scrollAssignments=${_perf.viewportMovesWorkZone + _perf.viewportMovesForceEdge}`
      );
      ui.log(`Requested jump sizes: ${formatRequestedJumpBuckets()}`);
      ui.log(
        `Clamped jumps: ${_perf.workZoneJumpStability.targetClampedJumps} total (avg ${_perf.workZoneJumpStability.targetClampedJumps ? Math.round(_perf.workZoneJumpStability.targetClampedJumpPxSum / _perf.workZoneJumpStability.targetClampedJumps) : 0}px)`
      );
      ui.log(
        `Pure-timeout hidden-tab retries: retries=${_perf.workZoneJumpStability.pureTimeoutHiddenRetries}, exhausted-and-still-failed=${_perf.workZoneJumpStability.pureTimeoutHiddenExhausted}`
      );
      ui.log(
        `Room drift during wait: avgAbs=${_perf.workZoneJumpStability.jumps ? Math.round(_perf.workZoneJumpStability.roomDriftAbsSum / _perf.workZoneJumpStability.jumps) : 0}px, netSum=${Math.round(_perf.workZoneJumpStability.roomDriftSum)}px, maxAbs=${Math.round(_perf.workZoneJumpStability.roomDriftMaxAbs)}px`
      );
      ui.log(
        `Sandwiched-empty-slab readiness failure signal: seen=${_perf.workZoneJumpStability.sandwichedEmptySeen}, capped-out-while-present=${_perf.workZoneJumpStability.sandwichedEmptyTimedOut}`
      );
      if (_perf.workZoneJumpStability.sandwichedEmptySeen > 0) {
        ui.log(
          `\u26A0 SANDWICHED EMPTY SLAB DETECTED \u2014 browser/layout stability was not enough to prove ChatGPT-level readiness; the jump + stability approach needs a readiness patch.`
        );
      }
      ui.log(
        `Container coverage: ${_perf.containerCoverage.checks} checked, ${_perf.containerCoverage.gaps} gap(s), ${_perf.containerCoverage.zeroSlabDecks} zero-slab deck(s) (placeholder inserted, not fatal \u2014 see exported diagnostics)`
      );
      ui.log(
        `Slab adjacency: checked=${_perf.slabAdjacency.checked}, maxGap=${Math.round(_perf.slabAdjacency.maxGap)}px, maxOverlap=${Math.round(_perf.slabAdjacency.maxOverlap)}px, violations=${_perf.slabAdjacency.violations}`
      );
      if (_perf.readyContainerModel.exampleMsgIds.length > 0) {
        const infoByMsgId = /* @__PURE__ */ new Map();
        let previousUserMsgId = null;
        allPrompts.forEach((p, i) => {
          if (p.msgId && !infoByMsgId.has(p.msgId)) {
            infoByMsgId.set(p.msgId, {
              rank: i + 1,
              role: p.role,
              previousUserMsgId
            });
          }
          if (p.role === "user" && p.msgId) previousUserMsgId = p.msgId;
        });
        ui.log(
          "Ready-container model ranks: " + _perf.readyContainerModel.exampleMsgIds.slice(0, 5).map(({ label, msgId }) => {
            const info = infoByMsgId.get(msgId);
            return info ? `${label}=#${info.rank}/${info.role}/prevUser:${info.previousUserMsgId ? `msg-${info.previousUserMsgId}` : "none"}` : `${label}=?`;
          }).join(", ")
        );
      }
      if (stopReason) ui.log(`Stopped early \u2014 diagnosis: ${stopReason}`);
      _savedState = { allPrompts, stopped: ui.stopped, stopReason, timestamp: _runTimestamp };
    }
    function buildUI() {
      const panel = document.createElement("div");
      Object.assign(panel.style, {
        position: "fixed",
        top: "20px",
        right: "20px",
        zIndex: "99999",
        padding: "16px",
        background: "#1e1e2e",
        color: "#cdd6f4",
        border: "2px solid #89b4fa",
        borderRadius: "8px",
        fontFamily: "monospace",
        fontSize: "12px",
        width: "340px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        lineHeight: "1.6"
      });
      const titleRow = document.createElement("div");
      Object.assign(titleRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "6px"
      });
      const title = Object.assign(document.createElement("div"), {
        innerText: "ChatGPT Extractor v4.161"
      });
      Object.assign(title.style, { fontWeight: "bold", color: "#89b4fa" });
      const toggleBtn = Object.assign(document.createElement("button"), { innerText: "\xD7" });
      Object.assign(toggleBtn.style, {
        background: "none",
        border: "none",
        color: "#89b4fa",
        cursor: "pointer",
        fontSize: "16px",
        lineHeight: "1",
        padding: "0 2px",
        fontFamily: "monospace"
      });
      titleRow.append(title, toggleBtn);
      const statusEl = document.createElement("div");
      Object.assign(statusEl.style, { color: "#dde1f4", marginTop: "6px" });
      const elapsedEl = Object.assign(document.createElement("div"), { innerText: "Elapsed : \u2014" });
      const promptsEl = Object.assign(document.createElement("div"), { innerText: "User msgs : \u2014" });
      const msgsEl = Object.assign(document.createElement("div"), { innerText: "All msgs : \u2014" });
      const containersEl = Object.assign(document.createElement("div"), { innerText: "Containers advanced : \u2014" });
      const viewportsEl = Object.assign(document.createElement("div"), { innerText: "Viewport moves : \u2014" });
      const currentJumpEl = Object.assign(document.createElement("div"), {
        innerText: `Requested jumps : ${WORK_ZONE_MOVE_JUMP_PX}px : 0 full / 0 clamped (avg 0px)`
      });
      const clampedJumpEl = Object.assign(document.createElement("div"), { innerText: "Clamped jumps : \u2014" });
      Object.assign(clampedJumpEl.style, {
        borderRadius: "4px",
        padding: "1px 4px",
        marginLeft: "-4px",
        marginRight: "-4px"
      });
      const jumpsEl = Object.assign(document.createElement("div"), { innerText: "Total jumps : \u2014" });
      statusEl.append(elapsedEl, promptsEl, msgsEl, containersEl, viewportsEl, currentJumpEl, clampedJumpEl, jumpsEl);
      const note = Object.assign(document.createElement("div"), {
        innerText: `Scroll to the ${WALK_DIRECTION === -1 ? "BOTTOM" : "TOP"} of the chat before starting.`
      });
      Object.assign(note.style, {
        marginTop: "10px",
        color: "#f9e2af",
        fontSize: "13px",
        lineHeight: "1.35"
      });
      const diagCheck = Object.assign(document.createElement("input"), {
        type: "checkbox",
        id: "extractor-diag-check"
      });
      const diagLabel = Object.assign(document.createElement("label"), {
        htmlFor: "extractor-diag-check",
        innerText: "Include diagnostics in export"
      });
      Object.assign(diagLabel.style, { cursor: "pointer" });
      const diagRow = document.createElement("div");
      Object.assign(diagRow.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        marginTop: "8px",
        fontSize: "11px",
        color: "#dde1f4"
      });
      diagRow.append(diagCheck, diagLabel);
      const btnRow = document.createElement("div");
      Object.assign(btnRow.style, { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" });
      const btn = Object.assign(document.createElement("button"), {
        innerText: "Start Extraction"
      });
      Object.assign(btn.style, {
        flex: "1",
        padding: "6px 10px",
        background: "#89b4fa",
        color: "#11111b",
        border: "none",
        borderRadius: "4px",
        fontWeight: "bold",
        cursor: "pointer",
        fontFamily: "monospace"
      });
      const stopBtn = Object.assign(document.createElement("button"), {
        innerText: "Stop"
      });
      Object.assign(stopBtn.style, {
        padding: "6px 10px",
        background: "#f38ba8",
        color: "#11111b",
        border: "none",
        borderRadius: "4px",
        fontWeight: "bold",
        cursor: "pointer",
        fontFamily: "monospace",
        display: "none"
      });
      const exportBtn = Object.assign(document.createElement("button"), {
        innerText: "Export"
      });
      Object.assign(exportBtn.style, {
        flex: "1",
        padding: "6px 10px",
        background: "#a6e3a1",
        color: "#11111b",
        border: "none",
        borderRadius: "4px",
        fontWeight: "bold",
        cursor: "pointer",
        fontFamily: "monospace",
        display: "none"
      });
      btnRow.append(btn, stopBtn, exportBtn);
      const body = document.createElement("div");
      body.append(statusEl, diagRow, note, btnRow);
      panel.append(titleRow, body);
      panel.style.display = "none";
      document.body.appendChild(panel);
      GM_registerMenuCommand("Show / Hide Extractor Panel", () => {
        panel.style.display = panel.style.display === "none" ? "" : "none";
      });
      const AUTO_START_ONCE_KEY = "extractorAutoStartOnce";
      const _autoStartOnce = sessionStorage.getItem(AUTO_START_ONCE_KEY) === "1";
      if (_autoStartOnce) sessionStorage.removeItem(AUTO_START_ONCE_KEY);
      console.log("[Extractor] one-shot auto-start consumed at this load =", _autoStartOnce);
      if (_autoStartOnce) diagCheck.checked = true;
      GM_registerMenuCommand("Reload and Auto-Start (this load only)", () => {
        sessionStorage.setItem(AUTO_START_ONCE_KEY, "1");
        location.reload();
      });
      toggleBtn.onclick = () => {
        panel.style.display = "none";
      };
      let elapsedTimer = null;
      const formatElapsed = (ms) => {
        const totalSeconds = Math.max(0, Math.floor(ms / 1e3));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, "0");
        return `${minutes}:${seconds}`;
      };
      const updateElapsed = () => {
        elapsedEl.innerText = _perf.runStartMs > 0 ? `Elapsed : ${formatElapsed(performance.now() - _perf.runStartMs)}` : "Elapsed : \u2014";
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
        get includeDiag() {
          return diagCheck.checked;
        },
        isAutoStart: _autoStartOnce,
        status(promptCount, msgCount, containerCount, viewportCount, jumpCount = _perf.workZoneJumpStability.jumps) {
          this.total = rememberExpectedUserPrompts(this.total || getNavMenuItems().length);
          const userMsgSummary = formatUserMsgSummary(promptCount, this.total);
          promptsEl.innerText = `User msgs: ${userMsgSummary}`;
          msgsEl.innerText = `All msgs : ${msgCount}`;
          containersEl.innerText = `Containers advanced : ${containerCount}`;
          viewportsEl.innerText = `Viewport moves : ${viewportCount}`;
          const avgJumpPx = jumpCount ? Math.round(_perf.workZoneJumpStability.jumpPxSum / jumpCount) : 0;
          const requestedJumpStats = formatRequestedJumpBuckets("\n");
          const clampedJumpStats = _perf.workZoneJumpStability.targetClampedJumps === 0 ? "\u2014" : `${_perf.workZoneJumpStability.targetClampedJumps} total (avg ${Math.round(_perf.workZoneJumpStability.targetClampedJumpPxSum / _perf.workZoneJumpStability.targetClampedJumps)}px)`;
          currentJumpEl.innerText = `Requested jumps :
${requestedJumpStats}`;
          clampedJumpEl.innerText = `Clamped jumps : ${clampedJumpStats}`;
          clampedJumpEl.style.background = _perf.workZoneJumpStability.targetClampedJumps === 0 ? "transparent" : "rgba(137, 180, 250, 0.14)";
          jumpsEl.innerText = `Total jumps : ${jumpCount} (Avg: ${avgJumpPx}px/jump)`;
          updateElapsed();
          console.log(`[Extractor] STATUS: user msgs ${userMsgSummary} | msgs ${msgCount} | containers ${containerCount} | viewport moves ${viewportCount} | requested jumps ${formatRequestedJumpBuckets()} | clamped jumps ${clampedJumpStats} | total jumps ${jumpCount} (Avg: ${avgJumpPx}px/jump)`);
        },
        log(msg) {
          updateElapsed();
          console.log(`[Extractor] ${msg}`);
        }
      };
      const showRunningState = () => {
        ui.stopped = false;
        elapsedEl.innerText = "Elapsed : 0:00";
        stopElapsedTimer();
        elapsedTimer = setInterval(updateElapsed, 1e3);
        btn.disabled = true;
        Object.assign(btn.style, { background: "#45475a", color: "#585b70" });
        note.style.display = "none";
        stopBtn.style.display = "";
        exportBtn.style.display = "none";
      };
      const setIdleNote = (label, stopped) => {
        if (label === "Resume from current") {
          note.innerText = "Resume continues from the saved current slab. The adaptive jump size is not reduced for this non-detached stop.";
        } else if (label === "Retry") {
          note.innerText = "Retry starts a fresh attempt. If current detached, the adaptive jump size was already reduced before stopping.";
        } else if (stopped) {
          note.innerText = "Restart starts again from the conversation edge. Export is available for the partial or completed result.";
        } else {
          note.innerText = `Scroll to the ${WALK_DIRECTION === -1 ? "BOTTOM" : "TOP"} of the chat before starting.`;
        }
      };
      const showIdleState = (label, stopped) => {
        updateElapsed();
        stopElapsedTimer();
        stopBtn.style.display = "none";
        exportBtn.style.display = _savedState ? "" : "none";
        btn.disabled = false;
        Object.assign(btn.style, { background: "#89b4fa", color: "#11111b" });
        btn.innerText = label;
        setIdleNote(label, stopped);
        if (stopped) note.style.display = "";
      };
      attachStartExtractionListener({
        button: btn,
        stopButton: stopBtn,
        ui,
        showRunningState,
        showIdleState,
        run,
        getResumeState: () => _resumeState,
        setResumeState: (value) => {
          _resumeState = value;
        },
        getPendingAutoRestart: () => _pendingAutoRestart,
        setPendingAutoRestart: (value) => {
          _pendingAutoRestart = value;
        },
        getSavedState: () => _savedState,
        incrementAutoResumeCount: () => ++_perf.lifecycle.autoResumesFromCurrent
      });
      attachExportListener({
        button: exportBtn,
        ui,
        getSavedState: () => _savedState,
        exportMarkdown,
        countPrompts
      });
      attachAutoStartListener({
        enabled: _autoStartOnce,
        panel,
        startButton: btn,
        sleep,
        getNavMenuItems
      });
    }
    buildUI();
    const _MARKUP_CHECKS = [
      { label: "Ordered list", pat: /^\d+\. /m, prompt: "List the three primary colors as a numbered list." },
      { label: "Unordered list", pat: /^- /m, prompt: "List three types of fruit using bullet points." },
      { label: "Code block", pat: /^```/m, prompt: "Write a Python function that returns the square of a number, with a docstring." },
      { label: "Inline code", pat: /`[^`\n]+`/, prompt: "In one sentence, refer to the variable `count` using inline code." },
      { label: "Bold", pat: /\*\*[^*\n]+\*\*/, prompt: 'Write one sentence where the word "important" appears in bold.' },
      { label: "Italic", pat: /(?<!\*)\*[^*\s][^*\n]*\*(?!\*)/, prompt: 'Write one sentence where the word "gently" appears in italic.' },
      { label: "Table", pat: /\| ?-+ ?\|/, prompt: "Make a table with columns Name and Score, and two data rows." },
      { label: "Blockquote", pat: /^> /m, prompt: "Write this sentence as a blockquote: To be or not to be." },
      { label: "Heading", pat: /^#{1,6} /m, prompt: 'Write a level-2 heading "Results" followed by one sentence.' }
    ];
    function buildDiagUI() {
      const DIAG_ID = "chatgpt-extractor-diag";
      const existing = document.getElementById(DIAG_ID);
      if (existing) {
        existing.remove();
        return;
      }
      const panel = document.createElement("div");
      panel.id = DIAG_ID;
      Object.assign(panel.style, {
        position: "fixed",
        top: "20px",
        left: `${Math.max(0, window.innerWidth - 780)}px`,
        zIndex: "99999",
        padding: "14px",
        background: "#1e1e2e",
        color: "#cdd6f4",
        border: "2px solid #a6e3a1",
        borderRadius: "8px",
        fontFamily: "monospace",
        fontSize: "11px",
        width: "400px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        lineHeight: "1.5",
        maxHeight: "85vh",
        overflowY: "auto"
      });
      const titleRow = document.createElement("div");
      Object.assign(titleRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px",
        cursor: "move",
        userSelect: "none"
      });
      const title = Object.assign(document.createElement("div"), { innerText: "Compatibility Check" });
      Object.assign(title.style, { fontWeight: "bold", color: "#a6e3a1", fontSize: "13px" });
      const closeBtn = Object.assign(document.createElement("button"), { innerText: "\xD7" });
      Object.assign(closeBtn.style, { background: "none", border: "none", color: "#a6e3a1", cursor: "pointer", fontSize: "16px", fontFamily: "monospace", padding: "0" });
      closeBtn.onclick = () => panel.remove();
      titleRow.append(title, closeBtn);
      {
        let ox = 0, oy = 0;
        const onMove = (e) => {
          panel.style.left = `${e.clientX - ox}px`;
          panel.style.top = `${e.clientY - oy}px`;
        };
        const onUp = () => document.removeEventListener("mousemove", onMove);
        titleRow.addEventListener("mousedown", (e) => {
          if (e.target === closeBtn) return;
          const r = panel.getBoundingClientRect();
          ox = e.clientX - r.left;
          oy = e.clientY - r.top;
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp, { once: true });
          e.preventDefault();
        });
      }
      const structHead = Object.assign(document.createElement("div"), { innerText: "\u2500\u2500 Structural \u2500\u2500" });
      Object.assign(structHead.style, { color: "#89b4fa", marginBottom: "6px" });
      const structLog = document.createElement("div");
      Object.assign(structLog.style, { marginBottom: "10px" });
      const addLine = (log, ok, label, detail) => {
        const icon = ok === null ? "[?]" : ok ? "[\u2713]" : "[\u2717]";
        const color = ok === null ? "#585b70" : ok ? "#a6e3a1" : "#f38ba8";
        const row = document.createElement("div");
        row.innerHTML = `<span style="color:${color};font-weight:bold">${icon}</span> ${label}`;
        log.appendChild(row);
        if (detail) {
          const det = document.createElement("div");
          det.innerText = "    " + detail;
          Object.assign(det.style, { color: "#6c7086", whiteSpace: "pre-wrap", wordBreak: "break-all", marginBottom: "2px" });
          log.appendChild(det);
        }
      };
      const runStructural = () => {
        structLog.innerHTML = "";
        const container = findScrollContainer();
        const fallback = container === document.documentElement;
        addLine(
          structLog,
          !fallback,
          "Scroll container",
          fallback ? "FALLBACK: using <html> \u2014 container detection may be wrong" : `<${container.tagName.toLowerCase()}> scrollH=${container.scrollHeight} clientH=${container.clientHeight}`
        );
        const strip = [...document.querySelectorAll("div")].find((d) => d.className.includes("w-9") && d.className.includes("max-h-[50lvh]") && d.className.includes("no-scrollbar"));
        addLine(
          structLog,
          !!strip,
          "Nav menu container (primary selector)",
          strip ? "div.w-9.max-h-[50lvh].no-scrollbar" : "NOT FOUND \u2014 using button-class fallback"
        );
        const navItems = getNavMenuItems();
        addLine(
          structLog,
          navItems.length > 0,
          "Navigation menu items",
          navItems.length > 0 ? `${navItems.length} found` : "NOT FOUND \u2014 navigation impossible"
        );
        if (navItems.length > 0) {
          const label = navItems[0].getAttribute("aria-label");
          addLine(
            structLog,
            !!label,
            "First nav item aria-label",
            label ? label : "MISSING \u2014 cannot identify first user prompt"
          );
        }
        const msgs = document.querySelectorAll("[data-message-author-role]");
        addLine(
          structLog,
          msgs.length > 0,
          "[data-message-author-role]",
          msgs.length > 0 ? `${msgs.length} in DOM` : "MISSING \u2014 cannot extract messages"
        );
        const msgIds = document.querySelectorAll("[data-message-id]");
        addLine(
          structLog,
          msgIds.length > 0,
          "[data-message-id]",
          msgIds.length > 0 ? `${msgIds.length} in DOM` : "MISSING \u2014 export TOC will have no anchors"
        );
        for (const role of ["user", "assistant"]) {
          const heights = [...document.querySelectorAll(`[data-message-author-role="${role}"]`)].map((el) => el.getBoundingClientRect().height).filter((h) => h > 0);
          const min = heights.length ? Math.min(...heights) : null;
          addLine(
            structLog,
            min !== null,
            `Shortest ${role} message height`,
            min !== null ? `${Math.round(min)}px (n=${heights.length} mounted)` : "No mounted messages of this role to measure \u2014 scroll near some and re-check"
          );
        }
        const allPH = [...document.querySelectorAll("[data-turn-id-container]")];
        const blankPH = [...document.querySelectorAll('[data-turn-id-container][data-is-intersecting="false"]')];
        if (allPH.length === 0) {
          addLine(
            structLog,
            null,
            "[data-turn-id-container] (lazy placeholder)",
            "None in DOM \u2014 scroll to the middle of a long conversation and re-check"
          );
        } else {
          const p = allPH[0];
          const hasAttr = p.hasAttribute("data-is-intersecting");
          const cssVar = getComputedStyle(p).getPropertyValue("--last-known-height").trim();
          addLine(
            structLog,
            hasAttr,
            "[data-turn-id-container] (lazy placeholder)",
            [
              `${allPH.length} total, ${blankPH.length} unloaded (blank)`,
              hasAttr ? "data-is-intersecting \u2713" : "data-is-intersecting MISSING \u2190 blank detection broken",
              p.className ? `class: "${p.className.slice(0, 70)}"` : "class: (empty)",
              cssVar ? `--last-known-height: ${cssVar}` : "--last-known-height: not set"
            ].join("\n    ")
          );
          const turnIdGroups = /* @__PURE__ */ new Map();
          for (const el of allPH) {
            const id = el.getAttribute("data-turn-id");
            if (!id) continue;
            if (!turnIdGroups.has(id)) turnIdGroups.set(id, []);
            turnIdGroups.get(id).push(el);
          }
          let dupGroupCount = 0, maxDup = 0;
          for (const [, els] of turnIdGroups) {
            const unrelated = els.filter((el, i) => els.slice(0, i).every((prev) => !prev.contains(el) && !el.contains(prev)));
            if (unrelated.length > 1) {
              dupGroupCount++;
              maxDup = Math.max(maxDup, unrelated.length);
            }
          }
          addLine(
            structLog,
            dupGroupCount === 0,
            "Duplicate data-turn-id siblings",
            dupGroupCount === 0 ? `${turnIdGroups.size} distinct turn-id(s), no sibling duplicates right now` : `${dupGroupCount}/${turnIdGroups.size} turn-id(s) have sibling duplicates, largest group has ${maxDup} element(s)`
          );
        }
      };
      const recheckBtn = Object.assign(document.createElement("button"), { innerText: "Re-check" });
      Object.assign(recheckBtn.style, {
        padding: "3px 8px",
        background: "#313244",
        color: "#cdd6f4",
        border: "1px solid #585b70",
        borderRadius: "4px",
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: "10px",
        marginBottom: "10px"
      });
      recheckBtn.onclick = runStructural;
      const markupHead = Object.assign(document.createElement("div"), { innerText: "\u2500\u2500 Markup Fidelity \u2500\u2500" });
      Object.assign(markupHead.style, { color: "#89b4fa", marginBottom: "6px" });
      const intro = Object.assign(document.createElement("div"), {
        innerText: "Start a new conversation and send these prompts one by one. After extraction, click Check:"
      });
      Object.assign(intro.style, { color: "#bac2de", marginBottom: "8px", lineHeight: "1.4" });
      const mkCopyBtn = (text) => {
        const b = Object.assign(document.createElement("button"), { innerText: "Copy" });
        Object.assign(b.style, {
          padding: "2px 7px",
          background: "#313244",
          color: "#cdd6f4",
          border: "1px solid #585b70",
          borderRadius: "3px",
          cursor: "pointer",
          fontFamily: "monospace",
          fontSize: "10px",
          flexShrink: "0"
        });
        b.onclick = () => {
          navigator.clipboard.writeText(text);
          b.innerText = "\u2713";
          setTimeout(() => {
            b.innerText = "Copy";
          }, 1500);
        };
        return b;
      };
      const promptsContainer = document.createElement("div");
      Object.assign(promptsContainer.style, { marginBottom: "10px" });
      for (let i = 0; i < _MARKUP_CHECKS.length; i++) {
        const { label, prompt } = _MARKUP_CHECKS[i];
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex",
          alignItems: "baseline",
          gap: "6px",
          marginBottom: "4px",
          background: "#181825",
          padding: "5px 7px",
          borderRadius: "4px"
        });
        const num = Object.assign(document.createElement("span"), { innerText: `${i + 1}.` });
        Object.assign(num.style, { color: "#6c7086", flexShrink: "0", minWidth: "14px" });
        const txt = Object.assign(document.createElement("span"), { innerText: prompt });
        Object.assign(txt.style, { flex: "1", lineHeight: "1.4" });
        row.append(num, txt, mkCopyBtn(prompt));
        promptsContainer.appendChild(row);
      }
      const checkBtn = Object.assign(document.createElement("button"), { innerText: "Extract & Check" });
      Object.assign(checkBtn.style, {
        padding: "5px 12px",
        background: "#a6e3a1",
        color: "#11111b",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        fontWeight: "bold",
        fontFamily: "monospace",
        fontSize: "11px",
        marginBottom: "8px"
      });
      const markupLog = document.createElement("div");
      checkBtn.onclick = async () => {
        markupLog.innerHTML = "";
        checkBtn.disabled = true;
        checkBtn.innerText = "Extracting\u2026";
        const addLog = (msg, color = "#6c7086") => {
          const line = document.createElement("div");
          line.innerText = msg;
          Object.assign(line.style, { color, fontSize: "10px", whiteSpace: "pre-wrap" });
          markupLog.appendChild(line);
        };
        const diagUi = {
          stopped: false,
          total: 0,
          phase(n, label) {
            addLog(`Phase ${n} \u2014 ${label}`, "#89b4fa");
          },
          status() {
          },
          log(msg) {
            addLog(`> ${msg}`);
          }
        };
        try {
          await run(diagUi, null);
        } catch (e) {
          addLog(`Error: ${e.message}`, "#f38ba8");
          checkBtn.disabled = false;
          checkBtn.innerText = "Extract & Check";
          return;
        }
        if (_savedState?.stopReason) addLog(`Stopped early \u2014 diagnosis: ${_savedState.stopReason}`, "#f9e2af");
        const sep = document.createElement("div");
        sep.innerText = "\u2500\u2500";
        Object.assign(sep.style, { color: "#585b70", margin: "4px 0" });
        markupLog.appendChild(sep);
        const text = (_savedState?.allPrompts ?? []).filter((pr) => pr.role === "assistant").map((pr) => pr.text).join("\n");
        if (!text) {
          addLog("Extraction produced no assistant content.", "#f38ba8");
        } else {
          for (const { label, pat } of _MARKUP_CHECKS)
            addLine(markupLog, pat.test(text), label, null);
        }
        checkBtn.disabled = false;
        checkBtn.innerText = "Extract & Check";
      };
      panel.append(titleRow, structHead, structLog, recheckBtn, markupHead, intro, promptsContainer, checkBtn, markupLog);
      document.body.appendChild(panel);
      runStructural();
    }
    GM_registerMenuCommand("Compatibility Check", buildDiagUI);
  }

  // src/bootstrap.js
  installExtractorApp();
})();
