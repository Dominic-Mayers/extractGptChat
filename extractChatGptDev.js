// ==UserScript==
// @name         ChatGPT Chat Extractor (dev)
// @namespace    http://tampermonkey.net/
// @version      1.50
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
  var MIN_SCROLL_HEIGHT_CHANGE = 20;
  var ADJACENCY_OVERLAP_TOLERANCE = 2;
  var ACTIVATION_DISTANCE = 1e3;

  // src/dev/cycleDiagnostics.js
  var previousCycle = null;
  var currentCycle = null;
  var runPerformanceOriginDiagnostics = 0;
  var runWallOriginDiagnostics = 0;
  var SLOW_JUMP_MS = 1e3;
  var SLOW_AWAIT_MS = 1e3;
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
    emitCompletedSelectionDiagnostics();
    previousCycle = currentCycle;
    currentCycle = {
      ...data,
      startedClock: clockDiagnostics(),
      stages: [],
      jumps: []
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
  function beginBeforeJumpRafDiagnostics() {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return;
    const rafDiagnostics = {
      status: "waiting-rAF",
      startedClock: clockDiagnostics(),
      startedWallAtDiagnostics: Date.now(),
      startedAtDiagnostics: performance.now()
    };
    jumpDiagnostics.beforeJumpRaf = rafDiagnostics;
    armSlowAwaitDiagnostics(rafDiagnostics, "before-jump-rAF");
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
  function finishBeforeJumpRafDiagnostics() {
    const rafDiagnostics = currentJumpDiagnostics()?.beforeJumpRaf;
    if (!rafDiagnostics) return;
    disarmSlowAwaitDiagnostics(rafDiagnostics);
    Object.assign(rafDiagnostics, {
      elapsedMs: performance.now() - rafDiagnostics.startedAtDiagnostics,
      wallElapsedMs: Date.now() - rafDiagnostics.startedWallAtDiagnostics,
      finishedClock: clockDiagnostics(),
      status: "complete"
    });
    delete rafDiagnostics.startedAtDiagnostics;
    delete rafDiagnostics.startedWallAtDiagnostics;
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
      jumpDiagnostics?.beforeJumpRaf,
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
    selectJumpDiagnostics(reason);
  }
  function flushCycleDiagnostics() {
    if (!currentCycle) return;
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
  function emitSlabDiagnostics(cycle, context, selectedOnly = false) {
    if (!cycle || emittedCyclesDiagnostics.has(cycle)) return;
    console.log([
      `\u2550\u2550\u2550\u2550 ${context} SLAB ${cycle.slabCount} START \u2550\u2550\u2550\u2550`,
      `     ${formatObjectDiagnostics(cycle, [
        "cycle",
        "stages",
        "jumps",
        "pendingAwait"
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
    const relevantStages = /* @__PURE__ */ new Set(["selected", "stop", "error"]);
    return cycle.stages.map((stage, index) => ({ stage, index })).filter(({ stage }) => relevantStages.has(stage.stage));
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

  // src/dev/nextReadyDeck.js
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
    recordCycleStageDiagnostics("deck-search", {
      deckRoom,
      area,
      deckCount: decks.length,
      first: snapshotElementDiagnostics(decks[0]),
      last: snapshotElementDiagnostics(decks[decks.length - 1]),
      candidates: candidates.map(snapshotElementDiagnostics),
      excludedCurrent: snapshotElementDiagnostics(currentDeck),
      selected: snapshotElementDiagnostics(deck),
      readiness: deck?.getAttribute("data-is-intersecting") ?? null
    });
    if (deck == null) {
      return null;
    }
    const startedAtDiagnostics = performance.now();
    beginPendingAwaitDiagnostics("deck-readiness", {
      deck: snapshotElementDiagnostics(deck),
      readiness: deck.getAttribute("data-is-intersecting")
    });
    await waitDeckReady(deck);
    finishPendingAwaitDiagnostics({
      deck: snapshotElementDiagnostics(deck),
      readiness: deck.getAttribute("data-is-intersecting")
    });
    recordCycleStageDiagnostics("deck-ready", {
      waitedMs: performance.now() - startedAtDiagnostics,
      deck: snapshotElementDiagnostics(deck),
      readiness: deck.getAttribute("data-is-intersecting")
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
    measureReferenceRoom = null,
    phase = "layout"
  } = {}) {
    const checkAnchor = current != null && measureReferenceRoom != null;
    let previous = geometrySnapshot(container);
    let unchanged = 0;
    beginStabilizationDiagnostics({ phase, stableFrames });
    for (let frame = 0; frame < maxFrames; frame++) {
      beginRafDiagnostics({ frame: frame + 1 });
      await nextAnimationFrame();
      finishRafWaitDiagnostics();
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
        container,
        direction,
        measureReferenceRoom,
        frame,
        roomAtFrame
      );
      const roomNow = checkAnchor ? measureReferenceRoom(current, container, direction) : null;
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
      beginYieldDiagnostics({ index: yieldIndex, roomBefore: previousRoom });
      await yieldToScheduler();
      const room = current != null && measureReferenceRoom != null ? measureReferenceRoom(current, container, direction) : null;
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
  async function moveAnchorToBottom(anchor, container, direction, measureAnchorRoom2, calibratedJump = CALIBRATED_JUMP) {
    beginJumpDiagnostics({
      kind: "anchor-move",
      anchor: snapshotElementDiagnostics(anchor)
    });
    if (isScrollBoundaryReached(container, direction)) {
      const room2 = measureAnchorRoom2(anchor, container, direction);
      finishJumpDiagnostics({
        roomBefore: room2,
        obtainedRoom: room2,
        scrollYAfter: scrollY(container),
        status: "movement-impossible"
      });
      logSlowJumpDiagnosticsIfNeeded();
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
      finishJumpDiagnostics({
        roomBefore: room,
        obtainedRoom: room,
        status: "already-at-bottom"
      });
      logSlowJumpDiagnosticsIfNeeded();
      return room;
    }
    while (!isAnchorAtBottom(container, room)) {
      beginOrContinueJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchor)
      });
      if (isScrollBoundaryReached(container, direction)) {
        finishJumpDiagnostics({
          roomBefore: room,
          obtainedRoom: room,
          scrollYAfter: scrollY(container),
          status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
      }
      beginBeforeJumpRafDiagnostics();
      await nextAnimationFrame();
      finishBeforeJumpRafDiagnostics();
      room = measureAnchorRoom2(anchor, container, direction);
      if (isAnchorAtBottom(container, room)) break;
      const jump = clampJump(calibratedJump, room, container);
      const scrollYBefore = scrollY(container);
      beginOrContinueJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchor),
        roomBefore: room,
        jump,
        scrollYBefore
      });
      performJump(jump, container, direction);
      const scrollYAfter = scrollY(container);
      const intendedRoom = measureAnchorRoom2(anchor, container, direction);
      if (scrollYAfter === scrollYBefore) {
        finishJumpDiagnostics({
          scrollYAfter,
          intendedRoom,
          obtainedRoom: measureAnchorRoom2(anchor, container, direction),
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
      const roomUntilFirstNotReadyDeck = measureRoomUntilFirstNotReadyDeck(container, direction);
      const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE ? 2 : 1;
      updateJumpDiagnostics({ roomUntilFirstNotReadyDeck });
      const stabilization = await waitLayoutStable(container, {
        current: anchor,
        direction,
        stableFrames,
        measureReferenceRoom: measureAnchorRoom2,
        phase: "post-jump"
      });
      const obtainedRoom = measureAnchorRoom2(anchor, container, direction);
      finishJumpDiagnostics({
        stabilization,
        obtainedRoom,
        settledAnchor: snapshotElementDiagnostics(anchor)
      });
      logStabilizedJumpDiagnosticsIfNeeded();
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
      recordSlabFallbackDiagnostics(slabAnchors);
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
        recordNegativeAnchorDiagnostics(
          anchor,
          "covers-viewport-work-zone"
        );
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
  function measureBoundaryRoom(anchor, viewportTop, viewportHeight, direction) {
    const rect = anchor.element.getBoundingClientRect();
    const boundary = rect[anchor.edge];
    return direction < 0 ? boundary - viewportTop : viewportTop + viewportHeight - boundary;
  }

  // src/dev/moveSlabTopToBottom.js
  async function moveSlabTopToBottom(current, container, direction = -1) {
    const type = slabType(current);
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

  // src/dev/moveViewportToDocumentBottom.js
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

  // src/dev/mainOrchestration.js
  async function traverseConversation() {
    resetCycleDiagnostics();
    try {
      const container = findScrollContainer();
      const initial = await moveViewportToDocumentBottom(container);
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
          scrollY: scrollY(container),
          scrollHeight: scrollHeight(container),
          clientHeight: clientHeight(container),
          current: snapshotElementDiagnostics(current),
          deck: snapshotElementDiagnostics(deck)
        });
        if (current && room < MAX_SLAB_GAP) {
          room = await moveSlabTopToBottom(current, container);
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
          deck = await nextReadyDeck(deckRoom, deck);
          if (deck == null) {
            recordCycleStageDiagnostics("stop", {
              reason: "no-next-deck"
            });
            break;
          }
          deckCountDiagnostics++;
          deckRoom = deck.getBoundingClientRect().top;
          slab = nextSlab(room, deck);
          if (!slab) throw new Error("No slab found in ready deck.");
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
  var VERSION = true ? "1.50" : "unbuilt";
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
