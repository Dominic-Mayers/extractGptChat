import {

    ADJACENCY_OVERLAP_TOLERANCE,
    MIN_ACTIVATION_DISTANCE,
    MAX_SLAB_GAP,
    TOLERATED_ROUNDING
} from "./constants-dev.js";
import { slabType } from "./slabType-dev.js";
import { getNextAnchorIn } from "./getNextAnchorIn-dev.js";
import { areaAhead } from "./geometry-dev.js";
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
} from "./scrollContainer-dev.js";
import {
    beginPendingAwaitDiagnostics,
    finishPendingAwaitDiagnostics,
    beginOrContinueJumpDiagnostics,
    updateJumpDiagnostics,
    recordCycleStageDiagnostics,
    recordDeckSectionActivationDiagnostics,
    recordDeckSectionEnumerationDiagnostics,
    recordDeckUpdateDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics-dev.js";
import {
    compileDeck,
    compiledDeckFor,
    waitSlabReady,
    storeCompiledDeck
} from "./extraction-dev.js";

let supplier;
let currentDeck;
let currentSlab;
let currentAnchor;
let savedDeckActivationStatus;
let currentJumpObserverDiagnostics = null;
let currentAnchorNumberDiagnostics = 0;

export function resetSupplyWorker() {
    resetSupplyWorkerDiagnostics();
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
    const beforeDiagnostics = {
        slab: snapshotElementDiagnostics(slab),
        deck: snapshotElementDiagnostics(deck)
    };
    const startedAtDiagnostics = performance.now();

    beginPendingAwaitDiagnostics("slab-readiness", {
        type,
        ...beforeDiagnostics
    });
    const readiness = await waitSlabReady(type, slab);
    finishPendingAwaitDiagnostics({
        type,
        readiness,
        before: beforeDiagnostics,
        slab: snapshotElementDiagnostics(slab),
        deck: snapshotElementDiagnostics(deck)
    });
    recordCycleStageDiagnostics("slab-ready", {
        type,
        waitedMs: performance.now() - startedAtDiagnostics,
        readiness,
        before: beforeDiagnostics,
        slab: snapshotElementDiagnostics(slab),
        deck: snapshotElementDiagnostics(deck)
    });

    return {
        slabRoom: slabGeometry(slab, workZone).room,
        deckRoom: deckGeometry(deck, workZone).room
    };
}

export async function checkUpdateNeededBeforeDeactivation(jump) {
    const { activeArea, workZone } = environment();
    const deactivationBoundary =
        workZoneTop(workZone) + workZone.height + MIN_ACTIVATION_DISTANCE;
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

        const turnIdDiagnostics =
            deck.getAttribute("data-turn-id-container");
        const previousDiagnostics = compiledDeckFor(turnIdDiagnostics);
        const slabTypesBeforeDiagnostics =
            getSlabsIn(deck).map(slab => slabType(slab));
        const updated = isUpdated(deck);

        if (updated) await replaceByUpdate(deck);

        recordDeckUpdateDiagnostics({
            turnId: turnIdDiagnostics,
            jump,
            deactivationBoundary,
            top: rect.top,
            topAfterJump,
            compiledHeight: previousDiagnostics.height,
            currentHeight: rect.height,
            slabTypesBefore: slabTypesBeforeDiagnostics,
            decision: updated ? "replaced" : "unchanged",
            replacementHeight: updated
                ? compiledDeckFor(turnIdDiagnostics).height
                : null,
            slabTypesAfter: updated
                ? getSlabsIn(deck).map(slab => slabType(slab))
                : null
        });
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
    captureDeckSectionActivationDiagnostics(deck);

    return deckGeometry(deck, workZone).room;
}

export function selectNextSlabRoom(slabRoom, deckRoom) {
    const { workZone } = environment();
    const deck = retainedDeck();
    const area = areaAhead(slabRoom, MAX_SLAB_GAP);
    captureDeckSectionEnumerationDiagnostics(deck);
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

    return slabGeometry(slab, workZone).room;
}

function captureDeckSectionActivationDiagnostics(deck) {
    const snapshot = deckSectionSnapshotDiagnostics(deck);
    recordDeckSectionActivationDiagnostics(snapshot);
}

function captureDeckSectionEnumerationDiagnostics(deck) {
    recordDeckSectionEnumerationDiagnostics(
        deckSectionSnapshotDiagnostics(deck)
    );
}

function deckSectionSnapshotDiagnostics(deck) {
    const sections = Array.from(deck.children)
        .filter(child => child.matches("section"));
    const section = sections[0] ?? null;
    const rect = section?.getBoundingClientRect();

    return {
        turnId: deck.getAttribute("data-turn-id-container"),
        sectionCount: sections.length,
        sectionHeight: rect?.height ?? null,
        sectionChildCount: section?.childElementCount ?? null,
        messageCount: section?.querySelectorAll("[data-message-id]").length ?? 0,
        imageCount:
            section?.querySelectorAll(".group\\/imagegen-image").length ?? 0,
        canvasCount:
            section?.querySelectorAll('[id^="textdoc-message-"]').length ?? 0
    };
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
    currentAnchorNumberDiagnostics++;

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
            geometryChangeDiagnostics:
                deckGeometryChangeDiagnostics(
                    deck,
                    viewportTop
                ),
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

function deckGeometryChangeDiagnostics(
    deck,
    viewportTop
) {
    const computedStyle = getComputedStyle(deck);
    const investigatedDeck =
        deck.getAttribute("data-turn-id-container") ===
        "a7c93c21-9530-40b2-8369-5a98541ea360";
    return {
        className: deck.getAttribute("class"),
        inlineLastKnownHeight:
            deck.style.getPropertyValue("--last-known-height"),
        resolvedLastKnownHeight:
            computedStyle.getPropertyValue("--last-known-height"),
        computedHeight: computedStyle.height,
        marginCollapse: investigatedDeck
            ? {
                deck: layoutElementDiagnostics(deck, viewportTop),
                parent: layoutElementDiagnostics(
                    deck.parentElement,
                    viewportTop
                ),
                previousSibling: layoutElementDiagnostics(
                    deck.previousElementSibling,
                    viewportTop
                ),
                children: Array.from(deck.children).map(child =>
                    layoutElementDiagnostics(child, viewportTop)
                )
            }
            : null
    };
}

function layoutElementDiagnostics(element, viewportTop) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
        tagName: element.tagName,
        className: element.getAttribute("class"),
        turnId: element.getAttribute("data-turn-id-container"),
        top: rect.top - viewportTop,
        bottom: rect.bottom - viewportTop,
        height: rect.height,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        borderTopWidth: style.borderTopWidth,
        borderBottomWidth: style.borderBottomWidth,
        display: style.display,
        overflow: style.overflow,
        position: style.position
    };
}

export async function moveWorkZoneBy(jump) {
    resetJumpObserverDiagnostics();
    const { supplyArea, workZone } = environment();
    const anchorDiagnostics = retainedAnchor();
    const anchorRoomBeforeDiagnostics =
        roomAhead(anchorDiagnostics, workZone);
    const supplyRoomBeforeDiagnostics =
        workZonePosition(supplyArea, workZone);
    const probeDiagnostics = {
        jumpTarget: anchorDiagnostics.element === retainedSlab() &&
            anchorDiagnostics.edge === "top"
            ? "slabTop"
            : "ordinaryAnchor",
        phase: "pre-command-frame",
        beforeFrame: jumpProbeGeometryDiagnostics(
            anchorDiagnostics,
            supplyArea,
            workZone
        ),
        preCommand: null,
        afterCommand: null,
        nextRaf: null,
        activationChanges: [],
        renderingChanges: []
    };
    beginJumpObserverDiagnostics(
        probeDiagnostics,
        supplyArea
    );

    beginOrContinueJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchorDiagnostics),
        anchorNumber: currentAnchorNumberDiagnostics,
        anchorRoomBefore: anchorRoomBeforeDiagnostics,
        jump,
        scrollYBefore: supplyRoomBeforeDiagnostics,
        erasedJumpProbe: probeDiagnostics
    });

    await nextAnimationFrame();

    drainJumpObserverDiagnostics(
        probeDiagnostics,
        "pre-command-frame"
    );
    probeDiagnostics.preCommand = jumpProbeGeometryDiagnostics(
        anchorDiagnostics,
        supplyArea,
        workZone
    );
    probeDiagnostics.phase = "command";
    moveWorkZone(jump, supplyArea, workZone);
    drainJumpObserverDiagnostics(probeDiagnostics, "command");
    probeDiagnostics.afterCommand = jumpProbeGeometryDiagnostics(
        anchorDiagnostics,
        supplyArea,
        workZone
    );
    probeDiagnostics.phase = "post-command";

    const supplyRoomAfterDiagnostics =
        workZonePosition(supplyArea, workZone);

    updateJumpDiagnostics({
        scrollYAfter: supplyRoomAfterDiagnostics,
        immediateAnchor: snapshotElementDiagnostics(anchorDiagnostics)
    });

    captureNextRafJumpProbeDiagnostics(
        probeDiagnostics,
        anchorDiagnostics,
        supplyArea,
        workZone
    );
}

function resetJumpObserverDiagnostics() {
    currentJumpObserverDiagnostics?.disconnect();
    currentJumpObserverDiagnostics = null;
}

function drainJumpObserverDiagnostics(probe, phase) {
    const records = currentJumpObserverDiagnostics?.takeRecords() ?? [];
    recordJumpChangesDiagnostics(probe, records, phase);
}

function resetSupplyWorkerDiagnostics() {
    resetJumpObserverDiagnostics();
    currentAnchorNumberDiagnostics = 0;
}

function beginJumpObserverDiagnostics(probe, supplyArea) {
    currentJumpObserverDiagnostics = observeJumpChangesDiagnostics(
        probe,
        supplyArea
    );
}

function captureNextRafJumpProbeDiagnostics(
    probe,
    anchor,
    supplyArea,
    workZone
) {
    requestAnimationFrame(() => {
        drainJumpObserverDiagnostics(probe, "post-command");
        probe.nextRaf = jumpProbeGeometryDiagnostics(
            anchor,
            supplyArea,
            workZone
        );
        probe.phase = "after-next-rAF";
    });
}

function jumpProbeGeometryDiagnostics(anchor, supplyArea, workZone) {
    const viewportTop = workZoneTop(workZone);
    const viewportBottom = viewportTop + workZone.height;
    let activationDistanceAbove = null;
    let activationDistanceBelow = null;
    let inactiveDeckAbove = null;
    let inactiveDeckBelow = null;

    for (const deck of getDecks(supplyArea)) {
        const activation = deck.getAttribute("data-is-intersecting");
        if (activation != null && activation !== "false") continue;

        const rect = deck.getBoundingClientRect();
        if (rect.bottom <= viewportTop) {
            const distance = viewportTop - rect.bottom;
            if (
                activationDistanceAbove == null ||
                distance < activationDistanceAbove
            ) {
                activationDistanceAbove = distance;
                inactiveDeckAbove = deck;
            }
        }
        if (rect.top >= viewportBottom) {
            const distance = rect.top - viewportBottom;
            if (
                activationDistanceBelow == null ||
                distance < activationDistanceBelow
            ) {
                activationDistanceBelow = distance;
                inactiveDeckBelow = deck;
            }
        }
    }

    return {
        slabRoom: roomAhead(
            { element: retainedSlab(), edge: "top" },
            workZone
        ),
        anchorRoom: roomAhead(anchor, workZone),
        deckRoom: roomAhead(
            { element: retainedDeck(), edge: "top" },
            workZone
        ),
        scrollHeight: readSupplyHeight(supplyArea),
        scrollY: workZonePosition(supplyArea, workZone),
        activationDistanceAbove,
        activationDistanceBelow,
        inactiveDeckAbove: snapshotElementDiagnostics(inactiveDeckAbove),
        inactiveDeckBelow: snapshotElementDiagnostics(inactiveDeckBelow)
    };
}

function observeJumpChangesDiagnostics(probe, supplyArea) {
    const observer = new MutationObserver(records => {
        recordJumpChangesDiagnostics(probe, records, probe.phase);
    });

    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["data-is-intersecting"]
    });
    return observer;
}

function recordJumpChangesDiagnostics(probe, records, phase) {
    for (const record of records) {
        if (
            record.type === "attributes" &&
            record.attributeName === "data-is-intersecting"
        ) {
            probe.activationChanges.push({
                clock: performance.now(),
                phase,
                deck: snapshotElementDiagnostics(record.target),
                before: record.oldValue,
                after: record.target.getAttribute(
                    "data-is-intersecting"
                )
            });
            continue;
        }

        if (record.type !== "childList") continue;
        for (const element of record.addedNodes) {
            if (element.nodeType !== Node.ELEMENT_NODE) continue;
            if (element.tagName === "SECTION") {
                probe.activationChanges.push({
                    clock: performance.now(),
                    phase,
                    deck: snapshotElementDiagnostics(
                        record.target.closest?.(
                            "[data-turn-id-container]"
                        )
                    ),
                    sectionChange: "added",
                    section: mutationElementDiagnostics(element)
                });
                continue;
            }
            probe.renderingChanges.push({
                clock: performance.now(),
                phase,
                change: "added",
                element: mutationElementDiagnostics(element)
            });
        }
        for (const element of record.removedNodes) {
            if (element.nodeType !== Node.ELEMENT_NODE) continue;
            if (element.tagName === "SECTION") {
                probe.activationChanges.push({
                    clock: performance.now(),
                    phase,
                    deck: snapshotElementDiagnostics(
                        record.target.closest?.(
                            "[data-turn-id-container]"
                        )
                    ),
                    sectionChange: "removed",
                    section: mutationElementDiagnostics(element)
                });
                continue;
            }
            probe.renderingChanges.push({
                clock: performance.now(),
                phase,
                change: "removed",
                element: mutationElementDiagnostics(element)
            });
        }
    }
}

function mutationElementDiagnostics(element) {
    const deck = element.matches?.("[data-turn-id-container]")
        ? element
        : element.closest?.("[data-turn-id-container]");
    return {
        tagName: element.tagName?.toLowerCase() ?? null,
        id: element.id || null,
        className: element.getAttribute?.("class") ?? null,
        role: element.getAttribute?.("data-message-author-role") ?? null,
        messageId: element.getAttribute?.("data-message-id") ?? null,
        turnId: deck?.getAttribute("data-turn-id-container") ?? null,
        snapshot: snapshotElementDiagnostics(element)
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
