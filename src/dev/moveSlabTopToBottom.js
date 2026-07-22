import { moveAnchorToBottom } from "./moveAnchorToBottom.js";
import { slabType } from "./slabType.js";
import { boundaryAnchor, getAnchorsIn } from "./getAnchorsIn.js";
import {
    beginPendingAwaitDiagnostics,
    finishPendingAwaitDiagnostics,
    recordCycleStageDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function moveSlabTopToBottom(current, workZone) {
    const type = slabType(current);
    const slabTop = boundaryAnchor(current, "top");

    if (type === "unknown") {
        throw new Error("Cannot move an unknown slab type.");
    }

    if (type === "image" || type === "empty") {
        beginPendingAwaitDiagnostics("image-readiness", {
            slab: snapshotElementDiagnostics(current),
            type
        });
        await waitImageReady(current);
        finishPendingAwaitDiagnostics({
            slab: snapshotElementDiagnostics(current),
            type
        });
        return moveAnchorToBottom(
            slabTop,
            workZone,
            Infinity
        );
    }

    let room = workZone.roomAheadOf(slabTop);

    while (room < 0) {
        const anchors = measuredAnchorSearch(
            current,
            workZone
        );
        const anchor = anchors[0];
        if (!anchor) {
            throw new Error("No ready visible anchor found in current slab.");
        }

        await moveAnchorToBottom(
            anchor,
            workZone
        );
        room = workZone.roomAheadOf(slabTop);
    }

    await moveAnchorToBottom(
        slabTop,
        workZone
    );
    return workZone.roomAheadOf(slabTop);
}

function measuredAnchorSearch(current, workZone) {
    const startedAtDiagnostics = performance.now();
    const startedWallAtDiagnostics = Date.now();
    const anchors = getAnchorsIn(current, workZone);
    recordCycleStageDiagnostics("anchor-search", {
        elapsedMs: performance.now() - startedAtDiagnostics,
        wallElapsedMs: Date.now() - startedWallAtDiagnostics,
        anchorCount: anchors.length
    });
    return anchors;
}

async function waitImageReady(current) {
    const images = current.matches?.("img")
        ? [current]
        : current.querySelectorAll
            ? [...current.querySelectorAll("img")]
            : [];

    for (const image of images) {
        if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
            await new Promise((resolve, reject) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", reject, { once: true });
            });
        }
        if (typeof image.decode === "function") await image.decode();
    }
}
