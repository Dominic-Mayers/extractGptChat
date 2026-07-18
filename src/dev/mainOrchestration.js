// mainOrchestration.js
//
// Main geometric traversal.
//
// This file implements only the geometric part of the
// traversal.  Content extraction is intentionally omitted.

import { nextSlab } from "./nextSlab.js";
import { nextReadyDeck } from "./nextReadyDeck.js";
import { moveSlabTopToBottom } from "./moveSlabTopToBottom.js";
import { moveViewportToDocumentBottom } from "./moveViewportToDocumentBottom.js";
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
import {
    resetCycleDiagnostics,
    beginCycleDiagnostics,
    recordCycleStageDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function traverseConversation() {

    resetCycleDiagnostics();

    try {

    const container = findScrollContainer();

    // Establishes the measured starting boundary; see ASSUMPTIONS.md A9.
    const initial = await moveViewportToDocumentBottom(container);

    let room = initial.room;
    let deckRoom = initial.deckRoom;
    let deck = null;
    let current = null;
    let deckCountDiagnostics = 0;
    let slabCountDiagnostics = 0;
    let cycleCountDiagnostics = 0;

    //
    // Main traversal.
    //
    while (true) {

        cycleCountDiagnostics++;
        beginCycleDiagnostics({
            cycle: cycleCountDiagnostics,
            deckCount: deckCountDiagnostics,
            slabCount: slabCountDiagnostics,
            room,
            deckRoom,
            scrollY: scrollY(container),
            scrollHeight: scrollHeight(container),
            clientHeight: clientHeight(container),
            current: snapshotElementDiagnostics(current),
            deck: snapshotElementDiagnostics(deck)
        });

        //
        // The value room can be negative and a jump always increases it.
        if (
            current &&
            room < MAX_SLAB_GAP
        ) {
            room = await moveSlabTopToBottom(current, container);
        } else {
            recordCycleStageDiagnostics("move-skip", {
                current: snapshotElementDiagnostics(current),
                room
            });
        }

        // See ASSUMPTIONS.md A8.
        if (deck) {
            deckRoom = deck.getBoundingClientRect().top;
        }

        recordCycleStageDiagnostics("deck-room", {
            deckRoom,
            deck: snapshotElementDiagnostics(deck)
        });

        //
        // Either the we find the next slab in the current deck...  
        //
        let slab = (deck && room - deckRoom >= MINIMUM_SLAB_HEIGHT)
            ? nextSlab(room, deck)
            : null;

        recordCycleStageDiagnostics("deck-decision", {
            room,
            deckRoom,
            available: room - deckRoom,
            minimum: MINIMUM_SLAB_HEIGHT,
            needsDeck: slab == null
        });

        //
        // ... or we find the next deck and find the next slab there.
        //
        if (slab == null) {
            deck = await nextReadyDeck(deckRoom);

            if (deck == null) {
                recordCycleStageDiagnostics("stop", {
                    reason: "no-next-deck"
                });
                break;
            }

            deckCountDiagnostics++;
            deckRoom = deck.getBoundingClientRect().top;
            slab = nextSlab(room, deck);

            if (!slab) throw new Error("No slab found in ready deck.");
        }

        current = slab;
        slabCountDiagnostics++;

        room = current.getBoundingClientRect().top;

        recordCycleStageDiagnostics("selected", {
            slabCount: slabCountDiagnostics,
            deckCount: deckCountDiagnostics,
            room,
            slab: snapshotElementDiagnostics(current),
            deck: snapshotElementDiagnostics(deck)
        });


        //
        // // Conceptually, the extraction phase goes here :
        //
        // const type = slabType(current);
        // await waitSlabReady(type, current);
        // extractSlab(type, current);
    }
    // exportMarkdown();

    } catch (error) {
        recordCycleStageDiagnostics("error", {
            name: error.name,
            message: error.message
        });
        throw error;
    }
}
