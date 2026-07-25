import {

    ACTIVATION_DISTANCE,
    TOLERATED_ROUNDING,
    MAX_FRAMES_FOR_STABILIZATION
} from "./constants-no-diag.js";
import {
    anchorRoom,
    deckActivationTransitions,
    roomUntilFirstNotReadyDeck,
    saveDeckActivationStatus,
    supplyHeight,
    supplyRoom,
    thresholdDeckSnapshot
} from "./supplyWorker-no-diag.js";
export async function waitLayoutStable(
    {
        maxFrames = MAX_FRAMES_FOR_STABILIZATION,
        trackAnchor = false
    } = {}
) {
    const stableFrames = trackAnchor &&
        roomUntilFirstNotReadyDeck() > ACTIVATION_DISTANCE
        ? 1
        : 2;

    let previous = geometrySnapshot();
    let previousRafGeometry = previous;
    let unchanged = 0;
    saveDeckActivationStatus(thresholdDeckSnapshot());

    for (let frame = 0; frame < maxFrames; frame++) {

        await nextAnimationFrame();

        const currentGeometry = geometrySnapshot();
        const deckStatus = thresholdDeckSnapshot();
        const deckTransitions = deckActivationTransitions(deckStatus);
        saveDeckActivationStatus(deckStatus);

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

            continue;
        }

        if (geometryChanged) {

            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        const anchorStable = await checkAnchorAcrossYields(
            trackAnchor,
            positionAtFrame
        );

        if (!anchorStable) {

            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        unchanged++;

        if (unchanged >= stableFrames) {

            return;
        }
    }

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

        await yieldToScheduler();
        const position = trackAnchor
            ? anchorRoom()
            : null;
        const change = position == null || previousPosition == null
            ? 0
            : Math.abs(position - previousPosition);
        const changed = change !== 0;

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
