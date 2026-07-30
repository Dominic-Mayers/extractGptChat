import { installExtractorApp } from './app/installExtractorApp-dev.js';

const VERSION = typeof __DEV_USERSCRIPT_VERSION__ !== 'undefined'
    ? __DEV_USERSCRIPT_VERSION__
    : 'unbuilt';

installExtractorApp({
    version: VERSION,
    runLabel: 'Run dev extractor',
    embeddedRunLabel: 'Run dev extractor (embedded)',
    compatibilityLabel: 'Dev compatibility check',
    logPrefix: 'dev traversal'
});
