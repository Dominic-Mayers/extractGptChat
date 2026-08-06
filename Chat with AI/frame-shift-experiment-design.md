# Frame-shift experiment: design and pre-registered predictions

This note replies to
[Response to "Observation model for the rAF erasure study"](./response-to-observation-model-for-raf-erasure-study.md).
It concedes that note's central objection, explains why my own measurement in
fact supports the intervention it was used to criticise, and then fixes the
design and the predictions before any data are collected.

Terminology as in the previous notes: **actual height**, **last-known-height**,
**last-known-height update**, and **observation frame** identified by `rafId`.
The ordinal coordinate is

\[
d = F(J).\mathrm{rafId} - u.\mathrm{rafId},
\]

with `F(J)` the studied jump's own observation frame and `u` the frame in which
the selected last-known-height update first became visible.

## 1. Withdrawal

Section 5 of
[observation-model-for-raf-erasure-study.md](./observation-model-for-raf-erasure-study.md)
concluded that neither outcome of a forced second stable frame would be
informative. That conclusion is withdrawn. The reply is correct: the wait
returning one frame later is not the absence of an intervention, it *is* the
intervention, because it moves the studied jump from `d = 0` to `d = 1` — the
coordinate on which the entire result rests.

The measurement that led me astray was right; its significance was inverted.
Because the stabilization detector is blind to the pending deck operation, the
added frame is never extended by that operation: in all 773 erasure cases the
manipulation is a clean, deterministic shift of `d` by one, with no feedback
through the stability criterion. That is the most desirable property an
intervention can have — one variable moves and nothing else does. I read a
well-isolated manipulation as an ineffective one.

Two further points from the reply are accepted without reservation: inserting
frames after stabilization is preferable to changing `stableFrames`, since it
leaves the production criterion untouched; and the cautions in its section 6
about gating on deck observations are correct, in particular that preventing
erasure by gating would show only that the gated observation is a usable
synchronization condition, not that it is the commit.

## 2. One residual caveat

The shift is *at least* one frame, not exactly one. Anchor movement also resets
the stable counter
([waitLayoutStable-diag.js:152](../src/app/waitLayoutStable-diag.js#L152)), and
anchor stability is not reconstructible from the exported data. The realized
shift must therefore be recorded per jump rather than assumed: for every
inserted frame, record whether it was counted stable, and record the resulting
`d` for the studied jump.

## 3. The confound both notes carried

Both my dose-response proposal and the reply's version compare whole runs
collected at different `k`. That changes the global regime: every jump receives
extra frames, so deck deactivations shift relative to jumps throughout the
traversal, and the two arms are two different dynamical systems rather than one
system with one variable moved.

**Proposal: randomize `k` per jump**, from a recorded seed, so both arms occur at
every traversal location inside the same run and the comparison is paired.
Treatment spills over to the following jump, so `k(J-1)` must be recorded and
conditioned on in the analysis.

## 4. The primary analysis, fixed in advance

The intervention's real target is not the erasure rate as such. It is this
question:

> Is `P(\text{erasure} \mid d)` invariant to how `d` was produced?

Under `k = 1` some jumps will still land at `d = 0`, because the update
sometimes becomes visible in the jump's own frame regardless. Comparing those
with the `d = 0` cases of the `k = 0` arm tests invariance directly, with no
counterfactual matching required.

Three analyses, in this order:

1. **Invariance.** `P(erasure | d)` computed separately per arm, for `d = 0, 1,
   2, 3`. If `d` is the operative variable, the curves coincide.
2. **Distribution shift.** The distribution of `d` per arm, to confirm that the
   manipulation did what it is supposed to do.
3. **Rate.** Erasure rate per jump per arm, as the practical bottom line.

## 5. Pre-registered predictions

From the 30 runs of `20260805-180312`, at `k = 0`:

| Population | Jumps | Erased | Rate |
|---|---:|---:|---:|
| `d = 0` | 1,123 | 697 | 62.1% |
| `d = 1` | 3,383 | 1 | 0.03% |
| all jumps, retries excluded | 30,746 | 773 | 2.51% |

At deck level within the `d = 0` population there are 105 decks: **51 erase in
every run in which they appear**, accounting for 324 of the 697 erasures; 9
never erase; 45 do both.

Predictions to be fixed now and not revised after seeing the data:

- **If ordinal position is operative.** Under `k = 1` the erasure rate for jumps
  shifted to `d = 1` falls to the `d = 1` level, of order a few tenths of a
  percent, and the overall erasure rate falls by roughly the share of erasures
  that came from `d = 0`, which is 697 of 773. The 51 always-erasing decks stop
  erasing at their shifted jumps.
- **If `d = 0` is a marker rather than a cause** — for instance if erasure is
  governed by a per-deck property that also determines when the update becomes
  visible — the rate for those same jumps stays near 62%, and the 51
  always-erasing decks continue to erase.
- **If the opportunity window is wider than one frame**, the rate declines
  monotonically over `k = 0,1,2,3` rather than collapsing at `k = 1`. The width
  in frames is then the quantity to report.
- **Falsification of invariance.** If `P(erasure | d = 0)` differs between arms,
  `d` is not sufficient, whatever happens to the overall rate. This is the most
  informative single outcome and should be reported first.

Power is adequate: `d = 0` occurs about 37 times per run, so 30 runs with
per-jump randomization give roughly 550 cases per arm against a 62% baseline.

## 6. What the experiment still cannot do

It tests when an erasure is possible. It does not observe the saved geometry,
the commit, or whether what is restored is what was saved, and it cannot say
which deck's process performed the restoration. Erasure remains detected only as
zero net anchor progress. Those four claims require an instrument or intervention
that reaches the saved geometry; no frame-level manipulation reaches them.

## 7. Collection order

1. Instrumentation repairs first, as listed in section 8 of the observation-model
   note: ordering from `rafId`, callback-entry `performance.now()` kept separate
   from the vsync timestamp, episode-selection fix, repeated predictions
   retained, stabilization telemetry exported.
2. Then a `k = 0` batch under the repaired instrument, to confirm the baseline
   figures above still hold when ordering no longer uses clocks.
3. Then the randomized `k \in \{0,1\}` batch, with `k`, `k(J-1)`, the realized
   `d`, and per-inserted-frame stability recorded for every jump.
4. Then `k \in \{0,1,2,3\}` if and only if step 3 shows a partial effect.

Step 2 matters because every figure in section 5 was computed with the clock-based
ordering. The 81 misordered jumps are few, but the baseline should be restated
under the rule the experiment will use.

## 8. Reproducing the deck-level figures

Over `fixed-deck-runs/20260805-180312/cycle-*.json`, excluding retry jumps:
select, for each jump, the latest last-known-height update with
`u.rafId <= F(J).rafId` whose value equals an adjacent actual-height state and
whose deck has `geometricDeactivationJumpNumber <= J`; keep the jumps where that
update's `rafId` equals `F(J).rafId`; group by the update's deck and count erased
against retained outcomes per deck.
