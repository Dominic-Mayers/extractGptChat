// mainOrchestration.js
//
// Main geometric traversal.
//
// This file implements only the geometric part of the
// traversal.  Content extraction is intentionally omitted.

import { getNextSlabRoomIn } from "./getNextSlabIn.js";
import { getNextDeckRoomIn } from "./getNextDeckIn.js";
import { moveSlabTopToBottom } from "./moveSlabTopToBottom.js";
import { moveViewportToDocumentBottom } from "./moveViewportToDocumentBottom.js";
import { areaAhead } from "./geometry.js";
import { resetSupplyWorker } from "./supplyWorker.js";
import {
    MAX_DECK_GAP,
    MAX_SLAB_GAP,
    MINIMUM_SLAB_HEIGHT
} from "./constants.js";
import {
    resetCycleDiagnostics,
    beginCycleDiagnostics,
    recordCycleStageDiagnostics,
    flushCycleDiagnostics
} from "./cycleDiagnostics.js";

export async function traverseConversation() {

    resetCycleDiagnostics();

    resetSupplyWorker();

    // Establishes the measured starting boundary; see ASSUMPTIONS.md A9.
    const initial = await moveViewportToDocumentBottom();

    let slabRoom = null;
    let deckRoom = null;
    const initialSlabRoom = initial.room;
    const initialDeckRoom = initial.deckRoom;
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
            room: slabRoom,
            deckRoom,
            initialSlabRoom,
            initialDeckRoom
        });

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
        } else {
            recordCycleStageDiagnostics("move-skip", {
                room: slabRoom
            });
        }

        recordCycleStageDiagnostics("deck-room", {
            deckRoom
        });

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

        recordCycleStageDiagnostics("deck-decision", {
            room: slabRoom,
            deckRoom,
            available: slabRoom - deckRoom,
            minimum: MINIMUM_SLAB_HEIGHT,
            needsDeck: nextSlabRoom == null
        });

        //
        // ... or we find the next deck and find the next slab there.
        //
        if (nextSlabRoom == null) {
            const nextDeckRoom = await getNextDeckRoomIn(
                areaAhead(deckRoom ?? initialDeckRoom, MAX_DECK_GAP)
            );

            if (nextDeckRoom == null) {
                recordCycleStageDiagnostics("stop", {
                    reason: "no-next-deck"
                });
                break;
            }

            deckCountDiagnostics++;
            deckRoom = nextDeckRoom;
            nextSlabRoom = getNextSlabRoomIn(
                areaAhead(slabRoom ?? initialSlabRoom, MAX_SLAB_GAP),
                deckRoom
            );

            if (nextSlabRoom == null) {
                throw new Error("No slab found in active deck.");
            }
        }

        slabCountDiagnostics++;

        slabRoom = nextSlabRoom;

        recordCycleStageDiagnostics("selected", {
            slabCount: slabCountDiagnostics,
            deckCount: deckCountDiagnostics,
            room: slabRoom,
            deckRoom
        });

    }
    // exportMarkdown();
    flushCycleDiagnostics();
}
