import { installExtractorApp } from './app/installExtractorApp-diag.js';

const VERSION = typeof __DIAG_USERSCRIPT_VERSION__ !== 'undefined'
    ? __DIAG_USERSCRIPT_VERSION__
    : 'unbuilt';

installExtractorApp({
    version: VERSION,
    runLabel: 'Run diagnostic extractor',
    embeddedRunLabel: 'Run diagnostic extractor (embedded)',
    compatibilityLabel: 'Diagnostic compatibility check',
    logPrefix: 'diagnostic traversal'
});
