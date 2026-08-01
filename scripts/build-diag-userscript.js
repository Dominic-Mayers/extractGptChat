const esbuild = require('esbuild');
const fs = require('fs');
const { version } = require('./version');

// Single source of truth: bumped on every modification to the diagnostic build, so the
// menu command label (see bootstrap.js) makes it obvious whether Tampermonkey
// is actually running the build you just made, instead of a stale cached copy.
const output = 'extractChatGpt-diag.js';

const userscriptHeader = `// ==UserScript==
// @name         ChatGPT Chat Extractor (diagnostic)
// @namespace    http://tampermonkey.net/
// @version      ${version}
// @description  Extracts ChatGPT conversations with the geometric traversal.
// @author       Dominic Mayers
// @license      MIT
// @homepage     https://github.com/Dominic-Mayers/extractGptChat
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==`;

if (fs.existsSync(output)) fs.chmodSync(output, 0o644);
try {
    esbuild.buildSync({
        entryPoints: ['src/bootstrap-diag.js'],
        bundle: true,
        format: 'iife',
        target: ['es2020'],
        banner: { js: userscriptHeader },
        define: { __DIAG_USERSCRIPT_VERSION__: JSON.stringify(version) },
        outfile: output,
    });
} finally {
    if (fs.existsSync(output)) fs.chmodSync(output, 0o444);
}
