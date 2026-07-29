# ChatGPT Chat Extractor

A Tampermonkey userscript that exports a full ChatGPT conversation to Markdown by starting
at the bottom and traversing upward through ChatGPT's lazy-loaded content.

## Features

* Exports ChatGPT conversations as Markdown
* Preserves message roles `USER` and `ASSISTANT`
* Handles long conversations by scrolling automatically through ChatGPT's virtualized conversation
* Converts common HTML content to Markdown, including:
  * headings
  * lists
  * code blocks
  * inline code
  * links
  * images
  * tables
  * blockquotes
  * strikethrough
* Preserves uploaded file references as `Upload: filename` at the top of each user message — filenames remain meaningful even though the files themselves are not included in the export
* Strips interactive UI elements (copy buttons, edit controls, show-more toggles) that have no representation in a plain-text export
* Generates a table of contents at the top of the export, with one entry per user prompt and anchor links to each prompt in the body
* Downloads generated images and Canvas/textdoc documents as companion files and links them from the transcript
* Includes a compatibility check for the DOM selectors and extracted markup

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Create a new userscript in Tampermonkey.
3. Paste the contents of `extractChatGpt.js`.
4. Save the script.
5. Open or reload `https://chatgpt.com`.

## Usage

1. Open the ChatGPT conversation you want to export.
2. Open the Tampermonkey menu.
3. Select **Run extractor**.
4. Wait for traversal to finish. The Markdown file and any companion image or Canvas files download automatically.

The exported file name is based on the chat title and a timestamp. Generated images and Canvas/textdoc files use the same title and timestamp prefix.

## Performance

Five repeat runs over a conversation containing 174 user prompts and 368 total slabs completed in approximately 43–51 seconds. That is about **0.25–0.29 seconds per user prompt**, or **0.12–0.14 seconds per slab** for that conversation.

These measurements are a practical baseline, not a fixed rate. Runtime depends on message length, the number of anchors needed for long slabs, ChatGPT's virtualization behavior, browser layout work, and asset downloads.

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

* Extraction starts at the bottom of the conversation and walks upward. Entries are inserted into the result in reverse discovery order so the exported transcript remains chronological.
* The script depends on ChatGPT's DOM structure. If ChatGPT changes its markup, extraction may need adjustment.

## Troubleshooting

If the export misses content or stops too early:

1. Clear the browser cache, then hard reload the ChatGPT page.
2. Minimize CPU contention by closing or pausing other CPU-intensive tabs and applications.
3. Run the extractor again.
4. Open **Compatibility check** from the Tampermonkey menu to identify which selectors or markup conversions have changed.

Common causes of issues include:

* Change in ChatGPT markup structure
* A deck, slab, image, or Canvas surface that does not become ready before its operation-specific timeout

## Design Model: The Walkway Analogy

For the more precise DOM/deck/slab architecture, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

The extractor can be understood as a **foreman** directing work in a changing
supply area and building a walkway from the content extracted there. The
**supplier** employs workers who act on the physical supplies. The walkway is
only the accumulated Markdown output; it is not the place where the workers
prepare or move supplies.

The supply model runs from broadest to finest: **supply area → active area →
ready area → decks → slabs → anchors**. This is a progression from broad scope
to fine detail, not strict containment: a deck or slab can straddle the ready
area. The viewport/work zone moves across the model and causes activation.

* **Slabs** are ordinary messages, generated images, Canvas/textdoc blocks, or explicit empty turn placeholders. They are physical content units in the supply area whose extracted representations are assembled into the final transcript.
* **Message slab selectors** identify ordinary message slabs. `[data-message-id]` discovers an ordinary slab; extraction then resolves its `[data-message-author-role]` content scope.
* **Deck sections** are ChatGPT's internal lazy-loaded containers. They are not part of the transcript; they are structural units used by ChatGPT to manage the DOM.
* **The work zone** is the viewport area moving over the supply area where ChatGPT's loading and rendering systems can prepare deck sections.
* **The supplier** is the abstraction over ChatGPT's DOM and rendering systems. Its workers select and act on physical supplies while reporting measurements, deck activation, slab candidates, and operation-specific readiness.

The foreman's job is to guide traversal using the geometry reported by the
workers. A worker may retain the current physical deck, slab, or anchor while
acting on it, but the foreman knows only distances and heights. Once a slab has
been prepared and traversed, its extracted content is recorded in the
walkway.

The supplier only exposes a changing, partial supply surface. The foreman
cannot rely on a complete stable plan of the conversation; it keeps geometric
traversal state and the walkway already built. Physical references retained by
the workers remain behind the supplier boundary.

Other slab types, such as generated images and Canvas/textdoc blocks, need their own selectors. They should not be forced into the ordinary-message selector model.

The difficulty is that some slabs are located in deck sections that are not yet
active, while others are in active sections whose required detail is not yet
ready. The extractor cannot force either transition. It can only:

1. Move the work zone (scroll the viewport).
2. Ask the supplier which deck section should become active next.
3. Wait for activation, then for the operation-specific ready area it needs.
4. Continue walking once the relevant slab or anchor is ready.

The foreman also assumes that the work zone cannot be teleported safely across
the supply area. The supplier depends on external workers that appear to
respond reliably to ordinary incremental scrolling, not to one large jump into
unprepared territory. A large jump can skip the intermediate activation work
that ChatGPT's virtualized renderer expects. Therefore the extractor moves the
work zone in small jumps and checks local stability between jumps.

This warning is about the extractor's scripted scroll movement. It does not mean every large viewport change is equivalent. Clicking a conversation navigation item or using the scrollbar may invoke different ChatGPT/browser positioning behavior. In the analogy, that is a different supplier service, not simply the foreman taking a larger step.

Layout stability is only one safeguard. The extractor also:

* waits separately for deck activation and slab-type-specific content
  readiness;
* supervises calibrated jumps with a ready anchor near the viewport top while
  independently limiting movement by the current slab top;
* retries a jump once when the retained anchor returns exactly to its pre-jump
  position;
* rechecks the height of compiled decks immediately before a jump can
  deactivate them, recompiling any deck that grew because of late rendering;
* revalidates every slab during deck compilation; and
* stops on disconnected physical references, readiness timeouts, repeated jump
  erasure, or failure to stabilize instead of silently continuing.

These safeguards are complementary. In particular, late rendering may occur
after an earlier readiness decision. The pre-deactivation height check is what
allows a newly rendered Canvas or other added content to replace the earlier
compiled walkway unit before ChatGPT removes that deck's rendered section.

A crucial consequence is that the extractor never attempts to understand the contents of an unprepared section. It only relies on a small set of observable readiness indicators exposed through the supplier.

Most failure modes therefore fall into one of two categories:

* **Preparation failure**: a section never becomes ready despite remaining in the work zone.
* **Detection failure**: the extractor incorrectly determines whether a section is ready.

This model intentionally separates work on the live supply area from
construction of the exported walkway. The exported walkway is the transcript;
the physical slabs, deck sections, anchors, and other details of the hidden
conversation's DOM realization remain behind the supplier abstraction.

## Permissions

The script runs on:

```text
https://chatgpt.com/*
```

It uses:

```text
GM_registerMenuCommand
```

to add Tampermonkey menu commands for running extraction and opening the compatibility check.

## Authors

* Claude

## License

MIT
