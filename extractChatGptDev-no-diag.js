// ==UserScript==
// @name         ChatGPT Chat Extractor (dev, no diagnostics)
// @namespace    http://tampermonkey.net/
// @version      1.50-no-diag
// @description  Runs the in-progress src/dev/ geometric traversal only (no extraction yet).
// @author       Claude
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  // src/dev/geometry-no-diag.js
  function areaAhead(referenceTop, maxGap) {
    return {
      top: referenceTop - maxGap,
      bottom: referenceTop
    };
  }
  function intersecting(area, elements) {
    return elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom >= area.top && rect.top <= area.bottom;
    });
  }
  function closest(referenceTop, candidates, tolerance = 0) {
    let closest2 = null;
    let smallestGap = Infinity;
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      const gap = referenceTop - rect.bottom;
      if (gap < -tolerance) {
        continue;
      }
      if (gap < smallestGap) {
        smallestGap = gap;
        closest2 = candidate;
      }
    }
    return closest2;
  }

  // src/dev/constants-no-diag.js
  var MINIMUM_SLAB_HEIGHT = 90;
  var MIN_INTERSECT = 80;
  var MAX_SLAB_GAP = 160;
  var MAX_DECK_GAP = 20;
  var CALIBRATED_JUMP = 480;
  var MAX_DRIFT = 2;
  var MIN_SCROLL_HEIGHT_CHANGE = 20;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;
  var ACTIVATION_DISTANCE = 1e3;

  // src/dev/nextSlab-no-diag.js
  function nextSlab(room, deck) {
    const area = areaAhead(
      room,
      MAX_SLAB_GAP
    );
    const slabs = getSlabsIn(deck);
    const candidates = intersecting(
      area,
      slabs
    );
    const slab = closest(
      room,
      candidates,
      ADJACENCY_OVERLAP_TOLERANCE
    );
    return slab;
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
    slabs.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.bottom - ra.bottom;
    });
    return slabs;
  }
  function makeEmptySlab(deck) {
    return {
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

  // src/dev/nextReadyDeck-no-diag.js
  async function nextReadyDeck(deckRoom, currentDeck = null) {
    const area = areaAhead(
      deckRoom,
      MAX_DECK_GAP
    );
    const decks = getDecks();
    const candidates = intersecting(
      area,
      decks
    ).filter((candidate) => candidate !== currentDeck);
    const deck = closest(
      deckRoom,
      candidates,
      ADJACENCY_OVERLAP_TOLERANCE
    );
    if (deck == null) {
      return null;
    }
    await waitDeckReady(deck);
    return deck;
  }
  function getDecks() {
    const byId = /* @__PURE__ */ new Map();
    for (const el of document.querySelectorAll("[data-turn-id-container]")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const id = el.getAttribute("data-turn-id-container");
      const existing = byId.get(id);
      if (!existing || el.contains(existing)) {
        byId.set(id, el);
      }
    }
    return Array.from(byId.values()).sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.bottom - ra.bottom;
    });
  }
  function isDeckReady(deck) {
    return deck.dataset.isIntersecting !== void 0 && deck.dataset.isIntersecting !== "false";
  }
  async function waitDeckReady(deck, {
    timeout = 1e4,
    poll = 100
  } = {}) {
    if (isDeckReady(deck)) {
      return;
    }
    const deadline = Date.now() + timeout;
    while (!isDeckReady(deck)) {
      if (!deck.isConnected) {
        throw new Error(
          "Deck detached while waiting for readiness."
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting for deck readiness."
        );
      }
      await new Promise(
        (resolve) => setTimeout(resolve, poll)
      );
    }
  }

  // src/dev/scrollContainer-no-diag.js
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

  // src/dev/stabilize-no-diag.js
  async function waitLayoutStable(container = document.documentElement, {
    stableFrames = 2,
    maxFrames = 300,
    current = null,
    direction = null,
    measureReferenceRoom = null,
    phase = "layout"
  } = {}) {
    const checkAnchor = current != null && measureReferenceRoom != null;
    let previous = geometrySnapshot(container);
    let unchanged = 0;
    for (let frame = 0; frame < maxFrames; frame++) {
      await nextAnimationFrame();
      const currentGeometry = geometrySnapshot(container);
      const scrollHeightChange = Math.abs(
        currentGeometry.scrollHeight - previous.scrollHeight
      );
      const scrollYChange = Math.abs(
        currentGeometry.scrollY - previous.scrollY
      );
      const effectiveScrollHeightChange = scrollHeightChange < MIN_SCROLL_HEIGHT_CHANGE ? 0 : scrollHeightChange;
      const geometryChangeMagnitude = Math.max(
        effectiveScrollHeightChange,
        scrollYChange
      );
      const geometryChanged = geometryChangeMagnitude !== 0;
      const roomAtFrame = checkAnchor ? measureReferenceRoom(current, container, direction) : null;
      if (geometryChanged) {
        previous = currentGeometry;
        unchanged = 0;
        continue;
      }
      const anchorStable = await checkAnchorAcrossYields(
        current,
        container,
        direction,
        measureReferenceRoom,
        frame,
        roomAtFrame
      );
      const roomNow = checkAnchor ? measureReferenceRoom(current, container, direction) : null;
      if (!anchorStable) {
        previous = currentGeometry;
        unchanged = 0;
        continue;
      }
      unchanged++;
      if (unchanged >= stableFrames) {
        return {
          frames: frame + 1,
          status: "stable",
          room: roomNow
        };
      }
    }
    throw new Error(
      `Exceeded ${maxFrames} frames waiting for layout stabilization.`
    );
  }
  function geometrySnapshot(container) {
    return {
      scrollHeight: scrollHeight(container),
      scrollY: scrollY(container)
    };
  }
  async function checkAnchorAcrossYields(current, container, direction, measureReferenceRoom, frame, roomAtFrame) {
    let previousRoom = roomAtFrame;
    let stable = true;
    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {
      await yieldToScheduler();
      const room = current != null && measureReferenceRoom != null ? measureReferenceRoom(current, container, direction) : null;
      const change = room == null || previousRoom == null ? 0 : Math.abs(room - previousRoom);
      const changed = change !== 0;
      if (changed) stable = false;
      previousRoom = room;
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
  async function moveAnchorToBottom(anchor, container, direction, measureAnchorRoom2, calibratedJump = CALIBRATED_JUMP) {
    if (isScrollBoundaryReached(container, direction)) {
      const room2 = measureAnchorRoom2(anchor, container, direction);
      return room2;
    }
    await waitLayoutStable(container, {
      current: anchor,
      direction,
      measureReferenceRoom: measureAnchorRoom2,
      phase: "pre-anchor-move"
    });
    let room = measureAnchorRoom2(anchor, container, direction);
    let retriedCancelledJump = false;
    if (isAnchorAtBottom(container, room)) {
      return room;
    }
    while (!isAnchorAtBottom(container, room)) {
      if (isScrollBoundaryReached(container, direction)) {
        return room;
      }
      await nextAnimationFrame();
      room = measureAnchorRoom2(anchor, container, direction);
      if (isAnchorAtBottom(container, room)) break;
      const jump = clampJump(calibratedJump, room, container);
      const scrollYBefore = scrollY(container);
      performJump(jump, container, direction);
      const scrollYAfter = scrollY(container);
      const intendedRoom = measureAnchorRoom2(anchor, container, direction);
      if (scrollYAfter === scrollYBefore) {
        break;
      }
      const roomUntilFirstNotReadyDeck = measureRoomUntilFirstNotReadyDeck(container, direction);
      const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE ? 2 : 1;
      const stabilization = await waitLayoutStable(container, {
        current: anchor,
        direction,
        stableFrames,
        measureReferenceRoom: measureAnchorRoom2,
        phase: "post-jump"
      });
      const obtainedRoom = measureAnchorRoom2(anchor, container, direction);
      if (obtainedRoom === room && retriedCancelledJump) {
        throw new Error(
          `Anchor made no progress after retrying a cancelled jump at room=${room}.`
        );
      }
      retriedCancelledJump = obtainedRoom === room;
      room = obtainedRoom;
    }
    return room;
  }
  function clampJump(calibratedJump, room, container) {
    return Math.min(
      calibratedJump,
      clientHeight(container) - MIN_INTERSECT - room
    );
  }
  function isAnchorAtBottom(container, room) {
    return room >= clientHeight(container) - MIN_INTERSECT;
  }
  function isScrollBoundaryReached(container, direction) {
    const position = scrollY(container);
    return direction < 0 ? position <= 0 : position >= scrollHeight(container) - clientHeight(container);
  }
  function performJump(jump, container, direction) {
    scrollBy(container, jump * direction);
  }
  function measureRoomUntilFirstNotReadyDeck(container, direction) {
    const viewportTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
    const viewportBoundary = direction < 0 ? viewportTop : viewportTop + clientHeight(container);
    let roomUntilFirstNotReadyDeck = Infinity;
    for (const deck of document.querySelectorAll(
      '[data-turn-id-container][data-is-intersecting="false"]'
    )) {
      const rect = deck.getBoundingClientRect();
      const isAhead = direction < 0 ? rect.top < viewportBoundary : rect.bottom > viewportBoundary;
      if (!isAhead) continue;
      const roomUntilDeck = direction < 0 ? viewportBoundary - rect.bottom : rect.top - viewportBoundary;
      roomUntilFirstNotReadyDeck = Math.min(
        roomUntilFirstNotReadyDeck,
        roomUntilDeck
      );
    }
    return roomUntilFirstNotReadyDeck;
  }

  // src/dev/slabType-no-diag.js
  function slabType(slab) {
    if (!slab?.matches) return "empty";
    if (slab.matches(".group\\/imagegen-image")) return "image";
    if (slab.id?.startsWith("textdoc-message-")) return "canvas";
    if (slab.matches("[data-message-id]")) return "message";
    return "unknown";
  }

  // src/dev/getAnchorsIn-no-diag.js
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
  function getAnchorsIn(slab, container = document.documentElement, direction = -1) {
    const type = slabType(slab);
    if (type === "image" || type === "empty") return [slab];
    if (type === "message" || type === "canvas") {
      return getTextAnchorsIn(slab, container, direction);
    }
    throw new Error("Cannot select anchors in an unknown slab type.");
  }
  function getTextAnchorsIn(slab, container, direction) {
    const viewportTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
    const viewportHeight = clientHeight(container);
    const targetRoom = viewportHeight - MIN_INTERSECT;
    const descendants = [];
    for (const candidate of slab.querySelectorAll(TEXT_ANCHOR_SELECTOR)) {
      if (candidate.closest(".cm-editor, .monaco-editor")) continue;
      const rect = candidate.getBoundingClientRect();
      const ready = candidate.isConnected && rect.width > 0 && rect.height > 0;
      if (ready) descendants.push(candidate);
    }
    const descendantAnchors = normalBoundaryAnchors(
      descendants,
      viewportTop,
      viewportHeight,
      targetRoom,
      direction
    );
    if (descendantAnchors.length > 0) return descendantAnchors;
    const slabAnchors = normalBoundaryAnchors(
      [slab],
      viewportTop,
      viewportHeight,
      targetRoom,
      direction
    );
    if (slabAnchors.length > 0) {
      return slabAnchors;
    }
    const coveringAnchors = [];
    for (const candidate of [...descendants, slab]) {
      const rect = candidate.getBoundingClientRect();
      const anchor = makeBoundaryAnchor(candidate, "top");
      const topRoom = measureBoundaryRoom(
        anchor,
        viewportTop,
        viewportHeight,
        direction
      );
      const bottomRoom = direction < 0 ? rect.bottom - viewportTop : viewportTop + viewportHeight - rect.bottom;
      if (topRoom < 0 && bottomRoom >= targetRoom - MAX_DRIFT) {
        coveringAnchors.push(anchor);
      }
    }
    return coveringAnchors.sort((a, b) => {
      const aRoom = measureBoundaryRoom(a, viewportTop, viewportHeight, direction);
      const bRoom = measureBoundaryRoom(b, viewportTop, viewportHeight, direction);
      return bRoom - aRoom;
    });
  }
  function normalBoundaryAnchors(elements, viewportTop, viewportHeight, targetRoom, direction) {
    const anchors = [];
    for (const element of elements) {
      for (const edge of ["top", "bottom"]) {
        const anchor = makeBoundaryAnchor(element, edge);
        const room = measureBoundaryRoom(
          anchor,
          viewportTop,
          viewportHeight,
          direction
        );
        if (room >= 0 && room < targetRoom - MAX_DRIFT) {
          anchors.push(anchor);
        }
      }
    }
    return anchors.sort((a, b) => {
      const aRoom = measureBoundaryRoom(a, viewportTop, viewportHeight, direction);
      const bRoom = measureBoundaryRoom(b, viewportTop, viewportHeight, direction);
      if (aRoom !== bRoom) return aRoom - bRoom;
      return a.edge === "bottom" ? -1 : 1;
    });
  }
  function makeBoundaryAnchor(element, edge) {
    return {
      element,
      edge,
      get isConnected() {
        return element.isConnected;
      },
      getBoundingClientRect() {
        const rect = element.getBoundingClientRect();
        const boundary = rect[edge];
        return {
          top: boundary,
          bottom: boundary,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: 0
        };
      }
    };
  }
  function measureBoundaryRoom(anchor, viewportTop, viewportHeight, direction) {
    const rect = anchor.element.getBoundingClientRect();
    const boundary = rect[anchor.edge];
    return direction < 0 ? boundary - viewportTop : viewportTop + viewportHeight - boundary;
  }

  // src/dev/moveSlabTopToBottom-no-diag.js
  async function moveSlabTopToBottom(current, container, direction = -1) {
    const type = slabType(current);
    if (type === "unknown") {
      throw new Error("Cannot move an unknown slab type.");
    }
    if (type === "image" || type === "empty") {
      await waitImageReady(current);
      return moveAnchorToBottom(
        current,
        container,
        direction,
        measureRoom,
        Infinity
      );
    }
    let room = measureRoom(current, container, direction);
    while (room < 0) {
      const anchors2 = getAnchorsIn(current, container, direction);
      const anchor2 = anchors2[0];
      if (!anchor2) {
        throw new Error("No ready visible anchor found in current slab.");
      }
      await moveAnchorToBottom(
        anchor2,
        container,
        direction,
        measureAnchorRoom
      );
      room = measureRoom(current, container, direction);
    }
    const anchors = getAnchorsIn(current, container, direction);
    const currentRect = current.getBoundingClientRect();
    const anchor = anchors.find((candidate) => {
      const boundary = candidate.getBoundingClientRect().top;
      return boundary >= currentRect.top && boundary <= currentRect.bottom;
    });
    if (!anchor) {
      throw new Error(
        "No ready visible anchor found for final slab movement."
      );
    }
    await moveAnchorToBottom(
      anchor,
      container,
      direction,
      measureAnchorRoom
    );
    return measureRoom(current, container, direction);
  }
  function measureRoom(current, container, direction) {
    const viewportHeight = clientHeight(container);
    const rect = current.getBoundingClientRect();
    return direction < 0 ? rect.top : viewportHeight - rect.bottom;
  }
  function measureAnchorRoom(anchor, container, direction) {
    const viewportHeight = clientHeight(container);
    const viewportTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
    const rect = anchor.element.getBoundingClientRect();
    const boundary = rect[anchor.edge];
    return direction < 0 ? boundary - viewportTop : viewportTop + viewportHeight - boundary;
  }
  async function waitImageReady(current) {
    const images = current.matches?.("img") ? [current] : current.querySelectorAll ? [...current.querySelectorAll("img")] : [];
    for (const image of images) {
      if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
        await new Promise((resolve, reject) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", reject, { once: true });
        });
      }
      if (typeof image.decode === "function") await image.decode();
    }
  }

  // src/dev/moveViewportToDocumentBottom-no-diag.js
  async function moveViewportToDocumentBottom(container) {
    clickBottomNavItem();
    await waitLayoutStable(container);
    scrollTo(container, scrollHeight(container));
    await waitLayoutStable(container);
    const decks = getDecks();
    const boundary = decks.length > 0 ? decks[0].getBoundingClientRect().bottom : clientHeight(container);
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
    try {
      const container = findScrollContainer();
      const initial = await moveViewportToDocumentBottom(container);
      let room = initial.room;
      let deckRoom = initial.deckRoom;
      let deck = null;
      let current = null;
      while (true) {
        if (current && room < MAX_SLAB_GAP) {
          room = await moveSlabTopToBottom(current, container);
        }
        if (deck) {
          deckRoom = deck.getBoundingClientRect().top;
        }
        let slab = deck && room - deckRoom >= MINIMUM_SLAB_HEIGHT ? nextSlab(room, deck) : null;
        if (slab == null) {
          deck = await nextReadyDeck(deckRoom, deck);
          if (deck == null) {
            break;
          }
          deckRoom = deck.getBoundingClientRect().top;
          slab = nextSlab(room, deck);
          if (!slab) throw new Error("No slab found in ready deck.");
        }
        current = slab;
        room = current.getBoundingClientRect().top;
      }
    } catch (error) {
      throw error;
    }
  }

  // src/dev/bootstrap-no-diag.js
  var VERSION = true ? "1.50-no-diag" : "unbuilt";
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
    } finally {
      activeRuns--;
    }
  };
  var menuLabel = `Run dev traversal v${VERSION} (geometry only)`;
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
