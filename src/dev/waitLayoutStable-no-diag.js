import {
    ACTIVATION_DISTANCE,
    MIN_SCROLL_HEIGHT_CHANGE
} from "./constants-no-diag.js";
import {
    anchorRoom,
    roomUntilFirstNotReadyDeck,
    supplyHeight,
    supplyRoom
} from "./supplyWorker-no-diag.js";
export async function waitLayoutStable(
    {
        maxFrames = 300,
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
        const scrollHeightChange = Math.abs(
            currentGeometry.scrollHeight - previous.scrollHeight
        );
        const scrollYChange = Math.abs(
            currentGeometry.scrollY - previous.scrollY
        );
        const effectiveScrollHeightChange =
            scrollHeightChange < MIN_SCROLL_HEIGHT_CHANGE
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
