import {
   MIN_INTERSECT,
   CALIBRATED_JUMP,
   ACTIVATION_DISTANCE
} from "./constants.js";
import {
    scrollY,
    scrollHeight,
    clientHeight,
    scrollBy
} from "./scrollContainer.js";
import { nextAnimationFrame, waitLayoutStable } from "./stabilize.js";
import {
    beginJumpDiagnostics,
    beginOrContinueJumpDiagnostics,
    beginBeforeJumpRafDiagnostics,
    finishBeforeJumpRafDiagnostics,
    updateJumpDiagnostics,
    finishJumpDiagnostics,
    logSlowJumpDiagnosticsIfNeeded,
    logStabilizedJumpDiagnosticsIfNeeded,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function moveAnchorToBottom(
    anchor,
    container,
    direction,
    measureAnchorRoom,
    calibratedJump = CALIBRATED_JUMP
) {
    beginJumpDiagnostics({
        kind: "anchor-move",
        anchor: snapshotElementDiagnostics(anchor)
    });

    // At a hard scroll boundary there is no movement to prepare or perform.
    // Skip the movement helper before any movement-related await; its caller
    // continues slab/deck traversal (and, eventually, extraction).
    if (isScrollBoundaryReached(container, direction)) {
        const room = measureAnchorRoom(anchor, container, direction);
        finishJumpDiagnostics({
            roomBefore: room,
            obtainedRoom: room,
            scrollYAfter: scrollY(container),
            status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
    }

    await waitLayoutStable(container, {
        current: anchor,
        direction,
        measureReferenceRoom: measureAnchorRoom,
        phase: "pre-anchor-move"
    });

    let room = measureAnchorRoom(anchor, container, direction);
    let retriedCancelledJump = false;

    if (isAnchorAtBottom(container, room)) {
        finishJumpDiagnostics({
            roomBefore: room,
            obtainedRoom: room,
            status: "already-at-bottom"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
    }

    while (!isAnchorAtBottom(container, room)) {
        beginOrContinueJumpDiagnostics({
            kind: "anchor-move",
            anchor: snapshotElementDiagnostics(anchor)
        });

        // Do not wait for the experimental pre-perform frame when the
        // requested movement is already impossible. Returning the unchanged
        // room skips this movement only; the slab/deck traversal decides what
        // to do next.
        if (isScrollBoundaryReached(container, direction)) {
            finishJumpDiagnostics({
                roomBefore: room,
                obtainedRoom: room,
                scrollYAfter: scrollY(container),
                status: "movement-impossible"
            });
            logSlowJumpDiagnosticsIfNeeded();
            return room;
        }

        beginBeforeJumpRafDiagnostics();
        await nextAnimationFrame();
        finishBeforeJumpRafDiagnostics();

        // The frame may have changed the anchor geometry. Base the jump on the
        // geometry observed immediately before it, rather than on the room
        // carried over from the preceding stabilization.
        room = measureAnchorRoom(anchor, container, direction);
        if (isAnchorAtBottom(container, room)) break;

        const jump = clampJump(calibratedJump, room, container);
        const scrollYBefore = scrollY(container);

        beginOrContinueJumpDiagnostics({
            kind: "anchor-move",
            anchor: snapshotElementDiagnostics(anchor),
            roomBefore: room,
            jump,
            scrollYBefore
        });

        performJump(jump, container, direction);

        const scrollYAfter = scrollY(container);
        const intendedRoom = measureAnchorRoom(anchor, container, direction);

        if (scrollYAfter === scrollYBefore) {
            finishJumpDiagnostics({
                scrollYAfter,
                intendedRoom,
                obtainedRoom: measureAnchorRoom(anchor, container, direction),
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
            measureRoomUntilFirstNotReadyDeck(container, direction);
        const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
            ? 2
            : 1;

        updateJumpDiagnostics({ roomUntilFirstNotReadyDeck });

        const stabilization = await waitLayoutStable(container, {
            current: anchor,
            direction,
            stableFrames,
            measureReferenceRoom: measureAnchorRoom,
            phase: "post-jump"
        });

        const obtainedRoom = measureAnchorRoom(anchor, container, direction);
        finishJumpDiagnostics({
            stabilization,
            obtainedRoom,
            settledAnchor: snapshotElementDiagnostics(anchor)
        });

        logStabilizedJumpDiagnosticsIfNeeded();

        if (obtainedRoom === room && retriedCancelledJump) {
            throw new Error(
                `Anchor made no progress after retrying a cancelled jump ` +
                `at room=${room}.`
            );
        }

        retriedCancelledJump = obtainedRoom === room;
        room = obtainedRoom;
    }

    return room;
}

export function clampJump(calibratedJump, room, container) {
    return Math.min(
        calibratedJump,
        (clientHeight(container) - MIN_INTERSECT) - room
    );
}

export function isAnchorAtBottom(container, room) {
    return room >= clientHeight(container) - MIN_INTERSECT;
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
