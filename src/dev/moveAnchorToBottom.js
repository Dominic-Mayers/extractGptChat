import {
    MIN_INTERSECT,
    TOLERATED_ROUNDING,
    CALIBRATED_JUMP
} from "./constants.js";
import {
    anchorMovementGeometry,
    moveAndStabilize
} from "./supplyWorker.js";
import {
    beginJumpDiagnostics,
    beginOrContinueJumpDiagnostics,
    finishJumpDiagnostics,
    logSlowJumpDiagnosticsIfNeeded,
    logStabilizedJumpDiagnosticsIfNeeded,
    selectCurrentJumpDiagnostics
} from "./cycleDiagnostics.js";

export async function moveAnchorToBottom(
    anchorRoom,
    viewportHeight,
    calibratedJump = CALIBRATED_JUMP
) {
    beginJumpDiagnostics({
        kind: "anchor-move"
    });

    let movement = anchorMovementGeometry();

    if (movement.supplyRoom <= 0) {
        finishJumpDiagnostics({
            roomBefore: anchorRoom,
            obtainedRoom: anchorRoom,
            scrollYAfter: movement.supplyRoom,
            status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return anchorRoom;
    }

    let room = anchorRoom;
    let retriedErasedJump = false;

    let anchorAtBottom = isAnchorAtBottom(viewportHeight, room);
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
            roomBefore: room
        });

        movement = anchorMovementGeometry();

        if (movement.supplyRoom <= 0) {
            finishJumpDiagnostics({
                roomBefore: room,
                obtainedRoom: room,
                scrollYAfter: movement.supplyRoom,
                status: "movement-impossible"
            });
            logSlowJumpDiagnosticsIfNeeded();
            return room;
        }

        const jump = clampJump(calibratedJump, room, viewportHeight);
        const result = await moveAndStabilize(jump);

        if (result.supplyRoomAfter === result.supplyRoomBefore) {
            logSlowJumpDiagnosticsIfNeeded();
            break;
        }

        logStabilizedJumpDiagnosticsIfNeeded();

        const obtainedRoom = result.anchorRoom;
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
        anchorAtBottom = isAnchorAtBottom(viewportHeight, room);
    }

    return room;
}

export function clampJump(calibratedJump, room, viewportHeight) {
    return Math.min(
        calibratedJump,
        (viewportHeight - MIN_INTERSECT) - room
    );
}

export function isAnchorAtBottom(viewportHeight, room) {
    const targetRoom = viewportHeight - MIN_INTERSECT;
    return room >= targetRoom - TOLERATED_ROUNDING;
}
