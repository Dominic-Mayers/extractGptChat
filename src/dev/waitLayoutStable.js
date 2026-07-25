import {
    ACTIVATION_DISTANCE,
    TOLERATED_ROUNDING,
    MAX_FRAMES_FOR_STABILIZATION
} from "./constants.js";
import {
    anchorRoom,
    roomUntilFirstNotReadyDeck,
    supplyHeight,
    supplyRoom,
    thresholdDeckSnapshot
} from "./supplyWorker.js";
import {
    beginStabilizationDiagnostics,
    finishStabilizationDiagnostics,
    beginRafDiagnostics,
    finishRafWaitDiagnostics,
    recordRafTelemetryDiagnostics,
    beginYieldDiagnostics,
    finishYieldDiagnostics,
    finishRafDiagnostics
} from "./cycleDiagnostics.js";

export async function waitLayoutStable(
    {
        maxFrames = MAX_FRAMES_FOR_STABILIZATION,
        trackAnchor = false
    } = {}
) {
    suppressInvestigatedDeckTopMarginDiagnostics();
    const stableFrames = trackAnchor &&
        roomUntilFirstNotReadyDeck() > ACTIVATION_DISTANCE
        ? 1
        : 2;

    let previous = geometrySnapshot();
    let unchanged = 0;
    beginStabilizationDiagnostics({ stableFrames });

    for (let frame = 0; frame < maxFrames; frame++) {
        beginRafDiagnostics({ frame: frame + 1 });
        await nextAnimationFrame();
        finishRafWaitDiagnostics();

        const currentGeometry = geometrySnapshot();
        const discardRaf = evaluateDeckTransitions(
            thresholdDeckSnapshot(),
            frame + 1
        );
        if (discardRaf) {
            finishRafDiagnostics({
                status: "discarded-reverse-deck-transition"
            });
            continue;
        }
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
        recordRafTelemetryDiagnostics({
            geometryChangeMagnitude,
            scrollHeightChange,
            scrollHeightChangeIgnored:
                scrollHeightChange > 0 && effectiveScrollHeightChange === 0,
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

function suppressInvestigatedDeckTopMarginDiagnostics() {
    const id = "dev-traversal-margin-collapse-test";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent =
        '[data-turn-id-container="' +
        'a7c93c21-9530-40b2-8369-5a98541ea360' +
        '"] > .my-4:first-child {' +
        "margin-top: 0 !important;" +
        "}";
    document.head.append(style);
    console.log(
        "[diagnostics margin collapse test] " +
        "Suppressed the investigated deck first-child top margin."
    );
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


/**
 * Wait for the next animation frame.
 */
export function nextAnimationFrame() {

    return new Promise(resolve =>
        requestAnimationFrame(resolve)
    );
}

const thresholdEvaluationDiagnostics = {
    activationCount: 0,
    activationClosestDistance: -Infinity,
    deactivationCount: 0,
    deactivationClosestDistance: Infinity
};

let previousThresholdDeckSnapshot = null;

function evaluateDeckTransitions(current, frame) {
    const previous = previousThresholdDeckSnapshot;
    if (!previous) {
        previousThresholdDeckSnapshot = current;
        return false;
    }

    const transitions = [];

    for (const [deck, currentDeck] of current.decks) {
        const previousDeck = previous.decks.get(deck);
        if (!previousDeck || previousDeck.state === currentDeck.state) {
            continue;
        }

        transitions.push({
            previousDeck,
            currentDeck,
            activated:
                previousDeck.state !== "true" &&
                currentDeck.state === "true",
            deactivated:
                previousDeck.state === "true" &&
                currentDeck.state === "false"
        });
    }

    const reverseTransitions = transitions.filter(transition =>
        (
            transition.activated &&
            transition.currentDeck.top >= current.viewportHeight
        ) ||
        (
            transition.deactivated &&
            transition.currentDeck.bottom <= 0
        )
    );

    if (reverseTransitions.length > 0) {
        warnReverseDeckTransitionsDiagnostics(
            reverseTransitions,
            previous,
            current,
            frame
        );
        return true;
    }

    previousThresholdDeckSnapshot = current;
    recordThresholdTransitionsDiagnostics(
        transitions,
        previous,
        current,
        frame
    );
    return false;
}

function recordThresholdTransitionsDiagnostics(
    transitions,
    previous,
    current,
    frame
) {
    for (const {
        previousDeck,
        currentDeck,
        activated,
        deactivated
    } of transitions) {
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

function warnReverseDeckTransitionsDiagnostics(
    transitions,
    previous,
    current,
    frame
) {
    console.warn(
        "[diagnostics reverse deck transition] rAF discarded.\n" +
        JSON.stringify({
            frame,
            transitions: transitions.map(({
                previousDeck,
                currentDeck,
                activated
            }) => ({
                turnId: currentDeck.turnId,
                transition: activated
                    ? "activation-below"
                    : "deactivation-above",
                stateBefore: previousDeck.state,
                stateAfter: currentDeck.state,
                previous:
                    deckGeometryForThresholdDiagnostics(previousDeck),
                current:
                    deckGeometryForThresholdDiagnostics(currentDeck)
            })),
            viewportHeightBefore: previous.viewportHeight,
            viewportHeightAfter: current.viewportHeight
        }, null, 2)
    );
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
