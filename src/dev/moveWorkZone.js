// moveWorkZone.js
//
// The move is a sequence of jumps, that each increases the room ahead of the current slab. 
// The algorithm is geometry-driven. 
// It is initiated (outside the function) when there is not enough room.
// It ends when the intersection of the current slab with the viewport reaches MIN_INTERSECT
// or the extremity of the document is reached.
//
// In each cycle:
//   1. Clamp the jump if needed. 
//   2. Perform the jump.
//   3. Wait for the layout to stabilize, including room reaching
//      the intended value within MAX_DRIFT. 
//
import {
   MAX_DRIFT,
   MIN_INTERSECT,
   CALIBRATED_JUMP
} from "./constants.js";

import {
    findScrollContainer,
    scrollY,
    scrollHeight,
    clientHeight,
    scrollBy,
    scrollTo
} from "./scrollContainer.js";

import { isEarlyStopRequestedByUser } from "./stopControl.js";

export async function moveWorkZone(current, container, direction = -1) {

    let room = measureRoom(current, container, direction);
    let slabIntersectionAtMinimum = isSlabIntersectionAtMinimum(container, room);
    let extremityReached = isAtExtremityAfter(0, container, direction);

    while (!slabIntersectionAtMinimum && !extremityReached) {

        if (isEarlyStopRequestedByUser()) {
            return { room, extremityReached };
        }

        const previousRoom = room;
        const scrollYBefore = scrollY(container);
        const scrollHeightBefore = scrollHeight(container);
        const heightBefore = current.getBoundingClientRect().height;
        const intendedRoom = previousRoom + jump;

        const jump = clampJump(CALIBRATED_JUMP, room, container, direction);

        // These are computed before the jump, because the decision for the next jump 
        // is based on the intent, not the actual result of the jump. 
        slabIntersectionAtMinimum = isSlabIntersectionAtMinimum(container, intendedRoom); 
        extremityReached = isAtExtremityAfter(jump, container, direction);

        console.log(
            `[moveWorkZone] before jump: direction=${direction}, previousRoom=${Math.round(previousRoom)}, ` +
            `jump=${Math.round(jump)}, intendedRoom=${Math.round(intendedRoom)}, ` +
            `scrollY=${Math.round(scrollYBefore)}, scrollHeight=${Math.round(scrollHeightBefore)}, ` +
            `current.height=${Math.round(heightBefore)}, extremityReached=${extremityReached}`
        );

        const jumpStartTime = performance.now();

        performJump(jump, container, direction);

        const scrollYImmediatelyAfterJump = scrollY(container);
        console.log(
            `[moveWorkZone] immediately after performJump: scrollY ${Math.round(scrollYBefore)} -> ` +
            `${Math.round(scrollYImmediatelyAfterJump)} (expected ${Math.round(scrollYBefore + jump * direction)})`
        );

        let stableAfterFrames;

        try {
            stableAfterFrames = await waitLayoutStable(container, { current, direction, intendedRoom });
        } catch (err) {
            const connected = 'isConnected' in current ? current.isConnected : null;
            const containerConnected = 'isConnected' in container ? container.isConnected : null;
            const freshContainer = findScrollContainer();
            const containerIsStale = freshContainer !== container;
            const childCount = container.childElementCount;
            const effectiveOverflowAnchor = getComputedStyle(container).overflowAnchor;
            const roomNow = measureRoom(current, container, direction);
            throw new Error(
                `moveWorkZone jump did not stabilize within tolerance: direction=${direction}, ` +
                `previousRoom=${previousRoom}, jump=${jump}, intendedRoom=${intendedRoom}, ` +
                `room=${roomNow}, scrollY=${scrollY(container)}, ` +
                `scrollHeight ${scrollHeightBefore} -> ${scrollHeight(container)}, ` +
                `current.isConnected=${connected}, container.isConnected=${containerConnected}, ` +
                `containerIsStale=${containerIsStale}, container.childElementCount=${childCount}, ` +
                `container effectiveOverflowAnchor=${effectiveOverflowAnchor}` +
                (connected === false
                    ? ' (current was unmounted — use the restart-synchronization menu action, not a retry of this cursor)'
                    : containerIsStale
                    ? ' (container is stale — findScrollContainer() now returns a different element)'
                    : containerConnected === false
                    ? ' (container is stale — the scroll ancestor was replaced mid-traversal)'
                    : ' (both still connected and container is current — this is not an unmount, needs investigation)') +
                `. ${err.message}`
            );
        }

        room = measureRoom(current, container, direction);
        const scrollYAfter = scrollY(container);
        const scrollHeightAfter = scrollHeight(container);
        const heightAfter = current.getBoundingClientRect().height;
        const drift = room - intendedRoom;
        const elapsedMs = performance.now() - jumpStartTime;
        console.log(
            `[moveWorkZone] after jump: direction=${direction}, intendedRoom=${Math.round(intendedRoom)}, ` +
            `room=${Math.round(room)}, drift=${drift.toFixed(4)}, elapsedMs=${elapsedMs.toFixed(1)}, ` +
            `stableAfterFrames=${stableAfterFrames}, ` +
            `scrollY ${Math.round(scrollYBefore)} -> ${Math.round(scrollYAfter)}, ` +
            `scrollHeight ${Math.round(scrollHeightBefore)} -> ${Math.round(scrollHeightAfter)}, ` +
            `current.height ${Math.round(heightBefore)} -> ${Math.round(heightAfter)}`
        );
    }
    return { room, extremityReached };
}

/**
 * Clamp a calibrated jump.
 */
export function clampJump(calibratedJump, room, container, direction) {

    const viewportHeight = clientHeight(container);
    const pageHeight = scrollHeight(container);
    const distanceToExtremity = direction < 0 ?
        scrollY(container) :
        pageHeight - scrollY(container) - viewportHeight;

    return Math.min(
            calibratedJump,
            distanceToExtremity,
            (viewportHeight - MIN_INTERSECT) - room
        );
}

/**
 * Determine if the jump reaches extremity.
 * The intended jump should be used instead of the actual jump, which
 * can drift in uncontrolled ways.  This prioritizes a deterministic 
 * end condition over a condition that applies to the actual jump. It assumes
 * the boundary values used in decisions are valid within these small drifts.
 * For example, if the intended jump reaches the extremity, the actual
 * jump may not, but there is no need to actually reach the extremity, 
 * because the activation of the rendering of the last deck is
 * already satisfied even with a smaller actual jump.
 */ 
export function isAtExtremityAfter(jump = 0, container, direction) {

    if (direction < 0) {
        return scrollY(container) + direction * jump === 0;
    }

    return (
        scrollHeight(container)
        - (scrollY(container) + direction * jump)
        - clientHeight(container)
        === 0
    );
}

export function isSlabIntersectionAtMinimum(container, intendedRoom) {
    return intendedRoom >= clientHeight(container) - MIN_INTERSECT;
}

/**
 * Measure the room ahead the current slab.
 */
export function measureRoom(current, container, direction) {

    const viewportHeight = clientHeight(container);
    const rect = current.getBoundingClientRect();

    return direction < 0
        ? rect.top
        : viewportHeight - rect.bottom;
}

/**
 * Perform a viewport jump.
 *
 * When the jump reaches the extremity of the document,
 * use an absolute move.
 */
export function performJump(jump, container, direction) {

    const viewportHeight = clientHeight(container);
    const pageHeight = scrollHeight(container);

    const distanceToExtremity = direction < 0 ?
       scrollY(container) :
       pageHeight - scrollY(container) - viewportHeight;

    if (jump >= distanceToExtremity && direction < 0) {
        scrollTo(container, 0);
    } else if (jump >= distanceToExtremity) {
        scrollTo(container, pageHeight); // too much, but the browser clamps
    }
    else {
        scrollBy(container, jump * direction);
    }
}


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

    let attemptStartTime = performance.now();
    for (let frame = 0; frame < maxFrames; frame++) {
        await nextAnimationFrame();

        const currentGeometry = geometryFingerprint(container);
        const geometryChanged = currentGeometry !== previous;
        const roomNow = checkRoom ? measureRoom(current, container, direction) : null;
        const roomClose = !checkRoom ||
            Math.abs(roomNow - intendedRoom) <= roomTolerance;

        if (!geometryChanged && roomClose) {
            unchanged++;
        } else {
            const attemptTime = performance.now() - attemptStartTime;
            attemptStartTime += attemptTime;
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
            console.log("Failed attempt at stabilization:", attemptTime, "ms —", reason);
            previous = currentGeometry;
            unchanged = 0;
        }

        if (unchanged >= stableFrames) {
            const lastAttemptTime = performance.now() - attemptStartTime;
            console.log("Stabilized. Last attempt time:", lastAttemptTime, "ms");
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
        document.body.scrollWidth,
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
