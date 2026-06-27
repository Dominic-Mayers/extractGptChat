# ChatGPT Chat Extractor

A Tampermonkey userscript that exports a full ChatGPT conversation to Markdown by navigating to the first user prompt then scrolling down to the end, waiting for lazy-loaded content to appear at each step, and downloading a `.md` file.

## Features

* Exports ChatGPT conversations as Markdown
* Preserves message roles `USER` and `ASSISTANT`
* Handles long conversations by scrolling automatically — navigates to the first prompt using the navigation menu, then scrolls to the end
* Converts common HTML content to Markdown, including:
  * headings
  * lists
  * code blocks
  * inline code
  * links
  * images
  * tables
  * blockquotes
* Preserves uploaded file references as `Upload: filename` at the top of each user message — filenames remain meaningful even though the files themselves are not included in the export
* Strips interactive UI elements (copy buttons, edit controls, show-more toggles) that have no representation in a plain-text export
* Generates a table of contents at the top of the export, with one entry per user prompt and anchor links to each prompt in the body
* Includes a small in-page control panel
* Supports partial export with a Stop button

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Create a new userscript in Tampermonkey.
3. Paste the contents of `extractChatGpt.js`.
4. Save the script.
5. Open or reload `https://chatgpt.com`.

## Usage

1. Open the ChatGPT conversation you want to export.
2. Open the Tampermonkey menu.
3. Select **Show / Hide Extractor Panel**.
4. Click **Start Extraction** — the script navigates to the first user prompt via the navigation menu, then scrolls down to the end, collecting content at each step.
5. When done, click **Export** to download the Markdown file.

The exported file name is based on the chat title and a timestamp.

## Output Format

The generated Markdown begins with the chat title, prompt count, and export date, followed by a table of contents with one entry per user prompt. Each entry links directly to that prompt in the body of the document.

```markdown
# Chat title
_12 user prompts — 2026-06-11 14:32:10 UTC_

### Table of Contents

1. [First user message text...](#msg-uuid1)
2. [Second user message text...](#msg-uuid2)

---

<a id="msg-uuid1"></a>

### USER

First user message...

---

### ASSISTANT

Assistant response...

---

<a id="msg-uuid2"></a>

### USER

Second user message...

---

### ASSISTANT

Assistant response...

---
```

## Notes

* Extraction speed is limited by ChatGPT's server-side lazy loading. Expect roughly **0.5 seconds per user prompt** — for example, about 4 minutes for a 500-prompt conversation.
* The script depends on ChatGPT's DOM structure. If ChatGPT changes its markup, extraction may need adjustment.

## Troubleshooting

If the export misses content or stops too early:

1. Reload the ChatGPT page.
2. Run the extractor again.
3. Open **Compatibility Check** from the Tampermonkey menu to identify which selectors have changed.

Common causes of issues include:

* Change in ChatGPT markup structure
* Incomplete lazy-loading under heavy network throttling (the 5-second per-step timeout may need increasing)

## Design Model: The Walkway Analogy

For the more precise DOM/deck/slab architecture, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

The extractor can be understood as a **foreman** building a walkway from individual slabs while consulting a **supplier**.

* **Slabs** are ChatGPT messages (user and assistant prompts). They are the pieces that are extracted and assembled into the final transcript.
* **Anchors** are the survey markers driven into the ground at the start of each slab. An anchor is a *point*, not the slab itself — it tells the foreman where a slab begins, but has no width or area of its own.
* **Deck sections** are ChatGPT's internal lazy-loaded containers. They are not part of the transcript; they are structural units used by ChatGPT to manage the DOM.
* **The work zone** is the viewport area where ChatGPT's loading and rendering systems can prepare deck sections.
* **The supplier** is the abstraction over ChatGPT's DOM and rendering systems. It answers operational questions about currently available measurements, deck readiness, slab candidates, and slab readiness.

The foreman's job is simple: build the walkway by repeatedly asking the supplier for the next slab, then recording that slab in the transcript.

The supplier only exposes a changing, partial supply surface. The foreman cannot rely on a complete stable plan of the conversation; it only keeps the current working state, the current slab cursor, and the walkway already built.

Because anchors are identifiers rather than regions, reasoning about their position is usually more reliable than reasoning about their extent. Questions about whether an anchor "covers" or "spans" part of the DOM are usually better reformulated in terms of the slab that begins at that anchor.

The difficulty is that some slabs are located on deck sections that have not yet been prepared by ChatGPT's rendering systems. The extractor cannot force a section to become ready. It can only:

1. Move the work zone (scroll the viewport).
2. Ask the supplier which deck section should become ready next.
3. Wait for ChatGPT to prepare it.
4. Continue walking once the section is ready.

A crucial consequence is that the extractor never attempts to understand the contents of an unprepared section. It only relies on a small set of observable readiness indicators exposed through the supplier.

Most failure modes therefore fall into one of two categories:

* **Preparation failure**: a section never becomes ready despite remaining in the work zone.
* **Detection failure**: the extractor incorrectly determines whether a section is ready.

This model intentionally separates transcript extraction (slabs) from DOM management (deck sections). The exported walkway is the transcript; the hidden conversation and its DOM realization remain behind the supplier abstraction.

## Permissions

The script runs on:

```text
https://chatgpt.com/*
```

It uses:

```text
GM_registerMenuCommand
```

to add the Tampermonkey menu command for showing or hiding the extractor panel.

## Authors

* Claude

## License

MIT
