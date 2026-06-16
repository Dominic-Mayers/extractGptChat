# ChatGPT Chat Extractor

A Tampermonkey userscript that exports a full ChatGPT conversation to Markdown by scrolling through the conversation in both directions from the current position, waiting for lazy-loaded content to appear at each step, and downloading a `.md` file.

## Features

* Exports ChatGPT conversations as Markdown
* Preserves message roles `USER` and `ASSISTANT`
* Handles long conversations by scrolling automatically — can start from any position in the conversation
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
4. Click **Start Extraction** — the script scrolls down to the end, returns to where you started, then scrolls up to the beginning, collecting content at each step.
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
