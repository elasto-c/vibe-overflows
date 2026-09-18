
---
title: Welcome to the Markdown Webbook
author: Markdown Webbook
lang: en
---

# Welcome to the Markdown Webbook

This file is a **portable, self-contained Markdown reader**. It is one HTML
file with no server, no account, no build step and no network calls. This
embedded sample book doubles as the manual — drop in your own `.md` file to
read something else.

## Get a document in

There are three ways to load a book, and none of them leave your device:

1. Press the **document** button in the toolbar and pick a `.md` file.
2. Drag a `.md`, `.markdown` or `.txt` file anywhere onto this page.
3. Copy some Markdown and paste it while this welcome screen is showing.

The document you are reading stays on this device, so a refresh or an
accidental close is never a disaster.

## What the reader supports

The engine targets **CommonMark with GitHub Flavored Markdown extensions**:
tables (with alignment), task lists, strikethrough, autolinks and reference
links all render the way your readers expect.

### Text and structure

> Blockquotes can contain **formatted** text.
> > They can even nest.

- Nested lists work
  - like this
    - at any depth
- with `inline code`, *emphasis*, **strong**, and ~~strikethrough~~
- and entities such as © — no more raw `&copy;` text

1. Ordered lists
2. keep their numbers
   - and can nest

### Task lists

- [x] Render task lists correctly
- [ ] Try opening your own `.md` file
- [ ] Adjust the reading settings with the **Aa** button
- [ ] Search the page with <kbd>/</kbd>
- [ ] Export or print it once you are done

These checkboxes are **live**: tick one and your tick is saved on this
device (keyed to this document), so it survives a refresh — and the Markdown
source itself is never modified.

### Tables

| Feature | Supported | Notes |
|:------- |:---------:|------:|
| Alignment | yes | colons in the delimiter row are honoured |
| Empty cells | yes | |
| Wide tables | yes | columns keep a 150px floor and scroll sideways — no scrollbar, just drag or swipe |

### Code

Fenced code is syntax-highlighted for common languages, keeps its language
label, and counts its lines in a slim gutter. Long lines **wrap by default**,
and each block carries its own **Collapse** and **Wrap** controls beside
Copy — fold a long block down to a one-glance window, or flip one block to
horizontal scrolling without touching the others:

```js
// fenced blocks are safe and copyable
const greeting = "hello webbook";
console.log(greeting);
```

```c++
// even languages with a plus sign
#include <iostream>
int main() { return 0; }
```

```bash
# and shell sessions
git log --oneline | head -5
```

### Images

Click any image to view it at full size in a calm overlay — `Esc`, a click,
or the close button returns you exactly where you were. Linked badge images
are left alone so their links keep working.

## Navigating long documents

- The **table of contents** (outline button, top left) is a nested outline
  that tracks your position as you scroll — or press <kbd>T</kbd> to toggle it.
- A thin **progress bar** tagged to the toolbar's bottom edge shows how far
  through the book you are, and a **back-to-top** button appears once you
  have scrolled deep.
- The **command palette** (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd>) jumps
  to any section or runs any action from the keyboard.
- Every heading offers a ¶ permalink on hover, so deep links are one click
  away.
- The browser **back button** takes you out of the document, not to the last
  heading you clicked, and a refresh puts you back where you were.
- If you arrive via a deep link such as
  [jump to the top](#welcome-to-the-markdown-webbook), the reader lands you
  in the right place.
- Press <kbd>Esc</kbd> to close the table of contents.

## Reading comfortably

Press the **Aa** button in the toolbar for the reading settings:

- **Theme** — Light, Dark, or Auto (follows your system setting).
- **Size** — three text sizes.
- **Line height** — three spacing options: S, M and L.
- **Width** — the reading column defaults to a comfortable 68 characters.
- **Typeface** — sans-serif or a classic serif for book-like reading.
- **Header accent** — an optional pastel tint for every heading: none, blue,
  orange, yellow or green.

Every choice is saved on this device and applied without re-rendering the
page. Code blocks wrap long lines by default — each block's own **Wrap**
toggle switches it to horizontal scrolling — and every block has a copy
button with a visible confirmation. Tables keep to the reading column:
long cell content wraps instead of stretching the page.

## Finding things

Press <kbd>/</kbd> (or the search button) and a focused search layer opens
right beneath the toolbar: every match is highlighted, the counter shows
where you are, and <kbd>Enter</kbd> / <kbd>Shift+Enter</kbd> step through
matches. <kbd>Esc</kbd> closes it and restores the text.

For everything else there is the **command palette**
(<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd>): jump to any section or run any
action — open, export, theme, settings — without touching the mouse. Press
<kbd>?</kbd> for the full keyboard map.

## Getting work out

The **document menu** (toolbar, left) holds the export suite, and everything
stays offline:

- **Copy Markdown** — the raw source, ready to paste anywhere.
- **Copy rendered text** — the formatted document as plain text.
- **Download .md** — the source as a file.
- **Export standalone HTML** — this entire reader, with the current document
  baked in, as one portable file you can share or archive.
- **Export publishable HTML** — an exact replica of this entire reader with
  the current document baked in, ready to share or host. A handful of
  authoring tools never travel with a publication: "Open Markdown file…",
  "Edit HTML metadata" and "Export publishable HTML" are removed from its
  document menu, the "Include document menu in publication" switch is gone,
  and the open-file (Ctrl+O) and document-menu rows disappear from its
  shortcut map and key listeners. Everything else — reading settings,
  search, the outline, printing — behaves exactly as it does here.
- **Print / save as PDF** — paper follows your reading settings (theme,
  size, width, typeface, header accent), right down to the page margins,
  with external links expanded so URLs survive on paper.

**Edit HTML metadata** fills in the page title, author and description
written into the exported head, and the **Include document menu in
publication** switch decides whether the published replica shows the
document button and its menu at all — on, it reads like this app; off, the
button and menu are hidden entirely.

## Under the hood

Everything you paste or open is treated as **untrusted input**: rendered
HTML is sanitised, dangerous URL schemes are stripped, and external links
open safely. Rather see pure Markdown output? The reading settings (the
**Aa** button) have a **Raw HTML** switch. The whole application — parser,
reader, and this sample book — lives in this single file, so you can email
it, archive it, or open it from a USB stick in twenty years.

*Happy reading.*
        