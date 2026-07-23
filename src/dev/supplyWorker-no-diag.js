import {
    ACTIVATION_DISTANCE,
    ADJACENCY_OVERLAP_TOLERANCE
} from "./constants-no-diag.js";
import { slabType } from "./slabType-no-diag.js";
import { getNextAnchorIn } from "./getNextAnchorIn-no-diag.js";
import { boundaryOf } from "./boundary-no-diag.js";
import { waitLayoutStable } from "./stabilize-no-diag.js";
import {
    contains,
    elementsIn,
    moveWorkZone,
    observeSupplier,
    roomAhead,
    workZonePosition,
    workZoneTop
} from "./scrollContainer-no-diag.js";
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

    if (deck == null) return null;

    currentDeck = deck;
    currentSlab = null;
    currentAnchor = null;
    imageReady = false;

    await waitDeckActive(deck, activeArea);

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

export async function selectAnchor(room) {
    const { workZone } = environment();
    const slab = retainedSlab();
    const type = slabType(slab);

    if (type === "unknown") {
        throw new Error("Cannot move an unknown slab type.");
    }

    if (type === "image" || type === "empty") {
        if (!imageReady) {

            await waitImageReady(slab);

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

export function anchorRoom() {
    const { workZone } = environment();
    return roomAhead(retainedAnchor(), workZone);
}

export function slabRoom() {
    const { workZone } = environment();
    return roomAhead(boundaryOf(retainedSlab(), "top"), workZone);
}

export function deckRoom() {
    const { workZone } = environment();
    return roomAhead(boundaryOf(retainedDeck(), "top"), workZone);
}

export function supplyRoom() {
    const { supplyArea, workZone } = environment();
    return workZonePosition(supplyArea, workZone);
}

export async function moveWorkZoneAndStabilize(jump) {
    const { supplyArea, activeArea, workZone } = environment();
    const anchor = retainedAnchor();

    const supplyRoomBefore = workZonePosition(supplyArea, workZone);

    moveWorkZone(jump, supplyArea, workZone);

    const supplyRoomAfter = workZonePosition(supplyArea, workZone);

    if (supplyRoomAfter === supplyRoomBefore) {

        return;
    }

    const roomUntilFirstNotReadyDeck =
        measureRoomUntilFirstNotReadyDeck(activeArea, workZone);
    const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
        ? 2
        : 1;

    await waitLayoutStable(
        supplyArea,
        workZone,
        {
            current: anchor,
            stableFrames
        }
    );

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
