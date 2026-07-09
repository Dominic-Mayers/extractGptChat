// moveViewportToBottom.js
//
// Initialization step: establish the traversal's starting
// position at the true bottom of the conversation — see
// ASSUMPTIONS.md A9.

import { moveWorkZone, waitLayoutStable } from "./moveWorkZone.js";
import {
    containerScrollHeight,
    containerScrollTo,
    containerScrollBy,
    containerClientHeight
} from "./scrollContainer.js";
import { getDecks } from "./nextReadyDeck.js";

/**
 * Move the viewport to the bottom of the conversation.
 *
 * 1. Best-effort click on the last prompt-navigation dot.
 * 2. Wait for the layout to settle.
 * 3. Find the last user slab.
 * 4. moveWorkZone(+1) on it, so the assistant reply following it
 *    enters the rendering region.
 * 5. Wait for the layout to settle again.
 * 6. Move to the literal end of the container.
 * 7. Align the bottom-most deck's bottom edge exactly with the
 *    work zone's bottom edge (A9) — a single exact computation,
 *    not a calibrated/iterative jump, since the deck is already
 *    rendered and stable by this point.
 */
export async function moveViewportToBottom(container) {

    clickBottomNavItem();

    await waitLayoutStable(container);

    const current = lastUserSlab();

    if (current) {

        await moveWorkZone(current, container, 1);

        await waitLayoutStable(container);
    }

    containerScrollTo(container, containerScrollHeight(container));

    await waitLayoutStable(container);

    const decks = getDecks();

    if (decks.length > 0) {

        const viewportHeight = containerClientHeight(container);
        const deckBottom = decks[0].getBoundingClientRect().bottom;
        const delta = deckBottom - viewportHeight;

        console.log(
            `[moveViewportToBottom] aligning: deckBottom=${Math.round(deckBottom)}, ` +
            `viewportHeight=${Math.round(viewportHeight)}, delta=${Math.round(delta)}`
        );

        containerScrollBy(container, delta);

        await waitLayoutStable(container);
    }
}

/**
 * Click the last prompt-navigation dot, if any exist.
 *
 * Best-effort only: it is not the source of the guarantee that
 * the viewport ends up at the bottom — moveWorkZone() and the
 * final scrollTo() are.
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

/**
 * Return the last user-authored slab currently in the DOM.
 *
 * Structural observation: [data-message-author-role="user"] is
 * ChatGPT's own attribute for a user message.
 */
export function lastUserSlab() {

    const userSlabs = document.querySelectorAll(
        '[data-message-author-role="user"]'
    );

    return userSlabs.length > 0
        ? userSlabs[userSlabs.length - 1]
        : null;
}
