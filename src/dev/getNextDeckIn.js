// getNextDeckIn.js

import { areaAhead } from "./geometry.js";
import {
   MAX_DECK_GAP,
   ADJACENCY_OVERLAP_TOLERANCE
} from "./constants.js";
import {
    beginPendingAwaitDiagnostics,
    finishPendingAwaitDiagnostics,
    recordCycleStageDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";
import {
    contains,
    elementsIn,
    roomAhead
} from "./scrollContainer.js";
import { boundaryOf } from "./boundary.js";

/**
 * Return the next active deck above the current one.
 *
 * deckRoom is the room ahead of the current deck (or, at bootstrap,
 * of the imaginary deck at the trailing edge of the viewport) —
 * the deck-level counterpart of the slab-level room in
 * moveSlabTopToBottom.js's measureRoom().
 */
export async function getNextDeckIn(deckRoom, supplier) {
    const { supplyArea, activeArea } = supplier;
    const { workZone } = supplier;

    const area = areaAhead(
        deckRoom,
        MAX_DECK_GAP
    );

    const decks = getDecks(supplyArea);

    const candidates = decks.filter(candidate => {
        const geometry = deckGeometry(candidate, workZone);
        const intersects = geometry.bottomRoom >= area.top &&
            geometry.room <= area.bottom;
        return intersects;
    });

    const deck = closestDeck(deckRoom, candidates, workZone);

    recordCycleStageDiagnostics("deck-search", {
        deckRoom,
        area,
        deckCount: decks.length,
        first: snapshotElementDiagnostics(decks[0]),
        last: snapshotElementDiagnostics(decks[decks.length - 1]),
        candidates: candidates.map(snapshotElementDiagnostics),
        selected: snapshotElementDiagnostics(deck),
        activation: deck?.getAttribute("data-is-intersecting") ?? null
    });

    if (deck == null) {

        return null;
    }

    const startedAtDiagnostics = performance.now();

    beginPendingAwaitDiagnostics("deck-activation", {
        deck: snapshotElementDiagnostics(deck),
        activation: deck.getAttribute("data-is-intersecting")
    });
    await waitDeckActive(deck, activeArea);
    finishPendingAwaitDiagnostics({
        deck: snapshotElementDiagnostics(deck),
        activation: deck.getAttribute("data-is-intersecting")
    });

    recordCycleStageDiagnostics("deck-active", {
        waitedMs: performance.now() - startedAtDiagnostics,
        deck: snapshotElementDiagnostics(deck),
        activation: deck.getAttribute("data-is-intersecting")
    });

    const geometry = deckGeometry(deck, workZone);
    return {
        deckRoom: geometry.room,
        deckHeight: geometry.height
    };
}

export function getDeckIn(deckRoom, supplier) {
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
    const rect = deck.getBoundingClientRect();
    return {
        room: roomAhead(boundaryOf(deck, "top"), workZone),
        bottomRoom: roomAhead(boundaryOf(deck, "bottom"), workZone),
        height: rect.height
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
