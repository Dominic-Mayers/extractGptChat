const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

const output = path.join(
    os.tmpdir(),
    `extract-gpt-chat-asset-modes-${process.pid}.cjs`
);

async function testAssetModes() {
    esbuild.buildSync({
        entryPoints: ['src/app/extraction-dev.js'],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        outfile: output
    });

    const {
        ASSET_MODE_EMBEDDED,
        ASSET_MODE_SEPARATE,
        createMarkdownExport
    } = require(output);
    const pixel =
        'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQ' +
        'VR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const snapshot = {
        title: 'Mode Test',
        prompts: [
            {
                role: 'user',
                text: 'hello',
                plainText: 'hello',
                msgId: 'u1',
                turnId: 'u1'
            },
            {
                role: 'assistant',
                text: '__CANVAS__',
                plainText: 'canvas',
                msgId: null,
                turnId: 'a1'
            }
        ],
        images: [{
            url: pixel,
            token: '__IMAGE__',
            alt: 'pixel',
            width: 1,
            height: 1
        }],
        canvases: [{
            title: 'Test Canvas',
            text: 'inside __IMAGE__',
            token: '__CANVAS__'
        }]
    };

    const separate = await createMarkdownExport(snapshot, {
        assetMode: ASSET_MODE_SEPARATE,
        timestamp: 1
    });
    const embedded = await createMarkdownExport(snapshot, {
        assetMode: ASSET_MODE_EMBEDDED,
        timestamp: 1
    });
    const canvasAttachment = separate.attachments.find(
        attachment => attachment.filename.endsWith('.md')
    );
    const canvasText = await canvasAttachment.blob.text();

    assert(separate.attachments.length === 2, 'separate attachment count');
    assert(
        canvasText.includes('<img src="Mode-Test-1-img-001.png"'),
        'separate nested image markup'
    );
    assert(
        separate.markdown.includes(
            '[Test Canvas](Mode-Test-1-canvas-001.md)'
        ),
        'separate Canvas link'
    );
    assert(embedded.attachments.length === 0, 'embedded attachment count');
    assert(
        embedded.markdown.includes('![pixel](data:image/png;base64,'),
        'embedded image markup'
    );
    assert(
        embedded.markdown.includes('#### Canvas: Test Canvas'),
        'embedded Canvas heading'
    );
    assert(
        !embedded.markdown.includes('__IMAGE__') &&
        !embedded.markdown.includes('__CANVAS__'),
        'embedded tokens resolved'
    );
}

function assert(condition, label) {
    if (!condition) throw new Error(`Asset mode test failed: ${label}.`);
}

testAssetModes()
    .finally(() => {
        fs.rmSync(output, { force: true });
    });
