import { MAX_DRIFT } from "./constants-no-diag.js";
import { scrollY, scrollHeight } from "./scrollContainer-no-diag.js";
import { measureRoom } from "./moveSlabTopToBottom-no-diag.js";

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

    let previous = geometrySnapshot(container);
    let unchanged = 0;

    for (let frame = 0; frame < maxFrames; frame++) {
        await nextAnimationFrame();

        const currentGeometry = geometrySnapshot(container);
        const geometryChangeMagnitude = Math.max(
            Math.abs(currentGeometry.scrollHeight - previous.scrollHeight),
            Math.abs(currentGeometry.scrollY - previous.scrollY)
        );
        const geometryChanged = geometryChangeMagnitude !== 0;

        const roomNow = checkRoom ? measureRoom(current, container, direction) : null;
        const roomClose = !checkRoom ||
            Math.abs(roomNow - intendedRoom) <= roomTolerance;

        if (!geometryChanged && !roomClose) {
            return {
                frames: frame + 1,
                status: "stable-wrong-room",
                room: roomNow,
};
        }

        if (!geometryChanged && roomClose) {
            unchanged++;
        } else {
            previous = currentGeometry;
            unchanged = 0;
        }

        if (unchanged >= stableFrames) {
            return {
                frames: frame + 1,
                status: "stable",
                room: roomNow,
};
        }
    }
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
function geometrySnapshot(container) {

    return {
        scrollHeight: scrollHeight(container),
        scrollY: scrollY(container)
    };
}

/**
 * Wait for the next animation frame.
 */
function nextAnimationFrame() {

    return new Promise(resolve =>
        requestAnimationFrame(resolve)
    );
}
