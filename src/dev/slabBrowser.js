import { moveAnchorToBottom } from "./moveAnchorToBottom.js";
import { slabType } from "./slabType.js";
import { getNextAnchorIn } from "./getNextAnchorIn.js";
import { boundaryOf } from "./boundary.js";
import { observeSupplier, roomAhead } from "./scrollContainer.js";
import { getSlabIn } from "./getNextSlabIn.js";
import { getDeckIn } from "./getNextDeckIn.js";
import {
    beginPendingAwaitDiagnostics,
    finishPendingAwaitDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function moveNextAnchorToBottom(
    slabRoom,
    deckRoom
) {
    const context = contextAt(slabRoom, deckRoom);
    const calibratedJump = await prepareSlab(context.slab);
    const anchor = getNextAnchorIn(slabRoom, deckRoom);
    if (!anchor) {
        throw new Error("No ready visible anchor found in current slab.");
    }
    await moveAnchorToBottom(anchor, context.supplier, calibratedJump);
    return geometryOf(context.slab, context.deck, context.supplier.workZone);
}

export async function moveSlabBoundaryToBottom(
    slabRoom,
    deckRoom
) {
    const context = contextAt(slabRoom, deckRoom);
    const calibratedJump = await prepareSlab(context.slab);
    await moveAnchorToBottom(
        boundaryOf(context.slab, "top"),
        context.supplier,
        calibratedJump
    );
    return geometryOf(context.slab, context.deck, context.supplier.workZone);
}

async function prepareSlab(slab) {
    const type = slabType(slab);
    if (type === "unknown") {
        throw new Error("Cannot move an unknown slab type.");
    }
    if (type !== "image" && type !== "empty") return undefined;
    beginPendingAwaitDiagnostics("image-readiness", {
        slab: snapshotElementDiagnostics(slab),
        type
    });
    await waitImageReady(slab);
    finishPendingAwaitDiagnostics({
        slab: snapshotElementDiagnostics(slab),
        type
    });
    return Infinity;
}

function contextAt(slabRoom, deckRoom) {
    const supplier = observeSupplier();
    const slab = getSlabIn(slabRoom, deckRoom);
    const deck = getDeckIn(deckRoom);
    if (!slab) throw new Error("No slab found at the current geometry.");
    if (!deck) throw new Error("No deck found at the current geometry.");
    return { supplier, slab, deck };
}

function geometryOf(slab, deck, workZone) {
    return {
        slabRoom: roomAhead(boundaryOf(slab, "top"), workZone),
        deckRoom: roomAhead(boundaryOf(deck, "top"), workZone)
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
