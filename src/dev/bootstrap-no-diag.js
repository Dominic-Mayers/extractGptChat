// bootstrap.js
//
// Entry point for the dev userscript build.
//
// This wires the in-progress geometric traversal (src/dev/) up to
// a Tampermonkey menu command, separately from the shipped
// extractor in src/app/. Extraction is not yet implemented here
// (see mainOrchestration.js) — this build exists to exercise and
// observe the geometry layer in a real browser.

import { traverseConversation } from './mainOrchestration-no-diag.js';
// Replaced at build time (scripts/build-dev-userscript.js) with the same
// version string as the @version header — shown in the menu label so it's
// obvious whether Tampermonkey is running the build you just made.
const VERSION = typeof __DEV_USERSCRIPT_VERSION__ !== 'undefined'
    ? __DEV_USERSCRIPT_VERSION__
    : 'unbuilt';

console.log(`[dev traversal] loaded, version ${VERSION}`);

let activeRuns = 0;

const runTraversal = async () => {
    if (activeRuns > 0) {
        console.log('[dev traversal] ignored: a traversal is already in progress.');

        return;
    }

    activeRuns++;
    console.log('[dev traversal] started.');
    try {
        await traverseConversation();
        console.log('[dev traversal] finished.');
    } finally {
        activeRuns--;
    }
};

const menuLabel = `Run dev traversal v${VERSION} (geometry only)`;
const registerMenuCommand = typeof GM_registerMenuCommand === 'function'
    ? GM_registerMenuCommand
    : typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function'
    ? GM.registerMenuCommand.bind(GM)
    : null;

if (registerMenuCommand) {
    registerMenuCommand(menuLabel, runTraversal);
    console.log(`[dev traversal] menu command registered: ${menuLabel}`);
} else {
    console.log(
        '[dev traversal] cannot register menu command: neither ' +
        'GM_registerMenuCommand nor GM.registerMenuCommand is available.'
    );
}
