# Architecture

This extractor works against ChatGPT's live, virtualized DOM. The DOM is not the transcript: it is the observable surface through which ChatGPT's own lazy-loading and rendering systems expose transcript content.

In that analogy, a foreman builds a walkway from slabs while a supplier exposes only the currently available materials and measurements. The supplied material has attached notes that the foreman uses to determine what will be available later (selectors) and is now available (fingerprints). It illustrates several essential constraints:

- the extractor has only partial, changing information;
- transcript content is assembled slab by slab;
- the work zone can only move to area for which the needed slabs are available;
- the work zone activates what ChatGPT renders; an area larger than the work zone is covered;
- selectors and fingerprints are evidence that guide the foreman.

The architecture separates five concepts that are easy to confuse in code:

1. **Environment Boundary**
2. **Traversal Core**
3. **Work Zone**
4. **Decks**
5. **Slabs**

The core extraction abstraction is an iterator over slabs:

```text
bootstrap first slab → repeatedly resolve next slab → extract
```

Internally, resolving the next slab may reuse the current ready deck or move the work zone to an adjacent deck and wait for that deck to become ready.

The current slab cursor and deck geometry determine successor order. 

## Environment Boundary

The environment boundary is the adapter boundary over ChatGPT's DOM and rendering systems. It is the source of currently observable facts: mounted decks, slab candidates, measurements, and readiness fingerprints.

The environment boundary does not provide a complete stable map of the conversation and cannot predict when additional DOM material will arrive. It only exposes the current observable surface. Selectors describe which exposed elements may be candidates. Readiness fingerprints describe whether an already-selected candidate is ready enough to use.


## Work Zone

The work zone is the activation window where ChatGPT's rendering systems can prepare deck regions.

ChatGPT's lazy-loading and rendering systems react to deck regions entering this work zone. The extractor can move the work zone by scrolling, but it does not directly control those systems.

The extractor assumes that ChatGPT's rendering workers are not reliable under a single large scripted jump of the work zone. ChatGPT's rendering pipeline appears to be designed around ordinary incremental scrolling: each newly exposed region gets a chance to mount, measure, and trigger its own readiness work before the next region is exposed. A large jump can land the work zone inside territory whose intermediate decks were never properly activated, leaving both the extractor and ChatGPT's own virtualizer with an incomplete observable surface.

This applies specifically to the extractor's ordinary scripted scrolling (`scrollTop` / `scrollTo`). It should not be confused with ChatGPT or browser navigation paths such as clicking a conversation navigation item or using the scrollbar. Those actions may use different anchoring or reconstruction behavior. They are different environment operations, not merely the same work-zone movement with a larger distance.

For that reason, work-zone movement is modeled as a sequence of small jumps. After each jump, the extractor waits for local stability before taking the next measurements. Browser/layout stability is necessary but not sufficient: diagnostics such as a sandwiched-empty slab mean the browser frame has settled while ChatGPT-level slab readiness has not. Such a case is a readiness failure signal, not proof that the deck is truly empty.

The work zone provides:

- visible top and bottom boundaries;
- scroll position;
- direction of travel;
- the geometric condition that can trigger ChatGPT's own observers.

The work zone is not transcript truth. It only helps activate decks.

## Traversal Core

The traversal core is the extractor logic that turns current observations into an ordered transcript.

It asks the environment boundary questions such as:

- Which deck is visible at the work-zone edge?
- Which deck is adjacent to the current deck?
- Is this deck ready?
- Which slabs are selected inside this ready deck?
- Is this slab ready?
- How should this ready slab be serialized?

The traversal core builds the exported transcript from slabs. It does not need to model the hidden conversation or the full DOM realization behind the environment boundary.

Its memory is intentionally narrow:

- the current ready deck;
- the current slab cursor;
- the transcript already assembled.

It may use evidence from earlier DOM states, but it does not keep a complete map of every deck or slab previously observed.

## Decks

A deck is a traversal region exposed through the environment boundary. In the current DOM adapter, deck sequencing uses the outer element carrying `[data-turn-id-container]`.

The outer deck container is the element used to find the next deck by geometry. Once a deck is selected and ready, slab discovery inside that deck may inspect descendants such as `[data-turn]`, `[data-turn-id]`, and `[data-message-author-role]`. Those descendant elements help identify slabs; they are not a prerequisite for recognizing that the outer container exists in the deck sequence.

Deck properties:

- **Identity**: usually `data-turn-id-container`.
- **Geometry**: the outer deck sequence container's rectangle.
- **Adjacency**: neighboring decks are found geometrically, not by DOM siblings.
- **Readiness**: deck-level fingerprints such as `data-is-intersecting`.
- **Membership**: slabs are discovered inside or geometrically within a ready deck.

Deck rectangles form a strict geometric partition. Consecutive outer deck
rectangles must meet at the same facing edge, allowing only a tiny tolerance
for fractional layout coordinates. A visible gap or overlap is a model
violation, not ordinary deck spacing.

Every ready deck is also nonempty: before leaving it, at least one slab must
have been selected and extracted from it. A ready deck with zero extracted
slabs is therefore a fatal selector/extraction failure, even when its outer
geometry remains perfectly contiguous with neighboring decks.

Deck readiness is a property of the deck observation, not of the environment boundary itself. The code first chooses a deck by sequence geometry, then waits for that deck's readiness fingerprint before trusting slab discovery inside it.

Bootstrap exists to establish the slab-iterator invariant:

```text
choose edge-visible deck → wait for deck readiness → find first slab inside it → extract first slab
```

After bootstrap, the iterator has:

- a current ready deck;
- a current slab cursor;

The next slab is selected without passing the current deck: the traversal core queries
the currently mounted typed slab candidates and chooses the closest one in a
bounded geometric lookahead ahead of the current slab. If that slab belongs to
another deck, orchestration performs the deck transition and checks that deck's
readiness before extraction. If no selected slab is mounted in the lookahead,
the work zone advances to the adjacent deck and tries again.

## Bootstrap and Main-Loop Invariant

Bootstrap is separate from the main loop because the main loop assumes a current slab already exists.

Bootstrap establishes:

- `readyDeck`: a selected deck whose deck-readiness fingerprint has been accepted;
- `currentSlab`: the first extracted slab in that deck;
- insertion state for preserving order when a deck contains multiple slabs.

At the start of each main-loop cycle:

```text
readyDeck is selected and deck-ready
currentSlab is the last consumed slab/candidate
```

The cycle first tries to resolve the geometrically closest selected slab ahead
of `currentSlab`. This successor operation has no `readyDeck` argument. When
the selected slab belongs to a different deck, the cycle advances exactly one
adjacent deck, waits for that deck's readiness, and repeats the successor
query. It does not jump directly to the selected slab's deck: intermediate
decks may contain an unknown slab, an unselected slab, or no currently selected
slab, and must still be examined. If no selected slab is currently mounted
close ahead, the cycle likewise advances one deck and tries the same
slab-to-slab successor operation again.

In the current code, this means some loop cycles advance the deck without extracting a slab. Conceptually, those cycles are still part of resolving the next slab request.

## Slabs

A slab is an extractable content unit inside a deck.

Slab properties:

- **Identity**: `data-message-id` for anchored slabs; otherwise `data-turn-id` or another derived key.
- **Role**: user, assistant, or anchorless.
- **Selector validity**: whether this DOM region is actually an extractable content slab rather than control/layout DOM.
- **Readiness**: slab-level finish fingerprints.
- **Content**: serializable Markdown.
- **Geometry**: the slab's own rectangle or extraction scope.

Successive extracted slabs also obey a geometric adjacency invariant, but it is
intentionally looser than deck adjacency. Positive space may remain between
their rectangles because selected tool/control regions are skipped. The gap
should remain bounded, and substantial overlap is anomalous. Slab adjacency is
diagnostic: a violation is reported but does not stop extraction. Deck
adjacency is stricter and enforced because outer decks are expected to form a
gapless partition.

Anchored text messages use `[data-message-author-role]` as a strong selector. This element is best understood as an **anchor**: a stable marker for a message, not necessarily the whole conceptual slab region.

Anchorless slabs need a different selector. The current weak-but-useful selector is:

```text
this subtree already dry-serializes to non-empty Markdown
```

This prevents control/layout DOM from being treated as an extractable slab merely because it is geometrically inside a ready deck.

## Anchors

Anchors are stable reference points inside decks.

For ordinary messages, `[data-message-author-role]` and `data-message-id` identify the start of an extractable message. They are reliable for identity and ordering, but they should not be treated as proof that the anchor element's rectangle covers the whole slab.

Because anchors are identifiers rather than regions, questions about whether an anchor "covers" part of the DOM should usually be reformulated in terms of:

- the slab that begins at the anchor;
- the deck containing that slab;
- the geometry of the slab scope.

## Selectors vs Fingerprints

The architecture distinguishes selectors from readiness fingerprints. The most
important difference is temporal.

### Selectors

Selectors answer:

```text
What does this exposed element let the extractor expect next?
```

A selector is not merely a membership test. Once an element is selected, the
extractor assumes that its known structure will be respected. The selected
element therefore carries predictive information: it tells the traversal logic
what kind of deck or slab may eventually be available, what descendants or
content shape to expect, and which readiness fingerprint should later be
applied.

Examples:

- `[data-turn-id-container]` elements for deck sequence containers;
- `[data-message-author-role]` for anchored slab candidates;
- dry Markdown serialization for anchorless extractable slab candidates.

### Fingerprints

Fingerprints answer:

```text
Is this already-selected deck or slab ready now?
```

A fingerprint is a present-tense signal. It does not decide what kind of object
the element is, and it does not predict what will eventually appear. It only
tells the extractor whether a selected object is ready enough for the next
operation.

Examples:

- deck readiness: `data-is-intersecting !== "false"`;
- slab readiness: extractable content exists, image sources are present, placeholders are absent.

A fingerprint is not a selector. Applying a readiness fingerprint to an arbitrary DOM element is a category error: first use a selector to establish what kind of object is expected, then evaluate the corresponding readiness fingerprint on that selected object.

## Core Boundary Interactions

The core extractor needs only a small set of boundary interactions. These serve the slab iterator; they are not a separate scroll loop.

1. **Bootstrap the first slab**
   - Move the work zone to the starting edge.
   - Choose the edge-visible deck.
   - Wait for deck readiness.
   - Select and extract the first slab.
   - Initialize the current ready deck, current slab cursor, and insertion state.

2. **Resolve the next slab**
   - Enumerate mounted typed slab candidates: messages, Canvas/textdoc blocks, generated images, and future configured slab types.
   - Restrict them to the bounded area geometrically ahead of the current slab.
   - Choose the closest candidate, retaining its type for readiness and extraction.
   - If it belongs to another deck, transition to that deck and wait for deck readiness.
   - If none is mounted close ahead, advance the work zone to the adjacent deck and try again.

3. **Select slab candidates**
   - Apply the configured selectors for each known slab type.
   - Keep extraction identity, geometry element, and slab type together.
   - Filter only elements covered by an explicit ignore rule.
   - Report every unlisted filtered direct-stack item, even when it is short.
   - Stop diagnostically rather than silently skipping a tall unclassified slab.

4. **Wait for slab readiness**
   - Evaluate slab finish fingerprints only after a valid slab candidate exists.

5. **Extract**
   - Serialize the selected slab once.

The current implementation keeps deck advancement inline in the main loop rather than factoring it into a named `nextSlab()` helper. Conceptually, however, the loop is slab-driven: work zone movement happens because the iterator needs a next slab and the current ready deck has none left.

## Supporting Diagnostics

Several systems are diagnostic rather than core:

- navigation-dot counts;
- scroll-height stability checks;
- probe-miss reports;
- deck/slab geometry model checks;
- mutation observers;
- delayed gap rechecks;
- timer-slip measurements;
- compatibility checks.

These diagnostics are valuable because the DOM/rendering boundary is backed by ChatGPT's external, changing DOM. They should not obscure the core model: diagnostics observe and explain; the traversal loop chooses decks, waits for decks, selects slabs, waits for slabs, and extracts.

## Current Design Posture

This extractor is intentionally a work in progress. ChatGPT's DOM can change, and not every slab class is known in advance.

The goal is not a perfect proof that every DOM state is handled. The goal is a disciplined loop with clear categories:

- The environment boundary exposes candidates.
- Work zone activates decks.
- Decks become ready.
- Ready decks expose slab candidates.
- Selectors decide which candidates are real slabs.
- Fingerprints decide when selected slabs are ready.
- Extraction serializes ready slabs.

When the model fails, diagnostics should make clear which boundary failed: deck selection, deck readiness, slab selection, slab readiness, successor ordering, or extraction.

## Execution-Time Model

Recent runs suggest that most execution time is explained by work-zone
movement, not by Markdown serialization. The useful first-order model treats a
run as a sequence of small scripted scroll jumps.

For the current small-jump algorithm:

```text
T ≈ J × (F + R × S)
```

where:

- `T` is total jump-related time;
- `J` is the number of jumps;
- `S` is average jump size in pixels;
- `F` is fixed per-jump overhead;
- `R` is rendering/stabilization cost per pixel exposed.

Equivalently, if `D` is the total scripted distance covered:

```text
T ≈ J × F + D × R
```

This explains why increasing the maximum jump size helps strongly at first but
then gives diminishing returns. Larger jumps reduce `J`, but each additional
increase changes `J` less than the previous one. Once average jump time is
roughly stable, performance improvement mostly follows the reduction in jump
count.

For the older single-large-jump-per-move algorithm, the timing model is
different because each high-level move paid roughly one rendered-region cost,
not one cost per small jump:

```text
T_old ≈ N × (F + R × H)
```

where:

- `N` is the number of high-level moves;
- `H` is the effective viewport or rendered-region height.

Using `F` and `R` estimated from the small-jump runs predicted the older
algorithm's execution time reasonably well. This suggests that the two
algorithms changed mainly the number and size of movement units, while having
little effect on the fixed per-movement overhead `F` and the per-pixel
rendering/stabilization cost `R`.

That was the clever part of the older algorithm: it expected the relevant slab
content to be rendered, and in practice it was. We did not observe failures
where the extractor had the start and end of a slab but lost only its middle
content. Its performance advantage came from reducing the number of scripted
jumps and therefore reducing the fixed per-jump overhead.

The failure mode was different: a large scripted jump could land the viewport
inside non-rendered territory. ChatGPT's own virtualized renderer was then
outside the regime where it behaved predictably, and some slabs could be
entirely skipped. The browser could report a settled frame while ChatGPT had not
produced the DOM surface the extractor needed. The small-jump algorithm is
slower than an ideal teleport, but it is designed to keep ChatGPT's rendering
machinery inside the reliable activation regime.

The diagnostic values that matter for this model are:

- total jumps;
- average jump size;
- average time per jump;
- average time per 120 pixels;
- maximum jump size reached;
- number of jumps at the maximum;
- total elapsed time.

Large viewport drifts are not part of this model. They are usually artifacts of
ChatGPT's virtualized rendering and should not be used as explanatory telemetry.
