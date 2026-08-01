import {

    supplyHeight,
    workZonePosition
} from "./scrollContainer-diag.js";

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
let stabilizationRuleDiagnostics = null;
let deckLifecycleDiagnostics = null;
let deactivationPredictionDiagnostics = null;
let deactivationPredictionElapsedValuesDiagnostics = null;
let predictionDeckHeightsByJumpLagDiagnostics = null;
let pendingPredictionJumpDiagnostics = null;
let erasedJumpStructureDiagnostics = null;
let currentErasedJumpEntryDiagnostics = null;
let canvasGeometryDiagnostics = null;

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
        recompiledCount: 0,
        recompilations: [],
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
    stabilizationRuleDiagnostics = {
        trackedStabilizationCount: 0,
        oneRafCount: 0,
        twoRafCount: 0,
        activationOnlyCount: 0,
        deactivationOnlyCount: 0,
        bothBoundariesCount: 0,
        untrackedStabilizationCount: 0
    };
    deckLifecycleDiagnostics = {
        deactivationCount: 0,
        removalBeforeFalseCount: 0,
        removalBeforeFalseSameDeliveryCount: 0,
        removalBeforeFalseEarlierDeliveryCount: 0,
        falseWithoutPriorRemovalCount: 0,
        deckChangesAfterFalseCount: 0,
        activationCount: 0,
        additionBeforeTrueCount: 0,
        additionBeforeTrueSameDeliveryCount: 0,
        additionBeforeTrueEarlierDeliveryCount: 0,
        trueWithoutPriorAdditionCount: 0,
        deckChangesAfterTrueCount: 0,
        anomalies: []
    };
    deactivationPredictionDiagnostics = {
        predictionCount: 0,
        matchedDeactivationCount: 0,
        unpredictedDeactivationCount: 0,
        elapsedMsCount: 0,
        elapsedMsSum: 0,
        elapsedMsMinimum: null,
        elapsedMsMaximum: null,
        byPhase: {},
        matchedDeactivationByJumpLag: {},
        singleDeactivationJumpByPredictionLag: {},
        singleDeactivationJumpByPreCommandLastKnownHeight: {},
        singleDeactivationJumpByLastKnownHeightLeadMs: {}
    };
    deactivationPredictionElapsedValuesDiagnostics = [];
    predictionDeckHeightsByJumpLagDiagnostics = {};
    pendingPredictionJumpDiagnostics = {
        jumpCount: 0,
        geometricallyDeactivatingJumpCount: 0,
        geometricallyPredictedDeckCount: 0,
        atJumpStart: pendingPredictionStageDiagnostics(),
        beforeCommand: pendingPredictionStageDiagnostics()
    };
    erasedJumpStructureDiagnostics = [];
    currentErasedJumpEntryDiagnostics = null;
    canvasGeometryDiagnostics = [];
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

export function recordStabilizationRuleDiagnostics({
    trackAnchor,
    activationNear,
    deactivationNear,
    stableFrames
}) {
    if (stabilizationRuleDiagnostics == null) return;
    if (!trackAnchor) {
        stabilizationRuleDiagnostics.untrackedStabilizationCount++;
        return;
    }

    stabilizationRuleDiagnostics.trackedStabilizationCount++;
    if (stableFrames === 1) {
        stabilizationRuleDiagnostics.oneRafCount++;
    } else {
        stabilizationRuleDiagnostics.twoRafCount++;
    }

    if (activationNear && deactivationNear) {
        stabilizationRuleDiagnostics.bothBoundariesCount++;
    } else if (activationNear) {
        stabilizationRuleDiagnostics.activationOnlyCount++;
    } else if (deactivationNear) {
        stabilizationRuleDiagnostics.deactivationOnlyCount++;
    }
}

export function recordDeactivationPredictionDiagnostics() {
    if (deactivationPredictionDiagnostics == null) return;
    deactivationPredictionDiagnostics.predictionCount++;
}

export function recordPendingDeactivationPredictionsForJumpDiagnostics({
    atJumpStart,
    beforeCommand,
    geometricallyPredictedDeckCount
}) {
    if (pendingPredictionJumpDiagnostics == null) return;
    pendingPredictionJumpDiagnostics.jumpCount++;
    pendingPredictionJumpDiagnostics.geometricallyPredictedDeckCount +=
        geometricallyPredictedDeckCount;
    if (geometricallyPredictedDeckCount > 0) {
        pendingPredictionJumpDiagnostics
            .geometricallyDeactivatingJumpCount++;
    }
    recordPendingPredictionStageDiagnostics(
        pendingPredictionJumpDiagnostics.atJumpStart,
        atJumpStart
    );
    recordPendingPredictionStageDiagnostics(
        pendingPredictionJumpDiagnostics.beforeCommand,
        beforeCommand
    );
}

function pendingPredictionStageDiagnostics() {
    return {
        zeroCount: 0,
        nonzeroCount: 0,
        countSum: 0,
        countMaximum: 0,
        nonzeroAverageAgeMsSum: 0,
        oldestAgeMsMaximum: null,
        countDistribution: {}
    };
}

function recordPendingPredictionStageDiagnostics(stage, snapshot) {
    const count = snapshot.count;
    stage.countSum += count;
    stage.countMaximum = Math.max(stage.countMaximum, count);
    stage.countDistribution[count] =
        (stage.countDistribution[count] ?? 0) + 1;
    if (count === 0) {
        stage.zeroCount++;
        return;
    }
    stage.nonzeroCount++;
    stage.nonzeroAverageAgeMsSum += snapshot.averageAgeMs;
    stage.oldestAgeMsMaximum = stage.oldestAgeMsMaximum == null
        ? snapshot.oldestAgeMs
        : Math.max(stage.oldestAgeMsMaximum, snapshot.oldestAgeMs);
}

export function recordCanvasGeometryDiagnostics(record) {
    if (canvasGeometryDiagnostics == null) return;
    canvasGeometryDiagnostics.push(record);
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
        sectionRemovalBoundaries:
            probe?.sectionRemovalBoundaries ?? [],
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
        sectionRemovalBoundaries:
            previous.sectionRemovalBoundaries ?? [],
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
        scrollHeight: geometry.scrollHeight,
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
        delivery: change.delivery ?? null,
        order: change.order ?? null,
        phase: change.phase ?? null,
        scrollYAtMutationDeliveryStart:
            change.scrollYAtMutationDeliveryStart ?? null,
        predictionElapsedMs: change.predictionElapsedMs ?? null,
        predictionJumpLag: change.predictionJumpLag ?? null,
        lastKnownHeightUpdateClock:
            change.lastKnownHeightUpdateClock ?? null,
        lastKnownHeightUpdateJumpLag:
            change.lastKnownHeightUpdateJumpLag ?? null,
        deckHeightAtPrediction:
            change.deckHeightAtPrediction ?? null,
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
            delivery: change.delivery ?? null,
            order: change.order ?? null,
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
    recordDeckLifecycleDiagnostics(probe, outcome);

    const attributeChanges = probe.activationChanges.filter(
        change => "before" in change
    );
    const activationCount = attributeChanges.filter(
        change =>
            (change.before == null || change.before === "false") &&
            change.after != null &&
            change.after !== "false"
    ).length;
    const deactivations = attributeChanges.filter(
        change =>
            change.before != null &&
            change.before !== "false" &&
            (change.after == null || change.after === "false")
    );
    const deactivationCount = deactivations.length;

    const matchedDeactivations = attributeChanges.filter(change =>
        change.before != null &&
        change.before !== "false" &&
        (change.after == null || change.after === "false") &&
        Number.isInteger(change.predictionJumpLag)
    );
    for (const change of matchedDeactivations) {
        incrementJumpPopulationCategoryDiagnostics(
            deactivationPredictionDiagnostics
                .matchedDeactivationByJumpLag,
            change.predictionJumpLag
        );
        if (Number.isFinite(change.deckHeightAtPrediction)) {
            const heights = predictionDeckHeightsByJumpLagDiagnostics[
                change.predictionJumpLag
            ] ?? [];
            heights.push(change.deckHeightAtPrediction);
            predictionDeckHeightsByJumpLagDiagnostics[
                change.predictionJumpLag
            ] = heights;
        }
    }
    if (deactivationCount === 1 && matchedDeactivations.length === 1) {
        const lag = matchedDeactivations[0].predictionJumpLag;
        const byLag = deactivationPredictionDiagnostics
            .singleDeactivationJumpByPredictionLag[lag] ?? {
                jumpCount: 0,
                erasedJumpCount: 0,
                preservedJumpCount: 0,
                byOutcome: {}
            };
        byLag.jumpCount++;
        if (outcome === "erased" || outcome === "retry-erased") {
            byLag.erasedJumpCount++;
        } else {
            byLag.preservedJumpCount++;
        }
        incrementJumpPopulationCategoryDiagnostics(
            byLag.byOutcome,
            outcome
        );
        deactivationPredictionDiagnostics
            .singleDeactivationJumpByPredictionLag[lag] = byLag;
    }
    if (deactivationCount === 1) {
        const deactivation = deactivations[0];
        const heightChanges = probe.renderingChanges.filter(change =>
            change.change === "last-known-height" &&
            change.element.turnId === deactivation.deck.id &&
            change.phase === "pre-command-frame"
        );
        const heightState = heightChanges.length > 0
            ? "present"
            : "absent";
        const byHeightState = deactivationPredictionDiagnostics
            .singleDeactivationJumpByPreCommandLastKnownHeight[
                heightState
            ] ?? {
                jumpCount: 0,
                erasedJumpCount: 0,
                preservedJumpCount: 0,
                byOutcome: {},
                byPredictionJumpLag: {},
                byDelayMs: {}
            };
        byHeightState.jumpCount++;
        if (outcome === "erased" || outcome === "retry-erased") {
            byHeightState.erasedJumpCount++;
        } else {
            byHeightState.preservedJumpCount++;
        }
        incrementJumpPopulationCategoryDiagnostics(
            byHeightState.byOutcome,
            outcome
        );
        if (Number.isInteger(deactivation.predictionJumpLag)) {
            const lag = deactivation.predictionJumpLag;
            const byLag = byHeightState.byPredictionJumpLag[lag] ?? {
                jumpCount: 0,
                erasedJumpCount: 0,
                preservedJumpCount: 0,
                byOutcome: {}
            };
            byLag.jumpCount++;
            if (outcome === "erased" || outcome === "retry-erased") {
                byLag.erasedJumpCount++;
            } else {
                byLag.preservedJumpCount++;
            }
            incrementJumpPopulationCategoryDiagnostics(
                byLag.byOutcome,
                outcome
            );
            byHeightState.byPredictionJumpLag[lag] = byLag;
        }
        if (heightChanges.length > 0) {
            const heightClock = Math.max(
                ...heightChanges.map(change => change.clock)
            );
            const delayMs = deactivation.clock - heightClock;
            const delayBucket = delayMs < 50
                ? "lt50"
                : delayMs < 100
                    ? "50-99"
                    : delayMs < 150
                        ? "100-149"
                        : delayMs < 250
                            ? "150-249"
                            : delayMs < 500
                                ? "250-499"
                                : "gte500";
            const byDelay = byHeightState.byDelayMs[delayBucket] ?? {
                jumpCount: 0,
                erasedJumpCount: 0,
                preservedJumpCount: 0,
                delayMsSum: 0,
                byOutcome: {},
                byPredictionJumpLag: {}
            };
            byDelay.jumpCount++;
            byDelay.delayMsSum += delayMs;
            if (outcome === "erased" || outcome === "retry-erased") {
                byDelay.erasedJumpCount++;
            } else {
                byDelay.preservedJumpCount++;
            }
            incrementJumpPopulationCategoryDiagnostics(
                byDelay.byOutcome,
                outcome
            );
            if (Number.isInteger(deactivation.predictionJumpLag)) {
                const lag = deactivation.predictionJumpLag;
                const byLag = byDelay.byPredictionJumpLag[lag] ?? {
                    jumpCount: 0,
                    erasedJumpCount: 0,
                    preservedJumpCount: 0,
                    delayMsSum: 0,
                    byOutcome: {}
                };
                byLag.jumpCount++;
                byLag.delayMsSum += delayMs;
                if (
                    outcome === "erased" ||
                    outcome === "retry-erased"
                ) {
                    byLag.erasedJumpCount++;
                } else {
                    byLag.preservedJumpCount++;
                }
                incrementJumpPopulationCategoryDiagnostics(
                    byLag.byOutcome,
                    outcome
                );
                byDelay.byPredictionJumpLag[lag] = byLag;
            }
            byHeightState.byDelayMs[delayBucket] = byDelay;
        }
        deactivationPredictionDiagnostics
            .singleDeactivationJumpByPreCommandLastKnownHeight[
                heightState
            ] = byHeightState;
        const leadMs = Number.isFinite(
            deactivation.lastKnownHeightUpdateClock
        ) && Number.isFinite(probe.commandClock)
            ? probe.commandClock -
                deactivation.lastKnownHeightUpdateClock
            : null;
        const leadBucket = leadMs == null
            ? "missing"
            : leadMs < 0
                ? "after-jump"
                : leadMs < 5
                    ? "0-4"
                    : leadMs < 10
                        ? "5-9"
                        : leadMs < 20
                            ? `${Math.floor(leadMs)}-<${
                                Math.floor(leadMs) + 1
                            }`
                            : leadMs < 50
                                ? "20-49"
                                : leadMs < 100
                                    ? "50-99"
                                    : leadMs < 250
                                        ? "100-249"
                                        : "gte250";
        const byLead = deactivationPredictionDiagnostics
            .singleDeactivationJumpByLastKnownHeightLeadMs[
                leadBucket
            ] ?? {
                jumpCount: 0,
                erasedJumpCount: 0,
                preservedJumpCount: 0,
                leadMsCount: 0,
                leadMsSum: 0,
                leadMsMinimum: null,
                leadMsMaximum: null,
                byOutcome: {},
                byPredictionJumpLag: {}
            };
        byLead.jumpCount++;
        if (outcome === "erased" || outcome === "retry-erased") {
            byLead.erasedJumpCount++;
        } else {
            byLead.preservedJumpCount++;
        }
        if (leadMs != null) {
            byLead.leadMsCount++;
            byLead.leadMsSum += leadMs;
            byLead.leadMsMinimum = byLead.leadMsMinimum == null
                ? leadMs
                : Math.min(byLead.leadMsMinimum, leadMs);
            byLead.leadMsMaximum = byLead.leadMsMaximum == null
                ? leadMs
                : Math.max(byLead.leadMsMaximum, leadMs);
        }
        incrementJumpPopulationCategoryDiagnostics(
            byLead.byOutcome,
            outcome
        );
        if (Number.isInteger(deactivation.predictionJumpLag)) {
            const lag = deactivation.predictionJumpLag;
            const byLag = byLead.byPredictionJumpLag[lag] ?? {
                jumpCount: 0,
                erasedJumpCount: 0,
                preservedJumpCount: 0,
                leadMsCount: 0,
                leadMsSum: 0,
                byOutcome: {}
            };
            byLag.jumpCount++;
            if (outcome === "erased" || outcome === "retry-erased") {
                byLag.erasedJumpCount++;
            } else {
                byLag.preservedJumpCount++;
            }
            if (leadMs != null) {
                byLag.leadMsCount++;
                byLag.leadMsSum += leadMs;
            }
            incrementJumpPopulationCategoryDiagnostics(
                byLag.byOutcome,
                outcome
            );
            byLead.byPredictionJumpLag[lag] = byLag;
        }
        deactivationPredictionDiagnostics
            .singleDeactivationJumpByLastKnownHeightLeadMs[
                leadBucket
            ] = byLead;
    }

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
        "scrollHeight",
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

function recordDeckLifecycleDiagnostics(probe, outcome) {
    if (deckLifecycleDiagnostics == null) return;
    const events = [
        ...probe.activationChanges,
        ...probe.renderingChanges
    ].sort((first, second) => first.order - second.order);

    for (const event of probe.activationChanges) {
        if (!("before" in event)) continue;
        const deactivated =
            event.before != null &&
            event.before !== "false" &&
            (event.after == null || event.after === "false");
        const activated =
            (event.before == null || event.before === "false") &&
            event.after != null &&
            event.after !== "false";
        if (!deactivated && !activated) continue;

        const sectionChange = deactivated ? "removed" : "added";
        const priorSection = probe.activationChanges
            .filter(candidate =>
                candidate.deck?.id === event.deck?.id &&
                candidate.sectionChange === sectionChange &&
                candidate.order < event.order
            )
            .at(-1);
        const laterDeckChanges = events.filter(candidate =>
            candidate.order > event.order &&
            (
                candidate.deck?.id === event.deck?.id ||
                candidate.element?.turnId === event.deck?.id
            )
        );

        if (deactivated) {
            deckLifecycleDiagnostics.deactivationCount++;
            recordMatchedDeactivationPredictionDiagnostics(event);
            if (priorSection == null) {
                deckLifecycleDiagnostics.falseWithoutPriorRemovalCount++;
            } else {
                deckLifecycleDiagnostics.removalBeforeFalseCount++;
                if (priorSection.delivery === event.delivery) {
                    deckLifecycleDiagnostics
                        .removalBeforeFalseSameDeliveryCount++;
                } else {
                    deckLifecycleDiagnostics
                        .removalBeforeFalseEarlierDeliveryCount++;
                }
            }
            if (laterDeckChanges.length > 0) {
                deckLifecycleDiagnostics.deckChangesAfterFalseCount++;
            }
        } else {
            deckLifecycleDiagnostics.activationCount++;
            if (priorSection == null) {
                deckLifecycleDiagnostics.trueWithoutPriorAdditionCount++;
            } else {
                deckLifecycleDiagnostics.additionBeforeTrueCount++;
                if (priorSection.delivery === event.delivery) {
                    deckLifecycleDiagnostics
                        .additionBeforeTrueSameDeliveryCount++;
                } else {
                    deckLifecycleDiagnostics
                        .additionBeforeTrueEarlierDeliveryCount++;
                }
            }
            if (laterDeckChanges.length > 0) {
                deckLifecycleDiagnostics.deckChangesAfterTrueCount++;
            }
        }

        if (
            priorSection == null ||
            laterDeckChanges.length > 0
        ) {
            deckLifecycleDiagnostics.anomalies.push({
                outcome,
                transition: deactivated ? "deactivation" : "activation",
                deckId: event.deck?.id ?? null,
                transitionDelivery: event.delivery,
                transitionOrder: event.order,
                priorSectionDelivery: priorSection?.delivery ?? null,
                priorSectionOrder: priorSection?.order ?? null,
                laterChanges: laterDeckChanges.map(change => ({
                    delivery: change.delivery,
                    order: change.order,
                    phase: change.phase,
                    sectionChange: change.sectionChange ?? null,
                    before: change.before ?? null,
                    after: change.after ?? null,
                    renderingChange: change.change ?? null
                }))
            });
        }
    }
}

function recordMatchedDeactivationPredictionDiagnostics(event) {
    if (deactivationPredictionDiagnostics == null) return;
    if (!Number.isFinite(event.predictionElapsedMs)) {
        deactivationPredictionDiagnostics.unpredictedDeactivationCount++;
        return;
    }

    const elapsedMs = event.predictionElapsedMs;
    deactivationPredictionDiagnostics.matchedDeactivationCount++;
    deactivationPredictionDiagnostics.elapsedMsCount++;
    deactivationPredictionDiagnostics.elapsedMsSum += elapsedMs;
    deactivationPredictionElapsedValuesDiagnostics.push(elapsedMs);
    deactivationPredictionDiagnostics.elapsedMsMinimum =
        deactivationPredictionDiagnostics.elapsedMsMinimum == null
            ? elapsedMs
            : Math.min(
                deactivationPredictionDiagnostics.elapsedMsMinimum,
                elapsedMs
            );
    deactivationPredictionDiagnostics.elapsedMsMaximum =
        deactivationPredictionDiagnostics.elapsedMsMaximum == null
            ? elapsedMs
            : Math.max(
                deactivationPredictionDiagnostics.elapsedMsMaximum,
                elapsedMs
            );
    incrementJumpPopulationCategoryDiagnostics(
        deactivationPredictionDiagnostics.byPhase,
        event.phase
    );
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

    if (data.decision === "recompiled") {
        deckUpdatesDiagnostics.recompiledCount++;
        deckUpdatesDiagnostics.recompilations.push(record);
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
    emitStabilizationRuleDiagnostics();
    emitDeckLifecycleDiagnostics();
    emitDeactivationPredictionDiagnostics();
    emitPendingPredictionJumpDiagnostics();
    emitCanvasGeometryDiagnostics();
    emitExecutionTimeStatisticsDiagnostics();
}

function emitPendingPredictionJumpDiagnostics() {
    if (pendingPredictionJumpDiagnostics == null) return;
    const output = structuredClone(pendingPredictionJumpDiagnostics);
    for (const name of ["atJumpStart", "beforeCommand"]) {
        const stage = output[name];
        stage.countAverage = output.jumpCount === 0
            ? null
            : stage.countSum / output.jumpCount;
        stage.zeroPercentage = output.jumpCount === 0
            ? null
            : stage.zeroCount / output.jumpCount * 100;
        stage.nonzeroPercentage = output.jumpCount === 0
            ? null
            : stage.nonzeroCount / output.jumpCount * 100;
        stage.averageAgeMsWhenNonzero = stage.nonzeroCount === 0
            ? null
            : stage.nonzeroAverageAgeMsSum / stage.nonzeroCount;
    }
    output.geometricallyDeactivatingJumpPercentage =
        output.jumpCount === 0
            ? null
            : output.geometricallyDeactivatingJumpCount /
                output.jumpCount * 100;
    console.log(
        "[pending deactivation predictions by jump]\n" +
        JSON.stringify(output, null, 2)
    );
}

function emitCanvasGeometryDiagnostics() {
    if (canvasGeometryDiagnostics == null) return;
    console.log(
        "[canvas geometry]\n" +
        JSON.stringify(canvasGeometryDiagnostics, null, 2)
    );
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

function emitStabilizationRuleDiagnostics() {
    if (stabilizationRuleDiagnostics == null) return;
    const tracked =
        stabilizationRuleDiagnostics.trackedStabilizationCount;
    const asymmetricTwoRafCount =
        stabilizationRuleDiagnostics.activationOnlyCount +
        stabilizationRuleDiagnostics.bothBoundariesCount;
    const symmetricTwoRafCount =
        asymmetricTwoRafCount +
        stabilizationRuleDiagnostics.deactivationOnlyCount;
    console.log(
        "[stabilization rule]\n" +
        JSON.stringify({
            ...stabilizationRuleDiagnostics,
            asymmetricTwoRafCount,
            asymmetricTwoRafPercentage: tracked === 0
                ? 0
                : asymmetricTwoRafCount / tracked * 100,
            additionalSymmetricTwoRafCount:
                stabilizationRuleDiagnostics.deactivationOnlyCount,
            additionalSymmetricTwoRafPercentage: tracked === 0
                ? 0
                : stabilizationRuleDiagnostics.deactivationOnlyCount /
                    tracked * 100,
            symmetricTwoRafCount,
            symmetricTwoRafPercentage: tracked === 0
                ? 0
                : symmetricTwoRafCount / tracked * 100,
            twoRafPercentage: tracked === 0
                ? 0
                : stabilizationRuleDiagnostics.twoRafCount /
                    tracked * 100,
            activationOnlyPercentage: tracked === 0
                ? 0
                : stabilizationRuleDiagnostics.activationOnlyCount /
                    tracked * 100,
            deactivationOnlyPercentage: tracked === 0
                ? 0
                : stabilizationRuleDiagnostics.deactivationOnlyCount /
                    tracked * 100,
            bothBoundariesPercentage: tracked === 0
                ? 0
                : stabilizationRuleDiagnostics.bothBoundariesCount /
                    tracked * 100
        }, null, 2)
    );
}

function emitDeckLifecycleDiagnostics() {
    if (deckLifecycleDiagnostics == null) return;
    console.log(
        "[deck lifecycle]\n" +
        JSON.stringify({
            ...deckLifecycleDiagnostics,
            anomalies: deckLifecycleDiagnostics.anomalies.slice(0, 50)
        }, null, 2)
    );
}

function emitDeactivationPredictionDiagnostics() {
    if (deactivationPredictionDiagnostics == null) return;
    const count = deactivationPredictionDiagnostics.elapsedMsCount;
    const sortedElapsed = [
        ...deactivationPredictionElapsedValuesDiagnostics
    ].sort((first, second) => first - second);
    const percentile = value => count === 0
        ? null
        : sortedElapsed[
            Math.min(
                count - 1,
                Math.ceil(value / 100 * count) - 1
            )
        ];
    const output = structuredClone(deactivationPredictionDiagnostics);
    for (const byLag of Object.values(
        output.singleDeactivationJumpByPredictionLag
    )) {
        byLag.erasurePercentage = byLag.jumpCount === 0
            ? null
            : byLag.erasedJumpCount / byLag.jumpCount * 100;
    }
    for (const byHeightState of Object.values(
        output.singleDeactivationJumpByPreCommandLastKnownHeight
    )) {
        byHeightState.erasurePercentage = byHeightState.jumpCount === 0
            ? null
            : byHeightState.erasedJumpCount /
                byHeightState.jumpCount * 100;
        for (const byLag of Object.values(
            byHeightState.byPredictionJumpLag
        )) {
            byLag.erasurePercentage = byLag.jumpCount === 0
                ? null
                : byLag.erasedJumpCount / byLag.jumpCount * 100;
        }
        for (const byDelay of Object.values(byHeightState.byDelayMs)) {
            byDelay.erasurePercentage = byDelay.jumpCount === 0
                ? null
                : byDelay.erasedJumpCount / byDelay.jumpCount * 100;
            byDelay.delayMsAverage = byDelay.jumpCount === 0
                ? null
                : byDelay.delayMsSum / byDelay.jumpCount;
            for (const byLag of Object.values(
                byDelay.byPredictionJumpLag
            )) {
                byLag.erasurePercentage = byLag.jumpCount === 0
                    ? null
                    : byLag.erasedJumpCount / byLag.jumpCount * 100;
                byLag.delayMsAverage = byLag.jumpCount === 0
                    ? null
                    : byLag.delayMsSum / byLag.jumpCount;
            }
        }
    }
    for (const byLead of Object.values(
        output.singleDeactivationJumpByLastKnownHeightLeadMs
    )) {
        byLead.erasurePercentage = byLead.jumpCount === 0
            ? null
            : byLead.erasedJumpCount / byLead.jumpCount * 100;
        byLead.leadMsAverage = byLead.leadMsCount === 0
            ? null
            : byLead.leadMsSum / byLead.leadMsCount;
        for (const byLag of Object.values(
            byLead.byPredictionJumpLag
        )) {
            byLag.erasurePercentage = byLag.jumpCount === 0
                ? null
                : byLag.erasedJumpCount / byLag.jumpCount * 100;
            byLag.leadMsAverage = byLag.leadMsCount === 0
                ? null
                : byLag.leadMsSum / byLag.leadMsCount;
        }
    }
    console.log(
        "[height update lead]\n" +
        JSON.stringify(
            output.singleDeactivationJumpByLastKnownHeightLeadMs,
            null,
            2
        )
    );
    delete output.singleDeactivationJumpByLastKnownHeightLeadMs;
    output.deckHeightByJumpLag = Object.fromEntries(
        Object.entries(predictionDeckHeightsByJumpLagDiagnostics)
            .map(([lag, heights]) => [
                lag,
                distributionDiagnostics(heights)
            ])
    );
    const lagHeightPairs = Object.entries(
        predictionDeckHeightsByJumpLagDiagnostics
    ).flatMap(([lag, heights]) =>
        heights.map(height => ({ x: Number(lag), y: height }))
    );
    output.jumpLagDeckHeightPearsonCorrelation =
        pearsonCorrelationDiagnostics(lagHeightPairs);
    console.log(
        "[deactivation prediction]\n" +
        JSON.stringify({
            ...output,
            pendingPredictionCount:
                deactivationPredictionDiagnostics.predictionCount -
                deactivationPredictionDiagnostics
                    .matchedDeactivationCount,
            elapsedMsAverage: count === 0
                ? null
                : deactivationPredictionDiagnostics.elapsedMsSum /
                    count,
            elapsedMsMedian: percentile(50),
            elapsedMsP90: percentile(90),
            elapsedMsP95: percentile(95),
            elapsedMsP99: percentile(99)
        }, null, 2)
    );
}

function distributionDiagnostics(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((first, second) => first - second);
    const percentile = value => sorted[
        Math.min(
            sorted.length - 1,
            Math.ceil(value / 100 * sorted.length) - 1
        )
    ];
    return {
        count: sorted.length,
        average: sorted.reduce((sum, value) => sum + value, 0) /
            sorted.length,
        minimum: sorted[0],
        median: percentile(50),
        p90: percentile(90),
        maximum: sorted.at(-1)
    };
}

function pearsonCorrelationDiagnostics(pairs) {
    const count = pairs.length;
    if (count < 2) return null;
    const sumX = pairs.reduce((sum, pair) => sum + pair.x, 0);
    const sumY = pairs.reduce((sum, pair) => sum + pair.y, 0);
    const sumXX = pairs.reduce(
        (sum, pair) => sum + pair.x * pair.x,
        0
    );
    const sumYY = pairs.reduce(
        (sum, pair) => sum + pair.y * pair.y,
        0
    );
    const sumXY = pairs.reduce(
        (sum, pair) => sum + pair.x * pair.y,
        0
    );
    const denominator = Math.sqrt(
        (count * sumXX - sumX * sumX) *
        (count * sumYY - sumY * sumY)
    );
    return denominator === 0
        ? null
        : (count * sumXY - sumX * sumY) / denominator;
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
