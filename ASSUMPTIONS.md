# Assumptions

The conversation traversal relies on the following assumptions about the
ChatGPT interface. Whenever possible, code comments should refer to these
assumptions rather than restating them.

## A1. Maximum slab gap

The vertical gap between two adjacent slabs never exceeds `MAX_SLAB_GAP`.

This assumption is used to:

- search for the next slab;
- bound the expected room after advancing to the next slab.

## A2. Last slab top margin — FALSE, do not rely on this

Originally: the top margin above the last slab of a deck is smaller than
`MINIMUM_SLAB_HEIGHT`, usable to positively conclude "no slab exists above
current" from gap size alone.

Falsified directly: a deck's top margin was observed at 101px, above
`MINIMUM_SLAB_HEIGHT=90` — while a real slab can genuinely be as short as
90px. The two ranges overlap, so no threshold value can distinguish
"padding only" from "padding plus a short slab" by size alone.

What actually holds, and replaces this: `MINIMUM_SLAB_HEIGHT` is still true
in one direction only — a gap smaller than it *cannot* contain a slab, since
no real slab is shorter. That's a sound "definitely not" shortcut, not a
"definitely is" conclusion. The traversal now trusts `nextSlab()`'s own
result as the source of truth for "does this deck have more slabs," and
only skips calling it when the sound shortcut already guarantees the
answer would be no.

## A3. Separation of responsibilities

The traversal is based on three complementary mechanisms.

### Geometry

Geometry is responsible solely for:

- activating deck rendering by moving the viewport;
- preventing virtualization until rendered content has become ready for
  extraction and has been extracted.

Geometry never determines whether content is ready for extraction.

### Structure

Structure describes the organization of the conversation and therefore what
can be expected next (decks, slabs, slab types, ordering, etc.).

### Readiness observations

Readiness observations determine when the expected objects are ready for use.

Examples include:

- deck readiness (`data-is-intersecting`);
- slab readiness for content extraction.

Geometry creates the conditions under which these observations eventually
become true, but it does not infer readiness from geometric measurements.

An absent `data-is-intersecting` attribute counts as not-ready, the same as
an explicit `"false"`.

## A4. Extremity rendering

The deck-readiness mechanism remains valid at the extremities of the
conversation.

Consequently, once an intended viewport move reaches a conversation
extremity, a remaining positioning error bounded by `MAX_DRIFT` cannot
prevent the final required deck from becoming ready.

The geometry layer therefore considers the intended extremity sufficient and
does not attempt to eliminate the remaining tolerated drift.

## A5. Stable geometry

Geometry is considered stable when the geometry fingerprint remains unchanged
for three consecutive animation-frame observations.

The fingerprint is the scroll container's `scrollHeight`, `document.body`'s
`scrollWidth`, and the scroll container's scroll position (`scrollY`/
`scrollTop`).

## A6. Scroll container

The conversation does not necessarily scroll the window — ChatGPT may scroll
a nested element instead (`overflow-y: auto`/`scroll`). `findScrollContainer()`
locates the real scrolling ancestor; the result is threaded through every
function that reads or writes scroll position.

Open question: `getBoundingClientRect()` is always viewport-relative, not
container-relative. A nonzero container offset within the viewport (e.g. a
header above it) would require correcting for this; not yet observed as
necessary.

## A7. Adjacency overlap tolerance

Adjacent decks or slabs may be exactly flush, or overlap by a sub-pixel
amount, not just have a gap. `closest()` treats a gap down to
`-ADJACENCY_OVERLAP_TOLERANCE` as still adjacent.

## A8. Geometry is read fresh, never cached across a scroll

A position derived from `getBoundingClientRect()` is valid only until the
next scroll. `room`/`deckTop` are remeasured immediately before each use,
never reused from an earlier point in the traversal.

## A9. Work-zone bottom alignment

At the bottom of the conversation, the last deck's bottom edge is not
guaranteed to reach the work zone's own bottom edge — a composer sharing the
scroll container can permanently occupy part of it, even at the browser's
true maximum scroll position. `moveViewportToBottom()` aligns the last deck's
bottom edge exactly with the work zone's bottom edge, which the traversal's
initial `deckTop` placeholder assumes.

## A10. Deck identity

A deck is identified by `data-turn-id-container`. The same ID can appear on
more than one element — an outer wrapper and an inner duplicate — in which
case the outer one (the one that contains the other) is the deck.

## A11. Slab image/canvas selectors

Canvas slabs use `[id^="textdoc-message-"]`, not bare `canvas` — confirmed
necessary: a bare `canvas` tag can match an inner, still-rendering element
(e.g. CodeMirror's own internal canvas), whose geometry keeps changing after
the deck itself is ready and produces large, unexplained drift while it's
`current`.

Open question, unresolved: image slabs still use the bare `img` tag rather
than the existing implementation's narrower `.group/imagegen-image`. Same
class of risk, not yet confirmed one way or the other.
