import {

    MIN_INTERSECT,
    TOLERATED_ROUNDING,
    CALIBRATED_JUMP
} from "./constants.js";
import {
    anchorRoom,
    checkUpdateNeededBeforeDeactivation,
    moveWorkZoneBy,
    supplyRoom
} from "./supplyWorker.js";
import { waitLayoutStable } from "./waitLayoutStable.js";
import {
    beginJumpDiagnostics,
    beginOrContinueJumpDiagnostics,
    finishJumpDiagnostics,
    logSlowJumpDiagnosticsIfNeeded,
    logStabilizedJumpDiagnosticsIfNeeded,
    selectCurrentJumpDiagnostics
} from "./cycleDiagnostics.js";

export async function moveAnchorToBottom(
    initialRoom,
    viewportHeight,
    calibratedJump = CALIBRATED_JUMP
) {
    beginJumpDiagnostics({
        kind: "anchor-move"
    });

    const currentSupplyRoom = supplyRoom();

    if (currentSupplyRoom <= 0) {
        finishJumpDiagnostics({
            roomBefore: initialRoom,
            obtainedRoom: initialRoom,
            scrollYAfter: currentSupplyRoom,
            status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return initialRoom;
    }

    let room = initialRoom;
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

        const supplyRoomBefore = supplyRoom();

        if (supplyRoomBefore <= 0) {
            finishJumpDiagnostics({
                roomBefore: room,
                obtainedRoom: room,
                scrollYAfter: supplyRoomBefore,
                status: "movement-impossible"
            });
            logSlowJumpDiagnosticsIfNeeded();
            return room;
        }

        const jump = clampJump(calibratedJump, room, viewportHeight);
        beginOrContinueJumpDiagnostics({
            requestedJump: jump,
            calibratedJump,
            viewportHeight
        });
        await checkUpdateNeededBeforeDeactivation(jump);
        moveWorkZoneBy(jump);
        const supplyRoomAfter = supplyRoom();

        if (supplyRoomAfter === supplyRoomBefore) {
            finishJumpDiagnostics({
                scrollYAfter: supplyRoomAfter,
                obtainedRoom: anchorRoom(),
                status: "no-movement"
            });
            logSlowJumpDiagnosticsIfNeeded();
            break;
        }

        await waitLayoutStable({ trackAnchor: true });

        const obtainedRoom = anchorRoom();
        finishJumpDiagnostics({
            obtainedRoom
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
