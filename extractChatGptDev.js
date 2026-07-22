// ==UserScript==
// @name         ChatGPT Chat Extractor (dev)
// @namespace    http://tampermonkey.net/
// @version      1.78
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
  var TOLERATED_ROUNDING = 1;
  var MAX_SLAB_GAP = 160;
  var MAX_DECK_GAP = 20;
  var CALIBRATED_JUMP = 480;
  var MAX_DRIFT = 2;
  var MIN_SCROLL_HEIGHT_CHANGE = 20;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;
  var ACTIVATION_DISTANCE = 3e3;

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
    if (!element?.getBoundingClientRect) return null;
    const rect = element.getBoundingClientRect();
    const source = element.element ?? element;
    const sourceRect = source.getBoundingClientRect?.() ?? rect;
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
      connected: element.isConnected ?? null
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
      "anchor-bottom-check",
      "slab-room-measurement",
      "anchor-search",
      "anchor-selection",
      "deck-room",
      "deck-decision",
      "deck-search",
      "deck-active"
    ]);
    const isSlowSlab = cycle.stages.some((stage) => stage.stage === "slow-slab");
    return cycle.stages.map((stage, index) => ({ stage, index })).filter(
      ({ stage }) => relevantStages.has(stage.stage) || isSlowSlab && slowSlabTimingStages.has(stage.stage) && stageIsUsefulSlowTimingDiagnostics(stage) || stage.stage === "deck-active" && Math.max(stage.waitedMs ?? 0, 0) >= SLOW_AWAIT_MS
    );
  }
  function stageIsUsefulSlowTimingDiagnostics(stage) {
    if ([
      "anchor-bottom-check",
      "slab-room-measurement",
      "anchor-search",
      "anchor-selection"
    ].includes(stage.stage)) {
      return Math.max(stage.elapsedMs ?? 0, stage.wallElapsedMs ?? 0) >= SLOW_AWAIT_MS;
    }
    return true;
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
    recordCycleStageDiagnostics("slab-search", {
      room,
      area,
      slabCount: slabs.length,
      candidates: candidates.map(snapshotElementDiagnostics),
      selected: snapshotElementDiagnostics(slab)
    });
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

  // src/dev/nextActiveDeck.js
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
    recordCycleStageDiagnostics("deck-search", {
      deckRoom,
      area,
      deckCount: decks.length,
      first: snapshotElementDiagnostics(decks[0]),
      last: snapshotElementDiagnostics(decks[decks.length - 1]),
      candidates: candidates.map(snapshotElementDiagnostics),
      excludedCurrent: snapshotElementDiagnostics(currentDeck),
      selected: snapshotElementDiagnostics(deck),
      activation: deck?.getAttribute("data-is-intersecting") ?? null
    });
    if (deck == null) {
      return null;
    }
    const startedAtDiagnostics = performance.now();
    beginPendingAwaitDiagnostics("deck-activation", {
      deck: snapshotElementDiagnostics(deck),
      activation: deck.getAttribute("data-is-intersecting")
    });
    await waitDeckActive(deck);
    finishPendingAwaitDiagnostics({
      deck: snapshotElementDiagnostics(deck),
      activation: deck.getAttribute("data-is-intersecting")
    });
    recordCycleStageDiagnostics("deck-active", {
      waitedMs: performance.now() - startedAtDiagnostics,
      deck: snapshotElementDiagnostics(deck),
      activation: deck.getAttribute("data-is-intersecting")
    });
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

  // src/dev/stabilize.js
  async function waitLayoutStable(workZone, {
    stableFrames = 2,
    maxFrames = 300,
    current = null,
    phase = "layout"
  } = {}) {
    const checkAnchor = current != null;
    let previous = geometrySnapshot(workZone);
    let unchanged = 0;
    beginStabilizationDiagnostics({ phase, stableFrames });
    for (let frame = 0; frame < maxFrames; frame++) {
      beginRafDiagnostics({ frame: frame + 1 });
      await nextAnimationFrame();
      finishRafWaitDiagnostics();
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
      recordRafTelemetryDiagnostics({
        geometryChangeMagnitude,
        scrollHeightChange,
        scrollHeightChangeIgnored: scrollHeightChange > 0 && effectiveScrollHeightChange === 0,
        scrollYChange,
        scrollHeight: currentGeometry.scrollHeight,
        scrollY: currentGeometry.scrollY,
        anchorRoom: roomAtFrame
      });
      if (geometryChanged) {
        finishRafDiagnostics({ status: "geometry-changed" });
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
          room: roomNow
        });
        return {
          frames: frame + 1,
          status: "stable",
          room: roomNow
        };
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
      beginYieldDiagnostics({ index: yieldIndex, roomBefore: previousRoom });
      await yieldToScheduler();
      const room = current != null ? workZone.roomAheadOf(current) : null;
      const change = room == null || previousRoom == null ? 0 : Math.abs(room - previousRoom);
      const changed = change !== 0;
      finishYieldDiagnostics({ roomAfter: room, change, changed });
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

  // src/dev/moveAnchorToBottom.js
  async function moveAnchorToBottom(anchor, workZone, calibratedJump = CALIBRATED_JUMP) {
    beginJumpDiagnostics({
      kind: "anchor-move",
      anchor: snapshotElementDiagnostics(anchor)
    });
    if (workZone.isAtSupplyBoundary()) {
      const room2 = workZone.roomAheadOf(anchor);
      finishJumpDiagnostics({
        roomBefore: room2,
        obtainedRoom: room2,
        scrollYAfter: workZone.position,
        status: "movement-impossible"
      });
      logSlowJumpDiagnosticsIfNeeded();
      return room2;
    }
    let room = workZone.roomAheadOf(anchor);
    let retriedErasedJump = false;
    let anchorAtBottom = measuredAnchorBottomCheck(
      workZone,
      room,
      "before-first-jump"
    );
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
        anchor: snapshotElementDiagnostics(anchor)
      });
      if (workZone.isAtSupplyBoundary()) {
        finishJumpDiagnostics({
          roomBefore: room,
          obtainedRoom: room,
          scrollYAfter: workZone.position,
          status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
      }
      const jump = clampJump(calibratedJump, room, workZone);
      const scrollYBefore = workZone.position;
      beginOrContinueJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchor),
        roomBefore: room,
        jump,
        scrollYBefore
      });
      workZone.moveBy(jump);
      const scrollYAfter = workZone.position;
      const intendedRoom = workZone.roomAheadOf(anchor);
      if (scrollYAfter === scrollYBefore) {
        finishJumpDiagnostics({
          scrollYAfter,
          intendedRoom,
          obtainedRoom: workZone.roomAheadOf(anchor),
          status: "no-movement"
        });
        logSlowJumpDiagnosticsIfNeeded();
        break;
      }
      updateJumpDiagnostics({
        scrollYAfter,
        intendedRoom,
        immediateAnchor: snapshotElementDiagnostics(anchor)
      });
      const roomUntilFirstNotReadyDeck = measureRoomUntilFirstNotReadyDeck(workZone);
      const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE ? 2 : 1;
      updateJumpDiagnostics({ roomUntilFirstNotReadyDeck });
      const postJumpStabilization = await waitLayoutStable(workZone, {
        current: anchor,
        stableFrames,
        phase: "post-jump"
      });
      const obtainedRoom = workZone.roomAheadOf(anchor);
      finishJumpDiagnostics({
        postJumpStabilization,
        obtainedRoom,
        settledAnchor: snapshotElementDiagnostics(anchor)
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
      anchorAtBottom = measuredAnchorBottomCheck(
        workZone,
        room,
        "after-post-jump-stabilization"
      );
    }
    return room;
  }
  function measuredAnchorBottomCheck(workZone, room, phase) {
    const startedAtDiagnostics = performance.now();
    const startedWallAtDiagnostics = Date.now();
    const viewportHeight = workZone.height;
    const targetRoom = viewportHeight - MIN_INTERSECT;
    const atBottom = room >= targetRoom - TOLERATED_ROUNDING;
    recordCycleStageDiagnostics("anchor-bottom-check", {
      phase,
      elapsedMs: performance.now() - startedAtDiagnostics,
      wallElapsedMs: Date.now() - startedWallAtDiagnostics,
      room,
      viewportHeight,
      targetRoom,
      toleratedRounding: TOLERATED_ROUNDING,
      atBottom
    });
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

  // src/dev/slabType.js
  function slabType(slab) {
    if (!slab?.matches) return "empty";
    if (slab.matches(".group\\/imagegen-image")) return "image";
    if (slab.id?.startsWith("textdoc-message-")) return "canvas";
    if (slab.matches("[data-message-id]")) return "message";
    return "unknown";
  }

  // src/dev/getAnchorsIn.js
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
      recordSlabFallbackDiagnostics(slabAnchors);
      return slabAnchors;
    }
    const coveringAnchors = [];
    for (const candidate of [...descendants, slab]) {
      const rect = candidate.getBoundingClientRect();
      const anchor = boundaryAnchor(candidate, "top");
      const topRoom = workZone.roomAheadOf(anchor);
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

  // src/dev/moveSlabTopToBottom.js
  async function moveSlabTopToBottom(current, workZone) {
    const type = slabType(current);
    const slabTop = boundaryAnchor(current, "top");
    if (type === "unknown") {
      throw new Error("Cannot move an unknown slab type.");
    }
    if (type === "image" || type === "empty") {
      beginPendingAwaitDiagnostics("image-readiness", {
        slab: snapshotElementDiagnostics(current),
        type
      });
      await waitImageReady(current);
      finishPendingAwaitDiagnostics({
        slab: snapshotElementDiagnostics(current),
        type
      });
      return moveAnchorToBottom(
        slabTop,
        workZone,
        Infinity
      );
    }
    let room = measuredSlabRoom(
      slabTop,
      workZone,
      "initial"
    );
    while (room < 0) {
      const anchors = measuredAnchorSearch(
        current,
        workZone,
        "work-zone-entry"
      );
      const anchor = anchors[0];
      if (!anchor) {
        throw new Error("No ready visible anchor found in current slab.");
      }
      await moveAnchorToBottom(
        anchor,
        workZone
      );
      room = measuredSlabRoom(
        slabTop,
        workZone,
        "after-anchor-movement"
      );
    }
    await moveAnchorToBottom(
      slabTop,
      workZone
    );
    return measuredSlabRoom(
      slabTop,
      workZone,
      "after-final-anchor-movement"
    );
  }
  function measuredSlabRoom(slabTop, workZone, phase) {
    const startedAtDiagnostics = performance.now();
    const startedWallAtDiagnostics = Date.now();
    const room = workZone.roomAheadOf(slabTop);
    recordCycleStageDiagnostics("slab-room-measurement", {
      phase,
      elapsedMs: performance.now() - startedAtDiagnostics,
      wallElapsedMs: Date.now() - startedWallAtDiagnostics,
      room
    });
    return room;
  }
  function measuredAnchorSearch(current, workZone, phase) {
    const startedAtDiagnostics = performance.now();
    const startedWallAtDiagnostics = Date.now();
    const anchors = getAnchorsIn(current, workZone);
    recordCycleStageDiagnostics("anchor-search", {
      phase,
      elapsedMs: performance.now() - startedAtDiagnostics,
      wallElapsedMs: Date.now() - startedWallAtDiagnostics,
      anchorCount: anchors.length
    });
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

  // src/dev/moveViewportToDocumentBottom.js
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

  // src/dev/mainOrchestration.js
  async function traverseConversation() {
    resetCycleDiagnostics();
    try {
      const supplyArea = findSupplyArea();
      const workZone = supplyArea.workZone;
      const initial = await moveViewportToDocumentBottom(workZone);
      let room = initial.room;
      let deckRoom = initial.deckRoom;
      let deck = null;
      let current = null;
      let deckCountDiagnostics = 0;
      let slabCountDiagnostics = 0;
      let cycleCountDiagnostics = 0;
      while (true) {
        cycleCountDiagnostics++;
        beginCycleDiagnostics({
          cycle: cycleCountDiagnostics,
          deckCount: deckCountDiagnostics,
          slabCount: slabCountDiagnostics,
          room,
          deckRoom,
          scrollY: workZone.position,
          scrollHeight: workZone.supplyHeight,
          clientHeight: workZone.height,
          current: snapshotElementDiagnostics(current),
          deck: snapshotElementDiagnostics(deck)
        });
        if (current && room < MAX_SLAB_GAP) {
          room = await moveSlabTopToBottom(current, workZone);
        } else {
          recordCycleStageDiagnostics("move-skip", {
            current: snapshotElementDiagnostics(current),
            room
          });
        }
        if (deck) {
          deckRoom = deck.getBoundingClientRect().top;
        }
        recordCycleStageDiagnostics("deck-room", {
          deckRoom,
          deck: snapshotElementDiagnostics(deck)
        });
        let slab = deck && room - deckRoom >= MINIMUM_SLAB_HEIGHT ? nextSlab(room, deck) : null;
        recordCycleStageDiagnostics("deck-decision", {
          room,
          deckRoom,
          available: room - deckRoom,
          minimum: MINIMUM_SLAB_HEIGHT,
          needsDeck: slab == null
        });
        if (slab == null) {
          deck = await nextActiveDeck(deckRoom, deck);
          if (deck == null) {
            recordCycleStageDiagnostics("stop", {
              reason: "no-next-deck"
            });
            break;
          }
          deckCountDiagnostics++;
          deckRoom = deck.getBoundingClientRect().top;
          slab = nextSlab(room, deck);
          if (!slab) throw new Error("No slab found in active deck.");
        }
        current = slab;
        slabCountDiagnostics++;
        room = current.getBoundingClientRect().top;
        recordCycleStageDiagnostics("selected", {
          slabCount: slabCountDiagnostics,
          deckCount: deckCountDiagnostics,
          room,
          slab: snapshotElementDiagnostics(current),
          deck: snapshotElementDiagnostics(deck)
        });
      }
      flushCycleDiagnostics();
    } catch (error) {
      selectCurrentJumpDiagnostics("error");
      recordCycleStageDiagnostics("error", {
        name: error.name,
        message: error.message
      });
      logCycleContextDiagnostics();
      throw error;
    }
  }

  // src/dev/bootstrap.js
  var VERSION = true ? "1.78" : "unbuilt";
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
