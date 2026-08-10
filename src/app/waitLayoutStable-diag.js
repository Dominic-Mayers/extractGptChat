import {

    MIN_ACTIVATION_DISTANCE,
    TOLERATED_ROUNDING,
    MAX_FRAMES_FOR_STABILIZATION,
    MAX_STABLE_RAF_DELAY,
    MAX_IGNORED_FRAMES
} from "./constants-diag.js";
import {
    anchorRoom,
    roomUntilFirstActiveDeckBelow,
    roomUntilFirstNotReadyDeck,
    saveDeckActivationStatus,
    performSplitExtraJump,
    recordStabilizationEscapeDiagnostics,
    sampleStabilizationDecksDiagnostics,
    deckActivationTransitions,
    supplyHeight,
    supplyRoom,
    thresholdDeckSnapshot
} from "./supplyWorker-diag.js";
import {
    beginStabilizationDiagnostics,
    finishStabilizationDiagnostics,
    beginRafDiagnostics,
    finishRafWaitDiagnostics,
    recordRafTelemetryDiagnostics,
    beginYieldDiagnostics,
    finishYieldDiagnostics,
    finishRafDiagnostics,
    recordStabilizationRuleDiagnostics,
    warnDiagnostics
} from "./cycleDiagnostics-diag.js";
import { nextAnimationFrame } from "./scrollContainer-diag.js";

export async function waitLayoutStable(
    {
        maxFrames = MAX_FRAMES_FOR_STABILIZATION,
        trackAnchor = false,
        previousRafClock: startRafClock = null
    } = {}
) {
    const activationDistanceAbove =
        roomUntilFirstNotReadyDeck();
    const deactivationDistanceBelow =
        roomUntilFirstActiveDeckBelow();
    const activationNear =
        activationDistanceAbove <= MIN_ACTIVATION_DISTANCE;
    const deactivationNear =
        deactivationDistanceBelow <= MIN_ACTIVATION_DISTANCE;
    const stableFrames = trackAnchor && !activationNear
        ? 1
        : 2;
    recordStabilizationRuleDiagnostics({
        trackAnchor,
        activationNear,
        deactivationNear,
        stableFrames
    });

    let recentFrames = [{ geometry: geometrySnapshot(), ignorable: false }];
    let skippableFramesDiagnostics = 0;
    let escapesDiagnostics = 0;
    const frameTraceDiagnostics = [];
    const deactivatedDecks = new Set();
    let previousRafGeometryDiagnostics = recentFrames[0].geometry;
    let previousRafClock = startRafClock;
    let unchanged = 0;
    let promptFrames = 0;
    saveDeckActivationStatus(thresholdDeckSnapshot());
    beginStabilizationDiagnostics({
        stableFrames,
        activationDistanceAbove,
        deactivationDistanceBelow,
        activationNear,
        deactivationNear
    });

    for (let frame = 0; frame < maxFrames; frame++) {
        beginRafDiagnostics({ frame: frame + 1 });
        const rafClock = await nextAnimationFrame(clock => {
            if (sampleStabilizationDecksDiagnostics) {
                sampleStabilizationDecksDiagnostics(frame + 1, clock);
            }
        });
        finishRafWaitDiagnostics();
        const extraJump = performSplitExtraJump(frame + 1);
        if (extraJump) {
            recentFrames = recentFrames.map(entry => ({
                ignorable: entry.ignorable,
                geometry: {
                    scrollHeight: entry.geometry.scrollHeight,
                    scrollY: entry.geometry.scrollY - extraJump
                }
            }));
        }
        const rafDelay = previousRafClock == null
            ? Infinity
            : rafClock - previousRafClock;
        previousRafClock = rafClock;

        const currentGeometry = geometrySnapshot();
        const deckStatus = thresholdDeckSnapshot();
        const deckTransitions = deckActivationTransitions(deckStatus);
        saveDeckActivationStatus(deckStatus);
        for (const transition of deckTransitions.deactivations) {
            deactivatedDecks.add(transition.deck);
        }
        const skippable = [...deactivatedDecks].some(
            deck => deckStatus.decks.get(deck)?.state === "true"
        );
        evaluateThresholdsDiagnostics(deckStatus, frame + 1);
        const geometryChanged = !matchesRecentFrame(
            recentFrames,
            currentGeometry
        );
        const usedEscapeDiagnostics = !geometryChanged &&
            !sameGeometry(recentFrames[0].geometry, currentGeometry);
        frameTraceDiagnostics.push({
            frame: frame + 1,
            scrollY: currentGeometry.scrollY,
            scrollHeight: currentGeometry.scrollHeight,
            rafDelay,
            skippable,
            previousFrameIgnorable: recentFrames[0].ignorable,
            geometryChanged,
            usedEscape: usedEscapeDiagnostics,
            unchangedBefore: unchanged,
            flippingDecks: [...deactivatedDecks].map(deck => ({
                turnId: deckStatus.decks.get(deck)?.turnId ?? null,
                state: deckStatus.decks.get(deck)?.state ?? null,
                top: deckStatus.decks.get(deck)?.top ?? null,
                height: deckStatus.decks.get(deck)?.height ?? null
            }))
        });
        if (usedEscapeDiagnostics) {
            escapesDiagnostics++;
        }
        if (skippable) {
            skippableFramesDiagnostics++;
        }
        recentFrames = [
            { geometry: currentGeometry, ignorable: skippable },
            ...recentFrames
        ].slice(0, MAX_IGNORED_FRAMES + 1);
        const positionAtFrame = trackAnchor
            ? anchorRoom()
            : null;
        const previousRafScrollHeightChangeDiagnostics = Math.abs(
            currentGeometry.scrollHeight -
            previousRafGeometryDiagnostics.scrollHeight
        );
        const previousRafScrollYChangeDiagnostics = Math.abs(
            currentGeometry.scrollY -
            previousRafGeometryDiagnostics.scrollY
        );
        recordRafTelemetryDiagnostics({
            geometryChanged,
            scrollHeight: currentGeometry.scrollHeight,
            scrollY: currentGeometry.scrollY,
            previousRafScrollHeight:
                previousRafGeometryDiagnostics.scrollHeight,
            previousRafScrollY:
                previousRafGeometryDiagnostics.scrollY,
            previousRafScrollHeightChange:
                previousRafScrollHeightChangeDiagnostics,
            previousRafScrollYChange:
                previousRafScrollYChangeDiagnostics,
            anchorPosition: positionAtFrame
        });
        previousRafGeometryDiagnostics = currentGeometry;

        const positionNowDiagnostics = trackAnchor
            ? anchorRoom()
            : null;

        if (geometryChanged) {
            if (!skippable) unchanged = 0;
        } else {
            unchanged++;
        }

        if (!skippable) {
            promptFrames = rafDelay >= MAX_STABLE_RAF_DELAY
                ? 0
                : promptFrames + 1;
        }

        const stable = unchanged >= stableFrames;
        finishRafDiagnostics({
            status: stable ? "stable" : "waiting",
            unchanged,
            promptFrames,
            rafDelay,
            geometryChanged
        });

        if (stable) {
            if (skippableFramesDiagnostics || escapesDiagnostics) {
                recordStabilizationEscapeDiagnostics({
                    stabilizationSkippableFrames:
                        skippableFramesDiagnostics,
                    stabilizationEscapes: escapesDiagnostics,
                    stabilizationFrames: frame + 1,
                    stabilizationTrace: frameTraceDiagnostics
                });
            }
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




/**
 * Return a fingerprint of the current geometry.
 *
 * Any geometric change that matters to traversal should
 * modify at least one of these quantities.
 */
function matchesRecentFrame(recentFrames, currentGeometry) {
    for (let index = 0; index < recentFrames.length; index++) {
        if (sameGeometry(recentFrames[index].geometry, currentGeometry)) {
            return true;
        }
        if (!recentFrames[index].ignorable) return false;
    }

    return false;
}

function sameGeometry(left, right) {
    if (left.scrollY !== right.scrollY) return false;
    return Math.abs(left.scrollHeight - right.scrollHeight) <
        TOLERATED_ROUNDING;
}

function geometrySnapshot() {

    return {
        scrollHeight: supplyHeight(),
        scrollY: supplyRoom()
    };
}

async function checkAnchorAcrossYields(
    trackAnchor,
    positionAtFrame
) {
    let previousPosition = positionAtFrame;
    let stable = true;

    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {
        beginYieldDiagnostics({
            index: yieldIndex,
            positionBefore: previousPosition
        });
        await yieldToScheduler();
        const position = trackAnchor
            ? anchorRoom()
            : null;
        const change = position == null || previousPosition == null
            ? 0
            : Math.abs(position - previousPosition);
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
    await new Promise(resolve => setTimeout(resolve, 0));
}
const thresholdEvaluationDiagnostics = {
    activationCount: 0,
    activationClosestDistance: -Infinity,
    deactivationCount: 0,
    deactivationClosestDistance: Infinity,
    previousDeckSnapshot: null
};

function evaluateThresholdsDiagnostics(current, frame) {
    const previous =
        thresholdEvaluationDiagnostics.previousDeckSnapshot;
    thresholdEvaluationDiagnostics.previousDeckSnapshot = current;
    if (!previous) return;

    for (const [deck, currentDeck] of current.decks) {
        const previousDeck = previous.decks.get(deck);
        if (!previousDeck || previousDeck.state === currentDeck.state) {
            continue;
        }

        const activated =
            previousDeck.state !== "true" &&
            currentDeck.state === "true";
        const deactivated =
            previousDeck.state === "true" &&
            currentDeck.state === "false";
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

        if (
            deactivated &&
            previousDeck.top >= previous.viewportHeight
        ) {
            const distance =
                previousDeck.top - previous.viewportHeight;
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
            "[diagnostics threshold transition]\n" +
            JSON.stringify({
                frame,
                turnId: currentDeck.turnId,
                stateBefore: previousDeck.state,
                stateAfter: currentDeck.state,
                previous: deckGeometryForThresholdDiagnostics(previousDeck),
                current: deckGeometryForThresholdDiagnostics(currentDeck),
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
        activationClosestDistance:
            Number.isFinite(activationClosestDistance)
                ? activationClosestDistance
                : null,
        deactivationCount,
        deactivationClosestDistance:
            Number.isFinite(deactivationClosestDistance)
                ? deactivationClosestDistance
                : null
    };
}
