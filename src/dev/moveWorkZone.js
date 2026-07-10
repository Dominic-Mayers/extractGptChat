// moveWorkZone.js
//
// Move the current slab into the work zone.
//
// The algorithm is geometry-driven:
//   1. Measure the room above the current slab.
//   2. If insufficient, perform a calibrated jump.
//   3. Wait for the layout to stabilize AND for room to close to
//      within MAX_DRIFT of the intended value — both are required
//      before a jump is trusted (see waitLayoutStable).
//
// There is no separate after-the-fact drift check: a jump that
// resolves has already satisfied MAX_DRIFT by construction. A jump
// that never satisfies it within the timeout throws instead of
// silently continuing — see the catch block below for why the
// decision isn't "was current still connected," just what the error
// reports.
//
import {
   MAX_DRIFT,
   MIN_INTERSECT,
   CALIBRATED_JUMP
} from "./constants.js";
import {
    findScrollContainer,
    containerScrollY,
    containerScrollHeight,
    containerClientHeight,
    containerScrollBy,
    containerScrollTo
} from "./scrollContainer.js";
import { isStopRequested } from "./stopControl.js";

export async function moveWorkZone(current, container, direction = -1) {

    let room = measureRoom(current, container, direction);
    let extremityReached = isAtExtremity(0, container, direction);
    // Decided prospectively from intent, not from a post-jump
    // remeasurement — same principle as extremityReached, and for the
    // same reason: containerClientHeight(container) is not guaranteed
    // stable across jumps, so comparing a later remeasured room against
    // a viewportHeight captured once before any jump could compare
    // against a value that's already gone stale. See ASSUMPTIONS.md A8.
    let slabIntersectionAtMinimum =
        room >= containerClientHeight(container) - MIN_INTERSECT;

    while (!slabIntersectionAtMinimum && !extremityReached) {

        // Checked here, not just in traverseConversation's outer loop,
        // so a stop request takes effect between individual jumps
        // instead of waiting for a whole (possibly long) work-zone move
        // to finish first.
        if (isStopRequested()) {
            return { room, extremityReached };
        }

        const previousRoom = room;
        const scrollYBefore = containerScrollY(container);
        const scrollHeightBefore = containerScrollHeight(container);
        const heightBefore = current.getBoundingClientRect().height;
        const jump = clampJump(CALIBRATED_JUMP, room, container, direction);
        const intendedRoom = previousRoom + jump;
        // Read fresh, right alongside the jump that was just clamped
        // against its own fresh reading of the same quantity inside
        // clampJump() — not the value from before the loop started.
        slabIntersectionAtMinimum =
            intendedRoom >= containerClientHeight(container) - MIN_INTERSECT;
        extremityReached = isAtExtremity(jump, container, direction);

        console.log(
            `[moveWorkZone] before jump: direction=${direction}, previousRoom=${Math.round(previousRoom)}, ` +
            `jump=${Math.round(jump)}, intendedRoom=${Math.round(intendedRoom)}, ` +
            `scrollY=${Math.round(scrollYBefore)}, scrollHeight=${Math.round(scrollHeightBefore)}, ` +
            `current.height=${Math.round(heightBefore)}, extremityReached=${extremityReached}`
        );

        const jumpStartTime = performance.now();

        performJump(jump, container, direction);

        // Native scrollTop updates synchronously on scrollBy()/scrollTo() —
        // if something (e.g. a virtualized-list library reacting to the
        // scroll) reverts it, that happens later, since scroll events
        // dispatch asynchronously. Reading here, before waitLayoutStable's
        // first await, distinguishes "the jump was never applied at all"
        // from "it was applied and then reverted" — waitLayoutStable's own
        // sampling starts a frame too late to tell those apart.
        const scrollYImmediatelyAfterJump = containerScrollY(container);
        console.log(
            `[moveWorkZone] immediately after performJump: scrollY ${Math.round(scrollYBefore)} -> ` +
            `${Math.round(scrollYImmediatelyAfterJump)} (expected ${Math.round(scrollYBefore + jump * direction)})`
        );

        let stableAfterFrames;

        try {
            stableAfterFrames = await waitLayoutStable(container, { current, direction, intendedRoom });
        } catch (err) {
            const connected = 'isConnected' in current ? current.isConnected : null;
            // Distinguishes "current itself was unmounted" from "container
            // is a stale reference to a scroll ancestor React has since
            // replaced" — a scrollBy() on a detached container silently
            // scrolls nothing, while current (if still attached to the
            // live tree) correctly reports a position that never moved.
            const containerConnected = 'isConnected' in container ? container.isConnected : null;
            // Stronger than isConnected alone: re-locates the scroll
            // ancestor from scratch and compares by reference. isConnected
            // only proves the node is somewhere in the live tree, not that
            // it's still the ancestor ChatGPT is actually scrolling — a
            // reference identity mismatch is direct proof container is
            // stale even in the (expected) common case where it's still
            // technically connected.
            const freshContainer = findScrollContainer();
            const containerIsStale = freshContainer !== container;
            const childCount = container.childElementCount;
            // Checks the actual effective value, not just what we set —
            // React re-rendering this element with its own style prop could
            // silently reset our inline override back to the default
            // without us ever seeing it revert.
            const effectiveOverflowAnchor = getComputedStyle(container).overflowAnchor;
            const roomNow = measureRoom(current, container, direction);
            throw new Error(
                `moveWorkZone jump did not stabilize within tolerance: direction=${direction}, ` +
                `previousRoom=${previousRoom}, jump=${jump}, intendedRoom=${intendedRoom}, ` +
                `room=${roomNow}, scrollY=${containerScrollY(container)}, ` +
                `scrollHeight ${scrollHeightBefore} -> ${containerScrollHeight(container)}, ` +
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
        const scrollYAfter = containerScrollY(container);
        const scrollHeightAfter = containerScrollHeight(container);
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

    const viewportHeight = containerClientHeight(container);
    const pageHeight = containerScrollHeight(container);
    const distanceToExtremity = direction < 0 ?
        containerScrollY(container) :
        pageHeight - containerScrollY(container) - viewportHeight;

    return Math.min(
            calibratedJump,
            distanceToExtremity,
            (viewportHeight - MIN_INTERSECT) - room
        );
}

/**
 * Determine if the intended jump reaches extremity.
 */
export function isAtExtremity(jump = 0, container, direction) {

    if (direction < 0) {
        return containerScrollY(container) + direction * jump === 0;
    }

    return (
        containerScrollHeight(container)
        - (containerScrollY(container) + direction * jump)
        - containerClientHeight(container)
        === 0
    );
}

/**
 * Measure the room ahead the current slab.
 */
export function measureRoom(current, container, direction) {

    const viewportHeight = containerClientHeight(container);
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

    const viewportHeight = containerClientHeight(container);
    const pageHeight = containerScrollHeight(container);

    const distanceToExtremity = direction < 0 ?
       containerScrollY(container) :
       pageHeight - containerScrollY(container) - viewportHeight;

    if (jump >= distanceToExtremity && direction < 0) {
        containerScrollTo(container, 0);
    } else if (jump >= distanceToExtremity) {
        containerScrollTo(container, pageHeight); // too much, but the browser clamps
    }
    else {
        containerScrollBy(container, jump * direction);
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
        containerScrollHeight(container),
        document.body.scrollWidth,
        containerScrollY(container)
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
