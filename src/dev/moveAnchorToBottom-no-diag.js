import {
   MIN_INTERSECT,
   TOLERATED_ROUNDING,
   CALIBRATED_JUMP,
   ACTIVATION_DISTANCE
} from "./constants-no-diag.js";
import { waitLayoutStable } from "./stabilize-no-diag.js";
import {
    elementsIn,
    isAtSupplyBoundary,
    moveWorkZone,
    roomAhead,
    workZonePosition,
    workZoneTop
} from "./scrollContainer-no-diag.js";
export async function moveAnchorToBottom(
    anchor,
    supplier,
    calibratedJump = CALIBRATED_JUMP
) {
    const { supplyArea, activeArea, workZone } = supplier;

    // At a hard scroll boundary there is no movement to prepare or perform.
    // Skip the movement helper before any movement-related await; its caller
    // continues slab/deck traversal (and, eventually, extraction).
    if (isAtSupplyBoundary(supplyArea, workZone)) {
        const room = roomAhead(anchor, workZone);

        return room;
    }

    let room = roomAhead(anchor, workZone);
    let retriedErasedJump = false;

    let anchorAtBottom = isAnchorAtBottom(workZone, room);
    if (anchorAtBottom) {

        return room;
    }

    while (!anchorAtBottom) {

        if (isAtSupplyBoundary(supplyArea, workZone)) {

            return room;
        }

        const jump = clampJump(calibratedJump, room, workZone);
        const scrollYBefore = workZonePosition(supplyArea, workZone);

        moveWorkZone(jump, supplyArea, workZone);

        const scrollYAfter = workZonePosition(supplyArea, workZone);

        if (scrollYAfter === scrollYBefore) {

            break;
        }

        const roomUntilFirstNotReadyDeck =
            measureRoomUntilFirstNotReadyDeck(activeArea, workZone);
        const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
            ? 2
            : 1;

        const postJumpStabilization = await waitLayoutStable(
            supplyArea,
            workZone,
            {
                current: anchor,
                stableFrames
            }
        );

        const obtainedRoom = roomAhead(anchor, workZone);

        const jumpWasErased = obtainedRoom === room;

        if (jumpWasErased && retriedErasedJump) {

            throw new Error(
                `Anchor made no progress after retrying an erased jump ` +
                `at room=${room}.`
            );
        }

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
