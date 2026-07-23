import {
    ACTIVATION_DISTANCE,
    ADJACENCY_OVERLAP_TOLERANCE
} from "./constants.js";
import { slabType } from "./slabType.js";
import { getNextAnchorIn } from "./getNextAnchorIn.js";
import { boundaryOf } from "./boundary.js";
import { waitLayoutStable } from "./stabilize.js";
import {
    contains,
    elementsIn,
    moveWorkZone,
    observeSupplier,
    roomAhead,
    workZonePosition,
    workZoneTop
} from "./scrollContainer.js";
import {
    beginPendingAwaitDiagnostics,
    finishPendingAwaitDiagnostics,
    beginOrContinueJumpDiagnostics,
    updateJumpDiagnostics,
    finishJumpDiagnostics,
    recordCycleStageDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

let supplier;
let currentDeck;
let currentSlab;
let currentAnchor;
let imageReady;

export function resetSupplyWorker() {
    supplier = observeSupplier();
    currentDeck = null;
    currentSlab = null;
    currentAnchor = null;
    imageReady = false;
}

export async function selectNextDeckRoom(area) {
    const { supplyArea, activeArea, workZone } = environment();
    const decks = getDecks(supplyArea);

    const candidates = decks.filter(candidate => {
        const geometry = deckGeometry(candidate, workZone);
        return geometry.bottomRoom >= area.top &&
            geometry.room <= area.bottom;
    });

    const deck = closestDeck(area.bottom, candidates, workZone);

    recordCycleStageDiagnostics("deck-search", {
        deckRoom: area.bottom,
        area,
        deckCount: decks.length,
        first: snapshotElementDiagnostics(decks[0]),
        last: snapshotElementDiagnostics(decks[decks.length - 1]),
        candidates: candidates.map(snapshotElementDiagnostics),
        selected: snapshotElementDiagnostics(deck),
        activation: deck?.getAttribute("data-is-intersecting") ?? null
    });

    if (deck == null) return null;

    currentDeck = deck;
    currentSlab = null;
    currentAnchor = null;
    imageReady = false;

    const startedAtDiagnostics = performance.now();

    beginPendingAwaitDiagnostics("deck-activation", {
        deck: snapshotElementDiagnostics(deck),
        activation: deck.getAttribute("data-is-intersecting")
    });
    await waitDeckActive(deck, activeArea);
    finishPendingAwaitDiagnostics({
        deck: snapshotElementDiagnostics(deck),
        activation: deck.getAttribute("data-is-intersecting")
    });

    recordCycleStageDiagnostics("deck-active", {
        waitedMs: performance.now() - startedAtDiagnostics,
        deck: snapshotElementDiagnostics(deck),
        activation: deck.getAttribute("data-is-intersecting")
    });

    return deckGeometry(deck, workZone).room;
}

export function selectNextSlabRoom(area, deckRoom) {
    const { workZone } = environment();
    const deck = retainedDeck();
    const slabs = getSlabsIn(deck);

    const candidates = slabs.filter(candidate => {
        const geometry = slabGeometry(candidate, workZone);
        return geometry.bottomRoom >= area.top &&
            geometry.room <= area.bottom;
    });

    const slab = closestSlab(area.bottom, candidates, workZone);

    recordCycleStageDiagnostics("slab-search", {
        room: area.bottom,
        deckRoom,
        area,
        slabCount: slabs.length,
        candidates: candidates.map(snapshotElementDiagnostics),
        selected: snapshotElementDiagnostics(slab)
    });

    if (slab == null) return null;

    currentSlab = slab;
    currentAnchor = null;
    imageReady = false;

    return slabGeometry(slab, workZone).room;
}

function retainedDeck() {
    if (!currentDeck) throw new Error("No current deck.");
    return currentDeck;
}

export function getDecks(supplyArea) {
    const byId = new Map();

    for (const element of elementsIn(
        supplyArea,
        "[data-turn-id-container]"
    )) {
        const rect = element.getBoundingClientRect();
        if (rect.height === 0) continue;

        const id = element.getAttribute("data-turn-id-container");
        const existing = byId.get(id);

        if (!existing || element.contains(existing)) {
            byId.set(id, element);
        }
    }

    return Array.from(byId.values()).sort((first, second) => {
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        return secondRect.bottom - firstRect.bottom;
    });
}

export function viewportHeight() {
    return environment().workZone.height;
}

export async function pickAnchor(room) {
    const { workZone } = environment();
    const slab = retainedSlab();
    const type = slabType(slab);

    if (type === "unknown") {
        throw new Error("Cannot move an unknown slab type.");
    }

    if (type === "image" || type === "empty") {
        if (!imageReady) {
            beginPendingAwaitDiagnostics("image-readiness", {
                slab: snapshotElementDiagnostics(slab),
                type
            });
            await waitImageReady(slab);
            finishPendingAwaitDiagnostics({
                slab: snapshotElementDiagnostics(slab),
                type
            });
            imageReady = true;
        }
        currentAnchor = boundaryOf(slab, "top");
    } else if (room > 0) {
        currentAnchor = boundaryOf(slab, "top");
    } else {
        currentAnchor = getNextAnchorIn(slab, workZone);
    }

    if (!currentAnchor) {
        throw new Error("No ready visible anchor found in current slab.");
    }

    return roomAhead(currentAnchor, workZone);
}

export function movementGeometry() {
    const { supplyArea, workZone } = environment();
    return {
        anchorRoom: roomAhead(retainedAnchor(), workZone),
        slabRoom: roomAhead(boundaryOf(retainedSlab(), "top"), workZone),
        deckRoom: roomAhead(boundaryOf(retainedDeck(), "top"), workZone),
        supplyRoom: workZonePosition(supplyArea, workZone),
        viewportHeight: workZone.height
    };
}

export function anchorMovementGeometry() {
    const { supplyArea, workZone } = environment();
    return {
        anchorRoom: roomAhead(retainedAnchor(), workZone),
        supplyRoom: workZonePosition(supplyArea, workZone),
        viewportHeight: workZone.height
    };
}

export async function moveAndStabilize(jump) {
    const { supplyArea, activeArea, workZone } = environment();
    const anchor = retainedAnchor();
    const roomBefore = roomAhead(anchor, workZone);
    const supplyRoomBefore = workZonePosition(supplyArea, workZone);

    beginOrContinueJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchor),
        roomBefore,
        jump,
        scrollYBefore: supplyRoomBefore
    });

    moveWorkZone(jump, supplyArea, workZone);

    const supplyRoomAfter = workZonePosition(supplyArea, workZone);

    if (supplyRoomAfter === supplyRoomBefore) {
        const anchorRoom = roomAhead(anchor, workZone);
        finishJumpDiagnostics({
            scrollYAfter: supplyRoomAfter,
            obtainedRoom: anchorRoom,
            status: "no-movement"
        });
        return {
            anchorRoom,
            supplyRoomBefore,
            supplyRoomAfter
        };
    }

    updateJumpDiagnostics({
        scrollYAfter: supplyRoomAfter,
        immediateAnchor: snapshotElementDiagnostics(anchor)
    });

    const roomUntilFirstNotReadyDeck =
        measureRoomUntilFirstNotReadyDeck(activeArea, workZone);
    const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
        ? 2
        : 1;

    updateJumpDiagnostics({ roomUntilFirstNotReadyDeck });

    const postJumpStabilization = await waitLayoutStable(
        supplyArea,
        workZone,
        {
            current: anchor,
            stableFrames
        }
    );

    const anchorRoom = roomAhead(anchor, workZone);
    finishJumpDiagnostics({
        postJumpStabilization,
        obtainedRoom: anchorRoom,
        settledAnchor: snapshotElementDiagnostics(anchor)
    });

    return {
        anchorRoom,
        supplyRoomBefore,
        supplyRoomAfter
    };
}

function closestDeck(referenceRoom, candidates, workZone) {
    let selected = null;
    let smallestGap = Infinity;

    for (const candidate of candidates) {
        const gap = referenceRoom -
            deckGeometry(candidate, workZone).bottomRoom;
        if (gap < -ADJACENCY_OVERLAP_TOLERANCE) continue;
        if (gap >= smallestGap) continue;
        smallestGap = gap;
        selected = candidate;
    }

    return selected;
}

function deckGeometry(deck, workZone) {
    return {
        room: roomAhead(boundaryOf(deck, "top"), workZone),
        bottomRoom: roomAhead(boundaryOf(deck, "bottom"), workZone)
    };
}

function isDeckActive(deck, activeArea) {
    return (
        contains(activeArea, deck) &&
        deck.dataset.isIntersecting !== undefined &&
        deck.dataset.isIntersecting !== "false"
    );
}

export async function waitDeckActive(
    deck,
    activeArea,
    {
        timeout = 10000,
        poll = 100
    } = {}
) {
    if (isDeckActive(deck, activeArea)) return;

    const deadline = Date.now() + timeout;

    while (!isDeckActive(deck, activeArea)) {
        if (!deck.isConnected) {
            throw new Error(
                "Deck detached while waiting for readiness."
            );
        }
        if (Date.now() >= deadline) {
            throw new Error(
                "Timed out waiting for deck activation."
            );
        }
        await new Promise(resolve =>
            setTimeout(resolve, poll)
        );
    }
}

function closestSlab(referenceRoom, candidates, workZone) {
    let selected = null;
    let smallestGap = Infinity;

    for (const candidate of candidates) {
        const gap = referenceRoom -
            slabGeometry(candidate, workZone).bottomRoom;
        if (gap < -ADJACENCY_OVERLAP_TOLERANCE) continue;
        if (gap >= smallestGap) continue;
        smallestGap = gap;
        selected = candidate;
    }

    return selected;
}

function slabGeometry(slab, workZone) {
    return {
        room: roomAhead(boundaryOf(slab, "top"), workZone),
        bottomRoom: roomAhead(boundaryOf(slab, "bottom"), workZone)
    };
}

function getSlabsIn(deck) {
    const slabs = [];

    for (const message of deck.querySelectorAll("[data-message-id]")) {
        slabs.push(message);
    }

    for (const image of deck.querySelectorAll('.group\\/imagegen-image')) {
        slabs.push(image);
    }

    for (const canvas of deck.querySelectorAll('[id^="textdoc-message-"]')) {
        slabs.push(canvas);
    }

    if (slabs.length === 0) {
        slabs.push(makeEmptySlab(deck));
    }

    slabs.sort((first, second) => {
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        return secondRect.bottom - firstRect.bottom;
    });

    return slabs;
}

function makeEmptySlab(deck) {
    return {
        getBoundingClientRect() {
            const rect = deck.getBoundingClientRect();
            return {
                top: rect.top,
                bottom: rect.top,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: 0
            };
        }
    };
}

function measureRoomUntilFirstNotReadyDeck(activeArea, workZone) {
    const viewportBoundary = workZoneTop(workZone);
    let roomUntilFirstNotReadyDeck = Infinity;

    for (const deck of elementsIn(activeArea,
        '[data-turn-id-container][data-is-intersecting="false"]'
    )) {
        const rect = deck.getBoundingClientRect();
        const isAhead = rect.top < viewportBoundary;
        if (!isAhead) continue;
        const roomUntilDeck = viewportBoundary - rect.bottom;
        roomUntilFirstNotReadyDeck = Math.min(
            roomUntilFirstNotReadyDeck,
            roomUntilDeck
        );
    }

    return roomUntilFirstNotReadyDeck;
}

function environment() {
    if (!supplier) resetSupplyWorker();
    return supplier;
}

function retainedSlab() {
    if (!currentSlab) throw new Error("No current slab.");
    if (!currentSlab.isConnected && currentSlab.matches) {
        throw new Error("Current slab was disconnected during movement.");
    }
    return currentSlab;
}

function retainedAnchor() {
    if (!currentAnchor) throw new Error("No current anchor.");
    return currentAnchor;
}

async function waitImageReady(slab) {
    const images = slab.matches?.("img")
        ? [slab]
        : slab.querySelectorAll
            ? [...slab.querySelectorAll("img")]
            : [];

    for (const image of images) {
        if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
            await new Promise((resolve, reject) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", reject, { once: true });
            });
        }
        if (typeof image.decode === "function") await image.decode();
    }
}
