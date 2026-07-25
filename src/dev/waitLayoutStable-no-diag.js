import {
    ACTIVATION_DISTANCE,
    TOLERATED_ROUNDING,
    MAX_FRAMES_FOR_STABILIZATION
} from "./constants-no-diag.js";
import {
    anchorRoom,
    roomUntilFirstNotReadyDeck,
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
    let unchanged = 0;

    for (let frame = 0; frame < maxFrames; frame++) {

        await nextAnimationFrame();

        const currentGeometry = geometrySnapshot();
        const discardRaf = evaluateDeckTransitions(
            thresholdDeckSnapshot(),
            frame + 1
        );
        if (discardRaf) {

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

        return true;
    }

    previousThresholdDeckSnapshot = current;

    return false;
}
