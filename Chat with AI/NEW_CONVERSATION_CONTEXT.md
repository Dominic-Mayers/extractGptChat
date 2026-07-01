# Context For New Conversation

We are working in `/home/dominic/app_devel/extractGptChat`.

The current main userscript file in this checkout is:

- `dev-extractChatGpt.js`

Important docs:

- `ARCHITECTURE.md`
- `README.md`

## Project Goal

This project is a ChatGPT conversation extractor. It walks a ChatGPT
conversation, extracts slabs of content, and exports Markdown plus auxiliary
files for images, Canvas/textdoc blocks, and diagnostic HTML.

The user cares strongly that the implementation match the conceptual design,
not merely that it happens to work. Avoid defending code just because it works.
If the code contradicts the design, say so.

## Current Conceptual Model

The architecture uses these terms:

- **Slab**: an extractable content unit, such as a user/assistant message,
  generated image, or Canvas/textdoc block.
- **Deck**: a traversal region exposed by ChatGPT's rendering system.
- **Work zone**: the currently usable rendered area; ChatGPT must be moved
  through the transcript incrementally so its own rendering workers keep up.
- **Structural expectation / selector**: predicts what kind of object will
  eventually exist and what structure to expect.
- **Readiness observation / fingerprint**: passive evidence that a selected
  object is ready now.
- **Intervention**: an action such as scripted scrolling that changes what the
  environment can expose.

Selectors and fingerprints are related but distinct:

- A selector says what object/structure is expected.
- A fingerprint says the object is ready now.
- Fingerprints are fallible evidence, not proof.

Geometry is conceptually separable from selectors/readiness. In the current
direction, the foreman/traversal logic is responsible for selection/readiness
strategy, while geometry checks are mostly diagnostics/model verification.

## Current Traversal Philosophy

The desired algorithm is slab-based, not deck-centered:

1. Maintain the current slab.
2. Ensure enough room ahead in the work zone.
3. If moving to the next slab crosses into a new deck, enter/wait for the deck.
4. Find the next slab among valid slab candidates.
5. Apply the type-specific readiness fingerprint.
6. Extract once.
7. Repeat.

Decks are administrative boundaries. Moving from the last slab of one deck to
the first slab of the next deck should feel like the same slab-to-slab pipeline,
with extra work only when needed.

## Work-Zone Movement

Large scripted jumps are unsafe. ChatGPT's virtualized renderer can get lost if
the viewport lands in non-rendered territory. Small jumps are used to keep
ChatGPT's own workers in a reliable activation regime.

Current important behavior in `dev-extractChatGpt.js`:

- `requestAnimationFrame` is used via `nextAnimationFrame()` after stability
  waits before measuring room again.
- Work-zone jumps adapt upward on clean jumps.
- Detached current is decisive evidence that a jump was too aggressive.
- Non-detached failures may be resumable from the current cursor.

## Resume / Retry Behavior

Recent modification:

- If a work-zone failure leaves `current` still connected, the script saves a
  resume state and offers `Resume from current`.
- In that resumable case, the adaptive jump size is **not** reduced.
- If `current` detached, the failure is treated as too-large-jump evidence and
  the adaptive jump size retreats by `120px` (`2 × 60px`) before stopping.
- The panel now shows a larger explanatory note just above the buttons:
  - `Resume from current`: explains resume does not reduce jump size.
  - `Retry`: explains a fresh retry and detached-current jump reduction.

## Panel Logging

Recent modification:

- The visible panel log was removed.
- `ui.log(...)` now writes only to the browser console.
- The panel keeps progress/status counters, elapsed time, note text, buttons,
  and export controls.

## Execution-Time Model

`ARCHITECTURE.md` has an `Execution-Time Model` section. It stores the observed
run statistics used to reason about jump sizes and total time.

Model:

```text
T ≈ J × (F + R × S)
```

or:

```text
T ≈ J × F + D × R
```

where:

- `J` = number of jumps;
- `S` = average jump size;
- `D` = total scripted distance;
- `F` = fixed per-jump overhead;
- `R` = rendering/stabilization cost per pixel exposed.

Observed table currently includes 120/240/360/480/600/720px runs, including two
successful 720px runs:

- `1782781471095`: isolated successful 720px run, `maxJump=720px`,
  `jumps=567`, `avgJump=593px`, `avgJumpTime=140ms`, `avg/120px=28ms`,
  `Exported 174/174 user prompts`.
- `1782781952284`: successful 720px run with several Resume-from-current
  stops, `jumps=702`, `avgJump=480px`, `avgJumpTime=146ms`,
  `avg/120px=37ms`, `Exported 174/174 user prompts`.

The known `70e7d42f-42df-4fa6-8c41-fb72b4aee15f` item is the usual genuine
empty/broken slab and should not be counted as a 720px jump failure.

## Latest Relevant Files In Downloads

Recent successful run:

- `/home/dominic/Downloads/Installer-Refactoring-Strategy-1782781471095.md`
- `/home/dominic/Downloads/Installer-Refactoring-Strategy-1782781471095.html`

Another 720px run with several Resume-from-current stops:

- `/home/dominic/Downloads/Installer-Refactoring-Strategy-1782781952284.md`

## Style / Collaboration Notes

The user prefers:

- precise conceptual alignment over opportunistic fixes;
- explicit distinctions between selector, fingerprint, geometry, and
  intervention;
- small focused code changes;
- clear acknowledgement when a previous interpretation was wrong;
- not overloading the walkway analogy—use it briefly, but keep architecture
  separate from analogy.

When auditing or modifying code, explain where the code crosses boundaries:

- core traversal logic;
- DOM adapter/environment requests;
- diagnostics;
- export/serialization.

Avoid adding retry loops as a reflex. If a retry exists, justify whether it is
part of a fingerprint/readiness wait, an intervention, or a user-visible manual
retry/resume.
