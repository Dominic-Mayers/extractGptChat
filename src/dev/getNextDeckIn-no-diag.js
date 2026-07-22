// getNextDeckIn.js

import {
   ADJACENCY_OVERLAP_TOLERANCE
} from "./constants-no-diag.js";
import {
    contains,
    elementsIn,
    observeSupplier,
    roomAhead
} from "./scrollContainer-no-diag.js";
import { boundaryOf } from "./boundary-no-diag.js";

export async function getNextDeckRoomIn(area) {
    const supplier = observeSupplier();
    const { supplyArea, activeArea } = supplier;
    const { workZone } = supplier;

    const decks = getDecks(supplyArea);

    const candidates = decks.filter(candidate => {
        const geometry = deckGeometry(candidate, workZone);
        const intersects = geometry.bottomRoom >= area.top &&
            geometry.room <= area.bottom;
        return intersects;
    });

    const deck = closestDeck(area.bottom, candidates, workZone);

    if (deck == null) {

        return null;
    }

    await waitDeckActive(deck, activeArea);

    const geometry = deckGeometry(deck, workZone);
    return geometry.room;
}

export function getDeckIn(deckRoom) {
    const supplier = observeSupplier();
    const { supplyArea, workZone } = supplier;
    let selected = null;
    let smallestRoomDifference = Infinity;

    for (const deck of getDecks(supplyArea)) {
        const geometry = deckGeometry(deck, workZone);
        const roomDifference = Math.abs(geometry.room - deckRoom);
        if (roomDifference >= smallestRoomDifference) continue;
        selected = deck;
        smallestRoomDifference = roomDifference;
    }

    return selected;
}

function closestDeck(referenceRoom, candidates, workZone) {
    let selected = null;
    let smallestGap = Infinity;

    for (const candidate of candidates) {
        const gap = referenceRoom - deckGeometry(candidate, workZone).bottomRoom;
        if (gap < -ADJACENCY_OVERLAP_TOLERANCE) continue;
        if (gap >= smallestGap) continue;
        smallestGap = gap;
        selected = candidate;
    }

    return selected;
}

function deckGeometry(deck, workZone) {
    return {
        room: roomAhead(boundaryOf(deck, "top"), workZone),
        bottomRoom: roomAhead(boundaryOf(deck, "bottom"), workZone)
    };
}

/**
 * Return all deck candidates, regardless of activation (see
 * ASSUMPTIONS.md A10) — activation is checked separately by
 * waitDeckActive(), once a candidate has been found geometrically.
 *
 * Borrowed from extractor-app.js's queryDeckSequenceContainers().
 */
export function getDecks(supplyArea) {

    const byId = new Map();

    for (const el of elementsIn(supplyArea, "[data-turn-id-container]")) {

        const rect = el.getBoundingClientRect();

        if (rect.height === 0) continue;

        const id = el.getAttribute("data-turn-id-container");
        const existing = byId.get(id);

        if (!existing || el.contains(existing)) {
            byId.set(id, el);
        }
    }

    return Array.from(byId.values()).sort((a, b) => {

        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();

        //
        // Bottom deck first.
        //
        return rb.bottom - ra.bottom;
    });
}

/**
 * Return true iff a deck is active — see
 * ASSUMPTIONS.md A3.
 */
function isDeckActive(deck, activeArea) {

    return (
        contains(activeArea, deck) &&
        deck.dataset.isIntersecting !== undefined &&
        deck.dataset.isIntersecting !== "false"
    );
}

/**
 * Wait until a deck becomes active.
 *
 * Activation is determined solely from
 *
 *     data-is-intersecting
 *
 * on the deck itself.
 */
export async function waitDeckActive(
    deck,
    activeArea,
    {
        timeout = 10000,
        poll = 100
    } = {}
) {

    if (isDeckActive(deck, activeArea)) {
        return;
    }

    const deadline = Date.now() + timeout;

    while (!isDeckActive(deck, activeArea)) {

        if (!deck.isConnected) {
            throw new Error(
                "Deck detached while waiting for readiness."
            );
        }

        if (Date.now() >= deadline) {
            throw new Error(
                "Timed out waiting for deck activation."
            );
        }

        await new Promise(resolve =>
            setTimeout(resolve, poll)
        );
    }
}
