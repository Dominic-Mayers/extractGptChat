const esbuild = require('esbuild');
const fs = require('fs');
const {
    buildProductionSources
} = require('./build-production-sources');

const version = '5.28';
const output = 'extractChatGpt.js';

const userscriptHeader = `// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      ${version}
// @description  Extracts a full ChatGPT conversation to Markdown via automated scrolling.
// @author       Claude
// @match        https://chatgpt.com/*
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==`;

buildProductionSources();

if (fs.existsSync(output)) fs.chmodSync(output, 0o644);
try {
    esbuild.buildSync({
        entryPoints: ['src/bootstrap.js'],
        bundle: true,
        format: 'iife',
        target: ['es2020'],
        banner: { js: userscriptHeader },
        define: { __PROD_USERSCRIPT_VERSION__: JSON.stringify(version) },
        outfile: output,
    });
} finally {
    if (fs.existsSync(output)) fs.chmodSync(output, 0o444);
}
