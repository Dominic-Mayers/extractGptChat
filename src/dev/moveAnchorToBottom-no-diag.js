import {
   MIN_INTERSECT,
   TOLERATED_ROUNDING,
   CALIBRATED_JUMP,
   ACTIVATION_DISTANCE
} from "./constants-no-diag.js";
import { waitLayoutStable } from "./stabilize-no-diag.js";
export async function moveAnchorToBottom(
    anchor,
    workZone,
    calibratedJump = CALIBRATED_JUMP
) {

    // At a hard scroll boundary there is no movement to prepare or perform.
    // Skip the movement helper before any movement-related await; its caller
    // continues slab/deck traversal (and, eventually, extraction).
    if (workZone.isAtSupplyBoundary()) {
        const room = workZone.roomAheadOf(anchor);

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

        return room;
    }

    while (!anchorAtBottom) {

        if (workZone.isAtSupplyBoundary()) {

            return room;
        }

        const jump = clampJump(calibratedJump, room, workZone);
        const scrollYBefore = workZone.position;

        workZone.moveBy(jump);

        const scrollYAfter = workZone.position;
        const intendedRoom = workZone.roomAheadOf(anchor);

        if (scrollYAfter === scrollYBefore) {

            break;
        }

        const roomUntilFirstNotReadyDeck =
            measureRoomUntilFirstNotReadyDeck(workZone);
        const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
            ? 2
            : 1;

        const postJumpStabilization = await waitLayoutStable(workZone, {
            current: anchor,
            stableFrames,
            phase: "post-jump"
        });

        const obtainedRoom = workZone.roomAheadOf(anchor);

        const jumpWasErased = obtainedRoom === room;

        if (jumpWasErased && retriedErasedJump) {

            throw new Error(
                `Anchor made no progress after retrying an erased jump ` +
                `at room=${room}.`
            );
        }

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

    const viewportHeight = workZone.height;
    const targetRoom = viewportHeight - MIN_INTERSECT;
    //const atBottom = room >= targetRoom;
    const atBottom = room >= targetRoom - TOLERATED_ROUNDING;

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
