import { moveAnchorToBottom } from "./moveAnchorToBottom-no-diag.js";
import { slabType } from "./slabType-no-diag.js";
import { boundaryAnchor, getAnchorsIn } from "./getAnchorsIn-no-diag.js";
export async function moveSlabTopToBottom(current, workZone) {
    const type = slabType(current);
    const slabTop = boundaryAnchor(current, "top");

    if (type === "unknown") {
        throw new Error("Cannot move an unknown slab type.");
    }

    if (type === "image" || type === "empty") {

        await waitImageReady(current);

        return moveAnchorToBottom(
            slabTop,
            workZone,
            Infinity
        );
    }

    let room = measuredSlabRoom(
        slabTop,
        workZone,
        "initial"
    );

    while (room < 0) {
        const anchors = measuredAnchorSearch(
            current,
            workZone,
            "work-zone-entry"
        );
        const anchor = anchors[0];
        if (!anchor) {
            throw new Error("No ready visible anchor found in current slab.");
        }

        await moveAnchorToBottom(
            anchor,
            workZone
        );
        room = measuredSlabRoom(
            slabTop,
            workZone,
            "after-anchor-movement"
        );
    }

    await moveAnchorToBottom(
        slabTop,
        workZone
    );
    return measuredSlabRoom(
        slabTop,
        workZone,
        "after-final-anchor-movement"
    );
}

function measuredSlabRoom(slabTop, workZone, phase) {

    const room = workZone.roomAheadOf(slabTop);

    return room;
}

function measuredAnchorSearch(current, workZone, phase) {

    const anchors = getAnchorsIn(current, workZone);

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
