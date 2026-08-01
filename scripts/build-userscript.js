const esbuild = require('esbuild');
const fs = require('fs');
const {
    buildNoDiagnosticSources
} = require('./build-no-diagnostic-sources');
const { version } = require('./version');

const output = 'extractChatGpt.js';

const userscriptHeader = `// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      ${version}
// @description  Extracts a full ChatGPT conversation to Markdown via automated scrolling.
// @author       Dominic Mayers
// @license      MIT
// @homepage     https://github.com/Dominic-Mayers/extractGptChat
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==`;

buildNoDiagnosticSources();

if (fs.existsSync(output)) fs.chmodSync(output, 0o644);
try {
    esbuild.buildSync({
        entryPoints: ['src/bootstrap.js'],
        bundle: true,
        format: 'iife',
        target: ['es2020'],
        banner: { js: userscriptHeader },
        define: { __NO_DIAG_USERSCRIPT_VERSION__: JSON.stringify(version) },
        outfile: output,
    });
} finally {
    if (fs.existsSync(output)) fs.chmodSync(output, 0o444);
}
