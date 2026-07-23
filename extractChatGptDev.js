// ==UserScript==
// @name         ChatGPT Chat Extractor (dev)
// @namespace    http://tampermonkey.net/
// @version      2.02
// @description  Runs the in-progress src/dev/ geometric traversal only (no extraction yet).
// @author       Claude
// @match        https://chatgpt.com/*
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  // src/dev/constants.js
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

  // src/dev/geometry.js
  function areaAhead(referenceTop, maxGap) {
    return {
      top: referenceTop - maxGap,
      bottom: referenceTop
    };
  }

  // src/dev/slabType.js
  function slabType(slab) {
    if (!slab?.matches) return "empty";
    if (slab.matches(".group\\/imagegen-image")) return "image";
    if (slab.id?.startsWith("textdoc-message-")) return "canvas";
    if (slab.matches("[data-message-id]")) return "message";
    return "unknown";
  }

  // src/dev/scrollContainer.js
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

  // src/dev/boundary.js
  function boundaryOf(element, edge) {
    return { element, edge };
  }

  // src/dev/getNextAnchorIn.js
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

  // src/dev/cycleDiagnostics.js
  var previousCycle = null;
  var currentCycle = null;
  var runPerformanceOriginDiagnostics = 0;
  var runWallOriginDiagnostics = 0;
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
    return jumpDiagnostics.elapsedMs;
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

  // src/dev/supplyWorker.js
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
    imageReady = false;
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
        beginPendingAwaitDiagnostics("image-readiness", {
          slab: snapshotElementDiagnostics(slab),
          type
        });
        await waitImageReady(slab);
        finishPendingAwaitDiagnostics({
          slab: snapshotElementDiagnostics(slab),
          type
        });
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

  // src/dev/getNextSlabIn.js
  function getNextSlabRoomIn(slabRoom2, deckRoom2) {
    return selectNextSlabRoom(
      areaAhead(slabRoom2, MAX_SLAB_GAP),
      deckRoom2
    );
  }

  // src/dev/getNextDeckIn.js
  function getNextDeckRoomIn(deckRoom2) {
    return selectNextDeckRoom(
      areaAhead(deckRoom2, MAX_DECK_GAP)
    );
  }

  // src/dev/waitLayoutStable.js
  async function waitLayoutStable({
    maxFrames = 300,
    trackAnchor = false
  } = {}) {
    const stableFrames = trackAnchor && roomUntilFirstNotReadyDeck() > ACTIVATION_DISTANCE ? 1 : 2;
    let previous = geometrySnapshot();
    let unchanged = 0;
    beginStabilizationDiagnostics({ stableFrames });
    for (let frame = 0; frame < maxFrames; frame++) {
      beginRafDiagnostics({ frame: frame + 1 });
      await nextAnimationFrame();
      finishRafWaitDiagnostics();
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
      recordRafTelemetryDiagnostics({
        geometryChangeMagnitude,
        scrollHeightChange,
        scrollHeightChangeIgnored: scrollHeightChange > 0 && effectiveScrollHeightChange === 0,
        scrollYChange,
        scrollHeight: currentGeometry.scrollHeight,
        scrollY: currentGeometry.scrollY,
        anchorPosition: positionAtFrame
      });
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

  // src/dev/moveAnchorToBottom.js
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

  // src/dev/moveSlabTopToBottom.js
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

  // src/dev/moveViewportToDocumentBottom.js
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

  // src/dev/mainOrchestration.js
  async function traverseConversation() {
    resetCycleDiagnostics();
    resetSupplyWorker();
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
      let nextSlabRoom = deckRoom2 != null && slabRoom2 - deckRoom2 >= MINIMUM_SLAB_HEIGHT ? getNextSlabRoomIn(
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
        nextSlabRoom = getNextSlabRoomIn(
          slabRoom2 ?? initialSlabRoom,
          deckRoom2
        );
        if (nextSlabRoom == null) {
          throw new Error("No slab found in active deck.");
        }
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
    flushCycleDiagnostics();
  }

  // src/dev/bootstrap.js
  var VERSION = true ? "2.02" : "unbuilt";
  console.log(`[dev traversal] loaded, version ${VERSION}`);
  var activeRuns = 0;
  var runTraversal = async () => {
    if (activeRuns > 0) {
      console.log("[dev traversal] ignored: a traversal is already in progress.");
      logActiveTraversalDiagnostics();
      return;
    }
    activeRuns++;
    console.log("[dev traversal] started.");
    try {
      await traverseConversation();
      console.log("[dev traversal] finished.");
    } catch (error) {
      selectCurrentJumpDiagnostics("error");
      logCycleContextDiagnostics();
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
