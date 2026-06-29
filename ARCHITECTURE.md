# Architecture

This extractor works against ChatGPT's live, virtualized DOM. The DOM is not
the transcript: it is the observable surface through which ChatGPT's own
lazy-loading and rendering systems expose transcript content.

The walkway analogy is only a guide. In that analogy, a foreman builds a
walkway from slabs while a supplier exposes the materials, measurements, and
notes currently available on the work site. The technical architecture should
not depend on the analogy, but it borrows some of its vocabulary: **slabs**,
**decks**, and **work zone**.

## Supplier / Environment Boundary

The Supplier is the analogy name for the **environment boundary**: the adapter
boundary over ChatGPT's DOM and rendering systems. It is the source of the
supplies currently available to the extractor.

The environment boundary does **not** keep the entire conversation in stock.
New decks, slabs, and other observable supplies become available as ChatGPT's
rendering systems do their work. The boundary therefore exposes only a
changing, partial surface and cannot predict when additional supplies will
arrive.

To work with this incomplete inventory, the traversal logic uses three kinds of
information or action:

- **Structural expectations**, which describe what kinds of supplies may become
  available as the delivery process continues.
- **Readiness observations**, which describe whether selected supplies are
  ready for the next stage of work now.
- **Interventions**, which actively change the situation so that more supplies
  may become observable.

The traversal logic interprets this information when deciding how to continue.
Adapters may perform local translation and observation work, but traversal
decisions belong to the traversal logic, not to the raw DOM.

## Structural Expectations

A structural expectation describes what developments in the environment
boundary's delivery process may now occur. It tells the traversal logic what
kinds of supplies it may reasonably expect to encounter next.

Structural expectations are derived from present evidence, but their importance
is predictive: they describe what may become available if the structure
continues to be respected.

Some structural expectations are established from the beginning as part of the
environment boundary's interface. Others arise only as the delivery process
progresses. For example, once a message slab element has been selected, its
known structure tells the extractor what content shape, descendants, or
readiness observations may later become meaningful.

## Readiness Observations

A readiness observation is something that the traversal logic may meaningfully
wait for or test before proceeding with an already selected supply.

Unlike structural expectations, readiness observations describe the present
rather than the future. They tell the extractor that a selected supply has
reached a state where the next stage of work may begin.

Some readiness observations are meaningful from the beginning because they are
established by the environment boundary's interface. Others become meaningful
only after earlier structural expectations have established that this kind of
observation may now occur.

Readiness observations are fallible. They are evidence, not proof. A readiness
observation can time out, be too weak, or be invalidated by later diagnostics.

## Interventions and Work-Zone Movement

An intervention is an action that changes what the environment boundary can
expose. It is neither a structural expectation nor a readiness observation.

The main intervention is work-zone movement. The work zone is the part of the
page that has been brought close enough to the viewport for ChatGPT's rendering
machinery to expose useful DOM evidence.

The extractor assumes that ChatGPT's rendering workers are not reliable under a
single large scripted jump of the work zone. ChatGPT's rendering pipeline
appears to be designed around ordinary incremental scrolling: each newly
exposed region gets a chance to mount, measure, and trigger its own readiness
work before the next region is exposed. A large scripted jump can land the
viewport inside non-rendered territory, leaving both ChatGPT's virtualizer and
the extractor with an incomplete observable surface.

This applies specifically to the extractor's ordinary scripted scrolling
(`scrollTop` / `scrollTo`). It should not be confused with ChatGPT or browser
navigation paths such as clicking a conversation navigation item or using the
scrollbar. Those actions may use different positioning or reconstruction
behavior. They are different environment operations, not merely the same
work-zone movement with a larger distance.

For that reason, work-zone movement is modeled as a sequence of small jumps.
After each jump, the extractor waits for local browser/layout stability before
taking the next measurements. Browser/layout stability is necessary but not
sufficient: diagnostics such as a sandwiched-empty deck mean the browser frame
has settled while ChatGPT-level readiness has not.

## Current DOM Adapter

The architecture intentionally does not prescribe how structural expectations,
readiness observations, or interventions are represented.

In the current ChatGPT DOM adapter:

- structural expectations are realized primarily through selectors;
- readiness observations are realized primarily through readiness fingerprints;
- interventions are realized primarily through scripted work-zone movement.

Selectors and readiness fingerprints are therefore implementation concepts
rather than architectural concepts. The architecture is expressed from the
traversal logic's point of view; the adapter is responsible for translating
ChatGPT's observable DOM surface into these architectural concepts.

## Slabs, Decks, and Message Slab Selectors

A **slab** is an extractable content unit. Ordinary text messages, generated
images, and Canvas/textdoc blocks are different slab types and may require
different structural expectations and readiness observations.

A **deck** is a traversal region exposed by ChatGPT's rendering system. Decks
are not transcript content. They are part of the environment's supply surface:
they help determine what slabs can be observed and when.

Ordinary text messages use `[data-message-author-role]` as a strong selector.
For ordinary text messages, the selected element is treated as the message slab
scope: it is the element whose content is serialized and whose outer HTML can
be captured for diagnostics.

Non-message slabs need their own selectors. They should not be forced into the
ordinary-message selector model. A deck may contain multiple selected slab
types, so deck geometry and slab geometry remain distinct.

## Diagnostics

Diagnostics are not the traversal model. They observe whether the current
implementation still behaves as the model expects.

Important diagnostic questions include:

- Did the expected structural development fail to occur?
- Did a readiness observation time out or prove too weak?
- Did a work-zone intervention fail to expose enough new surface?
- Did deck or slab geometry violate an expected adjacency or containment rule?
- Did extraction serialize a selected ready slab successfully?

When the model fails, diagnostics should identify which boundary failed:
structural expectation, readiness observation, intervention, geometry,
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

Large viewport drifts are not part of this model. They are usually artifacts of
ChatGPT's virtualized rendering and should not be used as explanatory telemetry.
