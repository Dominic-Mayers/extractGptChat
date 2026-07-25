import { installExtractorApp } from './app/installExtractorApp.js';

const VERSION = typeof __PROD_USERSCRIPT_VERSION__ !== 'undefined'
    ? __PROD_USERSCRIPT_VERSION__
    : 'unbuilt';

installExtractorApp({
    version: VERSION,
    runLabel: 'Run extractor',
    compatibilityLabel: 'Compatibility check',
    logPrefix: 'extractor'
});
