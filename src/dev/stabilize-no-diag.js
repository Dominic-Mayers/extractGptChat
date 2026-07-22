import { MIN_SCROLL_HEIGHT_CHANGE } from "./constants-no-diag.js";
import {
    supplyHeight,
    viewportPosition,
    workZonePosition
} from "./scrollContainer-no-diag.js";
export async function waitLayoutStable(
    supplyArea,
    workZone,
    {
        stableFrames = 2,
        maxFrames = 300,
        current = null
    } = {}
) {
    const checkAnchor = current != null;

    let previous = geometrySnapshot(supplyArea, workZone);
    let unchanged = 0;

    for (let frame = 0; frame < maxFrames; frame++) {

        await nextAnimationFrame();

        const currentGeometry = geometrySnapshot(supplyArea, workZone);
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
        const positionAtFrame = checkAnchor
            ? viewportPosition(current, workZone)
            : null;

        if (geometryChanged) {

            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        const anchorStable = await checkAnchorAcrossYields(
            current,
            workZone,
            positionAtFrame
        );
        const positionNow = checkAnchor
            ? viewportPosition(current, workZone)
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
                position: positionNow
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
function geometrySnapshot(supplyArea, workZone) {

    return {
        scrollHeight: supplyHeight(supplyArea),
        scrollY: workZonePosition(supplyArea, workZone)
    };
}

async function checkAnchorAcrossYields(
    current,
    workZone,
    positionAtFrame
) {
    let previousPosition = positionAtFrame;
    let stable = true;

    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {

        await yieldToScheduler();
        const position = current != null
            ? viewportPosition(current, workZone)
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
