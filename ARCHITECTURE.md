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
realized jump $s_{k}$. Geometry changes after that jump alter the next distances
and therefore the next clamp. More explicitly,

$$
\begin{aligned}
s_{k} &= \mathrm{clamp}(\mathrm{maxJump}, \text{realized geometry at } k), \\
\tau_{\mathrm{run}} &\approx \sum_{k} (F + Rs_{k} + W_{k}).
\end{aligned}
$$

where $W_{k}$ is additional stabilization work induced by changes in realized
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

## Geometric Traversal Research Program and Current Conjectures

### Research program

The fixed conversation supplies a repeatable ordered geometry, but each run realizes it somewhat differently. Activation, deactivation, height substitution, clamping, and scroll adjustment can alter the sequence and timing of jumps.

Our research program is to explain the repeatable distributions of activations, deactivations, and erasures from:

- the fixed geometry of the conversation;
- its run-dependent realized geometry;
- the traversal speed, measured in rAF opportunities rather than milliseconds.

This is a research program, not itself a falsifiable conjecture. It guides the construction of narrower conjectures below.

### Basic assumptions

The supply area is modelled as an ordered sequence of deck intervals. An active area extends above and below the viewport.

A movement can sweep deck boundaries through two geometric strips:

- an entering strip, which can request activation;
- a leaving strip, which can request deactivation.

Geometric deactivation and formal deactivation are distinct landmarks. Geometry first requests that a deck deactivate; the observable formal transition may occur later. Their separation is the **deactivation debt**.

The sequence of jumps is expected to be regular across fixed-deck runs, with random variation caused by realized geometry. Absolute jump rank is therefore investigated as a possible identifier of recurring jump opportunities, but is not assumed to be universally stable.

### Strip-trigger conjecture

A formally inactive deck already inside the active area remains inactive until an entering strip crosses its interval or boundary. Deactivation is triggered analogously by a leaving-strip crossing.

This conjecture would be falsified by a deck activating inside the overlap of two consecutive active areas without a relevant boundary crossing or another identified stimulus.

### Deactivation-window conjecture

Let:

- \(G_r(d)\) be the rank of the jump geometrically deactivating deck \(d\);
- \(F_r(d)\) be the rank of the first-attempt jump whose observation sequence
  contains the rAF interval where formal deactivation is observed; this can be
  the jump rAF, which contains the synchronous jump in its callback, or a
  subsequent stabilization rAF for that jump;
- \(D_r(d)=F_r(d)-G_r(d)\) be its deactivation debt;
- \(j\) be a recurring jump rank associated with \(d\);
- \(N_r(j,d)=j-G_r(d)\);
- \(k_r(j,d)=j-F_r(d)=N_r(j,d)-D_r(d)\).

Larger \(k\) means that jump \(j\) occurs later relative to formal deactivation.

The primary conjecture concerns \(N=1\):

> When jump \(j-1\) geometrically deactivates deck \(d\), increasing its stabilization count \(T_{j-1}\) tends to reduce \(D_r(d)\), thereby increasing \(k_r(j,d)\). Formal deactivation is then more likely to commit before jump \(j\), suppressing its erasure.

This is falsified if, for recurring \((j,d)\) pairs, larger \(T_{j-1}\) does not shift \(k_r(j,d)\) upward, or systematically shifts it downward.

For \(N=0\), the analogous timing relation uses \(T_j\). Because \(T_j\) is measured during stabilization after jump \(j\), it cannot be a pre-jump explanation of that jump’s erasure.

### Identification of recurring pairs

Candidate pairs \((j,d)\) are discovered from erased jumps near the formal deactivation of \(d\). For each deck, ranks are compared across the relative rAF positions in which nearby erasures occur.

The quantity \(m(d)\) counts the distinct ranks that maximize the erasure count at one or more such positions. Decks with \(m(d)=1\) provide the clearest initial test: the same rank \(j\) is identified despite variation in its position relative to formal deactivation.

### Current corroboration

In the 21-run 6.23 batch:

- \(425\) of \(756\) decks have \(m(d)=1\);
- geometric-to-formal debt was always zero or one jump;
- among \(m(d)=1\) decks with variation in both \(T\) and \(k\), all \(13\) comparable \(N=1\) decks shifted toward larger \(k\) at higher \(T_{j-1}\);
- all \(38\) comparable \(N=0\) decks showed the analogous relation with \(T_j\).

The \(13/13\) \(N=1\) result is the primary corroboration of the proposed mechanism. The \(38/38\) \(N=0\) result corroborates a relationship between stabilization and deactivation progress, but does not explain erasure prospectively.

These results are exploratory because the candidate pairs were discovered and
evaluated in the same batch. Confirmation requires freezing the pairs and
testing the predictions on new runs.
