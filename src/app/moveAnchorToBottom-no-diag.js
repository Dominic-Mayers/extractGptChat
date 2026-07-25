import {

    MIN_INTERSECT,
    TOLERATED_ROUNDING,
    CALIBRATED_JUMP
} from "./constants-no-diag.js";
import {
    anchorRoom,
    moveWorkZoneBy,
    supplyRoom
} from "./supplyWorker-no-diag.js";
import { waitLayoutStable } from "./waitLayoutStable-no-diag.js";
export async function moveAnchorToBottom(
    initialRoom,
    viewportHeight,
    calibratedJump = CALIBRATED_JUMP
) {

    const currentSupplyRoom = supplyRoom();

    if (currentSupplyRoom <= 0) {

        return initialRoom;
    }

    let room = initialRoom;
    let retriedErasedJump = false;

    let anchorAtBottom = isAnchorAtBottom(viewportHeight, room);
    if (anchorAtBottom) {

        return room;
    }

    while (!anchorAtBottom) {

        const supplyRoomBefore = supplyRoom();

        if (supplyRoomBefore <= 0) {

            return room;
        }

        const jump = clampJump(calibratedJump, room, viewportHeight);
        moveWorkZoneBy(jump);
        const supplyRoomAfter = supplyRoom();

        if (supplyRoomAfter === supplyRoomBefore) {

            break;
        }

        await waitLayoutStable({ trackAnchor: true });

        const obtainedRoom = anchorRoom();

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
