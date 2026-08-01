const fs = require('fs');
const path = require('path');

const sourceDirectory = path.resolve('src/app');
const bootstrapSource = path.resolve('src/bootstrap-diag.js');
const bootstrapOutput = path.resolve('src/bootstrap.js');

function buildNoDiagnosticSources() {
    for (const filename of fs.readdirSync(sourceDirectory)) {
        if (!filename.endsWith('-diag.js')) continue;

        const sourcePath = path.join(sourceDirectory, filename);
        const outputPath = path.join(
            sourceDirectory,
            filename.replace(/-diag\.js$/, '.js')
        );
        const source = fs.readFileSync(sourcePath, 'utf8');
        const output = filename === 'cycleDiagnostics-diag.js'
            ? ''
            : removeDiagnostics(source);

        writeGeneratedFile(outputPath, output);
    }

    writeGeneratedFile(
        bootstrapOutput,
        noDiagnosticBootstrap(
            removeDiagnostics(fs.readFileSync(bootstrapSource, 'utf8'))
        )
    );
}

function writeGeneratedFile(filename, content) {
    if (/Diagnostics/.test(content)) {
        throw new Error(`Diagnostic code remained in ${filename}.`);
    }
    if (fs.existsSync(filename)) fs.chmodSync(filename, 0o644);
    try {
        fs.writeFileSync(filename, content);
    } finally {
        if (fs.existsSync(filename)) fs.chmodSync(filename, 0o444);
    }
}

function noDiagnosticBootstrap(source) {
    return source
        .replace(/__DIAG_USERSCRIPT_VERSION__/g, '__NO_DIAG_USERSCRIPT_VERSION__')
        .replaceAll('Run diagnostic extractor', 'Run extractor')
        .replace('Diagnostic compatibility check', 'Compatibility check')
        .replace('diagnostic traversal', 'extractor');
}

function removeDiagnostics(source) {
    let output = removeDiagnosticImports(source);

    output = removeGeometryChangePropertiesDiagnostics(output);
    output = removeFunctionsDiagnostics(output);
    output = removeConditionalBlocksDiagnostics(output);
    output = removeStatementsDiagnostics(output);
    output = output.replace(
        /from\s+(["'])(\.\/[^"']+?)-diag\.js\1/g,
        'from $1$2.js$1'
    );
    return output
        .replace(/\s*if\s*\([^)]*\)\s*\{\s*\}/g, '')
        .replace(/\s*else\s*\{\s*\}/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd() + '\n';
}

function removeDiagnosticImports(source) {
    return source.replace(
        /import\s*\{([\s\S]*?)\}\s*from\s*(["'][^"']+["']);/g,
        (statement, imported, moduleName) => {
            const retained = imported
                .split(',')
                .map(name => name.trim())
                .filter(Boolean)
                .filter(name => !/Diagnostics/.test(name));
            if (retained.length === 0) return '';
            return `import {\n    ${retained.join(',\n    ')}\n} from ${moduleName};`;
        }
    );
}

function removeConditionalBlocksDiagnostics(source) {
    const pattern = /\bif\s*\(/g;
    let output = source;
    let match;

    while ((match = pattern.exec(output))) {
        const openingParenthesis = output.indexOf('(', match.index);
        const conditionEnd = findBalancedEnd(
            output,
            openingParenthesis,
            '(',
            ')'
        );
        if (!output.slice(openingParenthesis, conditionEnd)
            .includes('Diagnostics')) {
            pattern.lastIndex = conditionEnd;
            continue;
        }
        const openingBrace = output.indexOf('{', conditionEnd);
        const end = findBalancedEnd(output, openingBrace, '{', '}');
        output = output.slice(0, match.index) + output.slice(end);
        pattern.lastIndex = match.index;
    }

    return output;
}

function removeFunctionsDiagnostics(source) {
    const pattern = /(?:export\s+)?(?:async\s+)?function\s+\w+Diagnostics\s*\(/g;
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
    const pattern = /^(\s*)(?:const|let|var)\s+\w*Diagnostics\b|^(\s*)[\w.]*Diagnostics[\w.]*\s*=|^(\s*)(?:await\s+)?[\w.]*Diagnostics[\w.]*\s*\(|^(\s*)\w*Diagnostics(?:\+\+|--)\s*;/gm;
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

if (require.main === module) buildNoDiagnosticSources();

module.exports = { buildNoDiagnosticSources };
