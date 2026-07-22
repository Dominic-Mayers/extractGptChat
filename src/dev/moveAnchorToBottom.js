import {
   MIN_INTERSECT,
   TOLERATED_ROUNDING,
   CALIBRATED_JUMP,
   ACTIVATION_DISTANCE
} from "./constants.js";
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
    workZone,
    calibratedJump = CALIBRATED_JUMP
) {
    beginJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchor)
    });

    // At a hard scroll boundary there is no movement to prepare or perform.
    // Skip the movement helper before any movement-related await; its caller
    // continues slab/deck traversal (and, eventually, extraction).
    if (workZone.isAtSupplyBoundary()) {
        const room = workZone.roomAheadOf(anchor);
        finishJumpDiagnostics({
            roomBefore: room,
            obtainedRoom: room,
            scrollYAfter: workZone.position,
            status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
    }

    let room = workZone.roomAheadOf(anchor);
    let retriedErasedJump = false;

    let anchorAtBottom = measuredAnchorBottomCheck(
        workZone,
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

        if (workZone.isAtSupplyBoundary()) {
            finishJumpDiagnostics({
                roomBefore: room,
                obtainedRoom: room,
                scrollYAfter: workZone.position,
                status: "movement-impossible"
            });
            logSlowJumpDiagnosticsIfNeeded();
            return room;
        }

        const jump = clampJump(calibratedJump, room, workZone);
        const scrollYBefore = workZone.position;

        beginOrContinueJumpDiagnostics({
            kind: "anchor-move",
            anchor: snapshotElementDiagnostics(anchor),
            roomBefore: room,
            jump,
            scrollYBefore
        });

        workZone.moveBy(jump);

        const scrollYAfter = workZone.position;
        const intendedRoom = workZone.roomAheadOf(anchor);

        if (scrollYAfter === scrollYBefore) {
            finishJumpDiagnostics({
                scrollYAfter,
                intendedRoom,
                obtainedRoom: workZone.roomAheadOf(anchor),
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
            measureRoomUntilFirstNotReadyDeck(workZone);
        const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
            ? 2
            : 1;

        updateJumpDiagnostics({ roomUntilFirstNotReadyDeck });

        const postJumpStabilization = await waitLayoutStable(workZone, {
            current: anchor,
            stableFrames,
            phase: "post-jump"
        });

        const obtainedRoom = workZone.roomAheadOf(anchor);
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
            workZone,
            room,
            "after-post-jump-stabilization"
        );
    }

    return room;
}

function measuredAnchorBottomCheck(workZone, room, phase) {
    const startedAtDiagnostics = performance.now();
    const startedWallAtDiagnostics = Date.now();
    const viewportHeight = workZone.height;
    const targetRoom = viewportHeight - MIN_INTERSECT;
    //const atBottom = room >= targetRoom;
    const atBottom = room >= targetRoom - TOLERATED_ROUNDING;
    recordCycleStageDiagnostics("anchor-bottom-check", {
        phase,
        elapsedMs: performance.now() - startedAtDiagnostics,
        wallElapsedMs: Date.now() - startedWallAtDiagnostics,
        room,
        viewportHeight,
        targetRoom,
        toleratedRounding: TOLERATED_ROUNDING,
        atBottom
    });
    return atBottom;
}

export function clampJump(calibratedJump, room, workZone) {
    return Math.min(
        calibratedJump,
        (workZone.height - MIN_INTERSECT) - room
    );
}

export function isAnchorAtBottom(workZone, room) {
    const targetRoom = workZone.height - MIN_INTERSECT;
    //return room >= targetRoom;
    return room >= targetRoom - TOLERATED_ROUNDING;
}

export function measureRoomUntilFirstNotReadyDeck(workZone) {
    const viewportBoundary = workZone.top;
    let roomUntilFirstNotReadyDeck = Infinity;

    for (const deck of document.querySelectorAll(
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
