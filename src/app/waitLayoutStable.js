import {
    MIN_ACTIVATION_DISTANCE,
    TOLERATED_ROUNDING,
    MAX_FRAMES_FOR_STABILIZATION,
    MAX_STABLE_RAF_DELAY,
    MAX_IGNORED_FRAMES
} from "./constants.js";
import {
    anchorRoom,
    roomUntilFirstActiveDeckBelow,
    roomUntilFirstNotReadyDeck,
    saveDeckActivationStatus,
    performSplitExtraJump,
    deckActivationTransitions,
    supplyHeight,
    supplyRoom,
    thresholdDeckSnapshot
} from "./supplyWorker.js";

import {
    nextAnimationFrame
} from "./scrollContainer.js";

export async function waitLayoutStable(
    {
        maxFrames = MAX_FRAMES_FOR_STABILIZATION,
        trackAnchor = false,
        previousRafClock: startRafClock = null
    } = {}
) {
    const activationDistanceAbove =
        roomUntilFirstNotReadyDeck();
    const deactivationDistanceBelow =
        roomUntilFirstActiveDeckBelow();
    const activationNear =
        activationDistanceAbove <= MIN_ACTIVATION_DISTANCE;
    const deactivationNear =
        deactivationDistanceBelow <= MIN_ACTIVATION_DISTANCE;
    const stableFrames = trackAnchor && !activationNear
        ? 1
        : 2;

    let recentFrames = [{ geometry: geometrySnapshot(), ignorable: false }];

    const deactivatedDecks = new Set();

    let previousRafClock = startRafClock;
    let unchanged = 0;
    let promptFrames = 0;
    saveDeckActivationStatus(thresholdDeckSnapshot());

    for (let frame = 0; frame < maxFrames; frame++) {

        const rafClock = await nextAnimationFrame();

        const extraJump = performSplitExtraJump(frame + 1);
        if (extraJump) {
            recentFrames = recentFrames.map(entry => ({
                ignorable: entry.ignorable,
                geometry: {
                    scrollHeight: entry.geometry.scrollHeight,
                    scrollY: entry.geometry.scrollY - extraJump
                }
            }));
        }
        const rafDelay = previousRafClock == null
            ? Infinity
            : rafClock - previousRafClock;
        previousRafClock = rafClock;

        const currentGeometry = geometrySnapshot();
        const deckStatus = thresholdDeckSnapshot();
        const deckTransitions = deckActivationTransitions(deckStatus);
        saveDeckActivationStatus(deckStatus);
        for (const transition of deckTransitions.deactivations) {
            deactivatedDecks.add(transition.deck);
        }
        const skippable = [...deactivatedDecks].some(
            deck => deckStatus.decks.get(deck)?.state === "true"
        );

        const geometryChanged = !matchesRecentFrame(
            recentFrames,
            currentGeometry
        );
        recentFrames = [
            { geometry: currentGeometry, ignorable: skippable },
            ...recentFrames
        ].slice(0, MAX_IGNORED_FRAMES + 1);
        const positionAtFrame = trackAnchor
            ? anchorRoom()
            : null;

        if (geometryChanged) {
            if (!skippable) unchanged = 0;
        } else {
            unchanged++;
        }

        if (!skippable) {
            promptFrames = rafDelay >= MAX_STABLE_RAF_DELAY
                ? 0
                : promptFrames + 1;
        }

        const stable = unchanged >= stableFrames;

        if (stable) {

            return;
        }
    }

    throw new Error(
        `Exceeded ${maxFrames} frames waiting for layout stabilization.`
    );
}

/**
 * Return a fingerprint of the current geometry.
 *
 * Any geometric change that matters to traversal should
 * modify at least one of these quantities.
 */
function matchesRecentFrame(recentFrames, currentGeometry) {
    for (let index = 0; index < recentFrames.length; index++) {
        if (sameGeometry(recentFrames[index].geometry, currentGeometry)) {
            return true;
        }
        if (!recentFrames[index].ignorable) return false;
    }

    return false;
}

function sameGeometry(left, right) {
    if (left.scrollY !== right.scrollY) return false;
    return Math.abs(left.scrollHeight - right.scrollHeight) <
        TOLERATED_ROUNDING;
}

function geometrySnapshot() {

    return {
        scrollHeight: supplyHeight(),
        scrollY: supplyRoom()
    };
}

async function checkAnchorAcrossYields(
    trackAnchor,
    positionAtFrame
) {
    let previousPosition = positionAtFrame;
    let stable = true;

    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {

        await yieldToScheduler();
        const position = trackAnchor
            ? anchorRoom()
            : null;
        const change = position == null || previousPosition == null
            ? 0
            : Math.abs(position - previousPosition);
        const changed = change !== 0;

        if (changed) stable = false;
        previousPosition = position;
    }

    return stable;
}

async function yieldToScheduler() {
    if (typeof globalThis.scheduler?.yield === "function") {
        await globalThis.scheduler.yield();
        return;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
}
