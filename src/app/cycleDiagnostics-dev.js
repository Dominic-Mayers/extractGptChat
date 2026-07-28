import {

    supplyHeight,
    workZonePosition
} from "./scrollContainer-dev.js";

let previousCycle = null;
let currentCycle = null;
let runPerformanceOriginDiagnostics = 0;
let runWallOriginDiagnostics = 0;
let executionTimeStatisticsDiagnostics = null;
let deckSectionAtActivationDiagnostics = null;
let enumeratedDecksDiagnostics = null;
let deckSectionReadinessDiagnostics = null;
let deckUpdatesDiagnostics = null;
let erasedJumpDiagnostics = null;
let previousJumpSummaryDiagnostics = null;
let jumpPopulationDiagnostics = null;
let erasedJumpStructureDiagnostics = null;
let currentErasedJumpEntryDiagnostics = null;

const SLOW_JUMP_MS = 1000;
const SLOW_AWAIT_MS = 1000;
const SLOW_SLAB_MS = 2000;

const pendingTimersDiagnostics = new WeakMap();
let selectedJumpReasonsDiagnostics = new WeakMap();
let emittedCyclesDiagnostics = new WeakSet();

export function resetCycleDiagnostics() {
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
        sumJumpSizeWallElapsedMs: 0,
        maximumRequestedJump: 0,
        fullCalibratedJumpCount: 0,
        overViewportJumpCount: 0
    };
    deckSectionAtActivationDiagnostics = new Map();
    enumeratedDecksDiagnostics = new Set();
    deckSectionReadinessDiagnostics = {
        activatedDeckCount: 0,
        activationSectionPresentCount: 0,
        enumeratedDeckCount: 0,
        enumerationSectionPresentCount: 0,
        missingAtActivation: [],
        missingAtEnumeration: [],
        changedBeforeEnumeration: []
    };
    deckUpdatesDiagnostics = {
        checkedCount: 0,
        unchangedCount: 0,
        replacedCount: 0,
        replacements: [],
        recentUnchanged: []
    };
    erasedJumpDiagnostics = null;
    previousJumpSummaryDiagnostics = null;
    jumpPopulationDiagnostics = {
        classifiedJumpCount: 0,
        erasedJumpCount: 0,
        survivedJumpCount: 0,
        activationJumpCount: 0,
        deactivationJumpCount: 0,
        renderingJumpCount: 0,
        byJumpTarget: {},
        byOutcome: {},
        transitionPatterns: {},
        phasePatterns: {},
        geometry: {},
        geometryByJumpTarget: {},
        geometryByOutcome: {}
    };
    erasedJumpStructureDiagnostics = [];
    currentErasedJumpEntryDiagnostics = null;
    selectedJumpReasonsDiagnostics = new WeakMap();
    emittedCyclesDiagnostics = new WeakSet();
}

export function beginCycleDiagnostics(data) {
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

export function updateSpecificJumpDiagnostics(jumpDiagnostics, data) {
    if (!jumpDiagnostics) return;
    Object.assign(jumpDiagnostics, data);
}

export function discardCurrentJumpProbeDiagnostics() {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return;
    delete jumpDiagnostics.erasedJumpProbe;
}

export function recordErasedJumpResultDiagnostics(
    jumpWasErased,
    retriedErasedJump
) {
    const retryDiagnostics = currentJumpDiagnostics();

    if (jumpWasErased && retriedErasedJump) {
        selectJumpDiagnostics("erased-jump-retry-failed");
        retryDiagnostics.previousJump = previousJumpSummaryDiagnostics;
        updateSpecificJumpDiagnostics(erasedJumpDiagnostics, {
            recovery: {
                retryAttempted: true,
                outcome: "erased-again"
            }
        });
        updateSpecificJumpDiagnostics(retryDiagnostics, {
            recovery: {
                retryAttempted: false,
                outcome: "not-recovered"
            }
        });
        if (currentErasedJumpEntryDiagnostics != null) {
            currentErasedJumpEntryDiagnostics.recovery =
                "erased-again";
        }
        storeErasedJumpDiagnostics(
            retryDiagnostics,
            "retry-erased"
        );
        recordJumpPopulationDiagnostics(
            retryDiagnostics,
            "retry-erased"
        );
        previousJumpSummaryDiagnostics =
            jumpSummaryDiagnostics(retryDiagnostics);
        return;
    }

    if (jumpWasErased) {
        selectJumpDiagnostics("erased-jump");
        erasedJumpDiagnostics = retryDiagnostics;
        erasedJumpDiagnostics.previousJump =
            previousJumpSummaryDiagnostics;
        updateSpecificJumpDiagnostics(erasedJumpDiagnostics, {
            recovery: {
                retryAttempted: true,
                outcome: "pending"
            }
        });
        currentErasedJumpEntryDiagnostics =
            storeErasedJumpDiagnostics(
                erasedJumpDiagnostics,
                "erased"
            );
        recordJumpPopulationDiagnostics(
            erasedJumpDiagnostics,
            "erased"
        );
        previousJumpSummaryDiagnostics =
            jumpSummaryDiagnostics(erasedJumpDiagnostics);
        return;
    }

    if (retriedErasedJump) {
        selectJumpDiagnostics("erased-jump-retry-succeeded");
        updateSpecificJumpDiagnostics(erasedJumpDiagnostics, {
            recovery: {
                retryAttempted: true,
                outcome: "succeeded"
            }
        });
        updateSpecificJumpDiagnostics(retryDiagnostics, {
            recovery: {
                retryAttempted: false,
                outcome: "recovered-previous-erasure"
            }
        });
        if (currentErasedJumpEntryDiagnostics != null) {
            currentErasedJumpEntryDiagnostics.recovery =
                "succeeded";
        }
        currentErasedJumpEntryDiagnostics = null;
        recordJumpPopulationDiagnostics(
            retryDiagnostics,
            "retry-succeeded"
        );
        previousJumpSummaryDiagnostics =
            jumpSummaryDiagnostics(retryDiagnostics);
        return;
    }

    recordJumpPopulationDiagnostics(retryDiagnostics, "survived");
    previousJumpSummaryDiagnostics =
        jumpSummaryDiagnostics(retryDiagnostics);
    discardCurrentJumpProbeDiagnostics();
}

function storeErasedJumpDiagnostics(jump, outcome) {
    const slabCount = currentCycle?.slabCount ?? null;
    const anchorNumber = jump.anchorNumber ?? null;
    let slab = erasedJumpStructureDiagnostics.find(
        candidate => candidate.slabCount === slabCount
    );
    if (slab == null) {
        slab = {
            slabCount,
            deckCount: currentCycle?.deckCount ?? null,
            anchors: []
        };
        erasedJumpStructureDiagnostics.push(slab);
    }
    let anchor = slab.anchors.find(
        candidate => candidate.anchorNumber === anchorNumber
    );
    if (anchor == null) {
        anchor = {
            anchorNumber,
            anchor: jump.anchor,
            jumps: []
        };
        slab.anchors.push(anchor);
    }

    const entry = erasedJumpEntryDiagnostics(jump, outcome);
    anchor.jumps.push(entry);
    return entry;
}

function erasedJumpEntryDiagnostics(jump, outcome) {
    const probe = jump.erasedJumpProbe;
    return {
        jumpNumber: currentCycle?.jumps.indexOf(jump) + 1,
        outcome,
        recovery: outcome === "erased" ? "pending" : "not-recovered",
        jumpTarget: probe?.jumpTarget ?? null,
        requestedJump: jump.requestedJump,
        beforeFrame: compactJumpGeometryDiagnostics(
            probe?.beforeFrame
        ),
        beforeJump: compactJumpGeometryDiagnostics(
            probe?.preCommand
        ),
        afterCommand: compactJumpGeometryDiagnostics(
            probe?.afterCommand
        ),
        nextRaf: compactJumpGeometryDiagnostics(probe?.nextRaf),
        activationChanges: compactActivationChangesDiagnostics(
            probe?.activationChanges ?? []
        ),
        renderingChanges: compactRenderingChangesDiagnostics(
            probe?.renderingChanges ?? []
        ),
        previousJump: compactPreviousJumpDiagnostics(
            jump.previousJump
        )
    };
}

function compactPreviousJumpDiagnostics(previous) {
    if (previous == null) return null;
    return {
        jumpTarget: previous.jumpTarget,
        requestedJump: previous.requestedJump,
        beforeJump: compactJumpGeometryDiagnostics(
            previous.beforeJump
        ),
        nextRaf: compactJumpGeometryDiagnostics(previous.nextRaf),
        activationChanges: compactActivationChangesDiagnostics(
            previous.activationChanges
        ),
        renderingChanges: compactRenderingChangesDiagnostics(
            previous.renderingChanges
        ),
        obtainedAnchorRoom: previous.obtainedAnchorRoom,
        stabilization: previous.stabilization
    };
}

function compactJumpGeometryDiagnostics(geometry) {
    if (geometry == null) return null;
    return {
        slabRoom: geometry.slabRoom,
        anchorRoom: geometry.anchorRoom,
        deckRoom: geometry.deckRoom,
        scrollY: geometry.scrollY,
        activationDistanceAbove:
            geometry.activationDistanceAbove,
        activationDistanceBelow:
            geometry.activationDistanceBelow,
        inactiveDeckAboveId:
            geometry.inactiveDeckAbove?.id ?? null,
        inactiveDeckBelowId:
            geometry.inactiveDeckBelow?.id ?? null
    };
}

function compactActivationChangesDiagnostics(changes) {
    return changes.map(change => ({
        phase: change.phase ?? null,
        deckId: change.deck?.id ?? null,
        before: change.before ?? null,
        after: change.after ?? null,
        sectionChange: change.sectionChange ?? null
    }));
}

function compactRenderingChangesDiagnostics(changes) {
    return {
        count: changes.length,
        changes: changes.slice(0, 20).map(change => ({
            phase: change.phase ?? null,
            change: change.change,
            tagName: change.element?.tagName ?? null,
            id: change.element?.id ?? null,
            className: change.element?.className ?? null,
            messageId: change.element?.messageId ?? null,
            turnId: change.element?.turnId ?? null
        }))
    };
}

function jumpSummaryDiagnostics(jump) {
    const stabilization = jump.stabilizations[
        jump.stabilizations.length - 1
    ] ?? null;
    return {
        jumpTarget: jump.erasedJumpProbe?.jumpTarget ?? null,
        requestedJump: jump.requestedJump,
        beforeFrame: jump.erasedJumpProbe?.beforeFrame ?? null,
        beforeJump: jump.erasedJumpProbe?.preCommand ?? null,
        afterCommand: jump.erasedJumpProbe?.afterCommand ?? null,
        nextRaf: jump.erasedJumpProbe?.nextRaf ?? null,
        activationChanges:
            jump.erasedJumpProbe?.activationChanges ?? [],
        renderingChanges:
            jump.erasedJumpProbe?.renderingChanges ?? [],
        obtainedAnchorRoom: jump.obtainedAnchorRoom ?? null,
        stabilization: stabilization == null
            ? null
            : {
                status: stabilization.status,
                stableFrames: stabilization.stableFrames,
                frames: stabilization.frames,
                elapsedMs: stabilization.elapsedMs,
                wallElapsedMs: stabilization.wallElapsedMs,
                rafs: stabilization.rafs.map(raf => ({
                    frame: raf.frame,
                    status: raf.status,
                    geometryChangeMagnitude:
                        raf.geometryChangeMagnitude,
                    scrollHeightChange: raf.scrollHeightChange,
                    scrollYChange: raf.scrollYChange
                }))
            }
    };
}

function recordJumpPopulationDiagnostics(jump, outcome) {
    const probe = jump.erasedJumpProbe;
    if (jumpPopulationDiagnostics == null || probe == null) return;

    const attributeChanges = probe.activationChanges.filter(
        change => "before" in change
    );
    const activationCount = attributeChanges.filter(
        change =>
            (change.before == null || change.before === "false") &&
            change.after != null &&
            change.after !== "false"
    ).length;
    const deactivationCount = attributeChanges.filter(
        change =>
            change.before != null &&
            change.before !== "false" &&
            (change.after == null || change.after === "false")
    ).length;

    jumpPopulationDiagnostics.classifiedJumpCount++;
    if (outcome === "erased" || outcome === "retry-erased") {
        jumpPopulationDiagnostics.erasedJumpCount++;
    } else {
        jumpPopulationDiagnostics.survivedJumpCount++;
    }
    if (activationCount > 0) {
        jumpPopulationDiagnostics.activationJumpCount++;
    }
    if (deactivationCount > 0) {
        jumpPopulationDiagnostics.deactivationJumpCount++;
    }
    if (probe.renderingChanges.length > 0) {
        jumpPopulationDiagnostics.renderingJumpCount++;
    }

    incrementJumpPopulationCategoryDiagnostics(
        jumpPopulationDiagnostics.byJumpTarget,
        probe.jumpTarget
    );
    incrementJumpPopulationCategoryDiagnostics(
        jumpPopulationDiagnostics.byOutcome,
        outcome
    );
    const transitionPattern =
        `activation:${activationCount},` +
        `deactivation:${deactivationCount},` +
        `rendering:${probe.renderingChanges.length > 0}`;
    const patternOutcomes =
        jumpPopulationDiagnostics.transitionPatterns[
            transitionPattern
        ] ?? {};
    incrementJumpPopulationCategoryDiagnostics(
        patternOutcomes,
        outcome
    );
    jumpPopulationDiagnostics.transitionPatterns[
        transitionPattern
    ] = patternOutcomes;
    const phasePattern = [
        "pre-command-frame",
        "command",
        "post-command",
        "after-next-rAF"
    ].map(phase => {
        const changes = attributeChanges.filter(
            change => change.phase === phase
        );
        const activations = changes.filter(
            change =>
                (change.before == null || change.before === "false") &&
                change.after != null &&
                change.after !== "false"
        ).length;
        const deactivations = changes.filter(
            change =>
                change.before != null &&
                change.before !== "false" &&
                (change.after == null || change.after === "false")
        ).length;
        return `${phase}:activation:${activations},` +
            `deactivation:${deactivations}`;
    }).join(";");
    const phasePatternOutcomes =
        jumpPopulationDiagnostics.phasePatterns[phasePattern] ?? {};
    incrementJumpPopulationCategoryDiagnostics(
        phasePatternOutcomes,
        outcome
    );
    jumpPopulationDiagnostics.phasePatterns[phasePattern] =
        phasePatternOutcomes;

    const before = probe.preCommand;
    const beforeFrame = probe.beforeFrame;
    const afterCommand = probe.afterCommand;
    const nextRaf = probe.nextRaf;
    const geometryValues = {
        slabRoom: before.slabRoom,
        anchorRoom: before.anchorRoom,
        deckRoom: before.deckRoom,
        activationDistanceAbove:
            before.activationDistanceAbove,
        activationDistanceBelow:
            before.activationDistanceBelow
    };
    if (
        Number.isFinite(before.slabRoom) &&
        Number.isFinite(before.activationDistanceAbove)
    ) {
        geometryValues.slabActivationGapAbove =
            before.slabRoom + before.activationDistanceAbove;
    }
    for (const name of [
        "slabRoom",
        "anchorRoom",
        "deckRoom",
        "scrollY"
    ]) {
        if (Number.isFinite(beforeFrame?.[name])) {
            geometryValues[
                `preCommand${name[0].toUpperCase()}${name.slice(1)}Change`
            ] = before[name] - beforeFrame[name];
        }
        if (Number.isFinite(afterCommand?.[name])) {
            geometryValues[
                `command${name[0].toUpperCase()}${name.slice(1)}Change`
            ] = afterCommand[name] - before[name];
        }
        if (Number.isFinite(nextRaf?.[name])) {
            geometryValues[
                `nextRaf${name[0].toUpperCase()}${name.slice(1)}Change`
            ] = nextRaf[name] - before[name];
        }
    }
    const targetGeometry =
        jumpPopulationDiagnostics.geometryByJumpTarget[
            probe.jumpTarget
        ] ?? {};
    const outcomeGeometry =
        jumpPopulationDiagnostics.geometryByOutcome[outcome] ?? {};
    for (const [name, value] of Object.entries(geometryValues)) {
        recordJumpPopulationGeometryDiagnostics(
            jumpPopulationDiagnostics.geometry,
            name,
            value
        );
        recordJumpPopulationGeometryDiagnostics(
            targetGeometry,
            name,
            value
        );
        recordJumpPopulationGeometryDiagnostics(
            outcomeGeometry,
            name,
            value
        );
    }
    jumpPopulationDiagnostics.geometryByJumpTarget[
        probe.jumpTarget
    ] = targetGeometry;
    jumpPopulationDiagnostics.geometryByOutcome[outcome] =
        outcomeGeometry;
}

function incrementJumpPopulationCategoryDiagnostics(categories, key) {
    categories[key] = (categories[key] ?? 0) + 1;
}

function recordJumpPopulationGeometryDiagnostics(
    geometry,
    name,
    value
) {
    if (!Number.isFinite(value)) return;
    const metric = geometry[name] ?? {
        count: 0,
        sum: 0,
        minimum: value,
        maximum: value
    };
    metric.count++;
    metric.sum += value;
    metric.minimum = Math.min(metric.minimum, value);
    metric.maximum = Math.max(metric.maximum, value);
    geometry[name] = metric;
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

    recordExecutionTimeStatisticsDiagnostics(jumpDiagnostics);

    return jumpDiagnostics.elapsedMs;
}

function recordExecutionTimeStatisticsDiagnostics(jumpDiagnostics) {
    const jumpSize = jumpDiagnostics.requestedJump;
    if (
        executionTimeStatisticsDiagnostics == null ||
        !Number.isFinite(jumpSize)
    ) return;

    executionTimeStatisticsDiagnostics.jumpCount++;
    executionTimeStatisticsDiagnostics.sumJumpSize += jumpSize;
    executionTimeStatisticsDiagnostics.sumJumpSizeSquared += jumpSize * jumpSize;
    executionTimeStatisticsDiagnostics.sumJumpElapsedMs +=
        jumpDiagnostics.elapsedMs;
    executionTimeStatisticsDiagnostics.sumJumpWallElapsedMs +=
        jumpDiagnostics.wallElapsedMs;
    executionTimeStatisticsDiagnostics.sumJumpSizeElapsedMs +=
        jumpSize * jumpDiagnostics.elapsedMs;
    executionTimeStatisticsDiagnostics.sumJumpSizeWallElapsedMs +=
        jumpSize * jumpDiagnostics.wallElapsedMs;
    executionTimeStatisticsDiagnostics.maximumRequestedJump = Math.max(
        executionTimeStatisticsDiagnostics.maximumRequestedJump,
        jumpSize
    );
    if (jumpSize === jumpDiagnostics.calibratedJump) {
        executionTimeStatisticsDiagnostics.fullCalibratedJumpCount++;
    }
    if (jumpSize > jumpDiagnostics.viewportHeight) {
        executionTimeStatisticsDiagnostics.overViewportJumpCount++;
    }
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

export function recordDeckSectionActivationDiagnostics(snapshot) {
    deckSectionAtActivationDiagnostics.set(snapshot.turnId, snapshot);
    deckSectionReadinessDiagnostics.activatedDeckCount++;
    if (snapshot.sectionCount > 0) {
        deckSectionReadinessDiagnostics.activationSectionPresentCount++;
    } else {
        deckSectionReadinessDiagnostics.missingAtActivation.push(snapshot);
    }
}

export function recordDeckSectionEnumerationDiagnostics(snapshot) {
    if (enumeratedDecksDiagnostics.has(snapshot.turnId)) return;
    enumeratedDecksDiagnostics.add(snapshot.turnId);

    const activated =
        deckSectionAtActivationDiagnostics.get(snapshot.turnId) ?? null;
    deckSectionReadinessDiagnostics.enumeratedDeckCount++;
    if (snapshot.sectionCount > 0) {
        deckSectionReadinessDiagnostics.enumerationSectionPresentCount++;
    } else {
        deckSectionReadinessDiagnostics.missingAtEnumeration.push(snapshot);
    }

    if (
        activated != null &&
        JSON.stringify(activated) !== JSON.stringify(snapshot)
    ) {
        deckSectionReadinessDiagnostics.changedBeforeEnumeration.push({
            turnId: snapshot.turnId,
            activated,
            enumerated: snapshot
        });
    }
}

export function recordDeckUpdateDiagnostics(data) {
    const record = {
        clock: clockDiagnostics(),
        ...data
    };
    deckUpdatesDiagnostics.checkedCount++;

    if (data.decision === "replaced") {
        deckUpdatesDiagnostics.replacedCount++;
        deckUpdatesDiagnostics.replacements.push(record);
        return;
    }

    deckUpdatesDiagnostics.unchangedCount++;
    deckUpdatesDiagnostics.recentUnchanged.push(record);
    if (deckUpdatesDiagnostics.recentUnchanged.length > 10) {
        deckUpdatesDiagnostics.recentUnchanged.shift();
    }
}

function clockDiagnostics() {
    return {
        performanceMs: performance.now() - runPerformanceOriginDiagnostics,
        wallMs: Date.now() - runWallOriginDiagnostics
    };
}

export function snapshotElementDiagnostics(element) {
    const source = element?.element ?? element;
    if (!source?.getBoundingClientRect) return null;

    const sourceRect = source.getBoundingClientRect();
    const boundary = element.edge == null
        ? null
        : sourceRect[element.edge];
    const rect = boundary == null
        ? sourceRect
        : {
            top: boundary,
            bottom: boundary,
            height: 0
        };

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
        connected: source.isConnected ?? null
    };
}

export function snapshotSupplierDiagnostics(supplyArea, workZone) {
    return {
        scrollY: workZonePosition(supplyArea, workZone),
        scrollHeight: supplyHeight(supplyArea)
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
    finishCycleTimingDiagnostics(currentCycle);
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
    if (reason == null) return null;
    selectJumpDiagnostics(reason);
    return currentJumpDiagnostics();
}

export function flushCycleDiagnostics() {
    if (!currentCycle) return;
    finishCycleTimingDiagnostics(currentCycle);
    currentCycle.forceLogDiagnostics = true;
    emitSlabDiagnostics(currentCycle, "FINAL", true);
    emitDeckSectionReadinessDiagnostics();
    emitDeckUpdatesDiagnostics();
    emitErasedJumpStructureDiagnostics();
    emitJumpPopulationDiagnostics();
    emitExecutionTimeStatisticsDiagnostics();
}

function emitErasedJumpStructureDiagnostics() {
    const jumpCount = erasedJumpStructureDiagnostics.reduce(
        (count, slab) => count + slab.anchors.reduce(
            (anchorCount, anchor) =>
                anchorCount + anchor.jumps.length,
            0
        ),
        0
    );
    console.log(
        `[erased jump diagnostics] slabs=` +
        `${erasedJumpStructureDiagnostics.length} jumps=${jumpCount}`
    );
    for (const slab of erasedJumpStructureDiagnostics) {
        for (const anchor of slab.anchors) {
            console.log(
                `[erased jumps slab=${slab.slabCount} ` +
                `anchor=${anchor.anchorNumber}]\n` +
                JSON.stringify({
                    slabCount: slab.slabCount,
                    deckCount: slab.deckCount,
                    anchor
                })
            );
        }
    }
}

function emitJumpPopulationDiagnostics() {
    if (jumpPopulationDiagnostics == null) return;
    const output = structuredClone(jumpPopulationDiagnostics);
    const geometries = [
        output.geometry,
        ...Object.values(output.geometryByJumpTarget),
        ...Object.values(output.geometryByOutcome)
    ];
    for (const geometry of geometries) {
        for (const metric of Object.values(geometry)) {
            metric.average = metric.sum / metric.count;
        }
    }
    console.log(
        "[jump population]\n" +
        JSON.stringify(output, null, 2)
    );
}

function emitDeckSectionReadinessDiagnostics() {
    console.log(
        "[deck section readiness]\n" +
        JSON.stringify(deckSectionReadinessDiagnostics, null, 2)
    );
}

function emitDeckUpdatesDiagnostics() {
    console.log(
        "[deck updates before deactivation]\n" +
        JSON.stringify(deckUpdatesDiagnostics, null, 2)
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
        `════ EXECUTION TIME STATISTICS ════\n` +
        `     ${formatValueDiagnostics({
            ...executionTimeStatisticsDiagnostics,
            runElapsedMs,
            runWallElapsedMs,
            nonJumpElapsedMs: runElapsedMs - sumJumpElapsedMs,
            nonJumpWallElapsedMs: runWallElapsedMs - sumJumpWallElapsedMs,
            averageJumpSize: jumpCount === 0
                ? null
                : sumJumpSize / jumpCount,
            averageJumpElapsedMs: jumpCount === 0
                ? null
                : sumJumpElapsedMs / jumpCount,
            averageJumpWallElapsedMs: jumpCount === 0
                ? null
                : sumJumpWallElapsedMs / jumpCount
        })}`
    );
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
        `════ ${context} SLAB ${cycle.slabCount} START ════`,
        `     ${formatObjectDiagnostics(cycle, [
            "cycle", "stages", "jumps"
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
    const relevantStages = new Set(["selected", "stop", "error", "slow-slab"]);
    const slowSlabTimingStages = new Set([
        "deck-room",
        "deck-decision",
        "deck-search",
        "deck-active",
        "slab-ready"
    ]);
    const isSlowSlab = cycle.stages.some(stage => stage.stage === "slow-slab");
    const hasError = cycle.stages.some(stage => stage.stage === "error");
    return cycle.stages
        .map((stage, index) => ({ stage, index }))
        .filter(({ stage }) =>
            relevantStages.has(stage.stage) ||
            (isSlowSlab && slowSlabTimingStages.has(stage.stage)) ||
            (hasError && (
                slowSlabTimingStages.has(stage.stage) ||
                stage.stage === "slab-search"
            )) ||
            (stage.stage === "deck-active" &&
                Math.max(stage.waitedMs ?? 0, 0) >= SLOW_AWAIT_MS)
        );
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
