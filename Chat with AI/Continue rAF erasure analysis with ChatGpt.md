# Continue rAF erasure analysis

> Let's continue the analysis of erasure taking into account "Chat with AI/audit-of-raf-observation-point-analysis.md" of Claude, which    audits "Chat with AI/Analyze jump erasure using rAF observation points.md".

<details><summary>4 previous messages</summary>

> I’ll read both the original rAF analysis and Claude’s audit, then reconcile them into a continued erasure analysis grounded in the repository’s actual model and terminology.
>
> <details><summary>Explored 2 files</summary>
>
> - Read `./Chat with AI/audit-of-raf-observation-point-analysis.md`
> - Read `./Chat with AI/Analyze jump erasure using rAF observation points.md`
>
> </details>
>
> The audit changes the center of gravity: the earlier “transaction lifetime” story is not established, while the one-frame stabilization condition is a strong, controllable discriminator. I’m checking the remainder of the prior analysis and the current diagnostic code so the continuation separates valid observations, invalidated timing claims, and the next decisive experiment.
>
> <details><summary>Explored 4 files, 2 searches, a list, ran 2 commands</summary>
>
> - Ran `wc -l 'Chat with AI/Analyze jump erasure using rAF observation points.md' 'Chat with AI/audit-of-raf-observation-point-analysis.md'; sed -n '281,760p' 'Chat with AI/Analyze jump erasure using rAF observation points.md'; git status --short; rg -n "stableFrames|rafDeckStudy|callback|performance\.now|geometricDeactivation" src/app/{rafDeckStudy-diag.js,waitLayoutStable-diag.js,scrollContainer-diag.js,supplyWorker-diag.js} | head -240`
>
> <details><summary>Explored 4 files, a search</summary>
>
> - Searched for `^#{1,3} |^> (The 30|I|Can|What|Does|So|Let|Could|Please|Before|Run|Now)` in `Analyze jump erasure using rAF observation points.md`
> - Read `./Chat with AI/Analyze jump erasure using rAF observation points.md`
> - Read `./src/app/rafDeckStudy-diag.js`
> - Read `./src/app/waitLayoutStable-diag.js`
> - Read `./src/app/scrollContainer-diag.js`
>
> </details>
>
> - Ran `sed -n '220,280p' 'Chat with AI/audit-of-raf-observation-point-analysis.md'; jq -r '.version' fixed-deck-runs/20260805-180312/cycle-1.json; sed -n '1060,1090p' src/app/supplyWorker-diag.js; sed -n '1120,1160p' src/app/supplyWorker-diag.js; sed -n '330,410p' src/app/supplyWorker-diag.js`
>
> <details><summary>Explored a search, a list</summary>
>
> - Searched for `cycle*.json` in `fixed-deck-runs`
> - Listed files in `fixed-deck-runs`
>
> </details>
>
> </details>
</details>

Claude’s audit materially changes the interpretation of the rAF study. The data still reveal a strong erasure pattern, but they do not establish the previously proposed long-lived “geometry-saving transaction.”

The defensible conclusions are:

- All 773 erasures followed a preceding jump whose stabilization wait completed after exactly one frame.
- No erasure followed a stabilization wait of two or more frames: 0/9,192.
- 694/773 erased jumps had a last-known-height update become visible in the studied jump’s jump-rAF.
- Every observed last-known-height update saved either the preceding or current actual-height state at that observation boundary.
- Erasure means zero net anchor progress. Restoration of a previously saved geometry was inferred, not directly observed.

The earlier delay results should be withdrawn. The rAF observation clock is a vsync timestamp, whereas jump clocks use `performance.now()`. Consequently, values such as the 21.2 ms erased median, the 433.6 ms retained median, and the proposed 1.25 s bound do not measure a consistent update-to-jump interval. Much of the apparent proximity is callback dispatch and sampling latency.

The stronger revised explanation is therefore:

> Erasures occur when the extractor resumes after a single apparently stable frame while deck-deactivation-related layout work remains pending. The next jump is issued before that work becomes visible; when it lands, the jump has zero net anchor progress.

This explanation fits both important observations:

1. The last-known-height update often first becomes visible in the jump-rAF.
2. Erasure occurs only after a one-frame stabilization wait.

The last-known-height update may be evidence that pending work has landed, but the data do not show that the update itself initiates or commits an erasing transaction.

A careful causal diagram is:

```text
pending deck-deactivation work
          │
          ├── one-frame wait returns early ── jump issued ── erasure possible
          │
          └── work becomes observable
                    ├── last-known-height update
                    ├── actual-height transition, sometimes
                    └── formal deactivation, sometimes
```

This also explains why the earlier rAF classification looked so sharp: “update first visible in the studied jump’s rAF” and “extractor resumed after only one stabilization frame” are nearly two descriptions of the same scheduling situation.

The next decisive experiment should be fixed before collecting data:

- Change the `trackAnchor && !activationNear` stabilization requirement from one stable frame to two.
- Keep the fixed deck/input sequence and jump algorithm unchanged.
- Compare erasure counts with the existing v5.83 baseline.
- Record callback-entry `performance.now()`, the rAF vsync timestamp, and the preceding jump’s stabilization-frame count explicitly.
- Do not use last-known-height delay thresholds or revise the hypothesis after seeing the run.

Prediction:

- If early resumption is the mechanism, forcing two stable frames should eliminate or drastically reduce erasures.
- If erasures remain under the same deck/jump patterns, one-frame stabilization is only a correlate, and the longer-lived browser-transaction explanation remains necessary.

Several instrumentation repairs should accompany any further timing study:

- Use `performance.now()` at rAF callback entry for all cross-event ordering.
- Retain the vsync timestamp separately and label it accordingly.
- Fix episode lookup to select the applicable episode, not the deck’s first episode.
- Record repeated geometric-deactivation predictions instead of silently dropping them.
- Rename “geometric deactivation” to “predicted geometric deactivation,” or add post-command verification.
- Treat formal deactivation as an observation point, not as the endpoint of an inferred transaction.

So the current best conclusion is narrower but stronger:

> A one-frame stabilization return is presently a necessary observed condition for erasure. The last-known-height observations characterize when pending deck work becomes visible, but they do not yet identify the cause, start, commit, or lifetime of an erasing transaction.

> "Erasures occur when the extractor resumes after a single apparently stable frame while deck-deactivation-related layout work remains pending. The next jump is issued before that work becomes visible; when it lands, the jump has zero net anchor progress." Could not this be a different wording of the same mechanism. Yes, actual times are less important than ordering, but this is also understood in the previous conjecture.

Yes. It could be—and probably should initially be treated as—a different description of the same mechanism, not as a competing mechanism.

The previous conjecture describes the browser-side process:

1. Deck-related work saves geometry.
2. The extractor issues another jump while that work remains unresolved.
3. The pending work completes afterward.
4. Its completion restores or otherwise neutralizes the jump.

The audit’s formulation describes the extractor-side opportunity for exactly that sequence:

1. The stabilization wait returns after one apparently stable frame.
2. The extractor issues the next jump.
3. Pending deck-related work becomes visible afterward.
4. The jump has zero net progress.

These accounts are compatible:

```text
Browser-side account              Extractor-side account

transaction still pending    ↔    stabilization returned too early
jump occurs before commit    ↔    next jump is issued immediately
commit neutralizes jump      ↔    zero net anchor progress is observed
```

The one-frame finding therefore does not refute the transaction conjecture. It supplies a much stronger ordering condition for it:

> An erasure is observed only when the preceding stabilization wait permits the next jump to occur before the relevant deck-deactivation work becomes observable.

What the audit correctly removes is not the ordering mechanism, but some claims about its internal details:

- We have not directly observed a “save.”
- We have not directly observed a “commit.”
- We have not demonstrated that the restored geometry is the value captured by the selected last-known-height update.
- The numerical delay axis cannot establish the transaction’s duration.
- Formal deactivation cannot reliably identify its endpoint.

Thus “pending layout work” is an observational description; “erasing transaction” is a mechanistic interpretation of that pending work. Both can describe the same process, but only the former is directly supported by the present instrument.

The revised conjecture can preserve the original idea without claiming unobserved details:

> A deck-deactivation process remains pending after the preceding jump’s first stabilization frame. If the extractor resumes and issues the next jump before that process becomes observable, completion of the process can neutralize the jump, producing zero net anchor progress.

Then the two-frame experiment tests an intervention on the opportunity window. If two frames eliminate erasure, that strongly supports this ordering. It would not, by itself, distinguish whether the later event is a transaction commit, scroll anchoring adjustment, layout correction, or another deck-related browser operation. Distinguishing those internal mechanisms would require an additional observation or intervention.

> Actually, “pending layout work” is not an explanation, whereas “erasing transaction” is.

Correct. “Pending layout work” merely redescribes the temporal observation. It does not explain why the later event cancels the jump, why the cancellation is exact, or why a last-known-height update is involved.

The explanatory conjecture remains:

> A deck-deactivation process starts an erasing transaction that saves geometry. The extractor’s stabilization wait can return after one frame while that transaction remains open. The next jump then occurs inside the transaction. When the transaction commits, it restores the saved geometry and thereby erases the jump.

The one-frame result adds an important condition to this conjecture:

\[
\text{transaction begins}
<
\text{first stable frame}
<
\text{studied jump}
<
\text{transaction commit}
\]

It does not replace the conjecture. It identifies how the extractor allows the studied jump to fall inside the proposed transaction.

The audit establishes that the numerical clocks cannot measure the transaction’s duration, but ordering can still be inferred structurally:

- The preceding stabilization wait ended after one frame.
- The studied jump was then issued.
- Further observable change required additional stabilization frames.
- The studied jump had zero net anchor progress.

What remains conjectural is the causal interpretation:

- that geometry was saved;
- that the later operation was a commit;
- that the commit restored the saved geometry;
- and which deck’s transaction performed that restoration.

Accordingly, the two-frame intervention is a test of the conjecture’s necessary timing window, not a competing explanation. If forcing a second stable frame removes erasures, it supports the claim that the jump must occur while the transaction is open. But it still does not independently demonstrate what the transaction saves or how its commit restores geometry.

A better distinction is therefore:

- **Observation:** erasures occur only when the extractor proceeds after one stabilization frame.
- **Mechanistic explanation:** proceeding after one frame permits the next jump to occur inside an open erasing transaction.
- **Intervention:** require a second stable frame and test whether closing that opportunity eliminates erasure.

