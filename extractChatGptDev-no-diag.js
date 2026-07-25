// ==UserScript==
// @name         ChatGPT Chat Extractor (dev, no diagnostics)
// @namespace    http://tampermonkey.net/
// @version      2.20-no-diag
// @description  Extracts ChatGPT conversations with the geometric traversal.
// @author       Claude
// @match        https://chatgpt.com/*
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  // src/dev/constants-no-diag.js
  var MINIMUM_SLAB_HEIGHT = 90;
  var MIN_INTERSECT = 80;
  var TOLERATED_ROUNDING = 1;
  var MAX_SLAB_GAP = 160;
  var MAX_DECK_GAP = 20;
  var CALIBRATED_JUMP = 480;
  var MAX_DRIFT = 2;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;
  var ACTIVATION_DISTANCE = 1e3;
  var MAX_FRAMES_FOR_STABILIZATION = 3e3;

  // src/dev/geometry-no-diag.js
  function areaAhead(referenceTop, maxGap) {
    return {
      top: referenceTop - maxGap,
      bottom: referenceTop
    };
  }

  // src/dev/slabType-no-diag.js
  function slabType(slab) {
    if (!slab?.matches) return "empty";
    if (slab.matches(".group\\/imagegen-image")) return "image";
    if (slab.id?.startsWith("textdoc-message-")) return "canvas";
    if (slab.matches("[data-message-id]")) return "message";
    return "unknown";
  }

  // src/dev/scrollContainer-no-diag.js
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

  // src/dev/boundary-no-diag.js
  function boundaryOf(element, edge) {
    return { element, edge };
  }

  // src/dev/getNextAnchorIn-no-diag.js
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
      return boundaryOf(slab, "top");
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
      const anchor = boundaryOf(candidate, "top");
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
        const anchor = boundaryOf(element, edge);
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

  // src/dev/extraction-no-diag.js
  var prompts = [];
  var pendingImages = [];
  var pendingCanvases = [];
  var imageCounter = 0;
  var canvasCounter = 0;
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var escapeLabel = (value) => value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
  var escapeUrl = (value) => value.replace(/>/g, "%3E");
  var escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function resetExtraction() {
    prompts = [];
    pendingImages = [];
    pendingCanvases = [];
    imageCounter = 0;
    canvasCounter = 0;
  }
  async function waitSlabReady(type, slab, {
    timeout = 3e4,
    poll = 100
  } = {}) {
    if (type === "empty") return;
    const deadline = Date.now() + timeout;
    while (!slabReady(type, slab)) {
      if (!slab.isConnected) {
        throw new Error("Slab detached while waiting for extraction readiness.");
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${type} slab extraction readiness.`);
      }
      await sleep(poll);
    }
    if (type === "image") {
      const image = primaryImage(slab);
      if (typeof image.decode === "function") await image.decode();
    }
  }
  function extractSlab(type, slab) {
    const prompt = promptFrom(type, slab);
    if (prompt) prompts.unshift(prompt);
  }
  async function exportMarkdown(timestamp = Date.now()) {
    const title = chatTitle();
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
    for (let index = 0; index < pendingImages.length; index++) {
      const entry = pendingImages[index];
      let filename = escapeHtml(entry.url);
      try {
        const response = await fetch(entry.url, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const extension = (blob.type.split("/")[1] || "png").split(";")[0].replace("jpeg", "jpg");
        filename = `${slug}-${timestamp}-img-${String(index + 1).padStart(3, "0")}.${extension}`;
        downloadBlob(blob, filename);
        await sleep(300);
      } catch (error) {
        console.warn(`[dev extraction] image ${index + 1} download failed.`, error);
      }
      markdown = markdown.split(entry.token).join(filename);
    }
    for (let index = 0; index < pendingCanvases.length; index++) {
      const entry = pendingCanvases[index];
      const filename = `${slug}-${timestamp}-canvas-${String(index + 1).padStart(3, "0")}.md`;
      downloadBlob(
        new Blob(["\uFEFF" + entry.text], { type: "text/markdown;charset=utf-8" }),
        filename
      );
      markdown = markdown.split(entry.token).join(filename);
      await sleep(300);
    }
    downloadBlob(
      new Blob(["\uFEFF" + markdown], { type: "text/markdown;charset=utf-8" }),
      `${slug}-${timestamp}.md`
    );
  }
  function slabReady(type, slab) {
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
  function promptFrom(type, slab) {
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
      const text = root ? htmlToMarkdown(root) : "";
      if (!text) return null;
      const titleElement = slab.querySelector(
        'span.font-semibold, [class*="font-semibold"]'
      );
      const title = (titleElement?.textContent || "Canvas document").trim();
      const token = `__CANVAS_PLACEHOLDER_${++canvasCounter}__`;
      pendingCanvases.push({ text, token });
      return promptIdentity(
        slab,
        `[${title}](${token})`,
        title
      );
    }
    if (type === "image") {
      const image = primaryImage(slab);
      const text = image ? htmlToMarkdown(image) : "";
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
      const text = htmlToMarkdown(message);
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
    const savedImageCounter = imageCounter;
    const savedImageLength = pendingImages.length;
    const markdown = htmlToMarkdown(element);
    imageCounter = savedImageCounter;
    pendingImages.length = savedImageLength;
    return markdown;
  }
  function htmlToMarkdown(element) {
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
        const token = `__IMG_PLACEHOLDER_${++imageCounter}__`;
        pendingImages.push({ url: source, token });
        const rect = node.getBoundingClientRect();
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        const dimensions = width > 0 && height > 0 ? ` width="${width}" height="${height}"` : "";
        return `<a href="${token}" target="_blank" rel="noopener"><img src="${token}" alt="${escapeHtml(alt)}"${dimensions}></a>`;
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

  // src/dev/supplyWorker-no-diag.js
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
  async function extractCurrentSlab() {
    const slab = retainedSlab();
    const type = slabType(slab);
    await waitSlabReady(type, slab);
    extractSlab(type, slab);
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
  function selectNextSlabRoom(area, deckRoom2) {
    const { workZone } = environment();
    const deck = retainedDeck();
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
  async function selectAnchor(room) {
    const { workZone } = environment();
    const slab = retainedSlab();
    const type = slabType(slab);
    if (type === "unknown") {
      throw new Error("Cannot move an unknown slab type.");
    }
    if (type === "image" || type === "empty") {
      currentAnchor = boundaryOf(slab, "top");
    } else if (room > 0) {
      currentAnchor = boundaryOf(slab, "top");
    } else {
      currentAnchor = getNextAnchorIn(slab, workZone);
    }
    if (!currentAnchor) {
      throw new Error("No ready visible anchor found in current slab.");
    }
    return roomAhead(currentAnchor, workZone);
  }
  function anchorRoom() {
    const { workZone } = environment();
    return roomAhead(retainedAnchor(), workZone);
  }
  function slabRoom() {
    const { workZone } = environment();
    return roomAhead(boundaryOf(retainedSlab(), "top"), workZone);
  }
  function deckRoom() {
    const { workZone } = environment();
    return roomAhead(boundaryOf(retainedDeck(), "top"), workZone);
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
  function moveWorkZoneBy(jump) {
    const { supplyArea, workZone } = environment();
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
      room: roomAhead(boundaryOf(deck, "top"), workZone),
      bottomRoom: roomAhead(boundaryOf(deck, "bottom"), workZone)
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
      room: roomAhead(boundaryOf(slab, "top"), workZone),
      bottomRoom: roomAhead(boundaryOf(slab, "bottom"), workZone)
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

  // src/dev/getNextSlabIn-no-diag.js
  function getNextSlabRoomIn(slabRoom2, deckRoom2) {
    return selectNextSlabRoom(
      areaAhead(slabRoom2, MAX_SLAB_GAP),
      deckRoom2
    );
  }

  // src/dev/getNextDeckIn-no-diag.js
  function getNextDeckRoomIn(deckRoom2) {
    return selectNextDeckRoom(
      areaAhead(deckRoom2, MAX_DECK_GAP)
    );
  }

  // src/dev/waitLayoutStable-no-diag.js
  async function waitLayoutStable({
    maxFrames = MAX_FRAMES_FOR_STABILIZATION,
    trackAnchor = false
  } = {}) {
    const stableFrames = trackAnchor && roomUntilFirstNotReadyDeck() > ACTIVATION_DISTANCE ? 1 : 2;
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
  function nextAnimationFrame() {
    return new Promise(
      (resolve) => requestAnimationFrame(resolve)
    );
  }

  // src/dev/moveAnchorToBottom-no-diag.js
  async function moveAnchorToBottom(initialRoom, viewportHeight2, calibratedJump = CALIBRATED_JUMP) {
    const currentSupplyRoom = supplyRoom();
    if (currentSupplyRoom <= 0) {
      return initialRoom;
    }
    let room = initialRoom;
    let retriedErasedJump = false;
    let anchorAtBottom = isAnchorAtBottom(viewportHeight2, room);
    if (anchorAtBottom) {
      return room;
    }
    while (!anchorAtBottom) {
      const supplyRoomBefore = supplyRoom();
      if (supplyRoomBefore <= 0) {
        return room;
      }
      const jump = clampJump(calibratedJump, room, viewportHeight2);
      moveWorkZoneBy(jump);
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
      anchorAtBottom = isAnchorAtBottom(viewportHeight2, room);
    }
    return room;
  }
  function clampJump(calibratedJump, room, viewportHeight2) {
    return Math.min(
      calibratedJump,
      viewportHeight2 - MIN_INTERSECT - room
    );
  }
  function isAnchorAtBottom(viewportHeight2, room) {
    const targetRoom = viewportHeight2 - MIN_INTERSECT;
    return room >= targetRoom - TOLERATED_ROUNDING;
  }

  // src/dev/moveSlabTopToBottom-no-diag.js
  async function moveSlabTopToBottom(initialSlabRoom) {
    const height = viewportHeight();
    let room = initialSlabRoom;
    while (!isAnchorAtBottom(height, room)) {
      const previousRoom = room;
      const selectedAnchorRoom = await selectAnchor(room);
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

  // src/dev/moveViewportToDocumentBottom-no-diag.js
  async function moveViewportToDocumentBottom() {
    const supplier2 = observeSupplier();
    const { supplyArea, workZone } = supplier2;
    clickBottomNavItem();
    await waitLayoutStable();
    moveWorkZoneToSupplyEnd(supplyArea, workZone);
    await waitLayoutStable();
    const decks = getDecks(supplyArea);
    const boundary = decks.length > 0 ? roomAhead(boundaryOf(decks[0], "bottom"), workZone) : workZone.height;
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

  // src/dev/mainOrchestration-no-diag.js
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
      let nextSlabRoom = deckRoom2 != null && slabRoom2 - deckRoom2 >= MINIMUM_SLAB_HEIGHT ? getNextSlabRoomIn(
        slabRoom2,
        deckRoom2
      ) : null;
      if (nextSlabRoom == null) {
        const nextDeckRoom = await getNextDeckRoomIn(
          deckRoom2 ?? initialDeckRoom
        );
        if (nextDeckRoom == null) {
          break;
        }
        deckRoom2 = nextDeckRoom;
        nextSlabRoom = getNextSlabRoomIn(
          slabRoom2 ?? initialSlabRoom,
          deckRoom2
        );
        if (nextSlabRoom == null) {
          throw new Error("No slab found in active deck.");
        }
      }
      slabRoom2 = nextSlabRoom;
      await extractCurrentSlab();
    }
    await exportMarkdown();
  }

  // src/dev/bootstrap-no-diag.js
  var VERSION = true ? "2.20-no-diag" : "unbuilt";
  console.log(`[dev traversal] loaded, version ${VERSION}`);
  var activeRuns = 0;
  var runTraversal = async () => {
    if (activeRuns > 0) {
      console.log("[dev traversal] ignored: a traversal is already in progress.");
      return;
    }
    activeRuns++;
    console.log("[dev traversal] started.");
    try {
      await traverseConversation();
      console.log("[dev traversal] finished.");
    } catch (error) {
      console.error("[dev traversal] failed.", error);
      throw error;
    } finally {
      activeRuns--;
    }
  };
  var menuLabel = `Run dev extractor v${VERSION}`;
  var registerMenuCommand = typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : typeof GM !== "undefined" && typeof GM.registerMenuCommand === "function" ? GM.registerMenuCommand.bind(GM) : null;
  if (registerMenuCommand) {
    registerMenuCommand(menuLabel, runTraversal);
    console.log(`[dev traversal] menu command registered: ${menuLabel}`);
  } else {
    console.log(
      "[dev traversal] cannot register menu command: neither GM_registerMenuCommand nor GM.registerMenuCommand is available."
    );
  }
})();
