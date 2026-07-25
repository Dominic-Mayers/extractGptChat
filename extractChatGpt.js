// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      5.20
// @description  Extracts a full ChatGPT conversation to Markdown via automated scrolling.
// @author       Claude
// @match        https://chatgpt.com/*
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
  var CALIBRATED_JUMP = 840;
  var MAX_DRIFT = 2;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;
  var ACTIVATION_DISTANCE = 1e3;
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

  // src/app/boundary.js
  function boundaryOf(element, edge) {
    return { element, edge };
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
      recordSlabFallbackDiagnostics(slabAnchors);
      return slabAnchors[0];
    }
    const coveringAnchors = [];
    for (const candidate of [...descendants, slab]) {
      const rect = candidate.getBoundingClientRect();
      const anchor = boundaryOf(candidate, "top");
      const topRoom = roomAhead(anchor, workZone);
      const bottomRoom = rect.bottom - viewportTop;
      if (topRoom < 0 && bottomRoom >= targetRoom - MAX_DRIFT) {
        recordNegativeAnchorDiagnostics(
          anchor,
          "covers-viewport-work-zone"
        );
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
  function recordNegativeAnchorDiagnostics(anchor, acceptanceReason) {
    anchor.acceptedNegative = true;
    anchor.acceptanceReason = acceptanceReason;
    anchor.fallbackKind = "negative-covering-anchor";
  }
  function recordSlabFallbackDiagnostics(anchors) {
    for (const anchor of anchors) {
      anchor.fallbackKind = "slab-boundary";
    }
  }

  // src/app/cycleDiagnostics.js
  var previousCycle = null;
  var currentCycle = null;
  var runPerformanceOriginDiagnostics = 0;
  var runWallOriginDiagnostics = 0;
  var executionTimeStatisticsDiagnostics = null;
  var deckSectionAtActivationDiagnostics = null;
  var enumeratedDecksDiagnostics = null;
  var deckSectionReadinessDiagnostics = null;
  var deckUpdatesDiagnostics = null;
  var SLOW_JUMP_MS = 1e3;
  var SLOW_AWAIT_MS = 1e3;
  var SLOW_SLAB_MS = 2e3;
  var pendingTimersDiagnostics = /* @__PURE__ */ new WeakMap();
  var selectedJumpReasonsDiagnostics = /* @__PURE__ */ new WeakMap();
  var emittedCyclesDiagnostics = /* @__PURE__ */ new WeakSet();
  function resetCycleDiagnostics() {
    previousCycle = null;
    currentCycle = null;
    runPerformanceOriginDiagnostics = performance.now();
    runWallOriginDiagnostics = Date.now();
    executionTimeStatisticsDiagnostics = {
      jumpCount: 0,
      sumJumpSize: 0,
      sumJumpSizeSquared: 0,
      sumJumpElapsedMs: 0,
      sumJumpWallElapsedMs: 0,
      sumJumpSizeElapsedMs: 0,
      sumJumpSizeWallElapsedMs: 0
    };
    deckSectionAtActivationDiagnostics = /* @__PURE__ */ new Map();
    enumeratedDecksDiagnostics = /* @__PURE__ */ new Set();
    deckSectionReadinessDiagnostics = {
      activatedDeckCount: 0,
      activationSectionPresentCount: 0,
      enumeratedDeckCount: 0,
      enumerationSectionPresentCount: 0,
      missingAtActivation: [],
      missingAtEnumeration: [],
      changedBeforeEnumeration: []
    };
    deckUpdatesDiagnostics = [];
    selectedJumpReasonsDiagnostics = /* @__PURE__ */ new WeakMap();
    emittedCyclesDiagnostics = /* @__PURE__ */ new WeakSet();
  }
  function beginCycleDiagnostics(data) {
    finishCycleTimingDiagnostics(currentCycle);
    emitCompletedSelectionDiagnostics();
    previousCycle = currentCycle;
    currentCycle = {
      ...data,
      startedClock: clockDiagnostics(),
      stages: [],
      jumps: [],
      startedWallAtDiagnostics: Date.now(),
      startedAtDiagnostics: performance.now()
    };
  }
  function beginJumpDiagnostics(data) {
    if (!currentCycle) return;
    currentCycle.jumps.push({
      ...data,
      status: "pending",
      stabilizations: [],
      startedClock: clockDiagnostics(),
      startedWallAtDiagnostics: Date.now(),
      startedAtDiagnostics: performance.now()
    });
  }
  function beginOrContinueJumpDiagnostics(data) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics || jumpDiagnostics.status !== "pending") {
      beginJumpDiagnostics(data);
      return;
    }
    updateJumpDiagnostics(data);
  }
  function beginStabilizationDiagnostics(data = {}) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return;
    jumpDiagnostics.stabilizations.push({
      ...data,
      status: "pending",
      rafs: [],
      startedClock: clockDiagnostics(),
      startedWallAtDiagnostics: Date.now(),
      startedAtDiagnostics: performance.now()
    });
  }
  function finishStabilizationDiagnostics(data = {}) {
    const stabilizationDiagnostics = currentStabilizationDiagnostics();
    if (!stabilizationDiagnostics) return;
    const elapsedMs = performance.now() - stabilizationDiagnostics.startedAtDiagnostics;
    const wallElapsedMs = Date.now() - stabilizationDiagnostics.startedWallAtDiagnostics;
    delete stabilizationDiagnostics.startedAtDiagnostics;
    delete stabilizationDiagnostics.startedWallAtDiagnostics;
    Object.assign(stabilizationDiagnostics, data, {
      elapsedMs,
      wallElapsedMs,
      finishedClock: clockDiagnostics(),
      status: data.status ?? "complete"
    });
  }
  function beginRafDiagnostics(data = {}) {
    const stabilizationDiagnostics = currentStabilizationDiagnostics();
    if (!stabilizationDiagnostics) return;
    const rafDiagnostics = {
      ...data,
      status: "waiting-rAF",
      yields: [],
      startedClock: clockDiagnostics(),
      startedWallAtDiagnostics: Date.now(),
      startedAtDiagnostics: performance.now()
    };
    stabilizationDiagnostics.rafs.push(rafDiagnostics);
    armSlowAwaitDiagnostics(rafDiagnostics, "rAF");
  }
  function beginPendingAwaitDiagnostics(awaitType, data = {}) {
    if (!currentCycle) return;
    const awaitDiagnostics = {
      awaitType,
      ...data,
      status: "waiting",
      startedClock: clockDiagnostics(),
      startedWallAtDiagnostics: Date.now(),
      startedAtDiagnostics: performance.now()
    };
    currentCycle.pendingAwait = awaitDiagnostics;
    armSlowAwaitDiagnostics(awaitDiagnostics, awaitType);
  }
  function finishPendingAwaitDiagnostics(data = {}) {
    const awaitDiagnostics = currentCycle?.pendingAwait;
    if (!awaitDiagnostics) return;
    disarmSlowAwaitDiagnostics(awaitDiagnostics);
    const elapsedMs = performance.now() - awaitDiagnostics.startedAtDiagnostics;
    const wallElapsedMs = Date.now() - awaitDiagnostics.startedWallAtDiagnostics;
    Object.assign(awaitDiagnostics, data, {
      elapsedMs,
      wallElapsedMs,
      finishedClock: clockDiagnostics(),
      status: data.status ?? "complete"
    });
    delete awaitDiagnostics.startedAtDiagnostics;
    delete awaitDiagnostics.startedWallAtDiagnostics;
    if (Math.max(elapsedMs, wallElapsedMs) >= SLOW_AWAIT_MS) {
      selectJumpDiagnostics(`slow-${awaitDiagnostics.awaitType}`);
      currentCycle.forceLogDiagnostics = true;
    }
  }
  function finishRafWaitDiagnostics(data = {}) {
    const rafDiagnostics = currentRafDiagnostics();
    if (!rafDiagnostics) return;
    disarmSlowAwaitDiagnostics(rafDiagnostics);
    Object.assign(rafDiagnostics, data, {
      waitElapsedMs: performance.now() - rafDiagnostics.startedAtDiagnostics,
      waitWallElapsedMs: Date.now() - rafDiagnostics.startedWallAtDiagnostics,
      waitFinishedClock: clockDiagnostics(),
      status: "measuring"
    });
    delete rafDiagnostics.startedAtDiagnostics;
    delete rafDiagnostics.startedWallAtDiagnostics;
  }
  function recordRafTelemetryDiagnostics(data = {}) {
    const rafDiagnostics = currentRafDiagnostics();
    if (!rafDiagnostics) return;
    Object.assign(rafDiagnostics, data);
  }
  function beginYieldDiagnostics(data = {}) {
    const rafDiagnostics = currentRafDiagnostics();
    if (!rafDiagnostics) return;
    const yieldDiagnostics = {
      ...data,
      status: "waiting-yield",
      startedClock: clockDiagnostics(),
      startedWallAtDiagnostics: Date.now(),
      startedAtDiagnostics: performance.now()
    };
    rafDiagnostics.yields.push(yieldDiagnostics);
    armSlowAwaitDiagnostics(yieldDiagnostics, `yield-${data.index}`);
  }
  function finishYieldDiagnostics(data = {}) {
    const yieldDiagnostics = currentYieldDiagnostics();
    if (!yieldDiagnostics) return;
    disarmSlowAwaitDiagnostics(yieldDiagnostics);
    Object.assign(yieldDiagnostics, data, {
      elapsedMs: performance.now() - yieldDiagnostics.startedAtDiagnostics,
      wallElapsedMs: Date.now() - yieldDiagnostics.startedWallAtDiagnostics,
      finishedClock: clockDiagnostics(),
      status: "complete"
    });
    delete yieldDiagnostics.startedAtDiagnostics;
    delete yieldDiagnostics.startedWallAtDiagnostics;
  }
  function finishRafDiagnostics(data = {}) {
    const rafDiagnostics = currentRafDiagnostics();
    if (!rafDiagnostics) return;
    Object.assign(rafDiagnostics, data, {
      finishedClock: clockDiagnostics(),
      status: data.status ?? "complete"
    });
  }
  function updateJumpDiagnostics(data) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return;
    Object.assign(jumpDiagnostics, data);
  }
  function finishJumpDiagnostics(data = {}) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return null;
    const elapsedMs = performance.now() - jumpDiagnostics.startedAtDiagnostics;
    const wallElapsedMs = Date.now() - jumpDiagnostics.startedWallAtDiagnostics;
    delete jumpDiagnostics.startedAtDiagnostics;
    delete jumpDiagnostics.startedWallAtDiagnostics;
    Object.assign(jumpDiagnostics, data, {
      elapsedMs,
      wallElapsedMs,
      finishedClock: clockDiagnostics(),
      status: data.status ?? "complete"
    });
    recordExecutionTimeStatisticsDiagnostics(jumpDiagnostics);
    return jumpDiagnostics.elapsedMs;
  }
  function recordExecutionTimeStatisticsDiagnostics(jumpDiagnostics) {
    const jumpSize = jumpDiagnostics.requestedJump;
    if (executionTimeStatisticsDiagnostics == null || !Number.isFinite(jumpSize)) return;
    executionTimeStatisticsDiagnostics.jumpCount++;
    executionTimeStatisticsDiagnostics.sumJumpSize += jumpSize;
    executionTimeStatisticsDiagnostics.sumJumpSizeSquared += jumpSize * jumpSize;
    executionTimeStatisticsDiagnostics.sumJumpElapsedMs += jumpDiagnostics.elapsedMs;
    executionTimeStatisticsDiagnostics.sumJumpWallElapsedMs += jumpDiagnostics.wallElapsedMs;
    executionTimeStatisticsDiagnostics.sumJumpSizeElapsedMs += jumpSize * jumpDiagnostics.elapsedMs;
    executionTimeStatisticsDiagnostics.sumJumpSizeWallElapsedMs += jumpSize * jumpDiagnostics.wallElapsedMs;
  }
  function logSlowJumpDiagnosticsIfNeeded() {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics || Math.max(
      jumpDiagnostics.elapsedMs,
      jumpDiagnostics.wallElapsedMs
    ) < SLOW_JUMP_MS) return;
    selectJumpDiagnostics("slow-jump");
  }
  function logStabilizedJumpDiagnosticsIfNeeded() {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return;
    if (Math.max(
      jumpDiagnostics.elapsedMs,
      jumpDiagnostics.wallElapsedMs
    ) < SLOW_JUMP_MS) return;
    selectJumpDiagnostics("slow-jump");
  }
  function currentStabilizationDiagnostics() {
    const jumpDiagnostics = currentJumpDiagnostics();
    return jumpDiagnostics?.stabilizations[jumpDiagnostics.stabilizations.length - 1] ?? null;
  }
  function currentRafDiagnostics() {
    const stabilizationDiagnostics = currentStabilizationDiagnostics();
    return stabilizationDiagnostics?.rafs[stabilizationDiagnostics.rafs.length - 1] ?? null;
  }
  function currentYieldDiagnostics() {
    const rafDiagnostics = currentRafDiagnostics();
    return rafDiagnostics?.yields[rafDiagnostics.yields.length - 1] ?? null;
  }
  function armSlowAwaitDiagnostics(block, awaitType) {
    const timer = setTimeout(() => {
      block.slowAwait = awaitType;
      block.pendingElapsedMs = SLOW_AWAIT_MS;
      selectJumpDiagnostics(`slow-${awaitType}`);
      if (currentCycle) currentCycle.forceLogDiagnostics = true;
      emitPendingCycleDiagnostics(currentCycle, block);
      console.log(
        `[diagnostics pending] slab=${currentCycle?.slabCount ?? "?"} jump=${currentCycle?.jumps.length ?? "?"} await=${awaitType} elapsedMs>=${SLOW_AWAIT_MS}`
      );
    }, SLOW_AWAIT_MS);
    pendingTimersDiagnostics.set(block, timer);
  }
  function disarmSlowAwaitDiagnostics(block) {
    const timer = pendingTimersDiagnostics.get(block);
    if (timer != null) clearTimeout(timer);
    pendingTimersDiagnostics.delete(block);
  }
  function selectJumpDiagnostics(reason) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return;
    jumpDiagnostics.logReason = reason;
    jumpDiagnostics.logClock = clockDiagnostics();
    selectedJumpReasonsDiagnostics.set(jumpDiagnostics, reason);
  }
  function currentJumpDiagnostics() {
    return currentCycle?.jumps[currentCycle.jumps.length - 1] ?? null;
  }
  function recordCycleStageDiagnostics(stage, data = {}) {
    if (!currentCycle) return;
    currentCycle.stages.push({
      stage,
      clock: clockDiagnostics(),
      ...data
    });
  }
  function recordDeckSectionActivationDiagnostics(snapshot) {
    deckSectionAtActivationDiagnostics.set(snapshot.turnId, snapshot);
    deckSectionReadinessDiagnostics.activatedDeckCount++;
    if (snapshot.sectionCount > 0) {
      deckSectionReadinessDiagnostics.activationSectionPresentCount++;
    } else {
      deckSectionReadinessDiagnostics.missingAtActivation.push(snapshot);
    }
  }
  function recordDeckSectionEnumerationDiagnostics(snapshot) {
    if (enumeratedDecksDiagnostics.has(snapshot.turnId)) return;
    enumeratedDecksDiagnostics.add(snapshot.turnId);
    const activated = deckSectionAtActivationDiagnostics.get(snapshot.turnId) ?? null;
    deckSectionReadinessDiagnostics.enumeratedDeckCount++;
    if (snapshot.sectionCount > 0) {
      deckSectionReadinessDiagnostics.enumerationSectionPresentCount++;
    } else {
      deckSectionReadinessDiagnostics.missingAtEnumeration.push(snapshot);
    }
    if (activated != null && JSON.stringify(activated) !== JSON.stringify(snapshot)) {
      deckSectionReadinessDiagnostics.changedBeforeEnumeration.push({
        turnId: snapshot.turnId,
        activated,
        enumerated: snapshot
      });
    }
  }
  function recordDeckUpdateDiagnostics(data) {
    deckUpdatesDiagnostics.push({
      clock: clockDiagnostics(),
      ...data
    });
  }
  function clockDiagnostics() {
    return {
      performanceMs: performance.now() - runPerformanceOriginDiagnostics,
      wallMs: Date.now() - runWallOriginDiagnostics
    };
  }
  function snapshotElementDiagnostics(element) {
    const source = element?.element ?? element;
    if (!source?.getBoundingClientRect) return null;
    const sourceRect = source.getBoundingClientRect();
    const boundary = element.edge == null ? null : sourceRect[element.edge];
    const rect = boundary == null ? sourceRect : {
      top: boundary,
      bottom: boundary,
      height: 0
    };
    return {
      id: source.getAttribute?.("data-message-id") ?? source.getAttribute?.("data-turn-id-container") ?? source.id ?? "synthetic",
      selector: selectorDiagnostics(source),
      edge: element.edge ?? null,
      acceptedNegative: element.acceptedNegative ?? false,
      acceptanceReason: element.acceptanceReason ?? null,
      fallbackKind: element.fallbackKind ?? null,
      top: roundDiagnostics(rect.top),
      bottom: roundDiagnostics(rect.bottom),
      height: roundDiagnostics(rect.height),
      sourceTop: roundDiagnostics(sourceRect.top),
      sourceBottom: roundDiagnostics(sourceRect.bottom),
      sourceHeight: roundDiagnostics(sourceRect.height),
      connected: source.isConnected ?? null
    };
  }
  function selectorDiagnostics(element) {
    const messageId = element.getAttribute?.("data-message-id");
    if (messageId != null) {
      return `[data-message-id="${escapeAttributeDiagnostics(messageId)}"]`;
    }
    const turnId = element.getAttribute?.("data-turn-id-container");
    if (turnId != null) {
      return `[data-turn-id-container="${escapeAttributeDiagnostics(turnId)}"]`;
    }
    if (element.id) {
      const escapedId = typeof globalThis.CSS?.escape === "function" ? globalThis.CSS.escape(element.id) : escapeAttributeDiagnostics(element.id);
      return `#${escapedId}`;
    }
    return null;
  }
  function escapeAttributeDiagnostics(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  function logCycleContextDiagnostics() {
    finishCycleTimingDiagnostics(currentCycle);
    emitSlabDiagnostics(previousCycle, "PREVIOUS");
    emitSlabDiagnostics(currentCycle, "CURRENT", true);
  }
  function logActiveTraversalDiagnostics() {
    if (!currentCycle) {
      console.log("[diagnostics active] no traversal cycle has started.");
      return;
    }
    const jumpDiagnostics = currentJumpDiagnostics();
    const stabilizationDiagnostics = currentStabilizationDiagnostics();
    const rafDiagnostics = currentRafDiagnostics();
    const yieldDiagnostics = currentYieldDiagnostics();
    const candidatesDiagnostics = [
      currentCycle.pendingAwait,
      yieldDiagnostics,
      rafDiagnostics,
      stabilizationDiagnostics,
      jumpDiagnostics
    ];
    const activeDiagnostics = candidatesDiagnostics.find(
      (candidate) => candidate?.status === "waiting" || candidate?.status === "waiting-yield" || candidate?.status === "waiting-rAF" || candidate?.status === "measuring" || candidate?.status === "pending"
    ) ?? {
      awaitType: "active-no-recorded-await",
      status: "unknown",
      clock: clockDiagnostics()
    };
    emitPendingCycleDiagnostics(currentCycle, activeDiagnostics);
  }
  function selectCurrentJumpDiagnostics(reason = "selected") {
    if (reason == null) return;
    selectJumpDiagnostics(reason);
  }
  function flushCycleDiagnostics() {
    if (!currentCycle) return;
    finishCycleTimingDiagnostics(currentCycle);
    currentCycle.forceLogDiagnostics = true;
    emitSlabDiagnostics(currentCycle, "FINAL", true);
    emitDeckSectionReadinessDiagnostics();
    emitDeckUpdatesDiagnostics();
    emitExecutionTimeStatisticsDiagnostics();
  }
  function emitDeckSectionReadinessDiagnostics() {
    console.log(
      "[deck section readiness]\n" + JSON.stringify(deckSectionReadinessDiagnostics, null, 2)
    );
  }
  function emitDeckUpdatesDiagnostics() {
    console.log(
      "[deck updates before deactivation]\n" + JSON.stringify(deckUpdatesDiagnostics, null, 2)
    );
  }
  function emitExecutionTimeStatisticsDiagnostics() {
    if (executionTimeStatisticsDiagnostics == null) return;
    const runElapsedMs = performance.now() - runPerformanceOriginDiagnostics;
    const runWallElapsedMs = Date.now() - runWallOriginDiagnostics;
    const {
      jumpCount,
      sumJumpSize,
      sumJumpElapsedMs,
      sumJumpWallElapsedMs
    } = executionTimeStatisticsDiagnostics;
    console.log(
      `\u2550\u2550\u2550\u2550 EXECUTION TIME STATISTICS \u2550\u2550\u2550\u2550
     ${formatValueDiagnostics({
        ...executionTimeStatisticsDiagnostics,
        runElapsedMs,
        runWallElapsedMs,
        nonJumpElapsedMs: runElapsedMs - sumJumpElapsedMs,
        nonJumpWallElapsedMs: runWallElapsedMs - sumJumpWallElapsedMs,
        averageJumpSize: jumpCount === 0 ? null : sumJumpSize / jumpCount,
        averageJumpElapsedMs: jumpCount === 0 ? null : sumJumpElapsedMs / jumpCount,
        averageJumpWallElapsedMs: jumpCount === 0 ? null : sumJumpWallElapsedMs / jumpCount
      })}`
    );
  }
  function emitCompletedSelectionDiagnostics() {
    if (!currentCycle || !cycleHasSelectedJumpDiagnostics(currentCycle) && currentCycle.forceLogDiagnostics !== true) return;
    emitSlabDiagnostics(previousCycle, "PREVIOUS");
    emitSlabDiagnostics(currentCycle, "CURRENT", true);
  }
  function emitPendingCycleDiagnostics(cycle, awaitDiagnostics) {
    if (!cycle) return;
    const lastStage = cycle.stages[cycle.stages.length - 1] ?? null;
    console.log([
      `\u2550\u2550\u2550\u2550 PENDING SLAB ${cycle.slabCount} START \u2550\u2550\u2550\u2550`,
      `     ${formatObjectDiagnostics(cycle, [
        "cycle",
        "stages",
        "jumps",
        "pendingAwait"
      ])}`,
      `PENDING AWAIT  ${formatValueDiagnostics(awaitDiagnostics)}`,
      `CURRENT STAGE  ${lastStage == null ? "none" : formatValueDiagnostics(lastStage)}`,
      `\u2550\u2550\u2550\u2550 PENDING SLAB ${cycle.slabCount} END \u2550\u2550\u2550\u2550`
    ].join("\n"));
  }
  function cycleHasSelectedJumpDiagnostics(cycle) {
    return cycle?.jumps.some((jump) => selectedJumpReasonsDiagnostics.has(jump)) ?? false;
  }
  function finishCycleTimingDiagnostics(cycle) {
    if (!cycle || cycle.elapsedMs != null) return;
    cycle.elapsedMs = performance.now() - cycle.startedAtDiagnostics;
    cycle.wallElapsedMs = Date.now() - cycle.startedWallAtDiagnostics;
    delete cycle.startedAtDiagnostics;
    delete cycle.startedWallAtDiagnostics;
    if (Math.max(cycle.elapsedMs, cycle.wallElapsedMs) < SLOW_SLAB_MS) return;
    cycle.forceLogDiagnostics = true;
    cycle.stages.push({
      stage: "slow-slab",
      clock: clockDiagnostics(),
      elapsedMs: cycle.elapsedMs,
      wallElapsedMs: cycle.wallElapsedMs,
      thresholdMs: SLOW_SLAB_MS
    });
    let slowestJump = null;
    let slowestJumpElapsed = -Infinity;
    for (const jump of cycle.jumps) {
      const elapsed = Math.max(
        jump.elapsedMs ?? 0,
        jump.wallElapsedMs ?? 0
      );
      if (elapsed <= slowestJumpElapsed) continue;
      slowestJump = jump;
      slowestJumpElapsed = elapsed;
    }
    if (slowestJump) {
      selectedJumpReasonsDiagnostics.set(slowestJump, "slow-slab");
    }
  }
  function emitSlabDiagnostics(cycle, context, selectedOnly = false) {
    if (!cycle || emittedCyclesDiagnostics.has(cycle)) return;
    console.log([
      `\u2550\u2550\u2550\u2550 ${context} SLAB ${cycle.slabCount} START \u2550\u2550\u2550\u2550`,
      `     ${formatObjectDiagnostics(cycle, [
        "cycle",
        "stages",
        "jumps"
      ])}`
    ].join("\n"));
    const includedJumpIndexes = selectedOnly ? selectedJumpIndexesDiagnostics(cycle) : [];
    for (const jumpIndex of includedJumpIndexes) {
      emitJumpDiagnostics(cycle.jumps[jumpIndex], jumpIndex + 1);
    }
    for (const { stage, index } of relevantStagesDiagnostics(cycle)) {
      console.log([
        `SLAB ${cycle.slabCount} STAGE ${String(index + 1).padStart(2, "0")} ` + stage.stage.toUpperCase().replace(/-/g, " "),
        `     ${formatObjectDiagnostics(stage, ["stage"])}`
      ].join("\n"));
    }
    console.log(`\u2550\u2550\u2550\u2550 ${context} SLAB ${cycle.slabCount} END \u2550\u2550\u2550\u2550`);
    emittedCyclesDiagnostics.add(cycle);
  }
  function relevantStagesDiagnostics(cycle) {
    const relevantStages = /* @__PURE__ */ new Set(["selected", "stop", "error", "slow-slab"]);
    const slowSlabTimingStages = /* @__PURE__ */ new Set([
      "deck-room",
      "deck-decision",
      "deck-search",
      "deck-active"
    ]);
    const isSlowSlab = cycle.stages.some((stage) => stage.stage === "slow-slab");
    return cycle.stages.map((stage, index) => ({ stage, index })).filter(
      ({ stage }) => relevantStages.has(stage.stage) || isSlowSlab && slowSlabTimingStages.has(stage.stage) || stage.stage === "deck-active" && Math.max(stage.waitedMs ?? 0, 0) >= SLOW_AWAIT_MS
    );
  }
  function selectedJumpIndexesDiagnostics(cycle) {
    const indexes = /* @__PURE__ */ new Set();
    for (let index = 0; index < cycle.jumps.length; index++) {
      if (!selectedJumpReasonsDiagnostics.has(cycle.jumps[index])) continue;
      if (index > 0) indexes.add(index - 1);
      indexes.add(index);
    }
    return [...indexes].sort((a, b) => a - b);
  }
  function emitJumpDiagnostics(jumpDiagnostics, jumpNumber) {
    const selected = selectedJumpReasonsDiagnostics.has(jumpDiagnostics);
    console.log([
      `\u2500\u2500\u2500\u2500 JUMP ${String(jumpNumber).padStart(2, "0")} ${selected ? "SELECTED" : "PRECEDING"} \u2500\u2500\u2500\u2500`,
      `     ${formatObjectDiagnostics(jumpDiagnostics, ["stabilizations"])}`
    ].join("\n"));
    for (let stabilizationIndex = 0; stabilizationIndex < jumpDiagnostics.stabilizations.length; stabilizationIndex++) {
      const stabilizationDiagnostics = jumpDiagnostics.stabilizations[stabilizationIndex];
      console.log([
        `JUMP ${String(jumpNumber).padStart(2, "0")} STABILIZATION ${stabilizationIndex + 1}`,
        `     ${formatObjectDiagnostics(stabilizationDiagnostics, ["rafs"])}`
      ].join("\n"));
      for (const rafIndex of relevantRafIndexesDiagnostics(
        stabilizationDiagnostics
      )) {
        const rafDiagnostics = stabilizationDiagnostics.rafs[rafIndex];
        console.log([
          `JUMP ${String(jumpNumber).padStart(2, "0")} STABILIZATION ${stabilizationIndex + 1} RAF ${rafIndex + 1}`,
          `     ${formatObjectDiagnostics(rafDiagnostics, ["yields"])}`
        ].join("\n"));
        for (let yieldIndex = 0; yieldIndex < rafDiagnostics.yields.length; yieldIndex++) {
          const yieldDiagnostics = rafDiagnostics.yields[yieldIndex];
          console.log([
            `JUMP ${String(jumpNumber).padStart(2, "0")} STABILIZATION ${stabilizationIndex + 1} RAF ${rafIndex + 1} YIELD ${yieldIndex + 1}`,
            `     ${formatObjectDiagnostics(yieldDiagnostics)}`
          ].join("\n"));
        }
      }
    }
  }
  function relevantRafIndexesDiagnostics(stabilization) {
    const relevant = /* @__PURE__ */ new Set();
    for (let index = 0; index < stabilization.rafs.length; index++) {
      const raf = stabilization.rafs[index];
      const selected = raf.status !== "stable" || raf.scrollHeightChangeIgnored === true || Math.max(raf.waitElapsedMs ?? 0, raf.waitWallElapsedMs ?? 0) >= 250 || raf.slowAwait != null;
      if (!selected) continue;
      if (index > 0) relevant.add(index - 1);
      relevant.add(index);
    }
    const lastIndex = stabilization.rafs.length - 1;
    if (lastIndex >= 0) relevant.add(lastIndex);
    return [...relevant].sort((a, b) => a - b);
  }
  function formatObjectDiagnostics(value, excludedKeys = []) {
    const fields = Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => !excludedKeys.includes(key) && !key.endsWith("Diagnostics")
      )
    );
    return formatFieldsDiagnostics(fields);
  }
  function formatFieldsDiagnostics(value) {
    const entries = Object.entries(value).filter(([key]) => !key.endsWith("Diagnostics"));
    if (entries.length === 0) return "-";
    return entries.map(([key, item]) => `${key}=${formatValueDiagnostics(item)}`).join(" \u2502 ");
  }
  function formatValueDiagnostics(value) {
    if (value instanceof Error) {
      return JSON.stringify({
        name: value.name,
        message: value.message,
        stack: value.stack
      });
    }
    if (typeof value === "number") return String(roundDiagnostics(value));
    if (typeof value === "string") return value;
    if (value === null) return "null";
    if (value === void 0) return "undefined";
    if (Array.isArray(value)) {
      return `[${value.map(formatValueDiagnostics).join(", ")}]`;
    }
    if (typeof value === "object") {
      return `{${formatFieldsDiagnostics(value)}}`;
    }
    return JSON.stringify(value);
  }
  function roundDiagnostics(value) {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
  }

  // src/app/extraction.js
  var walkway = [];
  var assetCounter = 0;
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
      await waitSlabReady(type, slab);
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
  async function exportMarkdown(timestamp = Date.now()) {
    const prompts = walkway.flatMap((deck) => deck.prompts);
    const pendingImages = walkway.flatMap((deck) => deck.images);
    const pendingCanvases = walkway.flatMap((deck) => deck.canvases);
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
      unit.canvases.push({ text, token });
      return promptIdentity(
        slab,
        `[${title}](${token})`,
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
        unit.images.push({ url: source, token });
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
  async function checkUpdateNeededBeforeDeactivation(jump) {
    const { activeArea, workZone } = environment();
    const deactivationBoundary = workZoneTop(workZone) + workZone.height + ACTIVATION_DISTANCE;
    const decks = elementsIn(
      activeArea,
      '[data-turn-id-container][data-is-intersecting]:not([data-is-intersecting="false"])'
    );
    for (const deck of decks) {
      const rect = deck.getBoundingClientRect();
      const topAfterJump = rect.top + jump;
      if (topAfterJump < deactivationBoundary - TOLERATED_ROUNDING) {
        continue;
      }
      const turnIdDiagnostics = deck.getAttribute("data-turn-id-container");
      const previousDiagnostics = compiledDeckFor(turnIdDiagnostics);
      const slabTypesBeforeDiagnostics = getSlabsIn(deck).map((slab) => slabType(slab));
      const updated = isUpdated(deck);
      if (updated) await replaceByUpdate(deck);
      recordDeckUpdateDiagnostics({
        turnId: turnIdDiagnostics,
        jump,
        deactivationBoundary,
        top: rect.top,
        topAfterJump,
        compiledHeight: previousDiagnostics.height,
        currentHeight: rect.height,
        slabTypesBefore: slabTypesBeforeDiagnostics,
        decision: updated ? "replaced" : "unchanged",
        replacementHeight: updated ? compiledDeckFor(turnIdDiagnostics).height : null,
        slabTypesAfter: updated ? getSlabsIn(deck).map((slab) => slabType(slab)) : null
      });
    }
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
    recordCycleStageDiagnostics("deck-search", {
      deckRoom: area.bottom,
      area,
      deckCount: decks.length,
      first: snapshotElementDiagnostics(decks[0]),
      last: snapshotElementDiagnostics(decks[decks.length - 1]),
      candidates: candidates.map(snapshotElementDiagnostics),
      selected: snapshotElementDiagnostics(deck),
      activation: deck?.getAttribute("data-is-intersecting") ?? null
    });
    if (deck == null) return null;
    currentDeck = deck;
    currentSlab = null;
    currentAnchor = null;
    const startedAtDiagnostics = performance.now();
    beginPendingAwaitDiagnostics("deck-activation", {
      deck: snapshotElementDiagnostics(deck),
      activation: deck.getAttribute("data-is-intersecting")
    });
    await waitDeckActive(deck, activeArea);
    finishPendingAwaitDiagnostics({
      deck: snapshotElementDiagnostics(deck),
      activation: deck.getAttribute("data-is-intersecting")
    });
    recordCycleStageDiagnostics("deck-active", {
      waitedMs: performance.now() - startedAtDiagnostics,
      deck: snapshotElementDiagnostics(deck),
      activation: deck.getAttribute("data-is-intersecting")
    });
    captureDeckSectionActivationDiagnostics(deck);
    return deckGeometry(deck, workZone).room;
  }
  function selectNextSlabRoom(slabRoom2, deckRoom2) {
    const { workZone } = environment();
    const deck = retainedDeck();
    const area = areaAhead(slabRoom2, MAX_SLAB_GAP);
    captureDeckSectionEnumerationDiagnostics(deck);
    const slabs = getSlabsIn(deck);
    const candidates = slabs.filter((candidate) => {
      const geometry = slabGeometry(candidate, workZone);
      return geometry.bottomRoom >= area.top && geometry.room <= area.bottom;
    });
    const slab = closestSlab(area.bottom, candidates, workZone);
    recordCycleStageDiagnostics("slab-search", {
      room: area.bottom,
      deckRoom: deckRoom2,
      area,
      slabCount: slabs.length,
      candidates: candidates.map(snapshotElementDiagnostics),
      selected: snapshotElementDiagnostics(slab)
    });
    if (slab == null) return null;
    currentSlab = slab;
    currentAnchor = null;
    return slabGeometry(slab, workZone).room;
  }
  function captureDeckSectionActivationDiagnostics(deck) {
    const snapshot = deckSectionSnapshotDiagnostics(deck);
    recordDeckSectionActivationDiagnostics(snapshot);
  }
  function captureDeckSectionEnumerationDiagnostics(deck) {
    recordDeckSectionEnumerationDiagnostics(
      deckSectionSnapshotDiagnostics(deck)
    );
  }
  function deckSectionSnapshotDiagnostics(deck) {
    const sections = Array.from(deck.children).filter((child) => child.matches("section"));
    const section = sections[0] ?? null;
    const rect = section?.getBoundingClientRect();
    return {
      turnId: deck.getAttribute("data-turn-id-container"),
      sectionCount: sections.length,
      sectionHeight: rect?.height ?? null,
      sectionChildCount: section?.childElementCount ?? null,
      messageCount: section?.querySelectorAll("[data-message-id]").length ?? 0,
      imageCount: section?.querySelectorAll(".group\\/imagegen-image").length ?? 0,
      canvasCount: section?.querySelectorAll('[id^="textdoc-message-"]').length ?? 0
    };
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
        geometryChangeDiagnostics: deckGeometryChangeDiagnostics(
          deck,
          viewportTop
        ),
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
  function deckGeometryChangeDiagnostics(deck, viewportTop) {
    const computedStyle = getComputedStyle(deck);
    const investigatedDeck = deck.getAttribute("data-turn-id-container") === "a7c93c21-9530-40b2-8369-5a98541ea360";
    return {
      className: deck.getAttribute("class"),
      inlineLastKnownHeight: deck.style.getPropertyValue("--last-known-height"),
      resolvedLastKnownHeight: computedStyle.getPropertyValue("--last-known-height"),
      computedHeight: computedStyle.height,
      marginCollapse: investigatedDeck ? {
        deck: layoutElementDiagnostics(deck, viewportTop),
        parent: layoutElementDiagnostics(
          deck.parentElement,
          viewportTop
        ),
        previousSibling: layoutElementDiagnostics(
          deck.previousElementSibling,
          viewportTop
        ),
        children: Array.from(deck.children).map(
          (child) => layoutElementDiagnostics(child, viewportTop)
        )
      } : null
    };
  }
  function layoutElementDiagnostics(element, viewportTop) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tagName: element.tagName,
      className: element.getAttribute("class"),
      turnId: element.getAttribute("data-turn-id-container"),
      top: rect.top - viewportTop,
      bottom: rect.bottom - viewportTop,
      height: rect.height,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      borderTopWidth: style.borderTopWidth,
      borderBottomWidth: style.borderBottomWidth,
      display: style.display,
      overflow: style.overflow,
      position: style.position
    };
  }
  function moveWorkZoneBy(jump) {
    const { supplyArea, workZone } = environment();
    const anchorDiagnostics = retainedAnchor();
    const roomBeforeDiagnostics = roomAhead(anchorDiagnostics, workZone);
    const supplyRoomBeforeDiagnostics = workZonePosition(supplyArea, workZone);
    beginOrContinueJumpDiagnostics({
      kind: "anchor-move",
      anchor: snapshotElementDiagnostics(anchorDiagnostics),
      roomBefore: roomBeforeDiagnostics,
      jump,
      scrollYBefore: supplyRoomBeforeDiagnostics
    });
    moveWorkZone(jump, supplyArea, workZone);
    const supplyRoomAfterDiagnostics = workZonePosition(supplyArea, workZone);
    updateJumpDiagnostics({
      scrollYAfter: supplyRoomAfterDiagnostics,
      immediateAnchor: snapshotElementDiagnostics(anchorDiagnostics)
    });
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
    const stableFrames = trackAnchor && roomUntilFirstNotReadyDeck() > ACTIVATION_DISTANCE ? 1 : 2;
    let previous = geometrySnapshot();
    let previousRafGeometry = previous;
    let unchanged = 0;
    saveDeckActivationStatus(thresholdDeckSnapshot());
    beginStabilizationDiagnostics({ stableFrames });
    for (let frame = 0; frame < maxFrames; frame++) {
      beginRafDiagnostics({ frame: frame + 1 });
      await nextAnimationFrame();
      finishRafWaitDiagnostics();
      const currentGeometry = geometrySnapshot();
      const deckStatus = thresholdDeckSnapshot();
      const deckTransitions = deckActivationTransitions(deckStatus);
      saveDeckActivationStatus(deckStatus);
      evaluateThresholdsDiagnostics(deckStatus, frame + 1);
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
      recordRafTelemetryDiagnostics({
        geometryChangeMagnitude,
        scrollHeightChange,
        scrollHeightChangeIgnored: scrollHeightChange > 0 && effectiveScrollHeightChange === 0,
        scrollYChange,
        scrollHeight: currentGeometry.scrollHeight,
        scrollY: currentGeometry.scrollY,
        previousRafScrollHeight: previousRafGeometry.scrollHeight,
        previousRafScrollY: previousRafGeometry.scrollY,
        previousRafScrollHeightChange,
        previousRafScrollYChange,
        acceptedScrollHeight: previous.scrollHeight,
        acceptedScrollY: previous.scrollY,
        anchorPosition: positionAtFrame
      });
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
        finishRafDiagnostics({
          status: "ignored-reverse-deck-transition"
        });
        continue;
      }
      if (geometryChanged) {
        finishRafDiagnostics({ status: "geometry-changed" });
        previous = currentGeometry;
        unchanged = 0;
        continue;
      }
      const anchorStable = await checkAnchorAcrossYields(
        trackAnchor,
        positionAtFrame
      );
      const positionNowDiagnostics = trackAnchor ? anchorRoom() : null;
      if (!anchorStable) {
        finishRafDiagnostics({ status: "anchor-changed" });
        previous = currentGeometry;
        unchanged = 0;
        continue;
      }
      unchanged++;
      finishRafDiagnostics({ status: "stable", unchanged });
      if (unchanged >= stableFrames) {
        finishStabilizationDiagnostics({
          status: "stable",
          frames: frame + 1,
          position: positionNowDiagnostics
        });
        return;
      }
    }
    finishStabilizationDiagnostics({
      status: "exceeded-max-frames",
      frames: maxFrames
    });
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
      beginYieldDiagnostics({
        index: yieldIndex,
        positionBefore: previousPosition
      });
      await yieldToScheduler();
      const position = trackAnchor ? anchorRoom() : null;
      const change = position == null || previousPosition == null ? 0 : Math.abs(position - previousPosition);
      const changed = change !== 0;
      finishYieldDiagnostics({ positionAfter: position, change, changed });
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
  var thresholdEvaluationDiagnostics = {
    activationCount: 0,
    activationClosestDistance: -Infinity,
    deactivationCount: 0,
    deactivationClosestDistance: Infinity,
    previousDeckSnapshot: null
  };
  function evaluateThresholdsDiagnostics(current, frame) {
    const previous = thresholdEvaluationDiagnostics.previousDeckSnapshot;
    thresholdEvaluationDiagnostics.previousDeckSnapshot = current;
    if (!previous) return;
    for (const [deck, currentDeck2] of current.decks) {
      const previousDeck = previous.decks.get(deck);
      if (!previousDeck || previousDeck.state === currentDeck2.state) {
        continue;
      }
      const activated = previousDeck.state !== "true" && currentDeck2.state === "true";
      const deactivated = previousDeck.state === "true" && currentDeck2.state === "false";
      let evidence = null;
      if (activated && previousDeck.bottom <= 0) {
        const distance = -previousDeck.bottom;
        thresholdEvaluationDiagnostics.activationCount++;
        thresholdEvaluationDiagnostics.activationClosestDistance = Math.max(
          thresholdEvaluationDiagnostics.activationClosestDistance,
          distance
        );
        evidence = {
          threshold: "activation-above",
          distance
        };
      }
      if (deactivated && previousDeck.top >= previous.viewportHeight) {
        const distance = previousDeck.top - previous.viewportHeight;
        thresholdEvaluationDiagnostics.deactivationCount++;
        thresholdEvaluationDiagnostics.deactivationClosestDistance = Math.min(
          thresholdEvaluationDiagnostics.deactivationClosestDistance,
          distance
        );
        evidence = {
          threshold: "deactivation-below",
          distance
        };
      }
      console.log(
        "[diagnostics threshold transition]\n" + JSON.stringify({
          frame,
          turnId: currentDeck2.turnId,
          stateBefore: previousDeck.state,
          stateAfter: currentDeck2.state,
          previous: deckGeometryForThresholdDiagnostics(previousDeck),
          current: deckGeometryForThresholdDiagnostics(currentDeck2),
          viewportHeightBefore: previous.viewportHeight,
          viewportHeightAfter: current.viewportHeight,
          evidence,
          evaluation: thresholdEvaluationSummaryDiagnostics()
        }, null, 2)
      );
    }
  }
  function deckGeometryForThresholdDiagnostics(deck) {
    const geometry = deck.geometryChangeDiagnostics;
    return {
      state: deck.state,
      className: geometry.className,
      inlineLastKnownHeight: geometry.inlineLastKnownHeight,
      resolvedLastKnownHeight: geometry.resolvedLastKnownHeight,
      computedHeight: geometry.computedHeight,
      marginCollapse: geometry.marginCollapse,
      top: deck.top,
      bottom: deck.bottom,
      height: deck.height
    };
  }
  function thresholdEvaluationSummaryDiagnostics() {
    const {
      activationCount,
      activationClosestDistance,
      deactivationCount,
      deactivationClosestDistance
    } = thresholdEvaluationDiagnostics;
    return {
      activationCount,
      activationClosestDistance: Number.isFinite(activationClosestDistance) ? activationClosestDistance : null,
      deactivationCount,
      deactivationClosestDistance: Number.isFinite(deactivationClosestDistance) ? deactivationClosestDistance : null
    };
  }

  // src/app/moveAnchorToBottom.js
  async function moveAnchorToBottom(initialRoom, viewportHeight2, calibratedJump = CALIBRATED_JUMP) {
    beginJumpDiagnostics({
      kind: "anchor-move"
    });
    const currentSupplyRoom = supplyRoom();
    if (currentSupplyRoom <= 0) {
      finishJumpDiagnostics({
        roomBefore: initialRoom,
        obtainedRoom: initialRoom,
        scrollYAfter: currentSupplyRoom,
        status: "movement-impossible"
      });
      logSlowJumpDiagnosticsIfNeeded();
      return initialRoom;
    }
    let room = initialRoom;
    let retriedErasedJump = false;
    let anchorAtBottom = isAnchorAtBottom(viewportHeight2, room);
    if (anchorAtBottom) {
      finishJumpDiagnostics({
        roomBefore: room,
        obtainedRoom: room,
        status: "already-at-bottom"
      });
      logSlowJumpDiagnosticsIfNeeded();
      return room;
    }
    while (!anchorAtBottom) {
      beginOrContinueJumpDiagnostics({
        kind: "anchor-move",
        roomBefore: room
      });
      const supplyRoomBefore = supplyRoom();
      if (supplyRoomBefore <= 0) {
        finishJumpDiagnostics({
          roomBefore: room,
          obtainedRoom: room,
          scrollYAfter: supplyRoomBefore,
          status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
      }
      const jump = clampJump(calibratedJump, room, viewportHeight2);
      beginOrContinueJumpDiagnostics({
        requestedJump: jump
      });
      await checkUpdateNeededBeforeDeactivation(jump);
      moveWorkZoneBy(jump);
      const supplyRoomAfter = supplyRoom();
      if (supplyRoomAfter === supplyRoomBefore) {
        finishJumpDiagnostics({
          scrollYAfter: supplyRoomAfter,
          obtainedRoom: anchorRoom(),
          status: "no-movement"
        });
        logSlowJumpDiagnosticsIfNeeded();
        break;
      }
      await waitLayoutStable({ trackAnchor: true });
      const obtainedRoom = anchorRoom();
      finishJumpDiagnostics({
        obtainedRoom
      });
      logStabilizedJumpDiagnosticsIfNeeded();
      const jumpWasErased = obtainedRoom === room;
      if (jumpWasErased && retriedErasedJump) {
        selectCurrentJumpDiagnostics("erased-jump-retry-failed");
        throw new Error(
          `Anchor made no progress after retrying an erased jump at room=${room}.`
        );
      }
      selectCurrentJumpDiagnostics(
        jumpWasErased ? "erased-jump" : retriedErasedJump ? "erased-jump-retry-succeeded" : null
      );
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

  // src/app/moveSlabTopToBottom.js
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

  // src/app/moveViewportToDocumentBottom.js
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

  // src/app/mainOrchestration.js
  async function traverseConversation() {
    resetCycleDiagnostics();
    resetSupplyWorker();
    resetExtraction();
    const initial = await moveViewportToDocumentBottom();
    let slabRoom2 = null;
    let deckRoom2 = null;
    const initialSlabRoom = initial.room;
    const initialDeckRoom = initial.deckRoom;
    let deckCountDiagnostics = 0;
    let slabCountDiagnostics = 0;
    let cycleCountDiagnostics = 0;
    while (true) {
      cycleCountDiagnostics++;
      beginCycleDiagnostics({
        cycle: cycleCountDiagnostics,
        deckCount: deckCountDiagnostics,
        slabCount: slabCountDiagnostics,
        room: slabRoom2,
        deckRoom: deckRoom2,
        initialSlabRoom,
        initialDeckRoom
      });
      if (slabRoom2 != null && slabRoom2 < MAX_SLAB_GAP) {
        ({
          slabRoom: slabRoom2,
          deckRoom: deckRoom2
        } = await moveSlabTopToBottom(
          slabRoom2
        ));
      } else {
        recordCycleStageDiagnostics("move-skip", {
          room: slabRoom2
        });
      }
      recordCycleStageDiagnostics("deck-room", {
        deckRoom: deckRoom2
      });
      let nextSlabRoom = deckRoom2 != null && slabRoom2 - deckRoom2 >= MINIMUM_SLAB_HEIGHT ? selectNextSlabRoom(
        slabRoom2,
        deckRoom2
      ) : null;
      recordCycleStageDiagnostics("deck-decision", {
        room: slabRoom2,
        deckRoom: deckRoom2,
        available: slabRoom2 - deckRoom2,
        minimum: MINIMUM_SLAB_HEIGHT,
        needsDeck: nextSlabRoom == null
      });
      if (nextSlabRoom == null) {
        const nextDeckRoom = await getNextDeckRoomIn(
          deckRoom2 ?? initialDeckRoom
        );
        if (nextDeckRoom == null) {
          recordCycleStageDiagnostics("stop", {
            reason: "no-next-deck"
          });
          break;
        }
        deckCountDiagnostics++;
        deckRoom2 = nextDeckRoom;
        nextSlabRoom = selectNextSlabRoom(
          slabRoom2 ?? initialSlabRoom,
          deckRoom2
        );
        if (nextSlabRoom == null) {
          throw new Error("No slab found in active deck.");
        }
        await compileCurrentDeck();
      }
      slabCountDiagnostics++;
      slabRoom2 = nextSlabRoom;
      recordCycleStageDiagnostics("selected", {
        slabCount: slabCountDiagnostics,
        deckCount: deckCountDiagnostics,
        room: slabRoom2,
        deckRoom: deckRoom2
      });
    }
    await exportMarkdown();
    flushCycleDiagnostics();
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
      "Start a new conversation and send each copied prompt as a separate user message. Run the dev extractor, reopen this panel, then check the extracted content.",
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
      addResult(target, null, "Extraction state", "run the dev extractor first");
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
    compatibilityLabel,
    logPrefix
  }) {
    const VERSION2 = version;
    console.log(`[${logPrefix}] loaded, version ${VERSION2}`);
    let activeRuns = 0;
    const runTraversal = async () => {
      if (activeRuns > 0) {
        console.log(`[${logPrefix}] ignored: a traversal is already in progress.`);
        logActiveTraversalDiagnostics();
        return;
      }
      activeRuns++;
      console.log(`[${logPrefix}] started.`);
      try {
        await traverseConversation();
        console.log(`[${logPrefix}] finished.`);
      } catch (error) {
        selectCurrentJumpDiagnostics("error");
        logCycleContextDiagnostics();
        console.error(`[${logPrefix}] failed.`, error);
        throw error;
      } finally {
        activeRuns--;
      }
    };
    const menuLabel = `${runLabel} v${VERSION2}`;
    const registerMenuCommand = typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : typeof GM !== "undefined" && typeof GM.registerMenuCommand === "function" ? GM.registerMenuCommand.bind(GM) : null;
    if (registerMenuCommand) {
      registerMenuCommand(menuLabel, runTraversal);
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
  var VERSION = true ? "5.20" : "unbuilt";
  installExtractorApp({
    version: VERSION,
    runLabel: "Run extractor",
    compatibilityLabel: "Compatibility check",
    logPrefix: "extractor"
  });
})();
