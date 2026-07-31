import {

    MIN_INTERSECT,
    TOLERATED_ROUNDING,
    CALIBRATED_JUMP
} from "./constants-dev.js";
import {
    anchorRoom,
    checkUpdateNeededBeforeDeactivation,
    moveWorkZoneBy,
    slabRoom,
    supplyRoom
} from "./supplyWorker-dev.js";
import { waitLayoutStable } from "./waitLayoutStable-dev.js";
import {
    beginJumpDiagnostics,
    beginOrContinueJumpDiagnostics,
    discardCurrentJumpProbeDiagnostics,
    finishJumpDiagnostics,
    logSlowJumpDiagnosticsIfNeeded,
    logStabilizedJumpDiagnosticsIfNeeded,
    recordErasedJumpResultDiagnostics
} from "./cycleDiagnostics-dev.js";

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
            anchorRoomBefore: initialRoom,
            obtainedAnchorRoom: initialRoom,
            scrollYAfter: currentSupplyRoom,
            status: "movement-impossible"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return initialRoom;
    }

    let room = initialRoom;
    let currentSlabRoom = slabRoom();
    let retriedErasedJump = false;

    let anchorAtBottom = isAtBottom(viewportHeight, room);
    let slabTopAtBottom = isAtBottom(
        viewportHeight,
        currentSlabRoom
    );
    if (anchorAtBottom || slabTopAtBottom) {
        finishJumpDiagnostics({
            anchorRoomBefore: room,
            obtainedAnchorRoom: room,
            status: "already-at-bottom"
        });
        logSlowJumpDiagnosticsIfNeeded();
        return room;
    }

    while (!anchorAtBottom && !slabTopAtBottom) {
        beginOrContinueJumpDiagnostics({
            kind: "anchor-move",
            anchorRoomBefore: room
        });

        const supplyRoomBefore = supplyRoom();

        if (supplyRoomBefore <= 0) {
            finishJumpDiagnostics({
                anchorRoomBefore: room,
                obtainedAnchorRoom: room,
                scrollYAfter: supplyRoomBefore,
                status: "movement-impossible"
            });
            logSlowJumpDiagnosticsIfNeeded();
            return room;
        }

        const jump = clampJump(
            calibratedJump,
            room,
            currentSlabRoom,
            viewportHeight
        );
        beginOrContinueJumpDiagnostics({
            requestedJump: jump,
            calibratedJump,
            viewportHeight
        });
        const deactivationPredicted =
            await checkUpdateNeededBeforeDeactivation(jump);
        await moveWorkZoneBy(jump);
        const supplyRoomAfter = supplyRoom();

        if (supplyRoomAfter === supplyRoomBefore) {
            finishJumpDiagnostics({
                scrollYAfter: supplyRoomAfter,
                obtainedAnchorRoom: anchorRoom(),
                status: "no-movement"
            });
            discardCurrentJumpProbeDiagnostics();
            logSlowJumpDiagnosticsIfNeeded();
            break;
        }

        await waitLayoutStable({ trackAnchor: true });
        if (deactivationPredicted) {
            if (typeof globalThis.gc !== "function") {
                throw new Error(
                    "GC is unavailable. Launch Chromium with --expose-gc."
                );
            }
            globalThis.gc();
        }

        const obtainedRoom = anchorRoom();
        finishJumpDiagnostics({
            obtainedAnchorRoom: obtainedRoom
        });
        logStabilizedJumpDiagnosticsIfNeeded();

        const jumpWasErased = obtainedRoom === room;

        recordErasedJumpResultDiagnostics(
            jumpWasErased,
            retriedErasedJump
        );

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
        slabTopAtBottom = isAtBottom(
            viewportHeight,
            currentSlabRoom
        );
    }

    return room;
}

export function clampJump(
    calibratedJump,
    anchorRoom,
    slabTopRoom,
    viewportHeight
) {
    const targetRoom = viewportHeight - MIN_INTERSECT;
    return Math.min(
        calibratedJump,
        targetRoom - anchorRoom,
        targetRoom - slabTopRoom
    );
}

export function isAtBottom(viewportHeight, room) {
    const targetRoom = viewportHeight - MIN_INTERSECT;
    return room >= targetRoom - TOLERATED_ROUNDING;
}
