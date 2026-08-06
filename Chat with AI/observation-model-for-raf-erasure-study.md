# Observation model for the rAF erasure study

This note replies to
[Continue rAF erasure analysis with ChatGpt.md](./Continue%20rAF%20erasure%20analysis%20with%20ChatGpt.md),
which itself responded to
[audit-of-raf-observation-point-analysis.md](./audit-of-raf-observation-point-analysis.md).
It is a specification, not a further audit: it proposes the coordinate,
the ordering rule, the uncertainty bounds and the plotting rules that the next
collection and the next graphs should use. It also corrects three statements in
my earlier audit. That audit is left unedited, so the text ChatGPT responded to
remains intact.

Terminology as fixed earlier: **actual height** is measured geometry,
**last-known-height** is the `--last-known-height` value, and a
**last-known-height update** is an observed change of that value. "Height" is
never used alone. An **observation frame** is one execution of the deck sampler,
identified by `rafId`.

## 1. Corrections to the earlier audit

1. **The `1.25 s` falsification was not a measurement artifact.** My audit
   listed "the provisional `1.25 s` bound and its two violations" among the
   results contaminated by frame latency. That is wrong. Cycle 1 jump 603 and
   cycle 22 jump 480 have their closest qualifying update 32 and 22 observation
   frames earlier respectively, so the latency component is about 20 ms out of
   about 1,300 ms. The bound was refuted on its own terms. The artifact affects
   the short delays of the dominant erased population, not this tail.

2. **The one-frame stabilization finding is not a competing explanation.** My
   audit called it that. It is an added necessary condition inside the same
   mechanism, as the reply correctly argued. What it does explain is why the
   earlier rAF classification looked so sharp: "the update first became visible
   in the studied jump's own frame" and "the preceding wait returned after one
   frame" are two descriptions of one scheduling situation.

3. **"No delay figure should be quoted" was too strong.** With the bounds in
   section 4, delays for `d ≥ 1` are usable as intervals. Only the sub-frame
   regime carries no information.

A provenance note, since it caused confusion: the proposal to raise
`stableFrames` from 1 to 2 originated in recommendation 6 of my audit, not in
any earlier discussion. Section 5 explains why I now consider that particular
intervention non-diagnostic.

## 2. What the instrument can resolve

The sampler runs once per requested frame and reads every deck
([supplyWorker-diag.js:1138-1143](../src/app/supplyWorker-diag.js#L1138-L1143)).
Therefore:

- A last-known-height update is located to the interval between two consecutive
  observation frames of that deck, not to an instant.
- Two changes first seen in the same frame have no resolvable internal order.
- The resolution of any time axis is one observation interval, nominally 16.7 ms
  but longer whenever the extractor requests no frame.

Consequently the primary coordinate should be ordinal, and physical time should
appear only as a bounded interval.

## 3. Ordering rule

The study document specified value-based ordering at the outset: "we should
additionally verify that the jump rAF still observed the old height. That direct
value comparison supplies the ordering"
([Analyze jump erasure using rAF observation points.md:64](./Analyze%20jump%20erasure%20using%20rAF%20observation%20points.md#L64)).
This was never implemented. `classifyJumpByPrecedingUpdateDiagnostics` orders by
`update.clock <= jump.clock` and breaks ties on clock equality
([rafDeckStudy-diag.js:234-243](../src/app/rafDeckStudy-diag.js#L234-L243)),
mixing an rAF vsync timestamp with `performance.now()`.

The specified comparison is exactly recoverable from `rafId`, because `rafId`
increments once per observation frame and an update's `rafId` is the frame in
which its new value first became visible. With `F(J)` the jump's own observation
frame (`rafNumber == 0`, same jump number):

| Relation | Meaning in value terms |
|---|---|
| `u.rafId < F(J).rafId` | the jump's own frame already saw the new value |
| `u.rafId == F(J).rafId` | the new value became visible in the jump's own frame |
| `u.rafId > F(J).rafId` | the jump's own frame still saw the old value |

**Proposed rule.** Order by `rafId`. Do not use `clock` for any comparison.

Measured effect over the 30 runs of `20260805-180312`: the two rules select the
same candidate set for 31,438 of 31,519 jumps and differ for **81**. In every one
of the 81, the clock rule admits an update whose observing frame is later than
the jump's own frame — that is, a value the jump had not yet seen. 76 of them
were selected as the unique closest preceding update. The defect is small in
count and concentrated exactly where the value check was meant to apply.

## 4. Time as a bounded interval

Record `performance.now()` at callback entry, call it `t_exec(F)`, and keep the
vsync timestamp separately and labelled as such. Under the instrumental
assumption that the write occurred after the previous observation of that deck
and no later than the observing one, the update-to-jump interval is bracketed:

\[
t_{\text{jump}}-t_{\text{exec}}(F)
\;\le\;
\Delta
\;\le\;
t_{\text{jump}}-t_{\text{exec}}(F-1)
\]

Measured on the erased population with vsync timestamps as the only currently
available proxy: lower bound median 21.4 ms, bracket width median 16.7 ms, 95th
percentile 49.9 ms, maximum 166.7 ms. So a typical erased observation is
`[21, 38] ms` and an occasional one `[21, 188] ms`.

One consequence deserves stating plainly. For `d = 0` no frame is requested
between the observing callback and the command, so the recorded delay is
dispatch lateness plus callback and probe duration, not elapsed time since the
update. Once `t_exec` is recorded, the `d = 0` delays will collapse to a few
milliseconds. That population's information is entirely ordinal; there is no
sub-frame axis to draw for it.

## 5. Why the proposed two-frame intervention is not diagnostic

The stabilization loop decides "changed" from `{scrollHeight: supplyHeight(),
scrollY: supplyRoom()}` against `TOLERATED_ROUNDING = 1`, resetting the stable
counter on any change and returning at `unchanged >= stableFrames`
([waitLayoutStable-diag.js:145-148](../src/app/waitLayoutStable-diag.js#L145-L148),
[:170](../src/app/waitLayoutStable-diag.js#L170)). The jump probe records the
same two quantities, so what a second required frame would have seen is
measurable from the existing data. Comparing the accepted geometry at the frame
where the wait exited with the geometry at the frame in which the next jump was
prepared:

| Outcome | Jumps | `scrollHeight`/`scrollY` changed |
|---|---:|---:|
| erased | 773 | **0** |
| survived | 29,943 | 2,030 |
| retry-succeeded | 773 | 0 |

In all 773 erasure cases the second stable frame would have been satisfied at
once, so the wait would have returned anyway, one frame later. The intervention
does change behaviour for 6.8% of survived jumps, but not for the erasure-prone
ones. This is by design: `--last-known-height` exists to hold supply height
constant across deactivation, so the detector is blind to the pending work.
Consistently, the restoration shows as a `scrollY` change in 773 of 773
erasures but as a `scrollHeight` change in only 100.

Therefore neither outcome of that experiment is informative. A reduction would
show only that one extra frame suffices for the work to land; a null result
would not bear on the ordering conjecture, because the wait never waited for the
work.

Related caution: the `0/9,192` result is a selection effect, not an
intervention. Under `stableFrames = 1`, a wait can exceed one frame only if some
frame showed a change or anchor movement, which is to say only if the work had
already become observable. The group is defined by the absence of the condition
that produces erasure, so it cannot forecast what a forced two-frame wait would
do.

## 6. Proposed interventions instead

1. **Dose-response.** Insert `k` extra frames before the command, `k = 0,1,2,3`,
   leaving the geometry criterion untouched, and measure the erasure rate against
   `k`. This distinguishes "one more frame suffices" from "the work must be
   observed"; the binary change cannot.
2. **Gate on the predicted decks resolving.**
   `checkUpdateNeededBeforeDeactivation` already computes the decks predicted to
   cross the boundary and `pendingDeactivationPredictions` already tracks them.
   Requiring their last-known-height update or formal state to be observed
   intervenes on the mechanism rather than on a blind proxy.
3. **Compare rates, not counts.** Cycles already differ in jump count
   (1,056 versus 1,057), and any change to the wait will drift the realized jump
   sequence.

## 7. Proposed graphs

**Primary panel — exact, no instrumental assumption.** Erasure ratio against
`d = F(J).rafId − u.rafId`, with the update selected by `rafId` and the deck
required to have geometrically deactivated by the studied jump. Over the 30 runs
of `20260805-180312`, retries excluded from the ratio:

| `d` (frames) | jumps | erased | survived | erasure ratio |
|---:|---:|---:|---:|---:|
| 0 | 1,123 | 697 | 426 | 62.1% |
| 1 | 3,475 | 1 | 3,382 | 0% |
| 2 | 625 | 1 | 564 | 0.2% |
| 3 | 3,628 | 37 | 3,183 | 1.1% |
| 4 | 1,120 | 10 | 972 | 1.0% |
| 5 | 2,616 | 1 | 2,614 | 0% |
| 6 | 856 | 0 | 833 | 0% |
| 7 | 2,588 | 1 | 2,538 | 0% |
| ≥ 8 | 15,278 | 25 | — | ~0.2% |

This is the same relationship the millisecond axis was reaching for, on a
coordinate that needs no assumption. It also relocates the former `N = 2` and
long-delay anomalies: they appear as a distinct bump at `d = 3` and `d = 4`,
47 erasures in total, which is a better place to study them than a millisecond
tail.

**Secondary panel — physical time, `d ≥ 1` only.** Each observation is a
horizontal segment given by the bracket of section 4. Rules: never bin finer
than one observation interval; where segments straddle a bin boundary, draw the
ratio as an upper and lower envelope rather than a line; show counts, since a
ratio from one run and a ratio from twenty do not carry equal weight.

The earlier 5 ms bins were three times finer than the resolution, which is why
they read as structured but non-monotone (86%, 99%, 93%, 98%). That variation
was inside one frame.

## 8. Instrumentation required before the next batch

1. `performance.now()` at callback entry, kept separately from the vsync
   timestamp, and every ordering derived from `rafId`.
2. Fix the episode lookup for `lagN` and `selectedEpisodeId`: choose the latest
   episode whose geometric deactivation precedes the studied jump, not the deck's
   first episode
   ([rafDeckStudy-diag.js:249](../src/app/rafDeckStudy-diag.js#L249)).
3. Let a deck open a new episode when a previous one never formally deactivated,
   or record the dropped predictions
   ([rafDeckStudy-diag.js:31](../src/app/rafDeckStudy-diag.js#L31)).
4. Export the stabilization telemetry already collected by
   `recordStabilizationRuleDiagnostics` and `recordRafTelemetryDiagnostics`:
   `stableFrames`, `activationNear`, `geometryChangeMagnitude`, `unchanged`.
   Without it none of section 5 can be analysed from a batch, and note that the
   contemplated change touches only the `trackAnchor && !activationNear` branch.
5. Record, per jump, the stabilization-frame count of the preceding jump.
6. Rename `geometricDeactivation*` to mark it as a pre-command prediction, or add
   post-command verification
   ([supplyWorker-diag.js:347-391](../src/app/supplyWorker-diag.js#L347-L391)).

## 9. What remains untested in the conjecture

Ordering evidence, once placed on the `rafId` axis, supports the sequence:
the preceding wait returned after one frame, the studied jump was issued, the
update became visible in the jump's own frame, and further observable change
required additional frames. Nothing in this note or in the audits touches the
explanatory core:

- that geometry is saved;
- that the later event is a commit;
- that what is restored is what was saved;
- which deck's process performed the restoration.

Erasure is still detected only as zero net anchor progress
([moveAnchorToBottom-diag.js:134](../src/app/moveAnchorToBottom-diag.js#L134)).
Those four claims need an observation or intervention that reaches the saved
geometry itself; no refinement of the time axis will reach them.

## 10. Reproducing the figures in this note

All figures come from standalone scripts over
`fixed-deck-runs/20260805-180312/cycle-*.json`, using exported fields only:

- **Ordering discrepancy.** Build the candidate set twice, once by
  `update.clock <= jump.clock` with tie on equal clock, once by
  `update.rafId <= F(J).rafId` with tie on equal `rafId`; count jumps where the
  sets differ.
- **Bracket width.** For each erased jump take the selected update's observing
  frame and the immediately preceding rAF record; the lower bound is
  `jump.clock − observing.clock`, the width is
  `observing.clock − previous.clock`.
- **Second-frame test.** Compare `geometry.followingRaf` of jump `J − 1` with
  `geometry.beforeJump` of jump `J` on `scrollHeight` and `scrollY`, with a
  1 px tolerance on `scrollHeight`.
- **Ordinal table.** Group jumps by `d`, restricting updates to those saving an
  adjacent actual-height state and to decks whose
  `geometricDeactivationJumpNumber` does not exceed the studied jump.
