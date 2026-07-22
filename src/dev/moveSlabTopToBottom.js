import { moveAnchorToBottom } from "./moveAnchorToBottom.js";
import { slabType } from "./slabType.js";
import { getNextAnchorIn } from "./getNextAnchorIn.js";
import { boundaryOf } from "./boundary.js";
import { roomAhead } from "./scrollContainer.js";
import { getSlabIn } from "./getNextSlabIn.js";
import { getDeckIn } from "./getNextDeckIn.js";
import {
    beginPendingAwaitDiagnostics,
    finishPendingAwaitDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function moveSlabTopToBottom(state, supplier) {
    const { workZone } = supplier;
    const slab = getSlabIn(
        state.slabRoom,
        state.deckRoom,
        supplier
    );
    const deck = getDeckIn(state.deckRoom, supplier);
    if (!slab) throw new Error("No slab found at the current geometry.");
    if (!deck) throw new Error("No deck found at the current geometry.");
    const type = slabType(slab);
    const slabTop = boundaryOf(slab, "top");

    if (type === "unknown") {
        throw new Error("Cannot move an unknown slab type.");
    }

    if (type === "image" || type === "empty") {
        beginPendingAwaitDiagnostics("image-readiness", {
            slab: snapshotElementDiagnostics(slab),
            type
        });
        await waitImageReady(slab);
        finishPendingAwaitDiagnostics({
            slab: snapshotElementDiagnostics(slab),
            type
        });
        await moveAnchorToBottom(
            slabTop,
            supplier,
            Infinity
        );
        return geometryOf(slab, deck, workZone);
    }

    let room = roomAhead(slabTop, workZone);

    while (room < 0) {
        const geometry = geometryOf(slab, deck, workZone);
        const anchor = getNextAnchorIn(
            geometry.slabRoom,
            geometry.deckRoom,
            supplier
        );
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
    return geometryOf(slab, deck, workZone);
}

function geometryOf(slab, deck, workZone) {
    return {
        slabRoom: roomAhead(boundaryOf(slab, "top"), workZone),
        slabHeight: slab.getBoundingClientRect().height,
        deckRoom: roomAhead(boundaryOf(deck, "top"), workZone),
        deckHeight: deck.getBoundingClientRect().height
    };
}

async function waitImageReady(slab) {
    const images = slab.matches?.("img")
        ? [slab]
        : slab.querySelectorAll
            ? [...slab.querySelectorAll("img")]
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
