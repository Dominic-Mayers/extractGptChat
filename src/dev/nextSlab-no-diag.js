// nextSlab.js

import {
    areaAhead,
    intersecting,
    closest
} from "./geometry-no-diag.js";
import {
   MAX_SLAB_GAP,
   ADJACENCY_OVERLAP_TOLERANCE
} from "./constants-no-diag.js";
/**
 * Return the slab immediately above the current slab
 * in the current ready deck.
 *
 * room is the top coordinate of the current slab.
 */
export function nextSlab(room, deck) {

    const area = areaAhead(
        room,
        MAX_SLAB_GAP
    );

    const slabs = getSlabsIn(deck);

    const candidates = intersecting(
        area,
        slabs
    );

    const slab = closest(
        room,
        candidates,
        ADJACENCY_OVERLAP_TOLERANCE
    );

    return slab;
}

/**
 * Return all slabs contained in a ready deck.
 *
 * A ready deck always contributes at least one slab.
 * Empty ready decks contribute one synthetic empty slab.
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
    // Empty ready deck
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
 * Synthetic slab representing an empty ready deck.
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
