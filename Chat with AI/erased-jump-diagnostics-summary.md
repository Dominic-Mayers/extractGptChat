# Erased Jump Diagnostics Summary

This note reports the erased-jump observations through the last 10 diagnostic runs. It contains measured results and direct consequences of those results only.

## Parsing Rule

Logs must be segmented by traversal, using:

- `[dev traversal] started.`
- `[dev traversal] finished.`
- `[dev traversal] failed.`

Only the final successful traversal in a log is comparable. The successful
structured diagnostic block was used from each of the last 10 logs. The failed
attempt reported for `chatgpt.com-1785247743915.log` was excluded. Its terminal
failure record is not present in the exported log.

The structured records following `[erased jumps slab=... anchor=...]` are the source for the erased-jump counts and event comparisons below. An erased attempt is counted once even when several erased attempts belong to the same slab/anchor record.

## Terms Used Below

`belowDeactivationBoundaryDeck`:

The deck whose status change is `true -> false` and whose ID equals `nextRaf.inactiveDeckBelowId`.

`aboveActivationBoundaryDeck`:

The deck whose status change is `false -> true` and whose ID equals `beforeJump.inactiveDeckAboveId`.

`unchanged at next rAF`:

All four equalities hold between `beforeJump` and `nextRaf`:

```text
scrollY
anchorRoom
slabRoom
deckRoom
```

## Earlier Batches

### Old-width batch

The 21 old-width runs used an effective `viewportHeight` of `831` and reported 348 decks per run.

```text
statusChangedDeck union:              309 / 348
boundaryStatusChangedDeck union:      272 / 348
aboveActivationBoundaryDeck union:    189 / 348
belowDeactivationBoundaryDeck union:  218 / 348
nonBoundaryStatusChangedDeck union:   168 / 348
erased-jump slab union:               155
```

Five erased records in this batch contained no logged status change. All five were at slab 218 with an `ordinaryAnchor` target. The data in those records does not establish whether a status change occurred outside the captured interval.

The per-run `belowDeactivationBoundaryDeck` count had:

```text
average: 87.7 / 348 = 25.2%
median:  90 / 348 = 25.9%
range:   74-99 / 348 = 21.3%-28.4%
```

Seven deck IDs occurred as `belowDeactivationBoundaryDeck` in all 21 runs:

```text
8b2eec8f-9231-4f9a-a6d7-d2452a0e49a8
b897a099-8f3d-49e9-8fa9-4c16d0d1037f
438a3ef0-ae01-4bee-9e31-ada59ba7aab2
6751aa5e-778c-47b3-af74-5dcce859e5ba
ffbd6e4d-be94-488a-a59d-6c5a412d1fd1
c14e6a5a-645f-4fc0-8e7b-af2d7c9239da
ff17048e-c662-4a39-b629-bc932475e95e
```

### Three narrow-width runs

The viewport was narrowed horizontally while the measured `viewportHeight` remained `831`.

```text
run            erased  below  above  erased slabs
1785224854429      123     88     66            74
1785225243153      167    110     96            98
1785225507971      172    108     98            92
```

The narrow-width `belowDeactivationBoundaryDeck` distribution was:

```text
unique deck IDs: 161
seen in 3/3:      47
seen in 2/3:      51
seen in 1/3:      63
```

Its per-run count had:

```text
average: 102 / 348 = 29.3%
median:  108 / 348 = 31.0%
range:   88-110 / 348 = 25.3%-31.6%
```

The old-width and narrow-width below-deactivation rankings overlapped as follows:

```text
old top 5 vs narrow top 5:     1
old top 10 vs narrow top 10:   1
old top 20 vs narrow top 20:   5
old top 50 vs narrow top 50:  18
old top 100 vs narrow top 100: 51
```

## Last 10 Runs

These runs used `viewportHeight=844`. The diagnostic build awaited one animation frame before issuing each scroll command.

```text
log timestamp   classified jumps  erased  erased rate  ordinary  slabTop
1785246663596               1023      43        4.20%        28       15
1785247042268               1023      43        4.20%        23       20
1785247281352                988      42        4.25%        26       16
1785247477537               1017      36        3.54%        23       13
1785247743915               1021      41        4.02%        22       19
1785247997972               1018      36        3.54%        22       14
1785248217333               1015      35        3.45%        19       16
1785248488222                984      38        3.86%        24       14
1785248719423                989      42        4.25%        24       18
1785248946376                987      41        4.15%        27       14
```

Totals:

```text
classified jumps: 10,065
erased attempts:     397
ordinaryAnchor:      238
slabTop:             159
requested jump:      26.5-480 px
```

The per-run erased rate was `3.45%-4.25%`. Erasures occurred for both jump targets and across the full observed requested-jump range.

Unions across the 10 runs:

```text
statusChangedDeck union:              139 / 348
boundaryStatusChangedDeck union:      126 / 348
aboveActivationBoundaryDeck union:     18 / 348
belowDeactivationBoundaryDeck union:  114 / 348
nonBoundaryStatusChangedDeck union:    45 / 348
erased-jump slab union:                84
```

## Invariant Event Sequence in the Last 10 Runs

All 397 erased attempts have this recorded sequence:

1. The jump observer starts.
2. The pre-jump animation frame completes.
3. A scroll command is issued.
4. Before `nextRaf` is stored, the observer delivers at least one matching
   below-deactivation change.
5. At the `nextRaf` sample, `scrollY`, `anchorRoom`, `slabRoom`, and
   `deckRoom` all equal their pre-jump values.
6. The extractor identifies the attempt as erased and repeats the same
   movement.
7. The retry succeeds.

The logs do not locate the matching mutation on one side or the other of the
scroll command because the observer covers both the pre-command frame wait and
the post-command interval.

Counts for those properties:

```text
unchanged scrollY at next rAF:                         397 / 397
unchanged anchorRoom at next rAF:                      397 / 397
unchanged slabRoom at next rAF:                        397 / 397
unchanged deckRoom at next rAF:                        397 / 397
matching below active -> inactive transition:          397 / 397
retry succeeded:                                       397 / 397
retry erased again:                                      0 / 397
```

Every erased record contains at least one status change. The number of status changes per erased record was:

```text
1 change: 316 records
2 changes: 36
3 changes: 35
4 changes: 1
5 changes: 9
```

Across all status changes recorded in those erased attempts:

```text
true -> false:       488
false -> true:        54
before next rAF:     420
after next rAF:      122
```

An above-boundary `false -> true` transition matching `beforeJump.inactiveDeckAboveId` occurred in 41 of 397 records. It is therefore not invariant. The matching below-boundary `true -> false` transition is invariant in this batch.

Rendering changes are also not invariant:

```text
no rendering changes: 292 / 397
one or more:           105 / 397
```

## What the Last 10 Runs Establish

Every recorded erased event has all three properties below:

```text
matching below-deactivation change
unchanged scroll/anchor/slab/deck geometry at next rAF
retained movement when the command is repeated
```

This list states co-occurrence, not causation. The logs do not identify which
browser or application operation restores the pre-jump position.

The frame awaited before the command is not an erasure-free path: all 397 erased attempts occurred with that wait in place.

The last 10 runs do establish a non-timeout recovery fingerprint. After an attempted movement, the combination below occurred in every erased record:

```text
MutationObserver reports true -> false
for the deck that becomes the nearest inactive deck below,
and the next-rAF scroll/anchor/slab/deck geometry equals the pre-jump geometry.
```

The first part is an event signal and does not require a timeout. The geometry equality at the next rAF distinguishes an erased attempt from a retained movement. In this batch, reissuing the movement after that signal recovered all 397 attempts.

The logs do not contain a pre-command fingerprint that predicts every erasure,
and they do not contain a tested path in which erasures are absent. Those two
results remain unestablished.

## Comparison With the 21 Old-Width Runs

The batches differ in both viewport height and command timing:

```text
21-run batch: viewportHeight=831, no pre-command rAF
10-run batch: viewportHeight=844, one pre-command rAF
```

The logs do not isolate those two variables.

```text
metric                         21 runs         last 10 runs
erased attempts/run average     104.67              39.70
erased attempts/run median      105                 41
erased attempts/run range        86-132              35-43
all jumps/run average          1138.81            1006.50
erased/all-jumps average          9.19%               3.95%
erased/all-jumps range            7.54%-11.63%         3.45%-4.25%
```

At event level:

```text
metric                                      21 runs       last 10 runs
erased attempts                              2198              397
matched below deactivation present       1842/2198        397/397
matched below deactivation proportion        83.8%           100%
no logged status change                       5                0
```

Per-run unique-deck counts:

```text
category                         21-run average   10-run average
any statusChangedDeck                  157.86           47.80
boundaryStatusChangedDeck              108.05           43.30
belowDeactivationBoundaryDeck           87.71           39.70
aboveActivationBoundaryDeck             26.95            4.10
nonBoundaryStatusChangedDeck            57.19            9.20
```

The seven below-deactivation deck IDs seen in all 21 old-width runs occurred
in the last 10 runs as follows:

```text
8b2eec8f-9231-4f9a-a6d7-d2452a0e49a8   0/10
b897a099-8f3d-49e9-8fa9-4c16d0d1037f   1/10
438a3ef0-ae01-4bee-9e31-ada59ba7aab2   0/10
6751aa5e-778c-47b3-af74-5dcce859e5ba   0/10
ffbd6e4d-be94-488a-a59d-6c5a412d1fd1   0/10
c14e6a5a-645f-4fc0-8e7b-af2d7c9239da   0/10
ff17048e-c662-4a39-b629-bc932475e95e   0/10
```

The most frequent below-deactivation deck IDs in the last 10 runs were:

```text
59cf63a2-66e9-4b7e-8deb-2dd358f9e7e7  10/10
e85b64c3-330a-41f0-87c6-4e86308c33f2  10/10
e75c5fc9-4e36-4b6b-80ac-5a1df1ea75a2   9/10
a9620a5b-27cb-47e3-a0c5-1a7aefcbc536   9/10
```

Slab 218 contained 29 erased attempts in the 21-run batch, including all five
records with no logged status change. It contained two erased attempts in the
last 10 runs. Both had a matching below-deactivation status change.

## Timing Comparison

The execution-time summary in each log reports:

```text
metric                         21 runs         last 10 runs
total runtime mean             137.52 s           143.66 s
total runtime median           138.47 s           143.39 s
total runtime range            127.69-150.43 s    140.67-146.52 s
average jump elapsed mean      114.59 ms          137.59 ms
all jumps/run average         1138.81            1006.50
```

The last-10 condition averaged `22.99 ms` more elapsed time per classified
jump and `6.14 s` more total elapsed time per traversal.

## Limits of the Recorded Timing

The jump observer starts before the pre-command animation-frame wait.
`phase="before-next-rAF"` means only that a mutation was delivered before the
post-command `nextRaf` snapshot was stored. It does not distinguish a mutation
during the pre-command frame wait from a mutation after the scroll command.

For the matching below-deactivation change:

```text
before-next-rAF: 397 records
after-next-rAF:    1 additional matching change
```

One erased record therefore contained two matching changes for the same
below-boundary role. Every erased record contained at least one such change.

The invariant matching below-deactivation change is an observed erased-event
fingerprint. The current logs do not show that it is available before the
scroll command, so they do not establish it as a fingerprint that can be
awaited to prevent the command from being erased.

## Results Relevant to Avoiding Erasures

The following are established by the recorded batches:

1. The pre-command-rAF condition still produced 397 erased attempts.
2. Its erased-jump rate was lower than every rate in the 21-run batch.
3. Every erased attempt in the last 10 runs had unchanged post-command
   next-rAF geometry and a matching below-deactivation change.
4. Every repeated command retained movement.
5. The logs do not provide comparable pre-command fingerprints for the erased
   and non-erased jump populations.
6. No tested condition eliminated erasures.

The data therefore supplies a complete post-command detection fingerprint for
the last 10 runs, but not a preventive wait fingerprint. A test intended to
find a preventive fingerprint must record the pre-command frame separately
from the post-command interval.

## Directly Supported Detection Test

A test can use the observed event order without a long stabilization timeout:

1. Observe `data-is-intersecting` changes while issuing the movement.
2. On the next rAF, compare `scrollY` and retained-anchor geometry with the pre-command snapshot.
3. If the geometry is unchanged and the matching below deck changed `true -> false`, reissue the movement immediately.
4. Record whether any retry is erased.

The acceptance criteria derived from the last 10 runs are:

```text
erased-attempt detection: matching below deactivation + unchanged next-rAF geometry
recovery completion:      retained movement on the reissued command
failure:                  reissued command is also erased
```
