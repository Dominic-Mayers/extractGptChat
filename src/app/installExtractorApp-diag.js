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
}
