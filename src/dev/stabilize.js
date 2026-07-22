import { MIN_SCROLL_HEIGHT_CHANGE } from "./constants.js";
import {
    beginStabilizationDiagnostics,
    finishStabilizationDiagnostics,
    beginRafDiagnostics,
    finishRafWaitDiagnostics,
    recordRafTelemetryDiagnostics,
    beginYieldDiagnostics,
    finishYieldDiagnostics,
    finishRafDiagnostics
} from "./cycleDiagnostics.js";

export async function waitLayoutStable(
    workZone,
    {
        stableFrames = 2,
        maxFrames = 300,
        current = null,
        phase = "layout"
    } = {}
) {

    const checkAnchor = current != null;

    let previous = geometrySnapshot(workZone);
    let unchanged = 0;
    beginStabilizationDiagnostics({ phase, stableFrames });

    for (let frame = 0; frame < maxFrames; frame++) {
        beginRafDiagnostics({ frame: frame + 1 });
        await nextAnimationFrame();
        finishRafWaitDiagnostics();

        const currentGeometry = geometrySnapshot(workZone);
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
            ? workZone.roomAheadOf(current)
            : null;
        recordRafTelemetryDiagnostics({
            geometryChangeMagnitude,
            scrollHeightChange,
            scrollHeightChangeIgnored:
                scrollHeightChange > 0 && effectiveScrollHeightChange === 0,
            scrollYChange,
            scrollHeight: currentGeometry.scrollHeight,
            scrollY: currentGeometry.scrollY,
            anchorRoom: roomAtFrame
        });

        if (geometryChanged) {
            finishRafDiagnostics({ status: "geometry-changed" });
            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        const anchorStable = await checkAnchorAcrossYields(
            current,
            workZone,
            frame,
            roomAtFrame
        );
        const roomNow = checkAnchor
            ? workZone.roomAheadOf(current)
            : null;

        if (!anchorStable) {
            finishRafDiagnostics({ status: "anchor-changed" });
            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        unchanged++;
        finishRafDiagnostics({ status: "stable", unchanged });

        if (unchanged >= stableFrames) {
            finishStabilizationDiagnostics({
                status: "stable",
                frames: frame + 1,
                room: roomNow
            });
            return {
                frames: frame + 1,
                status: "stable",
                room: roomNow
            };
        }
    }
    finishStabilizationDiagnostics({
        status: "exceeded-max-frames",
        frames: maxFrames
    });
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
function geometrySnapshot(workZone) {

    return {
        scrollHeight: workZone.supplyHeight,
        scrollY: workZone.position
    };
}

async function checkAnchorAcrossYields(
    current,
    workZone,
    frame,
    roomAtFrame
) {
    let previousRoom = roomAtFrame;
    let stable = true;

    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {
        beginYieldDiagnostics({ index: yieldIndex, roomBefore: previousRoom });
        await yieldToScheduler();
        const room = current != null
            ? workZone.roomAheadOf(current)
            : null;
        const change = room == null || previousRoom == null
            ? 0
            : Math.abs(room - previousRoom);
        const changed = change !== 0;
        finishYieldDiagnostics({ roomAfter: room, change, changed });

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
