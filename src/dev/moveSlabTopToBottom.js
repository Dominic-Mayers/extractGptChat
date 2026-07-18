import {
   MIN_INTERSECT,
   CALIBRATED_JUMP,
   ACTIVATION_DISTANCE
} from "./constants.js";

import {
    scrollY,
    clientHeight,
    scrollBy
} from "./scrollContainer.js";

import { waitLayoutStable } from "./stabilize.js";
import {
    beginJumpDiagnostics,
    updateJumpDiagnostics,
    finishJumpDiagnostics,
    logSlowJumpDiagnosticsIfNeeded,
    recordCycleStageDiagnostics,
    snapshotElementDiagnostics
} from "./cycleDiagnostics.js";

export async function moveSlabTopToBottom(current, container, direction = -1) {

    let room = measureRoom(current, container, direction);
    let retriedCancelledJump = false;

    while (!isSlabIntersectionAtMinimum(container, room)) {

        const jump = clampJump(CALIBRATED_JUMP, room, container);

        const scrollYBefore = scrollY(container);

        beginJumpDiagnostics({
            roomBefore: room,
            jump,
            scrollYBefore,
            current: snapshotElementDiagnostics(current)
        });

        performJump(jump, container, direction);

        const scrollYAfter = scrollY(container);
        const intendedRoom = measureRoom(current, container, direction);

        if (scrollYAfter === scrollYBefore) {
            finishJumpDiagnostics({
                scrollYAfter,
                intendedRoom,
                obtainedRoom: measureRoom(current, container, direction),
                status: "no-movement"
            });
            logSlowJumpDiagnosticsIfNeeded();
            break;
        }

        const immediateCurrentDiagnostics = snapshotElementDiagnostics(current);

        updateJumpDiagnostics({
            scrollYAfter,
            intendedRoom,
            immediateCurrent: immediateCurrentDiagnostics
        });

        const roomUntilFirstNotReadyDeck =
            measureRoomUntilFirstNotReadyDeck(container, direction);
        const stableFrames = roomUntilFirstNotReadyDeck <= ACTIVATION_DISTANCE
            ? 2
            : 1;

        updateJumpDiagnostics({
            roomUntilFirstNotReadyDeck
        });

        const stabilization = await waitLayoutStable(container, {
            current,
            direction,
            intendedRoom,
            stableFrames
        });

        const settledCurrentDiagnostics = snapshotElementDiagnostics(current);
        const obtainedRoom = measureRoom(current, container, direction);
        finishJumpDiagnostics({
            stabilization,
            obtainedRoom,
            settledCurrent: settledCurrentDiagnostics
        });

        logSlowJumpDiagnosticsIfNeeded();

        if (stabilization.status === "stable-wrong-room") {
            if (obtainedRoom === room && !retriedCancelledJump) {
                retriedCancelledJump = true;
                continue;
            }
            throw new Error(
                `Geometry stabilized at room=${stabilization.room}; ` +
                `expected room=${intendedRoom}.`
            );
        }

        retriedCancelledJump = false;
        room = measureRoom(current, container, direction);
    }

    recordCycleStageDiagnostics("move-result", {
        room,
        current: snapshotElementDiagnostics(current)
    });

    return room;
}

export function clampJump(calibratedJump, room, container) {

    const viewportHeight = clientHeight(container);

    return Math.min(
            calibratedJump,
            (viewportHeight - MIN_INTERSECT) - room
        );
}

export function isSlabIntersectionAtMinimum(container, intendedRoom) {
    return intendedRoom >= clientHeight(container) - MIN_INTERSECT;
}

export function measureRoom(current, container, direction) {

    const viewportHeight = clientHeight(container);
    const rect = current.getBoundingClientRect();

    return direction < 0
        ? rect.top
        : viewportHeight - rect.bottom;
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
