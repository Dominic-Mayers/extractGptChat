// mainOrchestration.js
//
// Main geometric traversal.
//
// This file implements only the geometric part of the
// traversal.  Content extraction is intentionally omitted.

import { getNextSlabIn } from "./getNextSlabIn-no-diag.js";
import { getNextDeckIn } from "./getNextDeckIn-no-diag.js";
import { moveSlabTopToBottom } from "./moveSlabTopToBottom-no-diag.js";
import { moveViewportToDocumentBottom } from "./moveViewportToDocumentBottom-no-diag.js";
import {
    observeSupplier
} from "./scrollContainer-no-diag.js";
import {
    MAX_SLAB_GAP,
    MINIMUM_SLAB_HEIGHT
} from "./constants-no-diag.js";
export async function traverseConversation() {

    try {

    const supplier = observeSupplier();
    const { workZone } = supplier;

    // Establishes the measured starting boundary; see ASSUMPTIONS.md A9.
    const initial = await moveViewportToDocumentBottom(supplier);

    let slabRoom = initial.room;
    let slabHeight = null;
    let deckRoom = initial.deckRoom;
    let deckHeight = null;

    //
    // Main traversal.
    //
    while (true) {

        //
        // The value room can be negative and a jump always increases it.
        if (
            slabHeight != null &&
            slabRoom < MAX_SLAB_GAP
        ) {
            ({
                slabRoom,
                slabHeight,
                deckRoom,
                deckHeight
            } = await moveSlabTopToBottom({
                slabRoom,
                slabHeight,
                deckRoom,
                deckHeight
            }, supplier));
        }

        //
        // Either the we find the next slab in the current deck...  
        //
        let nextSlabGeometry = (
            deckHeight != null &&
            slabRoom - deckRoom >= MINIMUM_SLAB_HEIGHT
        )
            ? getNextSlabIn(
                slabRoom,
                deckRoom,
                supplier
            )
            : null;

        //
        // ... or we find the next deck and find the next slab there.
        //
        if (nextSlabGeometry == null) {
            const nextDeckGeometry = await getNextDeckIn(
                deckRoom,
                supplier
            );

            if (nextDeckGeometry == null) {

                break;
            }

            deckRoom = nextDeckGeometry.deckRoom;
            deckHeight = nextDeckGeometry.deckHeight;
            nextSlabGeometry = getNextSlabIn(
                slabRoom,
                deckRoom,
                supplier
            );

            if (!nextSlabGeometry) {
                throw new Error("No slab found in active deck.");
            }
        }

        slabRoom = nextSlabGeometry.slabRoom;
        slabHeight = nextSlabGeometry.slabHeight;

        //
        // // Conceptually, the extraction phase goes here :
        //
        // const type = slabType(current);
        // await waitSlabReady(type, current);
        // extractSlab(type, current);
    }
    // exportMarkdown();

    } catch (error) {

        throw error;
    }
}
