// ==UserScript==
// @name         ChatGPT Chat Extractor (dev, no diagnostics)
// @namespace    http://tampermonkey.net/
// @version      1.24-no-diag
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
  async function nextReadyDeck(deckRoom) {
    const area = areaAhead(
      deckRoom,
      MAX_DECK_GAP
    );
    const decks = getDecks();
    const candidates = intersecting(
      area,
      decks
    );
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
    intendedRoom = null,
    roomTolerance = MAX_DRIFT
  } = {}) {
    const checkRoom = current != null && intendedRoom != null;
    let previous = geometrySnapshot(container);
    let unchanged = 0;
    for (let frame = 0; frame < maxFrames; frame++) {
      await nextAnimationFrame();
      const currentGeometry = geometrySnapshot(container);
      const geometryChangeMagnitude = Math.max(
        Math.abs(currentGeometry.scrollHeight - previous.scrollHeight),
        Math.abs(currentGeometry.scrollY - previous.scrollY)
      );
      const geometryChanged = geometryChangeMagnitude !== 0;
      const roomNow = checkRoom ? measureRoom(current, container, direction) : null;
      const roomClose = !checkRoom || Math.abs(roomNow - intendedRoom) <= roomTolerance;
      if (!geometryChanged && !roomClose) {
        return {
          frames: frame + 1,
          status: "stable-wrong-room",
          room: roomNow
        };
      }
      if (!geometryChanged && roomClose) {
        unchanged++;
      } else {
        previous = currentGeometry;
        unchanged = 0;
      }
      if (unchanged >= stableFrames) {
        return {
          frames: frame + 1,
          status: "stable",
          room: roomNow
        };
      }
    }
    throw new Error(
      checkRoom ? `Exceeded ${maxFrames} frames waiting for layout stabilization within ${roomTolerance}px of intendedRoom=${intendedRoom} (last room=${measureRoom(current, container, direction)}).` : `Exceeded ${maxFrames} frames waiting for layout stabilization.`
    );
  }
  function geometrySnapshot(container) {
    return {
      scrollHeight: scrollHeight(container),
      scrollY: scrollY(container)
    };
  }
  function nextAnimationFrame() {
    return new Promise(
      (resolve) => requestAnimationFrame(resolve)
    );
  }

  // src/dev/moveSlabTopToBottom-no-diag.js
  async function moveSlabTopToBottom(current, container, direction = -1) {
    let room = measureRoom(current, container, direction);
    let retriedCancelledJump = false;
    while (!isSlabIntersectionAtMinimum(container, room)) {
      const jump = clampJump(CALIBRATED_JUMP, room, container);
      const scrollYBefore = scrollY(container);
      performJump(jump, container, direction);
      const scrollYAfter = scrollY(container);
      const intendedRoom = measureRoom(current, container, direction);
      if (scrollYAfter === scrollYBefore) {
        break;
      }
      const roomUntilFirstNotReadyDeck = measureRoomUntilFirstNotReadyDeck(container, direction);
      const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE ? 2 : 1;
      const stabilization = await waitLayoutStable(container, {
        current,
        direction,
        intendedRoom,
        stableFrames
      });
      const obtainedRoom = measureRoom(current, container, direction);
      if (stabilization.status === "stable-wrong-room") {
        if (obtainedRoom === room && !retriedCancelledJump) {
          retriedCancelledJump = true;
          continue;
        }
        throw new Error(
          `Geometry stabilized at room=${stabilization.room}; expected room=${intendedRoom}.`
        );
      }
      retriedCancelledJump = false;
      room = measureRoom(current, container, direction);
    }
    return room;
  }
  function clampJump(calibratedJump, room, container) {
    const viewportHeight = clientHeight(container);
    return Math.min(
      calibratedJump,
      viewportHeight - MIN_INTERSECT - room
    );
  }
  function isSlabIntersectionAtMinimum(container, intendedRoom) {
    return intendedRoom >= clientHeight(container) - MIN_INTERSECT;
  }
  function measureRoom(current, container, direction) {
    const viewportHeight = clientHeight(container);
    const rect = current.getBoundingClientRect();
    return direction < 0 ? rect.top : viewportHeight - rect.bottom;
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
          deck = await nextReadyDeck(deckRoom);
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
  var VERSION = true ? "1.24-no-diag" : "unbuilt";
  console.log(`[dev traversal] loaded, version ${VERSION}`);
  var activeRuns = 0;
  var runTraversal = async () => {
    if (activeRuns > 0) {
      console.log("[dev traversal] ignored: a traversal is already in progress.");
      return;
    }
    activeRuns++;
    console.log("[dev traversal] started.");
    await traverseConversation();
    activeRuns--;
    console.log("[dev traversal] finished.");
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
