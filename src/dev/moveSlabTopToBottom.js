import { moveAnchorToBottom } from "./moveAnchorToBottom.js";
import { slabType } from "./slabType.js";
import { boundaryAnchor, getAnchorsIn } from "./getAnchorsIn.js";
import { roomAhead } from "./scrollContainer.js";
import {
    beginPendingAwaitDiagnostics,
    finishPendingAwaitDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function moveSlabTopToBottom(current, supplier) {
    const { workZone } = supplier;
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
            supplier,
            Infinity
        );
    }

    let room = roomAhead(slabTop, workZone);

    while (room < 0) {
        const anchors = getAnchorsIn(current, workZone);
        const anchor = anchors[0];
        if (!anchor) {
            throw new Error("No ready visible anchor found in current slab.");
        }

        await moveAnchorToBottom(
            anchor,
            supplier
        );
        room = roomAhead(slabTop, workZone);
    }

    await moveAnchorToBottom(
        slabTop,
        supplier
    );
    return roomAhead(slabTop, workZone);
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
