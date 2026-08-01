import {

    MIN_INTERSECT,
    TOLERATED_ROUNDING,
    CALIBRATED_JUMP
} from "./constants-diag.js";
import {
    anchorRoom,
    checkUpdateNeededBeforeDeactivation,
    moveWorkZoneBy,
    pendingDeactivationPredictionSnapshotDiagnostics,
    slabRoom,
    supplyRoom
} from "./supplyWorker-diag.js";
import { waitLayoutStable } from "./waitLayoutStable-diag.js";
import {
    beginJumpDiagnostics,
    beginOrContinueJumpDiagnostics,
    discardCurrentJumpProbeDiagnostics,
    finishJumpDiagnostics,
    logSlowJumpDiagnosticsIfNeeded,
    logStabilizedJumpDiagnosticsIfNeeded,
    recordErasedJumpResultDiagnostics,
    recordPendingDeactivationPredictionsForJumpDiagnostics
} from "./cycleDiagnostics-diag.js";

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
        const pendingPredictionsAtJumpStartDiagnostics =
            pendingDeactivationPredictionSnapshotDiagnostics();
        const predictedDeactivationDecks =
            await checkUpdateNeededBeforeDeactivation(jump);
        const pendingPredictionsBeforeCommandDiagnostics =
            pendingDeactivationPredictionSnapshotDiagnostics();
        recordPendingDeactivationPredictionsForJumpDiagnostics({
            atJumpStart: pendingPredictionsAtJumpStartDiagnostics,
            beforeCommand: pendingPredictionsBeforeCommandDiagnostics,
            geometricallyPredictedDeckCount:
                predictedDeactivationDecks.length
        });
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
