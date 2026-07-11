const esbuild = require('esbuild');

// Single source of truth: bumped on every modification to src/dev/, so the
// menu command label (see bootstrap.js) makes it obvious whether Tampermonkey
// is actually running the build you just made, instead of a stale cached copy.
const version = '0.61';

const userscriptHeader = `// ==UserScript==
// @name         ChatGPT Chat Extractor (dev)
// @namespace    http://tampermonkey.net/
// @version      ${version}
// @description  Runs the in-progress src/dev/ geometric traversal only (no extraction yet).
// @author       Claude
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==`;

esbuild.buildSync({
    entryPoints: ['src/dev/bootstrap.js'],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    banner: { js: userscriptHeader },
    define: { __DEV_USERSCRIPT_VERSION__: JSON.stringify(version) },
    outfile: 'extractChatGptDev.js',
});
