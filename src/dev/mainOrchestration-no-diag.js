// mainOrchestration.js
//
// Main geometric traversal.
//
// This file implements only the geometric part of the
// traversal.  Content extraction is intentionally omitted.

import { getNextSlabRoomIn } from "./getNextSlabIn-no-diag.js";
import { getNextDeckRoomIn } from "./getNextDeckIn-no-diag.js";
import { moveSlabTopToBottom } from "./moveSlabTopToBottom-no-diag.js";
import { moveViewportToDocumentBottom } from "./moveViewportToDocumentBottom-no-diag.js";
import { areaAhead } from "./geometry-no-diag.js";
import { resetSupplyWorker } from "./supplyWorker-no-diag.js";
import {
    MAX_DECK_GAP,
    MAX_SLAB_GAP,
    MINIMUM_SLAB_HEIGHT
} from "./constants-no-diag.js";
export async function traverseConversation() {

    resetSupplyWorker();

    // Establishes the measured starting boundary; see ASSUMPTIONS.md A9.
    const initial = await moveViewportToDocumentBottom();

    let slabRoom = null;
    let deckRoom = null;
    const initialSlabRoom = initial.room;
    const initialDeckRoom = initial.deckRoom;

    //
    // Main traversal.
    //
    while (true) {

        //
        // The value room can be negative and a jump always increases it.
        if (
            slabRoom != null &&
            slabRoom < MAX_SLAB_GAP
        ) {
            ({
                slabRoom,
                deckRoom
            } = await moveSlabTopToBottom(
                slabRoom,
                deckRoom
            ));
        }

        //
        // Either the we find the next slab in the current deck...  
        //
        let nextSlabRoom = (
            deckRoom != null &&
            slabRoom - deckRoom >= MINIMUM_SLAB_HEIGHT
        )
            ? getNextSlabRoomIn(
                areaAhead(slabRoom, MAX_SLAB_GAP),
                deckRoom
            )
            : null;

        //
        // ... or we find the next deck and find the next slab there.
        //
        if (nextSlabRoom == null) {
            const nextDeckRoom = await getNextDeckRoomIn(
                areaAhead(deckRoom ?? initialDeckRoom, MAX_DECK_GAP)
            );

            if (nextDeckRoom == null) {

                break;
            }

            deckRoom = nextDeckRoom;
            nextSlabRoom = getNextSlabRoomIn(
                areaAhead(slabRoom ?? initialSlabRoom, MAX_SLAB_GAP),
                deckRoom
            );

            if (nextSlabRoom == null) {
                throw new Error("No slab found in active deck.");
            }
        }

        slabRoom = nextSlabRoom;

        //
        // Conceptually, the extraction phase goes here:
        //
        // const type = slabType(current);
        // await waitSlabReady(type, current);
        // extractSlab(type, current);
    }
    // exportMarkdown();

}
