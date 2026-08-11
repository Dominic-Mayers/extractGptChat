# Architecture

This extractor works against ChatGPT's live, virtualized DOM. The DOM is not
the entire conversation saved on the server: it is the observable surface through which ChatGPT's own lazy-loading and rendering systems expose conversation content. The extractor must create a transcript of the conversation.

A walkway analogy is offered as a guide. A supplier exposes a changing supply
area and employs workers who act directly on its physical inventory. A foreman
guides those workers using only the geometry they report. Once a supplied slab
has been prepared and traversed, its extracted content is added to a walkway.
The walkway is the accumulated Markdown output; it is not the structure on
which supply preparation and movement occur. The supply architecture has seven
levels, from broadest to finest:

```text
conversation → supply area → active area → ready area → decks → slabs → anchors
```

This is a progression from broad environmental scope to fine operational
detail, not a claim that every object is wholly contained by the state above
it. A deck or slab can straddle the inferred ready-area boundary.

The **supply area** has a record of the complete list of decks, but not neccessrialy their content. In the current ChatGPT adapter it corresponds to the `documentElement`. This does not mean that all of the conversation's detailed DOM or extractable content is mounted. The geometry of a deck is not neccessarily available and the geometry can be present while the corresponding inventory is unavailable.

The **active area** is the part of the supply area to which ChatGPT has
assigned rendering activity. The **ready area** is the part of that active
area whose required detail has actually been prepared for the foreman's next
operation. Active therefore does not mean ready.

Within the ready area, **decks** organize the supplier's batches, **slabs** are
the physical content units whose extracted representations are added to the
walkway, and **anchors** are stable-enough local features used to move a long
or partially prepared slab through the anchor-zone safely.

The **anchor-zone** is the viewport. It is not a seventh level. It is a moving
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

The supply area contains the complete list of decks, but the
environment boundary does **not** keep its entire detailed inventory in stock.
New slabs, anchors, and other observable supplies become available as
ChatGPT's rendering systems do their work. The boundary exposes a changing,
partial realization of a geometrically complete document.
`data-is-intersecting` is evidence that a deck is **active**; it is not proof
that the deck, all of its slabs, or all of their anchors are ready. The exact
ready-area boundary is not directly exposed and must be inferred through
operation-specific observations.

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
toward progressively finer structures such as slabs and anchors. Anchor-zone
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

## Anchor-zone movements

The Supplier does not keep the entire conversation in stock. New supplies
become usable as movement changes the active area and ChatGPT's rendering
systems attempt to extend the ready area around the anchor-zone.

The anchor-zone corresponds to the visible viewport. In the foreman
analogy, it is a movable region over the supply area in which the foreman set anchors  to determine how to move the region. upplier's workers are currently active to maintain the ready area.

The Supplier's workers are concerned with detailed structure rather than with
slabs as traversal units. A deck can be active without being wholly ready, and
a slab may fit
entirely within one anchor-zone or may extend across many successive anchor-zones. Even while the foreman remains on the same slab, the workers may
still be preparing later anchors or portions of that slab.

For the workers to operate predictably, each new anchor-zone must remain within the ready area extending a few hundred pixels on each side of that anchor-zone.

Within this safe part, the workers can
reliably prepare the detailed structure required by the current and
upcoming supplies.

The geometric goal is to bring the current slab's top to the lower boundary of
the active area above the anchor-zone. This keeps it near the viewport while the
next deck enters the active area and can render before reaching the anchor-zone.
The current slab top cannot always be the immediate movement reference: a long or
partially prepared slab may have incomplete or unstable distant geometry.

Anchors solve this by providing a sequence of local movement references near
the top of the anchor-zone inside the anchor-zone. An anchor can belong to any active rendered deck; it does not have to belong to the current slab being moved. This distinction matters because the anchor supervises movement while the current slab top remains the overall movement target. The browser's actual scroll anchor is not observable,
so the extractor selects its own anchor near the top of the anchor-zone. Its
anchor should not lie far below the browser's effective anchor, because
rendering between the two could preserve the browser anchor while displacing
the extractor's reference.

For each small movement, the worker stops when either the selected anchor
reaches its target near the anchor-zone bottom or the current slab top reaches
its separate target above the viewport. If the anchor arrives first, the worker
selects another ready anchor near the anchor-zone top and continues. Independent
targets avoid using a distant slab boundary as the local reference.

Consequently, the foreman advances the anchor-zone in small jumps relative to
the current anchor. After each jump, it waits until the newly reached safe part
and the relevant anchor geometry have been prepared before making the next
jump. These small jumps exist solely to satisfy the operating constraints of
the Supplier's workers; anchors make those constraints usable even when the
ultimate slab boundary is still beyond reliable observation.

A small jump does not necessarily make a new slab available. Some slabs extend
across many successive anchor-zones, so several small jumps may occur while the
foreman is still working with anchors in the same slab. Small jumps are
therefore not considered traversal events.

Instead, the foreman groups successive small jumps into a single **anchor-zone movement**. An anchor-zone movement begins when traversal cannot continue without advancing the anchor-zone. It consists of as many small jumps as needed, each followed by waiting for the newly reached safe part to become ready. It ends when the current slab top reaches the lower boundary of the active area above the anchor-zone.

Only after the anchor-zone movement is complete does normal slab traversal resume. The intermediate jumps are merely the mechanism by which the Supplier's workers progressively prepare the supply area needed for the current and upcoming operations.


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

## Issues

### Activation, Collapsed Margins and Oscillation

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

### Jump Erasure

The main application sometimes erases a scripted jump after initially applying it. The
scroll command changes only the viewport position: the DOM geometry does not
change, and every DOM element consequently changes its position relative to the
viewport by the requested amount. Before the next accepted stable state, the
viewport returns to its pre-jump position. The extractor anchor is
the local measurement used to recognize that reversal. Observed erasures
are strongly associated with deck deactivation, although the browser mechanism
that restores the viewport position remains unresolved.

The extractor detects an erasure when its anchor returns exactly to
its pre-jump position. It retries the movement once. Completed runs show
that these retries normally succeed. A second consecutive erasure remains an
explicit error. Erasure occurring later than the current detection window is a
possibility, but it has not been established as the cause of an extraction
failure.


## Current Production Flow

The production traversal begins at the bottom of the conversation. It uses the
bottom-most measured deck boundary as its initial search boundary, then selects
decks and slabs upward by geometry. A selected deck must expose activation
through `data-is-intersecting` before its slabs are used.

TO COMPARE WITH CODE: Each selected slab passes one consolidated content-readiness operation before extraction. Ordinary messages require a mounted content scope, extractable text or images, no recognized placeholder elements, and sources for their
images. Generated-image slabs additionally require a loaded image with non-zero
natural dimensions and completed decoding. Canvas/textdoc slabs require a
mounted ProseMirror content surface that produces non-empty Markdown. Explicit
empty slabs are ready immediately.

The slab is extracted as soon as that readiness operation succeeds. Because
discovery runs from newest to oldest, each extracted entry is inserted at the
front of the accumulated result. This restores chronological reading order
without changing traversal direction.

On a later cycle, if traversal cannot reach the next slab directly, the current
slab is moved geometrically toward the active area above the anchor-zone. A ready
anchor near the top of the anchor-zone supervises each jump. The anchor moves
toward the bottom of the anchor-zone while the current slab top moves toward its
separate boundary above the viewport. Each jump is followed by stabilization.

Traversal ends when no next deck exists above the current boundary and returns
a neutral extraction snapshot containing prompts, image references, and
Canvas/textdoc content. Export is a separate stage. It materializes that
snapshot either with companion asset files or with embedded base64 images and
inline Canvas content, then downloads the final transcript. Consumers that do
not need the standalone download workflow can use the snapshot directly.

## Execution-Time Model

Recent runs suggest that most execution time is explained by anchor-zone
movement, not by Markdown serialization. The useful first-order model treats a
run as a sequence of small scripted scroll jumps.

For the current small-jump algorithm, the earlier first-order approximation
was:

$$\tau_{\mathrm{run}} \approx J(F + RS)$$

where:

- $\tau_{\mathrm{run}}$ is total jump-related time;
- $J$ is the number of jumps;
- $S$ is average jump size in pixels;
- $F$ is fixed per-jump overhead;
- $R$ is rendering/stabilization cost per pixel exposed.

Equivalently, if `D` is the total scripted distance covered:

$$\tau_{\mathrm{run}} \approx JF + DR$$

$J$, $S$, and even the realized scripted distance $D$ are outcomes of the
traversal, not fixed inputs. At jump $k$, the selected anchor, slab target,
activation guard, and current supply geometry clamp the requested maximum to a
realized jump $s_k$. Geometry changes after that jump alter the next distances
and therefore the next clamp. More explicitly,

$$
\begin{aligned}
s_k &= \operatorname{clamp}(\mathrm{maxJump}, \text{realized geometry at } k), \\
\tau_{\mathrm{run}} &\approx \sum_k (F + Rs_k + W_k).
\end{aligned}
$$

where $W_k$ is additional stabilization work induced by changes in realized
geometry. Variation in realized geometry therefore produces variation in
clamped jump sizes, jump count, distance exposed per jump, stabilization work,
and total measured time. The timing variation is not an independent source of
traversal variation; it is an aggregate consequence of the realized geometric
path.

This explains why increasing the maximum jump size helps strongly at first but
then gives diminishing returns. Larger jumps reduce `J`, but each additional
increase changes `J` less than the previous one. Once average jump time is
roughly stable, performance improvement mostly follows the reduction in jump
count.

For the older single-large-jump-per-move algorithm, the timing model is
different because each high-level move paid roughly one rendered-region cost,
not one cost per small jump:

$$\tau_{\mathrm{old}} \approx N(F + RH)$$

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

## Geometric Traversal Model and Current Conjectures

The fixed-deck runs make it useful to separate two meanings of geometry:

- **Conversation geometry** is the ordered set of deck intervals and heights
  in the supply area. For a fixed conversation and fixed viewport, this is the
  repeatable input to a traversal.
- **Realized geometry** is what a particular animation frame exposes after
  activation, deactivation, placeholder substitution, margin collapse, and
  scroll-position adjustment. It is the current realization of the
  conversation geometry plus work that is still in flight.

The first is the proposed cause of the repeatable baseline. The second is the
state on which the traversal immediately acts. It determines the anchor and
target distances, the size of each clamped jump, whether another jump is
needed, and how much stabilization follows. The resulting sequence of realized
geometries therefore mediates between fixed conversation geometry and measured
execution time. A DOM mutation is not an independent input merely because it
happens at a different wall-clock time in two runs; it may be a delayed
realization of the same geometric boundary crossing, but it can change the
subsequent traversal path and its duration.

### Baseline-geometry conjecture

The conjecture in its simplest form is:

> After adjusting for traversal speed, the repeatable baseline behavior of
> activations, deactivations, and jump erasures depends entirely on the
> geometry of the conversation.

Conversation geometry supplies the fixed structure, while variations in its
realized geometry determine the path actually taken through that structure:
which jumps are clamped, how many jumps are needed, which activation boundaries
are crossed, and which activation or deactivation work remains pending. The
conjecture says that these geometric facts are sufficient to explain the
baseline distribution observed across repeated traversals. It does not say
that every run realizes the geometry in exactly the same sequence.

The definitions below are a tentative attempt to make this simple conjecture
precise enough to test. They are part of the conjecture, not established facts.
In particular, the proposed state $X_k$ may need fields added, removed, or
redefined as the fixed-deck investigation reveals what information is actually
required.

### Tentative traversal state

To formulate the conjecture, first choose a **traversal position** `k`. This is
an observable landmark in the ordered traversal, not necessarily a jump number
or a document coordinate. For example, `k` can be the position immediately
after the first geometric activation of the deck with a specified turn ID.

A valid specification of `k` must:

- use only information observable at or before the landmark, rather than a
  future outcome such as whether the next jump is erased;
- identify corresponding positions across runs of the same conversation;
- specify whether the state is sampled immediately before or after the named
  event; and
- disambiguate repeated events by traversal direction and occurrence number,
  such as the first upward geometric activation of a given deck.

The ordering $k' > k$ means that landmark $k'$ occurs later in the traversal;
it does not require consecutive jump numbers.

Let $S_k$ be the complete observable traversal state at position $k$. Even for
a fixed conversation and fixed browser settings, $S_k$ may vary across runs.
It includes the clock time, rAF and jump history, formal deck states, pending
renderer work, scroll position, and all realized geometry observable at that
landmark. Absolute clock time belongs to $S_k$ even though the conjecture
proposes that it is not relevant once traversal speed and geometry are
accounted for.

Let $X_k$ be the geometric part of $S_k$. The central conjecture is that, after
adjusting for traversal speed, $X_k$ is sufficient for the distribution of a
future state at any specified position $k' > k$. The other components of
$S_k$, including its absolute clock time and run identity, should add no
predictive information. When future clock values are compared, they must be
expressed relative to $k$ or in the normalized observation clock; otherwise
the absolute clock at $k$ is trivially carried into $S_{k'}$.

This statement does not yet require a detailed definition of $X_k$. The tuple
below is a first proposal for making its geometric content measurable.

Let the supply area be an ordered one-dimensional document with deck intervals

$$D_i = [b_i, b_i + h_i)$$

where $b_i$ is the deck's document-coordinate top and $h_i$ is its supplied
height. Let $y_k$ be the viewport's document-coordinate position at landmark
$k$, $v$ the viewport height, and $a$ the activation distance. Ignoring the
boundary asymmetry visible in diagnostics, the geometric active interval at
that landmark is approximately

$$A(y_k) = [y_k - a, y_k + v + a].$$

If the next operation after $k$ is an upward jump of size $s_k$, its commanded
position is $y_k^* = y_k - s_k$. The sets of decks predicted to enter and leave
activity are determined by the interval differences

$$
\begin{aligned}
\operatorname{enter}_k &= A(y_k^*) \setminus A(y_k), \\
\operatorname{leave}_k &= A(y_k) \setminus A(y_k^*).
\end{aligned}
$$

The **strip-trigger conjecture** is that activation is caused by crossing the
newly entered strip, rather than by membership in $A(y)$ alone. In particular,
a formally inactive deck that is already geometrically inside the active area
does not become active merely because it is there. It remains inactive until
viewport movements move the deck outside $A(y)$ and back in the entering strip. Deactivation is conjectured to be triggered analogously by the leaving strip.

On this conjecture, intersecting $\operatorname{enter}_k$ and
$\operatorname{leave}_k$ with the ordered deck intervals predicts which deck
boundaries jump $k$ asks the renderer to process.
This is a proposed transition rule, not a directly exposed ChatGPT rule. It
would be falsified by a deck activating while it remains in the overlap
$A(y_k) \cap A(y_k^*)$, without a relevant strip crossing or another identified
activation stimulus.

Heights matter in addition to deck count: a long deck can span a boundary for
several jumps, while several short decks can cross it in one jump. The relevant
geometric input is consequently the local ordered height profile, not a deck ID
and not just total scroll distance.

For each deck, use the observable stage state

```text
inactive → geometrically active → formally active
formally active → geometrically inactive → height recorded → formally inactive
```

as an ordering model, not as a claim about ChatGPT's internal implementation.
The stages can coincide at one observation point. A deck between geometric
exit and formal inactivity carries a **deactivation debt**: the geometry has
requested deactivation, but the later observable work has not completed.

As a first measurable specification of the geometric projection, let

$$
X_k = (y_k,\ \text{local deck intervals},\ \text{activation boundaries},
       \text{anchor and slab clamp distances},\ \text{activation debts},
       \text{deactivation debts},\ \text{realized heights}).
$$

When the operation following $k$ is a jump, its realized size is derived from
this geometric state and the fixed jump policy rather than treated as an
independent component:

$$s_k = \operatorname{jumpPolicy}(X_k).$$

This tuple is provisional. Its purpose is to name a candidate sufficient
geometric projection against which repeated runs can be compared. Failure of
this particular tuple does not immediately refute the simple geometry
conjecture: it may instead show that $X_k$ omitted a relevant aspect of geometry
or renderer progress. The tuple, and therefore the precise form of the
conjecture, may be modified as the investigation proceeds. The simple
conjecture is refuted only if the residual behavior cannot be explained by a
defensible geometry-based refinement of the state.

Wall-clock duration is deliberately absent from $X_k$ because it is an outcome
of the realized geometric path. Traversal speed still affects how much debt is
discharged between movements, so comparisons across speeds must use an
observation clock (rAF opportunities or stage transitions), not raw
milliseconds. The two directions must be kept distinct: speed changes which
realization is observed at the next jump, while the realized geometry changes
jump clamping, jump count, stabilization work, and hence measured time.

### Probabilistic interpretation and falsification

For a fixed conversation, viewport, activation rule, jump policy, and browser
renderer, repeated runs sample different schedules over the same geometric
state machine. For a specified later landmark $k'$, let
$S_{k'}^{\mathrm{rel}}$ denote its state with clocks expressed relative to
$k$. The tentative $X_k$ formulation expresses the conjecture as:

$$
P(S_{k'}^{\mathrm{rel}} \mid S_k, \text{traversal speed})
= P(S_{k'}^{\mathrm{rel}} \mid X_k, \text{traversal speed}), \qquad k' > k.
$$

Equivalently, the non-geometric components $S_k \setminus X_k$ should add no
predictive information once $X_k$ and traversal speed are known. This is the
strong, presently tentative form. A safer form, supported by the fixed-deck
repetitions, is that geometry determines the repeatable *opportunities* for
activation and deactivation, while scheduling determines which stage is
observed before the extractor makes its next move.

This distinction gives the conjecture a falsification criterion. It fails if,
after matching the same local deck-height profile, boundary distances, jump
size, debt state, and rAF opportunity count, erasure rates still vary
systematically by run, wall-clock phase, content identity, or another omitted
variable. Such a result first rejects this definition of $X_k$. It rejects the
simple conjecture only if the residual cannot be explained by a defensible
geometry-based refinement of the state.

### Erasure conjecture

The observations support the following narrow model:

1. A jump moves one or more decks across an activation boundary.
2. At least one resulting deactivation is still pending after the movement's
   first observation opportunity.
3. The extractor issues another scroll command while that debt remains open.
4. Completion of the pending work restores the position captured after the
   preceding movement, erasing the new command.

The fixed-deck evidence establishes exact position restoration and its strong
association with pending deactivation. It does **not** establish who performs
the restoration. CSS scroll anchoring and ChatGPT's virtualizer remain
candidate mechanisms. Nor does it establish that every deactivation debt can
erase a jump. The geometric model predicts the exposure window; it does not
yet identify the internal commit operation.

For a non-split jump, erasure is detected by

```text
y_following = y_before
```

together with the retained anchor returning to its pre-command position. A
supply-height change is neither necessary nor sufficient: in the reference
geometry-only runs, 339 of 381 non-split erasures restored the pre-jump scroll
position without any supply-height change. This rules out an explanation in
which lost height alone cancels the movement.

### Why `split = true` and `T` appear to explain the erasure ratio

A split movement contains two scroll jumps inside one stabilization wait.
The first jump stops at an activation guard; the remaining `extraJump` is
issued in stabilization rAF 1. If the second jump is erased at the next
observation, the position restored is the position immediately after the
first jump. Thus the split experiment localizes the capture: it is refreshed
within the preceding rAF rather than retained from some much earlier jump.

Let $T$ be the total number of stabilization rAF callbacks in that wait and
$E_2$ mean that the split's second jump is erased. The tempting quantity is

$$P(E_2 \mid \operatorname{split} = \mathrm{true}, T = t).$$

It is descriptive, but it is not a causal erasure probability. $T$ is only
known after the wait and is partly caused by $E_2$. With the minimum stable
frame rule, an uneventful split can finish at its floor. An erasure changes the
observed scroll/anchor geometry, resets stability, and forces more callbacks.
Schematically,

```text
pending deactivation ─┬─→ second-jump erasure ─→ larger T
                      └─→ later stage observed ──→ larger T
```

Conditioning on $T$ therefore conditions on a post-command common effect. It
sorts waits by what happened during them rather than holding the opportunity
population fixed. This explains the otherwise striking reference result:
second-jump erasures were absent from 5,732 split waits ending at $T = 2$ or
$T = 3$, then appeared in the longer strata. It does not follow that waiting
until a wait has $T = 4$ causes erasure; an erasure can be one reason the wait
reaches four frames.

The predictive ratio should instead be conditioned on variables fixed before
the split's second jump. A first useful estimator is

$$
P(E_2 \mid \operatorname{split} = \mathrm{true},
  X_{\mathrm{pre\text{-}extra}}, O_{\mathrm{pre\text{-}extra}}).
$$

where $X_{\mathrm{pre\text{-}extra}}$ contains the local deck intervals,
distances to both activation boundaries, first-jump distance, `extraJump`, and
all open debts, and $O_{\mathrm{pre\text{-}extra}}$ is the number and kind of
observation opportunities since the boundary crossing. $T$ remains an outcome
used to check the model. This
also explains why split movements have a different raw erasure ratio: they
place a second jump deliberately inside the stabilization window, where a
pending deactivation can still commit.

### Predictions and required tests

The model makes the following testable predictions:

- Replaying the same conversation geometry and jump policy should reproduce
  per-region activation, deactivation, and erasure rates after matching rAF
  opportunity counts, even when absolute run time changes.
- Geometrically similar local height profiles should have similar transition
  rates even when their deck IDs and content differ.
- Among pre-command-equivalent states, open deactivation debt should dominate
  completed deactivation and no boundary crossing as an erasure predictor.
- Requiring one additional stable rAF before permitting the next jump
  should sharply reduce erasure by allowing debt to close. This intervention
  changes opportunity count and is more informative than stratifying on
  realized `T` afterward.
- If a split second jump is erased, the restored position should continue
  to be the post-first-command position. Restoration to an older position
  would falsify the proposed refresh point.
- A model using local geometry, debt stages, jump size, and pre-command rAF
  opportunities should generalize across repeated fixed-deck cycles. Residual
  predictive power from deck ID is evidence that the geometric state is
  incomplete, not evidence to absorb the ID as geometry.

Future diagnostic summaries should report both causal and outcome columns.
The causal table is keyed by the pre-command geometry/debt state and
observation opportunities. The outcome table reports erasure, resulting `T`,
height delta, formal transitions, and exact restoration. Keeping the two
tables separate prevents the `split`/`T` ratio from being mistaken for a
mechanism.
