# State of the investigation — jump erasure

Working index, 2026-08-08. Organised by conjecture. Nothing here is
established; the conjectures are what we work with, and the records below are
what they have so far failed to be killed by. Delete or correct freely.

Reference batch unless stated otherwise: `fixed-deck-runs/20260808-053846`,
30 cycles, Chromium, rule 6.11 (geometry only). Populations exclude retries
and treat split movements separately.

## Background conjectures

Held, not tested. If one of these fails, the records further down stop
naming what we think they name.

- **B1 Activation area.** The page activates and deactivates decks by an area
  extending `MIN_ACTIVATION_DISTANCE` above and below the viewport. Gives
  "geometric deactivation" its meaning; nothing in the page states it.
- **B2 Stages.** A deactivation proceeds through distinguishable stages that
  can occur in different frames: geometric exit, then the `--last-known-height`
  update, then last of all the `data-is-intersecting` flip and the removal of
  the section child, which happen synchronously in an irrelevant order.
  *Records:* the update precedes or coincides with the flip — 1620 before,
  1569 at the same `rafId`, none only after. The removal does not show as an
  actual height transition, 11 of 3189 at the flip's `rafId`, which is what
  the placeholder taking `--last-known-height` would produce: nothing to
  measure. Any residue, such as the recurring −16, would then be what the
  placeholder does not carry, e.g. a margin of the active deck.
- **B3 rAF ordering.** Observation points are ordered by `rafId`. Clocks give
  at most the order they imply relative to rAFs and are not used to order
  jumps against updates.
- **B4 What a read reports.** `supplyRoom()` reads the container's scroll
  offset, `supplyHeight()` its `scrollHeight`, `anchorRoom()` a difference of
  element boundary positions. We assume the reads are not stale: they
  report the document as mutated by whatever ran before our callback in this
  frame, not a snapshot of an earlier frame. (Reason, borrowed from documented
  browser behaviour and not tested here: these properties cannot be answered
  from invalidated boxes, so the read forces layout to be recomputed first.
  The extractor is passive, so nothing in these runs tests it.) What we then
  cannot see is anything the page does later in the same frame, in particular
  in rAF callbacks registered after ours; that ordering is not under our
  control and is not recorded.
  The scroll offset is not derived from layout; the browser may adjust it
  during layout, which is what C1 is about.
- **B5 Extractor passivity.** The extractor moves the viewport and observes;
  it never modifies the DOM. So every DOM change observed is the page's.
  This one we control, and it is cheap to re-verify.

## Conjectures under test

- **C1 Capture and commit.** A scroll position is captured, and later
  committed back; an erasure is a commit whose capture predates the jump. This
  is the long-standing conjecture of this investigation, not a new one. The
  variants — compensation attached to a rendering, or applied whenever
  `scrollY` changes by any route — are not worth separating: both give a
  capture and a commit, and what our data bears on is *when the capture
  happens*.
  *Constraint from the split:* when a split's second jump is erased, the value
  committed is the position from just after the first jump, so the capture is
  refreshed within the preceding rAF and is not held from earlier.
  *Candidate implementation, documented:* CSS scroll anchoring. Adjustments
  are queued when the anchor node moves and committed at the end of a
  suppression window, which the spec ends "immediately before the next
  operation whose result or side effects would differ as a result of a change
  in the scroll position (for example, an invocation of
  `getBoundingClientRect()`)". If so, `anchorRoom()` participates in choosing
  the commit moment. Unexplained under it: the commit equals our jump
  distance, which requires the compared offset to predate our jump.
  *Test not yet run:* the spec's suppression triggers (`margin`, `padding`,
  `width`, `height`, `transform` on the path to the scroller) cancel a queued
  adjustment. A style write between capture and commit should abolish erasure
  if this is the mechanism. Requires breaking B5, so it is an experiment run.
  *Prior form of C1:* an erasure is a scroll write-back, not a movement
  cancelled by lost height.
  *Forbids:* erasures that require a height change to account for the anchor
  returning; erasures landing on a position other than the pre-jump one.
  *Survived:* `scrollY` returns to the exact pre-jump integer in 380 of 381
  non-split erasures, with no height change at all in 339 of them; where the
  height moves it is −16 in 40 of 42.
  *Check:* `geometry.beforeJump` vs `geometry.followingRaf`.
- **C2 Pending deactivation.** The exposure is an unfinished deactivation: the
  deck has left the activation area and the page still owes work on it.
  *Forbids:* erasure at the same rate when no deck has left the area; erasure
  concentrated on *completed* deactivations.
  *Survived:* previous movement geometrically deactivated a deck with no later
  stage observed → 36.69% (226/616); with a later stage seen → 3.02%; no
  geometric deactivation → 0.14% and 0.00%. Later stages are individually
  suppressed at erasure: `--last-known-height` update 0.8% vs 20.1%, actual
  height transition 6.0% vs 27.5%, formal flip 30.2% vs 19.7%.
  *Depends on:* B1 for the attribution, B2 for the stages.
- **C3 Observation window.** What matters is how much was observed after the
  last movement, not how long the call ran.
  *Forbids:* erasure after a call that observed a change.
  *Survived:* 490 of 490 erasures follow a call that ended at `stableFrames`;
  0 in 7193 that ran longer. The three apparent exceptions follow split calls,
  where the floor is two frames and the second jump is issued at frame 1, so
  one frame followed it.
  *Relation to C2:* plausibly the same fact from the other side — a call
  returns without seeing anything exactly when the work is still owed.
- **C4 Shared cause, not effect.** The erasure and the length of the call are
  two readings of one event, so T is not a variable fixed before the call and
  its strata are not comparable populations.
  *Forbids:* treating a T-conditioned rate as a rate for a fixed population.
  *Survived:* second-jump erasures are absent from all 5732 split calls ending
  at T = 2 or 3 and climb monotonically after.

## Conjectures given up

- **G1** Erasure as a completed deactivation cancelling the movement through
  lost height — against C1's records.
- **G2** A fixed time threshold as half of the stabilization rule. 90 ms was
  tried in 6.10 and failed: per-deck oscillation periods are quantized to the
  vsync and sit at 5, 6, 7 or 9–12 of them, systematically above the bound for
  some decks. Admitting all would need > 267 ms.
- **G3** The oscillation itself as the mechanism of erasure — given up in
  earlier work of yours with another agent, not revived here. ±16 accounts for
  90 of 115 height deltas inside oscillation traces and for 40 of the 42
  height-changing erasures, which makes them related, not identical.
- **G4** Frame-skipping guards keyed on "any flipped deck currently active"
  (6.2, 6.3): once a deck stays active every frame is skipped, and the call
  never ends.

## Records that are not tied to a conjecture yet

- The lost movement is never regained: 599/599 at T = 4, 35/35 at T = 5,
  48/50 at T = 6. The page has no recovery procedure.
- There is no retry code path: `room` is unchanged so the same movement is
  recomputed, and all 419 post-erasure jumps request the identical
  `requestedJump`. No retry is erased (0/376).
- In split movements the second jump is erased far more than the first, 751 vs
  123 in 7815. `isErased` cannot see it: the first jump's progress keeps the
  whole movement from testing as erased.
- A change observed does not protect the next movement when the change was
  itself an erasure: 30.9% (38/123), against 24.8% when nothing was seen and
  0.02% when a change was seen that did not erase.

## Questions open

- **Q1** Who writes the position back — the page's virtualization or the
  browser. Not observable in the current runs.
- **Q2** Which of the three later stages closes the window; the 3.02% row of
  C2 pools them.
- **Q3** Whether deck size makes `activationNear` false and a pending
  deactivation co-occur, rather than the short branch merely failing to hide
  one. Needs `deactivationDistanceBelow` per jump; computed at
  [waitLayoutStable-diag.js:45](../src/app/waitLayoutStable-diag.js#L45) and
  dropped before the payload.
- **Q4** The N = 0 deck-level behaviour flagged in the 5.83 analysis.
- **Q5** T ≥ 7 is no longer produced under the escape rule, so questions about
  long calls need runs at the older rule.

## What this file does not carry

Written after a context compaction. Absent: the conjectures exchanged with
ChatGPT in the note series, the lag-N matching conventions, the earlier
Chromium/Firefox comparison, and whatever the 5.83 analysis settled. Those
have to come from you or from the notes.
