// ==UserScript==
// @name         ChatGPT Chat Extractor (dev, no diagnostics)
// @namespace    http://tampermonkey.net/
// @version      1.84-no-diag
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
  function viewportPosition(anchor, workZone) {
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
  function isAtSupplyBoundary(supplyArea, workZone) {
    return workZonePosition(supplyArea, workZone) <= 0;
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

  // src/dev/getNextDeckIn-no-diag.js
  async function getNextDeckIn(deckRoom, supplier) {
    const { supplyArea, activeArea } = supplier;
    const { workZone } = supplier;
    const area = areaAhead(
      deckRoom,
      MAX_DECK_GAP
    );
    const decks = getDecks(supplyArea);
    const candidates = decks.filter((candidate) => {
      const geometry2 = deckGeometry(candidate, workZone);
      const intersects = geometry2.bottomRoom >= area.top && geometry2.room <= area.bottom;
      return intersects;
    });
    const deck = closestDeck(deckRoom, candidates, workZone);
    if (deck == null) {
      return null;
    }
    await waitDeckActive(deck, activeArea);
    const geometry = deckGeometry(deck, workZone);
    return {
      deckRoom: geometry.room,
      deckHeight: geometry.height
    };
  }
  function getDeckIn(deckRoom, supplier) {
    const { supplyArea, workZone } = supplier;
    let selected = null;
    let smallestRoomDifference = Infinity;
    for (const deck of getDecks(supplyArea)) {
      const geometry = deckGeometry(deck, workZone);
      const roomDifference = Math.abs(geometry.room - deckRoom);
      if (roomDifference >= smallestRoomDifference) continue;
      selected = deck;
      smallestRoomDifference = roomDifference;
    }
    return selected;
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
    const rect = deck.getBoundingClientRect();
    return {
      room: roomAhead(boundaryOf(deck, "top"), workZone),
      bottomRoom: roomAhead(boundaryOf(deck, "bottom"), workZone),
      height: rect.height
    };
  }
  function getDecks(supplyArea) {
    const byId = /* @__PURE__ */ new Map();
    for (const el of elementsIn(supplyArea, "[data-turn-id-container]")) {
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) continue;
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
  function isDeckActive(deck, activeArea) {
    return contains(activeArea, deck) && deck.dataset.isIntersecting !== void 0 && deck.dataset.isIntersecting !== "false";
  }
  async function waitDeckActive(deck, activeArea, {
    timeout = 1e4,
    poll = 100
  } = {}) {
    if (isDeckActive(deck, activeArea)) {
      return;
    }
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

  // src/dev/getNextSlabIn-no-diag.js
  function getNextSlabIn(slabRoom, deckRoom, supplier) {
    const { workZone } = supplier;
    const deck = getDeckIn(deckRoom, supplier);
    if (!deck) throw new Error("No deck found at the current geometry.");
    const area = areaAhead(
      slabRoom,
      MAX_SLAB_GAP
    );
    const slabs = getSlabsIn(deck);
    const candidates = slabs.filter((candidate) => {
      const geometry2 = slabGeometry(candidate, workZone);
      return geometry2.bottomRoom >= area.top && geometry2.room <= area.bottom;
    });
    const slab = closestSlab(slabRoom, candidates, workZone);
    if (slab == null) return null;
    const geometry = slabGeometry(slab, workZone);
    return {
      slabRoom: geometry.room,
      slabHeight: geometry.height
    };
  }
  function getSlabIn(slabRoom, deckRoom, supplier) {
    const { workZone } = supplier;
    const deck = getDeckIn(deckRoom, supplier);
    if (!deck) return null;
    let selected = null;
    let smallestRoomDifference = Infinity;
    for (const slab of getSlabsIn(deck)) {
      const geometry = slabGeometry(slab, workZone);
      const roomDifference = Math.abs(geometry.room - slabRoom);
      if (roomDifference >= smallestRoomDifference) continue;
      selected = slab;
      smallestRoomDifference = roomDifference;
    }
    return selected;
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
    const rect = slab.getBoundingClientRect();
    return {
      room: roomAhead(boundaryOf(slab, "top"), workZone),
      bottomRoom: roomAhead(boundaryOf(slab, "bottom"), workZone),
      height: rect.height
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

  // src/dev/stabilize-no-diag.js
  async function waitLayoutStable(supplyArea, workZone, {
    stableFrames = 2,
    maxFrames = 300,
    current = null
  } = {}) {
    const checkAnchor = current != null;
    let previous = geometrySnapshot(supplyArea, workZone);
    let unchanged = 0;
    for (let frame = 0; frame < maxFrames; frame++) {
      await nextAnimationFrame();
      const currentGeometry = geometrySnapshot(supplyArea, workZone);
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
      const positionAtFrame = checkAnchor ? viewportPosition(current, workZone) : null;
      if (geometryChanged) {
        previous = currentGeometry;
        unchanged = 0;
        continue;
      }
      const anchorStable = await checkAnchorAcrossYields(
        current,
        workZone,
        positionAtFrame
      );
      const positionNow = checkAnchor ? viewportPosition(current, workZone) : null;
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
          position: positionNow
        };
      }
    }
    throw new Error(
      `Exceeded ${maxFrames} frames waiting for layout stabilization.`
    );
  }
  function geometrySnapshot(supplyArea, workZone) {
    return {
      scrollHeight: supplyHeight(supplyArea),
      scrollY: workZonePosition(supplyArea, workZone)
    };
  }
  async function checkAnchorAcrossYields(current, workZone, positionAtFrame) {
    let previousPosition = positionAtFrame;
    let stable = true;
    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {
      await yieldToScheduler();
      const position = current != null ? viewportPosition(current, workZone) : null;
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
  async function moveAnchorToBottom(anchor, supplier, calibratedJump = CALIBRATED_JUMP) {
    const { supplyArea, activeArea, workZone } = supplier;
    if (isAtSupplyBoundary(supplyArea, workZone)) {
      const room2 = roomAhead(anchor, workZone);
      return room2;
    }
    let room = roomAhead(anchor, workZone);
    let retriedErasedJump = false;
    let anchorAtBottom = isAnchorAtBottom(workZone, room);
    if (anchorAtBottom) {
      return room;
    }
    while (!anchorAtBottom) {
      if (isAtSupplyBoundary(supplyArea, workZone)) {
        return room;
      }
      const jump = clampJump(calibratedJump, room, workZone);
      const scrollYBefore = workZonePosition(supplyArea, workZone);
      moveWorkZone(jump, supplyArea, workZone);
      const scrollYAfter = workZonePosition(supplyArea, workZone);
      if (scrollYAfter === scrollYBefore) {
        break;
      }
      const roomUntilFirstNotReadyDeck = measureRoomUntilFirstNotReadyDeck(activeArea, workZone);
      const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE ? 2 : 1;
      const postJumpStabilization = await waitLayoutStable(
        supplyArea,
        workZone,
        {
          current: anchor,
          stableFrames
        }
      );
      const obtainedRoom = roomAhead(anchor, workZone);
      const jumpWasErased = obtainedRoom === room;
      if (jumpWasErased && retriedErasedJump) {
        throw new Error(
          `Anchor made no progress after retrying an erased jump at room=${room}.`
        );
      }
      retriedErasedJump = jumpWasErased;
      room = obtainedRoom;
      anchorAtBottom = isAnchorAtBottom(workZone, room);
    }
    return room;
  }
  function clampJump(calibratedJump, room, workZone) {
    return Math.min(
      calibratedJump,
      workZone.height - MIN_INTERSECT - room
    );
  }
  function isAnchorAtBottom(workZone, room) {
    const targetRoom = workZone.height - MIN_INTERSECT;
    return room >= targetRoom - TOLERATED_ROUNDING;
  }
  function measureRoomUntilFirstNotReadyDeck(activeArea, workZone) {
    const viewportBoundary = workZoneTop(workZone);
    let roomUntilFirstNotReadyDeck = Infinity;
    for (const deck of elementsIn(
      activeArea,
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
  function getNextAnchorIn(slabRoom, deckRoom, supplier) {
    const { workZone } = supplier;
    const slab = getSlabIn(
      slabRoom,
      deckRoom,
      supplier
    );
    if (!slab) throw new Error("No slab found at the current geometry.");
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

  // src/dev/moveSlabTopToBottom-no-diag.js
  async function moveSlabTopToBottom(state, supplier) {
    const { workZone } = supplier;
    const slab = getSlabIn(
      state.slabRoom,
      state.deckRoom,
      supplier
    );
    const deck = getDeckIn(state.deckRoom, supplier);
    if (!slab) throw new Error("No slab found at the current geometry.");
    if (!deck) throw new Error("No deck found at the current geometry.");
    const type = slabType(slab);
    const slabTop = boundaryOf(slab, "top");
    if (type === "unknown") {
      throw new Error("Cannot move an unknown slab type.");
    }
    if (type === "image" || type === "empty") {
      await waitImageReady(slab);
      await moveAnchorToBottom(
        slabTop,
        supplier,
        Infinity
      );
      return geometryOf(slab, deck, workZone);
    }
    let room = roomAhead(slabTop, workZone);
    while (room < 0) {
      const geometry = geometryOf(slab, deck, workZone);
      const anchor = getNextAnchorIn(
        geometry.slabRoom,
        geometry.deckRoom,
        supplier
      );
      if (!anchor) {
        throw new Error("No ready visible anchor found in current slab.");
      }
      await moveAnchorToBottom(
        anchor,
        supplier
      );
      room = roomAhead(slabTop, workZone);
    }
    await moveAnchorToBottom(
      slabTop,
      supplier
    );
    return geometryOf(slab, deck, workZone);
  }
  function geometryOf(slab, deck, workZone) {
    return {
      slabRoom: roomAhead(boundaryOf(slab, "top"), workZone),
      slabHeight: slab.getBoundingClientRect().height,
      deckRoom: roomAhead(boundaryOf(deck, "top"), workZone),
      deckHeight: deck.getBoundingClientRect().height
    };
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

  // src/dev/moveViewportToDocumentBottom-no-diag.js
  async function moveViewportToDocumentBottom(supplier) {
    const { supplyArea, workZone } = supplier;
    clickBottomNavItem();
    await waitLayoutStable(supplyArea, workZone);
    moveWorkZoneToSupplyEnd(supplyArea, workZone);
    await waitLayoutStable(supplyArea, workZone);
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
    try {
      const supplier = observeSupplier();
      const { workZone } = supplier;
      const initial = await moveViewportToDocumentBottom(supplier);
      let slabRoom = initial.room;
      let slabHeight = null;
      let deckRoom = initial.deckRoom;
      let deckHeight = null;
      while (true) {
        if (slabHeight != null && slabRoom < MAX_SLAB_GAP) {
          ({
            slabRoom,
            slabHeight,
            deckRoom,
            deckHeight
          } = await moveSlabTopToBottom({
            slabRoom,
            slabHeight,
            deckRoom,
            deckHeight
          }, supplier));
        }
        let nextSlabGeometry = deckHeight != null && slabRoom - deckRoom >= MINIMUM_SLAB_HEIGHT ? getNextSlabIn(
          slabRoom,
          deckRoom,
          supplier
        ) : null;
        if (nextSlabGeometry == null) {
          const nextDeckGeometry = await getNextDeckIn(
            deckRoom,
            supplier
          );
          if (nextDeckGeometry == null) {
            break;
          }
          deckRoom = nextDeckGeometry.deckRoom;
          deckHeight = nextDeckGeometry.deckHeight;
          nextSlabGeometry = getNextSlabIn(
            slabRoom,
            deckRoom,
            supplier
          );
          if (!nextSlabGeometry) {
            throw new Error("No slab found in active deck.");
          }
        }
        slabRoom = nextSlabGeometry.slabRoom;
        slabHeight = nextSlabGeometry.slabHeight;
      }
    } catch (error) {
      throw error;
    }
  }

  // src/dev/bootstrap-no-diag.js
  var VERSION = true ? "1.84-no-diag" : "unbuilt";
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
