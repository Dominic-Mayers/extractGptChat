// ==UserScript==
// @name         ChatGPT Chat Extractor (dev)
// @namespace    http://tampermonkey.net/
// @version      0.74
// @description  Runs the in-progress src/dev/ geometric traversal only (no extraction yet).
// @author       Claude
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  // src/dev/geometry.js
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

  // src/dev/constants.js
  var MINIMUM_SLAB_HEIGHT = 90;
  var MIN_INTERSECT = 80;
  var MAX_SLAB_GAP = 160;
  var MAX_DECK_GAP = 20;
  var CALIBRATED_JUMP = 480;
  var MAX_DRIFT = 2;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;

  // src/dev/nextSlab.js
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
    if (slab == null) {
      console.log(
        `[nextSlab] room=${Math.round(room)}, area={top:${Math.round(area.top)}, bottom:${Math.round(area.bottom)}}, slabs.length=${slabs.length}, candidates.length=${candidates.length}` + (slabs.length > 0 ? `, slabs: ` + slabs.map((s) => {
          const r = s.getBoundingClientRect();
          return `{top:${Math.round(r.top)}, bottom:${Math.round(r.bottom)}, gap:${room - r.bottom}}`;
        }).join(", ") : "")
      );
    }
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

  // src/dev/nextReadyDeck.js
  async function nextReadyDeck(deckRoom, container) {
    const area = areaAhead(
      deckRoom,
      MAX_DECK_GAP
    );
    const decks = getDecks();
    const candidates = intersecting(
      area,
      decks
    );
    const containerTop = container && container !== document.documentElement ? container.getBoundingClientRect().top : 0;
    const insideCount = container ? decks.filter((d) => container.contains(d)).length : decks.length;
    console.log(
      `[nextReadyDeck] deckRoom=${Math.round(deckRoom)}, area={top:${Math.round(area.top)}, bottom:${Math.round(area.bottom)}}, decks.length=${decks.length}, candidates.length=${candidates.length}, containerTop=${Math.round(containerTop)}, insideContainer=${insideCount}/${decks.length}` + (decks.length > 0 ? `, decks[0].rect={top:${Math.round(decks[0].getBoundingClientRect().top)}, bottom:${Math.round(decks[0].getBoundingClientRect().bottom)}}, decks[0].insideContainer=${container ? container.contains(decks[0]) : "n/a"}` : "") + (decks.length > 1 ? `, decks[last].rect={top:${Math.round(decks[decks.length - 1].getBoundingClientRect().top)}, bottom:${Math.round(decks[decks.length - 1].getBoundingClientRect().bottom)}}` : "")
    );
    const deck = closest(
      deckRoom,
      candidates,
      ADJACENCY_OVERLAP_TOLERANCE
    );
    if (deck == null) {
      if (candidates.length > 0) {
        console.log(
          `[nextReadyDeck] closest() rejected all ${candidates.length} candidate(s): ` + candidates.map((c) => {
            const r = c.getBoundingClientRect();
            return `{top:${Math.round(r.top)}, bottom:${Math.round(r.bottom)}, gap:${deckRoom - r.bottom}}`;
          }).join(", ")
        );
      }
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

  // src/dev/scrollContainer.js
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

  // src/dev/stabilize.js
  async function waitLayoutStable(container = document.documentElement, {
    stableFrames = 2,
    maxFrames = 300,
    current = null,
    direction = null,
    intendedRoom = null,
    roomTolerance = MAX_DRIFT
  } = {}) {
    const checkRoom = current != null && intendedRoom != null;
    let previous = geometryFingerprint(container);
    let unchanged = 0;
    console.log("Start stabilization");
    for (let frame = 0; frame < maxFrames; frame++) {
      const attemptTime = performance.now();
      await nextAnimationFrame();
      const attemptDeltaTime = performance.now() - attemptTime;
      const currentGeometry = geometryFingerprint(container);
      const geometryChanged = currentGeometry !== previous;
      const roomNow = checkRoom ? measureRoom(current, container, direction) : null;
      const roomClose = !checkRoom || Math.abs(roomNow - intendedRoom) <= roomTolerance;
      if (!geometryChanged && roomClose) {
        unchanged++;
        console.log("rAF no change:", attemptDeltaTime, "ms");
      } else {
        const reason = geometryChanged && !checkRoom ? `geometry changed (${previous} -> ${currentGeometry})` : geometryChanged ? `geometry changed (${previous} -> ${currentGeometry}), room=${roomNow}` : `geometry stable but room not close: room=${roomNow}, intendedRoom=${intendedRoom}, drift=${(roomNow - intendedRoom).toFixed(2)}`;
        console.log("rAF with change:", attemptDeltaTime, "ms \u2014", reason);
        previous = currentGeometry;
        unchanged = 0;
      }
      if (unchanged >= stableFrames) {
        console.log("Stabilized.");
        return frame + 1;
      }
    }
    console.log("Out of the stabilization loop");
    throw new Error(
      checkRoom ? `Exceeded ${maxFrames} frames waiting for layout stabilization within ${roomTolerance}px of intendedRoom=${intendedRoom} (last room=${measureRoom(current, container, direction)}).` : `Exceeded ${maxFrames} frames waiting for layout stabilization.`
    );
  }
  function geometryFingerprint(container) {
    return [
      scrollHeight(container),
      scrollY(container)
    ].join(":");
  }
  function nextAnimationFrame() {
    return new Promise(
      (resolve) => requestAnimationFrame(resolve)
    );
  }

  // src/dev/moveWorkZone.js
  async function moveWorkZone(current, container, direction = -1) {
    let room = measureRoom(current, container, direction);
    let slabIntersectionAtMinimum = isSlabIntersectionAtMinimum(container, room);
    while (!slabIntersectionAtMinimum) {
      const previousRoom = room;
      const scrollYBefore = scrollY(container);
      const scrollHeightBefore = scrollHeight(container);
      const heightBefore = current.getBoundingClientRect().height;
      const jump = clampJump(CALIBRATED_JUMP, room, container, direction);
      if (jump <= 0) break;
      const intendedRoom = previousRoom + jump;
      slabIntersectionAtMinimum = isSlabIntersectionAtMinimum(container, intendedRoom);
      console.log(
        `[moveWorkZone] before jump: direction=${direction}, previousRoom=${Math.round(previousRoom)}, jump=${Math.round(jump)}, intendedRoom=${Math.round(intendedRoom)}, scrollY=${Math.round(scrollYBefore)}, scrollHeight=${Math.round(scrollHeightBefore)}, current.height=${Math.round(heightBefore)}`
      );
      performJump(jump, container, direction);
      const scrollYImmediatelyAfterJump = scrollY(container);
      console.log(
        `[moveWorkZone] immediately after performJump: scrollY ${Math.round(scrollYBefore)} -> ${Math.round(scrollYImmediatelyAfterJump)} (expected ${Math.round(scrollYBefore + jump * direction)})`
      );
      let stableAfterFrames;
      try {
        stableAfterFrames = await waitLayoutStable(container, { current, direction, intendedRoom, stableFrames: 1 });
      } catch (err) {
        const connected = "isConnected" in current ? current.isConnected : null;
        const containerConnected = "isConnected" in container ? container.isConnected : null;
        const freshContainer = findScrollContainer();
        const containerIsStale = freshContainer !== container;
        const childCount = container.childElementCount;
        const effectiveOverflowAnchor = getComputedStyle(container).overflowAnchor;
        const roomNow = measureRoom(current, container, direction);
        throw new Error(
          `moveWorkZone jump did not stabilize within tolerance: direction=${direction}, previousRoom=${previousRoom}, jump=${jump}, intendedRoom=${intendedRoom}, room=${roomNow}, scrollY=${scrollY(container)}, scrollHeight ${scrollHeightBefore} -> ${scrollHeight(container)}, current.isConnected=${connected}, container.isConnected=${containerConnected}, containerIsStale=${containerIsStale}, container.childElementCount=${childCount}, container effectiveOverflowAnchor=${effectiveOverflowAnchor}` + (connected === false ? " (current was unmounted \u2014 use the restart-synchronization menu action, not a retry of this cursor)" : containerIsStale ? " (container is stale \u2014 findScrollContainer() now returns a different element)" : containerConnected === false ? " (container is stale \u2014 the scroll ancestor was replaced mid-traversal)" : " (both still connected and container is current \u2014 this is not an unmount, needs investigation)") + `. ${err.message}`
        );
      }
      room = measureRoom(current, container, direction);
      const scrollYAfter = scrollY(container);
      const scrollHeightAfter = scrollHeight(container);
      const heightAfter = current.getBoundingClientRect().height;
      const drift = room - intendedRoom;
      console.log(
        `[moveWorkZone] after jump: direction=${direction}, intendedRoom=${Math.round(intendedRoom)}, room=${Math.round(room)}, drift=${drift.toFixed(4)} stableAfterFrames=${stableAfterFrames}, scrollY ${Math.round(scrollYBefore)} -> ${Math.round(scrollYAfter)}, scrollHeight ${Math.round(scrollHeightBefore)} -> ${Math.round(scrollHeightAfter)}, current.height ${Math.round(heightBefore)} -> ${Math.round(heightAfter)}`
      );
    }
    return room;
  }
  function clampJump(calibratedJump, room, container, direction) {
    const viewportHeight = clientHeight(container);
    const pageHeight = scrollHeight(container);
    const distanceToExtremity = direction < 0 ? scrollY(container) : pageHeight - scrollY(container) - viewportHeight;
    return Math.min(
      calibratedJump,
      distanceToExtremity,
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
    const viewportHeight = clientHeight(container);
    const pageHeight = scrollHeight(container);
    const distanceToExtremity = direction < 0 ? scrollY(container) : pageHeight - scrollY(container) - viewportHeight;
    if (jump >= distanceToExtremity && direction < 0) {
      scrollTo(container, 0);
    } else if (jump >= distanceToExtremity) {
      scrollTo(container, pageHeight);
    } else {
      scrollBy(container, jump * direction);
    }
  }

  // src/dev/moveViewportToBottom.js
  async function moveViewportToBottom(container) {
    clickBottomNavItem();
    await waitLayoutStable(container);
    const current = lastUserSlab();
    if (current) {
      await moveWorkZone(current, container, 1);
      await waitLayoutStable(container);
    }
    scrollTo(container, scrollHeight(container));
    await waitLayoutStable(container);
    const decks = getDecks();
    if (decks.length > 0) {
      const viewportHeight = clientHeight(container);
      const deckBottom = decks[0].getBoundingClientRect().bottom;
      const delta = deckBottom - viewportHeight;
      console.log(
        `[moveViewportToBottom] aligning: deckBottom=${Math.round(deckBottom)}, viewportHeight=${Math.round(viewportHeight)}, delta=${Math.round(delta)}`
      );
      scrollBy(container, delta);
      await waitLayoutStable(container);
    }
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
  function lastUserSlab() {
    const userSlabs = document.querySelectorAll(
      '[data-message-author-role="user"]'
    );
    return userSlabs.length > 0 ? userSlabs[userSlabs.length - 1] : null;
  }

  // src/dev/mainOrchestration.js
  async function traverseConversation() {
    const container = findScrollContainer();
    await moveViewportToBottom(container);
    console.log(
      `[traverseConversation] after moveViewportToBottom: container=${container === document.documentElement ? "window" : container.className}, scrollY=${scrollY(container)}, scrollHeight=${scrollHeight(container)}, clientHeight=${clientHeight(container)}`
    );
    let room = clientHeight(container);
    let deckRoom = clientHeight(container);
    let deck = null;
    let current = null;
    let deckCount = 0;
    let slabCount = 0;
    while (true) {
      if (current && room < MAX_SLAB_GAP) {
        room = await moveWorkZone(current, container);
        console.log(
          `[traverseConversation] after moveWorkZone: room=${Math.round(room)}`
        );
      }
      if (deck) {
        deckRoom = deck.getBoundingClientRect().top;
      }
      let slab = deck && room - deckRoom >= MINIMUM_SLAB_HEIGHT ? nextSlab(room, deck) : null;
      if (slab == null) {
        const deckTime = performance.now();
        deck = await nextReadyDeck(
          deckRoom,
          container
        );
        const deckDeltaTime = performance.now() - deckTime;
        if (deck == null) {
          console.log(
            `[traverseConversation] nextReadyDeck(deckRoom=${Math.round(deckRoom)}) returned null after ${deckCount} deck(s), ${slabCount} slab(s), scrollY=${scrollY(container)}, room=${Math.round(room)}.`
          );
          break;
        }
        deckCount++;
        deckRoom = deck.getBoundingClientRect().top;
        console.log(
          `[traverseConversation] deck #${deckCount}: deckRoom=${Math.round(deckRoom)}, waitDeck=${deckDeltaTime} ms, scrollY=${scrollY(container)}.`
        );
        slab = nextSlab(room, deck);
        if (!slab) throw new Error("No slab found in ready deck.");
      }
      current = slab;
      slabCount++;
      room = current.getBoundingClientRect().top;
      console.log(
        `[traverseConversation] slab #${slabCount}: room=${Math.round(room)}`
      );
    }
    console.log(
      `[traverseConversation] done: ${deckCount} deck(s), ${slabCount} slab(s) visited.`
    );
  }

  // src/dev/bootstrap.js
  var VERSION = true ? "0.74" : "unbuilt";
  console.log(`[dev traversal] loaded, version ${VERSION}`);
  GM_registerMenuCommand(`Run dev traversal v${VERSION} (geometry only)`, () => {
    traverseConversation().then(() => console.log("[dev traversal] finished.")).catch((err) => console.error("[dev traversal] failed:", err));
  });
})();
