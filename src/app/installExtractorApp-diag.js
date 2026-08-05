import { traverseConversation } from './mainOrchestration-diag.js';
import { showCompatibilityCheck } from './compatibility-diag.js';
import {
    ASSET_MODE_EMBEDDED,
    ASSET_MODE_SEPARATE,
    exportMarkdown
} from './extraction-diag.js';
import {
    logActiveTraversalDiagnostics,
    logCycleContextDiagnostics,
    recordCycleStageDiagnostics,
    selectCurrentJumpDiagnostics
} from './cycleDiagnostics-diag.js';
import { stopSupplyWorkerDiagnostics } from './supplyWorker-diag.js';
import {
    rafDeckStudySnapshotDiagnostics
} from './rafDeckStudy-diag.js';

export function installExtractorApp({
    version,
    runLabel,
    embeddedRunLabel,
    compatibilityLabel,
    logPrefix
}) {
const VERSION = version;

console.log(`[${logPrefix}] loaded, version ${VERSION}`);

let activeRuns = 0;

const runTraversal = async (assetMode = ASSET_MODE_SEPARATE) => {
    if (activeRuns > 0) {
        console.log(`[${logPrefix}] ignored: a traversal is already in progress.`);
        logActiveTraversalDiagnostics();
        return;
    }

    activeRuns++;
    console.log(`[${logPrefix}] started.`);
    try {
        const snapshot = await traverseConversation();
        await exportMarkdown(snapshot, { assetMode });
        logRafDeckStudyDiagnostics();
        console.log(`[${logPrefix}] finished.`);
    } catch (error) {
        recordCycleStageDiagnostics("error", { error });
        selectCurrentJumpDiagnostics("error");
        logCycleContextDiagnostics();
        console.error(`[${logPrefix}] failed.`, error);
        throw error;
    } finally {
        stopSupplyWorkerDiagnostics();
        activeRuns--;
    }
};

const batchConfigurationDiagnostics = (() => {
    const parameters = new URLSearchParams(location.search);
    if (parameters.get('_extract_gpt_batch') !== '1') return null;
    const port = Number(parameters.get('_extract_gpt_port'));
    const cycle = Number(parameters.get('_extract_gpt_cycle'));
    const token = parameters.get('_extract_gpt_token');
    if (!Number.isInteger(port) || !Number.isInteger(cycle) || !token) {
        return null;
    }
    return { port, cycle, token };
})();

function sendBatchRequestDiagnostics(configuration, path, result) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'POST',
            url: `http://127.0.0.1:${configuration.port}${path}`,
            headers: {
                'Content-Type': 'application/json',
                'X-Extract-Gpt-Token': configuration.token
            },
            data: JSON.stringify(result),
            onload: response => response.status >= 200 &&
                response.status < 300
                ? resolve()
                : reject(new Error(
                    `Batch collector returned ${response.status}.`
                )),
            onerror: () => reject(new Error(
                'Could not contact the batch collector.'
            ))
        });
    });
}

function logRafDeckStudyDiagnostics() {
    console.log(
        '[rAF deck study]\n' +
        JSON.stringify(rafDeckStudySnapshotDiagnostics(), null, 2)
    );
}

function batchConversationUrlDiagnostics() {
    const url = new URL(location.href);
    for (const name of [
        '_extract_gpt_batch',
        '_extract_gpt_port',
        '_extract_gpt_token',
        '_extract_gpt_cycle'
    ]) {
        url.searchParams.delete(name);
    }
    return url.href;
}

async function waitBatchConversationDiagnostics() {
    const deadline = Date.now() + 120000;
    while (
        document.querySelector('[data-turn-id-container]') == null
    ) {
        if (Date.now() >= deadline) {
            throw new Error('Timed out waiting for the conversation.');
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
}

async function traverseBatchConversationDiagnostics() {
    if (activeRuns > 0) {
        throw new Error('A traversal is already in progress.');
    }
    activeRuns++;
    console.log(`[${logPrefix}] started.`);
    try {
        await traverseConversation();
        console.log(`[${logPrefix}] finished.`);
    } catch (error) {
        recordCycleStageDiagnostics("error", { error });
        selectCurrentJumpDiagnostics("error");
        logCycleContextDiagnostics();
        console.error(`[${logPrefix}] failed.`, error);
        throw error;
    } finally {
        stopSupplyWorkerDiagnostics();
        activeRuns--;
    }
}

function batchDeckIdsDiagnostics() {
    return [...new Set(
        [...document.querySelectorAll('[data-turn-id-container]')]
            .map(deck => deck.getAttribute('data-turn-id-container'))
            .filter(deckId => deckId != null)
    )].sort();
}

async function runBatchTraversalDiagnostics(configuration) {
    let deckIds = [];
    try {
        await sendBatchRequestDiagnostics(configuration, '/ready', {});
        await waitBatchConversationDiagnostics();
        deckIds = batchDeckIdsDiagnostics();
        await traverseBatchConversationDiagnostics();
        await sendBatchRequestDiagnostics(configuration, '/result', {
            cycle: configuration.cycle,
            version: VERSION,
            conversationUrl: batchConversationUrlDiagnostics(),
            status: 'complete',
            deckIds,
            rafDeckStudy: rafDeckStudySnapshotDiagnostics()
        });
    } catch (error) {
        await sendBatchRequestDiagnostics(configuration, '/result', {
            cycle: configuration.cycle,
            version: VERSION,
            conversationUrl: batchConversationUrlDiagnostics(),
            status: 'failed',
            error: {
                name: error?.name ?? null,
                message: error?.message ?? String(error),
                stack: error?.stack ?? null
            },
            deckIds,
            rafDeckStudy: rafDeckStudySnapshotDiagnostics()
        });
    }
}

const menuLabel = `${runLabel} v${VERSION}`;
const embeddedMenuLabel = `${embeddedRunLabel} v${VERSION}`;
const registerMenuCommand = typeof GM_registerMenuCommand === 'function'
    ? GM_registerMenuCommand
    : typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function'
    ? GM.registerMenuCommand.bind(GM)
    : null;

if (registerMenuCommand) {
    registerMenuCommand(
        menuLabel,
        () => runTraversal(ASSET_MODE_SEPARATE)
    );
    registerMenuCommand(
        embeddedMenuLabel,
        () => runTraversal(ASSET_MODE_EMBEDDED)
    );
    registerMenuCommand(
        `${compatibilityLabel} v${VERSION}`,
        () => showCompatibilityCheck(VERSION)
    );
    console.log(`[${logPrefix}] menu command registered: ${menuLabel}`);
} else {
    console.log(
        `[${logPrefix}] cannot register menu command: neither ` +
        'GM_registerMenuCommand nor GM.registerMenuCommand is available.'
    );
}

if (batchConfigurationDiagnostics != null) {
    setTimeout(
        () => runBatchTraversalDiagnostics(
            batchConfigurationDiagnostics
        ),
        1000
    );
}
}
