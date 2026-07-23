import {
    MIN_INTERSECT,
    TOLERATED_ROUNDING,
    CALIBRATED_JUMP
} from "./constants-no-diag.js";
import {
    anchorMovementGeometry,
    moveAndStabilize
} from "./supplyWorker-no-diag.js";
export async function moveAnchorToBottom(
    anchorRoom,
    viewportHeight,
    calibratedJump = CALIBRATED_JUMP
) {

    let movement = anchorMovementGeometry();

    if (movement.supplyRoom <= 0) {

        return anchorRoom;
    }

    let room = anchorRoom;
    let retriedErasedJump = false;

    let anchorAtBottom = isAnchorAtBottom(viewportHeight, room);
    if (anchorAtBottom) {

        return room;
    }

    while (!anchorAtBottom) {

        movement = anchorMovementGeometry();

        if (movement.supplyRoom <= 0) {

            return room;
        }

        const jump = clampJump(calibratedJump, room, viewportHeight);
        const result = await moveAndStabilize(jump);

        if (result.supplyRoomAfter === result.supplyRoomBefore) {

            break;
        }

        const obtainedRoom = result.anchorRoom;
        const jumpWasErased = obtainedRoom === room;

        if (jumpWasErased && retriedErasedJump) {

            throw new Error(
                `Anchor made no progress after retrying an erased jump ` +
                `at room=${room}.`
            );
        }

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
