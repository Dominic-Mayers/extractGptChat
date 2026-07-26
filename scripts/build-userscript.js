const esbuild = require('esbuild');

const version = '5.25';

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

esbuild.buildSync({
    entryPoints: ['src/bootstrap.js'],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    banner: { js: userscriptHeader },
    define: { __PROD_USERSCRIPT_VERSION__: JSON.stringify(version) },
    outfile: 'extractChatGpt.js',
});
