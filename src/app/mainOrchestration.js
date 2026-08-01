// mainOrchestration.js

//
// Main geometric traversal.
//
// This file implements only the geometric part of the
// traversal.  Content extraction is intentionally omitted.

import {
    getNextDeckRoomIn
} from "./getNextDeckIn.js";
import {
    moveSlabTopToBottom
} from "./moveSlabTopToBottom.js";
import {
    moveViewportToDocumentBottom
} from "./moveViewportToDocumentBottom.js";
import {
    compileCurrentDeck,
    resetSupplyWorker,
    selectNextSlabRoom,
    waitCurrentSlabReady
} from "./supplyWorker.js";
import {
    extractionSnapshot,
    resetExtraction
} from "./extraction.js";
import {
    MAX_SLAB_GAP,
    MINIMUM_SLAB_HEIGHT
} from "./constants.js";

export async function traverseConversation() {

    resetSupplyWorker();
    resetExtraction();

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
                slabRoom
            ));
        }

        //
        // Either the we find the next slab in the current deck...  
        //
        let nextSlabRoom = (
            deckRoom != null &&
            slabRoom - deckRoom >= MINIMUM_SLAB_HEIGHT
        )
            ? selectNextSlabRoom(
                slabRoom,
                deckRoom
            )
            : null;

        //
        // ... or we find the next deck and find the next slab there.
        //
        if (nextSlabRoom == null) {
            if (deckRoom != null) {
                await compileCurrentDeck();
            }

            const nextDeckRoom = await getNextDeckRoomIn(
                deckRoom ?? initialDeckRoom
            );

            if (nextDeckRoom == null) {

                break;
            }

            deckRoom = nextDeckRoom;
            nextSlabRoom = selectNextSlabRoom(
                slabRoom ?? initialSlabRoom,
                deckRoom
            );

            if (nextSlabRoom == null) {
                throw new Error("No slab found in active deck.");
            }
        }

        ({
            slabRoom: nextSlabRoom,
            deckRoom
        } = await waitCurrentSlabReady());

        slabRoom = nextSlabRoom;

    }
    const snapshot = extractionSnapshot();

    return snapshot;
}
