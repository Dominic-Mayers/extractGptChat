import { installExtractorApp } from '../app/installExtractorApp.js';

const VERSION = typeof __DEV_USERSCRIPT_VERSION__ !== 'undefined'
    ? __DEV_USERSCRIPT_VERSION__
    : 'unbuilt';

installExtractorApp({
    version: VERSION,
    runLabel: 'Run dev extractor',
    compatibilityLabel: 'Dev compatibility check',
    logPrefix: 'dev traversal'
});
