// TEMPORARY: instrumentation for the non-exact-drift investigation.
// Keep this analysis out of moveSlabTopToBottom() and remove this module once the
// relationship between the cursor, visible viewport, and anchoring is known.
import {
    clientHeight,
    scrollHeight,
    scrollY
} from "../scrollContainer.js";

export function captureDriftSnapshot(current, container) {
    const rect = current.getBoundingClientRect();
    const viewportTop = container === document.documentElement
        ? 0
        : container.getBoundingClientRect().top;
    const viewportBottom = viewportTop + clientHeight(container);
    const deck = current.closest?.("[data-turn-id-container]") ?? null;
    const deckRect = deck?.getBoundingClientRect() ?? null;

    return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        intersection: Math.max(
            0,
            Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop)
        ),
        scrollY: scrollY(container),
        scrollHeight: scrollHeight(container),
        deckId: deck?.getAttribute("data-turn-id-container") ?? "none",
        deckReadiness: deck?.getAttribute("data-is-intersecting") ?? "absent",
        deckTop: deckRect?.top ?? null,
        deckBottom: deckRect?.bottom ?? null,
        deckHeight: deckRect?.height ?? null
    };
}

export function describeUnexpectedDrift(
    before,
    after,
    { expectedScrollYAfterJump }
) {
    const lateScrollAdjustment = after.scrollY - expectedScrollYAfterJump;
    const cursorDocumentShift =
        (after.top + after.scrollY) - (before.top + before.scrollY);

    return [
        `cursor=${formatBox(before)}->${formatBox(after)}`,
        `intersection=${format(before.intersection)}->${format(after.intersection)}`,
        `settledScrollDelta=${format(after.scrollY - before.scrollY)}`,
        `lateScrollAdjustment=${format(lateScrollAdjustment)}`,
        `scrollHeightDelta=${format(after.scrollHeight - before.scrollHeight)}`,
        `cursorDocumentShift=${format(cursorDocumentShift)}`,
        `deck=${before.deckId}->${after.deckId}`,
        `deckReadiness=${before.deckReadiness}->${after.deckReadiness}`,
        `deckBox=${formatDeck(before)}->${formatDeck(after)}`
    ].join(", ");
}

function formatBox(snapshot) {
    return `{top:${format(snapshot.top)},bottom:${format(snapshot.bottom)},height:${format(snapshot.height)}}`;
}

function formatDeck(snapshot) {
    return `{top:${format(snapshot.deckTop)},bottom:${format(snapshot.deckBottom)},height:${format(snapshot.deckHeight)}}`;
}

function format(value) {
    return value == null ? "n/a" : Number(value).toFixed(2);
}
