import {
    installExtractorApp
} from './app/installExtractorApp.js';

const VERSION = typeof __NO_DIAG_USERSCRIPT_VERSION__ !== 'undefined'
    ? __NO_DIAG_USERSCRIPT_VERSION__
    : 'unbuilt';

const install = () => installExtractorApp({
    version: VERSION,
    runLabel: 'Run extractor',
    embeddedRunLabel: 'Run extractor (embedded)',
    compatibilityLabel: 'Compatibility check',
    logPrefix: 'extractor'
});

if (document.readyState === 'complete') {
    install();
} else {
    window.addEventListener('load', install, { once: true });
}
