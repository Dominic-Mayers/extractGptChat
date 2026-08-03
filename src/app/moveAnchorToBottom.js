import {
    MIN_INTERSECT,
    TOLERATED_ROUNDING,
    CALIBRATED_JUMP
} from "./constants.js";
import {
    anchorRoom,
    checkUpdateNeededBeforeDeactivation,
    moveWorkZoneBy,
    slabRoom,
    supplyRoom
} from "./supplyWorker.js";
import {
    waitLayoutStable
} from "./waitLayoutStable.js";

export async function moveAnchorToBottom(
    initialRoom,
    viewportHeight,
    calibratedJump = CALIBRATED_JUMP,
    slabDestination = -MIN_INTERSECT
) {

    const currentSupplyRoom = supplyRoom();

    if (currentSupplyRoom <= 0) {

        return initialRoom;
    }

    let room = initialRoom;
    let currentSlabRoom = slabRoom();
    let retriedErasedJump = false;

    let anchorAtBottom = isAtBottom(viewportHeight, room);
    let slabAtDestination = isAtDestination(
        slabDestination,
        currentSlabRoom
    );
    if (anchorAtBottom || slabAtDestination) {

        return room;
    }

    while (!anchorAtBottom && !slabAtDestination) {

        const supplyRoomBefore = supplyRoom();

        if (supplyRoomBefore <= 0) {

            return room;
        }

        const jump = clampJump(
            calibratedJump,
            room,
            currentSlabRoom,
            viewportHeight,
            slabDestination
        );

        const predictedDeactivationDecks =
            await checkUpdateNeededBeforeDeactivation(jump);

        await moveWorkZoneBy(jump);
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
        currentSlabRoom = slabRoom();
        anchorAtBottom = isAtBottom(viewportHeight, room);
        slabAtDestination = isAtDestination(
            slabDestination,
            currentSlabRoom
        );
    }

    return room;
}

export function clampJump(
    calibratedJump,
    anchorRoom,
    slabTopRoom,
    viewportHeight,
    slabDestination = -MIN_INTERSECT
) {
    const targetRoom = viewportHeight - MIN_INTERSECT;
    return Math.min(
        calibratedJump,
        targetRoom - anchorRoom,
        slabDestination - slabTopRoom
    );
}

export function isAtBottom(viewportHeight, room) {
    const targetRoom = viewportHeight - MIN_INTERSECT;
    return isAtDestination(targetRoom, room);
}

export function isAtDestination(destination, room) {
    return room >= destination - TOLERATED_ROUNDING;
}
