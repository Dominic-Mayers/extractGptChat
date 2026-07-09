// moveWorkZone.js
//
// Move the current slab into the work zone.
//
// The algorithm is geometry-driven:
//   1. Measure the room above the current slab.
//   2. If insufficient, perform a calibrated jump.
//   3. Wait for the layout to stabilize.
//   4. Measure again.
//   5. Verify that the observed movement agrees with the
//      intended movement within MAX_DRIFT.
//
import {
   MAX_DRIFT,
   MIN_INTERSECT,
   CALIBRATED_JUMP
} from "./constants.js";
import {
    containerScrollY,
    containerScrollHeight,
    containerClientHeight,
    containerScrollBy,
    containerScrollTo
} from "./scrollContainer.js";

export async function moveWorkZone(current, container, direction = -1) {

    let room = measureRoom(current, container, direction);
    // Loop termination runs on the intended jump result, not room itself
    // (same principle as isAtExtremity) — see ASSUMPTIONS.md A8.
    let intendedRoom = room;
    let extremityReached = isAtExtremity(0, container, direction);

    const viewportHeight = containerClientHeight(container);

    while (
        // Make sure current intersects enough to jump again
        // and there is still room to jump, not counting drift
        intendedRoom < viewportHeight - MIN_INTERSECT  && ! extremityReached
    ) {
        const previousRoom = room;
        const scrollYBefore = containerScrollY(container);
        const heightBefore = current.getBoundingClientRect().height;
        const jump = clampJump(CALIBRATED_JUMP, room, container, direction);
        extremityReached = isAtExtremity(jump, container, direction);
        performJump(jump, container, direction);
        await waitLayoutStable(container);
        room = measureRoom(current, container, direction);
        const scrollYAfter = containerScrollY(container);
        const heightAfter = current.getBoundingClientRect().height;
        intendedRoom = previousRoom + jump;
        const drift = room - intendedRoom;
        console.log(
            `[moveWorkZone] direction=${direction}, previousRoom=${Math.round(previousRoom)}, ` +
            `jump=${Math.round(jump)}, intendedRoom=${Math.round(intendedRoom)}, ` +
            `room=${Math.round(room)}, drift=${Math.round(drift)}, ` +
            `scrollY ${Math.round(scrollYBefore)} -> ${Math.round(scrollYAfter)}, ` +
            `current.height ${Math.round(heightBefore)} -> ${Math.round(heightAfter)}, ` +
            `extremityReached=${extremityReached}`
        );
        if (Math.abs(drift) > MAX_DRIFT) {
            throw new Error(
                `Unexpected room drift (${drift}px). direction=${direction}, ` +
                `previousRoom=${previousRoom}, jump=${jump}, intendedRoom=${intendedRoom}, ` +
                `room=${room}, scrollY ${scrollYBefore} -> ${scrollYAfter}, ` +
                `current.height ${heightBefore} -> ${heightAfter}, ` +
                `viewportHeight=${viewportHeight}, MIN_INTERSECT=${MIN_INTERSECT}.`
            );
        }
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
 */
export async function waitLayoutStable(
    container = document.documentElement,
    {
        stableFrames = 2,
        timeout = 5000
    } = {}
) {

    const deadline = Date.now() + timeout;

    let previous = geometryFingerprint(container);
    let unchanged = 0;

    while (true) {

        await nextAnimationFrame();

        const currentGeometry =
            geometryFingerprint(container);

        if (currentGeometry === previous) {

            unchanged++;

            if (unchanged >= stableFrames) {
                return;
            }

        } else {

            previous = currentGeometry;
            unchanged = 0;
        }

        if (Date.now() >= deadline) {

            throw new Error(
                "Timed out waiting for layout stabilization."
            );
        }
    }
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
