import {

    MIN_ACTIVATION_DISTANCE,
    TOLERATED_ROUNDING,
    MAX_FRAMES_FOR_STABILIZATION
} from "./constants-diag.js";
import {
    anchorRoom,
    deckActivationTransitions,
    roomUntilFirstActiveDeckBelow,
    roomUntilFirstNotReadyDeck,
    saveDeckActivationStatus,
    sampleStabilizationDecksDiagnostics,
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
    recordStabilizationRuleDiagnostics
} from "./cycleDiagnostics-diag.js";
import { nextAnimationFrame } from "./scrollContainer-diag.js";

export async function waitLayoutStable(
    {
        maxFrames = MAX_FRAMES_FOR_STABILIZATION,
        trackAnchor = false
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

    let previous = geometrySnapshot();
    let previousRafGeometry = previous;
    let unchanged = 0;
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
        await nextAnimationFrame(clock => {
            if (sampleStabilizationDecksDiagnostics) {
                sampleStabilizationDecksDiagnostics(frame + 1, clock);
            }
        });
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
        const effectiveScrollHeightChange =
            scrollHeightChange < TOLERATED_ROUNDING
                ? 0
                : scrollHeightChange;
        const geometryChangeMagnitude = Math.max(
            effectiveScrollHeightChange,
            scrollYChange
        );
        const geometryChanged = geometryChangeMagnitude !== 0;
        const positionAtFrame = trackAnchor
            ? anchorRoom()
            : null;
        const previousRafScrollHeightChange = Math.abs(
            currentGeometry.scrollHeight -
            previousRafGeometry.scrollHeight
        );
        const previousRafScrollYChange = Math.abs(
            currentGeometry.scrollY - previousRafGeometry.scrollY
        );
        recordRafTelemetryDiagnostics({
            geometryChangeMagnitude,
            scrollHeightChange,
            scrollHeightChangeIgnored:
                scrollHeightChange > 0 && effectiveScrollHeightChange === 0,
            scrollYChange,
            scrollHeight: currentGeometry.scrollHeight,
            scrollY: currentGeometry.scrollY,
            previousRafScrollHeight:
                previousRafGeometry.scrollHeight,
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
        const positionNowDiagnostics = trackAnchor
            ? anchorRoom()
            : null;

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
    return activations.some(({ location }) => location === "below") ||
        deactivations.some(({ location }) => location === "above");
}

function warnIgnoredDeckTransitions(
    { activations, deactivations },
    frame,
    geometry
) {
    const ignoredTransitions = [
        ...activations
            .filter(({ location }) => location === "below")
            .map(transition => ({
                turnId: transition.turnId,
                transition: "activation-below",
                previous: transitionGeometry(transition.previous),
                current: transitionGeometry(transition.current)
            })),
        ...deactivations
            .filter(({ location }) => location === "above")
            .map(transition => ({
                turnId: transition.turnId,
                transition: "deactivation-above",
                previous: transitionGeometry(transition.previous),
                current: transitionGeometry(transition.current)
            }))
    ];

    console.warn(
        "[stabilization] Ignored rAF with reverse deck transition.\n" +
        JSON.stringify({
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

/**
 * Return a fingerprint of the current geometry.
 *
 * Any geometric change that matters to traversal should
 * modify at least one of these quantities.
 */
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
