# T> 1 delay of jump prevent erasure

> The task is to complete (add more flesh to)  the model and the conjectures described in ARCHITERCTURE.md based on the data collected in fixed-deck-runs/ .  The supply area is a part of the complete conversation and corresponds to the document element. The geometry is fixed in the conversation and the supply area contains the geometry of that part.  The current conjecture is that the baseline behavior of activations, deactivations and erasures in a traversal (the behavior seen when we remove randomness by running several times over the conversation), if we adjust for the speed of the traversal, depends entirely on the geometry of the convesation.  We should be able to explain the ratio of erasures conditioned by split = true and T (the toral number of rAFs in the preceding jump).

<details><summary>7 previous messages</summary>

> I’ll inspect the architecture notes and the fixed-deck run data, then derive the strongest geometry-based explanation the measurements support. I’ll update the document with explicit definitions, equations, testable conjectures, and any limits the data reveals.
>
> I found the requested file under the corrected name, `ARCHITECTURE.md`. The existing document describes the operational layers well, but it stops short of a probabilistic/geometric state model. I’m now reducing the fixed-deck ledgers to jump-level variables so the new conjectures distinguish measured facts from proposed mechanisms.
>
> The key statistical point is now clear: `T` is an outcome of the stabilization call, not a pre-jump treatment. In a split movement, the second command occurs during that call; if it is erased, the erasure itself changes the observed geometry and lengthens `T`. So the high `P(erasure | split, T)` strata are partly created by the erasure they appear to predict. I’ll encode that causal distinction and use geometry/pending-deactivation state as the predictive variables.
>
> <details><summary>Edited a file</summary>
>
> - Wrote `./ARCHITECTURE.md` (+210 -0)
>
> </details>
>
> The repository instructions require every modification to include a version bump, synchronized builds, and a commit. Since this is documentation-only, I’m checking the project’s version/build path now and will stage only the architecture change plus the required generated version artifacts, leaving the existing unrelated worktree changes untouched.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./scripts/version.js` (+1 -1)
> - Wrote `./ARCHITECTURE.md` (+7 -7)
> - Wrote `./ARCHITECTURE.md` (+2 -2)
>
> </details>
>
> The model is now written and the required build checks pass. It treats the supply area as the complete geometric conversation, introduces boundary-crossing and “deactivation debt” state, states the strong and conservative geometry conjectures separately, and explains the split/`T` ratio as post-outcome conditioning rather than a standalone timing law.
</details>

Completed and committed as `a38d927`.

Updated [ARCHITECTURE.md](./ARCHITECTURE.md:488) with:

- The supply area as the complete conversation’s fixed geometric document.
- Conversation geometry versus frame-by-frame realized geometry.
- A formal activation-boundary and deck-interval model.
- Activation/deactivation “debt” as traversal state.
- Strong and conservative forms of the geometry conjecture.
- A narrower, evidence-bounded erasure conjecture.
- An explanation of `P(erasure | split=true, T)`: `T` is partly an outcome of erasure, so conditioning on it creates post-outcome selection rather than identifying a causal timing law.
- Testable predictions and a proposed pre-second-jump estimator.

Version bumped to `6.24`; diagnostic and non-diagnostic bundles rebuilt. `npm run check` and `git diff --check` pass. Existing unrelated worktree changes were untouched.

> The source of variations in time measurement is indeed the variations in the realized geometry. It affects in particular the size od clamped jumps, the number of jumps needed, etc.

<details><summary>3 previous messages</summary>

> Yes—that makes realized geometry the mediator between fixed conversation geometry and elapsed time, not merely an observation trace. I’ll revise the model so clamping, jump count, exposed distance, and stabilization work are explicitly derived from realized geometry, then rebuild and commit the documentation update.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./ARCHITECTURE.md` (+19 -11)
> - Wrote `./scripts/version.js` (+1 -1)
> - Wrote `./ARCHITECTURE.md` (+3 -3)
>
> </details>
>
> The revision now makes the dependency explicit:
>
> `fixed conversation geometry → realized geometric path → clamped jump sizes / jump count / stabilization work → elapsed time`.
>
> I also separated elapsed runtime (`τ_run`) from the existing stabilization-frame variable `T`, since using `T` for both obscured the split analysis. The current architecture file already contains overlapping user edits from this same model revision, so the required commit will preserve and include that combined document state rather than discarding it.
</details>

Updated and committed as `dcaf378`.

The model now states that realized geometry directly determines:

- Each clamped jump size.
- Whether additional jumps are needed.
- Total jump count and realized distance.
- Stabilization work after each jump.
- Consequently, measured execution time.

The timing equation is now:

```text
s_k = clamp(maxJump, realized geometry at k)
τ_run ≈ Σ_k (F + R × s_k + W_k)
```

Elapsed runtime is named `τ_run`, leaving `T` unambiguously as the stabilization-rAF count used in the split analysis.

Version bumped to `6.25`; both bundles rebuilt and all checks pass.

> "Intersecting these strips with the ordered deck intervals predicts which deck
> boundaries the movement asks the renderer to process. "  Mention this as a conjecture, especially after expliciting that a non active deck inside the active area will remain non active until it crosses these strips.

<details><summary>2 previous messages</summary>

> I’ll recast that passage as an explicit edge-trigger conjecture: membership in the active area alone is insufficient; an inactive deck already inside it remains inactive until viewport movement sweeps the relevant entering strip across the deck. I’ll also distinguish this from the directly observed geometry.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./ARCHITECTURE.md` (+19 -6)
> - Wrote `./scripts/version.js` (+1 -1)
>
> </details>
</details>

Updated and committed as `de78f91`.

The passage now explicitly labels the behavior as the **strip-trigger conjecture**:

- Active-area membership alone does not activate a deck.
- An inactive deck already inside the active area remains inactive.
- Activation occurs when viewport movement sweeps the entering strip across its interval or boundary.
- Deactivation is conjectured to follow the analogous leaving-strip rule.
- Activation within the overlap of consecutive active areas, without another stimulus, would falsify the conjecture.

Version bumped to `6.26`; builds and checks pass.

> I am reading "X_k = (y_k, s_k, local deck intervals, activation boundaries,
>        activation debts, deactivation debts, realized heights)." I have not read what comes after. Can you share here why that tuplet is important.

`X_k` is meant to summarize everything geometrically relevant immediately before jump `k`.

Its importance is the claim that two traversals with the same `X_k` should have the same baseline probabilities for what happens next—even if they are different runs or occur at different wall-clock times:

```text
P(next activation, deactivation, or erasure | history)
≈ P(next activation, deactivation, or erasure | X_k)
```

Each component has a role:

- `y_k`: where the viewport currently lies in the conversation.
- `s_k`: the next jump size, which determines the strips swept by movement.
- `local deck intervals`: which decks and boundaries those strips will cross.
- `activation boundaries`: where crossing can trigger activation or deactivation.
- `activation debts`: decks whose geometry requested activation but whose activation has not yet been realized.
- `deactivation debts`: decks that crossed out but whose deactivation work remains unfinished; these are particularly relevant to erasure.
- `realized heights`: the geometry currently used for clamping and selecting subsequent jumps.

So `X_k` serves three purposes:

1. It turns “behavior depends on geometry” into a testable statement.
2. It distinguishes pre-jump predictors from later outcomes such as `T`.
3. It identifies missing variables: if otherwise identical `X_k` states behave differently across runs, the tuple is incomplete or the geometry-only conjecture is false.

There is one issue with the present notation: `s_k` is described elsewhere as a realized clamped jump, so immediately *before* jump `k`, it may be clearer to include the requested maximum and the clamp distances, from which `s_k` is derived:

```text
X_k = (y_k, local deck intervals, activation boundaries,
       anchor and slab clamp distances,
       activation debts, deactivation debts, realized heights)

s_k = jumpPolicy(X_k)
```

That formulation better expresses the causal order: geometry determines the jump size; the jump size should not simultaneously be treated as an independent part of the geometry.

> Yes, the definition of X_k is part of a more precise formulation of the conjecture.  Perhaps the difficulty I had is that I don't recall having read a simple formulation of the conjecture before the definition of X_k. It should precede the definition of X_k and then the definition of X_k should be seen as  a tentative to  make it more precise.   We do not exclude that the precise definition of X_k (and thus of the conjecture) might have to be modified as we proceed.

<details><summary>3 previous messages</summary>

> Agreed. I’ll put the plain conjecture first—fixed conversation geometry, mediated by realized geometry and adjusted for traversal speed, determines the baseline behavior. Then I’ll introduce `X_k` explicitly as a tentative operational formalization whose fields may change as the investigation exposes missing state.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./ARCHITECTURE.md` (+23 -1)
> - Wrote `./ARCHITECTURE.md` (+19 -3)
> - Wrote `./ARCHITECTURE.md` (+11 -11)
> - Wrote `./scripts/version.js` (+1 -1)
> - Wrote `./ARCHITECTURE.md` (+4 -3)
>
> </details>
>
> The document now leads with the simple statement and treats the mathematics as a proposed refinement, not as the conjecture’s final definition. I also changed `X_k` so the jump size is derived from the state and jump policy, and explicitly noted that failure of this tuple may indicate an incomplete state rather than immediate failure of the broader geometry conjecture.
</details>

Updated and committed as `b4b72f1`.

The section now proceeds in this order:

1. A simple, prominent formulation of the baseline-geometry conjecture.
2. An explanation of how realized geometry mediates traversal variations.
3. The deck-interval and strip-trigger model.
4. `X_k` as a tentative sufficient-state definition.
5. The probabilistic formulation and falsification criteria.

It explicitly says `X_k` is provisional and may require additions, removals, or redefinitions. It also distinguishes failure of the current tuple from failure of the broader conjecture.

Version bumped to `6.27`; builds and checks pass.

> "As a first formulation, ..."  This incorrectly assumes that the reader will know what is being formulated.  We should introduce the concept of a traversal state at position k, which may vary accross run even for a fixed conversation and browser settings (viewport height, etc.).  We must clarify what  is a valid specification of position k. An example is the position k when some turnId (deck) is geometrically activated. The state includes the clock time at position k, etc., not only geometric aspects.   The conjecture is that only the geometric aspects X_k of the state is relevant to have the distribution of a future state at position k' > k.  Is that match with your understanding ?  This can be explained without the details of X_k and then we propose a more precise definition of X_k.

<details><summary>4 previous messages</summary>

> Yes, that matches my understanding, with one precision: `k` should identify a reproducible traversal landmark, not necessarily the kth jump. The full state at that landmark can include clock time, run-specific scheduling information, and geometry; `X_k` is then the tentative geometric projection of that full state. The conjecture is a conditional-sufficiency claim: after speed normalization, the non-geometric remainder of the state should not change the distribution of later, landmark-relative outcomes once `X_k` is known.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./ARCHITECTURE.md` (+66 -25)
> - Wrote `./scripts/version.js` (+1 -1)
> - Wrote `./ARCHITECTURE.md` (+4 -4)
>
> </details>
>
> The distinction is now explicit: `S_k` is the complete run-dependent state at a reproducibly specified traversal landmark, while `X_k` is only its proposed geometric projection. The document first states the sufficiency conjecture without committing to the tuple, then gives the tuple as a revisable measurement proposal.
>
> <details><summary>Edited a file</summary>
>
> - Wrote `./ARCHITECTURE.md` (+1 -1)
>
> </details>
</details>

Yes, it matches my understanding. I updated the document accordingly and committed it as `adacbee`.

The model now distinguishes:

- `k`: a reproducible traversal landmark, not necessarily a jump number.
- `S_k`: the complete observable state at that landmark, including clock time, history, renderer state, and geometry.
- `X_k`: a tentative geometric projection of `S_k`.
- `k' > k`: a later specified landmark.

It also defines valid landmarks as observable, non-anticipating, comparable across runs, sampled explicitly before or after an event, and disambiguated when events repeat.

The conjecture is now expressed as:

```text
P(S_{k'}^{rel} | S_k, traversal speed) =
    P(S_{k'}^{rel} | X_k, traversal speed),  k' > k.
```

Thus, after speed adjustment, non-geometric aspects of `S_k` should provide no additional information about the relative future state once `X_k` is known. The detailed tuple is introduced only afterward as a provisional specification.

Version `6.28`; builds and checks pass.

> Is it possible to merge split-experiment in main ?

<details><summary>1 previous message</summary>

> I’ll check the branch relationship, worktree state, and whether Git predicts conflicts. I won’t perform the merge unless you ask me to proceed.
</details>

Yes. `main` is an ancestor of `split-experiment`, and the worktree is clean, so it can be merged with a conflict-free fast-forward.

Current divergence:

```text
main:             0 unique commits
split-experiment: 8 unique commits
```

The merge would be:

```bash
git switch main
git merge --ff-only split-experiment
```

This would update local `main` through commit `84ccaa6`. It would not push `main` to GitHub.

> Go ahead

<details><summary>1 previous message</summary>

> I’ll fast-forward local `main` to `split-experiment`, then verify the branch pointer and worktree. This will not push anything remotely.
</details>

Local `main` was fast-forwarded successfully to `split-experiment` at `84ccaa6`.

The worktree is clean, and both local branches now point to the same commit. Local `main` is eight commits ahead of `origin/main`; nothing was pushed.

> Delete split-experiment. That experiment is part of the main flow of the development process. I intend to keep the split version, because it is easier to analyse: it provides more information.

<details><summary>1 previous message</summary>

> I’ll delete only the local `split-experiment` branch. Its commits and split-enabled implementation remain on `main`; there is no corresponding remote branch to remove.
</details>

Deleted the local `split-experiment` branch.

The split-enabled implementation remains intact on `main` at `84ccaa6`. The worktree is clean, and local `main` remains eight commits ahead of `origin/main`.

> I notice that you use latex like math notation such as "S_{k'}^{rel}". This is not processed in gitHub markdown, but presented directly with the underlines, curly brackets, etc.  Is it intentional ?

No. It was intended as mathematical notation, but placing it in a Markdown code span makes GitHub display it literally. That is unsuitable here.

It should use plain-text notation, for example:

```text
relativeState(k')
```

Then the conjecture becomes:

```text
P(relativeState(k') | S(k), traversalSpeed)
  = P(relativeState(k') | X(k), traversalSpeed), for k' > k
```

This is clearer and requires no LaTeX rendering. The other expressions using underscores and braces should be converted similarly.

> Putting them between "$" might work.

<details><summary>3 previous messages</summary>

> Yes—GitHub Markdown supports inline mathematical expressions delimited by `$...$`. I’ll convert the pseudo-LaTeX code spans to actual math delimiters while leaving identifiers that are meant as literal diagnostic or code names in backticks.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./ARCHITECTURE.md` (+10 -10)
> - Wrote `./ARCHITECTURE.md` (+13 -15)
> - Wrote `./ARCHITECTURE.md` (+12 -13)
> - Wrote `./ARCHITECTURE.md` (+12 -12)
> - Wrote `./scripts/version.js` (+1 -1)
> - Wrote `./ARCHITECTURE.md` (+13 -14)
> - Wrote `./ARCHITECTURE.md` (+13 -12)
> - Wrote `./ARCHITECTURE.md` (+17 -19)
> - Wrote `./ARCHITECTURE.md` (+1 -3)
>
> </details>
>
> The notation is now using actual GitHub math delimiters: inline expressions use `$...$`, and displayed equations use `$$...$$`. Literal program/diagnostic identifiers remain in code formatting. I also converted the execution-time equations for consistency.
</details>

That works. I converted the mathematical notation to GitHub-supported delimiters:

- Inline mathematics: `$S_k$`
- Display mathematics: `$$ ... $$`

Literal code and diagnostic identifiers remain in backticks.

Committed as `a5b1b35`, with version `6.29`. Builds and checks pass.

> The following macros are not allowed: operatorname

<details><summary>2 previous messages</summary>

> I’ll replace every `\operatorname{...}` with supported `\mathrm{...}` notation, then rebuild and commit the correction.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./ARCHITECTURE.md` (+8 -8)
> - Wrote `./scripts/version.js` (+1 -1)
>
> </details>
</details>

Replaced all `\operatorname{...}` occurrences with `\mathrm{...}`.

Committed as `caad93c`, version `6.30`. Builds and checks pass.

> Double subscripts: use braces to clarify

<details><summary>3 previous messages</summary>

> I’ll inspect every math subscript and brace the full base where a styled name also receives a subscript—for example, `{\mathrm{enter}}_k`. That avoids GitHub’s “double subscript” parser ambiguity.
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./ARCHITECTURE.md` (+32 -32)
> - Wrote `./scripts/version.js` (+1 -1)
> - Wrote `./ARCHITECTURE.md` (+5 -5)
>
> </details>
>
> I braced all mathematical subscripts consistently, including styled bases such as `${\mathrm{enter}}_{k}$`, and changed superscripted forms to explicit constructions such as `$y_{k}^{*}$`. Literal diagnostic identifiers are unchanged.
</details>

Braced all mathematical subscripts, including styled bases such as:

```text
${\mathrm{enter}}_{k}$
$y_{k}^{*}$
$E_{2}$
```

Committed as `0d35416`, version `6.31`. Builds and checks pass.

> What you wrote in ARCHITECTURE.md starts well. It fixes the general principles.  We need to move quicker into the specific. The remainder of the section you wrote does not do that. I did not expect you to be able to do so.

That is fair. The section establishes the general conjecture, but then continues refining notation instead of cashing the conjecture out against the fixed-deck observations.

The next part should become concrete immediately:

- Choose an actual repeatable landmark from the recorded data, such as the geometric deactivation of a specified deck.
- Describe the complete observed state there across runs.
- Identify the geometric variables that vary: boundary distances, realized heights, clamped first jump, `extraJump`, and decks crossed.
- Follow those runs to a specific later landmark.
- Show how activations, deactivations, erasures, and `T` distribute from that starting geometry.
- Test whether the geometric variables explain the differences between runs.
- Only then revise the tentative definition of \(X_{k}\).

In other words, the remainder should be a worked empirical model, not more general formalism. The existing tuple and probabilistic notation are placeholders for that work and should probably be shortened or moved after the concrete analysis.

> We started top down and we will now continue bottom-up. We will look at statistics compiled from the 6.22 and 6.23 bactches and see if the generic conjecture we have can be used to find explanations for these statistics.

Yes. That gives us two complementary directions:

- Top-down: the generic conjecture says that, after accounting for traversal speed, geometric state should explain the distribution of later behavior.
- Bottom-up: the 6.22 and 6.23 batches provide concrete statistics that the conjecture must explain—or fail to explain.

The proper next step is therefore not to refine \(X_{k}\) abstractly. It is to:

1. Establish exactly what differs between 6.22 and 6.23, especially split versus unsplit movement.
2. Reproduce the principal statistics with explicit populations and outcome definitions.
3. Select one statistic, initially the erasure ratio conditioned on `split = true` and \(T\).
4. Identify the realized geometric paths that populate each cell of that table.
5. Determine which pre-outcome geometric variables explain the ratios.
6. Add those variables to \(X_{k}\) only when the evidence requires them.

This also keeps an important distinction visible: \(T\) is a useful observed statistic, but because it is measured after the movement and can itself be affected by erasure or geometry changes, it may be something to explain rather than an explanatory component of \(X_{k}\).

So the generic conjecture becomes a research guide: for each statistic, search for a geometric partition that makes the statistic intelligible. The 6.22 split runs provide additional intermediate geometry, while the 6.23 unsplit runs serve as the control traversal through the same conversation.

> For the split batchs (6.22), consider all fisrt or normal jumps n in all runs (except the last in a conversation) and draw a table of the erasures ratios of the next normal or first jump  n+1 conditioned by T, the total number of rAFs needed for stabilization of the jump n.

<details><summary>3 previous messages</summary>

> I’ll compute this directly from every completed 6.22 cycle. I’ll treat each recorded jump as the normal/first jump of its movement—the split `extraJump` is not a separate jump record—pair jump \(n\) with the following recorded jump \(n+1\) within the same conversation, and omit each conversation’s final jump because it has no successor. I’ll verify how retries are represented before fixing the population.
>
> Remove retries of erased jumpsé
>
> Understood. I’ll remove jump records whose outcomes are `retry-succeeded` or `retry-erased` before forming the sequence. Then \(n+1\) means the next normal/first jump after any erased-jump retry, not the next raw ledger entry. I’ll also exclude unclassified `null` records because they are not usable normal/first outcomes.
</details>

After removing erased-jump retries, the 40 completed 6.22 runs give:

| \(T\): stabilization rAFs for jump \(n\) | Eligible jumps \(n\) | Erased next jumps \(n+1\) | Erasure ratio |
|---:|---:|---:|---:|
| 1 | 98,652 | 5,119 | 5.189% |
| 2 | 17,640 | 845 | 4.790% |
| 3 | 8,255 | 19 | 0.230% |
| 4 | 6,870 | 0 | 0.000% |
| 5 | 439 | 0 | 0.000% |
| 6 | 27 | 0 | 0.000% |
| **Total** | **131,883** | **5,983** | **4.536%** |

Population construction:

- Included all 40 completed 6.22 conversations.
- Removed 5,983 `retry-succeeded`/`retry-erased` records.
- Removed 20 unclassified records with `outcome = null`.
- Formed the sequence from the remaining `survived` and `erased` normal/first jumps.
- Omitted the last such jump in each conversation.
- Defined \(T\) as the number of stabilization rAF records belonging to jump \(n\).

The sharp feature is between \(T=2\) and \(T=3\): the next-jump erasure ratio falls from 4.790% to 0.230%. No next jump is erased after \(T \ge 4\).

> Do the same for the non split jumps. There is no extra jumps So all jumps are normal jumps.

<details><summary>1 previous message</summary>

> I’ll apply the same construction to 6.23: remove erased-jump retry records, retain normal jumps with classified `survived` or `erased` outcomes, pair each with the next normal jump, and omit the final eligible jump in each run. Since 6.23 contains one failed run, I’ll calculate both the all-run table and the completed-only check so its effect is visible.
</details>

For all 22 version 6.23 runs, after removing erased-jump retries:

| \(T\): stabilization rAFs for jump \(n\) | Eligible jumps \(n\) | Erased next jumps \(n+1\) | Erasure ratio |
|---:|---:|---:|---:|
| 1 | 73,160 | 5,523 | 7.549% |
| 2 | 12,690 | 1,272 | 10.024% |
| 3 | 4,941 | 0 | 0.000% |
| 4 | 5,343 | 5 | 0.094% |
| 5 | 20 | 0 | 0.000% |
| 6 | 6 | 0 | 0.000% |
| **Total** | **96,160** | **6,800** | **7.071%** |

Population construction:

- Included all 22 version 6.23 runs: 21 completed and one failed after a partial traversal.
- Confirmed that there are zero split jumps.
- Removed 6,800 erased-jump retry records.
- Removed 21 unclassified records with `outcome = null`.
- Omitted the final eligible jump in each run.
- Defined \(T\) as the number of stabilization rAFs belonging to jump \(n\).

The completed-only table has essentially the same shape: 7.585% at \(T=1\), 10.064% at \(T=2\), 0% at \(T=3\), and 0.077% at \(T=4\). Thus, the failed run does not materially affect the pattern.

> How do you count the total number of rAFs ? If there is no change in the first rAF callback and stableFrames == 1, what is the total number of rAFs?

<details><summary>1 previous message</summary>

> I counted only records with `rafKind === "stabilization"` assigned to jump \(n\). I’ll verify that against the stabilization loop, because the split’s extra jump and the jump-rAF observation may make “total rAFs” differ from that simple count.
</details>

The total is **1 rAF**.

I counted only stabilization callbacks:

```text
T = number of records where
    jumpNumber = n
    and rafKind = "stabilization"
```

The preceding `rafKind = "jump"` callback, numbered `rafNumber = 0`, is where jump \(n\) is issued. I did not count it as part of stabilization.

Therefore, when:

- `stableFrames === 1`, and
- the first stabilization rAF observes no geometry change,

`unchanged` becomes 1, stabilization returns immediately, and \(T=1\).

If we chose to include the jump-rAF callback, the same case would have two rAF callbacks in the larger sequence, but that is not the definition used in the tables.

> In the current definition, there is never T = 0. The mimimum is T= 1.

Correct. Under the current definition:

\[
T = \text{number of stabilization rAF callbacks executed for jump } n
\]

Every stabilization wait executes at least one rAF callback before it can return. Therefore:

\[
T \ge 1
\]

The minimum case is \(T=1\): `stableFrames === 1`, with no relevant geometry change in the first stabilization rAF. There is no \(T=0\) population.

> Is T =1 only when there is no geometric activation by the jump ?

<details><summary>1 previous message</summary>

> The rule suggests that \(T=1\) requires `activationNear === false` at the start of stabilization, but that is not automatically identical to “the jump caused no geometric activation.” I’ll check the recorded geometric-activation ledger against the \(T=1\) jumps before stating whether they coincide empirically.
</details>

No. \(T=1\) is determined by the stabilization rule, not directly by whether the jump produced a geometric activation.

For a tracked jump:

```js
stableFrames = !activationNear ? 1 : 2;
```

Therefore, \(T=1\) requires:

1. `activationNear === false` when stabilization begins, so `stableFrames === 1`.
2. The first stabilization rAF observes no relevant change in `geometrySnapshot()`.

`activationNear` describes the post-jump condition—whether a not-ready deck is currently near the activation boundary. It does not record whether a deck crossed a geometric observation boundary during the jump.

The data confirm the distinction:

| Batch | \(T=1\) jumps | \(T=1\) with recorded geometric activation |
|---|---:|---:|
| 6.22 | 98,690 | 20,500 |
| 6.23 | 73,180 | 15,308 |

One caveat is that the diagnostic `geometricActivations` ledger detects a deck crossing `OBSERVATION_BAND_DIAGNOSTICS`; it is not identical to `activationNear`, which uses `MIN_ACTIVATION_DISTANCE`.

Thus the accurate statement is:

> \(T=1\) occurs when no activation is considered near at the start of stabilization and the first stabilization rAF observes stable geometry.

It does not imply that the preceding jump produced no geometric activation.

> What is the difference between
> ```
> activationNear
> ```
> and geometric activation ?

<details><summary>1 previous message</summary>

> I’ll trace both definitions to their geometry and constants, because the diagnostic name “geometric activation” is broader than the stabilization predicate `activationNear`.
</details>

`activationNear` is a post-jump state; geometric activation is a boundary-crossing event.

Geometric activation is detected by comparing geometry immediately before and after the jump. For an upward jump, it occurs when the closest inactive deck above crosses from at least 1,000 px away to less than 1,000 px away:

\[
d_{\text{before}} \ge 1000
\quad\text{and}\quad
d_{\text{after}} < 1000
\]

`activationNear` is evaluated when stabilization begins:

```js
activationNear =
    roomUntilFirstNotReadyDeck() <= MIN_ACTIVATION_DISTANCE;
```

It asks whether a formally inactive deck is currently no more than 1,000 px above the viewport.

Consequently:

- A geometric activation normally implies `activationNear === true`.
- `activationNear === true` does not imply a geometric activation. The deck might already have been inside the 1,000 px area before the jump.
- Landing exactly at 1,000 px sets `activationNear === true`, but does not satisfy the strict geometric-activation crossing test.
- `activationNear === false` means no formally inactive deck is currently within that area above the viewport.

This also corrects my previous answer. I mistakenly used `rafDeckStudy.geometricActivations`, which records crossings of a separate 2,500 px diagnostic observation band. It is not the actual 1,000 px geometric-activation test.

Using the correct before/after 1,000 px test:

| Batch | \(T=1\) jumps | Geometrically activating among them |
|---|---:|---:|
| 6.22 | 98,690 | 0 |
| 6.23 | 73,180 | 0 |

Thus, empirically and by the current flow, \(T=1\) occurs only when the jump does not geometrically activate a deck. The converse is not guaranteed: a jump without geometric activation can still have \(T>1\), particularly when `activationNear` was already true or later geometry changes prolong stabilization.

> In my discussions with previous agents (not all of them available), I always specified that the number of frames needed for stabilisation is 1 when there is no geometric activation and 2 otherwise. I don't understand why and when that changed or perhaps it has never been understood by previous agents.  Can you look at previous commits and detect when the definition of stableFrames changed, if it has changed ?

<details><summary>1 previous message</summary>

> I’ll trace `stableFrames`, `activationNear`, and the geometric-activation predicate through Git history, including the diagnostic and generated sources. I’ll identify the introducing commit and every semantic change, then compare those implementations with your intended rule.
</details>

The intended rule has never been encoded literally as “did this jump geometrically activate a deck?” It has been encoded through the post-jump proxy `roomUntilFirstNotReadyDeck()`.

History:

| Date | Commit | Rule |
|---|---|---|
| Before 2026-07-17 | before `155f08a` | Post-jump movement explicitly requested `stableFrames: 1`; no activation-dependent choice. |
| 2026-07-17 | `155f08a` | Introduced `stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE ? 2 : 1`. |
| 2026-07-23 | `c251aa7`, then `f2d83ae` | Moved the same rule between modules and inverted its expression without changing its meaning. |
| 2026-07-28 | `f5684f6` | Temporarily made the rule symmetric: two frames when either activation above or deactivation below was near. |
| 2026-07-28 | `ed02265` | Restored the asymmetric activation-only rule about two hours later. |
| 2026-07-29 | `bfa03c8` | Promoted that restored rule to production. |
| 2026-08-10 | `e51e6d3` | Changed stabilization and split mechanics, but retained the same `stableFrames` assignment. |

The current rule is:

```js
const activationNear =
    activationDistanceAbove <= MIN_ACTIVATION_DISTANCE;

const stableFrames = trackAnchor && !activationNear
    ? 1
    : 2;
```

The explicit before/after geometric-activation predicate did not exist until commit `1b04548` on 2026-08-02:

```js
before.activationDistanceAbove >= MIN_ACTIVATION_DISTANCE &&
after.activationDistanceAbove < MIN_ACTIVATION_DISTANCE
```

That predicate was added for diagnostics. It was never connected to `stableFrames`.

So there are two answers:

1. The intended asymmetric rule has been stable since July 17, apart from the short-lived symmetric experiment on July 28.
2. The code has never literally defined `stableFrames` from geometric activation by the current before/after definition. It has always used `activationNear` after the jump as a proxy.

Those are equivalent only under an additional invariant:

> Before the jump, no inactive deck is already within the activation area.

Under that invariant:

- inactive deck outside before and inside after → geometric activation → `activationNear` → 2;
- no crossing → no inactive deck inside after → not `activationNear` → 1.

Without that invariant, `activationNear` can be true even though the current jump did not geometrically activate anything. That is why my earlier distinction was possible from the literal code, even though it conflicts with the intended conceptual rule.

The most accurate conclusion is: previous discussions likely stated the intended rule, while the implementation used a proxy assumed to be equivalent. The code did not change away from an explicit geometric-activation test; that explicit test was never the source of `stableFrames`.

> It is rare and exceptional that there is an inactive deck in the active area, but I have seen it in buggy situations. So, it is safer to directly use the criterion.  Before making any change, is trackAnchor always true when called ?

<details><summary>1 previous message</summary>

> I’ll inspect every current call site, including default and initialization stabilizations, and distinguish the movement path relevant to `stableFrames` from other uses.
</details>

No. There are three source-level invocations:

| Location | Purpose | `trackAnchor` |
|---|---|---:|
| `moveAnchorToBottom` | Stabilize each normal/first movement jump | `true` |
| `moveViewportToDocumentBottom` | Stabilize after clicking the bottom-navigation item | default `false` |
| `moveViewportToDocumentBottom` | Stabilize after moving to the literal document end | default `false` |

Thus, `trackAnchor` is always `true` for the movement jumps studied in the 6.22 and 6.23 tables, including erased-jump retries. It is `false` only for the two initialization waits, which are not recorded as normal traversal jumps.

With `trackAnchor === false`, the current expression always selects two stable frames:

```js
const stableFrames = trackAnchor && !activationNear
    ? 1
    : 2;
```

A direct geometric-activation rule should therefore preserve two distinct cases:

```text
tracked movement jump:
    2 stable frames if that jump geometrically activates a deck
    1 stable frame otherwise

untracked initialization stabilization:
    2 stable frames
```

So `trackAnchor` cannot simply be removed from the decision, but for the jump population under investigation it is invariantly true.

> Ok, use the direct criterion, no proxy.

<details><summary>7 previous messages</summary>

> I’ll make the movement worker return whether the just-issued jump crossed the activation boundary, pass that boolean into stabilization, and select one versus two stable frames from it. Untracked initialization waits will continue to require two stable frames.
>
> <details><summary>Edited 8 files</summary>
>
> - Wrote `./scripts/version.js` (+1 -1)
> - Wrote `./src/app/cycleDiagnostics-diag.js` (+1 -0)
> - Wrote `./src/app/moveAnchorToBottom-diag.js` (+5 -1)
> - Wrote `./src/app/moveAnchorToBottom.js` (+5 -1)
> - Wrote `./src/app/supplyWorker-diag.js` (+9 -5)
> - Wrote `./src/app/supplyWorker.js` (+9 -2)
> - Wrote `./src/app/waitLayoutStable-diag.js` (+5 -2)
> - Wrote `./src/app/waitLayoutStable.js` (+3 -12)
>
> </details>
>
> The non-diagnostic sources are generated and read-only, so the first patch was rejected without changing files. I’ll edit only the canonical diagnostic sources, then let the required build regenerate their non-diagnostic counterparts.
>
> <details><summary>Edited 4 files</summary>
>
> - Wrote `./scripts/version.js` (+1 -1)
> - Wrote `./src/app/moveAnchorToBottom-diag.js` (+5 -1)
> - Wrote `./src/app/supplyWorker-diag.js` (+9 -5)
> - Wrote `./src/app/waitLayoutStable-diag.js` (+4 -2)
>
> </details>
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> The direct criterion is now wired in. I’m finishing the scoped verification while leaving your current `ARCHITECTURE.md` edits untouched.
>
> The commit hook is still running; the implementation files are staged separately, so the unrelated architecture draft cannot enter this commit.
</details>

Implemented and committed as `9a4ed5b`.

Stabilization now directly uses geometric activation:

- Tracked jump: 2 stable frames if it geometrically activates a deck; otherwise 1.
- Untracked initialization: remains 2 frames.
- The `activationNear` proxy is no longer used for this decision.
- Version bumped to 6.32.
- Build and tests pass.

Your uncommitted `ARCHITECTURE.md` changes remain untouched.

> Is the definition of T we have now the same as in the tables that you draw ?

Yes—the counting definition is the same.

In the tables, \(T\) is the total number of `rafKind === "stabilization"` callbacks for jump \(n\), including the final callback that establishes stability. Therefore \(T \ge 1\):

- No geometric activation: stabilization target is 1, so \(T=1\) if the first callback detects no change.
- Geometric activation: target is 2, so the minimum is \(T=2\).
- Additional layout changes can make \(T\) larger.

However, the 6.22 and 6.23 tables describe runs produced by the earlier proxy-based implementation. The way \(T\) was counted is unchanged, but whether the stabilization target was 1 or 2 was then selected using `activationNear`, not the new direct geometric-activation criterion. Thus the historical table values should not be interpreted as having been generated by the corrected rule.

> Discussion with Claude :
>
> User context
>
> Attachments:
> - In a previous session (see Chat with AI/Claude about splits and non splits.md) …: `~/.codex/attachments/f58259ab-9d86-4200-83dd-87907426fc49/pasted-text.txt`

<details><summary>1 previous message</summary>

> I’ll read the discussion and relate its definitions and conclusions to our current implementation and the earlier tables.
</details>

I have read it. It clarifies the relationship between \(T\), geometric activation, and erasure:

- The discussion counts \(T\) exactly as we did in our tables: the number of stabilization rAF records associated with jump \(n\).
- In the 6.22 and 6.23 data, every jump identified as geometrically activating had \(T>1\).
- Nevertheless, “\(T>1\) prevents the next jump from being erased” is not exceptionless:
  - 6.23, without splits: 4 of 6,537 erased jumps had a geometrically activating predecessor.
  - 6.22, with splits: 90 of 5,737 did.
- All 90 split-build exceptions followed split jumps. The four non-split exceptions recur at one particular conversation location and involve the same decks.

Thus, the old observation is a very strong association, but not an absolute rule.

I would be more cautious than Claude about the explanation. The data establishes that the 90 exceptions are structurally associated with split predecessors, but it does not yet establish that “boundary-hugging activation” causes them. Likewise, the suppression ratios are conditional associations, not evidence of a causal mechanism by themselves.

Most importantly for our present work: the corrected direct criterion does not redefine \(T\). It changes how the minimum stabilization requirement is selected:

\[
\text{geometric activation} \Rightarrow \text{at least two stable rAF observations}.
\]

The realized \(T\) may be larger because geometry continues changing. Consequently:

- geometric activation should imply \(T\ge 2\);
- \(T\ge 2\) does not necessarily imply geometric activation;
- the tables conditioned on \(T\) are therefore not identical to tables conditioned on geometric activation.

The Claude discussion supports treating \(T\) as a time/realized-stabilization variable influenced by geometry, while geometric activation is one specific geometric cause of a larger minimum \(T\).

> What I don't understand is how T> 1 can allow erasure. T > 1 is impossible when there is no geometric activation and geometric activation is needed for erasure: T > 1 => geometric activation  => no erasure.  There is something I do not get.

<details><summary>1 previous message</summary>

> I’m checking the exact stopping loop, because the issue is the distinction between the required number of unchanged frames and the total number of rAF callbacks \(T\).
</details>

The missing distinction is:

\[
T \ne \texttt{stableFrames}.
\]

`stableFrames` is the required number of consecutive unchanged observations:

\[
\texttt{stableFrames} =
\begin{cases}
1 & \text{without geometric activation},\\
2 & \text{with geometric activation}.
\end{cases}
\]

But \(T\) in our tables is the total number of rAF callbacks executed before that requirement is met.

For example, without geometric activation:

1. First rAF: geometry changes, so the unchanged counter remains 0.
2. Second rAF: geometry does not change, so the counter becomes 1.
3. Stabilization returns.

Here, `stableFrames = 1`, but \(T=2\). More changes can produce \(T=3,4,\ldots\), still without geometric activation.

Therefore the valid implications are:

\[
\text{geometric activation} \Rightarrow \texttt{stableFrames}=2
\Rightarrow T\ge 2,
\]

but not:

\[
T>1 \Rightarrow \text{geometric activation}.
\]

So a next-jump erasure conditioned on \(T>1\) can follow a non-activating jump whose stabilization was prolonged by some other realized geometric change—especially deactivation or its resulting relayout.

This also means I described \(T\) too loosely earlier as “the number of frames needed for stabilization.” More precisely, \(T\) is the total number of stabilization callbacks actually executed; `stableFrames` is the stopping threshold. That distinction should be explicit in the tables and architecture document.

> Are you saying that it is possible to have change in the first rAF when there is no geometric activation ? That is formally possible, but hard to explain.

Yes. “No geometric activation by this jump” only means that the jump did not cross an activation boundary. It does not mean that no geometry can change before its first rAF.

A first-rAF change can come from:

- A geometric deactivation caused by the jump.
- Formal activation or deactivation completing after being geometrically requested by an earlier jump.
- Realization of a deck’s height, or application of `--last-known-height`.
- Other pending renderer work changing `scrollHeight` or compensating `scrollY`.

The stabilization comparison is between the geometry immediately after the scroll command and the geometry observed at the first rAF. Any pending work completed during that interval can make them differ.

This is especially plausible for the erasure population: the earlier data says that the predecessor of an erased jump usually causes geometric deactivation, not activation. Such a predecessor has `stableFrames = 1`, but its deactivation-related work can change geometry at the first callback:

\[
\begin{aligned}
\text{jump }n &: \text{no activation, but deactivation},\\
\text{first rAF} &: \text{geometry changes},\\
\text{second rAF} &: \text{geometry unchanged},\\
T_n &= 2.
\end{aligned}
\]

So \(T_n>1\) can represent two quite different situations:

1. Two unchanged frames were required because jump \(n\) geometrically activated a deck.
2. Only one unchanged frame was required, but one or more earlier callbacks contained changes.

Conditioning only on \(T\) mixes these cases. To explain the erasure ratios, we should separate at least:

\[
(T,\ A_n,\ D_n),
\]

where \(A_n\) and \(D_n\) indicate geometric activation and deactivation by jump \(n\). The current \(T\)-only table cannot tell which mechanism produced \(T>1\).

> Stabilization of the previous jump shoud normally make sure that any change related to the previous jump are things of the past and we only expect new things when there is geometric activation.

Yes. Under the intended baseline model, stabilization of jump \(n-1\) should discharge its observable consequences. If jump \(n\) does not geometrically activate anything, its first rAF should then contain no new geometry change, giving \(T_n=1\).

So your intended implication is:

\[
T_n>1 \Rightarrow A_n,
\]

where \(A_n\) means that jump \(n\) geometrically activates a deck.

My previous answer only described what the loop formally permits. I treated delayed work and deactivation as explanations without first demonstrating them in the data. That was premature. In particular, the Claude analysis established:

\[
A_n \Rightarrow T_n>1,
\]

but did not establish the converse. These are not equivalent.

We therefore need to verify directly, using the same filtered population as our tables:

- normal and first jumps only;
- retries excluded;
- extra split jumps excluded as independent observations;
- geometric activation reconstructed at the 1000-pixel boundary;
- \(T\) counted from stabilization rAFs.

Then divide \(T>1\) jumps into activating and non-activating cases. If non-activating cases exist, each is an anomaly requiring a concrete trace-level explanation. We should not explain the erasure ratios by such cases until we have shown that they actually exist.

> Can you verify that geometric activation (near activation in the old language)  implies no erasure in 6.22 and 6.23 except for a few exceptions and check that indeed T > 1 occurs often when there is no activation  and erasure. Perhaps see what typically changes to make T > 1.

<details><summary>4 previous messages</summary>

> I’ll verify both directions on the exact table population, then inspect the rAF traces of non-activating predecessors with \(T>1\), separating split and non-split batches and excluding retries and split extras as requested.
>
> <details><summary>Created a file</summary>
>
> - Wrote `/tmp/verify_t_activation.py` (+108 -0)
>
> </details>
>
> The first pass confirms the surprising case is real and highly regular: among non-activating predecessors with \(T>1\) followed by erasure, the first rAF almost always contains a formal deactivation and a compensating `scrollY` change. I’m now checking whether that also explains the broader non-activating \(T>1\) population, rather than only the erased subset.
>
> <details><summary>Edited a file</summary>
>
> - Wrote `/tmp/verify_t_activation.py` (+14 -0)
> - Wrote `/tmp/verify_t_activation.py` (+2 -1)
>
> </details>
</details>

Yes. The data verifies both observations, and it resolves the apparent contradiction.

I used the filtered table population:

- retries removed;
- split extra jumps not treated as separate jumps;
- each normal or first jump \(n\) paired with the next normal or first jump;
- activation determined directly from crossing the 1000 px boundary;
- \(T_n\) counted from stabilization rAF records.

### Activation by \(n\) versus erasure of \(n+1\)

| Batch | Activating \(n\) | \(n+1\) erased | Ratio |
|---|---:|---:|---:|
| 6.22 large, split | 22,717 | 90 | 0.396% |
| 6.22 small, split | 3,684 | 2 | 0.054% |
| 6.22 combined | 26,401 | 92 | 0.348% |
| 6.23 large, non-split | 16,694 | 4 | 0.024% |

Thus geometric activation by \(n\) almost always implies that \(n+1\) survives:

- 99.65% in 6.22;
- 99.98% in 6.23.

All 92 exceptions in 6.22 are split jumps. The four 6.23 exceptions are the recurring exceptional location identified in the Claude discussion.

### Does \(T>1\) occur without activation?

Yes, regularly:

| Batch | Non-activating \(n\) | With \(T_n>1\) | Ratio |
|---|---:|---:|---:|
| 6.22 combined | 105,482 | 6,830 | 6.48% |
| 6.23 | 75,393 | 5,374 | 7.13% |

More specifically, among non-activating predecessors of erased jumps:

| Batch | \(n+1\) erased | Also \(T_n>1\) | Ratio |
|---|---:|---:|---:|
| 6.22 combined | 5,891 | 772 | 13.1% |
| 6.23 | 6,533 | 1,222 | 18.7% |

Therefore the implication

\[
T_n>1 \Rightarrow A_n
\]

is empirically false.

### What changes?

The cases followed by erasure are exceptionally regular.

For all 1,222 cases in 6.23 where:

\[
\neg A_n,\quad T_n>1,\quad E_{n+1},
\]

the following occurred:

- jump \(n\) geometrically deactivated a deck;
- a formal `true → false` transition occurred during its stabilization;
- the first rAF changed `scrollY` and consequently the measured anchor/deck rooms;
- `scrollHeight` did not change;
- \(T_n=2\).

For the corresponding 772 cases in 6.22:

- all 772 geometrically deactivated at least one deck;
- 753 had the same `true → false` transition and `scrollY` change;
- 19 had a `false → true` transition together with changes in both `scrollY` and `scrollHeight`;
- 753 had \(T_n=2\), and 19 had \(T_n=3\).

So the typical explanation is not delayed work left by jump \(n-1\). It is new deactivation work caused by jump \(n\). The deck formally deactivates at the first stabilization rAF, and `scrollY` changes even though `scrollHeight` normally remains constant.

The important distinction is therefore:

\[
A_n \Rightarrow T_n>1,
\]

but also, quite independently,

\[
D_n \text{ followed by formal deactivation} \Rightarrow T_n>1
\]

in many cases.

That means the \(T>1\) row mixes two geometrically different populations:

1. activation-driven stabilization, after which erasure is almost absent;
2. deactivation-driven stabilization, after which erasure is comparatively common.

This mixture explains why conditioning on \(T\) alone did not yield the implication you expected.

> You are saying that deactivation (upt to formal) changes the geometry checked in stabilization.

More precisely: during the interval from geometric deactivation to formal deactivation, the first stabilization rAF frequently observes a `scrollY` change.

The stabilization detector checks `scrollY` and `scrollHeight`; it does not check the deck’s formal activation state. In the typical cases:

1. Jump \(n\) geometrically deactivates a deck.
2. At stabilization rAF 1, the deck changes formally from `true` to `false`.
3. At that same rAF, `scrollY` differs from its post-jump value.
4. `scrollHeight` usually remains unchanged.
5. Because `scrollY` changed, stabilization requires another rAF, producing \(T_n=2\).

Thus formal deactivation and the geometry change are simultaneous in the observations. The data alone does not prove that formal deactivation causes the `scrollY` change, but their systematic coincidence strongly associates them. The checked geometry change is specifically `scrollY`, not the formal state itself.

> It's weird that scrollY differs from its post-jump value, because deactivation occurs below the viewport : why should that makes the viewport move ?

<details><summary>2 previous messages</summary>

> Agreed—that is geometrically suspicious. I’ll inspect the sign and magnitude of the `scrollY` shift and the deactivated deck’s recorded position to determine whether this is browser anchoring, jump cancellation, or a diagnostic-coordinate issue.
>
> <details><summary>Edited a file</summary>
>
> - Wrote `/tmp/verify_t_activation.py` (+2 -0)
> - Wrote `/tmp/verify_t_activation.py` (+2 -0)
>
> </details>
</details>

You are right: deactivation below the viewport should not normally move `scrollY`. I inspected a representative case, and my previous interpretation was wrong.

The `scrollY` change is the erasure of jump \(n\) itself.

For example, in 6.23 cycle 1, jump 33:

- requested jump: 311 px;
- post-jump `scrollY`: 1,284,043;
- first-rAF `scrollY`: 1,284,354;
- difference: exactly +311 px.

The viewport returned by exactly the requested displacement. That is the definition of the jump being erased.

The formal deactivation happened at the same rAF, but its deck was below the viewport and its position and saved height did not change. It was a coincident event, not an explanation for the `scrollY` movement. Moreover, the deck recorded as geometrically deactivated by that jump was not even the same deck as the formal transition I had associated with it.

The source of the confusion is important: we removed retry records, but retained the original erased jumps. Therefore jump \(n\) in the table can itself be erased. When it is:

1. Jump \(n\) changes `scrollY`.
2. Its first rAF restores `scrollY`, so stabilization observes a change.
3. Another unchanged rAF is required, producing \(T_n>1\).
4. The retry succeeds but is removed from the table.
5. The next normal jump, called \(n+1\) in the filtered sequence, may also be erased.

Indeed, every non-activating \(T_n>1\) case followed by erasure in the counts I reported had jump \(n\) itself erased:

| Batch | Such cases | Jump \(n\) itself erased |
|---|---:|---:|
| 6.22 large | 769 | 769 |
| 6.22 small | 3 | 3 |
| 6.23 | 1,222 | 1,222 |

More broadly, most non-activating \(T>1\) jumps were themselves erased:

- 6.22 large: 5,591 of 6,423;
- 6.23: 4,734 of 5,374.

So the main implication is:

\[
E_n \Rightarrow T_n>1,
\]

because the erasure is observed as a first-rAF geometry change.

This means \(T_n\) is not merely a measurement of stabilization work preceding the erasure of \(n+1\). It also encodes whether \(n\) itself was erased. The \(T\)-conditioned next-erasure table is therefore largely measuring persistence or clustering of erasures across successive normal jumps.

My earlier claim that deactivation explained these `scrollY` changes was incorrect.

> The logic used for stabilization does not seem to detect an actual stabilization when the jump is erased. Perhaps, what should be removed is the erased jump and the retriy should be conserved.

Yes. For the traversal analysis, the erased attempt should be removed and its successful retry retained.

The stabilization after an erased attempt does detect a stable geometry, but it detects stability after the viewport has returned to its pre-jump position. It therefore does not describe stabilization of the intended traversal movement. Its \(T\) belongs to a failed attempt.

The retry is the movement that actually advances the traversal. Consequently, the logical sequence should be constructed as:

- retain an ordinary jump when it survives;
- when an ordinary jump is erased, discard that record;
- retain its `retry-succeeded` record as the realized version of that logical jump;
- retain split first jumps according to the same rule;
- do not treat the erased attempt and retry as two traversal positions.

Then \(T_n\) is measured on the movement that establishes traversal position \(n\), and the outcome being predicted is the first attempt at logical movement \(n+1\).

This avoids the contamination we just found:

\[
E_n \Rightarrow T_n>1
\]

would disappear from the conditioning variable because the failed attempt’s stabilization rAFs would no longer define \(T_n\). The retry’s stabilization rAFs would define it instead.

We should therefore redraw both 6.22 and 6.23 tables with this corrected logical-jump construction. The previous tables that removed retries and retained erased attempts do not answer the intended question.

> Yes do that.

<details><summary>2 previous messages</summary>

> I’ll reconstruct each logical jump from the movement that actually advances the traversal: a survivor as-is, or the successful retry in place of its erased attempt. The retry’s stabilization rAFs will define \(T\), while the logical jump retains whether its first attempt was erased for the outcome column.
>
> <details><summary>Created a file</summary>
>
> - Wrote `/tmp/logical_jump_t_tables.py` (+93 -0)
>
> </details>
</details>

The corrected tables now use logical jumps:

- A surviving first attempt represents the logical jump.
- An erased first attempt is discarded.
- Its successful retry represents that same logical jump.
- \(T_n\) is counted from the movement that actually advances the traversal.
- The outcome for \(n+1\) records whether its first attempt is erased.

### 6.22 split batches, combined

| \(T_n\) | Logical jumps | Next attempt erased | Ratio |
|---:|---:|---:|---:|
| 1 | 104,399 | 5,891 | 5.643% |
| 2 | 12,086 | 92 | 0.761% |
| 3 | 8,047 | 0 | 0% |
| 4 | 6,901 | 0 | 0% |
| 5 | 423 | 0 | 0% |
| 6 | 27 | 0 | 0% |

The large and small conversations separately show the same shape:

- Large: 90 erasures at \(T=2\), none at \(T\ge3\).
- Small: 2 erasures at \(T=2\), none at \(T\ge3\).

### 6.23 non-split batch

| \(T_n\) | Logical jumps | Next attempt erased | Ratio |
|---:|---:|---:|---:|
| 1 | 74,729 | 6,533 | 8.742% |
| 2 | 8,860 | 0 | 0% |
| 3 | 3,020 | 0 | 0% |
| 4 | 5,453 | 4 | 0.073% |
| 5 | 19 | 0 | 0% |
| 6 | 6 | 0 | 0% |

This restores the strong result you expected:

\[
T_n>1 \Rightarrow \text{no erasure of }n+1
\]

except for:

- 92 cases in 6.22, all at \(T=2\);
- 4 cases in 6.23, all at \(T=4\).

All 96 exceptions are geometrically activating predecessors. There are no cases in either batch where all three conditions hold:

\[
\neg A_n,\qquad T_n>1,\qquad E_{n+1}.
\]

Non-activating logical jumps with \(T>1\) still exist:

- 1,045 across the combined 6.22 batches;
- 664 in 6.23.

But none is followed by an erasure.

The activation-conditioned table is consequently:

| Batch | Predecessor | Logical jumps | Next erased | Ratio |
|---|---|---:|---:|---:|
| 6.22 combined | No activation | 105,444 | 5,891 | 5.587% |
| 6.22 combined | Activation | 26,439 | 92 | 0.348% |
| 6.23 | No activation | 75,393 | 6,533 | 8.665% |
| 6.23 | Activation | 16,694 | 4 | 0.024% |

So removing erased attempts and retaining their retries was the correct construction. The earlier tables had allowed the erasure of jump \(n\) itself to inflate \(T_n\), obscuring the relationship we wanted to measure.

> In these 96 cases with a deck being deactivated, can we check when its formal deactivation and last-known-height occur relative to the next erased jump.

<details><summary>4 previous messages</summary>

> I’ll trace every deck geometrically deactivated by each of those 96 predecessor movements, then place its formal deactivation and `--last-known-height` update relative to the following erased first attempt. I’ll keep the four 6.23 cases separate from the split cases.
>
> <details><summary>Created a file</summary>
>
> - Wrote `/tmp/trace_96_deactivations.py` (+128 -0)
>
> </details>
>
> The first result corrects the premise: 90 of the 92 split-build exceptions have no deck recorded as geometrically deactivated by the predecessor; the four 6.23 exceptions each have two. I’m also tracing the deck(s) whose last-known-height update qualify the erased jump, since those may have been geometrically deactivated earlier than the immediate predecessor.
>
> <details><summary>Edited a file</summary>
>
> - Wrote `/tmp/trace_96_deactivations.py` (+30 -0)
> - Wrote `/tmp/trace_96_deactivations.py` (+20 -0)
>
> </details>
</details>

The premise needs correction: only 5 of the 96 exceptional predecessors geometrically deactivate a deck.

### 6.23: four exceptions

Every exception has the same structure:

- The predecessor geometrically deactivates two decks.
- Both decks formally deactivate at stabilization rAF 1 of the predecessor.
- Both `--last-known-height` values are written at that same rAF.
- Stabilization continues until \(T=4\).
- The next jump is then erased approximately 672–697 ms after the writes.

Across the four runs, this gives eight deactivated-deck episodes:

| Event | Timing |
|---|---|
| Geometric deactivation | Predecessor movement |
| Formal `true → false` | Predecessor stabilization rAF 1 |
| Last-known-height write | Same predecessor stabilization rAF 1 |
| Stabilization finishes | Predecessor rAF 4 |
| Erased jump | 672–697 ms after the write |

Thus the erasure occurs well after formal deactivation, after the last-known-height write, and after three further stabilization observations.

### 6.22 small conversation: two exceptions

Only one of the two predecessors geometrically deactivates a deck. For that case:

- formal deactivation occurs at predecessor stabilization rAF 1;
- last-known-height is written at the same rAF;
- the next jump is erased about 107 ms later.

For the other exception, the qualifying last-known-height write occurred one jump earlier, about 176 ms before the erased jump.

### 6.22 large conversation: 90 exceptions

None of the 90 predecessor movements has a recorded geometric deactivation. They are activating split movements, not simultaneous activation/deactivation movements.

The following erased attempts nevertheless have older last-known-height candidates:

- 44 erased attempts have one candidate;
- 46 have two candidates;
- 136 candidate writes in total;
- every write occurs before the immediate predecessor;
- they occurred 1–10 jump numbers earlier, with median 3;
- they occurred 266–1,411 ms before the erased attempt, with median about 666 ms.

Only 25 of those 136 writes coincide with a recorded formal `true → false` transition. The other 111 are writes for which no same-rAF formal transition is recorded, so the deck was likely already formally inactive or its formal transition was outside the recorded episode association.

The important distinction is therefore:

- The four 6.23 exceptions are immediate-deactivation cases: formal deactivation and last-known-height occur at the predecessor’s first stabilization rAF.
- The 90 large-conversation 6.22 exceptions are not immediate-deactivation cases. Their erased jumps refer to last-known-height values written several earlier jumps ago.

This suggests that the 6.23 exceptions test whether stabilization after deactivation is sufficient, while the 6.22 split exceptions concern older outstanding last-known-height state interacting with the split movement.

> Please do not write a logical rule to say after that it has exceptions.  It seems the situation is that we have no logical rule, only correlations, some stronger than others.  What is the factor of the previous jump with the strongest correlation with erasure of the following jump : T > 1 or geometric activation ?

<details><summary>1 previous message</summary>

> I’ll compare them as correlations—using the erasure-rate contrast against each factor’s complement—without treating either relationship as a rule.
</details>

\(T>1\) has the strongest correlation with survival of the following jump, although only slightly stronger than geometric activation.

Using the corrected logical-jump population:

| Batch | Previous-jump factor | Following-jump erasure with factor | Without factor | Rate contrast |
|---|---|---:|---:|---:|
| 6.22 combined | \(T>1\) | 0.335% | 5.643% | 16.9-fold lower |
| 6.22 combined | Geometric activation | 0.348% | 5.587% | 16.1-fold lower |
| 6.23 | \(T>1\) | 0.023% | 8.742% | 379-fold lower |
| 6.23 | Geometric activation | 0.024% | 8.665% | 362-fold lower |

The same ordering appears when the two 6.22 conversations are considered separately.

The reason the correlations are so similar is that every geometrically activating predecessor has \(T>1\). But \(T>1\) also includes some non-activating predecessors:

- 1,045 additional cases in 6.22;
- 664 additional cases in 6.23.

None of those additional cases is followed by an erasure. They therefore make the \(T>1\) correlation slightly stronger.

So the empirical ranking is:

\[
T>1\quad\text{slightly stronger than}\quad\text{geometric activation}.
\]

This does not identify a causal factor. \(T\) is a realized temporal/geometry measurement that can incorporate several events, while geometric activation is one particular geometric event. Their near-identical correlations mainly reflect their very large overlap.

> We do have geometric activation => T > 1 by construction (the code) .  This does not tell us whether  the mecanism for erasures depend on geometric activation or on T > 1. The implication only tells us that a mechanism based on T > 1 is also a mechanism based on geometric activation and a mechanism based on no geometric activation is also a mechanims based on T = 1. It does not favor any side.  Moreover,  we expect  geometric activation <=> T > 1 , because we expect  T  to reflect geo activation :   T > 1 and no geometric activation or T = 1 and geometric activations are only weirdly observed.    The weird cases no geo activation and T > 1 can be observed without changing the code.  If the rate is also the same as when  T > 1 and geometric activation, it could be seen as evidence that the factor is T > 1, but it could also be a weird side effect.    We can also remove the constructed (code imposed) implication, keep only the equivalence with weird exceptions.  We will  have non frequent, weird,  geo activation and T = 1.  If the rate of erasures drops, it could be seen as evidence that the factor is T > 1, but it could also be a weird side effect.  Is that makes sense ?

Yes, that makes sense.

The present data cannot distinguish a mechanism associated with geometric activation from one associated with \(T>1\), because the code deliberately makes:

\[
A \Rightarrow T>1.
\]

Consequently, the ordinary observations mostly lie in two cells:

| | \(T=1\) | \(T>1\) |
|---|---:|---:|
| No activation | ordinary | unusual |
| Activation | impossible by construction | ordinary |

The missing activation-and-\(T=1\) cell is exactly what prevents identification. Comparing the two common cells confounds activation and \(T\).

The existing unusual cell,

\[
\neg A,\quad T>1,
\]

could be informative. Its following-erasure rate is zero in these batches, consistent with \(T>1\) being the relevant factor. But these cases arise through unusual realized behavior, so they may differ from ordinary non-activating jumps in other ways. They are evidence, not a clean discriminator.

Removing the imposed two-frame requirement would populate the other unusual cell:

\[
A,\quad T=1.
\]

Then:

- If its erasure rate resembled other \(T=1\) jumps, that would support \(T\) as the more relevant factor.
- If it resembled other activating jumps, that would support activation as the more relevant factor.

But this would still be observational evidence rather than a decisive causal test, because activation cases that naturally produce \(T=1\) may be a selected subset with unusual realized geometry or timing. Changing stabilization also changes when the next jump occurs, so it directly changes the temporal state whose effect we are trying to measure.

A cleaner formulation is:

- Current batches establish a strong correlation with the combined condition that normally appears as \(A\) together with \(T>1\).
- The code-imposed implication prevents separating the contributions of \(A\) and \(T\).
- The rare discordant cases are suggestive but may carry selection effects.
- Allowing activating jumps to return after one unchanged rAF would create the missing comparison, but the intervention changes traversal timing and therefore must be interpreted as an experiment on the joint geometric-temporal state—not as a simple isolation of one variable.

One minor correction: removing the imposed implication would not necessarily make \(A,T=1\) rare. If activation does not cause an observable first-rAF geometry change, many activating jumps could return after their first unchanged rAF. Their frequency is itself one of the useful experimental results.

> Yes,  the rarity  of A  and  T = 1  is only expected by a conjectured mechanism for rendering, which indirectly affect T, not from the extractor code.  You seem to reject the usefulness of the possibility no A and T > 1, even without changing the code.  Is it because it is not observed at all.

No. It is observed, and it is potentially useful evidence.

After replacing erased attempts with their successful retries, we observe:

- 6.22: 1,045 logical jumps with no geometric activation and \(T>1\);
- 6.23: 664 such jumps;
- total: 1,709;
- following erasures: 0.

That is a substantial discordant population, not merely a handful of cases. Its zero erasure rate supports the hypothesis that the relevant correlate is \(T>1\), rather than geometric activation itself.

My reservation was not that these cases are absent. It was that we had not yet characterized why they have \(T>1\). If they are heterogeneous or concentrated at special conversation positions, their zero rate might be caused by the same unusual geometry that made \(T>1\), rather than by the extra elapsed frame itself.

But this does not make them uninformative. The direct comparison is:

| Previous logical jump | Cases | Following erasures |
|---|---:|---:|
| \(A,\ T>1\) | 43,133 | 96 |
| No \(A,\ T>1\) | 1,709 | 0 |

Both groups have an extremely low following-erasure rate. More importantly, the no-activation group is exactly the naturally occurring discordant cell needed to weaken the activation explanation.

The appropriate conclusion is:

- The common cells cannot discriminate because \(A \Rightarrow T>1\) is imposed by the extractor.
- The observed no-\(A\), \(T>1\) cell provides positive evidence in favor of \(T>1\) being closer to the relevant factor.
- It is not conclusive because membership in that cell is not randomly assigned.
- Characterizing what makes those 1,709 movements take multiple rAFs is the next important analysis.

So I was too dismissive of that evidence. The discordant population is large enough to analyze seriously.

> Yes it is not conclusive, but evidence.  The case A , T = 1 will not also be conclusive either, only additional evidence.

Exactly. Neither discordant cell provides a conclusive causal test:

- The naturally observed \(\neg A,\ T>1\) cases provide evidence favoring \(T\), because the following-erasure rate remains extremely low without activation.
- An experimental \(A,\ T=1\) population would provide complementary evidence. Its following-erasure rate could indicate whether the correlation follows \(A\) or \(T\), but changing stabilization also changes elapsed time and selects particular realized rendering behavior.

Together, the two discordant cells would make the comparison considerably stronger:

| Previous jump | Interpretation |
|---|---|
| \(\neg A,\ T=1\) | Ordinary baseline |
| \(A,\ T>1\) | Activation and extra stabilization coincide |
| \(\neg A,\ T>1\) | Existing evidence separating \(T\) from activation |
| \(A,\ T=1\) | Proposed complementary evidence |

The useful scientific claim is not “this proves \(T\) causes the suppression.” It is:

> Following-jump erasure is strongly suppressed when \(T>1\), including in a substantial population without geometric activation. An experiment permitting \(A,\ T=1\) would provide complementary evidence about whether the suppression tracks realized stabilization time or geometric activation.

That formulation respects both the strength and the limits of the evidence.

> If T > 1 is part of the mechanism, it is not by itself a mechanism. A mechanism should refer to a window from the capture of a geometry to its commit later during a deck deactivation.  It should explain why T > 1 prevents the erasure by moving the jump out of that erasing window.

Yes. \(T>1\) is an observed timing condition, not a mechanism.

A tentative mechanism is:

1. A deck’s geometry is captured while it is active.
2. That captured geometry remains pending.
3. During formal deactivation, the captured geometry is committed as `--last-known-height`.
4. There is a limited erasure window associated with that capture-to-commit process.
5. A jump issued inside that window can be erased.
6. An additional stabilization rAF delays the following jump until after the window has closed.

Under this account, \(T>1\) does not itself prevent erasure. It is evidence that the following jump was issued later:

\[
\text{additional rAF}
\longrightarrow
\text{later following jump}
\longrightarrow
\text{outside the capture-to-commit window}
\longrightarrow
\text{lower erasure probability}.
\]

Geometric activation is then relevant only indirectly in the present build: the extractor requires an additional unchanged frame after activation, which delays the following jump. Naturally occurring no-activation, \(T>1\) cases provide evidence for this interpretation because they introduce the same delay without activation and are also followed by no erasures.

The activation-\(T=1\) experiment would provide complementary evidence:

- If following erasures reappear, that supports the extra-rAF delay account.
- If suppression remains, that supports some activation-related state beyond the delay.

The mechanism must ultimately be expressed using clocks or rAF positions relative to the relevant deck events, not merely \(T\). A suitable variable would be something like:

\[
\Delta_n =
\text{clock of jump }n+1
-
\text{clock of the relevant geometry capture or commit}.
\]

Then the conjecture is that erasure probability is elevated only for a bounded range of \(\Delta_n\), while \(T_n>1\) usually shifts \(\Delta_n\) beyond that range. The next bottom-up step is to identify the relevant capture observation and last-known-height commit for each erased jump and compare their relative timing for the four \((A,T)\) populations.

> A deck’s geometry is captured while it is active.
> That captured geometry remains pending.
> During formal deactivation, the captured geometry is committed as --last-known-height. --- This is too specific. The erasing window might not start nor end at the commit of --last-known-height. We only have evidence that it is strongly correlated with a  deactivation.  It starts after the geometric deactivation and before the formal deactivation. We don't know much more than that.

Agreed. I made the mechanism more specific than the evidence supports.

The defensible tentative mechanism is:

1. A deck crosses its geometric deactivation boundary.
2. Some later rendering process associated with that deactivation begins.
3. During a bounded interval associated with this process, a subsequent jump can be erased.
4. Formal deactivation and the `--last-known-height` update are strongly correlated observations of that process, but neither is established as the beginning or end of the erasure window.
5. An additional stabilization rAF may delay the following jump until after that window has closed.

What we currently know about the window is limited:

\[
t_{\mathrm{geometric\ deactivation}}
<
t_{\mathrm{window\ start}}
<
t_{\mathrm{formal\ deactivation}},
\]

or, more cautiously, the evidence suggests that the window begins after geometric deactivation and before formal deactivation. We do not yet have an equally precise observed landmark for its end.

Therefore we should not say that:

- capture begins the window;
- the last-known-height commit begins or closes it;
- formal deactivation closes it;
- `--last-known-height` is itself responsible for erasure.

Those are possible refinements, not established facts.

The suitable conjecture is:

> Geometric deactivation initiates a delayed rendering process containing a bounded erasure window. Formal deactivation and the last-known-height update are observable landmarks correlated with this process. Extra stabilization time can move the following jump beyond the erasure window, which would explain the strong suppression associated with \(T>1\).

Even “move beyond” remains conjectural until we compare the following jump’s clock with the deactivation landmarks. \(T>1\) is currently evidence consistent with that timing account, not a direct observation that the window has closed.

> test

Ready.

> "An additional stabilization rAF may delay the following jump until after that window has closed." Equivalently, the extra rAF is an opportunity for the window to close before the jump.  I think that is an interesting conjecture that links the extra rAF to a suppression of the erasure.  We could verify one likely consequence of that conjecture. We consider individually the decks which formal deactivation happens close by (usually after) an erasure. For each of these decks,  the time between the erased jump and the rAF of the formal deactivation should be inversely correlated with the T of the jump that precedes the erased jump.  This supposes that T vary over runs for a given deck.  Otherwise, we will have to find a way to have T vary.

<details><summary>2 previous messages</summary>

> Yes—the predicted sign is clear: for a fixed deck, larger predecessor \(T\) should place an erased jump later in the deactivation episode, so the remaining time from that erased jump to formal deactivation should tend to be smaller. I’ll first check whether the 6.22/6.23 runs contain enough within-deck variation in \(T\) to test that prediction without changing the extractor.
>
> <details><summary>Created a file, edited a file, explored a file, a search, ran 4 commands</summary>
>
> - Ran `rg -n "formalDeactivation|selectedEpisodeId|precedingLastKnownHeightUpdateCandidates|lagN" scripts Chat\ with\ AI/*.md | head -100 && git status --short`
>
> <details><summary>Explored a file, a search</summary>
>
> - Read `./Chat with AI/Claude about splits and non splits.md`
> - Searched for `formal deactivation.*erasure|formal.*after.*eras|time between.*formal|close.*formal|individually.*deck` in `Claude about splits and non splits.md`
>
> </details>
>
> - Wrote `/tmp/formal_delay_vs_predecessor_t.py` (+114 -0)
>
> - Ran `python3 /tmp/formal_delay_vs_predecessor_t.py`
>
> - Wrote `/tmp/formal_delay_vs_predecessor_t.py` (+3 -2)
>
> - Ran `python3 /tmp/formal_delay_vs_predecessor_t.py`
>
> - Wrote `/tmp/formal_delay_vs_predecessor_t.py` (+2 -0)
>
> - Ran `python3 /tmp/formal_delay_vs_predecessor_t.py | rg "===|erased logical|candidates per|candidate rows|decks by|variation|Pearson|Spearman"`
>
> </details>
</details>

Yes, that conjecture is coherent:

> Each extra stabilization rAF gives the deactivation-associated erasure window another opportunity to close before the following jump is issued.

For a fixed deck \(d\), let:

\[
\Delta_d =
t_{\mathrm{formal},d} - t_{\mathrm{erased\ jump}}.
\]

Among erased jumps associated with that deck, the conjecture predicts a negative within-deck relationship:

\[
T_{\mathrm{preceding}}\ \text{larger}
\quad\longrightarrow\quad
\Delta_d\ \text{smaller}.
\]

A negative \(\Delta_d\) means formal deactivation was already observed before the erased jump.

I checked the existing 6.22 and 6.23 data. It cannot test this prediction within decks because \(T\) does not vary for any individual deck.

Using formal deactivations observed either during the preceding logical movement or during the erased attempt:

| Batch | Candidate deck-event rows | Distinct decks | Decks with varying predecessor \(T\) |
|---|---:|---:|---:|
| 6.22 large | 7,135 | 453 | 0 |
| 6.22 small | 364 | 123 | 0 |
| 6.23 large | 8,208 | 600 | 0 |

The distributions are nearly deterministic:

- 6.22 large: all 7,135 rows have \(T=1\).
- 6.22 small: 363 have \(T=1\); one deck has \(T=2\), but that deck never also appears with \(T=1\).
- 6.23: 8,200 have \(T=1\); eight rows involving two decks have \(T=4\), but those decks never appear in this population with another \(T\).

Thus no deck supplies paired observations at different values of \(T\), so neither a within-deck correlation nor even a two-level comparison is available.

This absence is itself consistent with the fixed-geometry picture: for a fixed conversation, viewport and traversal configuration, the same deck tends to be encountered through the same local jump geometry and therefore with the same \(T\).

To test the prediction, we need to vary \(T\) while retaining the deck identity and as much geometry as possible. The cleanest intervention would be to add a controlled number of otherwise unnecessary stabilization rAFs before the following jump:

\[
T_{\mathrm{effective}} = T_{\mathrm{natural}} + q,
\]

with \(q\) varied across runs, probably \(q\in\{0,1,2\}\).

This would not claim to isolate \(T\) as a mechanism. It would test the timing consequence:

- extra rAFs should progressively reduce erasure frequency;
- among any erasures that remain for a fixed deck, formal deactivation should be closer to the erased jump, or already observed before it;
- decks should cease producing erasures once the added delay reliably carries the following jump beyond their erasure window.

That is a sharper test than trying to obtain natural \(T\) variation, because the present fixed-deck runs show essentially none within a deck.

> It's challenging that we conjecture that T is the factor and yet it does not vary for a fixed deck and moreover we have  T = 1 for most deck.  Could it be that the issue is that we define the matching jump in terms of its erasure and erasures happen when T = 1 ?

Yes. That is likely the source of the apparent difficulty.

We selected the observations by starting from an erased jump \(J\), and then examined the stabilization count \(T\) of its predecessor \(P\). But erasure is already strongly concentrated among cases where \(T_P=1\). Therefore the selected population almost automatically contains predominantly \(T_P=1\).

The matching procedure is effectively:

\[
J\text{ is erased}
\;\longrightarrow\;
\text{find nearby formal deactivation(s)}
\;\longrightarrow\;
\text{inspect }T_P.
\]

That procedure is suitable for describing erasures, but not for testing whether \(T_P\) controls their occurrence. It conditions on the outcome whose dependence we want to study. Decks whose corresponding following jump survives—especially because \(T_P>1\)—are excluded. Consequently, a given deck may have:

- erased observations at \(T_P=1\);
- surviving observations at \(T_P>1\);

but the second group never enters an erasure-selected table. We would then incorrectly conclude that the deck has no variation in \(T\).

The proper unit should start from a deck-deactivation episode, independently of whether any jump is erased:

1. Select a deck \(d\) and one of its geometric-to-formal deactivation episodes.
2. Identify the relevant jump \(J_d\) geometrically or temporally associated with that episode, using one fixed matching rule.
3. Identify the preceding logical movement \(P_d\).
4. Record \(T_{P_d}\).
5. Record whether \(J_d\) was erased.
6. Record the timing of \(J_d\) relative to geometric and formal deactivation.

Then, for each fixed deck, compare all runs:

| Deck | Run | \(T_{P_d}\) | \(J_d\) erased? | \(t_{\mathrm{formal}}-t_{J_d}\) |
|---|---|---:|---|---:|

This allows both outcomes into the sample. It can reveal precisely the pattern of interest:

\[
T_P=1 \quad\text{with erasure},
\qquad
T_P>1 \quad\text{with survival}.
\]

There is still an important matching question. Defining \(J_d\) as “the erased jump close to formal deactivation” would preserve the selection problem. \(J_d\) must instead be defined without reference to erasure—for example, by a fixed lag from the deck’s geometric deactivation, or as the first normal logical jump at a specified traversal position relative to that deactivation episode.

So the absence of within-deck \(T\) variation in my previous result does not show that fixed-deck \(T\) does not vary. It shows that I searched only within the erased subset, where the conjectured effect itself selects \(T=1\).

> Can you look whether some decks are both erasing and not erasing with a large ratio. If each deck is either erasing with ratio close to 1 or not erasing with ratio close to 1, we might have to change strategy and even how we state the conjecture.

<details><summary>4 previous messages</summary>

> I’ll start from every formal-deactivation episode, independently of outcome, and associate it with the logical jump during whose rAF it is observed. Then I’ll summarize each deck’s erasure ratio across runs, keeping 6.22 and 6.23 separate because their traversal geometry differs.
>
> <details><summary>Created a file, ran a command</summary>
>
> - Wrote `/tmp/deck_erasure_ratios.py` (+88 -0)
> - Ran `python3 /tmp/deck_erasure_ratios.py`
>
> </details>
>
> The result is already clear: many fixed decks alternate substantially between erasing and non-erasing outcomes; they are not predominantly divided into deterministic “erasing decks” and “non-erasing decks.” I’m quantifying how much mass lies near 0, near 1, and in the middle before stating the implication for the conjecture.
>
> <details><summary>Edited a file, ran a command</summary>
>
> - Wrote `/tmp/deck_erasure_ratios.py` (+4 -0)
> - Ran `python3 /tmp/deck_erasure_ratios.py | rg "===|cycles|deck ratio|mixed decks|mixed with|all decks ratio"`
>
> </details>
</details>

Yes. Many decks are substantially mixed: their associated logical jump is erased in some runs and survives in others.

I defined the association without selecting erased jumps:

1. Start from every observed formal-deactivation episode.
2. Associate the deck with the logical jump during whose rAF the formal deactivation is observed.
3. If that logical jump required an erased attempt followed by a retry, classify its outcome as erased.
4. Compute the ratio independently for each deck across complete runs.

### Large conversation

| Batch | Decks | Always survives | Mixed | Always erased |
|---|---:|---:|---:|---:|
| 6.22 split, 26 runs | 1,037 | 590 | 429 | 18 |
| 6.23 non-split, 21 runs | 1,037 | 426 | 566 | 45 |

The mixed population is substantial:

- In 6.22, 165 decks have an erasure ratio between 20% and 80%.
- In 6.23, 258 decks have a ratio between 20% and 80%.
- Every one of those decks has repeated observations across runs.

Many ratios are near one half. Examples in 6.22 include:

- 13 erasures in 26 runs: 50%;
- 12/26: 46%;
- 14/26: 54%;
- 15/26: 58%.

In 6.23, many decks have:

- 10 erasures in 21 runs: 48%;
- 11/21: 52%.

### Small 6.22 conversation

Of 323 decks:

- 210 always survive;
- 113 are mixed;
- none is always erased;
- 38 have ratios between 20% and 80%.

So the answer is decisively that fixed decks can be both erasing and non-erasing at substantial rates. The data does not partition primarily into decks with ratios near 0 and decks with ratios near 1.

This supports continuing with the probabilistic formulation: fixed conversation geometry strongly conditions the local opportunity for erasure, but the realized timing within that geometry determines whether the associated jump falls inside the deactivation-related erasure window.

It also means the proposed within-deck test remains viable. My previous failure to find within-deck variation arose because I first selected erased jumps. Starting from deck deactivation episodes gives both erased and surviving outcomes. The next analysis should attach the predecessor’s \(T\) to every one of these deck episodes and compare, within each deck:

\[
P(\text{associated jump erased}\mid T_{\mathrm{preceding}}=t).
\]

Then, where an erasure occurs, we can examine whether the time from the jump to formal deactivation decreases as predecessor \(T\) increases.

> What is a logical jump ?

“Logical jump” was terminology I introduced to combine an erased attempt and its retry into one intended traversal movement:

- If the first attempt survives, that attempt represents the movement.
- If it is erased, the successful retry represents the realized movement, while the pair receives the label “first attempt erased.”

That abstraction was useful when correcting the \(T\) tables, because \(T\) should come from the movement that actually advances the traversal.

However, it is potentially confusing here. Formal deactivation occurs during a particular actual jump attempt, not during an abstract logical jump. For the deck-erasure ratios, I classified a formal deactivation observed during either an erased attempt or its retry as belonging to one combined movement and called that movement “erased.” That may not be the matching you intend.

We should instead keep the actual events explicit:

- normal or first jump attempt;
- erased jump attempt;
- retry of that erased attempt;
- extra split jump;
- stabilization rAF belonging to each attempt.

Then state exactly which actual attempt contains the deck’s formal deactivation. The deck-ratio table I just gave combines formal deactivations during erased attempts and during their retries; it should not yet be treated as the final deck-erasure table without confirming that grouping.

> Yes to compute T, we use the retry, but what do we use to define the rAF of the jump ?

We should use two different actual records for two different purposes:

- To compute \(T_n\), use the stabilization rAFs of the retry when the original jump \(n\) was erased, because the retry is what actually establishes the position preceding the next jump.
- To define the rAF of the following jump \(J\), use the original attempt’s own jump rAF—the `rafKind: "jump", rafNumber: 0` observation associated with the attempt whose erasure or survival we are studying.

So the sequence is:

\[
\text{erased attempt }n
\rightarrow
\text{successful retry }n
\rightarrow
\text{retry stabilization, defining }T_n
\rightarrow
\text{jump rAF of }J
\rightarrow
\text{attempt }J.
\]

If \(J\) is erased, we still use the jump rAF of that erased first attempt. Its later retry is irrelevant to the timing of \(J\)’s erasure.

For the proposed deck analysis:

\[
\Delta_{d,J}
=
t_{\mathrm{formal},d}
-
t_{\mathrm{jump\ rAF},J}.
\]

Here:

- \(T_n\) comes from the actual preceding movement that succeeded, possibly a retry.
- \(t_{\mathrm{jump\ rAF},J}\) comes from the first attempt of \(J\), whether it survives or is erased.
- Formal deactivation is matched to that actual first attempt, not to a combined “logical jump.”

Thus we preserve the retry only for measuring stabilization at the preceding position; we do not merge the retry and erased attempt when locating \(J\) relative to deck events.

> Ok, let's compute and see if there is a correlation.  In the case of erasure, we use the retry for T and the first attempt for the time of erasure.  The only tricky point is the matching rule : Associate the deck with the logical jump during whose rAF the formal deactivation is observed.  We should find out what this  rule does for each deck  by checking what are the erasure ratios are for neibooring rAFs. Perhaps, we should consider all neihbooring rAFs with non zero erasure rates and see what happens for each.

<details><summary>4 previous messages</summary>

> I’ll treat the matching offset as an empirical choice rather than assume that the jump owning the formal-deactivation rAF is the relevant one. For each formal deactivation, I’ll examine neighboring first-attempt jump rAFs, report their aggregate and per-deck erasure ratios, then test the proposed within-deck relationship between predecessor \(T\) and formal-deactivation timing at each informative offset.
>
> <details><summary>Created a file, ran a command</summary>
>
> - Wrote `/tmp/neighbor_raf_correlation.py` (+142 -0)
> - Ran `python3 /tmp/neighbor_raf_correlation.py`
>
> </details>
>
> Across erased observations alone, no fixed deck has more than one predecessor-\(T\) value at any neighboring offset, so the proposed timing correlation cannot yet be calculated. I’m checking the broader episode population now: whether \(T\) varies within a deck across erased and surviving neighboring jumps, which would still let us test whether erasure frequency moves with \(T\).
>
> <details><summary>Edited a file, ran 2 commands</summary>
>
> - Wrote `/tmp/neighbor_raf_correlation.py` (+16 -1)
> - Ran `python3 /tmp/neighbor_raf_correlation.py | sed -n '/===/p; / | /p'`
> - Wrote `/tmp/neighbor_raf_correlation.py` (+7 -0)
> - Ran `python3 /tmp/neighbor_raf_correlation.py | rg "===|offset 0 variable"`
>
> </details>
</details>

The analysis clarifies both the matching rule and the limitation of the proposed correlation.

I treated “neighboring rAFs” as neighboring first-attempt jump rAFs, since only those rAFs can be assigned an erasure outcome. Offset 0 is the first attempt whose stabilization—or retry stabilization—contains the formal deactivation. Negative offsets precede it; positive offsets follow it.

### Erasure rates at neighboring jump rAFs

| Offset from formal-deactivation owner | 6.22 large | 6.23 large |
|---:|---:|---:|
| −2 | 1.76% | 2.36% |
| −1 | 6.48% | 9.02% |
| 0 | 24.75% | 36.09% |
| +1 | 4.81% | 8.14% |
| +2 | 4.88% | 5.89% |

Every examined offset from −4 through +4 has a nonzero erasure rate, likely partly because erasures cluster locally. But offset 0 has by far the strongest association. It is therefore the most natural primary matching rule, while the neighboring offsets remain useful comparison populations.

Offset 0 also has the largest number of genuinely mixed decks:

| Batch | Mixed decks at offset 0 | Decks with ratios between 20% and 80% |
|---|---:|---:|
| 6.22 large | 429 | 165 |
| 6.23 large | 566 | 258 |

### Does \(T\) vary within those decks?

Yes, once surviving observations are included.

At offset 0:

| Batch | Decks with within-deck \(T\) variation |
|---|---:|
| 6.22 large | 358 |
| 6.22 small | 90 |
| 6.23 large | 333 |

For those variable-\(T\) decks:

| Batch | \(T=1\): erased / observations | \(T>1\): erased / observations |
|---|---:|---:|
| 6.22 large | 344 / 3,317 = 10.37% | 0 / 6,005 = 0% |
| 6.22 small | 33 / 649 = 5.08% | 1 / 606 = 0.17% |
| 6.23 large | 289 / 2,038 = 14.18% | 0 / 4,955 = 0% |

The comparison is also consistent deck by deck:

- 6.22 large: 39 variable-\(T\) decks have a lower erasure ratio at higher \(T\); none has a higher ratio.
- 6.22 small: 15 lower; none higher.
- 6.23: 55 lower; none higher.
- The remaining variable-\(T\) decks have equal rates, usually zero at every \(T\).

This is stronger evidence than the pooled \(T\) table because it controls for deck identity: the same decks are observed with different \(T\), and their erasures are concentrated at \(T=1\).

### Proposed timing correlation

The specific correlation

\[
T_{\mathrm{preceding}}
\quad\text{versus}\quad
t_{\mathrm{formal}}-t_{\mathrm{erased\ jump}}
\]

still cannot be calculated within individual decks from these batches. Among the erased observations, no deck appears with more than one value of predecessor \(T\), at offset 0 or any neighboring offset from −4 through +4.

That failure is itself related to the observed suppression: when the same deck is encountered with \(T>1\), its neighboring jump almost always survives, so it leaves no erased observation from which to measure the proposed formal-deactivation delay.

The existing data therefore supports the frequency consequence of the conjecture very strongly:

> Within fixed decks, an extra stabilization rAF is associated with disappearance of erasure at the jump most closely aligned with formal deactivation.

But testing the finer prediction about the remaining time to formal deactivation requires producing some erasures at multiple values of \(T\)—probably through controlled timing variation.

> I am not sure. You argue using average over decks. That seems irrelevant. If for a single deck the erasures are at offset -1, then -1 is the relevant rAF for that deck.

<details><summary>2 previous messages</summary>

> You are right. The aggregate peak at offset 0 cannot determine the relevant offset for an individual deck. I conflated a population-level association with the deck-specific matching rule. I’ll reorganize the analysis around each deck’s own offset profile: which neighboring jump rAF offsets ever erase, how concentrated that profile is, and whether predecessor \(T\) varies at those deck-specific offsets.
>
> <details><summary>Edited a file, ran a command</summary>
>
> - Wrote `/tmp/neighbor_raf_correlation.py` (+49 -0)
> - Ran `python3 /tmp/neighbor_raf_correlation.py | rg "===|deck-specific|exactly one|maxim|T sets"`
>
> </details>
</details>

You are right. My previous use of the average erasure rate at each offset was not sufficient to define the matching for individual decks.

The relevant object is a deck-specific profile:

\[
r_d(k)
=
P(\text{jump at offset }k\text{ is erased}\mid d),
\]

where \(k\) is the neighboring first-attempt jump rAF relative to the jump associated with the formal-deactivation observation.

A deck whose erasures occur only at \(k=-1\) should be studied at \(k=-1\), regardless of the population average at \(k=0\).

### Deck-specific profiles

For the 6.22 large batch, among decks with any erasure in offsets \(-4\) through \(+4\):

| Number of offsets with nonzero erasure | Decks |
|---:|---:|
| 1 | 336 |
| 2 | 176 |
| 3 | 85 |
| 4 | 16 |
| 5 | 6 |

For the 336 decks having exactly one nonzero offset:

| Sole erasing offset | Decks |
|---:|---:|
| −4 | 8 |
| −3 | 2 |
| −2 | 2 |
| −1 | 36 |
| 0 | 237 |
| +1 | 2 |
| +2 | 49 |

For 6.23:

| Number of offsets with nonzero erasure | Decks |
|---:|---:|
| 1 | 355 |
| 2 | 273 |
| 3 | 96 |
| 4 | 20 |
| 5 | 12 |

Among the 355 decks with one nonzero offset:

| Sole erasing offset | Decks |
|---:|---:|
| −4 | 8 |
| −3 | 2 |
| −2 | 6 |
| −1 | 10 |
| 0 | 274 |
| +1 | 4 |
| +2 | 45 |
| +3 | 1 |
| +4 | 5 |

Thus offset 0 is common, but it is not a universal matching rule. There are clear populations associated with \(-1\), \(+2\), and less commonly other offsets.

### Consequence for the \(T\) analysis

The analysis should be performed separately for every deck-offset pair with a nonzero erasure rate:

\[
(d,k)
\longmapsto
\bigl(T_{\mathrm{preceding}},\,
E,\,
t_{\mathrm{formal},d}-t_{J_{d,k}}\bigr).
\]

However, in the current erased observations, each deck-offset pair still has only one value of predecessor \(T\):

- 6.22 large: 1,021 deck-offset pairs erase only with \(T=1\), and 16 only with \(T=2\).
- 6.22 small: 320 only with \(T=1\), and 4 only with \(T=2\).
- 6.23: 1,327 only with \(T=1\), and 2 only with \(T=4\).

No deck-offset pair contains erased observations at multiple \(T\) values. Therefore the proposed correlation between \(T\) and formal-deactivation delay still cannot be calculated among erasures.

But we should not now choose each deck’s “best” offset and treat it as established. Selecting an offset because it maximizes erasure in these runs is exploratory and outcome-dependent. A defensible procedure is:

1. Retain every deck-offset pair with a nonzero erasure rate as a candidate relation.
2. Estimate its erasure ratio and timing distribution from the existing batches.
3. Freeze those candidate offsets.
4. Test them on new runs, including both erased and surviving observations.
5. Within each fixed \((d,k)\), compare outcome and formal-deactivation timing across predecessor \(T\).

So your correction changes the analysis materially: the conjecture should initially be indexed by both deck and neighboring-rAF offset, rather than assuming one common offset across the conversation.

> What is "Number of offsets with nonzero erasure"

For each deck, I examined nine neighboring first-attempt jump positions relative to the jump associated with its formal deactivation:

\[
k\in\{-4,-3,-2,-1,0,+1,+2,+3,+4\}.
\]

At each offset \(k\), I asked whether that jump was erased in at least one run.

“Number of offsets with nonzero erasure” means the count of offsets for which at least one erasure was observed for that deck.

For example, suppose one deck has:

| Offset | Erasures across runs |
|---:|---:|
| −2 | 0 |
| −1 | 5 |
| 0 | 11 |
| +1 | 0 |
| +2 | 0 |

That deck has two offsets with nonzero erasure: \(-1\) and \(0\).

But this statistic is not directly useful for identifying the relevant jump. Neighboring jumps can themselves be erased because erasures cluster, without all being associated with that deck’s deactivation. Counting every offset that ever contains an erasure therefore creates many possible matches and may exaggerate ambiguity.

Your original proposal was more precise: inspect each deck’s erasure ratios at neighboring offsets and determine whether one offset has a substantial, repeatable ratio. We should compare the entire vector

\[
\bigl(r_d(-4),\ldots,r_d(0),\ldots,r_d(+4)\bigr),
\]

rather than reduce it to the number of nonzero entries. A single accidental erasure at an offset should not carry the same weight as a repeated ratio near 50% or 100%.

> Is the number of erasures is maximal at offset 0 for all decks ?  I propose to consider individually what happens for all decks and all offsets.  Later, if we aggregate,  I propose to redefine offset 0 as the deck at which the number of erasures is maximal and aggregate separately for each offset.

<details><summary>2 previous messages</summary>

> No—the maximum is not at offset 0 for every deck. Your proposal is better: retain each deck’s full offset profile first; only later align decks by moving each deck’s maximum-erasure offset to a new relative offset 0, while keeping original offsets and ties explicit. I’ll quantify unique maxima versus tied maxima before describing that recentering.
>
> <details><summary>Edited a file, ran a command</summary>
>
> - Wrote `/tmp/neighbor_raf_correlation.py` (+8 -0)
> - Ran `python3 /tmp/neighbor_raf_correlation.py | rg "===|unique maximum|tied for maximum|maximum erasure count"`
>
> </details>
</details>

No. Offset 0 has the maximum number of erasures for many decks, but not all.

### Deck-specific maximum offsets

These counts include only decks having at least one erasure in the examined \(-4\) to \(+4\) interval.

| Original offset of unique maximum | 6.22 large | 6.22 small | 6.23 large |
|---:|---:|---:|---:|
| −4 | 35 | 24 | 40 |
| −3 | 24 | 11 | 20 |
| −2 | 17 | 6 | 17 |
| −1 | 59 | 4 | 67 |
| 0 | 340 | 75 | 413 |
| +1 | 44 | 19 | 64 |
| +2 | 69 | 4 | 69 |
| +3 | 9 | 8 | 9 |
| +4 | 9 | 15 | 8 |

Most decks have a unique maximum:

| Batch | Unique maximum | Tied maximum |
|---|---:|---:|
| 6.22 large | 606 | 13 |
| 6.22 small | 166 | 31 |
| 6.23 large | 707 | 49 |

So original offset 0 is the most frequent maximum, but it represents only:

- 340 of 606 unique maxima in 6.22 large;
- 75 of 166 in 6.22 small;
- 413 of 707 in 6.23.

Your proposed analysis makes sense:

1. Preserve, for every deck, the complete table over original offsets:
   \[
   (n_d(k),e_d(k),r_d(k)).
   \]

2. Identify the original offset \(m_d\) where that deck’s erasure count is maximal.

3. Recenter that deck’s offsets:
   \[
   k_{\mathrm{relative}}=k-m_d.
   \]

   Thus the deck-specific maximum becomes relative offset 0.

4. Aggregate observations separately by relative offset:
   \[
   \ldots,-2,-1,0,+1,+2,\ldots
   \]

This alignment asks whether decks share a common local erasure profile once their individually identified peaks are aligned, without assuming that formal deactivation occurs at the same relative jump for every deck.

Two details should remain explicit:

- Keep `originalOffset` alongside `relativeOffset`; otherwise we lose how the deck-specific peak relates to formal deactivation.
- Decks with tied maxima do not have a unique center. They should initially be reported separately rather than assigned an arbitrary offset 0.

Also, selecting \(m_d\) from these same runs makes the recentered offset-0 aggregate upward-biased by construction. That is acceptable for exploring the shape, but a later confirmatory analysis should estimate \(m_d\) from one set of runs and evaluate the recentered profile on another.

> In the case of ties, use -1/2, + 1/2 , etc. to label  the offsets.  There are enough for that to be worth it.

<details><summary>2 previous messages</summary>

> I’ll use a fractional center for tied maxima: two adjacent maxima become relative offsets \(-\tfrac12\) and \(+\tfrac12\), and three adjacent maxima become \(-1,0,+1\). I’m checking whether any tied maxima are non-adjacent, since those need to remain a distinct ambiguous pattern rather than be silently centered as one plateau.
>
> <details><summary>Edited a file, ran a command</summary>
>
> - Wrote `/tmp/neighbor_raf_correlation.py` (+4 -0)
> - Ran `python3 /tmp/neighbor_raf_correlation.py | rg "===|tied maximum patterns"`
>
> </details>
</details>

Agreed. Fractional offsets preserve the tied peaks instead of discarding those decks.

For adjacent tied maxima:

- Original maxima at \(k=0,1\) get center \(m_d=0.5\).
- Their relative offsets are \(-0.5,+0.5\).
- Maxima at \(k=-1,0\) likewise become \(-0.5,+0.5\).
- Three adjacent maxima at \(k=0,1,2\) use \(m_d=1\), producing \(-1,0,+1\).

However, several ties are non-adjacent—for example \((0,2)\), \((-4,0)\), and \((-4,4)\). These are not a contiguous erasure peak. Centering them would misleadingly imply a single plateau.

I suggest:

- Use fractional centering for contiguous tied maxima.
- Preserve non-adjacent tied maxima as multi-peak deck profiles and aggregate them separately.
- Keep original offsets in every row.

The tied patterns are numerous enough to retain:

- 13 tied decks in 6.22 large;
- 31 in 6.22 small;
- 49 in 6.23.

Most adjacent ties are around formal deactivation, especially \((-1,0)\) and \((0,1)\), but the non-adjacent patterns confirm that not all ties should be collapsed into one center.

> When you have an odd number of maximum, the middle one is 0.  When you have an even numbers, the two middle one are -1/2, 1/2. The others are ordered by geometry.

Understood. All tied maxima should be centered as an ordered set, whether adjacent or not.

For a deck with ordered maximizing offsets

\[
m_1 < m_2 < \cdots < m_q,
\]

assign centered labels by rank:

\[
r_i=i-\frac{q+1}{2}.
\]

Therefore:

- One maximum: \(0\)
- Two maxima: \(-\tfrac12,+\tfrac12\)
- Three maxima: \(-1,0,+1\)
- Four maxima: \(-\tfrac32,-\tfrac12,+\tfrac12,+\tfrac32\)

The labels describe the geometric ordering of the maximizing rAFs, not their numerical distance in the original offset system. Thus non-adjacent maxima such as \((-4,0)\) still receive \(-\tfrac12,+\tfrac12\), while their original offsets remain recorded separately.

For non-maximizing neighboring rAFs, their recentered ordering should likewise preserve geometry around the ranked maximum set. We should retain both:

- `originalOffset`: actual distance from the formal-deactivation-associated rAF;
- `alignedOffset`: its position relative to the deck’s ordered maximum or maxima.

This incorporates all tied decks without arbitrarily choosing one maximum or excluding multi-peak profiles.

> Yes, I meant contiguous maximum. The only problematic cases wouid be  things like  x x M M x x M M x x. We can consider those cases separately, if any.

Understood. We should identify contiguous runs of maximum-erasure offsets.

- One maximum: center at \(0\).
- Two contiguous maxima: \(-\tfrac12,+\tfrac12\).
- Three contiguous maxima: \(-1,0,+1\).
- Longer contiguous plateaus follow the same centering.
- Separated maximum runs, such as `x x M M x x M M x x`, are multi-peak cases and should be analyzed separately.

The current data does contain separated maxima:

- 6.22 large: 5 decks;
- 6.22 small: 16 decks;
- 6.23: 12 decks.

The remaining tied cases form a single contiguous plateau and can be aligned using fractional offsets. Multi-peak decks should retain each peak’s original offset and profile until we understand whether they represent two candidate deactivation relationships or incidental equal counts.

> Do we have muti peak decks ?

Yes.

Using offsets \(-4\) through \(+4\), and defining a multi-peak deck as one whose maximum erasure count occurs in two or more separated runs:

| Batch | Multi-peak decks |
|---|---:|
| 6.22 large | 5 |
| 6.22 small | 16 |
| 6.23 large | 12 |
| **Total** | **33** |

Examples of separated maximum-offset patterns include:

- \((-4,0)\)
- \((-3,0)\)
- \((0,2)\)
- \((-4,4)\)
- \((-2,0)\)
- \((0,2,3)\), where \(2,3\) form one peak and \(0\) another.

They are uncommon compared with the decks having a unique maximum or one contiguous maximum plateau, but numerous enough to analyze separately rather than discard.

> Interesting.  For one deck, there is a maximum at - 4 and another at 0.

<details><summary>2 previous messages</summary>

> Yes—and because \(-4\) is the edge of the inspected range, that pattern may represent two distinct peaks or a peak extending beyond our current window. I’ll identify those decks and show their complete \(-4\) to \(+4\) erasure-count profiles.
>
> <details><summary>Created a file, ran a command</summary>
>
> - Wrote `/tmp/show_multippeak_profiles.py` (+10 -0)
> - Ran `python3 /tmp/show_multippeak_profiles.py | rg "===|PROFILE_MINUS4_ZERO"`
>
> </details>
</details>

Yes, and the 6.23 cases are especially striking.

Two decks have equal maxima at offsets \(-4\) and \(0\):

| Deck | −4 | −3 | −2 | −1 | 0 | +1 | +2 | +3 | +4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `81ac8dad…` | 19 | 0 | 0 | 0 | 19 | 0 | 0 | 0 | 0 |
| `5a4b32f9…` | 20 | 0 | 0 | 0 | 20 | 17 | 0 | 0 | 0 |

This is not a tie caused by one observation. It repeats across nearly every one of the 21 runs. The first deck has two sharply separated peaks; the second has one peak at \(-4\) and another spanning \(0,+1\).

The 6.22 small batch also has four \((-4,0)\) profiles, but each peak contains only one erasure across 14 runs, so those could be incidental.

The 6.23 pattern suggests a structural relationship. One plausible explanation is that the same deck’s formal deactivation is being associated with two distinct recurring erasure sites four jumps apart. Another is that the deck sequence has a repeating geometry in which a nearby deck’s deactivation consistently supplies the other peak.

Because \(-4\) is the boundary of the inspected range, we should extend the deck-specific profiles farther backward—probably at least to \(-8\)—before calling \(-4\) a complete peak. It might be part of a broader or repeated structure outside the current window.

> Is there decks with three maximum ?

Yes. Three decks have three tied maximum offsets:

| Batch | Deck | Maximum offsets |
|---|---|---|
| 6.22 large | one deck | \(0, +1, +2\) |
| 6.22 small | one deck | \(-4,-3,+2\) |
| 6.22 small | one deck | \(-4,+2,+3\) |
| 6.23 large | two decks | \(0,+2,+3\) |

Correction: that is five decks total, not three:

- one in 6.22 large;
- two in 6.22 small;
- two in 6.23.

Only the \(0,+1,+2\) pattern is a single contiguous three-offset plateau. The others contain two separated peaks.

> But,  there is a  maximum of two plateaux.

Correct. I conflated “three maximizing offsets” with “three maxima.”

For example:

- \((-4,-3,+2)\) has two maximum plateaux:
  - plateau 1: \((-4,-3)\)
  - plateau 2: \((+2)\)

- \((-4,+2,+3)\) also has two:
  - plateau 1: \((-4)\)
  - plateau 2: \((+2,+3)\)

- \((0,+2,+3)\) has two:
  - plateau 1: \((0)\)
  - plateau 2: \((+2,+3)\)

- \((0,+1,+2)\) has one maximum plateau spanning three offsets.

So the correct unit is a contiguous maximum plateau, not an individual maximizing offset. In the observed profiles, a deck has either:

- one maximum plateau, possibly spanning several offsets; or
- two separated maximum plateaux.

We have not identified a deck with three separated maximum plateaux.

> My guess is that it will never happen. There are two plateaux when two jumps are possible candidates and that happens when one is at the start of the window and the other at the end. If that hypothesis is correct, the jump at the end of the plateau is likeky not to be erased when T increase, but it will not be seen in the final count, because the one at the bottom is erased.  This analysis assumes some regularity + randomness in the sequence of jumps, but I think such regularity exists.

Yes. That is a coherent interpretation of the two-plateau profiles.

For a given deck, the two plateaux would correspond to two different candidate jumps:

- the earlier candidate lies near the beginning of the deck’s erasure window;
- the later candidate lies near its end.

Across runs, small variations in realized geometry and timing can place either candidate inside the window. This yields two separated erasure peaks rather than a single broad plateau.

The important censoring effect is:

1. The earlier candidate jump is erased.
2. Its retry and stabilization delay the subsequent traversal.
3. By the time the later candidate is reached, the window may have closed.
4. The later candidate therefore survives.
5. We observe the later candidate’s erasure only in runs where the earlier candidate was not erased.

Thus the two candidate outcomes are not independent. The first erasure changes the timing and therefore suppresses observation of a later erasure. Aggregating each offset’s marginal erasure count can hide the dependence on \(T\) at the later plateau.

This predicts several observable patterns:

- No more than two separated maximum plateaux for one deck.
- For two-plateau decks, erasures at the early and late plateaux should be negatively associated across runs.
- Runs with an early-plateau erasure should show a successful retry before the late candidate.
- Conditional on the early candidate surviving, the late candidate should have a higher erasure rate than its unconditional rate.
- Among runs where the early candidate survives, larger predecessor \(T\) at the late candidate should reduce its erasure rate.
- Variation in the distance between the two candidate jumps should track variation in realized geometry.

The key analysis should therefore retain the joint per-run outcome for both plateaux:

| Run | Early candidate | Early predecessor \(T\) | Late candidate | Late predecessor \(T\) |
|---|---|---:|---|---:|
| \(r\) | erased/survived | \(T_E\) | erased/survived | \(T_L\) |

Then compare:

\[
P(E_L\mid E_E)
\quad\text{and}\quad
P(E_L\mid \neg E_E),
\]

and, within \(\neg E_E\),

\[
P(E_L\mid T_L=1)
\quad\text{versus}\quad
P(E_L\mid T_L>1).
\]

Your regularity assumption is plausible in fixed-deck runs: the conversation geometry fixes recurring candidate locations, while realized heights and rAF timing shift the exact window relative to the jump sequence. This is a testable conjecture rather than merely a descriptive alignment.

