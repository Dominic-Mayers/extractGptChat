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

/**
 * Return the next ready deck above the current one.
 *
 * deckRoom is the room ahead of the current deck (or, at bootstrap,
 * of the imaginary deck at the trailing edge of the viewport) —
 * the deck-level counterpart of the slab-level room in
 * moveWorkZone.js's measureRoom().
 */
export async function nextReadyDeck(deckRoom, container) {

    const area = areaAhead(
        deckRoom,
        MAX_DECK_GAP
    );

    const decks = getDecks();

    const candidates = intersecting(
        area,
        decks
    );

    const containerTop = container && container !== document.documentElement
        ? container.getBoundingClientRect().top
        : 0;
    const insideCount = container
        ? decks.filter(d => container.contains(d)).length
        : decks.length;

    console.log(
        `[nextReadyDeck] deckRoom=${Math.round(deckRoom)}, area={top:${Math.round(area.top)}, bottom:${Math.round(area.bottom)}}, ` +
        `decks.length=${decks.length}, candidates.length=${candidates.length}, ` +
        `containerTop=${Math.round(containerTop)}, insideContainer=${insideCount}/${decks.length}` +
        (decks.length > 0
            ? `, decks[0].rect={top:${Math.round(decks[0].getBoundingClientRect().top)}, bottom:${Math.round(decks[0].getBoundingClientRect().bottom)}}, ` +
              `decks[0].insideContainer=${container ? container.contains(decks[0]) : "n/a"}`
            : "") +
        (decks.length > 1
            ? `, decks[last].rect={top:${Math.round(decks[decks.length - 1].getBoundingClientRect().top)}, bottom:${Math.round(decks[decks.length - 1].getBoundingClientRect().bottom)}}`
            : "")
    );

    const deck = closest(
        deckRoom,
        candidates,
        ADJACENCY_OVERLAP_TOLERANCE
    );

    if (deck == null) {

        if (candidates.length > 0) {
            console.log(
                `[nextReadyDeck] closest() rejected all ${candidates.length} candidate(s): ` +
                candidates.map(c => {
                    const r = c.getBoundingClientRect();
                    return `{top:${Math.round(r.top)}, bottom:${Math.round(r.bottom)}, gap:${deckRoom - r.bottom}}`;
                }).join(", ")
            );
        }

        return null;
    }

    await waitDeckReady(deck);

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
