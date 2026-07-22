# Architecture

This extractor works against ChatGPT's live, virtualized DOM. The DOM is not
the entire conversation saved on the server: it is the observable surface through which ChatGPT's own lazy-loading and rendering systems expose conversation content. The extractor must create a transcript of the conversation.

A walkway analogy is offered as a guide. A foreman builds a walkway from slabs
while a supplier exposes a changing inventory and employs workers to prepare
it. The architecture has six levels, from broadest to finest:

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
the units from which the walkway is built, and **anchors** are stable-enough
local features used to move a long or partially prepared slab through the work
zone safely.

The **work zone** is the viewport. It is not a seventh level. It is a moving
demand signal that intersects the layered model: moving it changes the
active area, the workers attempt to extend the ready area around it, and this
can expose or prepare more decks, slabs, and anchors.

The extractor relies on many assmptions which are partially described in ASSUMPTIONS.md.

## Supplier / Environment Boundary

The Supplier is the analogy name for the **environment boundary**: the adapter
boundary over ChatGPT's DOM and rendering systems. It is the source of the
supplies currently available to the extractor. In the code, the available supplies are in the container (the supply area), which can be the documentElement or another container.

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

The traversal logic interprets this information when deciding how to continue. Adapters may perform local translation and observation work, but traversal decisions belong to the traversal logic, not to the raw DOM.

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

# Work-Zone Movements

The Supplier does not keep the entire conversation in stock. New supplies
become usable as movement changes the active area and ChatGPT's rendering
systems attempt to extend the ready area around the work zone.

The work zone corresponds to the visible viewport. In the foreman
analogy, it is the portion of the walkway around which the Supplier's workers
are currently active to maintain the ready area.

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
the slab. The foreman selects a ready, visible anchor whose boundary can be
measured reliably, moves that anchor toward the bottom of the work zone, and
then asks for the next anchor exposed by the resulting ready area. Repeating
this process progressively brings the slab top into the work zone. Once the
slab top itself is a ready local reference, it can serve as the final anchor
and be brought to the intended bottom position.

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

Only after the large work-zone movement is complete does normal slab traversal resume. The intermediate jumps are merely the mechanism by which the Supplier's workers progressively prepare the walkway ahead of the foreman.

## Current DOM Adapter

The architecture intentionally does not prescribe how structural observations,
readiness observations, or work-zone movements are represented.

In the current ChatGPT DOM adapter:

- structural observations are realized primarily through selectors;
- readiness observations are realized primarily through readiness fingerprints;
- work-zone movements are viewport operations.

Selectors and readiness fingerprints are therefore implementation concepts
rather than architectural concepts. The architecture is expressed from the
traversal logic's point of view; the adapter is responsible for translating
ChatGPT's observable DOM surface into these architectural concepts.

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

Ordinary text messages use `[data-message-author-role]` as a strong selector.
For ordinary text messages, the selected element is treated as the message slab
scope: it is the element whose content is serialized and whose outer HTML can
be captured for diagnostics.

Non-message slabs need their own selectors. They should not be forced into the
ordinary-message selector model. A deck may contain multiple selected slab
types, so deck geometry and slab geometry remain distinct.

## Movement Commitment, Flicker, and Lost Jumps

The implementation does not contain a five-state jump protocol. Its actual
per-jump control flow is:

1. calculate a clamped jump from the current anchor-room observation;
2. call `scrollBy` with the calculated delta;
3. read the scroll position and anchor geometry immediately afterward;
4. wait for the current layout-stability condition; and
5. remeasure the anchor room and decide whether to continue, retry, or stop.

Before the first jump, the room observation is read synchronously after anchor
selection. Before each later jump, it is the observation produced after the
preceding jump's stabilization and final remeasurement. If the current room
says the anchor is already at the target, no jump is performed. Otherwise, the
extractor clamps its calibrated jump so it does not move farther than the room
allows. In the model, this uses the selected local anchor to bound a safe
work-zone movement; it does not introduce another rendering phase.

The terms **commanded** and **accepted** distinguish steps 2 and 3 in
diagnostics: a command was issued, and the immediate scroll-position read
either did or did not show movement. **Settled** is shorthand for satisfying
the limited stability test in step 4. These are observations around the code's
control flow, not states maintained by the implementation.

**Movement commitment** is different. It names a guarantee that the current
code does not establish: an immediately accepted jump remains effective
through later browser and renderer work relevant to the next operation. It was
introduced to describe the gap exposed by a jump that passes the current
stability check and is nevertheless later erased. Commitment is therefore an
open design requirement or diagnostic question, not a phase that can currently
be located between acceptance and settling in the code.

**Post-jump stabilization** follows every performed jump, including the final
jump. There is no separate animation-frame yield or stability wait immediately
before a jump. If post-jump stabilization is insufficient to make the next
anchor-room observation usable, that stabilization condition must be improved
rather than supplemented with another pre-jump wait.

**Flicker is an environmental condition, not an effect caused by extractor
jumps.** ChatGPT can enter a recurring layout-recomputation cycle even when the
extractor performs no movement. It has been observed especially when browser
zoom is not 100%, although that correlation does not yet identify the cause.
The cycle is useful diagnostically because it provides a naturally non-settling
environment in which to study movement behavior.

The same class of flicker is not unique to ChatGPT. It recurs at definite page
locations but does not occur on every visit to those locations. Location
specificity suggests a repeatable geometric trigger; intermittent occurrence
suggests a race between participating layout, rendering, and scroll-position
maintenance phases. Together, these facts make a purely ChatGPT-specific
virtualizer bug less likely as the complete explanation. ChatGPT can supply the
large geometry transition while a browser-level mechanism determines how the
viewport is compensated during that transition.

The interaction to explain is narrower: a jump can be accepted immediately,
then lose its effect during a later, independently occurring flicker
recomputation. The visible result is that the extractor's movement is erased,
but the mechanism is unknown. Possibilities include browser scroll anchoring,
focus or selection restoration, scroll restoration, virtualizer compensation,
or a layout change that preserves some visual anchor and thereby changes the
effective scroll position. Calling the event only a stabilization timeout
hides the ordering that matters: independent recomputation was already in
progress, the extractor inserted a jump, and a later recomputation failed to
preserve that jump.

The next diagnostic model should first record the flicker **without any
extractor jump**, establishing its baseline cycle, and then record the same
signals when a jump is inserted into that cycle. It should capture:

- commanded delta and immediate scroll-position delta;
- scroll position over subsequent frames and scheduler yields;
- the selected anchor's viewport coordinate;
- the anchor's container or document coordinate when it can be derived;
- scroll height and relevant deck-activation transitions;
- geometry of several stable candidate elements, so a visual anchor preserved
  by recomputation can be identified rather than assumed;
- available zoom-related signals and whether the run is at the 100% control;
- whether the command was rejected, committed, partially compensated, or
  completely rolled back;
- the timing of each flicker recomputation and the size of any lost movement.

These signals distinguish competing explanations. The no-jump baseline shows
which coordinates and elements the flicker naturally preserves. Comparing it
with the jump trial shows whether the later recomputation restores a previous
scroll position, preserves a particular visual anchor, or recomputes document
geometry in a way that absorbs the commanded delta. Changes correlated with
deck activation or scroll height would support a virtualizer explanation;
position changes with otherwise fixed document geometry would support a
browser-level explanation. These remain inferences until measured.

### Temporary extension: recomputation and rounding loops

The fundamental movement model has two actions: the extractor requests a
viewport jump, and the environment may adjust the viewport while preserving a
reference through rendering. To account for the observed flicker while it is
under investigation, the model is temporarily extended with a third action:
the environment may recompute layout and its associated viewport compensation
even when the extractor has requested no movement.

The working mechanism is a feedback loop. Layout produces fractional CSS-pixel
geometry, the browser realizes or compares that geometry at a quantized
position, and a compensation mechanism attempts to preserve a visual or
geometric reference. A residual below one CSS pixel can put the next
recomputation on the other side of a rounding boundary. The resulting geometry
then asks for the opposite compensation, returning the system to its earlier
state. In compact form:

```text
fractional layout
    → quantized geometry
    → reference-preserving compensation
    → layout invalidation/recomputation
    → fractional layout on the other side of the rounding boundary
```

This is a mechanism hypothesis, not yet an attribution to scroll anchoring,
the virtualizer, or another particular subsystem. It adds no new fundamental
traversal concept and should be removed from the architecture once the browser
behavior is understood or tolerated at the implementation boundary.

Two modes must be distinguished:

- In an **environment-only loop**, recomputation and compensation alternate
  while the extractor does nothing. This mode is directly required by the
  observation that flicker can continue on its own.
- In a **coupled loop**, the extractor observes one phase after an animation
  frame and responds to its subpixel residual. The rAF callback is a scheduling
  boundary, not itself a viewport movement. It makes the extractor a
  participant when the observation following it leads to an exact-boundary
  correction; that correction can trigger or phase-lock the next environmental
  recomputation.

One coupled loop exposed two work-zone-boundary states approximately 0.84 CSS
pixels apart. Two consecutive probe frames within either state were unchanged,
but an exact comparison caused another subpixel upward correction, after which
layout restored the other state. Momentary equality across rAF observations
therefore did not establish commitment: each phase was locally quiet while the
combined correction/recomputation cycle remained live.

A one-CSS-pixel tolerance accepts a sufficiently small boundary residual and
removes the extractor's corrective edge from this feedback graph. The tolerance
implementation is currently preserved but commented out so exact comparison
continues to expose the rounding mechanism during the experiment. This does not
show that tolerance stops the environment-only mode, nor that every flicker
amplitude falls within the tolerance. It is a termination rule for subpixel
corrections, not a strategy of entering flicker and waiting for a favorable
phase.

The minimum controlled comparison at the same repeatable location is:

1. no extractor activity, to measure the autonomous baseline;
2. passive rAF callbacks without geometry reads, to test scheduling alone;
3. rAF callbacks with geometry reads but no movement, to test observation and
   layout-flush effects;
4. exact-boundary corrections, to reproduce the coupled loop; and
5. the same corrections with a recorded subpixel tolerance.

For every case, record the two alternating geometries, compensation deltas,
scroll position, scroll height, and phase timing. If only cases 4 and 5 differ,
the tolerance is breaking an extractor/environment feedback edge. If case 1
oscillates, the environment has an autonomous loop regardless of extractor
participation. A change between cases 2 and 3 would show that the geometry read,
not rAF alone, participates in forcing or exposing recomputation.

The unresolved architectural problem is movement ownership and commitment.
A plausible race is that the extractor inserts a jump while browser layout,
scroll anchoring, or virtualizer compensation still owns an earlier geometric
reference. The jump is accepted synchronously, but a later compensation step
preserves that older reference and thereby erases or modifies the jump. Such
compensation can be user-friendly in its ordinary role—keeping selected visual
content stationary while material above it changes—yet conflict with a new
scripted movement that arrived after its reference state was chosen. This is a
hypothesis to test, not yet an attribution to a particular subsystem.

A robust design must not depend on joining one observed oscillation at a lucky
phase. It must identify whether a movement occurred inside an unresolved layout
transaction, determine which coordinate or element the environment preserves,
and establish commitment relative to the intended anchor before advancing.
The no-jump baseline and jump trial remain necessary to distinguish browser
scroll anchoring, virtualizer compensation, and other restoration mechanisms.

### Evidence from the 2026-07-19 incident

`console-export-2026-7-19_14-53-19.log` contains one observed lost-jump
interaction:

- an upward 480px jump was accepted immediately (`scrollY` changed from
  `105608.66` to `105128.66` and anchor room from `210.75` to `690.75`);
- the next changing frame was delayed by 710ms;
- that frame increased `scrollHeight` by `12268px` and `scrollY` by
  `12988.63px` relative to the accepted-jump state;
- the anchor's viewport coordinate changed from `690.75` to `-29.25`, while
  its derived document coordinate increased by approximately `12268.64px`;
- the anchor element retained its 78px source height.

The near equality between scroll-height growth and anchor document-coordinate
growth is evidence that a large amount of geometry was inserted or realized
above the anchor. The scroll-position adjustment exceeded that structural
shift by about `720.63px`, so the post-jump visual anchor was not preserved.
This rules out simple jump rejection and does not resemble restoration to the
old raw scroll position. It is consistent with a race in which geometry and
scroll compensation are computed from different layout states or different
candidate anchors. Resizing the viewport ended the observed oscillation,
consistent with a forced recomputation selecting a coherent state, but it does
not by itself identify which subsystem was responsible.

Stability must therefore be operation-specific. A quiet `(scrollHeight,
scrollY)` fingerprint can show that the outer geometry is momentarily still,
but cannot prove that a movement committed or that the relevant anchor is
ready. An oscillating fingerprint by itself identifies environmental flicker,
not a jump failure. A lost-jump interaction is established only when a
separately observed jump is accepted and a later recomputation erases some or
all of its effect.

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
