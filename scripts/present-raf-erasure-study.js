const fs = require('fs');
const path = require('path');

const directory = process.argv[2];
const lags = process.argv.slice(3).map(Number);

if (directory == null || lags.some(lag => !Number.isInteger(lag))) {
    throw new Error(
        'Usage: node scripts/present-raf-erasure-study.js RUN_DIRECTORY [N ...]'
    );
}

if (lags.length === 0) lags.push(0, 1);

const files = fs.readdirSync(directory)
    .filter(file => /^cycle-\d+\.json$/.test(file))
    .sort((left, right) =>
        cycleNumber(left) - cycleNumber(right)
    );
const observations = [];
const exclusions = [];

for (const file of files) {
    const result = JSON.parse(
        fs.readFileSync(path.join(directory, file), 'utf8')
    );
    const study = result.rafDeckStudy;
    if (study == null) {
        exclusions.push({
            file,
            cycle: result.cycle ?? null,
            reason: 'missing-raf-deck-study'
        });
        continue;
    }
    const jumps = new Map(
        study.jumps.map(jump => [jump.jumpNumber, jump])
    );
    const jumpFrames = new Map(
        study.rafs
            .filter(raf => raf.rafNumber === 0)
            .map(raf => [raf.jumpNumber, raf])
    );
    const histories = new Map(
        study.deckHistories.map(history => [history.deckId, history])
    );

    for (const episode of study.episodes) {
        const history = histories.get(episode.deckId);
        const updates = history?.lastKnownHeightUpdates ?? [];
        for (const lagN of lags) {
            const jumpNumber =
                episode.geometricDeactivationJumpNumber + lagN;
            const jump = jumps.get(jumpNumber);
            const jumpFrame = jumpFrames.get(jumpNumber);
            if (jump == null || jump.outcome == null) {
                exclusions.push({
                    file,
                    cycle: result.cycle ?? null,
                    episodeId: episode.episodeId,
                    deckId: episode.deckId,
                    lagN,
                    jumpNumber,
                    reason: 'missing-jump-outcome'
                });
                continue;
            }
            if (jumpFrame == null) {
                exclusions.push({
                    file,
                    cycle: result.cycle ?? null,
                    episodeId: episode.episodeId,
                    deckId: episode.deckId,
                    lagN,
                    jumpNumber,
                    reason: 'missing-jump-frame'
                });
                continue;
            }
            if (updates.length === 0) {
                exclusions.push({
                    file,
                    cycle: result.cycle ?? null,
                    episodeId: episode.episodeId,
                    deckId: episode.deckId,
                    lagN,
                    jumpNumber,
                    outcome: jump.outcome,
                    isErased: jump.isErased,
                    jumpRafId: jumpFrame.rafId,
                    reason: 'no-observed-last-known-height-update'
                });
                continue;
            }
            const updateRelations = updates.map(update => {
                const frameOffset = jumpFrame.rafId - update.rafId;
                return {
                    lastKnownHeightUpdateId:
                        update.lastKnownHeightUpdateId,
                    updateRafId: update.rafId,
                    frameOffset,
                    relation: frameOffset < 0
                        ? 'jump-before-update'
                        : frameOffset === 0
                            ? 'same-observation-frame'
                            : 'jump-after-update',
                    updateBefore: update.before,
                    updateAfter: update.after
                };
            });
            const selectedRelation = updateRelations.length === 1
                ? updateRelations[0]
                : null;
            observations.push({
                file,
                cycle: result.cycle ?? null,
                episodeId: episode.episodeId,
                deckId: episode.deckId,
                geometricDeactivationJumpNumber:
                    episode.geometricDeactivationJumpNumber,
                lagN,
                jumpNumber,
                outcome: jump.outcome,
                isErased: jump.isErased,
                jumpRafId: jumpFrame.rafId,
                updateStatus: selectedRelation == null
                    ? 'multiple-observed-updates'
                    : 'single-observed-update',
                frameOffset: selectedRelation?.frameOffset ?? null,
                relation: selectedRelation?.relation ?? null,
                updateRelations
            });
        }
    }
}

const summary = [];
for (const lagN of lags) {
    const lagObservations = observations.filter(
        observation => observation.lagN === lagN
    );
    summary.push({
        lagN,
        relation: 'multiple-observed-updates',
        observations: lagObservations.filter(
            observation =>
                observation.updateStatus === 'multiple-observed-updates'
        ).length,
        erased: lagObservations.filter(
            observation =>
                observation.updateStatus === 'multiple-observed-updates' &&
                observation.isErased
        ).length,
        survived: lagObservations.filter(
            observation =>
                observation.updateStatus === 'multiple-observed-updates' &&
                observation.outcome === 'survived'
        ).length,
        retries: lagObservations.filter(
            observation =>
                observation.updateStatus === 'multiple-observed-updates' &&
                observation.outcome?.startsWith('retry-')
        ).length
    });
    for (const relation of [
        'jump-before-update',
        'same-observation-frame',
        'jump-after-update'
    ]) {
        const rows = lagObservations.filter(
            observation => observation.relation === relation
        );
        summary.push({
            lagN,
            relation,
            observations: rows.length,
            erased: rows.filter(observation => observation.isErased).length,
            survived: rows.filter(
                observation => observation.outcome === 'survived'
            ).length,
            retries: rows.filter(
                observation => observation.outcome?.startsWith('retry-')
            ).length
        });
    }
}

process.stdout.write(JSON.stringify({
    directory,
    files: files.length,
    lags,
    summary,
    observations,
    exclusions
}, null, 2));
process.stdout.write('\n');

function cycleNumber(file) {
    return Number(file.match(/\d+/)?.[0]);
}
