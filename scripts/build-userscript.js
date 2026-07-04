const esbuild = require('esbuild');

const userscriptHeader = `// ==UserScript==
// @name         ChatGPT Chat Extractor
// @namespace    http://tampermonkey.net/
// @version      4.162
// @description  Extracts a full ChatGPT conversation to Markdown via automated scrolling.
// @author       Claude
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==`;

esbuild.buildSync({
    entryPoints: ['src/bootstrap.js'],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    banner: { js: userscriptHeader },
    outfile: 'extractChatGpt.js',
});
