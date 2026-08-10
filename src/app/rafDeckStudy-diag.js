let nextEpisodeIdDiagnostics = 1;
let nextRafIdDiagnostics = 1;
let nextLastKnownHeightUpdateIdDiagnostics = 1;
let nextActualHeightTransitionIdDiagnostics = 1;
let episodesDiagnostics = [];
let openEpisodesDiagnostics = new Map();
let deckHistoriesDiagnostics = new Map();
let jumpsDiagnostics = [];
let rafsDiagnostics = [];
let formalTransitionsDiagnostics = [];
let geometricActivationsDiagnostics = [];
let lastScrollYDiagnostics = null;
const OBSERVATION_BAND_DIAGNOSTICS = 2500;

export function resetRafDeckStudyDiagnostics() {
    nextEpisodeIdDiagnostics = 1;
    nextRafIdDiagnostics = 1;
    nextLastKnownHeightUpdateIdDiagnostics = 1;
    nextActualHeightTransitionIdDiagnostics = 1;
    episodesDiagnostics = [];
    openEpisodesDiagnostics = new Map();
    deckHistoriesDiagnostics = new Map();
    jumpsDiagnostics = [];
    rafsDiagnostics = [];
    formalTransitionsDiagnostics = [];
    geometricActivationsDiagnostics = [];
    lastScrollYDiagnostics = null;
}

export function recordGeometricDeactivationDiagnostics({
    deckId,
    jumpNumber,
    clock,
    lastKnownHeight,
    formalState,
    actualHeight
}) {
    if (openEpisodesDiagnostics.has(deckId)) return;
    const episode = {
        episodeId: nextEpisodeIdDiagnostics++,
        deckId,
        geometricDeactivationJumpNumber: jumpNumber,
        geometricDeactivationClock: clock,
        actualHeightAtGeometricDeactivation: actualHeight,
        lastKnownHeightAtGeometricDeactivation: lastKnownHeight,
        formalStateAtGeometricDeactivation: formalState,
        formalDeactivation: null,
        formalState
    };
    episodesDiagnostics.push(episode);
    openEpisodesDiagnostics.set(deckId, episode);
}

export function recordDeckRafDiagnostics({
    clock,
    jumpNumber,
    rafNumber,
    rafKind,
    decks,
    viewportHeight,
    scrollY
}) {
    const rafId = nextRafIdDiagnostics++;
    const previousScrollY = lastScrollYDiagnostics;
    lastScrollYDiagnostics = scrollY;
    const deactivatedDeckIds = [];
    for (const deck of decks) {
        const history = deckHistoryDiagnostics(deck, {
            rafId,
            clock,
            jumpNumber,
            rafNumber,
            rafKind
        });
        if (history.formalState !== deck.formalState) {
            formalTransitionsDiagnostics.push({
                deckId: deck.deckId,
                rafId,
                clock,
                jumpNumber,
                rafNumber,
                rafKind,
                from: history.formalState,
                to: deck.formalState,
                top: deck.top,
                bottom: deck.bottom,
                previousTop: history.lastTop,
                previousBottom: history.lastBottom,
                previousRafId: history.lastRafId,
                viewportHeight,
                actualHeight: deck.actualHeight,
                lastKnownHeight: deck.lastKnownHeight
            });
            history.formalState = deck.formalState;
        }

        const previousActualHeight = history.lastActualHeight;
        if (deck.actualHeight !== previousActualHeight) {
            history.actualHeightTransitions.push({
                actualHeightTransitionId:
                    nextActualHeightTransitionIdDiagnostics++,
                deckId: deck.deckId,
                rafId,
                clock,
                jumpNumber,
                rafNumber,
                rafKind,
                before: previousActualHeight,
                after: deck.actualHeight,
                lastKnownHeight: deck.lastKnownHeight
            });
            history.lastActualHeight = deck.actualHeight;
        }
        const previousLastKnownHeight = history.lastKnownHeight;
        if (deck.lastKnownHeight !== previousLastKnownHeight) {
            history.lastKnownHeightUpdates.push({
                lastKnownHeightUpdateId:
                    nextLastKnownHeightUpdateIdDiagnostics++,
                deckId: deck.deckId,
                rafId,
                clock,
                jumpNumber,
                rafNumber,
                rafKind,
                before: previousLastKnownHeight,
                after: deck.lastKnownHeight,
                actualHeightBeforeRafObservation:
                    previousActualHeight,
                actualHeightAtRafObservation:
                    deck.actualHeight,
                actualHeight: deck.actualHeight
            });
            history.lastKnownHeight = deck.lastKnownHeight;
        }

        const previousDistance = history.lastBottom == null
            ? null
            : -history.lastBottom;
        const currentDistance = -deck.bottom;
        if (
            previousDistance != null &&
            previousDistance > OBSERVATION_BAND_DIAGNOSTICS &&
            currentDistance <= OBSERVATION_BAND_DIAGNOSTICS
        ) {
            geometricActivationsDiagnostics.push({
                deckId: deck.deckId,
                rafId,
                clock,
                jumpNumber,
                rafNumber,
                rafKind,
                formalState: deck.formalState,
                previousDistance,
                distance: currentDistance,
                step: previousDistance - currentDistance,
                scrollY,
                previousScrollY,
                scrollStep: scrollY == null || previousScrollY == null
                    ? null
                    : previousScrollY - scrollY,
                actualHeight: deck.actualHeight,
                lastKnownHeight: deck.lastKnownHeight
            });
        }

        history.lastTop = deck.top;
        history.lastBottom = deck.bottom;
        history.lastRafId = rafId;

        const episode = openEpisodesDiagnostics.get(deck.deckId);
        if (episode == null) {
            history.formalState = deck.formalState;
            continue;
        }
        const previousFormalState = episode.formalState;
        if (
            previousFormalState != null &&
            previousFormalState !== "false" &&
            (deck.formalState == null || deck.formalState === "false")
        ) {
            episode.formalDeactivation = {
                rafId,
                clock,
                jumpNumber,
                rafNumber,
                rafKind
            };
            episode.formalState = deck.formalState;
            history.formalState = deck.formalState;
            openEpisodesDiagnostics.delete(deck.deckId);
            deactivatedDeckIds.push(deck.deckId);
            continue;
        }
        episode.formalState = deck.formalState;
        history.formalState = deck.formalState;
    }
    rafsDiagnostics.push({
        rafId,
        clock,
        jumpNumber,
        rafNumber,
        rafKind
    });
    return deactivatedDeckIds;
}

function deckHistoryDiagnostics(deck, raf) {
    let history = deckHistoriesDiagnostics.get(deck.deckId);
    if (history != null) return history;
    history = {
        deckId: deck.deckId,
        firstObservation: {
            ...raf,
            lastKnownHeight: deck.lastKnownHeight,
            formalState: deck.formalState,
            actualHeight: deck.actualHeight
        },
        lastKnownHeightUpdates: [],
        actualHeightTransitions: [],
        lastKnownHeight: deck.lastKnownHeight,
        lastActualHeight: deck.actualHeight,
        formalState: deck.formalState,
        lastTop: deck.top,
        lastBottom: deck.bottom,
        lastRafId: null
    };
    deckHistoriesDiagnostics.set(deck.deckId, history);
    return history;
}

export function recordDeckStudyJumpDiagnostics({
    jumpNumber,
    clock,
    requestedJump
}) {
    jumpsDiagnostics.push({
        jumpNumber,
        clock,
        requestedJump,
        outcome: null,
        isErased: null
    });
}

export function annotateDeckStudyJumpDiagnostics(jumpNumber, data) {
    const jump = jumpsDiagnostics.find(candidate =>
        candidate.jumpNumber === jumpNumber
    );
    if (jump == null) return;
    Object.assign(jump, data);
}

export function recordDeckStudyJumpOutcomeDiagnostics(
    jumpNumber,
    outcome,
    geometry
) {
    const jump = jumpsDiagnostics.find(candidate =>
        candidate.jumpNumber === jumpNumber
    );
    if (jump == null) return;
    jump.outcome = outcome;
    jump.isErased = outcome === "erased" || outcome === "retry-erased";
    jump.geometry = geometry;
}

export function rafDeckStudySnapshotDiagnostics() {
    const lastKnownHeightUpdates = Array.from(
        deckHistoriesDiagnostics.values()
    ).flatMap(history => history.lastKnownHeightUpdates);
    const classifiedJumps = jumpsDiagnostics.map(jump =>
        classifyJumpByPrecedingUpdateDiagnostics(
            jump,
            lastKnownHeightUpdates
        )
    );
    return structuredClone({
        formalTransitions: formalTransitionsDiagnostics,
        geometricActivations: geometricActivationsDiagnostics,
        episodes: episodesDiagnostics.map(episode => ({
            episodeId: episode.episodeId,
            deckId: episode.deckId,
            geometricDeactivationJumpNumber:
                episode.geometricDeactivationJumpNumber,
            geometricDeactivationClock:
                episode.geometricDeactivationClock,
            actualHeightAtGeometricDeactivation:
                episode.actualHeightAtGeometricDeactivation,
            lastKnownHeightAtGeometricDeactivation:
                episode.lastKnownHeightAtGeometricDeactivation,
            formalStateAtGeometricDeactivation:
                episode.formalStateAtGeometricDeactivation,
            formalDeactivation: episode.formalDeactivation
        })),
        deckHistories: Array.from(deckHistoriesDiagnostics.values()).map(
            history => ({
                deckId: history.deckId,
                firstObservation: history.firstObservation,
                lastKnownHeightUpdates:
                    history.lastKnownHeightUpdates,
                actualHeightTransitions:
                    history.actualHeightTransitions
            })
        ),
        jumps: classifiedJumps,
        rafs: rafsDiagnostics
    });
}

function classifyJumpByPrecedingUpdateDiagnostics(
    jump,
    lastKnownHeightUpdates
) {
    const precedingUpdates = lastKnownHeightUpdates.filter(update =>
        update.clock <= jump.clock
    );
    const closestClock = precedingUpdates.reduce(
        (latest, update) => Math.max(latest, update.clock),
        -Infinity
    );
    const candidates = precedingUpdates.filter(update =>
        update.clock === closestClock
    );
    const selectedUpdate = candidates.length === 1
        ? candidates[0]
        : null;
    const episode = selectedUpdate == null
        ? null
        : episodesDiagnostics.find(candidate =>
            candidate.deckId === selectedUpdate.deckId
        ) ?? null;
    return {
        ...jump,
        precedingLastKnownHeightUpdateCandidates:
            candidates.map(update => ({
                lastKnownHeightUpdateId:
                    update.lastKnownHeightUpdateId,
                deckId: update.deckId,
                rafId: update.rafId,
                clock: update.clock,
                jumpNumber: update.jumpNumber,
                rafNumber: update.rafNumber,
                rafKind: update.rafKind,
                before: update.before,
                after: update.after,
                actualHeightBeforeRafObservation:
                    update.actualHeightBeforeRafObservation,
                actualHeightAtRafObservation:
                    update.actualHeightAtRafObservation,
                actualHeight: update.actualHeight,
                jumpDelayMs: jump.clock - update.clock
            })),
        selectedLastKnownHeightUpdateId:
            selectedUpdate?.lastKnownHeightUpdateId ?? null,
        selectedDeckId: selectedUpdate?.deckId ?? null,
        selectedEpisodeId: episode?.episodeId ?? null,
        lagN: episode == null
            ? null
            : jump.jumpNumber -
                episode.geometricDeactivationJumpNumber,
        jumpDelayMs: selectedUpdate == null
            ? null
            : jump.clock - selectedUpdate.clock
    };
}
