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
    containerScrollY,
    containerScrollHeight,
    containerClientHeight
} from "./scrollContainer.js";
import {
    MAX_SLAB_GAP,
    MINIMUM_SLAB_HEIGHT
} from "./constants.js";

export async function traverseConversation() {

    const container = findScrollContainer();

    // Establishes the starting position; see ASSUMPTIONS.md A9.
    await moveViewportToBottom(container);

    console.log(
        `[traverseConversation] after moveViewportToBottom: ` +
        `container=${container === document.documentElement ? "window" : container.className}, ` +
        `scrollY=${containerScrollY(container)}, scrollHeight=${containerScrollHeight(container)}, ` +
        `clientHeight=${containerClientHeight(container)}`
    );

    //
    // Initial state.
    //
    // room and deckRoom are parallel quantities: room is the room
    // ahead of the current slab, deckRoom is the room ahead of the
    // current deck. Initializing both to the viewport height is
    // equivalent to introducing an imaginary slab and an imaginary
    // deck whose leading edges coincide with the trailing edge of
    // the viewport — the same geometric condition every subsequent
    // slab and deck is searched under, not a special case.
    //
    let room = containerClientHeight(container);
    let deckRoom = containerClientHeight(container);
    let deck = null;
    let current = null;
    let extremityReached = false;

    let deckCount = 0;
    let slabCount = 0;

    //
    // Main traversal.
    //
    while (true) {

        //
        // See Assumption A4 (Extremity rendering).
        // After the intended extremity has been reached,
        // further viewport movement cannot reveal another
        // ready deck. Skipping moveWorkZone() therefore
        // avoids a useless geometric correction.
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
        // A2 is false (ASSUMPTIONS.md): a small gap alone cannot prove
        // the deck is exhausted — real deck padding can exceed
        // MINIMUM_SLAB_HEIGHT. Only skip nextSlab() when the gap is
        // below the true minimum possible slab height, a sound
        // "definitely no slab fits" shortcut. Otherwise nextSlab()
        // itself is the source of truth.
        //
        let slab = (deck && room - deckRoom >= MINIMUM_SLAB_HEIGHT)
            ? nextSlab(room, deck)
            : null;

        //
        // Current deck (if any) has no more slabs above current:
        // move to the next ready deck.
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
                    `scrollY=${containerScrollY(container)}, room=${Math.round(room)}.`
                );
                break;
            }

            deckCount++;
            deckRoom = deck.getBoundingClientRect().top;
            console.log(
                `[traverseConversation] deck #${deckCount}: deckRoom=${Math.round(deckRoom)}, ` +
                `scrollY=${containerScrollY(container)}`
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
