import {
   MIN_INTERSECT,
   TOLERATED_ROUNDING,
   CALIBRATED_JUMP,
   ACTIVATION_DISTANCE
} from "./constants.js";
import {
    scrollY,
    scrollHeight,
    clientHeight,
    scrollBy
} from "./scrollContainer.js";
import { waitLayoutStable } from "./stabilize.js";
import {
    beginJumpDiagnostics,
    beginOrContinueJumpDiagnostics,
    updateJumpDiagnostics,
    finishJumpDiagnostics,
    logSlowJumpDiagnosticsIfNeeded,
    logStabilizedJumpDiagnosticsIfNeeded,
    recordCycleStageDiagnostics,
    selectCurrentJumpDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function moveAnchorToBottom(
    anchor,
    container,
    direction,
    measureAnchorRoom,
    calibratedJump = CALIBRATED_JUMP
) {
    beginJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchor)
    });

    // At a hard scroll boundary there is no movement to prepare or perform.
    // Skip the movement helper before any movement-related await; its caller
    // continues slab/deck traversal (and, eventually, extraction).
    if (isScrollBoundaryReached(container, direction)) {
        const room = measureAnchorRoom(anchor, container, direction);
        finishJumpDiagnostics({
            roomBefore: room,
            obtainedRoom: room,
            scrollYAfter: scrollY(container),
            status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
    }

    let room = measureAnchorRoom(anchor, container, direction);
    let retriedErasedJump = false;

    let anchorAtBottom = measuredAnchorBottomCheck(
        container,
        room,
        "before-first-jump"
    );
    if (anchorAtBottom) {
        finishJumpDiagnostics({
            roomBefore: room,
            obtainedRoom: room,
            status: "already-at-bottom"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
    }

    while (!anchorAtBottom) {
        beginOrContinueJumpDiagnostics({
            kind: "anchor-move",
            anchor: snapshotElementDiagnostics(anchor)
        });

        if (isScrollBoundaryReached(container, direction)) {
            finishJumpDiagnostics({
                roomBefore: room,
                obtainedRoom: room,
                scrollYAfter: scrollY(container),
                status: "movement-impossible"
            });
            logSlowJumpDiagnosticsIfNeeded();
            return room;
        }

        const jump = clampJump(calibratedJump, room, container);
        const scrollYBefore = scrollY(container);

        beginOrContinueJumpDiagnostics({
            kind: "anchor-move",
            anchor: snapshotElementDiagnostics(anchor),
            roomBefore: room,
            jump,
            scrollYBefore
        });

        performJump(jump, container, direction);

        const scrollYAfter = scrollY(container);
        const intendedRoom = measureAnchorRoom(anchor, container, direction);

        if (scrollYAfter === scrollYBefore) {
            finishJumpDiagnostics({
                scrollYAfter,
                intendedRoom,
                obtainedRoom: measureAnchorRoom(anchor, container, direction),
                status: "no-movement"
            });
            logSlowJumpDiagnosticsIfNeeded();
            break;
        }

        updateJumpDiagnostics({
            scrollYAfter,
            intendedRoom,
            immediateAnchor: snapshotElementDiagnostics(anchor)
        });

        const roomUntilFirstNotReadyDeck =
            measureRoomUntilFirstNotReadyDeck(container, direction);
        const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
            ? 2
            : 1;

        updateJumpDiagnostics({ roomUntilFirstNotReadyDeck });

        const postJumpStabilization = await waitLayoutStable(container, {
            current: anchor,
            direction,
            stableFrames,
            measureReferenceRoom: measureAnchorRoom,
            phase: "post-jump"
        });

        const obtainedRoom = measureAnchorRoom(anchor, container, direction);
        finishJumpDiagnostics({
            postJumpStabilization,
            obtainedRoom,
            settledAnchor: snapshotElementDiagnostics(anchor)
        });

        logStabilizedJumpDiagnosticsIfNeeded();

        const jumpWasErased = obtainedRoom === room;

        if (jumpWasErased && retriedErasedJump) {
            selectCurrentJumpDiagnostics("erased-jump-retry-failed");
            throw new Error(
                `Anchor made no progress after retrying an erased jump ` +
                `at room=${room}.`
            );
        }

        selectCurrentJumpDiagnostics(
            jumpWasErased
                ? "erased-jump"
                : retriedErasedJump
                    ? "erased-jump-retry-succeeded"
                    : null
        );

        retriedErasedJump = jumpWasErased;
        room = obtainedRoom;
        anchorAtBottom = measuredAnchorBottomCheck(
            container,
            room,
            "after-post-jump-stabilization"
        );
    }

    return room;
}

function measuredAnchorBottomCheck(container, room, phase) {
    const startedAt = performance.now();
    const startedWallAt = Date.now();
    const viewportHeight = clientHeight(container);
    const targetRoom = viewportHeight - MIN_INTERSECT;
    //const atBottom = room >= targetRoom;
    const atBottom = room >= targetRoom - TOLERATED_ROUNDING;
    recordCycleStageDiagnostics("anchor-bottom-check", {
        phase,
        elapsedMs: performance.now() - startedAt,
        wallElapsedMs: Date.now() - startedWallAt,
        room,
        viewportHeight,
        targetRoom,
        toleratedRounding: TOLERATED_ROUNDING,
        atBottom
    });
    return atBottom;
}

export function clampJump(calibratedJump, room, container) {
    return Math.min(
        calibratedJump,
        (clientHeight(container) - MIN_INTERSECT) - room
    );
}

export function isAnchorAtBottom(container, room) {
    const targetRoom = clientHeight(container) - MIN_INTERSECT;
    //return room >= targetRoom;
    return room >= targetRoom - TOLERATED_ROUNDING;
}

export function isScrollBoundaryReached(container, direction) {
    const position = scrollY(container);
    return direction < 0
        ? position <= 0
        : position >= scrollHeight(container) - clientHeight(container);
}

export function performJump(jump, container, direction) {
    scrollBy(container, jump * direction);
}

export function measureRoomUntilFirstNotReadyDeck(container, direction) {
    const viewportTop = container === document.documentElement
        ? 0
        : container.getBoundingClientRect().top;
    const viewportBoundary = direction < 0
        ? viewportTop
        : viewportTop + clientHeight(container);
    let roomUntilFirstNotReadyDeck = Infinity;

    for (const deck of document.querySelectorAll(
        '[data-turn-id-container][data-is-intersecting="false"]'
    )) {
        const rect = deck.getBoundingClientRect();
        const isAhead = direction < 0
            ? rect.top < viewportBoundary
            : rect.bottom > viewportBoundary;
        if (!isAhead) continue;
        const roomUntilDeck = direction < 0
            ? viewportBoundary - rect.bottom
            : rect.top - viewportBoundary;
        roomUntilFirstNotReadyDeck = Math.min(
            roomUntilFirstNotReadyDeck,
            roomUntilDeck
        );
    }

    return roomUntilFirstNotReadyDeck;
}
