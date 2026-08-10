import {
    ADJACENCY_OVERLAP_TOLERANCE,
    MAX_DRIFT,
    MIN_ACTIVATION_DISTANCE,
    MAX_SLAB_GAP,
    TOLERATED_ROUNDING
} from "./constants.js";
import {
    slabType
} from "./slabType.js";
import {
    getNextAnchorIn
} from "./getNextAnchorIn.js";
import {
    areaAhead
} from "./geometry.js";
import {
    contains,
    elementsIn,
    moveWorkZone,
    nextAnimationFrame,
    observeSupplier,
    roomAhead,
    supplyHeight as readSupplyHeight,
    workZonePosition,
    workZoneTop
} from "./scrollContainer.js";

import {
    compileDeck,
    compiledDeckFor,
    isSlabReady,
    waitSlabReady,
    storeCompiledDeck
} from "./extraction.js";

let supplier;
let currentDeck;
let currentSlab;
let currentAnchor;
let savedDeckActivationStatus;

// TEMPORARY DIAGNOSTIC (v3.15): remove after the viewport-oscillation study.
const VIEWPORT_OSCILLATION_MINIMUM_MOVEMENT = 40;
const VIEWPORT_OSCILLATION_MAXIMUM_FRAME_GAP = 2;
const VIEWPORT_OSCILLATION_MAXIMUM_NET_RATIO = 0.25;

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
        workZoneTop(workZone) + workZone.height + MIN_ACTIVATION_DISTANCE;
    const predictedDecks = [];
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

        predictedDecks.push(deck);

        const updated = isUpdated(deck);

        if (updated) await replaceByUpdate(deck);

    }

    return predictedDecks;
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

export async function selectAnchor() {
    const { activeArea, supplyArea, workZone } = environment();

    while (true) {
        const {
            anchors,
            rejectedAcrossInactiveDecks
        } = anchorCandidates(activeArea, supplyArea, workZone);

        const tentativeAnchor = anchors.sort((first, second) => {
            const firstRoom = roomAhead(first, workZone);
            const secondRoom = roomAhead(second, workZone);
            return Math.abs(firstRoom) - Math.abs(secondRoom);
        })[0] ?? null;

        if (!tentativeAnchor) {

            throw new Error(
                rejectedAcrossInactiveDecks.length > 0
                    ? "No anchor can reach the current slab without " +
                        "crossing a DOM-inactive deck."
                    : "No ready anchor found near the viewport top."
            );
        }

        const pathSlabs = slabsBetweenCurrentAndAnchor(
            tentativeAnchor,
            supplyArea
        );
        if (pathSlabs == null) {
            throw new Error(
                "Cannot enumerate slabs between the current slab and " +
                    "the tentative anchor."
            );
        }
        const unreadySlabs = pathSlabs.filter(slab => {
            const type = slabType(slab);
            return !isSlabReady(type, slab);
        });

        if (unreadySlabs.length === 0) {
            currentAnchor = tentativeAnchor;

            return roomAhead(currentAnchor, workZone);
        }

        for (const slab of unreadySlabs) {
            const type = slabType(slab);
            await waitSlabReady(type, slab);
        }

        // Readiness can replace content and radically change deck geometry.
        // Never move the anchor selected from the pre-readiness layout.
        await nextAnimationFrame();

    }
}

function anchorCandidates(activeArea, supplyArea, workZone) {
    const anchors = [];
    const rejectedAcrossInactiveDecks = [];

    for (const deck of elementsIn(
        activeArea,
        '[data-turn-id-container][data-is-intersecting="true"]'
    )) {
        for (const slab of getSlabsIn(deck)) {
            const anchor = getNextAnchorIn(slab, workZone);
            if (!anchor) continue;
            const rect = anchor.element.getBoundingClientRect();
            const viewportTop = workZoneTop(workZone);
            const viewportBottom = viewportTop + workZone.height;
            if (
                rect.bottom < viewportTop ||
                rect.top > viewportBottom
            ) {
                continue;
            }
            const interveningDecks = decksBetweenAnchorAndCurrentSlab(
                anchor,
                supplyArea
            );
            if (interveningDecks == null) {
                rejectedAcrossInactiveDecks.push({
                    anchorDeckId: activationDeckForAnchor(anchor)
                        ?.getAttribute("data-turn-id-container") ?? null,
                    currentDeckId: retainedDeck()
                        .getAttribute("data-turn-id-container"),
                    inactiveDeckIds: [],
                    unresolvedDeckPath: true
                });
                continue;
            }
            const inactiveDecks = interveningDecks.filter(candidate =>
                candidate.getAttribute("data-is-intersecting") !== "true"
            );
            if (inactiveDecks.length > 0) {
                rejectedAcrossInactiveDecks.push({
                    anchorDeckId: activationDeckForAnchor(anchor)
                        ?.getAttribute("data-turn-id-container") ?? null,
                    currentDeckId: retainedDeck()
                        .getAttribute("data-turn-id-container"),
                    inactiveDeckIds: inactiveDecks.map(candidate =>
                        candidate.getAttribute("data-turn-id-container")
                    )
                });
                continue;
            }
            anchors.push(anchor);
        }
    }

    return { anchors, rejectedAcrossInactiveDecks };
}

function slabsBetweenCurrentAndAnchor(anchor, supplyArea) {
    const decks = decksBetweenAnchorAndCurrentSlab(anchor, supplyArea);
    if (decks == null) return null;

    const current = retainedSlab();
    const currentRect = current.getBoundingClientRect();
    const anchorRect = anchor.element.getBoundingClientRect();
    const anchorPosition = anchor.edge === "bottom"
        ? anchorRect.bottom
        : anchorRect.top;
    const currentPosition = currentRect.top;
    const pathTop = Math.min(anchorPosition, currentPosition);
    const pathBottom = Math.max(anchorPosition, currentPosition);
    const slabs = [];

    for (const deck of decks) {
        for (const slab of getSlabsIn(deck)) {
            const rect = slab.getBoundingClientRect();
            if (
                slab !== current &&
                (rect.bottom < pathTop || rect.top > pathBottom)
            ) {
                continue;
            }
            if (!slabs.includes(slab)) slabs.push(slab);
        }
    }

    if (!slabs.includes(current)) slabs.push(current);
    slabs.sort((first, second) =>
        second.getBoundingClientRect().bottom -
            first.getBoundingClientRect().bottom
    );
    return slabs;
}

function decksBetweenAnchorAndCurrentSlab(anchor, supplyArea) {
    const anchorDeck = activationDeckForAnchor(anchor);
    const slabDeck = retainedDeck();
    if (anchorDeck == null) return [slabDeck];
    if (anchorDeck === slabDeck) return [slabDeck];

    const decks = getDecks(supplyArea);
    const anchorIndex = decks.indexOf(anchorDeck);
    const slabIndex = decks.indexOf(slabDeck);
    if (anchorIndex < 0 || slabIndex < 0) {
        return null;
    }
    return decks.slice(
        Math.min(anchorIndex, slabIndex),
        Math.max(anchorIndex, slabIndex) + 1
    );
}

function activationDeckForAnchor(anchor) {
    return anchor.element.closest?.(
        "[data-turn-id-container][data-is-intersecting]"
    ) ?? anchor.element.deck ?? null;
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

export function roomUntilFirstActiveDeckBelow() {
    const { activeArea, workZone } = environment();
    return measureRoomUntilFirstActiveDeckBelow(activeArea, workZone);
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

const SPLIT_EXTRA_JUMP = 20;
const SPLIT_DISABLED = false;

let splitJump = null;

function beginSplitJump(totalJump, activationDistance) {
    splitJump = null;
    if (SPLIT_DISABLED) return totalJump;
    if (!Number.isFinite(activationDistance)) return totalJump;
    const activationLimit = activationDistance - MIN_ACTIVATION_DISTANCE;
    if (activationLimit < 0) return totalJump;
    const initialJump = Math.max(
        totalJump - SPLIT_EXTRA_JUMP,
        MAX_DRIFT
    );
    if (initialJump < activationLimit) return totalJump;
    if (totalJump - initialJump < MAX_DRIFT) return totalJump;
    splitJump = {
        totalJump,
        activationLimit,
        initialJump,
        extraJump: totalJump - initialJump,
        performed: false
    };
    return initialJump;
}

function nextActivationDistanceAbove() {
    const { supplyArea, workZone } = environment();
    const viewportTop = workZoneTop(workZone);
    let distance = Infinity;

    for (const deck of getDecks(supplyArea)) {
        const activation = deck.getAttribute("data-is-intersecting");
        if (activation != null && activation !== "false") continue;
        const rect = deck.getBoundingClientRect();
        if (rect.bottom > viewportTop) continue;
        const room = viewportTop - rect.bottom;
        if (room < MIN_ACTIVATION_DISTANCE) continue;
        if (room < distance) distance = room;
    }

    return distance;
}

export function performSplitExtraJump(frame) {
    if (frame !== 1) return 0;
    if (splitJump == null) return 0;
    if (splitJump.performed) return 0;
    splitJump.performed = true;
    const { supplyArea, workZone } = environment();

    const nextActivationDistance =
        nextActivationDistanceAbove();
    const secondActivation = Number.isFinite(nextActivationDistance) &&
        nextActivationDistance - splitJump.extraJump <
            MIN_ACTIVATION_DISTANCE;

    moveWorkZone(splitJump.extraJump, supplyArea, workZone);

    return secondActivation ? 0 : splitJump.extraJump;
}

export function cancelSplitJump() {
    splitJump = null;
}

export async function moveWorkZoneBy(jump) {

    const { supplyArea, workZone } = environment();

    const rafClock = await nextAnimationFrame();

    const commandedJump = beginSplitJump(
        jump,
        roomUntilFirstNotReadyDeck()
    );
    moveWorkZone(commandedJump, supplyArea, workZone);

    return rafClock;
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
            const { workZone } = environment();
            const geometry = deckGeometry(deck, workZone);
            const rect = deck.getBoundingClientRect();
            throw new Error(
                "Timed out waiting for deck activation: " +
                `turnId=${deck.getAttribute("data-turn-id-container")} ` +
                `rectTop=${rect.top} ` +
                `rectBottom=${rect.bottom} ` +
                `viewportTop=${workZoneTop(workZone)} ` +
                `viewportHeight=${workZone.height} ` +
                `room=${geometry.room} ` +
                `bottomRoom=${geometry.bottomRoom} ` +
                `isIntersecting=${deck.getAttribute("data-is-intersecting")} ` +
                `inActiveArea=${contains(activeArea, deck)}`
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

function measureRoomUntilFirstActiveDeckBelow(activeArea, workZone) {
    const viewportBoundary =
        workZoneTop(workZone) + workZone.height;
    let roomUntilFirstActiveDeckBelow = Infinity;

    for (const deck of elementsIn(activeArea,
        '[data-turn-id-container][data-is-intersecting="true"]'
    )) {
        const rect = deck.getBoundingClientRect();
        if (rect.top < viewportBoundary) continue;
        const roomUntilDeck = rect.top - viewportBoundary;
        roomUntilFirstActiveDeckBelow = Math.min(
            roomUntilFirstActiveDeckBelow,
            roomUntilDeck
        );
    }

    return roomUntilFirstActiveDeckBelow;
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
