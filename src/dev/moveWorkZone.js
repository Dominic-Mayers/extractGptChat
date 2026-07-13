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

import { waitLayoutStable } from "./stabilize.js";

export async function moveWorkZone(current, container, direction = -1) {

    let room = measureRoom(current, container, direction);
    let slabIntersectionAtMinimum = isSlabIntersectionAtMinimum(container, room);
    let extremityReached = isAtExtremityAfter(0, container, direction);

    while (!slabIntersectionAtMinimum && !extremityReached) {

        const previousRoom = room;
        const scrollYBefore = scrollY(container);
        const scrollHeightBefore = scrollHeight(container);
        const heightBefore = current.getBoundingClientRect().height;
 
        const jump = clampJump(CALIBRATED_JUMP, room, container, direction);
        const intendedRoom = previousRoom + jump;

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

        performJump(jump, container, direction);

        const scrollYImmediatelyAfterJump = scrollY(container);
        console.log(
            `[moveWorkZone] immediately after performJump: scrollY ${Math.round(scrollYBefore)} -> ` +
            `${Math.round(scrollYImmediatelyAfterJump)} (expected ${Math.round(scrollYBefore + jump * direction)})`
        );

        let stableAfterFrames;

        try {
            stableAfterFrames = await waitLayoutStable(container, { current, direction, intendedRoom, stableFrames: 5 });
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
        console.log(
            `[moveWorkZone] after jump: direction=${direction}, intendedRoom=${Math.round(intendedRoom)}, ` +
            `room=${Math.round(room)}, drift=${drift.toFixed(4)} ` +
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
 * can drift. This prioritizes a deterministic end condition over a condition
 * that reflects the actual jump after the drift. It assumes the boundary values used
 * in decisions are valid within a small drift. For example, if the intended jump
 * reaches the extremity, the actual jump may not, but there is no need to actually
 * reach the extremity, because the activation of the rendering of the next deck is
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

/**
 * Determine if the intersection of the current slab with the viewport is at minimum.
 * The same comment as for isAtExtremityAfter applies here: 
 * the intended jump should be used instead of the actual jump, which can drift. 
 */
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