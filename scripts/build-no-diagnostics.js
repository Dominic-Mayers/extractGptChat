const fs = require('fs');
const path = require('path');

const sourceDirectory = path.resolve('src/dev');

function buildNoDiagnostics() {
    for (const filename of fs.readdirSync(sourceDirectory)) {
        if (!filename.endsWith('.js') || filename.endsWith('-no-diag.js')) continue;

        const sourcePath = path.join(sourceDirectory, filename);
        const outputPath = path.join(
            sourceDirectory,
            filename.replace(/\.js$/, '-no-diag.js')
        );
        const source = fs.readFileSync(sourcePath, 'utf8');
        const output = filename === 'cycleDiagnostics.js'
            ? ''
            : removeDiagnostics(source);

        fs.writeFileSync(outputPath, output);
    }
}

function removeDiagnostics(source) {
    let output = source.replace(
        /^import\s*\{[^}]*^\}\s*from\s*["']\.\/cycleDiagnostics\.js["'];\s*/gm,
        ''
    );

    output = removeGeometryChangePropertiesDiagnostics(output);
    output = removeFunctionsDiagnostics(output);
    output = removeStatementsDiagnostics(output);
    output = output.replace(
        /from\s+(["'])(\.\/[^"']+?)(?<!-no-diag)\.js\1/g,
        'from $1$2-no-diag.js$1'
    );
    return output
        .replace(/\s*else\s*\{\s*\}/g, '')
        .replace(/\n{3,}/g, '\n\n');
}

function removeFunctionsDiagnostics(source) {
    const pattern = /(?:export\s+)?function\s+\w+Diagnostics\s*\(/g;
    let output = source;
    let match;

    while ((match = pattern.exec(output))) {
        const openingBrace = output.indexOf('{', match.index);
        const end = findBalancedEnd(output, openingBrace, '{', '}');
        output = output.slice(0, match.index) + output.slice(end);
        pattern.lastIndex = match.index;
    }

    return output;
}

function removeStatementsDiagnostics(source) {
    const pattern = /^(\s*)(?:const|let|var)\s+\w*Diagnostics\b|^(\s*)(?:await\s+)?[\w.]*Diagnostics[\w.]*\s*\(|^(\s*)\w*Diagnostics(?:\+\+|--)\s*;/gm;
    let output = source;
    let match;

    while ((match = pattern.exec(output))) {
        const end = findStatementEnd(output, match.index);
        output = output.slice(0, match.index) + output.slice(end);
        pattern.lastIndex = match.index;
    }

    return output;
}

function removeGeometryChangePropertiesDiagnostics(source) {
    const pattern = /^\s*geometryChangeDiagnostics\s*:/gm;
    let output = source;
    let match;

    while ((match = pattern.exec(output))) {
        const comma = findPropertyEnd(output, match.index);
        output = output.slice(0, match.index) + output.slice(comma);
        pattern.lastIndex = match.index;
    }

    return output;
}

function findStatementEnd(source, start) {
    let parentheses = 0;
    let braces = 0;
    let brackets = 0;
    let quote = null;

    for (let index = start; index < source.length; index++) {
        const character = source[index];
        const previous = source[index - 1];

        if (quote) {
            if (character === quote && previous !== '\\') quote = null;
            continue;
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character;
            continue;
        }
        if (character === '(') parentheses++;
        if (character === ')') parentheses--;
        if (character === '{') braces++;
        if (character === '}') braces--;
        if (character === '[') brackets++;
        if (character === ']') brackets--;
        if (
            character === ';' &&
            parentheses === 0 &&
            braces === 0 &&
            brackets === 0
        ) {
            return index + 1;
        }
    }

    throw new Error(
        `Could not find diagnostic statement end at ${start}: ` +
        JSON.stringify(source.slice(start, start + 120))
    );
}

function findPropertyEnd(source, start) {
    let parentheses = 0;

    for (let index = start; index < source.length; index++) {
        if (source[index] === '(') parentheses++;
        if (source[index] === ')') parentheses--;
        if (source[index] === ',' && parentheses === 0) return index + 1;
        if (source[index] === '}' && parentheses === 0) return index;
    }

    throw new Error(`Could not find diagnostic property end at ${start}.`);
}

function findBalancedEnd(source, start, opening, closing) {
    let depth = 0;

    for (let index = start; index < source.length; index++) {
        if (source[index] === opening) depth++;
        if (source[index] === closing) depth--;
        if (depth === 0) return index + 1;
    }

    throw new Error(`Could not find balanced diagnostic block end at ${start}.`);
}

if (require.main === module) buildNoDiagnostics();

module.exports = { buildNoDiagnostics };
