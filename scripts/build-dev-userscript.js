const esbuild = require('esbuild');
const fs = require('fs');

// Single source of truth: bumped on every modification to the dev build, so the
// menu command label (see bootstrap.js) makes it obvious whether Tampermonkey
// is actually running the build you just made, instead of a stale cached copy.
const version = '2.76';
const output = 'extractChatGpt-dev.js';

const userscriptHeader = `// ==UserScript==
// @name         ChatGPT Chat Extractor (dev)
// @namespace    http://tampermonkey.net/
// @version      ${version}
// @description  Extracts ChatGPT conversations with the geometric traversal.
// @author       Dominic Mayers
// @license      MIT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==`;

if (fs.existsSync(output)) fs.chmodSync(output, 0o644);
try {
    esbuild.buildSync({
        entryPoints: ['src/bootstrap-dev.js'],
        bundle: true,
        format: 'iife',
        target: ['es2020'],
        banner: { js: userscriptHeader },
        define: { __DEV_USERSCRIPT_VERSION__: JSON.stringify(version) },
        outfile: output,
    });
} finally {
    if (fs.existsSync(output)) fs.chmodSync(output, 0o444);
}
