// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      5.71
// @description  Extracts a full ChatGPT conversation to Markdown via automated scrolling.
// @author       Dominic Mayers
// @license      MIT
// @homepage     https://github.com/Dominic-Mayers/extractGptChat
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  // src/app/constants.js
  var MINIMUM_SLAB_HEIGHT = 90;
  var MIN_INTERSECT = 80;
  var TOLERATED_ROUNDING = 1;
  var MAX_SLAB_GAP = 160;
  var MAX_DECK_GAP = 20;
  var CALIBRATED_JUMP = 480;
  var MAX_DRIFT = 2;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;
  var MIN_ACTIVATION_DISTANCE = 1e3;
  var MAX_FRAMES_FOR_STABILIZATION = 3e3;

  // src/app/geometry.js
  function areaAhead(referenceTop, maxGap) {
    return {
      top: referenceTop - maxGap,
      bottom: referenceTop
    };
  }

  // src/app/slabType.js
  function slabType(slab) {
    if (!slab?.matches) return "empty";
    if (slab.matches(".group\\/imagegen-image")) return "image";
    if (slab.id?.startsWith("textdoc-message-")) return "canvas";
    if (slab.matches("[data-message-id]")) return "message";
    return "unknown";
  }

  // src/app/scrollContainer.js
  var containers = /* @__PURE__ */ new WeakMap();
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
  function observeSupplier() {
    return createSupplier(findScrollContainer());
  }
  function createSupplier(container) {
    const supplyArea = {};
    const activeArea = {};
    const workZone = {
      get height() {
        return clientHeight(container);
      }
    };
    containers.set(supplyArea, container);
    containers.set(activeArea, container);
    containers.set(workZone, container);
    return { supplyArea, activeArea, workZone };
  }
  function roomAhead(anchor, workZone) {
    return boundaryPosition(anchor) - workZoneTop(workZone);
  }
  function workZonePosition(supplyArea, workZone) {
    const container = commonContainer(supplyArea, workZone);
    return scrollY(container);
  }
  function supplyHeight(supplyArea) {
    return scrollHeight(containerFor(supplyArea));
  }
  function moveWorkZone(distance, supplyArea, workZone) {
    const container = commonContainer(supplyArea, workZone);
    scrollBy(container, -distance);
  }
  function nextAnimationFrame() {
    return new Promise(
      (resolve) => requestAnimationFrame(resolve)
    );
  }
  function moveWorkZoneToSupplyEnd(supplyArea, workZone) {
    const container = commonContainer(supplyArea, workZone);
    scrollTo(container, scrollHeight(container));
  }
  function elementsIn(area, selector) {
    return containerFor(area).querySelectorAll(selector);
  }
  function contains(area, element) {
    return containerFor(area).contains(element);
  }
  function workZoneTop(workZone) {
    const container = containerFor(workZone);
    return container === document.documentElement ? 0 : container.getBoundingClientRect().top;
  }
  function boundaryPosition(anchor) {
    const rect = anchor.element.getBoundingClientRect();
    return rect[anchor.edge];
  }
  function commonContainer(first, second) {
    const container = containerFor(first);
    if (container !== containerFor(second)) {
      throw new Error("Supplier areas belong to different environments.");
    }
    return container;
  }
  function containerFor(area) {
    const container = containers.get(area);
    if (!container) throw new Error("Unknown Supplier area.");
    return container;
  }
  function scrollY(container) {
    return container === document.documentElement ? window.scrollY : container.scrollTop;
  }
  function scrollHeight(container) {
    return container === document.documentElement ? document.body.scrollHeight : container.scrollHeight;
  }
  function clientHeight(container) {
    return container === document.documentElement ? document.documentElement.clientHeight : container.clientHeight;
  }
  function scrollBy(container, top) {
    const target = container === document.documentElement ? window : container;
    target.scrollBy({ top, behavior: "instant" });
  }
  function scrollTo(container, top) {
    const target = container === document.documentElement ? window : container;
    target.scrollTo({ top, behavior: "instant" });
  }

  // src/app/getNextAnchorIn.js
  var TEXT_ANCHOR_SELECTOR = [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "blockquote",
    "pre",
    "figcaption",
    "td",
    "th"
  ].join(",");
  function getNextAnchorIn(slab, workZone) {
    const type = slabType(slab);
    if (type === "image" || type === "empty") {
      return { element: slab, edge: "top" };
    }
    if (type === "message" || type === "canvas") {
      return getNextTextAnchorIn(slab, workZone);
    }
    throw new Error("Cannot select anchors in an unknown slab type.");
  }
  function getNextTextAnchorIn(slab, workZone) {
    const viewportTop = workZoneTop(workZone);
    const viewportHeight2 = workZone.height;
    const targetRoom = viewportHeight2 - MIN_INTERSECT;
    const descendants = [];
    for (const candidate of slab.querySelectorAll(TEXT_ANCHOR_SELECTOR)) {
      if (candidate.closest(".cm-editor, .monaco-editor")) continue;
      const rect = candidate.getBoundingClientRect();
      const ready = candidate.isConnected && rect.width > 0 && rect.height > 0;
      if (ready) descendants.push(candidate);
    }
    const descendantAnchors = normalBoundaryAnchors(
      descendants,
      targetRoom,
      workZone
    );
    if (descendantAnchors.length > 0) return descendantAnchors[0];
    const slabAnchors = normalBoundaryAnchors(
      [slab],
      targetRoom,
      workZone
    );
    if (slabAnchors.length > 0) {
      return slabAnchors[0];
    }
    const coveringAnchors = [];
    for (const candidate of [...descendants, slab]) {
      const rect = candidate.getBoundingClientRect();
      const anchor = { element: candidate, edge: "top" };
      const topRoom = roomAhead(anchor, workZone);
      const bottomRoom = rect.bottom - viewportTop;
      if (topRoom < 0 && bottomRoom >= targetRoom - MAX_DRIFT) {
        coveringAnchors.push(anchor);
      }
    }
    return coveringAnchors.sort((a, b) => {
      const aRoom = roomAhead(a, workZone);
      const bRoom = roomAhead(b, workZone);
      return bRoom - aRoom;
    })[0] ?? null;
  }
  function normalBoundaryAnchors(elements, targetRoom, workZone) {
    const anchors = [];
    for (const element of elements) {
      for (const edge of ["top", "bottom"]) {
        const anchor = { element, edge };
        const room = roomAhead(anchor, workZone);
        if (room >= 0 && room < targetRoom - MAX_DRIFT) {
          anchors.push(anchor);
        }
      }
    }
    return anchors.sort((a, b) => {
      const aRoom = roomAhead(a, workZone);
      const bRoom = roomAhead(b, workZone);
      if (aRoom !== bRoom) return aRoom - bRoom;
      return a.edge === "bottom" ? -1 : 1;
    });
  }

  // src/app/extraction.js
  var walkway = [];
  var assetCounter = 0;
  var ASSET_MODE_SEPARATE = "separate";
  var ASSET_MODE_EMBEDDED = "embedded";
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var escapeLabel = (value) => value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
  var escapeUrl = (value) => value.replace(/>/g, "%3E");
  var escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function resetExtraction() {
    walkway = [];
    assetCounter = 0;
  }
  function compatibilityExtraction() {
    const prompts = walkway.flatMap((deck) => deck.prompts);
    const pendingImages = walkway.flatMap((deck) => deck.images);
    const pendingCanvases = walkway.flatMap((deck) => deck.canvases);
    return {
      count: prompts.length,
      users: prompts.filter((prompt) => prompt.role === "user").length,
      assistants: prompts.filter((prompt) => prompt.role === "assistant").length,
      unknown: prompts.filter(
        (prompt) => prompt.role !== "user" && prompt.role !== "assistant"
      ).length,
      images: pendingImages.length,
      canvases: pendingCanvases.length,
      markdown: prompts.map((prompt) => prompt.text).join("\n")
    };
  }
  function extractionSnapshot() {
    return {
      title: chatTitle(),
      prompts: walkway.flatMap((deck) => deck.prompts).map((prompt) => ({ ...prompt })),
      images: walkway.flatMap((deck) => deck.images).map((image) => ({ ...image })),
      canvases: walkway.flatMap((deck) => deck.canvases).map((canvas) => ({ ...canvas }))
    };
  }
  async function waitSlabReady(type, slab, {
    timeout = 3e4,
    poll = 100
  } = {}) {
    const startedAt = performance.now();
    if (type === "empty") {
      return {
        readinessMs: performance.now() - startedAt,
        decodeMs: 0
      };
    }
    const deadline = Date.now() + timeout;
    while (!isSlabReady(type, slab)) {
      if (!slab.isConnected) {
        throw new Error("Slab detached while waiting for extraction readiness.");
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${type} slab extraction readiness.`);
      }
      await sleep(poll);
    }
    const readyAt = performance.now();
    if (type === "image") {
      const image = primaryImage(slab);
      if (typeof image.decode === "function") await image.decode();
    }
    return {
      readinessMs: readyAt - startedAt,
      decodeMs: performance.now() - readyAt
    };
  }
  async function compileDeck(deck, slabs) {
    const unit = {
      turnId: deck.getAttribute("data-turn-id-container"),
      height: null,
      prompts: [],
      images: [],
      canvases: []
    };
    for (const slab of [...slabs].reverse()) {
      const type = slabType(slab);
      if (!isSlabReady(type, slab)) {
        const id = slab.getAttribute?.("data-message-id") ?? slab.id ?? "synthetic";
        throw new Error(
          `Cannot compile unready ${type} slab ${id}.`
        );
      }
      const prompt = promptFrom(type, slab, unit);
      if (prompt) unit.prompts.push(prompt);
    }
    unit.height = deck.getBoundingClientRect().height;
    return unit;
  }
  function compiledDeckFor(turnId) {
    return walkway.find((deck) => deck.turnId === turnId) ?? null;
  }
  function storeCompiledDeck(unit) {
    const index = walkway.findIndex((deck) => deck.turnId === unit.turnId);
    if (index < 0) {
      walkway.unshift(unit);
    } else {
      walkway[index] = unit;
    }
  }
  async function exportMarkdown(snapshot, {
    assetMode = ASSET_MODE_SEPARATE,
    timestamp = Date.now()
  } = {}) {
    const output = await createMarkdownExport(snapshot, {
      assetMode,
      timestamp
    });
    for (const attachment of output.attachments) {
      downloadBlob(attachment.blob, attachment.filename);
      await sleep(300);
    }
    downloadBlob(
      new Blob(
        ["\uFEFF" + output.markdown],
        { type: "text/markdown;charset=utf-8" }
      ),
      output.filename
    );
    return output;
  }
  async function createMarkdownExport(snapshot, {
    assetMode = ASSET_MODE_SEPARATE,
    timestamp = Date.now()
  } = {}) {
    const materialized = await materializeExtraction(snapshot, {
      assetMode,
      timestamp
    });
    const { prompts, attachments, title } = materialized;
    const slug = titleSlug(title);
    const date = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const users = prompts.filter((prompt) => prompt.role === "user");
    let markdown = `# ${title}
_${users.length} user prompts \u2014 ${date}_

`;
    if (users.length) {
      markdown += "### Table of Contents\n\n";
      users.forEach((prompt, index) => {
        const firstLine = (prompt.plainText || prompt.text).split("\n").map((line) => line.replace(/[^\x20-\x7E]/g, "").trim()).find((line) => line && !line.startsWith("Upload:")) || "(empty)";
        const label = escapeLabel(firstLine.slice(0, 80));
        markdown += prompt.msgId ? `${index + 1}. [${label}](#msg-${prompt.msgId})
` : `${index + 1}. ${label}
`;
      });
      markdown += "\n";
    }
    markdown += "---\n\n";
    for (const prompt of prompts) {
      const label = prompt.role === "user" ? "### USER" : prompt.role === "assistant" ? "### ASSISTANT" : "### UNKNOWN";
      const anchor = prompt.role === "user" && prompt.msgId ? `<a id="msg-${prompt.msgId}"></a>

` : "";
      markdown += `${anchor}${label}

${prompt.text}

---

`;
    }
    return {
      markdown,
      filename: `${slug}-${timestamp}.md`,
      attachments
    };
  }
  async function materializeExtraction(snapshot, {
    assetMode = ASSET_MODE_SEPARATE,
    timestamp = Date.now()
  } = {}) {
    if (assetMode !== ASSET_MODE_SEPARATE && assetMode !== ASSET_MODE_EMBEDDED) {
      throw new Error(`Unknown asset mode: ${assetMode}.`);
    }
    const title = snapshot.title || "chat";
    const slug = titleSlug(title);
    const prompts = snapshot.prompts.map((prompt) => ({ ...prompt }));
    const canvases = snapshot.canvases.map((canvas) => ({ ...canvas }));
    const attachments = [];
    const replaceToken = (token, replacement) => {
      for (const prompt of prompts) {
        prompt.text = prompt.text.split(token).join(replacement);
      }
      for (const canvas of canvases) {
        canvas.text = canvas.text.split(token).join(replacement);
      }
    };
    for (let index = 0; index < snapshot.images.length; index++) {
      const entry = snapshot.images[index];
      let source = entry.url;
      try {
        if (assetMode === ASSET_MODE_EMBEDDED) {
          source = entry.url.startsWith("data:") ? entry.url : await blobToDataUrl(await fetchAssetBlob(entry.url));
        } else {
          const blob = await fetchAssetBlob(entry.url);
          const extension = extensionForBlob(blob);
          const filename = `${slug}-${timestamp}-img-${String(index + 1).padStart(3, "0")}.${extension}`;
          attachments.push({ blob, filename });
          source = filename;
        }
      } catch (error) {
        console.warn(
          `[dev extraction] image ${index + 1} ${assetMode === ASSET_MODE_EMBEDDED ? "embedding" : "download"} failed.`,
          error
        );
      }
      const replacement = assetMode === ASSET_MODE_EMBEDDED ? `![${escapeLabel(entry.alt)}](${escapeUrl(source)})` : separateImageMarkup(entry, source);
      replaceToken(entry.token, replacement);
    }
    for (let index = 0; index < canvases.length; index++) {
      const entry = canvases[index];
      if (assetMode === ASSET_MODE_EMBEDDED) {
        replaceToken(
          entry.token,
          `#### Canvas: ${entry.title}

${entry.text}`
        );
        continue;
      }
      const filename = `${slug}-${timestamp}-canvas-${String(index + 1).padStart(3, "0")}.md`;
      attachments.push({
        blob: new Blob(
          ["\uFEFF" + entry.text],
          { type: "text/markdown;charset=utf-8" }
        ),
        filename
      });
      replaceToken(entry.token, `[${entry.title}](${filename})`);
    }
    return {
      title,
      prompts,
      attachments
    };
  }
  function isSlabReady(type, slab) {
    if (type === "empty") return true;
    if (type === "canvas") {
      const root = canvasRoot(slab);
      return Boolean(root && dryMarkdownFor(root).trim());
    }
    if (type === "image") {
      const image = primaryImage(slab);
      return Boolean(
        image && image.getAttribute("src") && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
      );
    }
    if (type === "message") {
      const message = messageRoot(slab);
      if (!message) return false;
      const images = [...message.querySelectorAll('img:not([aria-hidden="true"])')];
      const placeholders = message.querySelectorAll(
        '[class*="skeleton"], [class*="placeholder"], [data-placeholder]'
      );
      return Boolean(
        (message.innerText.trim() || images.length) && placeholders.length === 0 && images.every((image) => image.getAttribute("src"))
      );
    }
    throw new Error(`Cannot extract unknown slab type: ${type}.`);
  }
  function promptFrom(type, slab, unit) {
    if (type === "empty") {
      const deck = slab.deck;
      return {
        role: deck?.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role") || "unknown",
        text: "*[Empty slab]*",
        plainText: "[Empty slab]",
        msgId: null,
        turnId: deck?.getAttribute("data-turn-id-container") || null
      };
    }
    if (type === "canvas") {
      const root = canvasRoot(slab);
      const text = root ? htmlToMarkdown(root, unit) : "";
      if (!text) return null;
      const titleElement = slab.querySelector(
        'span.font-semibold, [class*="font-semibold"]'
      );
      const title = (titleElement?.textContent || "Canvas document").trim();
      const token = assetToken("CANVAS");
      unit.canvases.push({ title, text, token });
      return promptIdentity(
        slab,
        token,
        title
      );
    }
    if (type === "image") {
      const image = primaryImage(slab);
      const text = image ? htmlToMarkdown(image, unit) : "";
      if (!text) return null;
      return promptIdentity(
        slab,
        text,
        image.getAttribute("alt") || "Generated image"
      );
    }
    if (type === "message") {
      const message = messageRoot(slab);
      if (!message) return null;
      const text = htmlToMarkdown(message, unit);
      if (!text) return null;
      return {
        role: message.getAttribute("data-message-author-role") || message.closest("[data-turn]")?.getAttribute("data-turn") || "unknown",
        text,
        plainText: message.innerText.trim(),
        msgId: message.getAttribute("data-message-id") || slab.getAttribute("data-message-id") || null,
        turnId: message.closest("[data-turn-id]")?.getAttribute("data-turn-id") || null
      };
    }
    throw new Error(`Cannot extract unknown slab type: ${type}.`);
  }
  function promptIdentity(slab, text, plainText) {
    const turn = slab.closest("[data-turn]");
    return {
      role: turn?.getAttribute("data-turn") || "assistant",
      text,
      plainText,
      msgId: null,
      turnId: turn?.getAttribute("data-turn-id") || null
    };
  }
  function canvasRoot(slab) {
    return slab.querySelector("#prosemirror-editor-container .ProseMirror");
  }
  function messageRoot(slab) {
    return slab.matches("[data-message-author-role]") ? slab : slab.querySelector("[data-message-author-role]");
  }
  function primaryImage(slab) {
    return slab.matches('img:not([aria-hidden="true"])') ? slab : slab.querySelector('img:not([aria-hidden="true"])');
  }
  function dryMarkdownFor(element) {
    const savedAssetCounter = assetCounter;
    const markdown = htmlToMarkdown(element, {
      images: [],
      canvases: []
    });
    assetCounter = savedAssetCounter;
    return markdown;
  }
  function htmlToMarkdown(element, unit) {
    function walk(node, depth) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text.includes("\n")) return text;
        const whiteSpace = node.parentElement ? getComputedStyle(node.parentElement).whiteSpace : "";
        if (["pre", "pre-wrap", "pre-line"].includes(whiteSpace)) {
          return text.replace(/^/gm, "    ");
        }
        return /^\s*$/.test(text) ? "" : text.replace(/\n/g, " ");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.getAttribute("aria-hidden") === "true") return "";
      if (/\bsr-only\b/.test(node.getAttribute("class") || "")) return "";
      if (node.getAttribute("data-is-code-block-view") === "true") {
        const lines = [...node.querySelectorAll(".cm-line")].map((line) => line.textContent);
        return fencedCode(lines.join("\n").trimEnd(), "");
      }
      const tag = node.tagName.toLowerCase();
      if (["script", "style", "noscript"].includes(tag)) return "";
      if (tag === "br") return "\n";
      if (tag === "hr") return "\n---\n\n";
      if (tag === "p") return children(node, depth).trim() + "\n\n";
      if (["strong", "b"].includes(tag)) return wrap(node, depth, "**");
      if (["em", "i"].includes(tag)) return wrap(node, depth, "*");
      if (["del", "s"].includes(tag)) return wrap(node, depth, "~~");
      if (/^h[1-6]$/.test(tag)) {
        return `${"#".repeat(Number(tag[1]))} ${children(node, depth).trim()}

`;
      }
      if (tag === "code") {
        if (node.closest("pre")) return node.textContent;
        const text = node.textContent;
        const fence = "`".repeat(longestRun(text, "`") + 1);
        const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
        return `${fence}${pad}${text}${pad}${fence}`;
      }
      if (tag === "pre") {
        const code = node.querySelector("code");
        const language = (code?.className || "").match(/language-(\S+)/)?.[1] || "";
        return fencedCode((code || node).textContent.trimEnd(), language);
      }
      if (tag === "blockquote") {
        return children(node, depth).trim().split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
      }
      if (tag === "ul" || tag === "ol") return list(node, depth, tag === "ol");
      if (tag === "a") {
        if (node.innerText.trim().endsWith("\u2026")) return "";
        const href = node.getAttribute("href") || "";
        const inner = children(node, depth);
        return !href || /^(#|javascript:|blob:)/i.test(href) ? inner : `[${escapeLabel(inner)}](<${escapeUrl(href)}>)`;
      }
      if (tag === "img") {
        const alt = node.getAttribute("alt") || "";
        const source = node.getAttribute("src") || "";
        if (!source) return alt ? `[image: ${escapeLabel(alt)}]` : "[image]";
        const token = assetToken("IMG");
        const rect = node.getBoundingClientRect();
        unit.images.push({
          url: source,
          token,
          alt,
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
        return token;
      }
      if (tag === "button") {
        const label2 = node.getAttribute("aria-label") || node.innerText.trim();
        return /\.\w{2,6}$/.test(label2) ? `
Upload: ${label2}

` : "";
      }
      if (tag === "table") return table(node) + "\n\n";
      const label = node.getAttribute("aria-label");
      if (node.getAttribute("role") === "group" && label && /\.\w{2,6}$/.test(label.trim())) {
        return `
Upload: ${label.trim()}

`;
      }
      return children(node, depth);
    }
    function children(node, depth) {
      return [...node.childNodes].map((child) => walk(child, depth)).join("");
    }
    function wrap(node, depth, marker) {
      const inner = children(node, depth).trim();
      return inner ? `${marker}${inner}${marker}` : "";
    }
    function list(element2, depth, ordered) {
      let number = 1;
      let output = "";
      for (const item of [...element2.children].filter((child) => child.tagName === "LI")) {
        const nested = [...item.children].filter(
          (child) => child.tagName === "UL" || child.tagName === "OL"
        );
        const inline = [...item.childNodes].filter((child) => !nested.includes(child)).map((child) => walk(child, depth + 1)).join("").trim();
        output += `${"  ".repeat(depth)}${ordered ? `${number++}.` : "-"} ${inline}
`;
        output += nested.map((child) => walk(child, depth + 1).trimEnd() + "\n").join("");
      }
      return output + "\n";
    }
    function table(element2) {
      const rows = [...element2.querySelectorAll("tr")].map(
        (row) => [...row.querySelectorAll("th,td")].map(
          (cell) => walk(cell, 0).trim().replace(/\|/g, "\\|").replace(/\n/g, " ")
        )
      );
      if (!rows[0]?.length) return "";
      return [
        `| ${rows[0].join(" | ")} |`,
        `| ${rows[0].map(() => "---").join(" | ")} |`,
        ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`)
      ].join("\n");
    }
    return walk(element, 0).trim().replace(/\n{3,}/g, "\n\n");
  }
  function assetToken(kind) {
    return `__${kind}_PLACEHOLDER_${++assetCounter}__`;
  }
  function fencedCode(text, language) {
    const fence = "`".repeat(Math.max(3, longestRun(text, "`") + 1));
    return `
${fence}${language}
${text}
${fence}

`;
  }
  function longestRun(text, character) {
    return Math.max(0, ...[...text.matchAll(new RegExp(`${character}+`, "g"))].map((match) => match[0].length));
  }
  function chatTitle() {
    return document.title.replace(/\s*[|–—-]\s*ChatGPT\s*$/i, "").trim() || "chat";
  }
  function titleSlug(title) {
    return title.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "chat";
  }
  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result), {
        once: true
      });
      reader.addEventListener("error", () => reject(reader.error), {
        once: true
      });
      reader.readAsDataURL(blob);
    });
  }
  async function fetchAssetBlob(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  }
  function extensionForBlob(blob) {
    return (blob.type.split("/")[1] || "png").split(";")[0].replace("jpeg", "jpg");
  }
  function separateImageMarkup(entry, source) {
    const dimensions = entry.width > 0 && entry.height > 0 ? ` width="${entry.width}" height="${entry.height}"` : "";
    const escapedSource = escapeHtml(source);
    return `<a href="${escapedSource}" target="_blank" rel="noopener"><img src="${escapedSource}" alt="${escapeHtml(entry.alt)}"${dimensions}></a>`;
  }

  // src/app/supplyWorker.js
  var supplier;
  var currentDeck;
  var currentSlab;
  var currentAnchor;
  var savedDeckActivationStatus;
  function resetSupplyWorker() {
    supplier = observeSupplier();
    currentDeck = null;
    currentSlab = null;
    currentAnchor = null;
    savedDeckActivationStatus = null;
  }
  async function compileCurrentDeck() {
    const deck = retainedDeck();
    const unit = await compileDeck(deck, getSlabsIn(deck));
    storeCompiledDeck(unit);
  }
  async function waitCurrentSlabReady() {
    const { workZone } = environment();
    const deck = retainedDeck();
    const slab = retainedSlab();
    const type = slabType(slab);
    const readiness = await waitSlabReady(type, slab);
    return {
      slabRoom: slabGeometry(slab, workZone).room,
      deckRoom: deckGeometry(deck, workZone).room
    };
  }
  async function checkUpdateNeededBeforeDeactivation(jump) {
    const { activeArea, workZone } = environment();
    const deactivationBoundary = workZoneTop(workZone) + workZone.height + MIN_ACTIVATION_DISTANCE;
    const predictedDecks = [];
    const decks = elementsIn(
      activeArea,
      '[data-turn-id-container][data-is-intersecting]:not([data-is-intersecting="false"])'
    );
    for (const deck of decks) {
      const rect = deck.getBoundingClientRect();
      const topAfterJump = rect.top + jump;
      if (rect.top >= deactivationBoundary - TOLERATED_ROUNDING || topAfterJump < deactivationBoundary - TOLERATED_ROUNDING) {
        continue;
      }
      predictedDecks.push(deck);
      const updated = isUpdated(deck);
      if (updated) await replaceByUpdate(deck);
    }
    return predictedDecks;
  }
  function isUpdated(deck) {
    const turnId = deck.getAttribute("data-turn-id-container");
    const previous = compiledDeckFor(turnId);
    if (!previous) {
      throw new Error(
        `No compiled walkway unit for deck ${turnId}.`
      );
    }
    const height = deck.getBoundingClientRect().height;
    if (height < previous.height - TOLERATED_ROUNDING) {
      throw new Error(
        `Deck ${turnId} height decreased from ${previous.height} to ${height}.`
      );
    }
    return height > previous.height + TOLERATED_ROUNDING;
  }
  async function replaceByUpdate(deck) {
    const unit = await compileDeck(deck, getSlabsIn(deck));
    storeCompiledDeck(unit);
  }
  async function selectNextDeckRoom(area) {
    const { supplyArea, activeArea, workZone } = environment();
    const decks = getDecks(supplyArea);
    const candidates = decks.filter((candidate) => {
      const geometry = deckGeometry(candidate, workZone);
      return geometry.bottomRoom >= area.top && geometry.room <= area.bottom;
    });
    const deck = closestDeck(area.bottom, candidates, workZone);
    if (deck == null) return null;
    currentDeck = deck;
    currentSlab = null;
    currentAnchor = null;
    await waitDeckActive(deck, activeArea);
    return deckGeometry(deck, workZone).room;
  }
  function selectNextSlabRoom(slabRoom2, deckRoom2) {
    const { workZone } = environment();
    const deck = retainedDeck();
    const area = areaAhead(slabRoom2, MAX_SLAB_GAP);
    const slabs = getSlabsIn(deck);
    const candidates = slabs.filter((candidate) => {
      const geometry = slabGeometry(candidate, workZone);
      return geometry.bottomRoom >= area.top && geometry.room <= area.bottom;
    });
    const slab = closestSlab(area.bottom, candidates, workZone);
    if (slab == null) return null;
    currentSlab = slab;
    currentAnchor = null;
    return slabGeometry(slab, workZone).room;
  }
  function retainedDeck() {
    if (!currentDeck) throw new Error("No current deck.");
    return currentDeck;
  }
  function getDecks(supplyArea) {
    const byId = /* @__PURE__ */ new Map();
    for (const element of elementsIn(
      supplyArea,
      "[data-turn-id-container]"
    )) {
      const rect = element.getBoundingClientRect();
      if (rect.height === 0) continue;
      const id = element.getAttribute("data-turn-id-container");
      const existing = byId.get(id);
      if (!existing || element.contains(existing)) {
        byId.set(id, element);
      }
    }
    return Array.from(byId.values()).sort((first, second) => {
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      return secondRect.bottom - firstRect.bottom;
    });
  }
  function viewportHeight() {
    return environment().workZone.height;
  }
  async function selectAnchor() {
    const { activeArea, supplyArea, workZone } = environment();
    while (true) {
      const {
        anchors,
        rejectedAcrossInactiveDecks
      } = anchorCandidates(activeArea, supplyArea, workZone);
      const tentativeAnchor = anchors.sort((first, second) => {
        const firstRoom = roomAhead(first, workZone);
        const secondRoom = roomAhead(second, workZone);
        return Math.abs(firstRoom) - Math.abs(secondRoom);
      })[0] ?? null;
      if (!tentativeAnchor) {
        throw new Error(
          rejectedAcrossInactiveDecks.length > 0 ? "No anchor can reach the current slab without crossing a DOM-inactive deck." : "No ready anchor found near the viewport top."
        );
      }
      const pathSlabs = slabsBetweenCurrentAndAnchor(
        tentativeAnchor,
        supplyArea
      );
      if (pathSlabs == null) {
        throw new Error(
          "Cannot enumerate slabs between the current slab and the tentative anchor."
        );
      }
      const unreadySlabs = pathSlabs.filter((slab) => {
        const type = slabType(slab);
        return !isSlabReady(type, slab);
      });
      if (unreadySlabs.length === 0) {
        currentAnchor = tentativeAnchor;
        return roomAhead(currentAnchor, workZone);
      }
      for (const slab of unreadySlabs) {
        const type = slabType(slab);
        await waitSlabReady(type, slab);
      }
      await nextAnimationFrame();
    }
  }
  function anchorCandidates(activeArea, supplyArea, workZone) {
    const anchors = [];
    const rejectedAcrossInactiveDecks = [];
    for (const deck of elementsIn(
      activeArea,
      '[data-turn-id-container][data-is-intersecting="true"]'
    )) {
      for (const slab of getSlabsIn(deck)) {
        const anchor = getNextAnchorIn(slab, workZone);
        if (!anchor) continue;
        const rect = anchor.element.getBoundingClientRect();
        const viewportTop = workZoneTop(workZone);
        const viewportBottom = viewportTop + workZone.height;
        if (rect.bottom < viewportTop || rect.top > viewportBottom) {
          continue;
        }
        const interveningDecks = decksBetweenAnchorAndCurrentSlab(
          anchor,
          supplyArea
        );
        if (interveningDecks == null) {
          rejectedAcrossInactiveDecks.push({
            anchorDeckId: activationDeckForAnchor(anchor)?.getAttribute("data-turn-id-container") ?? null,
            currentDeckId: retainedDeck().getAttribute("data-turn-id-container"),
            inactiveDeckIds: [],
            unresolvedDeckPath: true
          });
          continue;
        }
        const inactiveDecks = interveningDecks.filter(
          (candidate) => candidate.getAttribute("data-is-intersecting") !== "true"
        );
        if (inactiveDecks.length > 0) {
          rejectedAcrossInactiveDecks.push({
            anchorDeckId: activationDeckForAnchor(anchor)?.getAttribute("data-turn-id-container") ?? null,
            currentDeckId: retainedDeck().getAttribute("data-turn-id-container"),
            inactiveDeckIds: inactiveDecks.map(
              (candidate) => candidate.getAttribute("data-turn-id-container")
            )
          });
          continue;
        }
        anchors.push(anchor);
      }
    }
    return { anchors, rejectedAcrossInactiveDecks };
  }
  function slabsBetweenCurrentAndAnchor(anchor, supplyArea) {
    const decks = decksBetweenAnchorAndCurrentSlab(anchor, supplyArea);
    if (decks == null) return null;
    const current = retainedSlab();
    const currentRect = current.getBoundingClientRect();
    const anchorRect = anchor.element.getBoundingClientRect();
    const anchorPosition = anchor.edge === "bottom" ? anchorRect.bottom : anchorRect.top;
    const currentPosition = currentRect.top;
    const pathTop = Math.min(anchorPosition, currentPosition);
    const pathBottom = Math.max(anchorPosition, currentPosition);
    const slabs = [];
    for (const deck of decks) {
      for (const slab of getSlabsIn(deck)) {
        const rect = slab.getBoundingClientRect();
        if (slab !== current && (rect.bottom < pathTop || rect.top > pathBottom)) {
          continue;
        }
        if (!slabs.includes(slab)) slabs.push(slab);
      }
    }
    if (!slabs.includes(current)) slabs.push(current);
    slabs.sort(
      (first, second) => second.getBoundingClientRect().bottom - first.getBoundingClientRect().bottom
    );
    return slabs;
  }
  function decksBetweenAnchorAndCurrentSlab(anchor, supplyArea) {
    const anchorDeck = activationDeckForAnchor(anchor);
    const slabDeck = retainedDeck();
    if (anchorDeck == null) return [slabDeck];
    if (anchorDeck === slabDeck) return [slabDeck];
    const decks = getDecks(supplyArea);
    const anchorIndex = decks.indexOf(anchorDeck);
    const slabIndex = decks.indexOf(slabDeck);
    if (anchorIndex < 0 || slabIndex < 0) {
      return null;
    }
    return decks.slice(
      Math.min(anchorIndex, slabIndex),
      Math.max(anchorIndex, slabIndex) + 1
    );
  }
  function activationDeckForAnchor(anchor) {
    return anchor.element.closest?.(
      "[data-turn-id-container][data-is-intersecting]"
    ) ?? anchor.element.deck ?? null;
  }
  function anchorRoom() {
    const { workZone } = environment();
    return roomAhead(retainedAnchor(), workZone);
  }
  function slabRoom() {
    const { workZone } = environment();
    return roomAhead(
      { element: retainedSlab(), edge: "top" },
      workZone
    );
  }
  function deckRoom() {
    const { workZone } = environment();
    return roomAhead(
      { element: retainedDeck(), edge: "top" },
      workZone
    );
  }
  function supplyRoom() {
    const { supplyArea, workZone } = environment();
    return workZonePosition(supplyArea, workZone);
  }
  function supplyHeight2() {
    return supplyHeight(environment().supplyArea);
  }
  function roomUntilFirstNotReadyDeck() {
    const { activeArea, workZone } = environment();
    return measureRoomUntilFirstNotReadyDeck(activeArea, workZone);
  }
  function roomUntilFirstActiveDeckBelow() {
    const { activeArea, workZone } = environment();
    return measureRoomUntilFirstActiveDeckBelow(activeArea, workZone);
  }
  function thresholdDeckSnapshot() {
    const { activeArea, workZone } = environment();
    const viewportTop = workZoneTop(workZone);
    const viewportHeight2 = workZone.height;
    const decks = /* @__PURE__ */ new Map();
    for (const deck of elementsIn(
      activeArea,
      "div[data-turn-id-container]"
    )) {
      const rect = deck.getBoundingClientRect();
      decks.set(deck, {
        turnId: deck.getAttribute("data-turn-id-container"),
        state: deck.getAttribute("data-is-intersecting"),
        top: rect.top - viewportTop,
        bottom: rect.bottom - viewportTop,
        height: rect.height
      });
    }
    return {
      decks,
      viewportHeight: viewportHeight2
    };
  }
  function deckActivationTransitions(current) {
    const activations = [];
    const deactivations = [];
    const previous = savedDeckActivationStatus;
    if (!previous) return { activations, deactivations };
    for (const [deck, currentDeck2] of current.decks) {
      const previousDeck = previous.decks.get(deck);
      if (!previousDeck || previousDeck.state === currentDeck2.state) {
        continue;
      }
      const transition = {
        deck,
        turnId: currentDeck2.turnId,
        location: deckLocation(
          previousDeck,
          previous.viewportHeight
        ),
        previous: previousDeck,
        current: currentDeck2
      };
      if (previousDeck.state !== "true" && currentDeck2.state === "true") {
        activations.push(transition);
      }
      if (previousDeck.state === "true" && currentDeck2.state === "false") {
        deactivations.push(transition);
      }
    }
    return { activations, deactivations };
  }
  function saveDeckActivationStatus(status) {
    savedDeckActivationStatus = status;
  }
  function deckLocation(deck, viewportHeight2) {
    if (deck.bottom <= 0) return "above";
    if (deck.top >= viewportHeight2) return "below";
    return "viewport";
  }
  async function moveWorkZoneBy(jump) {
    const { supplyArea, workZone } = environment();
    await nextAnimationFrame();
    moveWorkZone(jump, supplyArea, workZone);
  }
  function closestDeck(referenceRoom, candidates, workZone) {
    let selected = null;
    let smallestGap = Infinity;
    for (const candidate of candidates) {
      const gap = referenceRoom - deckGeometry(candidate, workZone).bottomRoom;
      if (gap < -ADJACENCY_OVERLAP_TOLERANCE) continue;
      if (gap >= smallestGap) continue;
      smallestGap = gap;
      selected = candidate;
    }
    return selected;
  }
  function deckGeometry(deck, workZone) {
    return {
      room: roomAhead({ element: deck, edge: "top" }, workZone),
      bottomRoom: roomAhead(
        { element: deck, edge: "bottom" },
        workZone
      )
    };
  }
  function isDeckActive(deck, activeArea) {
    return contains(activeArea, deck) && deck.dataset.isIntersecting !== void 0 && deck.dataset.isIntersecting !== "false";
  }
  async function waitDeckActive(deck, activeArea, {
    timeout = 1e4,
    poll = 100
  } = {}) {
    if (isDeckActive(deck, activeArea)) return;
    const deadline = Date.now() + timeout;
    while (!isDeckActive(deck, activeArea)) {
      if (!deck.isConnected) {
        throw new Error(
          "Deck detached while waiting for readiness."
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting for deck activation."
        );
      }
      await new Promise(
        (resolve) => setTimeout(resolve, poll)
      );
    }
  }
  function closestSlab(referenceRoom, candidates, workZone) {
    let selected = null;
    let smallestGap = Infinity;
    for (const candidate of candidates) {
      const gap = referenceRoom - slabGeometry(candidate, workZone).bottomRoom;
      if (gap < -ADJACENCY_OVERLAP_TOLERANCE) continue;
      if (gap >= smallestGap) continue;
      smallestGap = gap;
      selected = candidate;
    }
    return selected;
  }
  function slabGeometry(slab, workZone) {
    return {
      room: roomAhead({ element: slab, edge: "top" }, workZone),
      bottomRoom: roomAhead(
        { element: slab, edge: "bottom" },
        workZone
      )
    };
  }
  function getSlabsIn(deck) {
    const slabs = [];
    for (const message of deck.querySelectorAll("[data-message-id]")) {
      slabs.push(message);
    }
    for (const image of deck.querySelectorAll(".group\\/imagegen-image")) {
      slabs.push(image);
    }
    for (const canvas of deck.querySelectorAll('[id^="textdoc-message-"]')) {
      slabs.push(canvas);
    }
    if (slabs.length === 0) {
      slabs.push(makeEmptySlab(deck));
    }
    slabs.sort((first, second) => {
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      return secondRect.bottom - firstRect.bottom;
    });
    return slabs;
  }
  function makeEmptySlab(deck) {
    return {
      deck,
      getBoundingClientRect() {
        const rect = deck.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.top,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: 0
        };
      }
    };
  }
  function measureRoomUntilFirstNotReadyDeck(activeArea, workZone) {
    const viewportBoundary = workZoneTop(workZone);
    let roomUntilFirstNotReadyDeck2 = Infinity;
    for (const deck of elementsIn(
      activeArea,
      '[data-turn-id-container][data-is-intersecting="false"]'
    )) {
      const rect = deck.getBoundingClientRect();
      const isAhead = rect.top < viewportBoundary;
      if (!isAhead) continue;
      const roomUntilDeck = viewportBoundary - rect.bottom;
      roomUntilFirstNotReadyDeck2 = Math.min(
        roomUntilFirstNotReadyDeck2,
        roomUntilDeck
      );
    }
    return roomUntilFirstNotReadyDeck2;
  }
  function measureRoomUntilFirstActiveDeckBelow(activeArea, workZone) {
    const viewportBoundary = workZoneTop(workZone) + workZone.height;
    let roomUntilFirstActiveDeckBelow2 = Infinity;
    for (const deck of elementsIn(
      activeArea,
      '[data-turn-id-container][data-is-intersecting="true"]'
    )) {
      const rect = deck.getBoundingClientRect();
      if (rect.top < viewportBoundary) continue;
      const roomUntilDeck = rect.top - viewportBoundary;
      roomUntilFirstActiveDeckBelow2 = Math.min(
        roomUntilFirstActiveDeckBelow2,
        roomUntilDeck
      );
    }
    return roomUntilFirstActiveDeckBelow2;
  }
  function environment() {
    if (!supplier) resetSupplyWorker();
    return supplier;
  }
  function retainedSlab() {
    if (!currentSlab) throw new Error("No current slab.");
    if (!currentSlab.isConnected && currentSlab.matches) {
      throw new Error("Current slab was disconnected during movement.");
    }
    return currentSlab;
  }
  function retainedAnchor() {
    if (!currentAnchor) throw new Error("No current anchor.");
    return currentAnchor;
  }

  // src/app/getNextDeckIn.js
  function getNextDeckRoomIn(deckRoom2) {
    return selectNextDeckRoom(
      areaAhead(deckRoom2, MAX_DECK_GAP)
    );
  }

  // src/app/waitLayoutStable.js
  async function waitLayoutStable({
    maxFrames = MAX_FRAMES_FOR_STABILIZATION,
    trackAnchor = false
  } = {}) {
    const activationDistanceAbove = roomUntilFirstNotReadyDeck();
    const deactivationDistanceBelow = roomUntilFirstActiveDeckBelow();
    const activationNear = activationDistanceAbove <= MIN_ACTIVATION_DISTANCE;
    const deactivationNear = deactivationDistanceBelow <= MIN_ACTIVATION_DISTANCE;
    const stableFrames = trackAnchor && !activationNear ? 1 : 2;
    let previous = geometrySnapshot();
    let previousRafGeometry = previous;
    let unchanged = 0;
    saveDeckActivationStatus(thresholdDeckSnapshot());
    for (let frame = 0; frame < maxFrames; frame++) {
      await nextAnimationFrame();
      const currentGeometry = geometrySnapshot();
      const deckStatus = thresholdDeckSnapshot();
      const deckTransitions = deckActivationTransitions(deckStatus);
      saveDeckActivationStatus(deckStatus);
      const scrollHeightChange = Math.abs(
        currentGeometry.scrollHeight - previous.scrollHeight
      );
      const scrollYChange = Math.abs(
        currentGeometry.scrollY - previous.scrollY
      );
      const effectiveScrollHeightChange = scrollHeightChange < TOLERATED_ROUNDING ? 0 : scrollHeightChange;
      const geometryChangeMagnitude = Math.max(
        effectiveScrollHeightChange,
        scrollYChange
      );
      const geometryChanged = geometryChangeMagnitude !== 0;
      const positionAtFrame = trackAnchor ? anchorRoom() : null;
      const previousRafScrollHeightChange = Math.abs(
        currentGeometry.scrollHeight - previousRafGeometry.scrollHeight
      );
      const previousRafScrollYChange = Math.abs(
        currentGeometry.scrollY - previousRafGeometry.scrollY
      );
      const ignoredRafContext = {
        currentGeometry,
        previousRafGeometry,
        previousRafScrollHeightChange,
        previousRafScrollYChange,
        acceptedGeometry: previous,
        acceptedScrollHeightChange: scrollHeightChange,
        acceptedScrollYChange: scrollYChange
      };
      previousRafGeometry = currentGeometry;
      if (shouldIgnoreRaf(deckTransitions)) {
        warnIgnoredDeckTransitions(
          deckTransitions,
          frame + 1,
          ignoredRafContext
        );
        continue;
      }
      if (geometryChanged) {
        previous = currentGeometry;
        unchanged = 0;
        continue;
      }
      const anchorStable = await checkAnchorAcrossYields(
        trackAnchor,
        positionAtFrame
      );
      if (!anchorStable) {
        previous = currentGeometry;
        unchanged = 0;
        continue;
      }
      unchanged++;
      if (unchanged >= stableFrames) {
        return;
      }
    }
    throw new Error(
      `Exceeded ${maxFrames} frames waiting for layout stabilization.`
    );
  }
  function shouldIgnoreRaf({ activations, deactivations }) {
    return activations.some(({ location }) => location === "below") || deactivations.some(({ location }) => location === "above");
  }
  function warnIgnoredDeckTransitions({ activations, deactivations }, frame, geometry) {
    const ignoredTransitions = [
      ...activations.filter(({ location }) => location === "below").map((transition) => ({
        turnId: transition.turnId,
        transition: "activation-below",
        previous: transitionGeometry(transition.previous),
        current: transitionGeometry(transition.current)
      })),
      ...deactivations.filter(({ location }) => location === "above").map((transition) => ({
        turnId: transition.turnId,
        transition: "deactivation-above",
        previous: transitionGeometry(transition.previous),
        current: transitionGeometry(transition.current)
      }))
    ];
    console.warn(
      "[stabilization] Ignored rAF with reverse deck transition.\n" + JSON.stringify({
        frame,
        geometry,
        transitions: ignoredTransitions
      }, null, 2)
    );
  }
  function transitionGeometry(deck) {
    return {
      state: deck.state,
      top: deck.top,
      bottom: deck.bottom,
      height: deck.height
    };
  }
  function geometrySnapshot() {
    return {
      scrollHeight: supplyHeight2(),
      scrollY: supplyRoom()
    };
  }
  async function checkAnchorAcrossYields(trackAnchor, positionAtFrame) {
    let previousPosition = positionAtFrame;
    let stable = true;
    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {
      await yieldToScheduler();
      const position = trackAnchor ? anchorRoom() : null;
      const change = position == null || previousPosition == null ? 0 : Math.abs(position - previousPosition);
      const changed = change !== 0;
      if (changed) stable = false;
      previousPosition = position;
    }
    return stable;
  }
  async function yieldToScheduler() {
    if (typeof globalThis.scheduler?.yield === "function") {
      await globalThis.scheduler.yield();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // src/app/moveAnchorToBottom.js
  async function moveAnchorToBottom(initialRoom, viewportHeight2, calibratedJump = CALIBRATED_JUMP, slabDestination = -MIN_INTERSECT) {
    const currentSupplyRoom = supplyRoom();
    if (currentSupplyRoom <= 0) {
      return initialRoom;
    }
    let room = initialRoom;
    let currentSlabRoom = slabRoom();
    let retriedErasedJump = false;
    let anchorAtBottom = isAtBottom(viewportHeight2, room);
    let slabAtDestination = isAtDestination(
      slabDestination,
      currentSlabRoom
    );
    if (anchorAtBottom || slabAtDestination) {
      return room;
    }
    while (!anchorAtBottom && !slabAtDestination) {
      const supplyRoomBefore = supplyRoom();
      if (supplyRoomBefore <= 0) {
        return room;
      }
      const jump = clampJump(
        calibratedJump,
        room,
        currentSlabRoom,
        viewportHeight2,
        slabDestination
      );
      const predictedDeactivationDecks = await checkUpdateNeededBeforeDeactivation(jump);
      await moveWorkZoneBy(jump);
      const supplyRoomAfter = supplyRoom();
      if (supplyRoomAfter === supplyRoomBefore) {
        break;
      }
      await waitLayoutStable({ trackAnchor: true });
      const obtainedRoom = anchorRoom();
      const jumpWasErased = obtainedRoom === room;
      if (jumpWasErased && retriedErasedJump) {
        throw new Error(
          `Anchor made no progress after retrying an erased jump at room=${room}.`
        );
      }
      retriedErasedJump = jumpWasErased;
      room = obtainedRoom;
      currentSlabRoom = slabRoom();
      anchorAtBottom = isAtBottom(viewportHeight2, room);
      slabAtDestination = isAtDestination(
        slabDestination,
        currentSlabRoom
      );
    }
    return room;
  }
  function clampJump(calibratedJump, anchorRoom2, slabTopRoom, viewportHeight2, slabDestination = -MIN_INTERSECT) {
    const targetRoom = viewportHeight2 - MIN_INTERSECT;
    return Math.min(
      calibratedJump,
      targetRoom - anchorRoom2,
      slabDestination - slabTopRoom
    );
  }
  function isAtBottom(viewportHeight2, room) {
    const targetRoom = viewportHeight2 - MIN_INTERSECT;
    return isAtDestination(targetRoom, room);
  }
  function isAtDestination(destination, room) {
    return room >= destination - TOLERATED_ROUNDING;
  }

  // src/app/moveSlabTopToBottom.js
  async function moveSlabTopToBottom(initialSlabRoom) {
    const height = viewportHeight();
    const destination = -MIN_INTERSECT;
    let room = initialSlabRoom;
    while (!isAtDestination(destination, room)) {
      const previousRoom = room;
      const selectedAnchorRoom = await selectAnchor();
      await moveAnchorToBottom(
        selectedAnchorRoom,
        height
      );
      room = slabRoom();
      if (room === previousRoom) break;
    }
    return {
      slabRoom: room,
      deckRoom: deckRoom()
    };
  }

  // src/app/moveViewportToDocumentBottom.js
  async function moveViewportToDocumentBottom() {
    const supplier2 = observeSupplier();
    const { supplyArea, workZone } = supplier2;
    clickBottomNavItem();
    await waitLayoutStable();
    moveWorkZoneToSupplyEnd(supplyArea, workZone);
    await waitLayoutStable();
    const decks = getDecks(supplyArea);
    const boundary = decks.length > 0 ? roomAhead({ element: decks[0], edge: "bottom" }, workZone) : workZone.height;
    return {
      room: boundary,
      deckRoom: boundary
    };
  }
  function clickBottomNavItem() {
    const items = getNavMenuItems();
    if (items.length > 0) {
      items[items.length - 1].click();
    }
  }
  function getNavMenuItems() {
    const strip = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("w-9") && d.className.includes("max-h-[50lvh]") && d.className.includes("no-scrollbar")
    );
    if (strip) {
      return [...strip.querySelectorAll("button")];
    }
    return [...document.querySelectorAll("button")].filter(
      (b) => b.className.includes("h-0.5") && b.className.includes("w-4.5") && b.className.includes("rounded-full")
    );
  }

  // src/app/mainOrchestration.js
  async function traverseConversation() {
    resetSupplyWorker();
    resetExtraction();
    const initial = await moveViewportToDocumentBottom();
    let slabRoom2 = null;
    let deckRoom2 = null;
    const initialSlabRoom = initial.room;
    const initialDeckRoom = initial.deckRoom;
    while (true) {
      if (slabRoom2 != null && slabRoom2 < MAX_SLAB_GAP) {
        ({
          slabRoom: slabRoom2,
          deckRoom: deckRoom2
        } = await moveSlabTopToBottom(
          slabRoom2
        ));
      }
      let nextSlabRoom = deckRoom2 != null && slabRoom2 - deckRoom2 >= MINIMUM_SLAB_HEIGHT ? selectNextSlabRoom(
        slabRoom2,
        deckRoom2
      ) : null;
      if (nextSlabRoom == null) {
        if (deckRoom2 != null) {
          await compileCurrentDeck();
        }
        const nextDeckRoom = await getNextDeckRoomIn(
          deckRoom2 ?? initialDeckRoom
        );
        if (nextDeckRoom == null) {
          break;
        }
        deckRoom2 = nextDeckRoom;
        nextSlabRoom = selectNextSlabRoom(
          slabRoom2 ?? initialSlabRoom,
          deckRoom2
        );
        if (nextSlabRoom == null) {
          throw new Error("No slab found in active deck.");
        }
      }
      ({
        slabRoom: nextSlabRoom,
        deckRoom: deckRoom2
      } = await waitCurrentSlabReady());
      slabRoom2 = nextSlabRoom;
    }
    const snapshot = extractionSnapshot();
    return snapshot;
  }

  // src/app/compatibility.js
  var MARKUP_PROMPT = `Create one response containing all of the following:
1. A level-2 heading named "Compatibility Results".
2. A sentence containing bold text, italic text, strikethrough text, and inline code.
3. An ordered list with three items.
4. An unordered list with three items.
5. A blockquote.
6. A table with the columns Name and Score and two data rows.
7. A fenced Python code block containing a function with a docstring.
Do not omit or combine any item.`;
  var IMAGE_PROMPT = "Generate a simple image containing only a red circle centered inside a blue square. Use a plain white background. Do not include text, labels, diagrams, or any other objects.";
  var CANVAS_PROMPT = `Use the ChatGPT Canvas tool to open and create a Canvas document titled "Extractor Compatibility Canvas". Do not provide the document only as an ordinary chat response. In the Canvas, include a heading, a paragraph, a bullet list, and a JavaScript code block.`;
  var MARKUP_CHECKS = [
    ["Heading", /^## Compatibility Results$/m],
    ["Bold", /\*\*[^*\n]+\*\*/],
    ["Italic", /(?<!\*)\*[^*\s][^*\n]*\*(?!\*)/],
    ["Strikethrough", /~~[^~\n]+~~/],
    ["Inline code", /`[^`\n]+`/],
    ["Ordered list", /^\d+\. /m],
    ["Unordered list", /^- /m],
    ["Blockquote", /^> /m],
    ["Table", /^\| .+ \|$/m],
    ["Code block", /^```+$/m]
  ];
  function showCompatibilityCheck(version) {
    const id = "dev-extractor-compatibility";
    const existing = document.getElementById(id);
    if (existing) {
      existing.remove();
      return;
    }
    const panel = document.createElement("div");
    panel.id = id;
    Object.assign(panel.style, {
      position: "fixed",
      top: "20px",
      left: "20px",
      zIndex: "99999",
      width: "460px",
      maxHeight: "85vh",
      overflowY: "auto",
      padding: "14px",
      border: "2px solid #a6e3a1",
      borderRadius: "8px",
      background: "#1e1e2e",
      color: "#cdd6f4",
      fontFamily: "monospace",
      fontSize: "11px",
      lineHeight: "1.5",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)"
    });
    const titleRow = document.createElement("div");
    Object.assign(titleRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "10px"
    });
    const title = textElement(
      "div",
      `Dev Compatibility Check v${version}`,
      { color: "#a6e3a1", fontWeight: "bold", fontSize: "13px" }
    );
    const close = button("\xD7", () => panel.remove());
    Object.assign(close.style, {
      border: "none",
      background: "none",
      color: "#a6e3a1",
      fontSize: "16px"
    });
    titleRow.append(title, close);
    const structuralHeading = heading("Structural");
    const structuralResults = document.createElement("div");
    const recheck = button(
      "Re-check structure",
      () => renderStructural(structuralResults)
    );
    const extractionHeading = heading("Latest extraction");
    const extractionResults = document.createElement("div");
    const checkExtraction = button(
      "Check extracted content",
      () => renderExtraction(extractionResults)
    );
    const conversationHeading = heading("Create a test conversation");
    const instructions = textElement(
      "div",
      "Start a new conversation and send each copied prompt as a separate user message. Run the diagnostic extractor, reopen this panel, then check the extracted content.",
      { color: "#bac2de", marginBottom: "8px" }
    );
    const prompts = [
      ["Copy markup prompt", MARKUP_PROMPT],
      ["Copy image prompt", IMAGE_PROMPT],
      ["Copy Canvas prompt*", CANVAS_PROMPT]
    ];
    const promptControls = document.createElement("div");
    for (const [label, prompt] of prompts) {
      const copy = button(label, async () => {
        await navigator.clipboard.writeText(prompt);
        const original = copy.textContent;
        copy.textContent = "Copied";
        setTimeout(() => {
          copy.textContent = original;
        }, 1200);
      });
      copy.style.marginRight = "6px";
      promptControls.appendChild(copy);
    }
    const canvasNote = textElement(
      "div",
      "* Canvas is not available in all plans. Skip this prompt when the Canvas tool is unavailable.",
      { color: "#f9e2af", marginTop: "4px" }
    );
    panel.append(
      titleRow,
      structuralHeading,
      structuralResults,
      recheck,
      extractionHeading,
      extractionResults,
      checkExtraction,
      conversationHeading,
      instructions,
      promptControls,
      canvasNote
    );
    document.body.appendChild(panel);
    renderStructural(structuralResults);
    renderExtraction(extractionResults);
  }
  function renderStructural(target) {
    target.replaceChildren();
    const container = findScrollContainer2();
    const decks = [...document.querySelectorAll("[data-turn-id-container]")];
    const activeDecks = decks.filter(
      (deck) => deck.hasAttribute("data-is-intersecting")
    );
    const navigation = navigationButtons();
    addResult(
      target,
      true,
      "Scroll container",
      container === document.documentElement ? "documentElement fallback" : `${container.tagName.toLowerCase()} scrollHeight=${container.scrollHeight}`
    );
    addResult(
      target,
      document.querySelector("[data-message-author-role]") !== null,
      "[data-message-author-role]",
      `${document.querySelectorAll("[data-message-author-role]").length} mounted`
    );
    addResult(
      target,
      document.querySelector("[data-message-id]") !== null,
      "[data-message-id]",
      `${document.querySelectorAll("[data-message-id]").length} mounted`
    );
    addResult(
      target,
      decks.length > 0,
      "[data-turn-id-container]",
      `${decks.length} mounted`
    );
    addResult(
      target,
      activeDecks.length > 0,
      "data-is-intersecting",
      `${activeDecks.length}/${decks.length} decks expose activation`
    );
    addResult(
      target,
      navigation.length > 0 ? true : null,
      "Prompt navigation",
      navigation.length > 0 ? `${navigation.length} buttons` : "not found; bottom movement still has an absolute-scroll fallback"
    );
    const generatedImages = document.querySelectorAll(
      ".group\\/imagegen-image"
    ).length;
    addResult(
      target,
      generatedImages > 0 ? true : null,
      "Generated-image selector",
      `${generatedImages} mounted now`
    );
    const canvases = document.querySelectorAll(
      '[id^="textdoc-message-"]'
    ).length;
    addResult(
      target,
      canvases > 0 ? true : null,
      "Canvas selector",
      canvases > 0 ? `${canvases} mounted now` : "not mounted or not tested"
    );
  }
  function renderExtraction(target) {
    target.replaceChildren();
    const state = compatibilityExtraction();
    if (state.count === 0) {
      addResult(target, null, "Extraction state", "run the diagnostic extractor first");
      return;
    }
    addResult(
      target,
      true,
      "Extraction state",
      `${state.count} slabs: ${state.users} user, ${state.assistants} assistant, ${state.unknown} unknown`
    );
    for (const [label, pattern] of MARKUP_CHECKS) {
      addResult(target, pattern.test(state.markdown), label);
    }
    addResult(
      target,
      state.images > 0,
      "Generated image"
    );
    addResult(
      target,
      state.canvases > 0 ? true : null,
      "Canvas document",
      state.canvases > 0 ? `${state.canvases} extracted` : "not present or not tested"
    );
  }
  function findScrollContainer2() {
    const message = document.querySelector("[data-message-author-role]");
    let element = message?.parentElement;
    while (element && element !== document.body) {
      const overflow = getComputedStyle(element).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight) {
        return element;
      }
      element = element.parentElement;
    }
    return document.documentElement;
  }
  function navigationButtons() {
    const strip = [...document.querySelectorAll("div")].find(
      (element) => element.className.includes("w-9") && element.className.includes("max-h-[50lvh]") && element.className.includes("no-scrollbar")
    );
    if (strip) return [...strip.querySelectorAll("button")];
    return [...document.querySelectorAll("button")].filter(
      (element) => element.className.includes("h-0.5") && element.className.includes("w-4.5") && element.className.includes("rounded-full")
    );
  }
  function addResult(target, status, label, detail = "") {
    const row = document.createElement("div");
    const marker = status === null ? "[?]" : status ? "[\u2713]" : "[\u2717]";
    const color = status === null ? "#f9e2af" : status ? "#a6e3a1" : "#f38ba8";
    row.append(
      textElement("span", marker, { color, fontWeight: "bold" }),
      document.createTextNode(` ${label}`)
    );
    target.appendChild(row);
    if (detail) {
      target.appendChild(textElement(
        "div",
        `    ${detail}`,
        { color: "#6c7086", marginBottom: "2px", wordBreak: "break-word" }
      ));
    }
  }
  function heading(label) {
    return textElement(
      "div",
      `\u2500\u2500 ${label} \u2500\u2500`,
      { color: "#89b4fa", marginTop: "10px", marginBottom: "6px" }
    );
  }
  function button(label, action) {
    const element = document.createElement("button");
    element.textContent = label;
    element.onclick = action;
    Object.assign(element.style, {
      padding: "4px 8px",
      marginTop: "6px",
      marginBottom: "6px",
      border: "1px solid #585b70",
      borderRadius: "4px",
      background: "#313244",
      color: "#cdd6f4",
      cursor: "pointer",
      fontFamily: "monospace",
      fontSize: "10px"
    });
    return element;
  }
  function textElement(tag, text, style = {}) {
    const element = document.createElement(tag);
    element.textContent = text;
    Object.assign(element.style, style);
    return element;
  }

  // src/app/installExtractorApp.js
  function installExtractorApp({
    version,
    runLabel,
    embeddedRunLabel,
    compatibilityLabel,
    logPrefix
  }) {
    const VERSION2 = version;
    console.log(`[${logPrefix}] loaded, version ${VERSION2}`);
    let activeRuns = 0;
    const runTraversal = async (assetMode = ASSET_MODE_SEPARATE) => {
      if (activeRuns > 0) {
        console.log(`[${logPrefix}] ignored: a traversal is already in progress.`);
        return;
      }
      activeRuns++;
      console.log(`[${logPrefix}] started.`);
      try {
        const snapshot = await traverseConversation();
        await exportMarkdown(snapshot, { assetMode });
        console.log(`[${logPrefix}] finished.`);
      } catch (error) {
        console.error(`[${logPrefix}] failed.`, error);
        throw error;
      } finally {
        activeRuns--;
      }
    };
    const menuLabel = `${runLabel} v${VERSION2}`;
    const embeddedMenuLabel = `${embeddedRunLabel} v${VERSION2}`;
    const registerMenuCommand = typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : typeof GM !== "undefined" && typeof GM.registerMenuCommand === "function" ? GM.registerMenuCommand.bind(GM) : null;
    if (registerMenuCommand) {
      registerMenuCommand(
        menuLabel,
        () => runTraversal(ASSET_MODE_SEPARATE)
      );
      registerMenuCommand(
        embeddedMenuLabel,
        () => runTraversal(ASSET_MODE_EMBEDDED)
      );
      registerMenuCommand(
        `${compatibilityLabel} v${VERSION2}`,
        () => showCompatibilityCheck(VERSION2)
      );
      console.log(`[${logPrefix}] menu command registered: ${menuLabel}`);
    } else {
      console.log(
        `[${logPrefix}] cannot register menu command: neither GM_registerMenuCommand nor GM.registerMenuCommand is available.`
      );
    }
  }

  // src/bootstrap.js
  var VERSION = true ? "5.71" : "unbuilt";
  var install = () => installExtractorApp({
    version: VERSION,
    runLabel: "Run extractor",
    embeddedRunLabel: "Run extractor (embedded)",
    compatibilityLabel: "Compatibility check",
    logPrefix: "extractor"
  });
  if (document.readyState === "complete") {
    install();
  } else {
    window.addEventListener("load", install, { once: true });
  }
})();
