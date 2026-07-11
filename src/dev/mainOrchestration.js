// mainOrchestration.js
//
// Main geometric traversal.
//
// This file implements only the geometric part of the
// traversal.  Content extraction is intentionally omitted.

import { nextSlab } from "./nextSlab.js";
import { nextReadyDeck } from "./nextReadyDeck.js";
import { moveWorkZone } from "./moveWorkZone.js";
import { moveViewportToBottom } from "./moveViewportToBottom.js";
import {
    findScrollContainer,
    scrollY,
    scrollHeight,
    clientHeight
} from "./scrollContainer.js";
import {
    MAX_SLAB_GAP,
    MINIMUM_SLAB_HEIGHT
} from "./constants.js";
import { resetStop, isEarlyStopRequestedByUser } from "./stopControl.js";

export async function traverseConversation() {

    // A stale request from a previous, already-finished run must not
    // abort this new one before it starts.
    resetStop();

    const container = findScrollContainer();

    // Establishes the starting position; see ASSUMPTIONS.md A9.
    await moveViewportToBottom(container);

    console.log(
        `[traverseConversation] after moveViewportToBottom: ` +
        `container=${container === document.documentElement ? "window" : container.className}, ` +
        `scrollY=${scrollY(container)}, scrollHeight=${scrollHeight(container)}, ` +
        `clientHeight=${clientHeight(container)}`
    );

    //
    // Initial state.
    //
    // room and deckRoom are parallel quantities: room is the room
    // ahead of the current slab, deckRoom is the room ahead of the
    // current deck. Initializing both to the viewport height is
    // equivalent to introducing an imaginary slab and an imaginary
    // deck whose leading edges coincide with the trailing edge of
    // the viewport.
    //
    let room = clientHeight(container);
    let deckRoom = clientHeight(container);
    let deck = null;
    let current = null;
    let extremityReached = false;

    let deckCount = 0;
    let slabCount = 0;

    //
    // Main traversal.
    //
    while (true) {

        if (isEarlyStopRequestedByUser()) {
            console.log(
                `[traverseConversation] stopped by user request after ${deckCount} deck(s), ` +
                `${slabCount} slab(s). scrollY=${scrollY(container)}.`
            );
            return;
        }

        //
        // The value room can be negative and a jump always increases it.
        // Regarding extremityReached, see Assumption A4 (Extremity rendering).
        //
        if (
            current &&
            room < MAX_SLAB_GAP &&
            !extremityReached
        ) {
            ({ room, extremityReached } = await moveWorkZone(current, container));
            console.log(
                `[traverseConversation] after moveWorkZone: room=${Math.round(room)}, ` +
                `extremityReached=${extremityReached}`
            );
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

            deck = await nextReadyDeck(
                deckRoom,
                container
            );

            if (deck == null) {
                console.log(
                    `[traverseConversation] nextReadyDeck(deckRoom=${Math.round(deckRoom)}) ` +
                    `returned null after ${deckCount} deck(s), ${slabCount} slab(s). ` +
                    `scrollY=${scrollY(container)}, room=${Math.round(room)}.`
                );
                break;
            }

            deckCount++;
            deckRoom = deck.getBoundingClientRect().top;
            console.log(
                `[traverseConversation] deck #${deckCount}: deckRoom=${Math.round(deckRoom)}, ` +
                `scrollY=${scrollY(container)}`
            );

            slab = nextSlab(room, deck);

            if (!slab) throw new Error("No slab found in ready deck.");
        }

        current = slab;
        slabCount++;

        room = current.getBoundingClientRect().top;

        console.log(
            `[traverseConversation] slab #${slabCount} (${current.dataset?.slabType}): ` +
            `room=${Math.round(room)}`
        );


        //
        // Extraction phase.
        //
        // const type = slabType(current);
        // await waitSlabReady(type, current);
        // extractSlab(type, current);
    }
    console.log(
        `[traverseConversation] done: ${deckCount} deck(s), ${slabCount} slab(s) visited.`
    );
    // exportMarkdown();
}
