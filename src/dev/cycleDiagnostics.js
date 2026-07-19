let previousCycle = null;
let currentCycle = null;
let runPerformanceOriginDiagnostics = 0;
let runWallOriginDiagnostics = 0;

const SLOW_JUMP_MS = 1000;
const SLOW_AWAIT_MS = 1000;

const pendingTimersDiagnostics = new WeakMap();
let selectedJumpReasonsDiagnostics = new WeakMap();
let emittedCyclesDiagnostics = new WeakSet();

export function resetCycleDiagnostics() {
    previousCycle = null;
    currentCycle = null;
    runPerformanceOriginDiagnostics = performance.now();
    runWallOriginDiagnostics = Date.now();
    selectedJumpReasonsDiagnostics = new WeakMap();
    emittedCyclesDiagnostics = new WeakSet();
}

export function beginCycleDiagnostics(data) {
    emitCompletedSelectionDiagnostics();
    previousCycle = currentCycle;
    currentCycle = {
        ...data,
        startedClock: clockDiagnostics(),
        stages: [],
        jumps: []
    };
}

export function beginJumpDiagnostics(data) {
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

export function beginOrContinueJumpDiagnostics(data) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics || jumpDiagnostics.status !== "pending") {
        beginJumpDiagnostics(data);
        return;
    }
    updateJumpDiagnostics(data);
}

export function beginStabilizationDiagnostics(data = {}) {
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

export function finishStabilizationDiagnostics(data = {}) {
    const stabilizationDiagnostics = currentStabilizationDiagnostics();
    if (!stabilizationDiagnostics) return;
    const elapsedMs = performance.now() -
        stabilizationDiagnostics.startedAtDiagnostics;
    const wallElapsedMs = Date.now() -
        stabilizationDiagnostics.startedWallAtDiagnostics;
    delete stabilizationDiagnostics.startedAtDiagnostics;
    delete stabilizationDiagnostics.startedWallAtDiagnostics;
    Object.assign(stabilizationDiagnostics, data, {
        elapsedMs,
        wallElapsedMs,
        finishedClock: clockDiagnostics(),
        status: data.status ?? "complete"
    });
}

export function beginRafDiagnostics(data = {}) {
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

export function beginBeforeJumpRafDiagnostics() {
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

export function beginPendingAwaitDiagnostics(awaitType, data = {}) {
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

export function finishPendingAwaitDiagnostics(data = {}) {
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

export function finishBeforeJumpRafDiagnostics() {
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

export function finishRafWaitDiagnostics(data = {}) {
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

export function recordRafTelemetryDiagnostics(data = {}) {
    const rafDiagnostics = currentRafDiagnostics();
    if (!rafDiagnostics) return;
    Object.assign(rafDiagnostics, data);
}

export function beginYieldDiagnostics(data = {}) {
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

export function finishYieldDiagnostics(data = {}) {
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

export function finishRafDiagnostics(data = {}) {
    const rafDiagnostics = currentRafDiagnostics();
    if (!rafDiagnostics) return;
    Object.assign(rafDiagnostics, data, {
        finishedClock: clockDiagnostics(),
        status: data.status ?? "complete"
    });
}

export function updateJumpDiagnostics(data) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return;
    Object.assign(jumpDiagnostics, data);
}

export function finishJumpDiagnostics(data = {}) {
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

export function logSlowJumpDiagnosticsIfNeeded() {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (
        !jumpDiagnostics ||
        Math.max(
            jumpDiagnostics.elapsedMs,
            jumpDiagnostics.wallElapsedMs
        ) < SLOW_JUMP_MS
    ) return;
    selectJumpDiagnostics("slow-jump");
}

export function logStabilizedJumpDiagnosticsIfNeeded() {
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
    return jumpDiagnostics?.stabilizations[
        jumpDiagnostics.stabilizations.length - 1
    ] ?? null;
}

function currentRafDiagnostics() {
    const stabilizationDiagnostics = currentStabilizationDiagnostics();
    return stabilizationDiagnostics?.rafs[
        stabilizationDiagnostics.rafs.length - 1
    ] ?? null;
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
            `[diagnostics pending] slab=${currentCycle?.slabCount ?? "?"} ` +
            `jump=${currentCycle?.jumps.length ?? "?"} await=${awaitType} ` +
            `elapsedMs>=${SLOW_AWAIT_MS}`
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

export function recordCycleStageDiagnostics(stage, data = {}) {
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

export function snapshotElementDiagnostics(element) {
    if (!element?.getBoundingClientRect) return null;

    const rect = element.getBoundingClientRect();
    const source = element.element ?? element;
    const sourceRect = source.getBoundingClientRect?.() ?? rect;

    return {
        id: source.getAttribute?.("data-message-id") ??
            source.getAttribute?.("data-turn-id-container") ??
            source.id ??
            "synthetic",
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
        const escapedId = typeof globalThis.CSS?.escape === "function"
            ? globalThis.CSS.escape(element.id)
            : escapeAttributeDiagnostics(element.id);
        return `#${escapedId}`;
    }

    return null;
}

function escapeAttributeDiagnostics(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

export function logCycleContextDiagnostics() {
    emitSlabDiagnostics(previousCycle, "PREVIOUS");
    emitSlabDiagnostics(currentCycle, "CURRENT", true);
}

export function logActiveTraversalDiagnostics() {
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
    const activeDiagnostics = candidatesDiagnostics.find(candidate =>
        candidate?.status === "waiting" ||
        candidate?.status === "waiting-yield" ||
        candidate?.status === "waiting-rAF" ||
        candidate?.status === "measuring" ||
        candidate?.status === "pending"
    ) ?? {
        awaitType: "active-no-recorded-await",
        status: "unknown",
        clock: clockDiagnostics()
    };

    emitPendingCycleDiagnostics(currentCycle, activeDiagnostics);
}

export function selectCurrentJumpDiagnostics(reason = "selected") {
    selectJumpDiagnostics(reason);
}

export function flushCycleDiagnostics() {
    if (!currentCycle) return;
    currentCycle.forceLogDiagnostics = true;
    emitSlabDiagnostics(currentCycle, "FINAL", true);
}

function emitCompletedSelectionDiagnostics() {
    if (
        !currentCycle ||
        (!cycleHasSelectedJumpDiagnostics(currentCycle) &&
            currentCycle.forceLogDiagnostics !== true)
    ) return;
    emitSlabDiagnostics(previousCycle, "PREVIOUS");
    emitSlabDiagnostics(currentCycle, "CURRENT", true);
}

function emitPendingCycleDiagnostics(cycle, awaitDiagnostics) {
    if (!cycle) return;
    const lastStage = cycle.stages[cycle.stages.length - 1] ?? null;
    console.log([
        `════ PENDING SLAB ${cycle.slabCount} START ════`,
        `     ${formatObjectDiagnostics(cycle, [
            "cycle", "stages", "jumps", "pendingAwait"
        ])}`,
        `PENDING AWAIT  ${formatValueDiagnostics(awaitDiagnostics)}`,
        `CURRENT STAGE  ${lastStage == null
            ? "none"
            : formatValueDiagnostics(lastStage)}`,
        `════ PENDING SLAB ${cycle.slabCount} END ════`
    ].join("\n"));
}

function cycleHasSelectedJumpDiagnostics(cycle) {
    return cycle?.jumps.some(jump => selectedJumpReasonsDiagnostics.has(jump)) ?? false;
}

function emitSlabDiagnostics(cycle, context, selectedOnly = false) {
    if (!cycle || emittedCyclesDiagnostics.has(cycle)) return;

    console.log([
        `════ ${context} SLAB ${cycle.slabCount} START ════`,
        `     ${formatObjectDiagnostics(cycle, [
            "cycle", "stages", "jumps", "pendingAwait"
        ])}`
    ].join("\n"));

    const includedJumpIndexes = selectedOnly
        ? selectedJumpIndexesDiagnostics(cycle)
        : [];

    for (const jumpIndex of includedJumpIndexes) {
        emitJumpDiagnostics(cycle.jumps[jumpIndex], jumpIndex + 1);
    }

    for (const { stage, index } of relevantStagesDiagnostics(cycle)) {
        console.log([
            `SLAB ${cycle.slabCount} STAGE ${String(index + 1).padStart(2, "0")} ` +
                stage.stage.toUpperCase().replace(/-/g, " "),
            `     ${formatObjectDiagnostics(stage, ["stage"])}`
        ].join("\n"));
    }

    console.log(`════ ${context} SLAB ${cycle.slabCount} END ════`);
    emittedCyclesDiagnostics.add(cycle);
}

function relevantStagesDiagnostics(cycle) {
    const relevantStages = new Set(["selected", "stop", "error"]);
    return cycle.stages
        .map((stage, index) => ({ stage, index }))
        .filter(({ stage }) => relevantStages.has(stage.stage));
}

function selectedJumpIndexesDiagnostics(cycle) {
    const indexes = new Set();
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
        `──── JUMP ${String(jumpNumber).padStart(2, "0")} ` +
            `${selected ? "SELECTED" : "PRECEDING"} ────`,
        `     ${formatObjectDiagnostics(jumpDiagnostics, ["stabilizations"])}`
    ].join("\n"));

    for (
        let stabilizationIndex = 0;
        stabilizationIndex < jumpDiagnostics.stabilizations.length;
        stabilizationIndex++
    ) {
        const stabilizationDiagnostics =
            jumpDiagnostics.stabilizations[stabilizationIndex];
        console.log([
            `JUMP ${String(jumpNumber).padStart(2, "0")} ` +
                `STABILIZATION ${stabilizationIndex + 1}`,
            `     ${formatObjectDiagnostics(stabilizationDiagnostics, ["rafs"])}`
        ].join("\n"));

        for (const rafIndex of relevantRafIndexesDiagnostics(
            stabilizationDiagnostics
        )) {
            const rafDiagnostics = stabilizationDiagnostics.rafs[rafIndex];
            console.log([
                `JUMP ${String(jumpNumber).padStart(2, "0")} ` +
                    `STABILIZATION ${stabilizationIndex + 1} ` +
                    `RAF ${rafIndex + 1}`,
                `     ${formatObjectDiagnostics(rafDiagnostics, ["yields"])}`
            ].join("\n"));

            for (let yieldIndex = 0;
                yieldIndex < rafDiagnostics.yields.length;
                yieldIndex++) {
                const yieldDiagnostics = rafDiagnostics.yields[yieldIndex];
                console.log([
                    `JUMP ${String(jumpNumber).padStart(2, "0")} ` +
                        `STABILIZATION ${stabilizationIndex + 1} ` +
                        `RAF ${rafIndex + 1} YIELD ${yieldIndex + 1}`,
                    `     ${formatObjectDiagnostics(yieldDiagnostics)}`
                ].join("\n"));
            }
        }
    }
}

function relevantRafIndexesDiagnostics(stabilization) {
    const relevant = new Set();
    for (let index = 0; index < stabilization.rafs.length; index++) {
        const raf = stabilization.rafs[index];
        const selected = raf.status !== "stable" ||
            raf.scrollHeightChangeIgnored === true ||
            Math.max(raf.waitElapsedMs ?? 0, raf.waitWallElapsedMs ?? 0) >= 250 ||
            raf.slowAwait != null;
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
        Object.entries(value).filter(([key]) =>
            !excludedKeys.includes(key) && !key.endsWith("Diagnostics")
        )
    );
    return formatFieldsDiagnostics(fields);
}

function formatFieldsDiagnostics(value) {
    const entries = Object.entries(value)
        .filter(([key]) => !key.endsWith("Diagnostics"));
    if (entries.length === 0) return "-";

    return entries
        .map(([key, item]) => `${key}=${formatValueDiagnostics(item)}`)
        .join(" │ ");
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
    if (value === undefined) return "undefined";
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
