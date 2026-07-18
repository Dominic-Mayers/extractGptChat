# Context for conversation

This is not updated to match newly written code in src/dev. The newly written code is source of truth. This is only a source of truth to plan new code. The code in src/app is used to learn about chatGpt structure and behavior and borrow some related code.

## Rules

* Do not add comments in the code. I will add them for human beings.
* You can change the flow of the code as needed in a localized manner that respects the  flow that I requested.
* Never change the flow of the code beyond what I request, unless it is localized.
* For example, do not make a function depends on a policy unless I decide that the policy is external to the function, not hardcoded in the function. (You did that in a previous session and that surprised me a lot.)

## Objective

We are refactoring a ChatGPT conversation extractor.

## Current understanding

Geometry (movement):

* room
* jumps
* viewport = work zone

Structure (selection and extraction):

* decks
* slabs
* readiness
* extraction

We realized that geometry  and structure cannot be managed entirely separately, because geometry depends on elements being rendered.

---

## Main orchestration

The traversal currently being designed, which is the source of truth (unless superceded by newly written code), is

```text
repeat

    if (current && room <  MAX_SLAB_GAP )

        room = await moveWorkZone(current);

    // Either find the next slab in the current deck ...

    slab = room - deckRoom >= MINIMUM_SLAB_HEIGHT && nextSlab(current, deck);

    // ... or try get the next deck, break if no deck, and find the next slab there.

    if (slab == null

        deck = await nextReadyDeck(deckTop);
        if (deck == null) {
            break;
        }
        deckRoom = deck.getBoundingClientRect().top;
        slab = nextSlab(room, deck);
        if (!slab) throw new Error("No slab found in ready deck.");

    current = slab
    room = current.getBoundingClientRect().top;

    //
    // Extraction phase not implemented yet
    //
    // const type = slabType(current);
    // await waitSlabReady(type, current);
    // extractSlab(type, current);

exportMarkdown()
```
---

## moveWorkZone(current, calibratedJump)

This function cannot be entirely separated from readiness and selection of slabs. 

Its structure is

```text
room = measureRoom(current)

while ( ! slabIntersectionAtMinimum && !atExtremity )

    const jump = clampJump(CALIBRATED_JUMP, room, container, direction);
    performJump(jump)
    if () break;


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
