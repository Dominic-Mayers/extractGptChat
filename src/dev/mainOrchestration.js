// mainOrchestration.js
//
// Main geometric traversal.
//
// This file implements only the geometric part of the
// traversal.  Content extraction is intentionally omitted.

import { getNextSlabIn } from "./getNextSlabIn.js";
import { getNextDeckIn } from "./getNextDeckIn.js";
import { moveSlabTopToBottom } from "./moveSlabTopToBottom.js";
import { moveViewportToDocumentBottom } from "./moveViewportToDocumentBottom.js";
import {
    observeSupplier
} from "./scrollContainer.js";
import {
    MAX_SLAB_GAP,
    MINIMUM_SLAB_HEIGHT
} from "./constants.js";
import {
    resetCycleDiagnostics,
    beginCycleDiagnostics,
    recordCycleStageDiagnostics,
    logCycleContextDiagnostics,
    flushCycleDiagnostics,
    selectCurrentJumpDiagnostics,
    snapshotSupplierDiagnostics
} from "./cycleDiagnostics.js";

export async function traverseConversation() {

    resetCycleDiagnostics();

    try {

    const supplier = observeSupplier();
    const { workZone } = supplier;

    // Establishes the measured starting boundary; see ASSUMPTIONS.md A9.
    const initial = await moveViewportToDocumentBottom(supplier);

    let slabRoom = initial.room;
    let slabHeight = null;
    let deckRoom = initial.deckRoom;
    let deckHeight = null;
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
            ...snapshotSupplierDiagnostics(supplier.supplyArea, workZone),
            clientHeight: workZone.height,
            slabHeight,
            deckHeight
        });

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
        } else {
            recordCycleStageDiagnostics("move-skip", {
                room: slabRoom
            });
        }

        recordCycleStageDiagnostics("deck-room", {
            deckRoom,
            deckHeight
        });

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

        recordCycleStageDiagnostics("deck-decision", {
            room: slabRoom,
            deckRoom,
            available: slabRoom - deckRoom,
            minimum: MINIMUM_SLAB_HEIGHT,
            needsDeck: nextSlabGeometry == null
        });

        //
        // ... or we find the next deck and find the next slab there.
        //
        if (nextSlabGeometry == null) {
            const nextDeckGeometry = await getNextDeckIn(
                deckRoom,
                supplier
            );

            if (nextDeckGeometry == null) {
                recordCycleStageDiagnostics("stop", {
                    reason: "no-next-deck"
                });
                break;
            }

            deckCountDiagnostics++;
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

        slabCountDiagnostics++;

        slabRoom = nextSlabGeometry.slabRoom;
        slabHeight = nextSlabGeometry.slabHeight;

        recordCycleStageDiagnostics("selected", {
            slabCount: slabCountDiagnostics,
            deckCount: deckCountDiagnostics,
            room: slabRoom,
            slabHeight,
            deckRoom,
            deckHeight
        });


        //
        // // Conceptually, the extraction phase goes here :
        //
        // const type = slabType(current);
        // await waitSlabReady(type, current);
        // extractSlab(type, current);
    }
    // exportMarkdown();
    flushCycleDiagnostics();

    } catch (error) {
        selectCurrentJumpDiagnostics("error");
        recordCycleStageDiagnostics("error", {
            name: error.name,
            message: error.message
        });
        logCycleContextDiagnostics();
        throw error;
    }
}
