import {

    ADJACENCY_OVERLAP_TOLERANCE,
    ACTIVATION_DISTANCE,
    MAX_SLAB_GAP,
    TOLERATED_ROUNDING
} from "./constants.js";
import { slabType } from "./slabType.js";
import { getNextAnchorIn } from "./getNextAnchorIn.js";
import { areaAhead } from "./geometry.js";
import {
    contains,
    elementsIn,
    moveWorkZone,
    observeSupplier,
    roomAhead,
    supplyHeight as readSupplyHeight,
    workZonePosition,
    workZoneTop
} from "./scrollContainer.js";
import {
    compileDeck,
    compiledDeckFor,
    waitSlabReady,
    storeCompiledDeck
} from "./extraction.js";

let supplier;
let currentDeck;
let currentSlab;
let currentAnchor;
let savedDeckActivationStatus;

export function resetSupplyWorker() {
    supplier = observeSupplier();
    currentDeck = null;
    currentSlab = null;
    currentAnchor = null;
    savedDeckActivationStatus = null;
}

export async function compileCurrentDeck() {
    const deck = retainedDeck();
    const unit = await compileDeck(deck, getSlabsIn(deck));
    storeCompiledDeck(unit);
}

export async function waitCurrentSlabReady() {
    const { workZone } = environment();
    const deck = retainedDeck();
    const slab = retainedSlab();
    const type = slabType(slab);

    const readiness = await waitSlabReady(type, slab);

    return {
        slabRoom: slabGeometry(slab, workZone).room,
        deckRoom: deckGeometry(deck, workZone).room
    };
}

export async function checkUpdateNeededBeforeDeactivation(jump) {
    const { activeArea, workZone } = environment();
    const deactivationBoundary =
        workZoneTop(workZone) + workZone.height + ACTIVATION_DISTANCE;
    const decks = elementsIn(
        activeArea,
        '[data-turn-id-container][data-is-intersecting]' +
        ':not([data-is-intersecting="false"])'
    );

    for (const deck of decks) {
        const rect = deck.getBoundingClientRect();
        const topAfterJump = rect.top + jump;
        if (
            rect.top >=
            deactivationBoundary - TOLERATED_ROUNDING ||
            topAfterJump <
            deactivationBoundary - TOLERATED_ROUNDING
        ) {
            continue;
        }

        const updated = isUpdated(deck);

        if (updated) await replaceByUpdate(deck);

    }
}

export function isUpdated(deck) {
    const turnId = deck.getAttribute("data-turn-id-container");
    const previous = compiledDeckFor(turnId);
    if (!previous) {
        throw new Error(
            `No compiled walkway unit for deck ${turnId}.`
        );
    }

    const height = deck.getBoundingClientRect().height;
    if (height < previous.height - TOLERATED_ROUNDING) {
        throw new Error(
            `Deck ${turnId} height decreased from ` +
            `${previous.height} to ${height}.`
        );
    }

    return height > previous.height + TOLERATED_ROUNDING;
}

export async function replaceByUpdate(deck) {
    const unit = await compileDeck(deck, getSlabsIn(deck));
    storeCompiledDeck(unit);
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

    await waitDeckActive(deck, activeArea);

    return deckGeometry(deck, workZone).room;
}

export function selectNextSlabRoom(slabRoom, deckRoom) {
    const { workZone } = environment();
    const deck = retainedDeck();
    const area = areaAhead(slabRoom, MAX_SLAB_GAP);

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
        currentAnchor = { element: slab, edge: "top" };
    } else if (room > 0) {
        currentAnchor = { element: slab, edge: "top" };
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
    return roomAhead(
        { element: retainedSlab(), edge: "top" },
        workZone
    );
}

export function deckRoom() {
    const { workZone } = environment();
    return roomAhead(
        { element: retainedDeck(), edge: "top" },
        workZone
    );
}

export function supplyRoom() {
    const { supplyArea, workZone } = environment();
    return workZonePosition(supplyArea, workZone);
}

export function supplyHeight() {
    return readSupplyHeight(environment().supplyArea);
}

export function roomUntilFirstNotReadyDeck() {
    const { activeArea, workZone } = environment();
    return measureRoomUntilFirstNotReadyDeck(activeArea, workZone);
}

export function thresholdDeckSnapshot() {
    const { activeArea, workZone } = environment();
    const viewportTop = workZoneTop(workZone);
    const viewportHeight = workZone.height;
    const decks = new Map();

    for (const deck of elementsIn(
        activeArea,
        "div[data-turn-id-container]"
    )) {
        const rect = deck.getBoundingClientRect();
        decks.set(deck, {
            turnId: deck.getAttribute("data-turn-id-container"),
            state: deck.getAttribute("data-is-intersecting"),

            top: rect.top - viewportTop,
            bottom: rect.bottom - viewportTop,
            height: rect.height
        });
    }

    return {
        decks,
        viewportHeight
    };
}

export function deckActivationTransitions(current) {
    const activations = [];
    const deactivations = [];
    const previous = savedDeckActivationStatus;

    if (!previous) return { activations, deactivations };

    for (const [deck, currentDeck] of current.decks) {
        const previousDeck = previous.decks.get(deck);
        if (!previousDeck || previousDeck.state === currentDeck.state) {
            continue;
        }

        const transition = {
            deck,
            turnId: currentDeck.turnId,
            location: deckLocation(
                previousDeck,
                previous.viewportHeight
            ),
            previous: previousDeck,
            current: currentDeck
        };

        if (
            previousDeck.state !== "true" &&
            currentDeck.state === "true"
        ) {
            activations.push(transition);
        }

        if (
            previousDeck.state === "true" &&
            currentDeck.state === "false"
        ) {
            deactivations.push(transition);
        }
    }

    return { activations, deactivations };
}

export function saveDeckActivationStatus(status) {
    savedDeckActivationStatus = status;
}

function deckLocation(deck, viewportHeight) {
    if (deck.bottom <= 0) return "above";
    if (deck.top >= viewportHeight) return "below";
    return "viewport";
}

export function moveWorkZoneBy(jump) {
    const { supplyArea, workZone } = environment();

    moveWorkZone(jump, supplyArea, workZone);

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
        room: roomAhead({ element: deck, edge: "top" }, workZone),
        bottomRoom: roomAhead(
            { element: deck, edge: "bottom" },
            workZone
        )
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
        room: roomAhead({ element: slab, edge: "top" }, workZone),
        bottomRoom: roomAhead(
            { element: slab, edge: "bottom" },
            workZone
        )
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
        deck,
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
