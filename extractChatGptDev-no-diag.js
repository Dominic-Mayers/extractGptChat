// ==UserScript==
// @name         ChatGPT Chat Extractor (dev, no diagnostics)
// @namespace    http://tampermonkey.net/
// @version      1.80-no-diag
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
  var TOLERATED_ROUNDING = 1;
  var MAX_SLAB_GAP = 160;
  var MAX_DECK_GAP = 20;
  var CALIBRATED_JUMP = 480;
  var MAX_DRIFT = 2;
  var MIN_SCROLL_HEIGHT_CHANGE = 20;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;
  var ACTIVATION_DISTANCE = 3e3;

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

  // src/dev/nextActiveDeck-no-diag.js
  async function nextActiveDeck(deckRoom, currentDeck = null) {
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
    await waitDeckActive(deck);
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
  function isDeckActive(deck) {
    return deck.dataset.isIntersecting !== void 0 && deck.dataset.isIntersecting !== "false";
  }
  async function waitDeckActive(deck, {
    timeout = 1e4,
    poll = 100
  } = {}) {
    if (isDeckActive(deck)) {
      return;
    }
    const deadline = Date.now() + timeout;
    while (!isDeckActive(deck)) {
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

  // src/dev/stabilize-no-diag.js
  async function waitLayoutStable(workZone, {
    stableFrames = 2,
    maxFrames = 300,
    current = null,
    phase = "layout"
  } = {}) {
    const checkAnchor = current != null;
    let previous = geometrySnapshot(workZone);
    let unchanged = 0;
    for (let frame = 0; frame < maxFrames; frame++) {
      await nextAnimationFrame();
      const currentGeometry = geometrySnapshot(workZone);
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
      const roomAtFrame = checkAnchor ? workZone.roomAheadOf(current) : null;
      if (geometryChanged) {
        previous = currentGeometry;
        unchanged = 0;
        continue;
      }
      const anchorStable = await checkAnchorAcrossYields(
        current,
        workZone,
        frame,
        roomAtFrame
      );
      const roomNow = checkAnchor ? workZone.roomAheadOf(current) : null;
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
  function geometrySnapshot(workZone) {
    return {
      scrollHeight: workZone.supplyHeight,
      scrollY: workZone.position
    };
  }
  async function checkAnchorAcrossYields(current, workZone, frame, roomAtFrame) {
    let previousRoom = roomAtFrame;
    let stable = true;
    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {
      await yieldToScheduler();
      const room = current != null ? workZone.roomAheadOf(current) : null;
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
  async function moveAnchorToBottom(anchor, workZone, calibratedJump = CALIBRATED_JUMP) {
    if (workZone.isAtSupplyBoundary()) {
      const room2 = workZone.roomAheadOf(anchor);
      return room2;
    }
    let room = workZone.roomAheadOf(anchor);
    let retriedErasedJump = false;
    let anchorAtBottom = measuredAnchorBottomCheck(
      workZone,
      room
    );
    if (anchorAtBottom) {
      return room;
    }
    while (!anchorAtBottom) {
      if (workZone.isAtSupplyBoundary()) {
        return room;
      }
      const jump = clampJump(calibratedJump, room, workZone);
      const scrollYBefore = workZone.position;
      workZone.moveBy(jump);
      const scrollYAfter = workZone.position;
      const intendedRoom = workZone.roomAheadOf(anchor);
      if (scrollYAfter === scrollYBefore) {
        break;
      }
      const roomUntilFirstNotReadyDeck = measureRoomUntilFirstNotReadyDeck(workZone);
      const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE ? 2 : 1;
      const postJumpStabilization = await waitLayoutStable(workZone, {
        current: anchor,
        stableFrames,
        phase: "post-jump"
      });
      const obtainedRoom = workZone.roomAheadOf(anchor);
      const jumpWasErased = obtainedRoom === room;
      if (jumpWasErased && retriedErasedJump) {
        throw new Error(
          `Anchor made no progress after retrying an erased jump at room=${room}.`
        );
      }
      retriedErasedJump = jumpWasErased;
      room = obtainedRoom;
      anchorAtBottom = measuredAnchorBottomCheck(
        workZone,
        room
      );
    }
    return room;
  }
  function measuredAnchorBottomCheck(workZone, room) {
    const viewportHeight = workZone.height;
    const targetRoom = viewportHeight - MIN_INTERSECT;
    const atBottom = room >= targetRoom - TOLERATED_ROUNDING;
    return atBottom;
  }
  function clampJump(calibratedJump, room, workZone) {
    return Math.min(
      calibratedJump,
      workZone.height - MIN_INTERSECT - room
    );
  }
  function measureRoomUntilFirstNotReadyDeck(workZone) {
    const viewportBoundary = workZone.top;
    let roomUntilFirstNotReadyDeck = Infinity;
    for (const deck of document.querySelectorAll(
      '[data-turn-id-container][data-is-intersecting="false"]'
    )) {
      const rect = deck.getBoundingClientRect();
      const isAhead = rect.top < viewportBoundary;
      if (!isAhead) continue;
      const roomUntilDeck = viewportBoundary - rect.bottom;
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
  function getAnchorsIn(slab, workZone) {
    const type = slabType(slab);
    if (type === "image" || type === "empty") return [slab];
    if (type === "message" || type === "canvas") {
      return getTextAnchorsIn(slab, workZone);
    }
    throw new Error("Cannot select anchors in an unknown slab type.");
  }
  function getTextAnchorsIn(slab, workZone) {
    const viewportTop = workZone.top;
    const viewportHeight = workZone.height;
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
      targetRoom,
      workZone
    );
    if (descendantAnchors.length > 0) return descendantAnchors;
    const slabAnchors = normalBoundaryAnchors(
      [slab],
      targetRoom,
      workZone
    );
    if (slabAnchors.length > 0) {
      return slabAnchors;
    }
    const coveringAnchors = [];
    for (const candidate of [...descendants, slab]) {
      const rect = candidate.getBoundingClientRect();
      const anchor = boundaryAnchor(candidate, "top");
      const topRoom = workZone.roomAheadOf(anchor);
      const bottomRoom = rect.bottom - viewportTop;
      if (topRoom < 0 && bottomRoom >= targetRoom - MAX_DRIFT) {
        coveringAnchors.push(anchor);
      }
    }
    return coveringAnchors.sort((a, b) => {
      const aRoom = workZone.roomAheadOf(a);
      const bRoom = workZone.roomAheadOf(b);
      return bRoom - aRoom;
    });
  }
  function normalBoundaryAnchors(elements, targetRoom, workZone) {
    const anchors = [];
    for (const element of elements) {
      for (const edge of ["top", "bottom"]) {
        const anchor = boundaryAnchor(element, edge);
        const room = workZone.roomAheadOf(anchor);
        if (room >= 0 && room < targetRoom - MAX_DRIFT) {
          anchors.push(anchor);
        }
      }
    }
    return anchors.sort((a, b) => {
      const aRoom = workZone.roomAheadOf(a);
      const bRoom = workZone.roomAheadOf(b);
      if (aRoom !== bRoom) return aRoom - bRoom;
      return a.edge === "bottom" ? -1 : 1;
    });
  }
  function boundaryAnchor(element, edge) {
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

  // src/dev/moveSlabTopToBottom-no-diag.js
  async function moveSlabTopToBottom(current, workZone) {
    const type = slabType(current);
    const slabTop = boundaryAnchor(current, "top");
    if (type === "unknown") {
      throw new Error("Cannot move an unknown slab type.");
    }
    if (type === "image" || type === "empty") {
      await waitImageReady(current);
      return moveAnchorToBottom(
        slabTop,
        workZone,
        Infinity
      );
    }
    let room = workZone.roomAheadOf(slabTop);
    while (room < 0) {
      const anchors = measuredAnchorSearch(
        current,
        workZone
      );
      const anchor = anchors[0];
      if (!anchor) {
        throw new Error("No ready visible anchor found in current slab.");
      }
      await moveAnchorToBottom(
        anchor,
        workZone
      );
      room = workZone.roomAheadOf(slabTop);
    }
    await moveAnchorToBottom(
      slabTop,
      workZone
    );
    return workZone.roomAheadOf(slabTop);
  }
  function measuredAnchorSearch(current, workZone) {
    const anchors = getAnchorsIn(current, workZone);
    return anchors;
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
  async function moveViewportToDocumentBottom(workZone) {
    clickBottomNavItem();
    await waitLayoutStable(workZone);
    workZone.moveToSupplyEnd();
    await waitLayoutStable(workZone);
    const decks = getDecks();
    const boundary = decks.length > 0 ? decks[0].getBoundingClientRect().bottom : workZone.height;
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
  function findSupplyArea() {
    return createSupplyArea(findScrollContainer());
  }
  function createSupplyArea(container) {
    const workZone = {
      get height() {
        return clientHeight(container);
      },
      get top() {
        return container === document.documentElement ? 0 : container.getBoundingClientRect().top;
      },
      get position() {
        return scrollY(container);
      },
      get supplyHeight() {
        return scrollHeight(container);
      },
      roomAheadOf(anchor) {
        const rect = anchor.element.getBoundingClientRect();
        return rect[anchor.edge] - this.top;
      },
      moveBy(distance) {
        scrollBy(container, -distance);
      },
      moveToSupplyEnd() {
        scrollTo(container, scrollHeight(container));
      },
      isAtSupplyBoundary() {
        return scrollY(container) <= 0;
      }
    };
    return { workZone };
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

  // src/dev/mainOrchestration-no-diag.js
  async function traverseConversation() {
    try {
      const supplyArea = findSupplyArea();
      const workZone = supplyArea.workZone;
      const initial = await moveViewportToDocumentBottom(workZone);
      let room = initial.room;
      let deckRoom = initial.deckRoom;
      let deck = null;
      let current = null;
      while (true) {
        if (current && room < MAX_SLAB_GAP) {
          room = await moveSlabTopToBottom(current, workZone);
        }
        if (deck) {
          deckRoom = deck.getBoundingClientRect().top;
        }
        let slab = deck && room - deckRoom >= MINIMUM_SLAB_HEIGHT ? nextSlab(room, deck) : null;
        if (slab == null) {
          deck = await nextActiveDeck(deckRoom, deck);
          if (deck == null) {
            break;
          }
          deckRoom = deck.getBoundingClientRect().top;
          slab = nextSlab(room, deck);
          if (!slab) throw new Error("No slab found in active deck.");
        }
        current = slab;
        room = current.getBoundingClientRect().top;
      }
    } catch (error) {
      throw error;
    }
  }

  // src/dev/bootstrap-no-diag.js
  var VERSION = true ? "1.80-no-diag" : "unbuilt";
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
