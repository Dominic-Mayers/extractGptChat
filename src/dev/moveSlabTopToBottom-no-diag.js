import { moveAnchorToBottom, isAnchorAtBottom } from "./moveAnchorToBottom-no-diag.js";
import { slabType } from "./slabType-no-diag.js";
import { getNextAnchorIn } from "./getNextAnchorIn-no-diag.js";
import { boundaryOf } from "./boundary-no-diag.js";
import { observeSupplier, roomAhead } from "./scrollContainer-no-diag.js";
import { getSlabIn } from "./getNextSlabIn-no-diag.js";
import { getDeckIn } from "./getNextDeckIn-no-diag.js";
export async function moveSlabTopToBottom(slabRoom, deckRoom) {
    const supplier = observeSupplier();
    const { workZone } = supplier;
    const slab = getSlabIn(slabRoom, deckRoom);
    const deck = getDeckIn(deckRoom);
    if (!slab) throw new Error("No slab found at the current geometry.");
    if (!deck) throw new Error("No deck found at the current geometry.");
    const type = slabType(slab);
    const slabTop = boundaryOf(slab, "top");
    let imageReady = false;

    if (type === "unknown") {
        throw new Error("Cannot move an unknown slab type.");
    }

    let room = roomAhead(slabTop, workZone);

    while (!isAnchorAtBottom(workZone, room)) {
        let anchor;

        if (type === "image" || type === "empty") {
            if (!imageReady) {

                await waitImageReady(slab);

                imageReady = true;
            }
            anchor = slabTop;
        } else if (room > 0) {
            anchor = slabTop;
        } else {
            const geometry = geometryOf(slab, deck, workZone);
            anchor = getNextAnchorIn(
                geometry.slabRoom,
                geometry.deckRoom
            );
            if (!anchor) {
                throw new Error("No ready visible anchor found in current slab.");
            }
        }

        const previousRoom = room;
        await moveAnchorToBottom(anchor, supplier);
        room = roomAhead(slabTop, workZone);
        if (room === previousRoom) break;
    }

    return geometryOf(slab, deck, workZone);
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
