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

- deck activation (`data-is-intersecting`);
- slab or anchor readiness for the next operation;
- slab readiness for content extraction.

Activation is weaker than readiness. `data-is-intersecting` means that a deck
is active; it does not mean the deck or all content inside it is ready.

Geometry creates the conditions under which these observations eventually
become true, but it does not infer readiness from geometric measurements.

An absent `data-is-intersecting` attribute counts as inactive, the same as an
explicit `"false"`.

## A4. Extremity rendering

The deck-activation mechanism remains valid at the extremities of the
conversation.

Browser clamping is synchronous. After every viewport move, including one
that reaches a conversation extremity, the resulting slab position is used as
the intended room for the subsequent stability check.

## A5. Geometry stability and movement commitment

Work-zone movement currently requires two consecutive unchanged animation-frame
observations when the first inactive deck ahead is within 3000px of the
viewport, and one observation otherwise. The 3000px threshold is experimental
and is intended to increase the chance of observing a multi-frame oscillation
inside one stabilization call.
Work-zone extremity is never cached by the main traversal and is reevaluated on
every move.
A non-extremity jump that stabilizes outside the intended room tolerance is an
error.

There is no separate animation-frame yield or stability wait immediately
before an anchor jump. The first jump uses geometry read synchronously after
anchor selection. Each later jump uses geometry remeasured after the preceding
post-jump stabilization. If that geometry is not usable, the post-jump
stability condition is too weak and must be improved.

The current outer-geometry fingerprint is the scroll container's
`scrollHeight` and scroll position (`scrollY`/`scrollTop`). This fingerprint is
only evidence of momentary quiet. It does not prove that a jump committed, that
an active deck has produced a sufficient ready area, or that a slab or anchor
is ready for its next operation.

ChatGPT can enter a recurring layout-recomputation flicker without any
extractor jump, especially when browser zoom is not 100%. This is an observed
correlation, not yet a causal explanation. Flicker must therefore be modeled as
an independent environmental condition rather than as a consequence of
extractor movement.

The current working hypothesis is a feedback loop between fractional layout,
rounding or quantization, and a mechanism that compensates the viewport to
preserve a reference. This loop may run without the extractor. An rAF does not
move the viewport by itself, but an exact comparison and subpixel correction
made after an rAF can couple the extractor to the loop.

A one-CSS-pixel boundary tolerance normally stops subpixel corrections that
browser quantization cannot apply. It is currently commented out so exact
comparison exposes the rounding loop during the experiment. It must not be
generalized to autonomous flicker, which can occur without extractor
corrections.

Comparable flicker occurs outside ChatGPT. It appears at repeatable locations
but only intermittently, supporting a timing-dependent race with a stable
geometric trigger. Do not assume that ChatGPT's virtualizer alone owns the
failure; browser layout and scroll-position maintenance remain part of the
system under investigation.

A jump whose immediate scroll delta is later erased during such a
recomputation is a lost-jump interaction, not merely slow stabilization. The
responsible mechanism remains an open question; candidates include browser
scroll anchoring, focus or selection restoration, scroll restoration, ChatGPT
virtualizer compensation, and preservation of a visual anchor during relayout.
Diagnostics must compare a no-jump flicker baseline with a jump trial before
attributing the lost movement to one mechanism.

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

## A9. Measured bottom boundary

At the bottom of the conversation, the last deck's bottom edge is not
guaranteed to reach the work zone's own bottom edge — a composer sharing the
scroll container can permanently occupy part of it, even at the browser's
true maximum scroll position. After moving to the literal bottom,
`moveViewportToDocumentBottom()` measures the last deck's bottom edge and returns it as
both initial search boundaries. Traversal therefore starts from actual geometry
instead of moving the viewport to satisfy a fixed `clientHeight` boundary.

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

Image slabs use `.group\/imagegen-image`, not bare `img`, for the same reason.
A generic `img` selector risks matching avatar icons, multiple image elements
inside one generated-image block, or a still-loading placeholder. Any of these
could provide the wrong extraction scope or unstable geometry. The narrower
selector identifies the generated-image slab; readiness and extraction then
resolve its primary visible image separately.
