import { traverseConversation } from './mainOrchestration-no-diag.js';
import { showCompatibilityCheck } from './compatibility-no-diag.js';
export function installExtractorApp({
    version,
    runLabel,
    compatibilityLabel,
    logPrefix
}) {
const VERSION = version;

console.log(`[${logPrefix}] loaded, version ${VERSION}`);

let activeRuns = 0;

const runTraversal = async () => {
    if (activeRuns > 0) {
        console.log(`[${logPrefix}] ignored: a traversal is already in progress.`);

        return;
    }

    activeRuns++;
    console.log(`[${logPrefix}] started.`);
    try {
        await traverseConversation();
        console.log(`[${logPrefix}] finished.`);
    } catch (error) {

        console.error(`[${logPrefix}] failed.`, error);
        throw error;
    } finally {
        activeRuns--;
    }
};

const menuLabel = `${runLabel} v${VERSION}`;
const registerMenuCommand = typeof GM_registerMenuCommand === 'function'
    ? GM_registerMenuCommand
    : typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function'
    ? GM.registerMenuCommand.bind(GM)
    : null;

if (registerMenuCommand) {
    registerMenuCommand(menuLabel, runTraversal);
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
