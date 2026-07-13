// bootstrap.js
//
// Entry point for the dev userscript build.
//
// This wires the in-progress geometric traversal (src/dev/) up to
// a Tampermonkey menu command, separately from the shipped
// extractor in src/app/. Extraction is not yet implemented here
// (see mainOrchestration.js) — this build exists to exercise and
// observe the geometry layer in a real browser.

import { traverseConversation } from './mainOrchestration.js';

// Replaced at build time (scripts/build-dev-userscript.js) with the same
// version string as the @version header — shown in the menu label so it's
// obvious whether Tampermonkey is running the build you just made.
const VERSION = typeof __DEV_USERSCRIPT_VERSION__ !== 'undefined'
    ? __DEV_USERSCRIPT_VERSION__
    : 'unbuilt';

console.log(`[dev traversal] loaded, version ${VERSION}`);

GM_registerMenuCommand(`Run dev traversal v${VERSION} (geometry only)`, () => {
    traverseConversation()
        .then(() => console.log('[dev traversal] finished.'))
        .catch(err => console.error('[dev traversal] failed:', err));
});
