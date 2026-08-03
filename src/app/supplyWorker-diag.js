import {

    ADJACENCY_OVERLAP_TOLERANCE,
    MIN_ACTIVATION_DISTANCE,
    MAX_SLAB_GAP,
    TOLERATED_ROUNDING
} from "./constants-diag.js";
import { slabType } from "./slabType-diag.js";
import { getNextAnchorIn } from "./getNextAnchorIn-diag.js";
import { areaAhead } from "./geometry-diag.js";
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
} from "./scrollContainer-diag.js";
import {
    beginPendingAwaitDiagnostics,
    finishPendingAwaitDiagnostics,
    beginOrContinueJumpDiagnostics,
    updateJumpDiagnostics,
    recordCycleStageDiagnostics,
    recordDeckSectionActivationDiagnostics,
    recordDeckSectionEnumerationDiagnostics,
    recordDeckUpdateDiagnostics,
    recordDeactivationPredictionDiagnostics,
    recordCanvasGeometryDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics-diag.js";
import {
    compileDeck,
    compiledDeckFor,
    isSlabReady,
    waitSlabReady,
    storeCompiledDeck
} from "./extraction-diag.js";

let supplier;
let currentDeck;
let currentSlab;
let currentAnchor;
let savedDeckActivationStatus;
let currentJumpObserverDiagnostics = null;
let deliveredJumpMutationBatchesDiagnostics = [];
let currentJumpProbeDiagnostics = null;
let currentAnchorNumberDiagnostics = 0;
let movementJumpNumberDiagnostics = 0;
let geometricActivationJumpNumbersDiagnostics = new Set();
let pendingDeactivationPredictionsDiagnostics = new Map();
let deckActivationGeometryDiagnostics = new WeakMap();
let lastKnownHeightUpdateDiagnostics = new WeakMap();
let nativeRemovalInstrumentationInstalledDiagnostics = false;
let viewportOscillationRafDiagnostics = null;
let viewportOscillationFrameDiagnostics = 0;
let previousViewportSampleDiagnostics = null;
let previousAnchorMovementDiagnostics = null;

// TEMPORARY DIAGNOSTIC (v3.15): remove after the viewport-oscillation study.
const VIEWPORT_OSCILLATION_MINIMUM_MOVEMENT = 40;
const VIEWPORT_OSCILLATION_MAXIMUM_FRAME_GAP = 2;
const VIEWPORT_OSCILLATION_MAXIMUM_NET_RATIO = 0.25;

export function resetSupplyWorker() {
    resetSupplyWorkerDiagnostics();
    supplier = observeSupplier();
    currentDeck = null;
    currentSlab = null;
    currentAnchor = null;
    savedDeckActivationStatus = null;
}

export function stopSupplyWorkerDiagnostics() {
    if (viewportOscillationRafDiagnostics != null) {
        cancelAnimationFrame(viewportOscillationRafDiagnostics);
    }
    viewportOscillationRafDiagnostics = null;
    previousViewportSampleDiagnostics = null;
    previousAnchorMovementDiagnostics = null;
}

export function startSupplyWorkerDiagnostics() {
    stopSupplyWorkerDiagnostics();
    viewportOscillationFrameDiagnostics = 0;

    const sample = clock => {
        viewportOscillationFrameDiagnostics++;
        const { supplyArea, workZone } = environment();
        const current = {
            frame: viewportOscillationFrameDiagnostics,
            clock,
            scrollY: workZonePosition(supplyArea, workZone),
            scrollHeight: readSupplyHeight(supplyArea),
            anchor: anchorPositionSampleDiagnostics(workZone),
            movementJumpNumber:
                currentJumpProbeDiagnostics?.movementJumpNumber ??
                    movementJumpNumberDiagnostics,
            jumpPhase: currentJumpProbeDiagnostics?.phase ?? null
        };
        const previous = previousViewportSampleDiagnostics;

        if (previous != null) {
            recordScrollYRafIncreaseDiagnostics(previous, current);
            recordAnchorMovementSampleDiagnostics(previous, current);
        }

        previousViewportSampleDiagnostics = current;
        viewportOscillationRafDiagnostics = requestAnimationFrame(sample);
    };

    viewportOscillationRafDiagnostics = requestAnimationFrame(sample);
}

function anchorPositionSampleDiagnostics(workZone) {
    if (!currentAnchor?.element?.isConnected) return null;
    return {
        element: currentAnchor.element,
        edge: currentAnchor.edge,
        position: roomAhead(currentAnchor, workZone)
    };
}

function recordAnchorMovementSampleDiagnostics(previous, current) {
    const before = previous.anchor;
    const after = current.anchor;
    if (
        before == null ||
        after == null ||
        before.element !== after.element ||
        before.edge !== after.edge
    ) {
        previousAnchorMovementDiagnostics = null;
        return;
    }

    const delta = after.position - before.position;
    if (Math.abs(delta) < VIEWPORT_OSCILLATION_MINIMUM_MOVEMENT) return;
    const movement = {
        reference: after.element,
        edge: after.edge,
        from: serializableFrameSampleDiagnostics(previous),
        to: serializableFrameSampleDiagnostics(current),
        delta
    };
    const first = previousAnchorMovementDiagnostics;
    if (
        first != null &&
        first.reference === movement.reference &&
        first.edge === movement.edge
    ) {
        recordAnchorOscillationDiagnostics(first, movement);
    }
    previousAnchorMovementDiagnostics = movement;
}

function recordAnchorOscillationDiagnostics(first, second) {
    if (Math.sign(first.delta) === Math.sign(second.delta)) return;
    const frameGap = second.to.frame - first.to.frame;
    if (frameGap > VIEWPORT_OSCILLATION_MAXIMUM_FRAME_GAP) return;

    const largestMovement = Math.max(
        Math.abs(first.delta),
        Math.abs(second.delta)
    );
    const net = first.delta + second.delta;
    if (
        Math.abs(net) / largestMovement >
        VIEWPORT_OSCILLATION_MAXIMUM_NET_RATIO
    ) {
        return;
    }

    const probe = currentJumpProbeDiagnostics;
    console.info(
        "[viewport content oscillation]\n" +
        JSON.stringify({
            direction: first.delta > 0
                ? "content-down-then-up"
                : "content-up-then-down",
            first: serializableMovementDiagnostics(first),
            second: serializableMovementDiagnostics(second),
            net,
            frameGap,
            movementJumpNumber:
                probe?.movementJumpNumber ?? movementJumpNumberDiagnostics,
            jumpPhase: probe?.phase ?? null,
            jumpTarget: probe?.jumpTarget ?? null,
            activationChanges: probe?.activationChanges?.map(change => ({
                order: change.order,
                phase: change.phase,
                deckId: change.deck?.id ?? null,
                before: change.before ?? null,
                after: change.after ?? null,
                sectionChange: change.sectionChange ?? null
            })) ?? [],
            anchor: safeElementSnapshotDiagnostics(currentAnchor),
            slab: safeElementSnapshotDiagnostics(currentSlab),
            deck: safeElementSnapshotDiagnostics(currentDeck)
        })
    );
}

function serializableMovementDiagnostics(movement) {
    return {
        edge: movement.edge,
        from: movement.from,
        to: movement.to,
        delta: movement.delta
    };
}

function serializableFrameSampleDiagnostics(sample) {
    return {
        frame: sample.frame,
        clock: sample.clock,
        scrollY: sample.scrollY,
        scrollHeight: sample.scrollHeight,
        anchorPosition: sample.anchor?.position ?? null,
        movementJumpNumber: sample.movementJumpNumber,
        jumpPhase: sample.jumpPhase,
        extractorJump: sample.extractorJump ?? null
    };
}

function recordScrollYRafIncreaseDiagnostics(previous, current) {
    const increase = current.scrollY - previous.scrollY;
    if (increase <= 0) return;

    const probe = currentJumpProbeDiagnostics;
    console.info(
        "[scrollY rAF increase]\n" +
        JSON.stringify({
            previous: serializableFrameSampleDiagnostics(previous),
            current: serializableFrameSampleDiagnostics(current),
            increase,
            scrollHeightChange:
                current.scrollHeight - previous.scrollHeight,
            anchorPositionChange:
                previous.anchor != null &&
                current.anchor != null &&
                previous.anchor.element === current.anchor.element &&
                previous.anchor.edge === current.anchor.edge
                    ? current.anchor.position - previous.anchor.position
                    : null,
            movementJumpNumber:
                probe?.movementJumpNumber ?? movementJumpNumberDiagnostics,
            jumpPhase: probe?.phase ?? null,
            jumpTarget: probe?.jumpTarget ?? null,
            command: probe == null ? null : {
                beforeFrameScrollY: probe.beforeFrame?.scrollY ?? null,
                preCommandScrollY: probe.preCommand?.scrollY ?? null,
                afterCommandScrollY: probe.afterCommand?.scrollY ?? null,
                nextRafScrollY: probe.nextRaf?.scrollY ?? null
            },
            activationChanges: probe?.activationChanges?.map(change => ({
                order: change.order,
                phase: change.phase,
                deckId: change.deck?.id ?? null,
                before: change.before ?? null,
                after: change.after ?? null,
                sectionChange: change.sectionChange ?? null
            })) ?? [],
            anchor: safeElementSnapshotDiagnostics(currentAnchor),
            slab: safeElementSnapshotDiagnostics(currentSlab),
            deck: safeElementSnapshotDiagnostics(currentDeck)
        })
    );
}

function safeElementSnapshotDiagnostics(value) {
    try {
        return snapshotElementDiagnostics(value);
    } catch {
        return null;
    }
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
    const canvasBeforeReadinessDiagnostics = type === "canvas"
        ? canvasGeometrySnapshotDiagnostics(deck, slab)
        : null;

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
    if (type === "canvas") {
        recordCanvasGeometryDiagnostics({
            turnId: deck.getAttribute("data-turn-id-container"),
            canvasId: slab.id,
            beforeActivation:
                deckActivationGeometryDiagnostics.get(deck)
                    ?.beforeActivation ?? null,
            afterActivation:
                deckActivationGeometryDiagnostics.get(deck)
                    ?.afterActivation ?? null,
            beforeReadiness: canvasBeforeReadinessDiagnostics,
            afterReadiness:
                canvasGeometrySnapshotDiagnostics(deck, slab)
        });
    }

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
        if (!pendingDeactivationPredictionsDiagnostics.has(deck)) {
            pendingDeactivationPredictionsDiagnostics.set(deck, {
                predictedAt: performance.now(),
                predictedOnJumpNumber:
                    movementJumpNumberDiagnostics + 1,
                deckHeightAtPrediction: rect.height
            });
            recordDeactivationPredictionDiagnostics();
        }

        const turnIdDiagnostics =
            deck.getAttribute("data-turn-id-container");
        const previousDiagnostics = compiledDeckFor(turnIdDiagnostics);
        const slabTypesBeforeDiagnostics =
            getSlabsIn(deck).map(slab => slabType(slab));
        const updated = isUpdated(deck);
        const recompileStartedAtDiagnostics = updated
            ? performance.now()
            : null;

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
            decision: updated ? "recompiled" : "unchanged",
            recompiledHeight: updated
                ? compiledDeckFor(turnIdDiagnostics).height
                : null,
            recompiledSlabTypes: updated
                ? getSlabsIn(deck).map(slab => slabType(slab))
                : null,
            recompileElapsedMs: updated
                ? performance.now() - recompileStartedAtDiagnostics
                : null
        });
    }

    return predictedDecks;
}

export function pendingDeactivationPredictionSnapshotDiagnostics() {
    const now = performance.now();
    const ages = Array.from(
        pendingDeactivationPredictionsDiagnostics.values(),
        prediction => now - prediction.predictedAt
    );
    const count = ages.length;
    return {
        count,
        averageAgeMs: count === 0
            ? null
            : ages.reduce((sum, age) => sum + age, 0) / count,
        youngestAgeMs: count === 0 ? null : Math.min(...ages),
        oldestAgeMs: count === 0 ? null : Math.max(...ages)
    };
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
    const activationGeometryDiagnostics = {
        beforeActivation: canvasGeometrySnapshotDiagnostics(deck),
        afterActivation: null
    };
    deckActivationGeometryDiagnostics.set(
        deck,
        activationGeometryDiagnostics
    );

    beginPendingAwaitDiagnostics("deck-activation", {
        deck: snapshotElementDiagnostics(deck),
        activation: deck.getAttribute("data-is-intersecting")
    });
    await waitDeckActive(deck, activeArea);
    activationGeometryDiagnostics.afterActivation =
        canvasGeometrySnapshotDiagnostics(deck);
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

export async function selectAnchor() {
    const { activeArea, supplyArea, workZone } = environment();
    let recomputationCountDiagnostics = 0;

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
            recordCycleStageDiagnostics("anchor-search", {
                acceptedCount: anchors.length,
                rejectedAcrossInactiveDecks,
                recomputationCount: recomputationCountDiagnostics,
                selected: null
            });
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
            recordCycleStageDiagnostics("anchor-search", {
                acceptedCount: anchors.length,
                rejectedAcrossInactiveDecks,
                pathSlabCount: pathSlabs.length,
                waitedSlabCount: 0,
                recomputationCount: recomputationCountDiagnostics,
                selected: snapshotElementDiagnostics(currentAnchor)
            });
            currentAnchorNumberDiagnostics++;
            return roomAhead(currentAnchor, workZone);
        }

        recordCycleStageDiagnostics("anchor-path-readiness", {
            pathSlabCount: pathSlabs.length,
            waitedSlabCount: unreadySlabs.length,
            recomputationCount: recomputationCountDiagnostics,
            tentative: snapshotElementDiagnostics(tentativeAnchor)
        });
        for (const slab of unreadySlabs) {
            const type = slabType(slab);
            await waitSlabReady(type, slab);
        }

        // Readiness can replace content and radically change deck geometry.
        // Never move the anchor selected from the pre-readiness layout.
        await nextAnimationFrame();
        recomputationCountDiagnostics++;
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
    movementJumpNumberDiagnostics++;
    const { supplyArea, workZone } = environment();
    const anchorDiagnostics = retainedAnchor();
    const anchorRoomBeforeDiagnostics =
        roomAhead(anchorDiagnostics, workZone);
    const supplyRoomBeforeDiagnostics =
        workZonePosition(supplyArea, workZone);
    const probeDiagnostics = {
        movementJumpNumber: movementJumpNumberDiagnostics,
        previousJumpGeometricallyActivated:
            geometricActivationJumpNumbersDiagnostics.has(
                movementJumpNumberDiagnostics - 1
            ),
        twoJumpsAgoGeometricallyActivated:
            geometricActivationJumpNumbersDiagnostics.has(
                movementJumpNumberDiagnostics - 2
            ),
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
        mutationDeliveryNumber: 0,
        mutationOrder: 0,
        activationChanges: [],
        sectionRemovalBoundaries: [],
        renderingChanges: []
    };
    geometricActivationJumpNumbersDiagnostics.delete(
        movementJumpNumberDiagnostics - 3
    );
    currentJumpProbeDiagnostics = probeDiagnostics;
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
    probeDiagnostics.commandClock = performance.now();
    moveWorkZone(jump, supplyArea, workZone);
    if (previousViewportSampleDiagnostics != null) {
        previousViewportSampleDiagnostics.extractorJump = {
            movementJumpNumber: movementJumpNumberDiagnostics,
            requestedJump: jump,
            scrollYAfterCommand:
                workZonePosition(supplyArea, workZone)
        };
    }
    drainJumpObserverDiagnostics(probeDiagnostics, "command");
    probeDiagnostics.afterCommand = jumpProbeGeometryDiagnostics(
        anchorDiagnostics,
        supplyArea,
        workZone
    );
    if (geometricallyActivatesDeckDiagnostics(
        probeDiagnostics.preCommand,
        probeDiagnostics.afterCommand
    )) {
        geometricActivationJumpNumbersDiagnostics.add(
            movementJumpNumberDiagnostics
        );
    }
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
    deliveredJumpMutationBatchesDiagnostics = [];
}

function drainJumpObserverDiagnostics(
    probe,
    phase,
    jumpRaf = false,
    stabilizationRaf = null
) {
    for (const batch of deliveredJumpMutationBatchesDiagnostics) {
        recordJumpChangesDiagnostics(
            probe,
            batch.records,
            batch.phase,
            batch.scrollYAtDeliveryStart,
            jumpRaf,
            stabilizationRaf
        );
    }
    deliveredJumpMutationBatchesDiagnostics = [];
    const { supplyArea, workZone } = environment();
    const scrollYAtDeliveryStart = workZonePosition(
        supplyArea,
        workZone
    );
    const records = currentJumpObserverDiagnostics?.takeRecords() ?? [];
    recordJumpChangesDiagnostics(
        probe,
        records,
        phase,
        scrollYAtDeliveryStart,
        jumpRaf,
        stabilizationRaf
    );
}

export function collectStabilizationRafMutationsDiagnostics(frame) {
    if (currentJumpProbeDiagnostics == null) return;
    drainJumpObserverDiagnostics(
        currentJumpProbeDiagnostics,
        currentJumpProbeDiagnostics.phase,
        false,
        frame
    );
}

function resetSupplyWorkerDiagnostics() {
    installNativeRemovalInstrumentationDiagnostics();
    resetJumpObserverDiagnostics();
    currentJumpProbeDiagnostics = null;
    currentAnchorNumberDiagnostics = 0;
    movementJumpNumberDiagnostics = 0;
    geometricActivationJumpNumbersDiagnostics = new Set();
    pendingDeactivationPredictionsDiagnostics = new Map();
    deckActivationGeometryDiagnostics = new WeakMap();
    lastKnownHeightUpdateDiagnostics = new WeakMap();
}

function geometricallyActivatesDeckDiagnostics(before, after) {
    const scrollDelta = after.scrollY - before.scrollY;
    return (
        scrollDelta < 0 &&
        Number.isFinite(before.activationDistanceAbove) &&
        before.activationDistanceAbove >= MIN_ACTIVATION_DISTANCE &&
        before.activationDistanceAbove + scrollDelta <
            MIN_ACTIVATION_DISTANCE
    ) || (
        scrollDelta > 0 &&
        Number.isFinite(before.activationDistanceBelow) &&
        before.activationDistanceBelow >= MIN_ACTIVATION_DISTANCE &&
        before.activationDistanceBelow - scrollDelta <
            MIN_ACTIVATION_DISTANCE
    );
}

function installNativeRemovalInstrumentationDiagnostics() {
    if (nativeRemovalInstrumentationInstalledDiagnostics) return;
    nativeRemovalInstrumentationInstalledDiagnostics = true;

    const nativeRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
        return recordNativeSectionRemovalDiagnostics(
            "removeChild",
            child,
            () => nativeRemoveChild.call(this, child)
        );
    };

    const nativeRemove = Element.prototype.remove;
    Element.prototype.remove = function () {
        return recordNativeSectionRemovalDiagnostics(
            "remove",
            this,
            () => nativeRemove.call(this)
        );
    };
}

function recordNativeSectionRemovalDiagnostics(
    method,
    element,
    remove
) {
    const probe = currentJumpProbeDiagnostics;
    if (
        probe == null ||
        element?.nodeType !== Node.ELEMENT_NODE ||
        element.tagName !== "SECTION"
    ) {
        return remove();
    }

    const deck = element.closest(
        "[data-turn-id-container][data-is-intersecting]"
    );
    if (deck == null) return remove();

    const { supplyArea, workZone } = environment();
    const deckId = deck.getAttribute("data-turn-id-container");
    const activationBeforeRemoval =
        deck.getAttribute("data-is-intersecting");
    const before = workZonePosition(supplyArea, workZone);
    const clockBefore = performance.now();
    const result = remove();
    const clockAfter = performance.now();
    const after = workZonePosition(supplyArea, workZone);

    probe.sectionRemovalBoundaries.push({
        method,
        phase: probe.phase,
        clockBefore,
        clockAfter,
        scrollYBeforeRemoval: before,
        scrollYAfterRemoval: after,
        deckId,
        activationBeforeRemoval
    });
    return result;
}

function canvasGeometrySnapshotDiagnostics(deck, canvas = null) {
    const { supplyArea, workZone } = environment();
    const scrollY = workZonePosition(supplyArea, workZone);
    const elementGeometry = element => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
            tagName: element.tagName?.toLowerCase() ?? null,
            id: element.id || null,
            className: element.getAttribute?.("class") ?? null,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            documentTop: rect.top + scrollY,
            documentBottom: rect.bottom + scrollY
        };
    };

    return {
        clock: performance.now(),
        activation: deck.getAttribute("data-is-intersecting"),
        scrollY,
        scrollHeight: readSupplyHeight(supplyArea),
        deck: elementGeometry(deck),
        directChildren: Array.from(deck.children).map(elementGeometry),
        section: elementGeometry(
            Array.from(deck.children).find(child =>
                child.matches("section")
            )
        ),
        canvas: elementGeometry(canvas)
    };
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
        drainJumpObserverDiagnostics(probe, "post-command", true);
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
        const { workZone } = environment();
        const scrollYAtDeliveryStart = workZonePosition(
            supplyArea,
            workZone
        );
        deliveredJumpMutationBatchesDiagnostics.push({
            records,
            phase: probe.phase,
            scrollYAtDeliveryStart
        });
    });

    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["data-is-intersecting", "style"]
    });
    return observer;
}

function recordJumpChangesDiagnostics(
    probe,
    records,
    phase,
    scrollYAtDeliveryStart,
    jumpRaf = false,
    stabilizationRaf = null
) {
    if (records.length === 0) return;
    const delivery = ++probe.mutationDeliveryNumber;
    for (const record of records) {
        if (
            record.type === "attributes" &&
            record.attributeName === "style" &&
            record.target.matches?.("[data-turn-id-container]")
        ) {
            const before = lastKnownHeightFromStyleDiagnostics(
                record.oldValue
            );
            const after = record.target.style.getPropertyValue(
                "--last-known-height"
            );
            if (before !== after) {
                const clock = performance.now();
                lastKnownHeightUpdateDiagnostics.set(record.target, {
                    clock,
                    movementJumpNumber: movementJumpNumberDiagnostics,
                    jumpRaf,
                    stabilizationRaf
                });
                probe.renderingChanges.push({
                    delivery,
                    order: ++probe.mutationOrder,
                    clock,
                    phase,
                    jumpRaf,
                    stabilizationRaf,
                    change: "last-known-height",
                    before,
                    after,
                    activation: record.target.getAttribute(
                        "data-is-intersecting"
                    ),
                    renderedHeight:
                        record.target.getBoundingClientRect().height,
                    element: mutationElementDiagnostics(record.target)
                });
            }
            continue;
        }
        if (
            record.type === "attributes" &&
            record.attributeName === "data-is-intersecting"
        ) {
            const before = record.oldValue;
            const after = record.target.getAttribute(
                "data-is-intersecting"
            );
            const deactivated =
                before != null &&
                before !== "false" &&
                (after == null || after === "false");
            const lastKnownHeightUpdate = deactivated
                ? lastKnownHeightUpdateDiagnostics.get(record.target)
                : null;
            const prediction = deactivated
                ? pendingDeactivationPredictionsDiagnostics.get(
                    record.target
                )
                : null;
            if (prediction != null) {
                pendingDeactivationPredictionsDiagnostics.delete(
                    record.target
                );
            }
            probe.activationChanges.push({
                delivery,
                order: ++probe.mutationOrder,
                clock: performance.now(),
                phase,
                scrollYAtMutationDeliveryStart:
                    scrollYAtDeliveryStart,
                deck: snapshotElementDiagnostics(record.target),
                before,
                after,
                predictionElapsedMs: prediction == null
                    ? null
                    : performance.now() - prediction.predictedAt,
                predictionJumpLag: prediction == null
                    ? null
                    : movementJumpNumberDiagnostics -
                        prediction.predictedOnJumpNumber,
                lastKnownHeightUpdateClock:
                    lastKnownHeightUpdate?.clock ?? null,
                lastKnownHeightUpdateJumpLag:
                    lastKnownHeightUpdate == null
                        ? null
                        : movementJumpNumberDiagnostics -
                            lastKnownHeightUpdate.movementJumpNumber,
                lastKnownHeightUpdateJumpRaf:
                    lastKnownHeightUpdate?.jumpRaf ?? false,
                lastKnownHeightUpdateStabilizationRaf:
                    lastKnownHeightUpdate?.stabilizationRaf ?? null,
                jumpRaf,
                stabilizationRaf,
                deckHeightAtPrediction: prediction == null
                    ? null
                    : prediction.deckHeightAtPrediction
            });
            continue;
        }

        if (record.type !== "childList") continue;
        for (const element of record.addedNodes) {
            if (element.nodeType !== Node.ELEMENT_NODE) continue;
            if (element.tagName === "SECTION") {
                probe.activationChanges.push({
                    delivery,
                    order: ++probe.mutationOrder,
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
                delivery,
                order: ++probe.mutationOrder,
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
                    delivery,
                    order: ++probe.mutationOrder,
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
                delivery,
                order: ++probe.mutationOrder,
                clock: performance.now(),
                phase,
                change: "removed",
                element: mutationElementDiagnostics(element)
            });
        }
    }
}

function lastKnownHeightFromStyleDiagnostics(styleText) {
    const style = document.createElement("div").style;
    style.cssText = styleText ?? "";
    return style.getPropertyValue("--last-known-height");
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
