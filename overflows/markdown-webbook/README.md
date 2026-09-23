# Markdown Webbook

A complete Markdown reader **and** publisher that lives in one self-contained
HTML file. No install, no server, no network — open `markdown_webbook.html`
in any modern browser (straight from `file://` if you like), import a `.md`
document, and read it with a full set of reader controls. When the document
is ready for an audience, the same file exports a publishable HTML edition
with the authoring tools stripped out.

Everything runs locally. Nothing is uploaded, no fonts or scripts are fetched
at runtime, and reading preferences persist in the browser's `localStorage`.

This repository holds the **readable sources** and the **build script** that
assemble that file. The assembled artifact is committed too, at
`dist/markdown_webbook.html` — one run of `node build.js` reproduces it
byte-identically from the sources, which is exactly what CI checks on every
push.

---

## Why a single file

- **Zero dependencies at runtime.** The Markdown parser (marked) and the
  sanitiser (DOMPurify) are vendored and inlined; there is no CDN, no font
  download and no service worker to register.
- **`file://` first.** Every feature — importing files, exporting, printing,
  settings persistence — is designed to work when the file is opened directly
  from disk, not only from a web server.
- **One artifact to carry.** The reader, the publisher and the app's entire
  runtime ship as a single ~340 KB file that can be emailed, committed to a
  repository, or dropped onto a USB stick.

## Quick start

**Build it yourself** (Node.js ≥ 16, nothing to install):

```bash
node build.js                 # writes ./dist/markdown_webbook.html
```

Then open `dist/markdown_webbook.html` in a browser (double-click it, or
serve it — both work identically).

**Or skip the build:** the assembled artifact is committed at
`dist/markdown_webbook.html` — grab it straight from this repository, from
the project's Releases page, or from any CI run (the workflow uploads the
freshly assembled file on every push).

1. Import a document: click **Open Markdown file…** in the document menu,
   press <kbd>Ctrl</kbd>+<kbd>O</kbd>, or drag a `.md` file onto the page.
2. Read. The table of contents, search, reading settings and export tools are
   one click or keystroke away (see below).

---

## Reading workflow

Once a document is imported, the reader renders it through the inlined
marked + DOMPurify pipeline (CommonMark + GFM: tables, task lists, fenced
code, footnotes-style behaviour, raw-HTML policy) and offers the following
controls:

| Action | How |
|---|---|
| Open a local file | document menu → **Open Markdown file…**, <kbd>Ctrl</kbd>+<kbd>O</kbd>, or drag a `.md`/`.markdown`/`.mdx`/`.txt` file onto the page |
| Open from a url | document menu → **Open from url…** — fetches a `.md`, `.markdown` or `.mdx` file straight from a web address (a network call made only when you trigger it) |
| Paste from clipboard | document menu → **Paste from clipboard** or <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> — renders the most recent clipboard text with a success toast; clipboards that hold no text (an image, a file), empty clipboards and denied permission each surface a specific error toast, never a broken render |
| Table of contents | <kbd>T</kbd> or the contents button — nested headings with scrollspy |
| Command palette | <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd> — jump to headings, run actions |
| Search the document | <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>F</kbd> — with next/previous match navigation |
| Shortcut map | <kbd>?</kbd> — the full keyboard reference |
| Reading settings | <kbd>Aa</kbd> button — theme (light/dark), typeface (serif/sans), text size, measure (line width), line-height (S/M/L), header accent |
| Code blocks | per-block **COLLAPSE** (88 px fading window) and **WRAP** toggles, plus line numbers |
| Tables | columns hold a single line until they would exceed half the container (`--wb-col-cap`, container-query math), then wrap; a genuinely unbreakable line pans a complete table box with hidden scrollbars, mouse drag, and scroll-driven edge shadows that render only while the table actually pans |
| Task lists | checkboxes are live — ticking one persists per document |
| Panels | the contents drawer and the search layer are mutually exclusive — opening one dismisses the other |
| Images | click to open the lightbox |
| Remote media | document menu → **Fetch & embed remote media** (default off): **off** strips image/video/audio urls from every import (file, url, clipboard, dragged text) so the document reads and exports as pure local text; **on** downloads each image at import time and rewrites it as a `data:image/…` uri inside the source, so images survive every export path. The standard image formats are encoded — png, jpg/jpeg, gif, webp, svg (image/svg+xml), bmp, ico and avif — identified **by file extension first** (a recognised ending names the canonical type outright, so svg shipped as `text/xml` embeds), with the content-type allowlist (aliases like `image/jpg` and `image/ico` resolved to their canonical types) plus a magic-byte sniff that covers svg and avif kept as the fallback for unrecognised or missing extensions. Media-ness is decided by the construct a url appears in (markdown image syntax, `<img>`/`<video>`/`<audio>`/`<picture>` tags) — never by file extension — and fenced code blocks and inline code spans are always left untouched. Images that fail to fetch or aren't images keep their original url |
| Progress | slim bottom progress bar tracks reading position |

**Raw HTML policy** is a reading setting (`Raw HTML: Sanitise / Strip`). It
decides what happens to inline HTML in the source: sanitised through
DOMPurify and rendered, or stripped to plain text. The choice is remembered
per document.

**Printing** (Document menu → *Print / save as PDF*, or <kbd>Ctrl</kbd>+<kbd>P</kbd>)
preserves your reading settings — theme colours, typeface, measure and page
margins are reproduced on paper with full-bleed themed backgrounds, and wide
tables/code relax their on-screen constraints so nothing is clipped.

All settings persist per browser under the `mdwb:*` `localStorage` namespace.

## Publishing workflow

The Document menu (the file icon in the toolbar) carries the publishing
pipeline, in menu order:

1. **Edit HTML metadata** — an iOS-style grouped dialog captures the
   publication's **Title**, **Author** and **Description** (grouped in its
   own menu section just below *Print / save as PDF*). These are written
   into the exported file's `<head>` (title tag, author meta, description
   meta), and saving is an exact capture: a field left empty clears its
   entry — the title then reads as **Untitled** — while a captured title is
   applied everywhere the document is named (toolbar, footer, browser tab,
   the form's own placeholder, download naming and every export) and
   survives a refresh.
2. **Fetch & embed remote media** — the import-time media switch described
   above; it shapes what the exported editions contain.
3. **Include document menu in publication** — a toggle that decides whether
   the exported edition shows the document button and menu at all. Off (the
   default posture for a publication) hides both entirely.
4. **Export publishable HTML** — produces an **exact 1:1 replica** of the
   Markdown Webbook itself: same markup, styles, runtime, reading settings,
   code/table/print behaviour. Exactly seven authoring exceptions are
   removed from the replica's document menu — *Open Markdown file…*, *Open
   from url…*, *Paste from clipboard*, *Edit HTML metadata*, *Export
   publishable HTML*, the *Fetch & embed remote media* switch and the
   *Include document menu in publication* switch — so a publication never
   carries a file-open, clipboard-paste, network-fetch or metadata entry
   point. The open-file (<kbd>Ctrl</kbd>+<kbd>O</kbd>), paste-from-clipboard
   (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>) and
   document-menu shortcut entries are removed from its Help panel **and**
   its key listeners. The metadata you entered in step 1 is embedded in
   the head.
5. Share the exported file. It is a standalone publication: self-contained,
   offline, and carrying no authoring tools.

Other export routes in the same menu: **Copy Markdown**, **Copy rendered
text**, **Download .md** (the label follows the imported file's extension —
an `.mdx` import reads **Download .mdx** and downloads exactly the file that
was imported), **Export standalone HTML** (reader shell with the current
document embedded), and **Print / save as PDF**. Imports arrive through
**Open Markdown file…**, **Open from url…**, **Paste from clipboard** or
drag & drop — and every import passes through the media pipeline described
above before it renders.

---

## Building from source

The artifact is **assembled, not maintained by hand**. `build.js` inlines the
payloads listed in its manifest into the document shell, applies the
containment contract, and self-checks the result — the build fails loudly on
any violation.

```bash
node build.js              # assemble ./dist/markdown_webbook.html
node build.js --out PATH   # assemble somewhere else
```

### How assembly works

`src/index.html` is the document shell (chrome, toolbar, dialogs, print
markup). Each inline `<style>`/`<script>` block contains exactly one
`__WB_INLINE_*__` token, replaced byte-exactly with its payload:

| Token | Payload | Treatment |
|---|---|---|
| `__WB_INLINE_JS_BOOT__` | `src/js/boot.js` | containment escape, inline |
| `__WB_INLINE_CSS__` | `src/styles/*.css` (7 sheets) | concatenated verbatim |
| `__WB_INLINE_DOC_DEFAULT__` | `src/content/default-document.md` | verbatim |
| `__WB_INLINE_JS_MARKED__` | `src/vendor/marked.umd.js` | containment escape, inline |
| `__WB_INLINE_JS_PURIFY__` | `src/vendor/purify.min.js` | containment escape, inline |
| `__WB_INLINE_JS_APP__` | `src/js/app.js` | containment escape, inline |

### The containment contract

Two byte sequences can terminate an inline `<script>` early, so every JS
payload passes through an escape pass before inlining:

| Sequence | Escaped as | Why |
|---|---|---|
| `</script` | `<\/script` | a premature close of the script element |
| `<!--` | `<\!--` | the HTML tokenizer's script-data-escaped state |

Both replacements are no-ops for the JavaScript engine, so the running code
is unaffected. The committed sources already carry the escaped forms —
note that the `\` in `/<\/script/gi` is a *regex delimiter escape*, i.e.
mandatory JS syntax — so today the pass is a verified no-op; its job is to
keep future edits safe.

### Self-checks and determinism

Every build asserts that: every token occurs exactly once in the shell and
is replaced; zero unreplaced tokens remain; the artifact holds exactly five
`</script>` closers (boot, default document, marked, purify, app) and the
shell exactly five `<script` openers; the default document contains no
`</script` / `<!--`. The build prints the payload sizes and the artifact's
SHA-256 — identical sources always produce a byte-identical artifact
(LF endings are pinned repo-wide by `.gitattributes`).

The built artifact **is committed** at `dist/markdown_webbook.html` — it is
the project's deliverable, so nobody has to build anything just to read.
Because the build is deterministic, the committed copy also acts as a
constant reproducibility check: CI (`.github/workflows/ci.yml`) rebuilds
from the sources on every push and fails if `dist/` drifts from them
(`git diff --exit-code -- dist/`), then uploads the freshly assembled file.
When you change a source, run `node build.js` and commit the updated
`dist/` artifact together with the source change.

### Verification

The repository includes the verification harness used for every release:

```bash
npm install         # jsdom — dev-only, not needed for the build itself
npm run verify      # node tools/verify_refactor.js
```

This executes the built file inside jsdom (real marked, real DOMPurify, real
app pipeline) and runs **178 checks**: the 44-construct Markdown corpus
(parser correctness, sanitisation policy, embed containment), integration
flows (import, settings persistence, TOC/scrollspy, command palette,
highlighting, lightbox), the publication suite (1:1 replica, authoring
exclusions, metadata round-trip, hostile-content containment), the print
pipeline, the v1.8.0 suite (url import success/failure/loading, mdx
naming, panel exclusivity, z-order), the v1.8.1 suite (menu placements,
embed-toggle persistence, strip/embed media passes, clipboard paste flow and
guards, sanitiser data-uri policy), the v1.8.2 suite (the standard-format
embed allowlist with svg/avif sniffs, the paste keyboard shortcut with its
guards and help-panel row, exact-capture metadata save across every title
surface) and the v1.8.3 suite (extension-first format identification:
standard endings map to canonical types, a recognised extension embeds
whatever the header claims, unrecognised extensions still fall back to
header + sniff). Current status: **178 / 178 pass**.

An optional Chromium visual smoke (`tools/smoke_v183.py`,
`pip install playwright && playwright install chromium`) drives the real
browser across the latest refinements — the menu placements, the url modal's
shell metrics and loading spinner, silent success vs error toasts over
intercepted routes, the extension-aware Download label, clipboard paste with
stubbed clipboard payloads, image embedding into data uris over an
intercepted image route (png plus generic-served svg and avif), the
extension-first identification (a `.svg` url served as `text/xml` embeds,
an extensionless url still sniffs), the
Ctrl/Cmd+Shift+V shortcut with its toasts and help-panel row, the
metadata save flow across tab/toolbar/footer — and screenshots each state.
Current status: **30 / 30 pass**.

## Repository layout

```
markdown-webbook/
├── build.js                                ← the assembler (zero deps, Node ≥ 16)
├── package.json                            ← npm scripts + jsdom dev dependency
├── .github/workflows/ci.yml                ← build + reproducibility check + verify
├── dist/
│   └── markdown_webbook.html               ← the assembled artifact (committed;
│                                             `node build.js` reproduces it byte-identically)
├── src/
│   ├── index.html                          ← document shell with __WB_INLINE_*__ tokens
│   ├── styles/                             ← tokens, base, chrome, content, panels,
│   │                                         states, responsive-print (inlined in order)
│   ├── js/boot.js                          ← pre-paint theme/reading-prefs boot
│   ├── js/app.js                           ← application layer (pipeline, enhancers,
│   │                                         settings, exporter, nav, find, UI)
│   ├── vendor/marked.umd.js                ← vendored marked v18 (UMD)
│   ├── vendor/purify.min.js                ← vendored DOMPurify 3.4 (minified)
│   └── content/default-document.md         ← the built-in sample document
├── docs/
│   ├── markdown_webbook_audit.md           ← the 20-section audit that drove the refactors
│   └── quality-of-life-improvement-plan.md ← milestone plan (M0–M5) + feature proposals
└── tools/
    ├── verify_refactor.js                  ← 178-check jsdom verification harness
    └── smoke_v183.py                       ← Chromium visual smoke (Playwright)
```

## Version history

| Version | Highlights |
|---|---|
| 1.1.0 (P0) | Parser replaced (vendored marked + DOMPurify), import flows, persistence, sanitisation policy, nested TOC + scrollspy, a11y fundamentals — 34 broken constructs → 0 |
| 1.2.0 (P1) | Reader controls (Aa popover), typography tokens, find-in-page, export suite, responsive/touch, reading aids |
| 1.3.0 (P2) | Command palette, syntax highlighter, shortcut overlay, strict raw-HTML mode with per-doc overrides, heading permalinks |
| 1.3.1 | Line-height S/M/L, per-block code Wrap, table fit, bottom progress bar, Safari-style plates, anchored document menu |
| 1.4.0 | Reliability fixes, live task checkboxes, header accent, print settings preservation, image lightbox |
| 1.5.0 | Publication workflow: metadata dialog, publishable export, include-menu toggle, themed print margins |
| 1.6.0 | 1:1 replica publication with authoring exclusions, conditional doc-menu visibility, raw-HTML scroll pin, iOS grouped-list metadata editor |
| 1.7.0 | Meta-panel polish (38/88 px metrics, contenteditable description, inverted Save), code line numbers + COLLAPSE, table column floor/cap with hidden-scrollbar drag |
| 1.7.1 | Help panel zero padding, 6 px vertical rhythm on the description row (label + editor), panel labels follow the theme typeface |
| 1.7.2 | Meta dialog rhythm (top-less form padding, 10 px description margins, borderless pinned header), mobile search field floor, table rework: container-capped columns (single line → wrap past 50 %), complete-table horizontal pan with scroll-driven edge shadows |
| 1.7.3 | Edge shadows only on tables that truly pan (`.is-pannable` measured per render/resize — an inactive scroll timeline would otherwise paint raw gradients on static tables), one shared `.modal-x` close button across modals, panel padding isolation (meta `0`, help `--space-4`) with a coherent 1.05 rem/700 header voice, 720 px find bar tightening (no gap, 30 px buttons, content-sized match count) |
| repo (1.7.3) | Real build process: sources split into `src/` (shell, 7 stylesheets, boot + app layers, vendored marked/DOMPurify, default document) + `build.js` reassembling the artifact byte-identically with the containment escape and self-checks; the artifact is assembled into `dist/` and committed, with CI verifying the committed copy stays byte-identical to the sources |
| 1.8.0 | **Open from url…** (doc-menu entry + meta-panel-style modal: label-less left-aligned url field, spinner loading state on Open, silent success, error toasts for network/HTTP/unsupported-extension/HTML-page/binary cases, http(s)-only with `.md`/`.markdown`/`.mdx` validation, always excluded from publications); `.mdx` imports (file picker + drag & drop + url) treated as Markdown with the download preserving the original name and content; extension-aware **Download .md / .mdx** label in the menu and palette; contents drawer and search layer made mutually exclusive; back-to-top button layered below the contents drawer; removed the never-working paste-into-welcome-screen import (and its mention in the sample document) |
| 1.8.1 | **Paste from clipboard** (doc-menu item below *Open from url…*: clipboard read via the async items API with text/plain type inspection — non-text, empty and denied clipboards each get a specific error toast, text content renders through the media pipeline with the usual success toast) and **Fetch & embed remote media** (doc-menu switch above *Include document menu in publication*, default off): off strips media (image/video/audio) constructs from every import, on fetches each image once at import time (content-type + magic-byte check, per-image failure fallback, dedupe + concurrency pool) and rewrites it into a sanitiser-allowed `data:image/*` uri so exports carry the images; media detection is structural (markdown syntax + media HTML tags), code spans/fences are protected; both new items are always excluded from publications; *Edit HTML metadata* regrouped into its own menu section below *Print / save as PDF* |
| 1.8.2 | **Wider embed format range**: the embed pass encodes the standard image formats — png, jpg/jpeg, gif, webp, svg (image/svg+xml), bmp, ico and avif — through an explicit allowlist that canonicalises aliases (`image/jpg` → jpeg, `image/svg` → svg+xml, `image/ico`/`image/vnd.microsoft.icon` → x-icon), with the magic-byte sniffer extended to svg (xml prolog/doctype + `<svg` root) and avif (`ftyp` box brands avif/avis/av01) for generically-served payloads; **Paste-from-clipboard keyboard shortcut** (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>): same guarded flow as the menu item with success/error toasts, listed in the Help panel, skipped inside editable controls and not installed in publications (row + listener removed); **exact-capture metadata save**: an empty field clears its entry in the store (a cleared title reads as *Untitled*), and the captured title is applied to every surface that names the document — toolbar, footer, browser tab, the form's placeholder, download naming, the publication head — and survives a refresh |
| 1.8.3 | **Extension-first image format identification**: a url whose last path segment ends in a standard format — `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.avif`, case-insensitively, ignoring any query string or fragment — is embedded as that canonical type outright, whatever the response header claims; this fixes svg images (routinely served as `text/xml`/`application/xml`) staying remote urls under the header-first check of 1.8.2. An unrecognised or missing extension falls through to the already-implemented means — the content-type allowlist with its canonical aliases, then the magic-byte sniffer (which also still covers generically-served svg and avif). A fetch that fails, a non-2xx response or an oversized payload still keeps the original url |

## Compatibility

Modern Chromium, Firefox, Safari and Edge. Works from `file://` or any static
host. No network access is required except where you ask for it: the
**Open from url…** fetch requests exactly the address you type, and the
**Fetch & embed remote media** switch fetches exactly the image urls inside
documents you import. **Paste from clipboard** uses the browser's async
clipboard API — most browsers ask for permission on first use, and a denied
prompt (or a clipboard holding no text) surfaces a clear error toast rather
than a broken import. Nothing else ever leaves the device.
