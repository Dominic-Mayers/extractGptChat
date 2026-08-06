User: I haven't followed the discussion between you and Claude. I felt it will be better to wait until after there is some agreement.  I see that you are now discussing possible interventions. Again, it's a good idea. However, I want first a clear conjecture or clear competing conjectures.  I would find a bit problematic that a conjecture is formulated in terms of the interventions. The interventions can use quantities defined in the theories or conjectures, but ideally the effect of an intervention can be inferred from a conjecture that is independent of it.

ChatGpt: I agree. We moved too quickly from an observed association to experimental design without first fixing what the experiment is supposed to discriminate.

The intervention must not define the conjecture. We should first state each conjecture in terms of events that exist whether or not we manipulate the extractor. Only afterward should we derive intervention predictions.

Here is the clearest formulation of the original conjecture.

### Erasing-transaction conjecture

For some deck \(D\), deactivation initiates a transaction \(T_D\) with two relevant events:

- \(S_D\): the transaction saves a scrolling geometry \(G_D\);
- \(C_D\): the transaction commits by restoring or enforcing \(G_D\).

The transaction is open during:

\[
S_D < t < C_D.
\]

A jump \(J\), issued at \(t_J\), is erased when it occurs inside this interval:

\[
S_D < t_J < C_D.
\]

The jump initially changes the scrolling geometry, but the later commit replaces that result with \(G_D\). Consequently, the net anchor progress is zero.

This conjecture explains:

- why a real scroll command can return to its before-jump `scrollY`;
- why the retry succeeds: it occurs after \(C_D\);
- why last-known-height updates are relevant: they may be produced by, or reveal some stage of, the geometry-saving transaction;
- why formal deactivation need not be the transaction endpoint;
- why ordering is more fundamental than an exact millisecond delay.

The last-known-height update is not itself used to define the conjecture. It is an observable event that may help locate \(S_D\), \(C_D\), or an intermediate stage.

The one-frame stabilization finding is likewise not part of the definition. It is evidence that the extractor often issues \(J\) before \(C_D\).

A genuinely competing conjecture could be:

### Jump-triggered correction conjecture

There is no transaction that has already saved a geometry and remains open across the studied jump. Instead:

1. Deck deactivation leaves the document in a condition requiring a layout or scroll correction.
2. The studied jump is issued while that condition exists.
3. Processing the jump and the pending deck state together causes the browser to calculate a compensating scroll adjustment.
4. That adjustment cancels the jump.

Here, the erased result is calculated after or in response to the jump. There need not be a previously saved geometry or a later commit that restores it.

The distinction is:

```text
Erasing transaction:

save G ───── jump ───── restore G
          open interval


Jump-triggered correction:

pending deck condition ───── jump
                              │
                              └── calculate compensating correction
```

Both conjectures explain why erasure is associated with unresolved deck deactivation. But they disagree about the explanatory core:

- The erasing-transaction conjecture says the final geometry was determined before the jump and later restored.
- The jump-triggered correction conjecture says the final adjustment is calculated because of the jump interacting with the pending state.

A third, more specific competitor is possible:

### Scroll-anchoring compensation conjecture

Actual-height or activation-state changes cause the browser’s scroll-anchoring mechanism to compensate `scrollY` so that its chosen anchor remains visually stationary. A studied jump is erased when its requested displacement is offset by that compensation.

This differs from a general saved-geometry transaction because it predicts that the cancellation should be quantitatively explained by layout displacement and anchor selection. The browser need not have saved the extractor’s before-jump geometry as a value to restore.

These conjectures suggest different non-interventional evidence.

The erasing-transaction conjecture predicts:

- evidence of a geometry \(G_D\) selected before the studied jump;
- the final geometry after erasure equals that previously selected geometry;
- several operations occurring while the same transaction is open could potentially be overwritten by the same commit;
- the transaction’s result should not need to be calculated from the studied jump’s magnitude.

The jump-triggered correction conjecture predicts:

- no necessary pre-jump saved target geometry;
- the correction is determined during or after the studied jump;
- changing the jump magnitude may change the correction;
- the final geometry need not match any independently identifiable pre-jump saved value.

The scroll-anchoring conjecture predicts:

- a specific anchor element or anchoring region;
- a layout displacement whose magnitude explains the compensating `scrollY` change;
- sensitivity to disabling or changing scroll anchoring;
- cancellation governed by layout displacement, not merely by a previously saved target geometry.

Only after fixing these conjectures should we derive interventions. For example, inserting frames follows from the transaction conjecture because delaying \(t_J\) may move it beyond \(C_D\). But a reduction in erasure would not uniquely support that conjecture: both competing correction mechanisms may also disappear once the pending deck condition resolves.

Therefore the frame-shift experiment tests a shared ordering prediction, not the distinctive explanatory claim. It can establish that erasure requires temporal overlap with an unresolved process, but it cannot decide whether that process restores saved geometry, computes a correction in response to the jump, or invokes scroll anchoring.

The most important discriminating question is instead:

> Is the geometry obtained after erasure identifiable as a target selected before the studied jump, independently of the jump itself?

That question directly separates restoration from post-jump correction. We should settle the precise conjectures and their passive predictions around that distinction before finalizing any intervention.
