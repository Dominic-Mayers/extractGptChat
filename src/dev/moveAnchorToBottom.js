import {
   MIN_INTERSECT,
   TOLERATED_ROUNDING,
   CALIBRATED_JUMP,
   ACTIVATION_DISTANCE
} from "./constants.js";
import { waitLayoutStable } from "./stabilize.js";
import {
    elementsIn,
    isAtSupplyBoundary,
    moveWorkZone,
    roomAhead,
    workZonePosition,
    workZoneTop
} from "./scrollContainer.js";
import {
    beginJumpDiagnostics,
    beginOrContinueJumpDiagnostics,
    updateJumpDiagnostics,
    finishJumpDiagnostics,
    logSlowJumpDiagnosticsIfNeeded,
    logStabilizedJumpDiagnosticsIfNeeded,
    selectCurrentJumpDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function moveAnchorToBottom(
    anchor,
    supplier,
    calibratedJump = CALIBRATED_JUMP
) {
    const { supplyArea, activeArea, workZone } = supplier;
    beginJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchor)
    });

    // At a hard scroll boundary there is no movement to prepare or perform.
    // Skip the movement helper before any movement-related await; its caller
    // continues slab/deck traversal (and, eventually, extraction).
    if (isAtSupplyBoundary(supplyArea, workZone)) {
        const room = roomAhead(anchor, workZone);
        finishJumpDiagnostics({
            roomBefore: room,
            obtainedRoom: room,
            scrollYAfter: workZonePosition(supplyArea, workZone),
            status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
    }

    let room = roomAhead(anchor, workZone);
    let retriedErasedJump = false;

    let anchorAtBottom = isAnchorAtBottom(workZone, room);
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

        if (isAtSupplyBoundary(supplyArea, workZone)) {
            finishJumpDiagnostics({
                roomBefore: room,
                obtainedRoom: room,
                scrollYAfter: workZonePosition(supplyArea, workZone),
                status: "movement-impossible"
            });
            logSlowJumpDiagnosticsIfNeeded();
            return room;
        }

        const jump = clampJump(calibratedJump, room, workZone);
        const scrollYBefore = workZonePosition(supplyArea, workZone);

        beginOrContinueJumpDiagnostics({
            kind: "anchor-move",
            anchor: snapshotElementDiagnostics(anchor),
            roomBefore: room,
            jump,
            scrollYBefore
        });

        moveWorkZone(jump, supplyArea, workZone);

        const scrollYAfter = workZonePosition(supplyArea, workZone);

        if (scrollYAfter === scrollYBefore) {
            finishJumpDiagnostics({
                scrollYAfter,
                obtainedRoom: roomAhead(anchor, workZone),
                status: "no-movement"
            });
            logSlowJumpDiagnosticsIfNeeded();
            break;
        }

        updateJumpDiagnostics({
            scrollYAfter,
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

        const obtainedRoom = roomAhead(anchor, workZone);
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
        anchorAtBottom = isAnchorAtBottom(workZone, room);
    }

    return room;
}

export function clampJump(calibratedJump, room, workZone) {
    return Math.min(
        calibratedJump,
        (workZone.height - MIN_INTERSECT) - room
    );
}

export function isAnchorAtBottom(workZone, room) {
    const targetRoom = workZone.height - MIN_INTERSECT;
    return room >= targetRoom - TOLERATED_ROUNDING;
}

export function measureRoomUntilFirstNotReadyDeck(activeArea, workZone) {
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
