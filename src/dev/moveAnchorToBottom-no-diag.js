import {
   MIN_INTERSECT,
   TOLERATED_ROUNDING,
   CALIBRATED_JUMP,
   ACTIVATION_DISTANCE
} from "./constants-no-diag.js";
import {
    scrollY,
    scrollHeight,
    clientHeight,
    scrollBy
} from "./scrollContainer-no-diag.js";
import { waitLayoutStable } from "./stabilize-no-diag.js";
export async function moveAnchorToBottom(
    anchor,
    container,
    direction,
    measureAnchorRoom,
    calibratedJump = CALIBRATED_JUMP
) {

    // At a hard scroll boundary there is no movement to prepare or perform.
    // Skip the movement helper before any movement-related await; its caller
    // continues slab/deck traversal (and, eventually, extraction).
    if (isScrollBoundaryReached(container, direction)) {
        const room = measureAnchorRoom(anchor, container, direction);

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

        return room;
    }

    while (!anchorAtBottom) {

        if (isScrollBoundaryReached(container, direction)) {

            return room;
        }

        const jump = clampJump(calibratedJump, room, container);
        const scrollYBefore = scrollY(container);

        performJump(jump, container, direction);

        const scrollYAfter = scrollY(container);
        const intendedRoom = measureAnchorRoom(anchor, container, direction);

        if (scrollYAfter === scrollYBefore) {

            break;
        }

        const roomUntilFirstNotReadyDeck =
            measureRoomUntilFirstNotReadyDeck(container, direction);
        const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
            ? 2
            : 1;

        const postJumpStabilization = await waitLayoutStable(container, {
            current: anchor,
            direction,
            stableFrames,
            measureReferenceRoom: measureAnchorRoom,
            phase: "post-jump"
        });

        const obtainedRoom = measureAnchorRoom(anchor, container, direction);

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
