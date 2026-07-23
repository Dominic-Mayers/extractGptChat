// ==UserScript==
// @name         ChatGPT Chat Extractor (dev, no diagnostics)
// @namespace    http://tampermonkey.net/
// @version      2.01-no-diag
// @description  Runs the in-progress src/dev/ geometric traversal only (no extraction yet).
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
  var MIN_SCROLL_HEIGHT_CHANGE = 20;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;
  var ACTIVATION_DISTANCE = 1e3;

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

  // src/dev/supplyWorker-no-diag.js
  var supplier;
  var currentDeck;
  var currentSlab;
  var currentAnchor;
  var imageReady;
  function resetSupplyWorker() {
    supplier = observeSupplier();
    currentDeck = null;
    currentSlab = null;
    currentAnchor = null;
    imageReady = false;
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
    imageReady = false;
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
    imageReady = false;
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
      if (!imageReady) {
        await waitImageReady(slab);
        imageReady = true;
      }
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
  async function waitImageReady(slab) {
    const images = slab.matches?.("img") ? [slab] : slab.querySelectorAll ? [...slab.querySelectorAll("img")] : [];
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

  // src/dev/stabilize-no-diag.js
  async function waitLayoutStable({
    maxFrames = 300,
    trackAnchor = false
  } = {}) {
    const stableFrames = trackAnchor && roomUntilFirstNotReadyDeck() > ACTIVATION_DISTANCE ? 1 : 2;
    let previous = geometrySnapshot();
    let unchanged = 0;
    for (let frame = 0; frame < maxFrames; frame++) {
      await nextAnimationFrame();
      const currentGeometry = geometrySnapshot();
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
      const positionAtFrame = trackAnchor ? anchorRoom() : null;
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
    }
  }

  // src/dev/bootstrap-no-diag.js
  var VERSION = true ? "2.01-no-diag" : "unbuilt";
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
