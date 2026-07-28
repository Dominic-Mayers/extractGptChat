import { traverseConversation } from './mainOrchestration-dev.js';
import { showCompatibilityCheck } from './compatibility-dev.js';
import {
    logActiveTraversalDiagnostics,
    logCycleContextDiagnostics,
    recordCycleStageDiagnostics,
    selectCurrentJumpDiagnostics
} from './cycleDiagnostics-dev.js';

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
        logActiveTraversalDiagnostics();
        return;
    }

    activeRuns++;
    console.log(`[${logPrefix}] started.`);
    const marginExperiment = document.createElement("style");
    marginExperiment.textContent =
        "div.my-4.flex.h-5.justify-center{" +
        "margin-block:0!important" +
        "}";
    document.head.append(marginExperiment);
    console.log(`[${logPrefix}] loading-indicator margins disabled.`);
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
        marginExperiment.remove();
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
