// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      4.163
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
      await exportMarkdown(ui, savedState.allPrompts, savedState.timestamp);
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
    getSavedState
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
            ui.log("Auto-resuming from current cursor.");
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
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const nextAnimationFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
    let _perf = {};
    function _resetPerf() {
      _perf = {
        runStartMs: 0,
        expectedUserPrompts: 0
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
      const _result = walk(el, 0).trim().replace(/\n{3,}/g, "\n\n").replace(
        /^([^\s/]+\.\w{2,6})\s*(?:File|Image|Document|Spreadsheet|Presentation|[A-Z]{2,6})$/gm,
        (_match, filename) => `Upload: ${filename}`
      ).replace(/\n{3,}/g, "\n\n");
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
    async function exportMarkdown(ui, prompts, exportTimestamp = Date.now()) {
      const questions = countPrompts(prompts);
      const date = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19) + " UTC";
      const title = getChatTitle();
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
    function finishDeckCoverage(deckEl, ranges, current) {
      const deckRect = deckEl.getBoundingClientRect();
      const gaps = findContainerCoverageGaps(ranges, deckRect.height);
      if (gaps.length > 0) {
        const gapText = gaps.map((g) => `[${Math.round(g.from)}px\u2013${Math.round(g.to)}px]`).join(", ");
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
      return {
        // Unlike canvas/image extraction below, there's no type-based
        // certainty here — the missing content could have been either
        // role. Defaulting to 'assistant' when the attribute itself is
        // unreadable would silently misattribute a user turn (observed
        // live: turnId=febac401, a known user turn, rendered as an
        // assistant note and so never counted toward the user-prompt
        // total) — 'unknown' keeps that honest instead.
        role: deckEl.getAttribute("data-turn") || "unknown",
        text: `*[Empty container \u2014 no slab could be detected for this turn (turnId=${deckSequenceId(deckEl) || "unknown"}). This may be a ChatGPT rendering failure or an extractor bug.]*

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
    const WORK_ZONE_MARGIN_FRACTION = 0.1;
    const WORK_ZONE_ADVANCE_FRACTION = 0.5;
    const WORK_ZONE_MOVE_JUMP_PX = 360;
    const WORK_ZONE_MOVE_JUMP_MAX_PX = 720;
    const WORK_ZONE_MOVE_JUMP_GROW_PX = 60;
    const WORK_ZONE_MOVE_JUMP_RETREAT_STATES = 2;
    const WORK_ZONE_TINY_TARGET_CLAMP_PX = 8;
    let _workZoneAdaptiveJumpPx = WORK_ZONE_MOVE_JUMP_PX;
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
            if (sawSandwiched) {
              if (timedOut && lastSandwiched) {
                const role = lastSandwiched.sectionEl?.getAttribute("data-turn") || lastSandwiched.deckEl.getAttribute("data-turn") || "unknown";
                const tId = deckSequenceId(lastSandwiched.deckEl);
                if (tId) _knownUnresolvableSandwichedTurnIds.add(tId);
                pushHtmlCaptures("sandwiched-empty-timed-out", [{
                  turnId: tId || "(none)",
                  role,
                  html: trimmedCaptureHtml(lastSandwiched.sectionEl || lastSandwiched.deckEl)
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
    async function waitForLayoutStable(container, current) {
      const result = await attemptLayoutStable(container, current);
      if (!result.timedOut || result.sawSandwiched || result.detached) return { ...result, hiddenRetried: false };
      if (!result.wasHidden) return { ...result, hiddenRetried: false };
      const retried = await attemptLayoutStable(container, current, WORK_ZONE_JUMP_HIDDEN_RETRY_MS);
      if (retried.timedOut && !retried.sawSandwiched && !retried.detached) {
      }
      return { ...retried, hiddenRetried: true };
    }
    async function forceScrollToEdge(container, direction, timeoutMs = 3e4) {
      const readPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
      const setPos = (v) => {
        if (container === document.documentElement) window.scrollTo({ top: v, behavior: "instant" });
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
            `Could not hold the scroll position at the ${direction === -1 ? "bottom" : "top"} edge within ${timeoutMs / 1e3}s (target=${Math.round(t)}, last achieved=${Math.round(achieved)}) \u2014 something is repeatedly reverting it, not just slow to settle.`
          );
        }
      }
    }
    async function maintainWorkZone(container, current, advanceFraction = WORK_ZONE_ADVANCE_FRACTION) {
      if (current.type === "start") return { roomSatisfied: true, boundaryReached: false, room: Infinity, required: 0 };
      const readPos = () => container === document.documentElement ? window.scrollY : container.scrollTop;
      const setPos = (v) => {
        if (container === document.documentElement) window.scrollTo({ top: v, behavior: "instant" });
        else container.scrollTop = v;
        _lastIntentionalScrollPos = v;
      };
      const clientH = container === document.documentElement ? document.documentElement.clientHeight : container.clientHeight;
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
      const extra = Math.max(clientH * WORK_ZONE_MARGIN_FRACTION, SLAB_LOOKAHEAD_PX);
      let room = measureRoom();
      if (room > extra) return { roomSatisfied: true, boundaryReached: false, room, required: extra };
      const advanceRoom = Math.min(clientH - 1, Math.max(extra, clientH * advanceFraction));
      const jumpSign = WALK_DIRECTION === -1 ? -1 : 1;
      const startedAt = performance.now();
      const deadline = Date.now() + SLAB_FINISH_TIMEOUT_MS;
      let boundaryReached = false;
      let jumpsTaken = 0;
      let outcome = "advance-complete";
      function normalizeJump(room2) {
        const remainingToAdvanceRoom = advanceRoom - room2;
        if (remainingToAdvanceRoom < WORK_ZONE_TINY_TARGET_CLAMP_PX && room2 > extra) return null;
        return room2 + _workZoneAdaptiveJumpPx < advanceRoom ? _workZoneAdaptiveJumpPx : remainingToAdvanceRoom;
      }
      function performJump(safeJumpPx) {
        const curTop = readPos();
        const max = liveScrollMax();
        const intendedPos = curTop + jumpSign * safeJumpPx;
        const hitScrollBoundary = jumpSign < 0 ? intendedPos <= 0 : intendedPos >= max;
        const nextPos = Math.max(0, Math.min(max, intendedPos));
        if (nextPos === curTop) {
          return { hitBoundary: true };
        }
        if (hitScrollBoundary) boundaryReached = true;
        setPos(nextPos);
        jumpsTaken++;
        return { hitBoundary: false };
      }
      async function waitLayoutStable() {
        setStabilizationMarkerColor("#5ac8fa");
        const stability = await waitForLayoutStable(container, current);
        await nextAnimationFrame();
        setStabilizationMarkerColor("#34c759");
        return stability;
      }
      while (room < advanceRoom) {
        if (room > extra) {
          outcome = "satisfied-timeout";
          break;
        }
        if (room <= extra && Date.now() > deadline) {
          const waitedMs = Math.round(performance.now() - startedAt);
          const message = `Timed out after ${SLAB_FINISH_TIMEOUT_MS / 1e3}s stepping toward work-zone room ahead of current (${jumpsTaken} small step(s) taken, room=${Math.round(room)}px, required=${Math.round(extra)}px, boundaryReached=${boundaryReached}). ${describeCurrentAttachment(current)}. See the separate .html export for the intersecting deck(s) captured at this moment.`;
          const err = new Error(message);
          err.placeholder = currentNotePlaceholder(current, message);
          err.resumeFromCurrent = !isCurrentDetached(current);
          throw err;
        }
        const safeJumpPx = normalizeJump(room);
        if (safeJumpPx === null) break;
        const { hitBoundary } = performJump(safeJumpPx);
        if (hitBoundary) {
          boundaryReached = true;
          outcome = "boundary";
          break;
        }
        const stability = await waitLayoutStable();
        room = measureRoom();
        if (boundaryReached) {
          outcome = "boundary";
          break;
        }
        const cleanJump = stability && !stability.timedOut && !stability.sawSandwiched && !stability.detached;
        if (cleanJump) {
          if (_workZoneAdaptiveJumpPx < WORK_ZONE_MOVE_JUMP_MAX_PX) {
            _workZoneAdaptiveJumpPx = Math.min(WORK_ZONE_MOVE_JUMP_MAX_PX, _workZoneAdaptiveJumpPx + WORK_ZONE_MOVE_JUMP_GROW_PX);
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
    async function waitForTurnReady(container, turnEl, timeoutMs = 3e4) {
      if (turnEl.getAttribute("data-is-intersecting") !== "false") {
        return;
      }
      const deadline = Date.now() + timeoutMs;
      while (turnEl.getAttribute("data-is-intersecting") === "false") {
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
    function isCanvasBlock(el) {
      return Boolean(el?.id && el.id.startsWith("textdoc-message-"));
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
    function inspectUnselectedStackItems(selectedCandidates, acceptsRect) {
      const selectedGeometry = new Set(selectedCandidates.map((candidate) => candidate.geometryElement));
      const unlisted = [];
      for (const el of directStackItems()) {
        if (selectedGeometry.has(el) || selectedCandidates.some((candidate) => el.contains(candidate.element))) continue;
        const rect = el.getBoundingClientRect();
        if (!acceptsRect(rect)) continue;
        const rule = filteredSlabRuleFor(el);
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
        candidates.push(makeSlabCandidate("canvas", el));
      }
      for (const el of imageEls) {
        candidates.push(makeSlabCandidate("image", el));
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
    function findNextSlabInReadyDeck(deckEl, currentSlab) {
      const selectedCandidates = querySelectedSlabCandidates(deckEl);
      const stackItems = directStackItems(deckEl);
      const frame = measureSlabSearchFrame(deckEl, currentSlab, selectedCandidates, stackItems);
      if (frame.roomAhead <= SMALL_EXTRA) return { kind: "end-of-deck" };
      if (selectedCandidates.length === 0) {
        const unlisted2 = [];
        for (const { el } of frame.stackItems) {
          const rule = filteredSlabRuleFor(el);
          if (!rule) unlisted2.push(el);
        }
        const detail = stackItems.length === 0 ? "" : ` ${stackItems.length} direct-stack item(s) existed, but none matched a valid slab selector` + (unlisted2.length ? ` (${unlisted2.length} unlisted).` : ".");
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
              text: `*[Empty container \u2014 no slab could be detected for this turn (turnId=${deckSequenceId(deckEl) || "unknown"}). This may be a ChatGPT rendering failure or an extractor bug.${detail}]*

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
      const selectedGeometry = new Set(selectedCandidates.map((candidate) => candidate.geometryElement));
      const unlisted = [];
      for (const { el, distances } of frame.stackItems) {
        if (selectedGeometry.has(el) || selectedCandidates.some((candidate) => el.contains(candidate.element))) continue;
        if (!distances) continue;
        const rule = filteredSlabRuleFor(el);
        if (!rule) unlisted.push({ el, distances });
      }
      if (ranked[0]) return { kind: "slab", slab: ranked[0].candidate, unlisted };
      return { kind: "end-of-deck", unlisted };
    }
    async function waitForNextSlabInReadyDeck(deckEl, currentSlab, timeoutMs = SLAB_FINISH_TIMEOUT_MS) {
      const selection = findNextSlabInReadyDeck(deckEl, currentSlab);
      if (selection.kind !== "slab") return selection;
      const startedAt = performance.now();
      const deadline = Date.now() + timeoutMs;
      let fp = slabFinishFingerprint(selection.slab, deckEl);
      while (!fp.ready) {
        if (Date.now() > deadline) {
          const waitedMs = Math.round(performance.now() - startedAt);
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
        await sleep(SLAB_FINISH_POLL_MS);
        fp = slabFinishFingerprint(selection.slab, deckEl);
      }
      return selection;
    }
    function extractSlab(slab) {
      let el = slab.element;
      if (slab.type === "canvas") {
        const contentRoot = canvasContentRoot(el);
        const text2 = contentRoot ? htmlToMarkdown(contentRoot) : "";
        if (!text2) {
          return null;
        }
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
      const text = htmlToMarkdown(el);
      if (!text) return null;
      const msgId = el.getAttribute("data-message-id") || null;
      const turnId = msgId ? null : el.getAttribute("data-turn-id") || null;
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
      if (!isResume || !_perf.runStartMs) _perf.runStartMs = performance.now();
      ui.total = rememberExpectedUserPrompts(getNavMenuItems().length);
      const container = findScrollContainer();
      const onVisibilityChange = () => {
        if (document.hidden) ui.log("  tab went to background; timers may stall while hidden");
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      const allPrompts = isResume ? resumeState.allPrompts : [];
      let lastEl = resumeState?.lastEl || null;
      let stopReason = null;
      let totalContainerAdvances = resumeState?.totalContainerAdvances || 0;
      let readyContainer = resumeState?.readyContainer || null;
      let current = resumeState?.current || SLAB_WALK_START;
      let containerSlabRanges = resumeState?.containerSlabRanges || [];
      let advancesWithoutProgress = resumeState?.advancesWithoutProgress || 0;
      const MAX_ADVANCES_WITHOUT_PROGRESS = 50;
      let advanceChain = resumeState?.advanceChain || [];
      if (stopBtn) stopBtn.onclick = () => {
        ui.stopped = true;
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
          if (navItems.length > 0) {
            const clickedIndex = WALK_DIRECTION === -1 ? navItems.length - 1 : 0;
            const oppositeIndex = navItems.length - 1 - clickedIndex;
            if (oppositeIndex !== clickedIndex && !ui.isAutoStart) {
              navItems[oppositeIndex].click();
              try {
                await forceScrollToEdge(container, -WALK_DIRECTION, 1e4);
              } catch (e) {
              }
              await sleep(2e3);
            }
            navItems[clickedIndex].click();
          }
          await forceScrollToEdge(container, WALK_DIRECTION, 3e4);
          {
            const scrollH = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
            const clientH = container === document.documentElement ? window.innerHeight : container.clientHeight;
            const range = scrollH - clientH;
            await sleep(5e3);
            const scrollHAfter = container === document.documentElement ? document.documentElement.scrollHeight : container.scrollHeight;
          }
        }
        startBackgroundPositionSampler(() => current, container);
        const describeTurnContainer = (el) => {
          const r = el.getBoundingClientRect();
          const attrs = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.value ? `${a.name}="${a.value}"` : a.name).join(" ");
          return `height=${Math.round(r.height)} class="${(el.className || "").slice(0, 60)}" ${attrs}`;
        };
        const enterDeck = async (targetDeck) => {
          const readinessEl = readinessElementForDeck(targetDeck);
          await waitForTurnReady(container, readinessEl, 3e4);
          if (readyContainer) {
            if (readyContainer.isConnected) {
              checkDeckAdjacency(readyContainer, targetDeck);
            }
          }
          readyContainer = targetDeck;
          const entrySectionEl = targetDeck.matches("[data-turn]") ? targetDeck : targetDeck.querySelector("[data-turn]");
          pushHtmlCaptures("deck-entry", [{
            turnId: deckSequenceId(targetDeck) || "(none)",
            role: entrySectionEl?.getAttribute("data-turn") || targetDeck.getAttribute("data-turn") || "unknown",
            html: trimmedCaptureHtml(entrySectionEl || targetDeck)
          }]);
          current = makeDeckEntryCurrent(readyContainer);
          containerSlabRanges = [];
          totalContainerAdvances++;
          advanceChain.push({ desc: describeTurnContainer(readyContainer), el: readyContainer });
          ui.status(countPrompts(allPrompts), allPrompts.length);
        };
        while (!ui.stopped && !stopReason) {
          const zoneStatus = await maintainWorkZone(container, current);
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
          let needsNewBatch = !readyContainer || !deckHasRoomAhead(readyContainer, current);
          let selection = null;
          if (!needsNewBatch) {
            selection = await waitForNextSlabInReadyDeck(readyContainer, current);
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
              const placeholder = finishDeckCoverage(readyContainer, containerSlabRanges, current);
              if (placeholder) insertMsg(placeholder);
              current = makeDeckExitCurrent(readyContainer);
              const exitZoneStatus = await maintainWorkZone(container, current);
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
          const msgId = slabMessageId(next);
          if (next.type === "note") {
            recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
            insertMsg(next.note);
            lastEl = next.geometryElement;
            current = next;
            ui.log(`#${allPrompts.length} confirmed (note/${slabRole(next)})`);
            ui.status(countPrompts(allPrompts), allPrompts.length);
            await sleep(30);
            continue;
          }
          const msg = extractSlab(next);
          if (!msg) {
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
            recordSlabRange(readyContainer, next.geometryElement, containerSlabRanges);
            insertMsg(msg);
          }
          lastEl = next.geometryElement;
          current = next;
          ui.log(`#${allPrompts.length} confirmed (${next.type}/${slabRole(next)})`);
          ui.status(countPrompts(allPrompts), allPrompts.length);
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
      stopBackgroundPositionSampler();
      removeStabilizationMarker();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ui.log(`${countPrompts(allPrompts)} prompts saved (${allPrompts.length} msgs total).`);
      if (stopReason) ui.log(`Stopped early: ${stopReason}`);
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
        innerText: "ChatGPT Extractor v4.163"
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
      statusEl.append(elapsedEl, promptsEl, msgsEl);
      const note = Object.assign(document.createElement("div"), {
        innerText: `Scroll to the ${WALK_DIRECTION === -1 ? "BOTTOM" : "TOP"} of the chat before starting.`
      });
      Object.assign(note.style, {
        marginTop: "10px",
        color: "#f9e2af",
        fontSize: "13px",
        lineHeight: "1.35"
      });
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
      body.append(statusEl, note, btnRow);
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
        isAutoStart: _autoStartOnce,
        status(promptCount, msgCount) {
          this.total = rememberExpectedUserPrompts(this.total || getNavMenuItems().length);
          const userMsgSummary = formatUserMsgSummary(promptCount, this.total);
          promptsEl.innerText = `User msgs: ${userMsgSummary}`;
          msgsEl.innerText = `All msgs : ${msgCount}`;
          updateElapsed();
          console.log(`[Extractor] STATUS: user msgs ${userMsgSummary} | msgs ${msgCount}`);
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
        getSavedState: () => _savedState
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
  }

  // src/bootstrap.js
  installExtractorApp();
})();
