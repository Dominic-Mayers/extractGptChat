// moveViewportToDocumentBottom.js
//
// Initialization step: establish the traversal's starting
// position at the true bottom of the conversation — see
// ASSUMPTIONS.md A9.

import { waitLayoutStable } from "./stabilize-no-diag.js";
import {
    scrollHeight,
    scrollTo,
    clientHeight
} from "./scrollContainer-no-diag.js";
import { getDecks } from "./nextReadyDeck-no-diag.js";

/**
 * Move the viewport to the bottom of the conversation.
 *
 * 1. Best-effort click on the last prompt-navigation dot.
 * 2. Wait for the layout to settle.
 * 3. Move to the literal end of the container.
 * 4. Wait for the layout to settle again.
 * 5. Use the bottom-most deck's measured bottom edge as the initial
 *    slab/deck search boundary (A9).
 */
export async function moveViewportToDocumentBottom(container) {

    clickBottomNavItem();

    await waitLayoutStable(container);

    scrollTo(container, scrollHeight(container));

    await waitLayoutStable(container);

    const decks = getDecks();

    const boundary = decks.length > 0
        ? decks[0].getBoundingClientRect().bottom
        : clientHeight(container);

    return {
        room: boundary,
        deckRoom: boundary
    };
}

/**
 * Click the last prompt-navigation dot, if any exist.
 *
 * Best-effort only: it is not the source of the guarantee that
 * the viewport ends up at the bottom — the absolute scrollTo() is.
 */
export function clickBottomNavItem() {

    const items = getNavMenuItems();

    if (items.length > 0) {
        items[items.length - 1].click();
    }
}

/**
 * Return the ordered array of prompt navigation dot buttons.
 *
 * Structural observation, borrowed from the existing
 * implementation (extractor-app.js getNavMenuItems()).
 *
 * Primary: look inside the narrow vertical strip
 * (div.w-9.max-h-[50lvh].no-scrollbar).
 * Fallback: match by button class (h-0.5 w-4.5 rounded-full).
 */
export function getNavMenuItems() {

    const strip = [...document.querySelectorAll("div")]
        .find(d =>
            d.className.includes("w-9") &&
            d.className.includes("max-h-[50lvh]") &&
            d.className.includes("no-scrollbar")
        );

    if (strip) {
        return [...strip.querySelectorAll("button")];
    }

    return [...document.querySelectorAll("button")]
        .filter(b =>
            b.className.includes("h-0.5") &&
            b.className.includes("w-4.5") &&
            b.className.includes("rounded-full")
        );
}
