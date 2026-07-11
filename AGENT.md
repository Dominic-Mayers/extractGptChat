# Context for conversation

This is not updated to match newly written code in src/dev. The newly written code is source of truth. This is only a source of truth to plan new code. The code in src/app is used to learn about chatGpt structure and behavior and borrow some related code.

## Objective

We are refactoring a ChatGPT conversation extractor. The objective is to redesign it while making use of knowledge learned in the existing code.

## Current understanding

Geometry:

* room
* jumps
* viewport
* work zone

Structure:

* decks
* slabs
* readiness
* extraction

The boundary between the two is **deck readiness**.

Once a deck is ready, slab geometry is assumed stable.

---

## Main orchestration

The traversal currently being designed, which is the source of truth (unless superceded by newly written code), is

```text
repeat

    if (current && room < MIN_ROOM )

        room = await moveWorkZone(current);


    if (needsNextDeck(room, deckTop)) {

        deck = await nextReadyDeck(deckTop);
        if (deck == null) {break;}
        deckTop = deck.getBoundingClientRect().top;
    }

    slab = nextSlab(current, deck)

    type = slabType(slab)

    waitSlabReady(type, slab)

    extractSlab(type, slab)

    current = slab

until no next ready deck

exportMarkdown()
```

For the moment we removed

```text
waitSlabReady()
extractSlab()
```

to simplify development.

---

## moveWorkZone(current, calibratedJump)

This function will eventually be implemented entirely from scratch.

Its structure is

```text
room = measureRoom(current)

while (room < viewportHeight - SLAB_ADJACENCY_MAX_GAP - MAX_DRIFT && 
       scrollY > MAX_DRIFT)

    jump = normalizeJump(CALIBRATED_JUMP)

    performJump(jump)

    waitLayoutStable()

    room = measureRoom(current)
```

where

```text
normalizeJump()
```

is a wrapper over

```text
clampJump() 

    jump = min(
        CALIBRATED_JUMP, // normal case
        scrollY,  // the jump reaches the extremity of the document
        MAX_ROOM_RATIO * viewportHeight - room // current is kept visible in the viewport
    )

```

in case the clamped value is too small for technical reasons.
---

## nextSlab()

We decided that this function is almost independent from the rest.

Its structure is

```text
nextSlab(current, deck)

    area = areaAhead(current, maxGap)

    slabs = getSlabsIn(deck)

    candidates = intersectingSlabs(area, slabs)

    return closestSlab(current, candidates)
```

The search area extends only

```text
SLAB_ADJACENCY_MAX_GAP
```

beyond the current slab.

It is **not** based on room.

---

## getSlabsIn(deck)

This function is structural.

It corresponds almost directly to

```text
querySelectedSlabCandidates()
```

from the existing implementation.

It performs selector-based structural observations.

It returns

* message slabs
* image slabs
* canvas slabs

and, importantly,

a **genuinely empty ready deck contributes one empty slab**.

We concluded that this is **not** a traversal policy.

It is a structural observation.

The absence of selected content is itself evidence that the deck contains an empty slab.

This depends critically on the precondition

```text
deck is ready
```

Without deck readiness we could not distinguish

* genuine empty deck

from

* rendering still in progress.

This is not specific to empty decks.

Every structural observation relies on deck readiness.

---

## closestSlab()

This is now purely geometric.

Because

```text
intersectingSlabs()
```

already restricts the search,

`closestSlab()` merely chooses the nearest candidate geometrically.

However,

before implementing it,

we want to inspect the existing functions

```text
closestCandidateAhead()

slabDistanceAhead()
```

to preserve any subtle tie-breaking behavior.

---

## Important architectural conclusion

We realized that

**deck readiness is the interface contract between structure and geometry.**

It guarantees that

* selectors are meaningful,
* slab geometry is stable,
* empty decks are distinguishable from incomplete rendering.
