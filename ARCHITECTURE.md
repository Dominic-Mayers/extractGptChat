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

# Work-Zone Movements

The Supplier does not keep the entire conversation in stock. New
supplies become available only as ChatGPT's rendering systems extend the
current work zone.

The work zone corresponds to the visible viewport. In the foreman
analogy, it is the portion of the walkway where the Supplier's workers
are currently active.

The Supplier's workers are concerned with the detailed structure of
supplies rather than with slabs as traversal units. A slab may fit
entirely within one work zone or may extend across many successive work
zones. Even while the foreman remains on the same slab, the workers may
still be preparing later portions of that slab.

For the workers to operate predictably, each new work zone must remain within a surrounding safe part of the walkway extending a few hundred pixels on each side of that work zone.

Within this safe part, the workers can
reliably prepare the detailed structure required by the current and
upcoming supplies.

Consequently, the foreman advances the work zone in small jumps. After
each jump, it waits until the newly reached safe part has been prepared
before making the next jump. These small jumps exist solely to satisfy
the operating constraints of the Supplier's workers. Their purpose is
not to expose a new slab. A small jump may reveal no new slab at all.

A small jump does not necessarily make a new slab available. Some slabs extend across many successive work zones, so several small jumps may occur while the foreman is still working with the same slab.

For this reason, small jumps are not considered traversal events. The foreman groups them into a single large work-zone movement, which ends only when the work zone has advanced as far as possible while the current slab still intersects it. 

A large work-zone movement begins when traversal cannot continue without
advancing the work zone. The foreman then performs successive small
jumps, waiting after each one for the newly reached safe part to become
ready. The movement ends only when the work zone has advanced as far as
possible while the current slab still intersects it.

Only after the large work-zone movement is complete does normal slab
traversal resume. The intermediate jumps are not traversal events in
their own right; they are merely the mechanism by which the Supplier's
workers progressively prepare the walkway ahead of the foreman.

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
