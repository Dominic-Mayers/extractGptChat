let nextEpisodeIdDiagnostics = 1;
let nextRafIdDiagnostics = 1;
let nextLastKnownHeightUpdateIdDiagnostics = 1;
let nextActualHeightTransitionIdDiagnostics = 1;
let episodesDiagnostics = [];
let openEpisodesDiagnostics = new Map();
let deckHistoriesDiagnostics = new Map();
let jumpsDiagnostics = [];
let rafsDiagnostics = [];

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
    decks
}) {
    const rafId = nextRafIdDiagnostics++;
    const deactivatedDeckIds = [];
    for (const deck of decks) {
        const history = deckHistoryDiagnostics(deck, {
            rafId,
            clock,
            jumpNumber,
            rafNumber,
            rafKind
        });
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
                actualHeight: deck.actualHeight
            });
            history.lastKnownHeight = deck.lastKnownHeight;
        }

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
        formalState: deck.formalState
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

export function recordDeckStudyJumpOutcomeDiagnostics(
    jumpNumber,
    outcome
) {
    const jump = jumpsDiagnostics.find(candidate =>
        candidate.jumpNumber === jumpNumber
    );
    if (jump == null) return;
    jump.outcome = outcome;
    jump.isErased = outcome === "erased" || outcome === "retry-erased";
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
