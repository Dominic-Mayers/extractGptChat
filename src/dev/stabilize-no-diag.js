import { scrollY, scrollHeight } from "./scrollContainer-no-diag.js";
import { MIN_SCROLL_HEIGHT_CHANGE } from "./constants-no-diag.js";
export async function waitLayoutStable(
    container = document.documentElement,
    {
        stableFrames = 2,
        maxFrames = 300,
        current = null,
        direction = null,
        measureReferenceRoom = null,
        phase = "layout"
    } = {}
) {

    const checkAnchor = current != null && measureReferenceRoom != null;

    let previous = geometrySnapshot(container);
    let unchanged = 0;

    for (let frame = 0; frame < maxFrames; frame++) {

        await nextAnimationFrame();

        const currentGeometry = geometrySnapshot(container);
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
        const roomAtFrame = checkAnchor
            ? measureReferenceRoom(current, container, direction)
            : null;

        if (geometryChanged) {

            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        const anchorStable = await checkAnchorAcrossYields(
            current,
            container,
            direction,
            measureReferenceRoom,
            frame,
            roomAtFrame
        );
        const roomNow = checkAnchor
            ? measureReferenceRoom(current, container, direction)
            : null;

        if (!anchorStable) {

            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        unchanged++;

        if (unchanged >= stableFrames) {

            return {
                frames: frame + 1,
                status: "stable",
                room: roomNow
            };
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
function geometrySnapshot(container) {

    return {
        scrollHeight: scrollHeight(container),
        scrollY: scrollY(container)
    };
}

async function checkAnchorAcrossYields(
    current,
    container,
    direction,
    measureReferenceRoom,
    frame,
    roomAtFrame
) {
    let previousRoom = roomAtFrame;
    let stable = true;

    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {

        await yieldToScheduler();
        const room = current != null && measureReferenceRoom != null
            ? measureReferenceRoom(current, container, direction)
            : null;
        const change = room == null || previousRoom == null
            ? 0
            : Math.abs(room - previousRoom);
        const changed = change !== 0;

        if (changed) stable = false;
        previousRoom = room;
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
