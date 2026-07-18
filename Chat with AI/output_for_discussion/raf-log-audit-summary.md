# rAF log audit summary

Date: 2026-07-14

## Files reviewed
- Chat with AI/output_for_discussion/console-export-2026-7-13_6-5-14.log
- Chat with AI/output_for_discussion/console-export-2026-7-13_7-1-52.log
- Chat with AI/output_for_discussion/console-export-2026-7-13_7-22-40.log

## High-level pattern
The logs consistently show the stabilization loop behaving as expected for many short waits. The apparent mass of wrong-room events is actually one failed jump repeated for the remainder of a single 250-frame stabilization attempt, not many independent failures.

## Counts by log
| Log file | rAF no change | rAF with change | Stabilized |
| --- | ---: | ---: | ---: |
| console-export-2026-7-13_6-5-14.log | 3624 | 232 | 797 |
| console-export-2026-7-13_7-1-52.log | 380 | 13 | 92 |
| console-export-2026-7-13_7-22-40.log | 487 | 273 | 108 |

## Notable observations
1. The 6-5-14 run is dominated by ordinary stabilization: many `rAF no change` events followed by `Stabilized.`.
2. The 7-1-52 run is much shorter and mostly clean, with only a small number of change events.
3. The 7-22-40 run contains one strong cluster of messages like:
   - `rAF with change: ... geometry stable but room not close`
   - room values far from intendedRoom (for example around `room=-458.48` vs `intendedRoom=21.52`)
   - the run eventually ends with `Out of the stabilization loop`

## Failure sequence in 7-22-40
The decisive sequence is around log lines 1163-1167:

1. Before the jump, `previousRoom=-458.4833`, `jump=480`, and `intendedRoom=21.5167`.
2. `performJump` changes `scrollY` from `188967` to `188487`, exactly as requested.
3. The first observed rAF arrives 12.922 seconds later. Its geometry fingerprint changes from `691132:188487` to `691132:188967`.
4. At that same observation, room has returned exactly to `-458.4833`.
5. Every later frame has stable geometry and the same room, exactly 480px behind the intended room.

This is strong evidence that the browser/renderer accepted the scripted scroll initially and then restored the complete jump. It is not evidence that the rAF loop accepted stability too early: the old loop did not accept it at all and exhausted all 250 frames.

## Interpretation
This points to a real intervention failure observed by the stabilization logic:
- the scripted scroll is applied initially,
- a later render/layout action restores `scrollY` by exactly the jump distance,
- geometry then becomes stable at the pre-jump room,
- the old stabilization loop cannot classify that terminal state and waits until its frame limit.

That aligns with the current implementation in src/dev/stabilize.js and src/dev/moveWorkZone.js:
- `waitLayoutStable()` returns `stable-wrong-room` when geometry is unchanged but the room is still off target.
- `moveWorkZone()` then treats this as a possible lost jump and retries.

## Conclusion
The logs support a genuine lost-jump event, not an rAF timing failure and not a logging artifact. The repeated wrong-room lines are redundant observations of the same terminal state. The exact `-480px` room error, the restoration of `scrollY` by `+480px`, and unchanged `scrollHeight` make the lost-whole-jump classification substantially stronger than the earlier summary stated.

## Relation to the current code
The current split is conceptually appropriate:

- `waitLayoutStable()` observes and classifies `stable-wrong-room` immediately.
- `moveWorkZone()` decides whether that observation matches the narrow lost-whole-jump signature and owns the retry because retrying is an intervention.

The narrow signature matches this log: the scroll was initially applied, geometry subsequently changed, `current` remained connected, and final room returned to `previousRoom` by exactly one jump. New logs should be audited for whether recovery succeeds and whether any `stable-wrong-room` observation fails that signature.
