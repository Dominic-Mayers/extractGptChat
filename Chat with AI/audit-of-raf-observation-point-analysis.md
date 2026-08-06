# Audit of "Analyze jump erasure using rAF observation points"

This note audits the conclusions recorded in
[Analyze jump erasure using rAF observation points.md](./Analyze%20jump%20erasure%20using%20rAF%20observation%20points.md).

Date of audit: 2026-08-05. Auditor: separate session, no access to the audited
session's reasoning, working only from the document, the current sources, and
the retained run folders.

Terminology follows the distinction fixed in the audited document: **actual
height** is the measured geometry, **last-known-height** is the
`--last-known-height` value, and a **last-known-height update** is an observed
change of that value. The word "height" is never used alone.

## 1. Method

Two independent activities:

1. **Recomputation.** Every statistic in the document that could be recomputed
   was recomputed from the retained batches, using scripts written from the
   document's stated definitions rather than reused from the audited session:

   - `fixed-deck-runs/20260805-140057` — 30 runs, version 5.82
   - `fixed-deck-runs/20260805-160709` — 30 runs, version 5.83
   - `fixed-deck-runs/20260805-180312` — 30 runs, version 5.83

2. **Instrument reading.** The collection path was read to establish what each
   exported field actually contains:

   - [rafDeckStudy-diag.js](../src/app/rafDeckStudy-diag.js)
   - [supplyWorker-diag.js](../src/app/supplyWorker-diag.js)
   - [waitLayoutStable-diag.js](../src/app/waitLayoutStable-diag.js)
   - [scrollContainer-diag.js](../src/app/scrollContainer-diag.js)
   - [moveAnchorToBottom-diag.js](../src/app/moveAnchorToBottom-diag.js)
   - [cycleDiagnostics-diag.js](../src/app/cycleDiagnostics-diag.js)

`npm run check` passes on the current working tree (version 5.83, uncommitted).

## 2. Statistics that reproduce exactly

For `20260805-180312`, every recomputed value agrees with the document:

| Reported | Recomputed |
|---|---|
| Jump outcomes | 29,973 survived, 773 erased, 773 retry-succeeded |
| Last-known-height updates | 10,048 |
| Updates saving a value that is not an adjacent actual-height state | 0 |
| Updates sharing an observation boundary with an actual-height transition | 96 (70 new state, 26 preceding state, 0 neither) |
| Preceding-state cases | 25 of the `46 → 56` deck, 1 of a `578 → 586` deck |
| Erased jumps with no qualifying preceding update | 0 |
| Survived jumps with no qualifying preceding update | 210, all of them jumps 1–7 |
| Closest qualifying delay, median | erased 21.2 ms, survived 433.6 ms, retry-succeeded 161.5 ms |
| Closest qualifying delay within 25 ms | 489/773, 104/29,973, 26/773 |
| Violations of the provisional `1.25 s` bound | 2: cycle 1 jump 603 (1323.3 ms), cycle 22 jump 480 (1259.9 ms) |
| Completed deactivations with more than one post-geometric update | 0, in all three batches |

No invented or mistranscribed figure was found. The `773`/`773` coincidence in
the proximity table is genuine: each erasure is followed by exactly one
retry-succeeded jump.

## 3. Finding 1 — the delay axis measures frame latency, not update-to-jump time

This is the finding that most affects the recorded conclusions.

**Two incompatible clock bases are mixed.** `clock` for an rAF observation is
the rAF **vsync timestamp**
([scrollContainer-diag.js:84](../src/app/scrollContainer-diag.js#L84)), whereas
the jump command clock
([supplyWorker-diag.js:1075](../src/app/supplyWorker-diag.js#L1075)) and the
geometric-deactivation clock
([supplyWorker-diag.js:388](../src/app/supplyWorker-diag.js#L388)) are
`performance.now()` taken at execution time. A frame's vsync timestamp can
precede a callback that in fact executes later, so timestamp order is not
execution order.

**Consequence A — `jumpDelayMs` is instrument latency.** For the 1,079 jumps in
`20260805-180312` whose unique selected update carries the studied jump's own
jump number, `jumpDelayMs` is bit-identical to
`jump.clock − ownJumpRaf.clock` in 1,003 cases. That quantity — command time
minus the vsync timestamp of the frame that observed the update — ranges
5.2–516.9 ms across all 31,519 jumps, with median 12.3 ms. It is composed of
frame dispatch lateness, the sampler's own ~348 `getBoundingClientRect()` calls,
and the jump geometry probe.

Because 89.8% of erased jumps have their closest qualifying update in their own
frame, against 1.4% of survived jumps, the erased-side delay distribution
(median 21.2 ms) is essentially the latency distribution (median 19.1 ms for
erased jumps), while the survived-side distribution (median 433.6 ms) spans real
frames. **The two medians are not measurements of the same physical quantity.**

Therefore the following recorded results describe main-thread lateness between
an observation and a command, not the interval between a presumed geometry save
and a jump:

- the 5 ms erasure-ratio bins (86% … 99% … 0/302);
- the provisional `1.25 s` bound and its two violations;
- the fixed-deck claim that erased and retained delays never overlap. This
  reproduces on the current batch — 37 of 37 mixed decks separated, empty
  intervals 44.3–164.5 ms — but it is a separation in latency.

**Consequence B — "preceding" is not reliably preceding.** 2,772 stabilization
rAFs per batch carry a jump number whose command clock is later than the rAF
timestamp. Of the selected "observed in the studied jump's rAF" cases, 76 are in
fact the preceding jump's first stabilization frame. All 76 are non-erased, so
correcting them makes the document's structural split sharper, not weaker — but
the class as reported is contaminated.

**Consequence C — the post-geometric classification inherits the same defect.**
The document states there are "no exceptions" to the deactivation rule. Two
completed episodes in `20260805-180312` (cycles 10 and 25) and four in
`20260805-140057` have an empty last-known-height recorded at geometric
deactivation and no update classified as post-geometric. Both of the former have
`geometricDeactivationJumpNumber == formalDeactivation.jumpNumber` and exactly
one update overall: the update was observed in a frame whose vsync timestamp
falls before the `performance.now()` of the geometric-deactivation record.

## 4. Finding 2 — an unreported determinant of erasure

**No erasure occurred anywhere in the 30 runs unless the preceding jump's
stabilization wait ran exactly one frame.**

| Stabilization frames of the preceding jump | Jumps | Erased |
|---:|---:|---:|
| 1 | 22,327 | 773 |
| 2 or more | 9,192 | **0** |

All 773 erasures fall in the first row (3.46% there, 0% elsewhere). Erased jumps
themselves always take 2 or more stabilization frames (minimum 2, median 2),
consistent with the extra layout activity by which the erasure is detected.

This is not incidental. [waitLayoutStable-diag.js:45](../src/app/waitLayoutStable-diag.js#L45)
sets `stableFrames = 1` when `trackAnchor && !activationNear`. So the condition
"the deck's last-known-height update was first observed in the studied jump's
own rAF" and the condition "the extractor resumed after a single stable frame,
before the deactivation had landed" are nearly the same event.

This yields a competing explanation of the document's central classification —
extractor-side, and directly testable by changing `stableFrames` or by waiting
for pending deactivation predictions to resolve. The transaction-lifetime
explanation, by contrast, never observes a save or a commit.

## 5. Finding 3 — defects in the exported study data

1. **`lagN` is computed against the wrong episode.**
   [rafDeckStudy-diag.js:249](../src/app/rafDeckStudy-diag.js#L249) resolves the
   deck with `episodesDiagnostics.find(...)`, which returns the deck's *first*
   episode of the run. Eleven decks in `20260805-180312` have more than one
   episode, and 16 exported `lagN` values are wrong — for example cycle 3 jump
   440 reports `N = −12` for a deck whose two geometric deactivations occur at
   jumps 452 and 453, so it had not deactivated at all. The negative-`N`
   anomalies discussed at length in the document are partly this defect.

2. **Repeat geometric deactivations are dropped.**
   [rafDeckStudy-diag.js:31](../src/app/rafDeckStudy-diag.js#L31) returns early
   while an episode is open. 690 episodes never formally deactivate, so those
   decks can open no further episode for the rest of the run.

3. **Geometric deactivation is a prediction, not an observation.**
   [supplyWorker-diag.js:347-391](../src/app/supplyWorker-diag.js#L347-L391)
   records it *before* the command, from `rect.top + jump`, labelled
   `movementJumpNumberDiagnostics + 1`. The document treats it as an observed
   deck event and builds eligibility rules on it. "The studied jump has `N = 1`"
   means "the studied jump follows the jump that was predicted to push the deck
   past the deactivation boundary".

4. **Erasure is defined as zero net anchor progress.**
   `jumpWasErased = obtainedRoom === room`
   ([moveAnchorToBottom-diag.js:134](../src/app/moveAnchorToBottom-diag.js#L134)).
   Nothing about restoration is observed. Consequently "erasing transaction",
   "saving the geometry" and "commit" are unobserved throughout the document.
   The corollary that all 773 erased jumps returned exactly to their
   before-jump `scrollY` reproduces, but it is close to tautological under this
   definition and is not independent evidence.

5. **Observer effect.** The sampler reads every deck's bounding rectangle in
   every sampled frame
   ([supplyWorker-diag.js:1138-1143](../src/app/supplyWorker-diag.js#L1138-L1143)),
   forcing layout inside the frames whose timing is the measurement.

## 6. Bookkeeping errors in the document

1. **A subset presented as a total.** "All 691 erased jumps were associated with
   updates made while actual height was stable, and all 691 returned exactly to
   their before-jump `scrollY`" and the restatement that follows it. That batch
   (`20260805-160709`) contains **781** erased jumps. 691 is exactly the number
   with a unique selected update; 90 have tied candidates. The document itself
   reports 781 later, without noting the discrepancy.

2. **An impossible denominator.** The table of candidate-free ratios by `N`
   gives the identical denominator `2802` for `N = 0` through `6`. A per-`N`
   count of valid pairs must decrease as `N` grows, because
   `J_geometric + N` eventually exceeds the final jump. The figure looks like
   the deck-with-observed-update count reused as a denominator. The batch has
   been deleted, so this cannot be settled.

3. **Deleted evidence for retained conclusions.** The 5.80 and 5.81 headline
   results — 14/14, 151/151, 500/546, and the 47/9/41 fixed-deck split — rest on
   `20260805-055532` and earlier folders, removed during the cleanup recorded in
   the document. The conclusions remain in the record without the data that
   produced them. Only the 5.82 and 5.83 claims are now auditable.

## 7. Method-level observations

- The final existential conjecture admits a median of 195 qualifying candidates
  per erased jump. The document acknowledges this weakens corroboration. The
  sharper statement available from the same data is binary and needs no
  millisecond axis: *a last-known-height update belonging to an
  already-deactivating deck became newly visible in the very frame in which the
  studied jump was issued.* That holds for 694 of 773 erased jumps and for 426
  of 29,973 survived jumps.
- The conjecture was revised repeatedly in response to small exception sets —
  the candidate rule, the `N` bound, the closest-update rule, the eligibility
  condition, the `1.25 s` bound. Each revision was reasonable in isolation, but
  no version was ever tested on data collected *after* it was fixed, except the
  `1.25 s` bound, which was falsified immediately. Fixing a rule before
  collecting is the discipline that is missing.
- The document's several self-corrections about wording (subset versus total,
  "no exceptions", actual height versus last-known-height) were all initiated by
  the user's questions, not by the analysis. The failure mode is systematic:
  quantities are reported with more universality than the computation supports.

## 8. Recommended changes before further collection

1. Record `performance.now()` at callback entry alongside the vsync timestamp,
   and derive every ordering and delay from that single basis. Until this is
   done, no delay figure in the document should be quoted.
2. Fix the episode lookup used for `lagN` and `selectedEpisodeId`; select the
   latest episode whose geometric deactivation precedes the studied jump.
3. Allow a deck to open a new episode when a previous one never formally
   deactivated, or record the dropped occurrences explicitly.
4. Record, for every jump, the stabilization-frame count of the preceding jump.
   It currently separates erased from retained jumps absolutely and is under our
   control, so it belongs in the primary dataset.
5. Rename `geometricDeactivation*` to reflect that it is a pre-command
   prediction, or record the post-command verification separately.
6. Decide the `stableFrames` experiment before collecting: if raising it to 2
   for `trackAnchor` waits removes the erasures, the mechanism question changes
   shape entirely.

## 9. Reproducing this audit

All figures above come from small standalone scripts over
`fixed-deck-runs/*/cycle-*.json`, using only the exported study fields. The
distinguishing checks are:

- **Delay equals frame latency.** For jumps where
  `precedingLastKnownHeightUpdateCandidates` has one element whose `jumpNumber`
  equals the jump's, compare `jumpDelayMs` with
  `jump.clock − raf.clock` for the `rafNumber == 0` observation of the same jump
  number.
- **Timestamp order is not execution order.** Report stabilization rAFs whose
  `clock` is smaller than the command clock of the jump number they carry.
- **Stabilization determinant.** Count `rafKind == "stabilization"` records per
  jump number and tabulate the count for `jumpNumber − 1` against each jump's
  outcome.
- **`lagN`.** Recompute `N` from the latest episode of `selectedDeckId` whose
  `geometricDeactivationJumpNumber` does not exceed the jump number, and compare
  with the exported value.
