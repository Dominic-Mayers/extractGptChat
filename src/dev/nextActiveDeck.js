// nextActiveDeck.js

import {
    areaAhead,
    intersecting,
    closest
} from "./geometry.js";
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
import { contains, elementsIn } from "./scrollContainer.js";

/**
 * Return the next active deck above the current one.
 *
 * deckRoom is the room ahead of the current deck (or, at bootstrap,
 * of the imaginary deck at the trailing edge of the viewport) —
 * the deck-level counterpart of the slab-level room in
 * moveSlabTopToBottom.js's measureRoom().
 */
export async function nextActiveDeck(deckRoom, currentDeck, supplier) {
    const { supplyArea, activeArea } = supplier;

    const area = areaAhead(
        deckRoom,
        MAX_DECK_GAP
    );

    const decks = getDecks(supplyArea);

    const candidates = intersecting(
        area,
        decks
    ).filter(candidate => candidate !== currentDeck);

    const deck = closest(
        deckRoom,
        candidates,
        ADJACENCY_OVERLAP_TOLERANCE
    );

    recordCycleStageDiagnostics("deck-search", {
        deckRoom,
        area,
        deckCount: decks.length,
        first: snapshotElementDiagnostics(decks[0]),
        last: snapshotElementDiagnostics(decks[decks.length - 1]),
        candidates: candidates.map(snapshotElementDiagnostics),
        excludedCurrent: snapshotElementDiagnostics(currentDeck),
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

    return deck;
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

        if (rect.width === 0 && rect.height === 0) continue;

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
