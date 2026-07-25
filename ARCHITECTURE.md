# Architecture

This extractor works against ChatGPT's live, virtualized DOM. The DOM is not
the entire conversation saved on the server: it is the observable surface through which ChatGPT's own lazy-loading and rendering systems expose conversation content. The extractor must create a transcript of the conversation.

A walkway analogy is offered as a guide. A supplier exposes a changing supply
area and employs workers who act directly on its physical inventory. A foreman
guides those workers using only the geometry they report. Once a supplied slab
has been prepared and traversed, its extracted content is added to a walkway.
The walkway is the accumulated Markdown output; it is not the structure on
which supply preparation and movement occur. The supply architecture has six
levels, from broadest to finest:

```text
supply area → active area → ready area → decks → slabs → anchors
```

This is a progression from broad environmental scope to fine operational
detail, not a claim that every object is wholly contained by the state above
it. A deck or slab can straddle the inferred ready-area boundary.

The **supply area** is everything currently exposed through the scroll
container. The **active area** is the part to which ChatGPT has assigned
rendering activity. The **ready area** is the part of that active area whose
required detail has actually been prepared for the foreman's next operation.
Active therefore does not mean ready.

Within the ready area, **decks** organize the supplier's batches, **slabs** are
the physical content units whose extracted representations are added to the
walkway, and **anchors** are stable-enough local features used to move a long
or partially prepared slab through the work zone safely.

The **work zone** is the viewport. It is not a seventh level. It is a moving
demand signal that intersects the layered model: moving it changes the
active area, the workers attempt to extend the ready area around it, and this
can expose or prepare more decks, slabs, and anchors.

The extractor relies on many assmptions which are partially described in ASSUMPTIONS.md.

## Supplier / Environment Boundary

The Supplier is the analogy name for the **environment boundary**: the adapter
boundary over ChatGPT's DOM and rendering systems. It is the source of the
supplies currently available to the extractor. In the code, the available supplies are in the container (the supply area), which can be the documentElement or another container.

The Supplier's workers operate on this supply area rather than on the walkway.
A worker may retain the physical deck, slab, or anchor currently being acted
upon while reporting only geometric observations to the foreman. These
temporary physical references are operational details of the environment
boundary, not traversal state. The foreman's authoritative state consists of
distances and heights. The walkway remains a separate accumulated result.
The current bottom-up traversal prepends each newly discovered entry to keep
that result in chronological order.

The environment boundary does **not** keep the entire conversation in stock.
New decks, slabs, anchors, and other observable supplies become available as
ChatGPT's rendering systems do their work. The boundary exposes only a
changing, partial inventory. `data-is-intersecting` is evidence that a deck is
**active**; it is not proof that the deck, all of its slabs, or all of their
anchors are ready. The exact ready-area boundary is not directly exposed and
must be inferred through operation-specific observations.

To work with this incomplete inventory, the traversal logic relies on three
kinds of observations and one kind of action:

- **Structural observations**, which describe what kinds of supplies may become
  available as the delivery process continues.
- **Activation observations**, which describe where the supplier's workers are
  active.
- **Readiness observations**, which describe whether selected supplies are
  ready for the next stage of work now.
- **Work Zone Movements**, which actively change the situation so that more supplies may become observable.

Structural, activation, and readiness observations guide traversal from decks
toward progressively finer structures such as slabs and anchors. Work-zone
movements change the renderer's demand signal, allowing activation and
preparation effects to propagate until new observations become available.

The traversal logic interprets this information when deciding geometrically
how to continue. Workers behind the environment boundary translate those
geometric requests into physical selection, observation, and movement of the
DOM supplies. The selected physical objects remain with the workers; only
their geometry is reported to traversal logic.

## Structural Observations

A structural observation describes what developments in the environment
boundary's delivery process may now occur. It tells the traversal logic what
kinds of supplies it may reasonably expect to encounter next.

Structural observations are present evidence, but their importance
is predictive: they describe what may become available if the structure
continues to be respected.

Some structural observations are established from the beginning as part of the
environment boundary's interface. Others arise only as the delivery process
progresses. For example, once a message slab element has been selected, its
known structure tells the extractor what content shape, descendants, or
readiness observations may later become meaningful.

## Activation and Readiness Observations

An activation observation says that the supplier's workers have been assigned
to a region. In the current adapter, a deck's `data-is-intersecting` state is
such an observation. An active deck may still contain unprepared detail, so
deck state must be described as activation rather than readiness.

A readiness observation is something that the traversal logic may meaningfully
wait for or test before proceeding with an already selected supply.

Unlike structural observations, readiness observations describe the present
rather than the future. They tell the extractor that a selected supply has
reached a state where the next stage of work may begin.

Some readiness observations are meaningful from the beginning because they are
established by the environment boundary's interface. Others become meaningful
only after earlier structural observations have established that this kind of
observation may now occur.

Readiness observations are fallible. They are evidence, not proof. A readiness
observation can time out, be too weak, or be invalidated by later diagnostics.

## Activation, Collapsed Margins and Oscillation

Activation can change geometry even when an active deck and its placeholder
have the same height. In one observed deck, both states were 392 px high, but
activation mounted a first child with `margin-top: 16px`. Because the deck had
no border, padding, or formatting context to contain it, that margin collapsed
through the deck and moved its top from 995.1 px to 1011.1 px below the
viewport. Those positions straddled the 1000 px activation boundary:

```text
placeholder activates → child margin appears → deck moves outside boundary
→ deck deactivates → child margin disappears → deck moves inside boundary
```

Setting only that first-child top margin to zero stopped the oscillation while
preserving the deck's 392 px height and the child's bottom margin. Related
effects of the same CSS rule include
[virtualized content jumping when margin collapse changes](https://gitlab.com/catamphetamine/virtual-scroller#margin-collapse),
[an IntersectionObserver reader measuring less than the leaked margin adds](https://jonwinsley.com/notes/armorer-web-reader),
and [a fixed-height parent acquiring scroll from a collapsed child margin](https://stackoverflow.com/questions/47737935/why-does-this-page-scroll).

# Work-Zone Movements

The Supplier does not keep the entire conversation in stock. New supplies
become usable as movement changes the active area and ChatGPT's rendering
systems attempt to extend the ready area around the work zone.

The work zone corresponds to the visible viewport. In the foreman
analogy, it is a movable region over the supply area around which the
Supplier's workers are currently active to maintain the ready area. It does
not intersect or move over the completed walkway.

The Supplier's workers are concerned with detailed structure rather than with
slabs as traversal units. A deck can be active without being wholly ready, and
a slab may fit
entirely within one work zone or may extend across many successive work
zones. Even while the foreman remains on the same slab, the workers may
still be preparing later anchors or portions of that slab.

For the workers to operate predictably, each new work zone must remain within the ready area extending a few hundred pixels on each side of that work zone.

Within this safe part, the workers can
reliably prepare the detailed structure required by the current and
upcoming supplies.

The geometric goal of a slab movement is to bring the slab's top to the bottom
of the work zone. The slab top cannot always be used as the immediate movement
reference, however. For a long or partially prepared slab, its top may still be
above the work zone and outside the ready area. Geometry reported for that
distant boundary may be incomplete, unstable, or derived from content that the
Supplier's workers have not prepared yet.

Anchors solve this by providing a sequence of local movement references inside
the slab. The foreman requests one anchor movement using the current geometry.
A worker selects the corresponding ready, visible physical anchor, moves it
toward the bottom of the work zone, and reports the resulting geometry.
Repeating this process progressively brings the slab top into the work zone.
Once the slab top itself is a ready local reference, the worker can select it
as the final anchor and bring it to the intended bottom position.

Consequently, the foreman advances the work zone in small jumps relative to
the current anchor. After each jump, it waits until the newly reached safe part
and the relevant anchor geometry have been prepared before making the next
jump. These small jumps exist solely to satisfy the operating constraints of
the Supplier's workers; anchors make those constraints usable even when the
ultimate slab boundary is still beyond reliable observation.

A small jump does not necessarily make a new slab available. Some slabs extend
across many successive work zones, so several small jumps may occur while the
foreman is still working with anchors in the same slab. Small jumps are
therefore not considered traversal events.

Instead, the foreman groups successive small jumps into a single **large work-zone movement**. A large work-zone movement begins when traversal cannot continue without advancing the work zone. It consists of as many small jumps as needed, each followed by waiting for the newly reached safe part to become ready. The movement ends when the work zone has advanced as far as possible while the current slab still intersects it.

Only after the large work-zone movement is complete does normal slab traversal resume. The intermediate jumps are merely the mechanism by which the Supplier's workers progressively prepare the supply area needed for the current and upcoming operations.


## Decks, Slabs, Anchors, and Message Slab Selectors

A **slab** is an extractable content unit. Ordinary text messages, generated
images, and Canvas/textdoc blocks are different slab types and may require
different structural observations and readiness observations.

A **deck** is a traversal region exposed by ChatGPT's rendering system. Decks
are not transcript content. They are part of the environment's supply surface:
they help determine what slabs can be observed and when. A selected deck is an
**active deck**, based on activation evidence; readiness is established only
for the particular slab or anchor operation that follows.

An **anchor** is a local geometric feature of a slab: an element boundary that
can be measured and moved without requiring the whole slab to be ready at
once. Anchors are movement instruments, not extractable transcript units.

Ordinary text messages are discovered as slabs with `[data-message-id]`.
After selection and readiness, extraction resolves the slab's
`[data-message-author-role]` element as the content scope that is serialized.

Non-message slabs need their own selectors. They should not be forced into the
ordinary-message selector model. A deck may contain multiple selected slab
types, so deck geometry and slab geometry remain distinct.

## Current Production Flow

The production traversal begins at the bottom of the conversation. It uses the
bottom-most measured deck boundary as its initial search boundary, then selects
decks and slabs upward by geometry. A selected deck must expose activation
through `data-is-intersecting` before its slabs are used.

Each selected slab passes one consolidated content-readiness operation before
serialization. Ordinary messages require a mounted content scope, extractable
text or images, no recognized placeholder elements, and sources for their
images. Generated-image slabs additionally require a loaded image with non-zero
natural dimensions and completed decoding. Canvas/textdoc slabs require a
mounted ProseMirror content surface that produces non-empty Markdown. Explicit
empty slabs are ready immediately.

The slab is serialized as soon as that readiness operation succeeds. Because
discovery runs from newest to oldest, each extracted entry is inserted at the
front of the accumulated result. This restores chronological reading order
without changing traversal direction.

On a later cycle, if traversal cannot reach the next slab directly, the current
slab is moved geometrically through the work zone. Long message and
Canvas/textdoc slabs use local anchors; generated-image and empty slabs use
their top boundary. Each small work-zone movement is followed by layout and
anchor stabilization.

Traversal ends when no next deck exists above the current boundary. Export then
creates the Markdown transcript, downloads generated images and Canvas/textdoc
documents as companion files, replaces their deferred tokens with filenames,
and downloads the final transcript.

## Diagnostics

Diagnostics are not the traversal model. They observe whether the current
implementation still behaves as the model expects.

Important diagnostic questions include:

- Did the expected structural development fail to occur?
- Did a readiness observation time out or prove too weak?
- Did an active region fail to produce the required ready area?
- Did a work-zone movement fail to expose enough new surface?
- Was a jump rejected, committed, or later erased during recomputation?
- Did deck or slab geometry violate an expected adjacency or containment rule?
- Did extraction serialize a selected slab after its own readiness condition
  was satisfied?

When the model fails, diagnostics should identify which boundary failed:
structural observation, readiness observation, work-zone movement, geometry,
ordering, or extraction.

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

Observed runs used while testing the model:

| Run | Max jump | Total time | Jumps | Avg jump | Avg jump time | Avg / 120px | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `1782598151699` | 120px | 238.6s | 2807 | 120px | 70ms | 70ms | Successful export; early timing-model baseline. |
| `1782599578119` | 240px | 267.5s | 1417 | 239px | 116ms | 58ms | Successful export; slower environment/run. |
| `1782597788119` | 360px | 188.1s | 957 | 353px | 149ms | 50ms | Successful export. |
| `1782598763176` | 480px | 164.1s | 729 | 463px | 165ms | 43ms | Successful export. |
| `1782678455439` | 480px | 165.2s | 825 | 408px | 152ms | 45ms | Later successful 480px run. |
| `1782675112575` | 600px | 172.8s | 770 | 439px | 158ms | 43ms | Successful 600px run; environment likely less favorable. |
| `1782723470852` | 600px | 137.0s | 706 | 476px | 137ms | 34ms | Faster successful 600px run. |
| `1782781471095` | 720px | 164.6s | 567 | 593px | 140ms | 28ms | Isolated successful 720px run; no capped-out jumps. |
| `1782781952284` | 720px | 250.7s | 702 | 480px | 146ms | 37ms | Successful 720px run with several Resume-from-current stops. |
| `1782783497011` | 720px | 157.8s | 567 | 593px | 135ms | 27ms | Second isolated successful 720px run (no resumes, no capped-out jumps); fastest 720px run so far. |

The table should be read as empirical calibration data, not a benchmark suite.
The 120→480px sequence shows the main shape of the model: bigger jumps sharply
reduce jump count at first, and therefore reduce fixed overhead. Later 600px
and 720px runs show that the environment and resumptions can dominate a single
run's total time, but the jump-count term still explains the best 720px run
well. A rough fit of `avgJumpTime ≈ F + R × avgJump` over the original
120–480px calibration rows gives `F ≈ 43ms` and `R ≈ 0.28ms/px`; including the
later runs shifts the estimate, which is expected because browser/ChatGPT load
conditions were not controlled.

Large viewport drifts are not part of this model. They are usually artifacts of
ChatGPT's virtualized rendering and should not be used as explanatory telemetry.
