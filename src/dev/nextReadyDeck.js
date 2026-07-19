// nextReadyDeck.js

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

/**
 * Return the next ready deck above the current one.
 *
 * deckRoom is the room ahead of the current deck (or, at bootstrap,
 * of the imaginary deck at the trailing edge of the viewport) —
 * the deck-level counterpart of the slab-level room in
 * moveSlabTopToBottom.js's measureRoom().
 */
export async function nextReadyDeck(deckRoom, currentDeck = null) {

    const area = areaAhead(
        deckRoom,
        MAX_DECK_GAP
    );

    const decks = getDecks();

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
        readiness: deck?.getAttribute("data-is-intersecting") ?? null
    });

    if (deck == null) {

        return null;
    }

    const startedAtDiagnostics = performance.now();

    beginPendingAwaitDiagnostics("deck-readiness", {
        deck: snapshotElementDiagnostics(deck),
        readiness: deck.getAttribute("data-is-intersecting")
    });
    await waitDeckReady(deck);
    finishPendingAwaitDiagnostics({
        deck: snapshotElementDiagnostics(deck),
        readiness: deck.getAttribute("data-is-intersecting")
    });

    recordCycleStageDiagnostics("deck-ready", {
        waitedMs: performance.now() - startedAtDiagnostics,
        deck: snapshotElementDiagnostics(deck),
        readiness: deck.getAttribute("data-is-intersecting")
    });

    return deck;
}


/**
 * Return all deck candidates, regardless of readiness (see
 * ASSUMPTIONS.md A10) — readiness is checked separately by
 * waitDeckReady(), once a candidate has been found geometrically.
 *
 * Borrowed from extractor-app.js's queryDeckSequenceContainers().
 */
export function getDecks() {

    const byId = new Map();

    for (const el of document.querySelectorAll("[data-turn-id-container]")) {

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
 * Return true iff a deck is geometrically ready — see
 * ASSUMPTIONS.md A3.
 */
function isDeckReady(deck) {

    return (
        deck.dataset.isIntersecting !== undefined &&
        deck.dataset.isIntersecting !== "false"
    );
}


/**
 * Wait until a deck becomes geometrically ready.
 *
 * Readiness is determined solely from
 *
 *     data-is-intersecting
 *
 * on the deck itself.
 */
export async function waitDeckReady(
    deck,
    {
        timeout = 10000,
        poll = 100
    } = {}
) {

    if (isDeckReady(deck)) {
        return;
    }

    const deadline = Date.now() + timeout;

    while (!isDeckReady(deck)) {

        if (!deck.isConnected) {
            throw new Error(
                "Deck detached while waiting for readiness."
            );
        }

        if (Date.now() >= deadline) {
            throw new Error(
                "Timed out waiting for deck readiness."
            );
        }

        await new Promise(resolve =>
            setTimeout(resolve, poll)
        );
    }
}
