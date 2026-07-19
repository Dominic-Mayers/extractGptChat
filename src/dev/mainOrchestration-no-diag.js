// mainOrchestration.js
//
// Main geometric traversal.
//
// This file implements only the geometric part of the
// traversal.  Content extraction is intentionally omitted.

import { nextSlab } from "./nextSlab-no-diag.js";
import { nextReadyDeck } from "./nextReadyDeck-no-diag.js";
import { moveSlabTopToBottom } from "./moveSlabTopToBottom-no-diag.js";
import { moveViewportToDocumentBottom } from "./moveViewportToDocumentBottom-no-diag.js";
import {
    findScrollContainer,
    scrollY,
    scrollHeight,
    clientHeight
} from "./scrollContainer-no-diag.js";
import {
    MAX_SLAB_GAP,
    MINIMUM_SLAB_HEIGHT
} from "./constants-no-diag.js";
export async function traverseConversation() {

    try {

    const container = findScrollContainer();

    // Establishes the measured starting boundary; see ASSUMPTIONS.md A9.
    const initial = await moveViewportToDocumentBottom(container);

    let room = initial.room;
    let deckRoom = initial.deckRoom;
    let deck = null;
    let current = null;

    //
    // Main traversal.
    //
    while (true) {

        //
        // The value room can be negative and a jump always increases it.
        if (
            current &&
            room < MAX_SLAB_GAP
        ) {
            room = await moveSlabTopToBottom(current, container);
        }

        // See ASSUMPTIONS.md A8.
        if (deck) {
            deckRoom = deck.getBoundingClientRect().top;
        }

        //
        // Either the we find the next slab in the current deck...  
        //
        let slab = (deck && room - deckRoom >= MINIMUM_SLAB_HEIGHT)
            ? nextSlab(room, deck)
            : null;

        //
        // ... or we find the next deck and find the next slab there.
        //
        if (slab == null) {
            deck = await nextReadyDeck(deckRoom, deck);

            if (deck == null) {

                break;
            }

            deckRoom = deck.getBoundingClientRect().top;
            slab = nextSlab(room, deck);

            if (!slab) throw new Error("No slab found in ready deck.");
        }

        current = slab;

        room = current.getBoundingClientRect().top;

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
