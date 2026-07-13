import { MAX_DRIFT } from "./constants.js";
import { scrollY, scrollHeight } from "./scrollContainer.js";
import { measureRoom } from "./moveWorkZone.js";

/**
 * Wait until the geometry becomes stable — see ASSUMPTIONS.md A5.
 *
 * When current/direction/intendedRoom are given, stability additionally
 * requires room to be within roomTolerance of intendedRoom. This folds
 * the drift check into the wait itself, rather than treating it as a
 * separate pass/fail gate applied only after the fingerprint settles:
 * a fingerprint that goes flat for stableFrames during a lull in a
 * longer, staggered reflow no longer gets accepted as "done" just
 * because room hasn't been compared yet. See MAX_DRIFT's role change
 * in moveWorkZone.js.
 *
 * Polls via requestAnimationFrame. A MutationObserver-based redesign
 * was tried and reverted (see project memory) — its premise didn't
 * survive checking against the actual logs: the short/long timing
 * distinction it relied on doesn't predict anything (99.6% of short
 * "geometry stable but room not close" attempts are followed by
 * another short one, not a long one), so there was no real signal to
 * act on. rAF polling, despite competing with React's own rendering
 * for frame scheduling, is what generated every log this was checked
 * against.
 */
export async function waitLayoutStable(
    container = document.documentElement,
    {
        stableFrames = 2,
        maxFrames = 300,
        current = null,
        direction = null,
        intendedRoom = null,
        roomTolerance = MAX_DRIFT
    } = {}
) {

    const checkRoom = current != null && intendedRoom != null;

    let previous = geometryFingerprint(container);
    let unchanged = 0;

    console.log("Start stabilization");

    for (let frame = 0; frame < maxFrames; frame++) {
        const attemptTime = performance.now();
        await nextAnimationFrame();
        const attemptDeltaTime = performance.now() - attemptTime;

        const currentGeometry = geometryFingerprint(container);
        const geometryChanged = currentGeometry !== previous;
        const roomNow = checkRoom ? measureRoom(current, container, direction) : null;
        const roomClose = !checkRoom ||
            Math.abs(roomNow - intendedRoom) <= roomTolerance;

        if (!geometryChanged && roomClose) {
            unchanged++;
            console.log("rAF no change:", attemptDeltaTime, "ms");
        } else {
            // Distinguishes "still actively settling" (geometry itself is
            // changing) from "settled at the wrong place" (geometry is
            // stable but room never closed on intendedRoom) — these were
            // previously indistinguishable in the log, and the second one
            // can never resolve on its own since nothing is still moving.
            const reason = geometryChanged && !checkRoom
                ? `geometry changed (${previous} -> ${currentGeometry})`
                : geometryChanged
                ? `geometry changed (${previous} -> ${currentGeometry}), room=${roomNow}`
                : `geometry stable but room not close: room=${roomNow}, intendedRoom=${intendedRoom}, drift=${(roomNow - intendedRoom).toFixed(2)}`;
            console.log("rAF with change:", attemptDeltaTime, "ms —", reason);
            previous = currentGeometry;
            unchanged = 0;
        }

        if (unchanged >= stableFrames) {
            console.log("Stabilized.");
            return frame + 1;
        }
    }
    console.log("Out of the stabilization loop");
    throw new Error(
        checkRoom
            ? `Exceeded ${maxFrames} frames waiting for layout stabilization within ${roomTolerance}px of intendedRoom=${intendedRoom} ` +
              `(last room=${measureRoom(current, container, direction)}).`
            : `Exceeded ${maxFrames} frames waiting for layout stabilization.`
    );
}


/**
 * Return a fingerprint of the current geometry.
 *
 * Any geometric change that matters to traversal should
 * modify at least one of these quantities.
 */
function geometryFingerprint(container) {

    return [
        scrollHeight(container),
        scrollY(container)
    ].join(":");
}


/**
 * Wait for the next animation frame.
 */
function nextAnimationFrame() {

    return new Promise(resolve =>
        requestAnimationFrame(resolve)
    );
}
