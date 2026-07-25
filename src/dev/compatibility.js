import { compatibilityExtraction } from "./extraction.js";

const MARKUP_PROMPT = `Create one response containing all of the following:
1. A level-2 heading named "Compatibility Results".
2. A sentence containing bold text, italic text, strikethrough text, and inline code.
3. An ordered list with three items.
4. An unordered list with three items.
5. A blockquote.
6. A table with the columns Name and Score and two data rows.
7. A fenced Python code block containing a function with a docstring.
Do not omit or combine any item.`;

const IMAGE_PROMPT = "Generate a simple image containing only a red circle centered inside a blue square. Use a plain white background. Do not include text, labels, diagrams, or any other objects.";

const MARKUP_CHECKS = [
    ["Heading", /^## Compatibility Results$/m],
    ["Bold", /\*\*[^*\n]+\*\*/],
    ["Italic", /(?<!\*)\*[^*\s][^*\n]*\*(?!\*)/],
    ["Strikethrough", /~~[^~\n]+~~/],
    ["Inline code", /`[^`\n]+`/],
    ["Ordered list", /^\d+\. /m],
    ["Unordered list", /^- /m],
    ["Blockquote", /^> /m],
    ["Table", /^\| .+ \|$/m],
    ["Code block", /^```+$/m]
];

export function showCompatibilityCheck(version) {
    const id = "dev-extractor-compatibility";
    const existing = document.getElementById(id);
    if (existing) {
        existing.remove();
        return;
    }

    const panel = document.createElement("div");
    panel.id = id;
    Object.assign(panel.style, {
        position: "fixed",
        top: "20px",
        left: "20px",
        zIndex: "99999",
        width: "460px",
        maxHeight: "85vh",
        overflowY: "auto",
        padding: "14px",
        border: "2px solid #a6e3a1",
        borderRadius: "8px",
        background: "#1e1e2e",
        color: "#cdd6f4",
        fontFamily: "monospace",
        fontSize: "11px",
        lineHeight: "1.5",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)"
    });

    const titleRow = document.createElement("div");
    Object.assign(titleRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px"
    });
    const title = textElement(
        "div",
        `Dev Compatibility Check v${version}`,
        { color: "#a6e3a1", fontWeight: "bold", fontSize: "13px" }
    );
    const close = button("×", () => panel.remove());
    Object.assign(close.style, {
        border: "none",
        background: "none",
        color: "#a6e3a1",
        fontSize: "16px"
    });
    titleRow.append(title, close);

    const structuralHeading = heading("Structural");
    const structuralResults = document.createElement("div");
    const recheck = button("Re-check structure", () =>
        renderStructural(structuralResults)
    );

    const extractionHeading = heading("Latest extraction");
    const extractionResults = document.createElement("div");
    const checkExtraction = button("Check extracted content", () =>
        renderExtraction(extractionResults)
    );

    const conversationHeading = heading("Create a test conversation");
    const instructions = textElement(
        "div",
        "Start a new conversation and send each copied prompt as a separate user message. Run the dev extractor, reopen this panel, then check the extracted content.",
        { color: "#bac2de", marginBottom: "8px" }
    );
    const prompts = [
        ["Copy markup prompt", MARKUP_PROMPT],
        ["Copy image prompt", IMAGE_PROMPT]
    ];
    const promptControls = document.createElement("div");
    for (const [label, prompt] of prompts) {
        const copy = button(label, async () => {
            await navigator.clipboard.writeText(prompt);
            const original = copy.textContent;
            copy.textContent = "Copied";
            setTimeout(() => {
                copy.textContent = original;
            }, 1200);
        });
        copy.style.marginRight = "6px";
        promptControls.appendChild(copy);
    }

    panel.append(
        titleRow,
        structuralHeading,
        structuralResults,
        recheck,
        extractionHeading,
        extractionResults,
        checkExtraction,
        conversationHeading,
        instructions,
        promptControls
    );
    document.body.appendChild(panel);
    renderStructural(structuralResults);
    renderExtraction(extractionResults);
}

function renderStructural(target) {
    target.replaceChildren();
    const container = findScrollContainer();
    const decks = [...document.querySelectorAll("[data-turn-id-container]")];
    const activeDecks = decks.filter(deck =>
        deck.hasAttribute("data-is-intersecting")
    );
    const navigation = navigationButtons();

    addResult(
        target,
        true,
        "Scroll container",
        container === document.documentElement
            ? "documentElement fallback"
            : `${container.tagName.toLowerCase()} scrollHeight=${container.scrollHeight}`
    );
    addResult(
        target,
        document.querySelector("[data-message-author-role]") !== null,
        "[data-message-author-role]",
        `${document.querySelectorAll("[data-message-author-role]").length} mounted`
    );
    addResult(
        target,
        document.querySelector("[data-message-id]") !== null,
        "[data-message-id]",
        `${document.querySelectorAll("[data-message-id]").length} mounted`
    );
    addResult(
        target,
        decks.length > 0,
        "[data-turn-id-container]",
        `${decks.length} mounted`
    );
    addResult(
        target,
        activeDecks.length > 0,
        "data-is-intersecting",
        `${activeDecks.length}/${decks.length} decks expose activation`
    );
    addResult(
        target,
        navigation.length > 0 ? true : null,
        "Prompt navigation",
        navigation.length > 0
            ? `${navigation.length} buttons`
            : "not found; bottom movement still has an absolute-scroll fallback"
    );
    const generatedImages = document.querySelectorAll(
        ".group\\/imagegen-image"
    ).length;
    addResult(
        target,
        generatedImages > 0 ? true : null,
        "Generated-image selector",
        `${generatedImages} mounted now`
    );
}

function renderExtraction(target) {
    target.replaceChildren();
    const state = compatibilityExtraction();
    if (state.count === 0) {
        addResult(target, null, "Extraction state", "run the dev extractor first");
        return;
    }
    addResult(
        target,
        true,
        "Extraction state",
        `${state.count} slabs: ${state.users} user, ${state.assistants} assistant, ${state.unknown} unknown`
    );
    for (const [label, pattern] of MARKUP_CHECKS) {
        addResult(target, pattern.test(state.markdown), label);
    }
    addResult(
        target,
        state.images > 0,
        "Generated image"
    );
}

function findScrollContainer() {
    const message = document.querySelector("[data-message-author-role]");
    let element = message?.parentElement;
    while (element && element !== document.body) {
        const overflow = getComputedStyle(element).overflowY;
        if (
            (overflow === "auto" || overflow === "scroll") &&
            element.scrollHeight > element.clientHeight
        ) {
            return element;
        }
        element = element.parentElement;
    }
    return document.documentElement;
}

function navigationButtons() {
    const strip = [...document.querySelectorAll("div")].find(element =>
        element.className.includes("w-9") &&
        element.className.includes("max-h-[50lvh]") &&
        element.className.includes("no-scrollbar")
    );
    if (strip) return [...strip.querySelectorAll("button")];
    return [...document.querySelectorAll("button")].filter(element =>
        element.className.includes("h-0.5") &&
        element.className.includes("w-4.5") &&
        element.className.includes("rounded-full")
    );
}

function addResult(target, status, label, detail = "") {
    const row = document.createElement("div");
    const marker = status === null ? "[?]" : status ? "[✓]" : "[✗]";
    const color = status === null ? "#f9e2af" : status ? "#a6e3a1" : "#f38ba8";
    row.append(
        textElement("span", marker, { color, fontWeight: "bold" }),
        document.createTextNode(` ${label}`)
    );
    target.appendChild(row);
    if (detail) {
        target.appendChild(textElement(
            "div",
            `    ${detail}`,
            { color: "#6c7086", marginBottom: "2px", wordBreak: "break-word" }
        ));
    }
}

function heading(label) {
    return textElement(
        "div",
        `── ${label} ──`,
        { color: "#89b4fa", marginTop: "10px", marginBottom: "6px" }
    );
}

function button(label, action) {
    const element = document.createElement("button");
    element.textContent = label;
    element.onclick = action;
    Object.assign(element.style, {
        padding: "4px 8px",
        marginTop: "6px",
        marginBottom: "6px",
        border: "1px solid #585b70",
        borderRadius: "4px",
        background: "#313244",
        color: "#cdd6f4",
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: "10px"
    });
    return element;
}

function textElement(tag, text, style = {}) {
    const element = document.createElement(tag);
    element.textContent = text;
    Object.assign(element.style, style);
    return element;
}
