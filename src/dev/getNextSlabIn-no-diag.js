// getNextSlabIn.js

import { areaAhead } from "./geometry-no-diag.js";
import {
   MAX_SLAB_GAP,
   ADJACENCY_OVERLAP_TOLERANCE
} from "./constants-no-diag.js";
import { roomAhead } from "./scrollContainer-no-diag.js";
import { boundaryOf } from "./boundary-no-diag.js";
import { getDeckIn } from "./getNextDeckIn-no-diag.js";

/**
 * Return the slab immediately above the current slab
 * in the current active deck.
 *
 * room is the top coordinate of the current slab.
 */
export function getNextSlabIn(
    slabRoom,
    deckRoom,
    supplier
) {
    const { workZone } = supplier;
    const deck = getDeckIn(deckRoom, supplier);
    if (!deck) throw new Error("No deck found at the current geometry.");

    const area = areaAhead(
        slabRoom,
        MAX_SLAB_GAP
    );

    const slabs = getSlabsIn(deck);

    const candidates = slabs.filter(candidate => {
        const geometry = slabGeometry(candidate, workZone);
        return geometry.bottomRoom >= area.top && geometry.room <= area.bottom;
    });

    const slab = closestSlab(slabRoom, candidates, workZone);

    if (slab == null) return null;
    const geometry = slabGeometry(slab, workZone);
    return {
        slabRoom: geometry.room,
        slabHeight: geometry.height
    };
}

export function getSlabIn(
    slabRoom,
    deckRoom,
    supplier
) {
    const { workZone } = supplier;
    const deck = getDeckIn(deckRoom, supplier);
    if (!deck) return null;
    let selected = null;
    let smallestRoomDifference = Infinity;

    for (const slab of getSlabsIn(deck)) {
        const geometry = slabGeometry(slab, workZone);
        const roomDifference = Math.abs(geometry.room - slabRoom);
        if (roomDifference >= smallestRoomDifference) continue;
        selected = slab;
        smallestRoomDifference = roomDifference;
    }

    return selected;
}

function closestSlab(referenceRoom, candidates, workZone) {
    let selected = null;
    let smallestGap = Infinity;

    for (const candidate of candidates) {
        const gap = referenceRoom - slabGeometry(candidate, workZone).bottomRoom;
        if (gap < -ADJACENCY_OVERLAP_TOLERANCE) continue;
        if (gap >= smallestGap) continue;
        smallestGap = gap;
        selected = candidate;
    }

    return selected;
}

function slabGeometry(slab, workZone) {
    const rect = slab.getBoundingClientRect();
    return {
        room: roomAhead(boundaryOf(slab, "top"), workZone),
        bottomRoom: roomAhead(boundaryOf(slab, "bottom"), workZone),
        height: rect.height
    };
}

/**
 * Return all slabs contained in an active deck.
 *
 * An active deck always contributes at least one slab.
 * Empty active decks contribute one synthetic empty slab.
 */
export function getSlabsIn(deck) {

    const slabs = [];

    //
    // Message slabs
    //
    for (const message of deck.querySelectorAll("[data-message-id]")) {
        slabs.push(message);
    }

    // Image slabs — see ASSUMPTIONS.md A11.
    for (const image of deck.querySelectorAll('.group\\/imagegen-image')) {
        slabs.push(image);
    }

    // Canvas slabs: bare `canvas` can match an inner, still-rendering
    // element (e.g. CodeMirror's own internal canvas) whose geometry
    // keeps changing — see ASSUMPTIONS.md A11.
    for (const canvas of deck.querySelectorAll('[id^="textdoc-message-"]')) {
        slabs.push(canvas);
    }

    //
    // Empty active deck
    //
    if (slabs.length === 0) {
        slabs.push(makeEmptySlab(deck));
    }

    //
    // Traversal order:
    // bottom slab first.
    //
    slabs.sort((a, b) => {

        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();

        return rb.bottom - ra.bottom;
    });

    return slabs;
}

/**
 * Synthetic slab representing an empty active deck.
 *
 * Geometry comes from the deck itself.
 */
function makeEmptySlab(deck) {

    return {

        getBoundingClientRect() {

            const rect = deck.getBoundingClientRect();

            return {
                top: rect.top,
                bottom: rect.top,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: 0
            };
        }
    };
}
