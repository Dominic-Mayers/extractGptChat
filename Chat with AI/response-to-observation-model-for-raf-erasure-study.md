# Response to "Observation model for the rAF erasure study"

This note responds to
[Observation model for the rAF erasure study](./observation-model-for-raf-erasure-study.md).
It agrees with the proposed correction of the observation coordinate, but
disagrees with the conclusion that requiring a second stable frame would be a
non-diagnostic intervention.

Terminology follows the earlier notes: **actual height** is measured geometry,
**last-known-height** is the `--last-known-height` value, and a
**last-known-height update** is an observed change of that value. An
**observation frame** is one execution of the deck sampler, identified by
`rafId`.

## 1. Agreement on the observation model

The proposed ordinal coordinate is the correct primary coordinate:

\[
d = F(J).\mathrm{rafId} - u.\mathrm{rafId},
\]

where `F(J)` is the studied jump's own observation frame and `u` is the frame
in which the selected last-known-height update first became visible.

Ordering by `rafId` corrects the present implementation's comparison of two
incompatible clocks. In particular:

- `d < 0` means the new last-known-height was not yet visible in the jump's
  observation frame;
- `d = 0` means it first became visible in that frame;
- `d > 0` means it was already visible in an earlier observation frame.

The `d = 0` population has ordinal information but no defensible sub-frame
update-to-jump duration. For `d >= 1`, physical time can be represented only as
an interval bounded by the executions of the preceding and observing frames.
The rAF vsync timestamp should be retained but must not be compared directly
with a `performance.now()` command timestamp.

The proposal is also correct that the `1.25 s` bound remains falsified. Its two
counterexamples span 22 and 32 observation frames, so they cannot be explained
by the short callback-latency defect.

The instrumentation repairs proposed in section 8 are therefore necessary:

- record `performance.now()` at callback entry separately from the vsync
  timestamp;
- derive ordering from `rafId`;
- fix episode selection;
- retain or report repeated deactivation predictions;
- export stabilization telemetry and the preceding stabilization-frame count;
- call geometric deactivation a prediction unless it is verified after the
  command.

## 2. The explanatory conjecture

The one-frame stabilization result is not a competing explanation for
erasure. It is an observed condition within the existing explanatory
conjecture.

The conjectured mechanism is:

1. A deck-deactivation process starts an erasing transaction and saves
   geometry.
2. The extractor's stabilization wait can return while that transaction is
   still open.
3. The extractor issues the studied jump inside the open transaction.
4. The transaction later commits and restores the saved geometry, thereby
   erasing the studied jump.

The proposed ordering is therefore:

\[
\text{transaction start}
< \text{stabilization return}
< \text{studied jump}
< \text{transaction commit}.
\]

The observation that all erasures follow a one-frame stabilization return
helps identify how the extractor permits the jump to fall inside the proposed
transaction. It does not establish the transaction's internal operations. The
save, commit and restoration remain conjectural.

"Pending layout work" would only redescribe the observed ordering. It would
not explain why the subsequent event cancels the jump exactly. The erasing
transaction remains the explanatory proposal being tested.

## 3. Why a forced second frame is informative

Section 5 of the observation-model note correctly finds that, in all 773
erasure cases, the stabilization geometry remained unchanged between the
preceding wait's exit and preparation of the studied jump. It follows that a
second required frame would itself have satisfied the current stability
criterion.

That does not make the intervention non-diagnostic. It means that the wait
would have returned one frame later. The position of the jump relative to that
additional frame is precisely the intervention.

The observed sequence is approximately:

```text
stable frame 1
    -> stabilization returns
    -> studied jump's observation frame sees the update
    -> studied jump is issued
```

With two stable frames required, the counterfactual sequence is:

```text
stable frame 1
    -> frame 2 may see the update but still count as geometrically stable
    -> stabilization returns
    -> a later jump observation frame
    -> studied jump is issued
```

The stabilization detector may be blind to the relevant deck operation while
the added frame nevertheless allows that operation to advance or finish. Its
blindness explains why frame 2 can count as stable; it does not show that
nothing relevant occurred during frame 2.

Consequently:

- If a forced second frame eliminates or sharply reduces erasures, that
  supports the claim that the jump must occur before the conjectured
  transaction finishes.
- If erasures persist, one additional frame does not reliably move the jump
  beyond the conjectured transaction.
- Neither result independently proves that geometry was saved, committed or
  restored.

The intervention is therefore diagnostic of the conjecture's **temporal
opportunity condition**, though not of its **save/commit/restoration core**.
The statement that neither outcome is informative is too strong.

## 4. What the observational `0/9,192` result does and does not show

The note is right that the existing comparison is affected by selection. Under
the current rule, a wait lasts two or more frames only when earlier frames
showed geometry or anchor movement. Those cases are not equivalent to forcing
an additional frame after an otherwise successful one-frame wait.

Thus the observation

> no erasure followed a naturally longer stabilization wait

does not by itself determine the outcome of the intervention. This is a reason
to perform the intervention, not a reason to regard it as uninformative.

## 5. Dose-response is the stronger form of the same test

The proposed `k = 0,1,2,3` extra-frame experiment improves upon the binary
change. It can estimate

\[
P(\text{erasure}\mid k)
\]

and reveal whether the erasure opportunity declines after one frame, over
several frames, or not at all. Its value comes from refining the same temporal
intervention, rather than from testing a categorically different mechanism.

The extra frames should be inserted after stabilization and before the next
jump command, without requiring them to exhibit geometry changes. For each
frame, the collector should record whether a last-known-height update, actual-
height transition or formal deactivation first became visible. None of these
events should be assumed in advance to be the transaction's endpoint.

Runs should be compared by erasure rate rather than raw erasure count, because
the intervention may alter the realized jump sequence.

## 6. Caution about gating on deck observations

Waiting until predicted decks resolve is a useful additional intervention, but
its interpretation is less direct than it first appears.

- A last-known-height update might mark the start, an intermediate step, or the
  end of the conjectured transaction.
- Formal deactivation need not mark its end; the previously observed delayed
  erasures already make that assumption unsafe.
- Several predicted decks can overlap, so a gate must specify whether it waits
  for one, every one, or a particular deck.

If gating prevents erasure, it shows that the gated observation is a useful
synchronization condition. It does not by itself show that the observation is
the transaction's commit.

## 7. Recommended next experiment

The next collection should combine the strongest parts of both proposals:

1. Correct ordering and instrumentation first: use `rafId`, add callback-entry
   `performance.now()`, repair episode handling, and export stabilization data.
2. Insert a predetermined number of extra rAFs after stabilization and before
   the next jump, using `k = 0,1,2,3` across otherwise comparable fixed-deck
   runs.
3. Leave the geometry-based stabilization criterion unchanged.
4. Record last-known-height updates, actual-height transitions and formal
   deactivations during the inserted frames without treating any of them as a
   predefined commit marker.
5. Plot erasure rate against `k` and, separately, against the exact ordinal
   coordinate `d`.

This experiment tests whether erasure depends on placing the studied jump
inside a finite frame-level opportunity window. It still does not directly
observe the saved geometry or the commit that allegedly restores it. A further
instrument or intervention reaching that geometry would be required to test
the explanatory core.

## 8. Conclusion

The observation-model note successfully replaces the invalid mixed-clock axis
with an exact ordinal ordering and appropriately bounded physical time. Its
main overreach is the claim that adding a second frame is non-diagnostic.

A second frame can be geometrically stable and still change the ordering that
matters: the studied jump moves from before to after an additional opportunity
for the conjectured transaction to progress. The binary experiment is
therefore informative about the temporal opportunity condition, while the
proposed dose-response experiment is its more powerful form.

Neither experiment alone establishes the explanatory core. The current study
can test when an erasure is possible; demonstrating that a transaction saves
and later restores geometry remains separate work.
