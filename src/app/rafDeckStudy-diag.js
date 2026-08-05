let nextEpisodeIdDiagnostics = 1;
let nextRafIdDiagnostics = 1;
let episodesDiagnostics = [];
let openEpisodesDiagnostics = new Map();
let jumpsDiagnostics = [];
let rafsDiagnostics = [];

export function resetRafDeckStudyDiagnostics() {
    nextEpisodeIdDiagnostics = 1;
    nextRafIdDiagnostics = 1;
    episodesDiagnostics = [];
    openEpisodesDiagnostics = new Map();
    jumpsDiagnostics = [];
    rafsDiagnostics = [];
}

export function recordGeometricDeactivationDiagnostics({
    deckId,
    jumpNumber,
    clock,
    lastKnownHeight,
    formalState,
    deckHeight
}) {
    if (openEpisodesDiagnostics.has(deckId)) return;
    const episode = {
        episodeId: nextEpisodeIdDiagnostics++,
        deckId,
        geometricDeactivationJumpNumber: jumpNumber,
        geometricDeactivationClock: clock,
        deckHeightAtGeometricDeactivation: deckHeight,
        initialLastKnownHeight: lastKnownHeight,
        initialFormalState: formalState,
        heightUpdates: [],
        formalDeactivation: null,
        lastKnownHeight,
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
    const observedDecks = [];
    const deactivatedDeckIds = [];
    for (const deck of decks) {
        const episode = openEpisodesDiagnostics.get(deck.deckId);
        if (episode == null) continue;
        const previousHeight = episode.lastKnownHeight;
        const previousFormalState = episode.formalState;
        observedDecks.push(deck);
        if (deck.lastKnownHeight !== previousHeight) {
            episode.heightUpdates.push({
                rafId,
                clock,
                jumpNumber,
                rafNumber,
                rafKind,
                before: previousHeight,
                after: deck.lastKnownHeight,
                deckHeight: deck.deckHeight
            });
            episode.lastKnownHeight = deck.lastKnownHeight;
        }
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
            openEpisodesDiagnostics.delete(deck.deckId);
            deactivatedDeckIds.push(deck.deckId);
            continue;
        }
        episode.formalState = deck.formalState;
    }
    rafsDiagnostics.push({
        rafId,
        clock,
        jumpNumber,
        rafNumber,
        rafKind,
        decks: observedDecks
    });
    return deactivatedDeckIds;
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
    const completedEpisodes = episodesDiagnostics.filter(episode =>
        episode.formalDeactivation != null
    );
    const matchedJumps = jumpsDiagnostics.map(jump => {
        const episodesAhead = completedEpisodes
            .filter(candidate =>
                candidate.formalDeactivation.clock > jump.clock
            )
            .sort((first, second) =>
                first.formalDeactivation.clock -
                second.formalDeactivation.clock
            );
        const firstClock =
            episodesAhead[0]?.formalDeactivation.clock ?? null;
        const candidates = firstClock == null
            ? []
            : episodesAhead.filter(candidate =>
                candidate.formalDeactivation.clock === firstClock
            );
        const episode = candidates.length === 1
            ? candidates[0]
            : null;
        const updates = episode?.heightUpdates ?? [];
        return {
            ...jump,
            candidateEpisodeIds:
                candidates.map(candidate => candidate.episodeId),
            candidateDeckIds:
                candidates.map(candidate => candidate.deckId),
            matchedEpisodeId: episode?.episodeId ?? null,
            matchedDeckId: episode?.deckId ?? null,
            lagN: episode == null
                ? null
                : jump.jumpNumber -
                    episode.geometricDeactivationJumpNumber,
            heightUpdates: updates.map(update => ({
                rafId: update.rafId,
                jumpNumber: update.jumpNumber,
                rafNumber: update.rafNumber,
                rafKind: update.rafKind,
                jumpDelayMs: jump.clock - update.clock
            }))
        };
    });
    const erasedByEpisode = new Map();
    for (const jump of matchedJumps) {
        if (!jump.isErased || jump.matchedEpisodeId == null) continue;
        const erased = erasedByEpisode.get(jump.matchedEpisodeId) ?? [];
        erased.push(jump.jumpNumber);
        erasedByEpisode.set(jump.matchedEpisodeId, erased);
    }
    return structuredClone({
        episodes: episodesDiagnostics.map(episode => ({
            ...episode,
            erasingJumpNumbers:
                erasedByEpisode.get(episode.episodeId) ?? []
        })),
        jumps: matchedJumps,
        rafs: rafsDiagnostics
    });
}
