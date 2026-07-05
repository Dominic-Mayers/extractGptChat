# Context for Refactoring the ChatGPT Extractor

## Objective

The objective is **not** to redesign the extractor. The objective is to recover the architecture already present in the implementation by extracting well-defined conceptual functions from the existing code.

The methodology is archaeological rather than architectural:

1. Identify a conceptual function in the algorithm.
2. Locate its counterpart in the existing implementation.
3. Extract only that function with minimal modification.
4. Repeat.

Do not invent new abstractions unless the existing code requires them.

---

# Lexicon

Use the project's TECHNICAL_LEXICON.md consistently.

In particular:

* **Slab**: one extractable content unit.
* **Deck**: one rendered ChatGPT turn containing one or more slabs.
* **Ready deck**: a deck whose DOM has become available.
* **Current slab**: traversal cursor.
* **Ready slab**: slab whose content is ready to extract.
* **Room**: viewport space ahead of the current slab.
* **Work zone**: the rendered region in which extraction can safely proceed.
* **Safe area**: the region inside which the work zone may be translated by jumps.
* **Jump**: one small viewport movement.
* **Viewport move**: a sequence of jumps whose purpose is to activate rendering.
* **Detached current**: current slab removed from the live DOM.
* **Sandwiched empty deck**: transient rendering anomaly indicating rendering is still incomplete.

Always distinguish **geometry** from **structure**.

Geometry concerns:

* room
* jumps
* viewport
* work zone
* safe area

Structure concerns:

* decks
* slabs
* readiness
* fingerprints
* extraction

---

# Basic conceptual functions

The architecture is expressed in terms of the following basic functions.

```text
nextDeck(room)

waitDeckReady(deck)

closestSlab(room, deck)

slabType(slab)

clampJump(room, calibratedJump)

performJump(jump)

waitLayoutStable()

measureRoom(current)

waitSlabReady(type, slab)

extractSlab(type, slab)

exportMarkdown()
```

These functions define the conceptual architecture. The refactoring consists of locating their counterparts in the current code.

---

# Viewport movement

Viewport movement is a higher-level operation.

It is entered only when

```text
room < 240
```

Its purpose is **not** to advance traversal.

Its purpose is to activate rendering while keeping the current slab inside the safe area.

Conceptually:

```text
repeat

    jump = clampJump(room, calibratedJump)

    performJump(jump)

    waitLayoutStable()

    room = measureRoom(current)

until room >= r × viewportHeight
```

where

```text
r ≈ 0.9
```

A jump immediately produces

```text
room := room + jump
```

In general, the specific  rendering by chatGPT  doesn't change room, because it is not expected by the user, but there is no guarantee. 

Therefore `measureRoom(current)` recomputes the true geometric state after stabilization.

---

# Layout stabilization

`waitLayoutStable()` waits for layout stabilization while enforcing two invariants.

Invariant 1:

* no unresolved sandwiched empty deck

This condition is potentially recoverable.

Continue waiting (subject to timeout).

Invariant 2:

* current slab is not detached and is still visible in the work zone.

This condition is fatal.

These two situations must not be treated as the same kind of failure.

---

# Main orchestration

The main orchestration is

```text
moveWorkZone()

if needsNextDeck()

    deck = nextDeck(room)

    waitDeckReady(deck)

slab = closestSlab(room, deck)

type = slabType(slab)

waitSlabReady(type, slab)

extractSlab(type, slab)
```

Extraction proceeds one slab at a time.

Viewport movement proceeds one jump at a time.

These are two different scales of the algorithm.

A viewport move generally performs many jumps before returning to slab traversal.

---

# End of traversal

The traversal ends when

```text
needsNextDeck()
```

is true but no next deck exists.

Reaching the viewport extremity (`scrollY == 0` for upward traversal) is not the termination condition. It is an expected geometric consequence of a successful run.

Finally,

```text
exportMarkdown()
```

writes the extracted conversation.
