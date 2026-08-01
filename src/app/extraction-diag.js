import { slabType } from "./slabType-diag.js";

let walkway = [];
let assetCounter = 0;

export const ASSET_MODE_SEPARATE = "separate";
export const ASSET_MODE_EMBEDDED = "embedded";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeLabel = value => value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
const escapeUrl = value => value.replace(/>/g, "%3E");
const escapeHtml = value => value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function resetExtraction() {
    walkway = [];
    assetCounter = 0;
}

export function compatibilityExtraction() {
    const prompts = walkway.flatMap(deck => deck.prompts);
    const pendingImages = walkway.flatMap(deck => deck.images);
    const pendingCanvases = walkway.flatMap(deck => deck.canvases);
    return {
        count: prompts.length,
        users: prompts.filter(prompt => prompt.role === "user").length,
        assistants: prompts.filter(prompt => prompt.role === "assistant").length,
        unknown: prompts.filter(prompt =>
            prompt.role !== "user" && prompt.role !== "assistant"
        ).length,
        images: pendingImages.length,
        canvases: pendingCanvases.length,
        markdown: prompts.map(prompt => prompt.text).join("\n")
    };
}

export function extractionSnapshot() {
    return {
        title: chatTitle(),
        prompts: walkway.flatMap(deck => deck.prompts)
            .map(prompt => ({ ...prompt })),
        images: walkway.flatMap(deck => deck.images)
            .map(image => ({ ...image })),
        canvases: walkway.flatMap(deck => deck.canvases)
            .map(canvas => ({ ...canvas }))
    };
}

export async function waitSlabReady(type, slab, {
    timeout = 30000,
    poll = 100
} = {}) {
    const startedAt = performance.now();
    if (type === "empty") {
        return {
            readinessMs: performance.now() - startedAt,
            decodeMs: 0
        };
    }
    const deadline = Date.now() + timeout;
    while (!isSlabReady(type, slab)) {
        if (!slab.isConnected) {
            throw new Error("Slab detached while waiting for extraction readiness.");
        }
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for ${type} slab extraction readiness.`);
        }
        await sleep(poll);
    }
    const readyAt = performance.now();
    if (type === "image") {
        const image = primaryImage(slab);
        if (typeof image.decode === "function") await image.decode();
    }
    return {
        readinessMs: readyAt - startedAt,
        decodeMs: performance.now() - readyAt
    };
}

export async function compileDeck(deck, slabs) {
    const unit = {
        turnId: deck.getAttribute("data-turn-id-container"),
        height: null,
        prompts: [],
        images: [],
        canvases: []
    };

    for (const slab of [...slabs].reverse()) {
        const type = slabType(slab);
        if (!isSlabReady(type, slab)) {
            const id = slab.getAttribute?.("data-message-id") ??
                slab.id ??
                "synthetic";
            throw new Error(
                `Cannot compile unready ${type} slab ${id}.`
            );
        }
        const prompt = promptFrom(type, slab, unit);
        if (prompt) unit.prompts.push(prompt);
    }

    unit.height = deck.getBoundingClientRect().height;
    return unit;
}

export function compiledDeckFor(turnId) {
    return walkway.find(deck => deck.turnId === turnId) ?? null;
}

export function storeCompiledDeck(unit) {
    const index = walkway.findIndex(deck => deck.turnId === unit.turnId);
    if (index < 0) {
        walkway.unshift(unit);
    } else {
        walkway[index] = unit;
    }
}

export async function exportMarkdown(snapshot, {
    assetMode = ASSET_MODE_SEPARATE,
    timestamp = Date.now()
} = {}) {
    const output = await createMarkdownExport(snapshot, {
        assetMode,
        timestamp
    });

    for (const attachment of output.attachments) {
        downloadBlob(attachment.blob, attachment.filename);
        await sleep(300);
    }

    downloadBlob(
        new Blob(
            ["﻿" + output.markdown],
            { type: "text/markdown;charset=utf-8" }
        ),
        output.filename
    );

    return output;
}

export async function createMarkdownExport(snapshot, {
    assetMode = ASSET_MODE_SEPARATE,
    timestamp = Date.now()
} = {}) {
    const materialized = await materializeExtraction(snapshot, {
        assetMode,
        timestamp
    });
    const { prompts, attachments, title } = materialized;
    const slug = titleSlug(title);
    const date = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const users = prompts.filter(prompt => prompt.role === "user");
    let markdown = `# ${title}\n_${users.length} user prompts — ${date}_\n\n`;

    if (users.length) {
        markdown += "### Table of Contents\n\n";
        users.forEach((prompt, index) => {
            const firstLine = (prompt.plainText || prompt.text).split("\n")
                .map(line => line.replace(/[^\x20-\x7E]/g, "").trim())
                .find(line => line && !line.startsWith("Upload:")) || "(empty)";
            const label = escapeLabel(firstLine.slice(0, 80));
            markdown += prompt.msgId
                ? `${index + 1}. [${label}](#msg-${prompt.msgId})\n`
                : `${index + 1}. ${label}\n`;
        });
        markdown += "\n";
    }

    markdown += "---\n\n";
    for (const prompt of prompts) {
        const label = prompt.role === "user"
            ? "### USER"
            : prompt.role === "assistant"
                ? "### ASSISTANT"
                : "### UNKNOWN";
        const anchor = prompt.role === "user" && prompt.msgId
            ? `<a id="msg-${prompt.msgId}"></a>\n\n`
            : "";
        markdown += `${anchor}${label}\n\n${prompt.text}\n\n---\n\n`;
    }

    return {
        markdown,
        filename: `${slug}-${timestamp}.md`,
        attachments
    };
}

export async function materializeExtraction(snapshot, {
    assetMode = ASSET_MODE_SEPARATE,
    timestamp = Date.now()
} = {}) {
    if (
        assetMode !== ASSET_MODE_SEPARATE &&
        assetMode !== ASSET_MODE_EMBEDDED
    ) {
        throw new Error(`Unknown asset mode: ${assetMode}.`);
    }

    const title = snapshot.title || "chat";
    const slug = titleSlug(title);
    const prompts = snapshot.prompts.map(prompt => ({ ...prompt }));
    const canvases = snapshot.canvases.map(canvas => ({ ...canvas }));
    const attachments = [];
    const replaceToken = (token, replacement) => {
        for (const prompt of prompts) {
            prompt.text = prompt.text.split(token).join(replacement);
        }
        for (const canvas of canvases) {
            canvas.text = canvas.text.split(token).join(replacement);
        }
    };

    for (let index = 0; index < snapshot.images.length; index++) {
        const entry = snapshot.images[index];
        let source = entry.url;
        try {
            if (assetMode === ASSET_MODE_EMBEDDED) {
                source = entry.url.startsWith("data:")
                    ? entry.url
                    : await blobToDataUrl(await fetchAssetBlob(entry.url));
            } else {
                const blob = await fetchAssetBlob(entry.url);
                const extension = extensionForBlob(blob);
                const filename =
                    `${slug}-${timestamp}-img-` +
                    `${String(index + 1).padStart(3, "0")}.${extension}`;
                attachments.push({ blob, filename });
                source = filename;
            }
        } catch (error) {
            console.warn(
                `[dev extraction] image ${index + 1} ` +
                `${assetMode === ASSET_MODE_EMBEDDED ? "embedding" : "download"} failed.`,
                error
            );
        }
        const replacement = assetMode === ASSET_MODE_EMBEDDED
            ? `![${escapeLabel(entry.alt)}](${escapeUrl(source)})`
            : separateImageMarkup(entry, source);
        replaceToken(entry.token, replacement);
    }

    for (let index = 0; index < canvases.length; index++) {
        const entry = canvases[index];
        if (assetMode === ASSET_MODE_EMBEDDED) {
            replaceToken(
                entry.token,
                `#### Canvas: ${entry.title}\n\n${entry.text}`
            );
            continue;
        }

        const filename =
            `${slug}-${timestamp}-canvas-` +
            `${String(index + 1).padStart(3, "0")}.md`;
        attachments.push({
            blob: new Blob(
                ["﻿" + entry.text],
                { type: "text/markdown;charset=utf-8" }
            ),
            filename
        });
        replaceToken(entry.token, `[${entry.title}](${filename})`);
    }

    return {
        title,
        prompts,
        attachments
    };
}

export function isSlabReady(type, slab) {
    if (type === "empty") return true;
    if (type === "canvas") {
        const root = canvasRoot(slab);
        return Boolean(root && dryMarkdownFor(root).trim());
    }
    if (type === "image") {
        const image = primaryImage(slab);
        return Boolean(
            image &&
            image.getAttribute("src") &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.naturalHeight > 0
        );
    }
    if (type === "message") {
        const message = messageRoot(slab);
        if (!message) return false;
        const images = [...message.querySelectorAll("img:not([aria-hidden=\"true\"])")];
        const placeholders = message.querySelectorAll(
            "[class*=\"skeleton\"], [class*=\"placeholder\"], [data-placeholder]"
        );
        return Boolean(
            (message.innerText.trim() || images.length) &&
            placeholders.length === 0 &&
            images.every(image => image.getAttribute("src"))
        );
    }
    throw new Error(`Cannot extract unknown slab type: ${type}.`);
}

function promptFrom(type, slab, unit) {
    if (type === "empty") {
        const deck = slab.deck;
        return {
            role: deck?.querySelector("[data-message-author-role]")
                ?.getAttribute("data-message-author-role") || "unknown",
            text: "*[Empty slab]*",
            plainText: "[Empty slab]",
            msgId: null,
            turnId: deck?.getAttribute("data-turn-id-container") || null
        };
    }
    if (type === "canvas") {
        const root = canvasRoot(slab);
        const text = root ? htmlToMarkdown(root, unit) : "";
        if (!text) return null;
        const titleElement = slab.querySelector(
            "span.font-semibold, [class*=\"font-semibold\"]"
        );
        const title = (titleElement?.textContent || "Canvas document").trim();
        const token = assetToken("CANVAS");
        unit.canvases.push({ title, text, token });
        return promptIdentity(
            slab,
            token,
            title
        );
    }
    if (type === "image") {
        const image = primaryImage(slab);
        const text = image ? htmlToMarkdown(image, unit) : "";
        if (!text) return null;
        return promptIdentity(
            slab,
            text,
            image.getAttribute("alt") || "Generated image"
        );
    }
    if (type === "message") {
        const message = messageRoot(slab);
        if (!message) return null;
        const text = htmlToMarkdown(message, unit);
        if (!text) return null;
        return {
            role: message.getAttribute("data-message-author-role") ||
                message.closest("[data-turn]")?.getAttribute("data-turn") ||
                "unknown",
            text,
            plainText: message.innerText.trim(),
            msgId: message.getAttribute("data-message-id") ||
                slab.getAttribute("data-message-id") ||
                null,
            turnId: message.closest("[data-turn-id]")
                ?.getAttribute("data-turn-id") || null
        };
    }
    throw new Error(`Cannot extract unknown slab type: ${type}.`);
}

function promptIdentity(slab, text, plainText) {
    const turn = slab.closest("[data-turn]");
    return {
        role: turn?.getAttribute("data-turn") || "assistant",
        text,
        plainText,
        msgId: null,
        turnId: turn?.getAttribute("data-turn-id") || null
    };
}

function canvasRoot(slab) {
    return slab.querySelector("#prosemirror-editor-container .ProseMirror");
}

function messageRoot(slab) {
    return slab.matches("[data-message-author-role]")
        ? slab
        : slab.querySelector("[data-message-author-role]");
}

function primaryImage(slab) {
    return slab.matches("img:not([aria-hidden=\"true\"])")
        ? slab
        : slab.querySelector("img:not([aria-hidden=\"true\"])");
}

function dryMarkdownFor(element) {
    const savedAssetCounter = assetCounter;
    const markdown = htmlToMarkdown(element, {
        images: [],
        canvases: []
    });
    assetCounter = savedAssetCounter;
    return markdown;
}

function htmlToMarkdown(element, unit) {
    function walk(node, depth) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (!text.includes("\n")) return text;
            const whiteSpace = node.parentElement
                ? getComputedStyle(node.parentElement).whiteSpace
                : "";
            if (["pre", "pre-wrap", "pre-line"].includes(whiteSpace)) {
                return text.replace(/^/gm, "    ");
            }
            return /^\s*$/.test(text) ? "" : text.replace(/\n/g, " ");
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        if (node.getAttribute("aria-hidden") === "true") return "";
        if (/\bsr-only\b/.test(node.getAttribute("class") || "")) return "";
        if (node.getAttribute("data-is-code-block-view") === "true") {
            const lines = [...node.querySelectorAll(".cm-line")]
                .map(line => line.textContent);
            return fencedCode(lines.join("\n").trimEnd(), "");
        }
        const tag = node.tagName.toLowerCase();
        if (["script", "style", "noscript"].includes(tag)) return "";
        if (tag === "br") return "\n";
        if (tag === "hr") return "\n---\n\n";
        if (tag === "p") return children(node, depth).trim() + "\n\n";
        if (["strong", "b"].includes(tag)) return wrap(node, depth, "**");
        if (["em", "i"].includes(tag)) return wrap(node, depth, "*");
        if (["del", "s"].includes(tag)) return wrap(node, depth, "~~");
        if (/^h[1-6]$/.test(tag)) {
            return `${"#".repeat(Number(tag[1]))} ${children(node, depth).trim()}\n\n`;
        }
        if (tag === "code") {
            if (node.closest("pre")) return node.textContent;
            const text = node.textContent;
            const fence = "`".repeat(longestRun(text, "`") + 1);
            const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
            return `${fence}${pad}${text}${pad}${fence}`;
        }
        if (tag === "pre") {
            const code = node.querySelector("code");
            const language = (code?.className || "").match(/language-(\S+)/)?.[1] || "";
            return fencedCode((code || node).textContent.trimEnd(), language);
        }
        if (tag === "blockquote") {
            return children(node, depth).trim().split("\n")
                .map(line => `> ${line}`).join("\n") + "\n\n";
        }
        if (tag === "ul" || tag === "ol") return list(node, depth, tag === "ol");
        if (tag === "a") {
            if (node.innerText.trim().endsWith("…")) return "";
            const href = node.getAttribute("href") || "";
            const inner = children(node, depth);
            return !href || /^(#|javascript:|blob:)/i.test(href)
                ? inner
                : `[${escapeLabel(inner)}](<${escapeUrl(href)}>)`;
        }
        if (tag === "img") {
            const alt = node.getAttribute("alt") || "";
            const source = node.getAttribute("src") || "";
            if (!source) return alt ? `[image: ${escapeLabel(alt)}]` : "[image]";
            const token = assetToken("IMG");
            const rect = node.getBoundingClientRect();
            unit.images.push({
                url: source,
                token,
                alt,
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            });
            return token;
        }
        if (tag === "button") {
            const label = node.getAttribute("aria-label") || node.innerText.trim();
            return /\.\w{2,6}$/.test(label) ? `\nUpload: ${label}\n\n` : "";
        }
        if (tag === "table") return table(node) + "\n\n";
        const label = node.getAttribute("aria-label");
        if (
            node.getAttribute("role") === "group" &&
            label &&
            /\.\w{2,6}$/.test(label.trim())
        ) {
            return `\nUpload: ${label.trim()}\n\n`;
        }
        return children(node, depth);
    }

    function children(node, depth) {
        return [...node.childNodes].map(child => walk(child, depth)).join("");
    }

    function wrap(node, depth, marker) {
        const inner = children(node, depth).trim();
        return inner ? `${marker}${inner}${marker}` : "";
    }

    function list(element, depth, ordered) {
        let number = 1;
        let output = "";
        for (const item of [...element.children].filter(child => child.tagName === "LI")) {
            const nested = [...item.children].filter(child =>
                child.tagName === "UL" || child.tagName === "OL"
            );
            const inline = [...item.childNodes]
                .filter(child => !nested.includes(child))
                .map(child => walk(child, depth + 1)).join("").trim();
            output += `${"  ".repeat(depth)}${ordered ? `${number++}.` : "-"} ${inline}\n`;
            output += nested.map(child => walk(child, depth + 1).trimEnd() + "\n").join("");
        }
        return output + "\n";
    }

    function table(element) {
        const rows = [...element.querySelectorAll("tr")].map(row =>
            [...row.querySelectorAll("th,td")].map(cell =>
                walk(cell, 0).trim().replace(/\|/g, "\\|").replace(/\n/g, " ")
            )
        );
        if (!rows[0]?.length) return "";
        return [
            `| ${rows[0].join(" | ")} |`,
            `| ${rows[0].map(() => "---").join(" | ")} |`,
            ...rows.slice(1).map(row => `| ${row.join(" | ")} |`)
        ].join("\n");
    }

    return walk(element, 0).trim().replace(/\n{3,}/g, "\n\n");
}

function assetToken(kind) {
    return `__${kind}_PLACEHOLDER_${++assetCounter}__`;
}

function fencedCode(text, language) {
    const fence = "`".repeat(Math.max(3, longestRun(text, "`") + 1));
    return `\n${fence}${language}\n${text}\n${fence}\n\n`;
}

function longestRun(text, character) {
    return Math.max(0, ...[...text.matchAll(new RegExp(`${character}+`, "g"))]
        .map(match => match[0].length));
}

function chatTitle() {
    return document.title
        .replace(/\s*[|–—-]\s*ChatGPT\s*$/i, "")
        .trim() || "chat";
}

function titleSlug(title) {
    return title
        .replace(/[/\\:*?"<>|]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "chat";
}

function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result), {
            once: true
        });
        reader.addEventListener("error", () => reject(reader.error), {
            once: true
        });
        reader.readAsDataURL(blob);
    });
}

async function fetchAssetBlob(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
}

function extensionForBlob(blob) {
    return (blob.type.split("/")[1] || "png")
        .split(";")[0]
        .replace("jpeg", "jpg");
}

function separateImageMarkup(entry, source) {
    const dimensions = entry.width > 0 && entry.height > 0
        ? ` width="${entry.width}" height="${entry.height}"`
        : "";
    const escapedSource = escapeHtml(source);
    return `<a href="${escapedSource}" target="_blank" rel="noopener">` +
        `<img src="${escapedSource}" alt="${escapeHtml(entry.alt)}"` +
        `${dimensions}></a>`;
}
