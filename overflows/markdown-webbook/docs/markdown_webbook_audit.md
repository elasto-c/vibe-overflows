# Markdown Webbook — Product Quality, QoL & Rework Audit

| | |
|---|---|
| **Subject** | `markdown_webbook.html` — portable single-file Markdown viewer/webbook (~970 lines, ~37 KB, zero dependencies) |
| **Date** | 2026-09-17 |
| **Audience** | Engineering team planning the rework |
| **Method** | Full static review of HTML/CSS/JS **plus** empirical verification: the shipped parsing pipeline was extracted and executed against a 44-construct real-world Markdown corpus (fenced code variants, nested lists, GFM tables, inline edge cases, heading identity, raw HTML). Results: **34 broken, 3 partial, 7 OK.** Corpus IDs (`B01`, `I11`, `R02`, `T02`…) are referenced throughout; the full checklist is Appendix A. |
| **Evidence style** | Behaviour-level. Findings describe observed output behaviour rather than quoting implementation internals. |
| **Headline verdict** | The reading shell is a good product seed; the parsing engine and the document lifecycle are not yet products. Replace the parser (do not patch it), build the import/export/lifecycle layer, and add the reader-facing controls that define a *reading environment*. |

**Contents**

1. [Executive Summary & Scorecard](#1-executive-summary--scorecard) · 2. [Existing Implementation Audit](#2-existing-implementation-audit) · 3. [Product Definition & Personas](#3-product-definition--personas) · 4. [Creation, Import & Document Lifecycle](#4-creation-import--document-lifecycle) · 5. [Export & Portability](#5-export--portability) · 6. [Markdown Support & Parser Verdict](#6-markdown-support--parser-verdict) · 7. [Reading Experience & Typography](#7-reading-experience--typography) · 8. [UI/UX & Interaction Design](#8-uiux--interaction-design) · 9. [Navigation & Long-Document Ergonomics](#9-navigation--long-document-ergonomics) · 10. [Desktop, Tablet & Mobile](#10-desktop-tablet--mobile) · 11. [Accessibility](#11-accessibility) · 12. [Visual Design & Polish](#12-visual-design--polish) · 13. [Code Blocks & Rich Content](#13-code-blocks--rich-content) · 14. [Security & Reliability](#14-security--reliability) · 15. [Performance & Portability](#15-performance--portability) · 16. [Architecture & Rework Opportunities](#16-architecture--rework-opportunities) · 17. [Prioritised Roadmap](#17-prioritised-roadmap-p0p3) · 18. [Final Target State](#18-final-target-state) · [Appendix A: Verification Corpus & Test Checklist](#appendix-a-verification-corpus--test-checklist) · [Appendix B: Module Boundaries & Hand-off Notes](#appendix-b-module-boundaries--hand-off-notes)

---

## 1. Executive Summary & Scorecard

The Markdown Webbook is currently a **competent reading shell wrapped around a fragile engine**. The chrome — toolbar, overlay table of contents, theme system, toast feedback — is cleanly built, visually restrained, and dependency-free. Beneath it, however, the custom Markdown pipeline fails the majority of real-world constructs it will meet outside the author's own test documents: in verification, **34 of 44 common constructs rendered incorrectly or not at all**, including several (nested code fences inside tables, duplicate or non-ASCII heading names, `javascript:` links) that either destroy content silently or create a genuine security exposure.

Three findings dominate everything else. **First, the parser must be replaced, not refined.** Its block model assumes constructs are separated by blank lines and hoists code fences out of context before parsing; both assumptions are load-bearing, so every "fix one construct" patch fights the architecture. A vendored, battle-tested parser (marked + DOMPurify, inline in the file) eliminates the entire defect class for roughly 60 KB and three days of work. **Second, the product has no import path.** The only way to load content is to hand-edit the HTML source — and any document containing a literal closing script tag breaks the page itself. A reading environment you cannot load a `.md` file into is not yet a reading environment. **Third, the reading experience is fixed.** One width (≈90–100 characters per line — well past comfortable measure), one type size, one family, a manual theme toggle, no search, no scroll feedback, no reader presets. These are the features that make a *reader* rather than a demo.

| Area | Score | Verdict |
|---|---|---|
| Markdown parsing & rendering | **2 / 10** | Fails 34/44 verified real-world constructs; architecture cannot be incrementally fixed |
| Import & document lifecycle | **1 / 10** | No file open, drag-drop, paste, persistence, recents, or recovery |
| Export & portability | **3 / 10** | Raw copy + `.md` download only; no standalone HTML export, no print styling |
| Reading experience & typography | **4 / 10** | Good defaults instincts, but fixed measure/size/family; no reader controls |
| Navigation & TOC | **3 / 10** | Flat list, no active-section tracking, history pollution, duplicate/empty heading IDs |
| UI/UX & interaction | **5 / 10** | Clean composition; undersized touch targets, no empty/loading/error states, no keyboard layer |
| Responsive & touch | **4 / 10** | Single breakpoint; breakpoint mismatch between CSS and JS; clipping instead of wrapping |
| Accessibility | **3 / 10** | Unlabelled controls, no live regions, no focus management, reduced motion ignored |
| Visual design & polish | **6 / 10** | Coherent token-based palettes; consistency gaps (hr, h5/h6, radii, footer) |
| Code blocks & rich content | **3 / 10** | Copy-button chrome is nice; no highlighting, fragile language handling |
| Security & reliability | **4 / 10** | Escape-first instinct is right, but URL schemes unfiltered; zero error handling |
| Performance & portability | **7 / 10** | Instant startup, zero network; budgets need protecting through the rework |
| Maintainability & testability | **6 / 10** | Readable, consistently formatted, single-purpose objects; no tests, no layering |

**Effort to target state:** P0 ≈ **21 person-days** (dependable core), P1 ≈ **17** (product quality), P2 ≈ **8** (advanced), P3 ≈ **4** (optional) — **~50 person-days total** to reach the specification in §18, assuming one experienced engineer and no build step.

---

## 2. Existing Implementation Audit

### 2.1 Architecture inventory

| Layer | What exists today | Maturity |
|---|---|---|
| Content embedding | Markdown authored by hand into two embedded script blocks (a title block and a content block) | Prototype |
| Parsing | Custom two-phase pipeline: code fences extracted first via a single regex, remaining text split on blank lines, each block dispatched by leading-character heuristics | Fragile |
| Inline rendering | Ordered chain of global regex replacements applied after HTML-escaping | Fragile |
| Rendering | Output strings concatenated and assigned to the page in one operation | Acceptable at this size; no phasing |
| UI chrome | Toolbar (TOC toggle, document title, theme, copy, download), overlay sidebar, toast, footer | Good bones |
| State | Theme preference in localStorage; every other state lives implicitly in CSS classes | Ad hoc |
| Navigation | Flat TOC list, manual scroll-offset arithmetic, a history entry pushed per heading click | Partial |
| Theming | CSS custom properties, light/dark palettes, OS-preference detection on first load | Good foundation |
| Responsive | One breakpoint at 600px; a second, different threshold (800px) in JS behaviour | Minimal |
| Error handling | None — no failure states, no clipboard fallbacks, no init protection | Missing |
| Persistence | Theme only | Missing |
| Export | Copy raw Markdown; download `.md` | Minimal |
| Tests | None | Missing |

### 2.2 What is already right

Credit where the prototype earns it, because the rework should preserve these properties. The inline renderer **escapes HTML before constructing attributes**, which means quoted document content cannot break out of attribute contexts today — the right instinct, and the rework must keep it under the new parser. Dynamic elements (per-block copy buttons) use **event delegation** rather than per-element wiring. Headings carry **scroll margin** so anchor jumps clear the sticky toolbar — small, correct detail. Theming is **token-based**, with two coherent, GitHub-adjacent palettes and a translucent blurred header; the visual language is restrained rather than decorative. The whole thing is a **single file with zero network requests** — instant startup, fully offline, file://-first — and it respects the OS colour-scheme preference on first load. These are exactly the qualities the finished product needs; none of them need to be sacrificed to fix the rest.

### 2.3 Where it breaks (verified)

**The blank-line block model.** The parser assumes document blocks are separated by blank lines, then classifies each block by its first characters. Real-world "compact" Markdown violates this constantly: a heading with a paragraph immediately beneath it loses the heading entirely and renders as one merged paragraph (`B11`); two same-level headings without a blank line between them vanish as headings (`R13`); a heading followed directly by a list collapses the whole thing into text (`B12`); setext-style underlined headings are demoted to paragraphs (`B10`). Horizontal rules only work when the block is *exactly* `---` or `***` — the extremely common `-----`, `- - -`, and `___` forms all fail (`B13`). YAML frontmatter — ubiquitous in docs and books — leaks into the page as visible text (`B14`), and optional closing hashes on headings render literally (`B15`).

**Fence hoisting.** Code fences are removed from the document by one unanchored regex before any block parsing happens. Consequences: a language token containing `+` or `-` (`c++`, `objective-c`) or a trailing space after the language defeats recognition, and the entire block degrades to visible literal text including the backticks (`B01`, `B02`); tilde fences are unsupported (`B03`); longer fences leave stray backticks in the output (`B04`); an unclosed fence degrades the rest of the section (`B08`) instead of consuming to end-of-document as CommonMark does. Because fences are ripped out of context rather than parsed in place, **structure around them breaks**: a numbered list whose step contains a code block continues as a *new* list restarting at 1 (`R01`), and a fence inside a table cell destroys the row outright — the cell content vanishes and the code block detaches below the table (`R02`). The hoisting sentinel is a human-readable token; whenever it lands inside another construct it can surface in the visible output.

**Lists.** Nesting is flattened — indented child items become same-level items with indentation stripped (`B16`); a blank line inside a list splits it into two separate lists (`B17`); the `1)` numbering style is unsupported (`B18`); a list starting at `5.` renumbers from 1 (`B19`); task markers leak literally when they appear mid-list (`B20`, `R15`); uppercase `[X]` checkboxes defeat task-list detection entirely (`B21`); and a child line inside a task-list item is rendered as *another task item*, checkbox included, with its list marker showing as text (`R08`).

**Blockquotes.** Quote content is never re-parsed as blocks: a heading inside a quote shows a literal `#` (`B22`), nested quotes flatten (`B23`), and multi-paragraph quotes lose their paragraph breaks.

**Tables.** Only pipe-*leading* tables are recognised (`B25`). Empty cells are silently dropped, so **columns shift left and data mis-aligns without any error** — the most dangerous failure mode in the pipeline because it corrupts meaning rather than appearance (`B24`). Alignment colons are ignored (`B26`), and escaped pipes inside cells split the cell (`B27`).

**The inline chain.** Formatting is applied by ordered regex passes *after* escaping, with code spans processed **last** — so emphasis, strikethrough, and link syntax inside inline code get converted: a code span containing `a * b * c` comes out italicised inside the code style (`I04`, `I05`). Intraword underscores italicise identifiers: `file_name_v2` renders as "file*name*v2" and `__dunder__` becomes bold (`I03`). Bold+italic combinations produce **misnested HTML** — `***x***` emits `<strong><em>x</strong></em>` (`I01`), and nested emphasis produces structurally invalid markup (`I02`). Backslash escapes are not honoured (`I06`). HTML entities are double-escaped, so `&copy;`, `&mdash;`, `&nbsp;` display as raw text (`I07`). Reference links and autolinks are unsupported (`I08`, `I09`). URLs containing parentheses — every Wikipedia link — have their `href` truncated at the first `)`, producing broken links (`I10`). Link titles are swallowed into the URL (`R11`), and empty link text produces invisible links (`R10`).

**Links and URLs.** Every link, *including same-document anchor links*, is forced to open in a new tab (`R04`) — clicking an in-page jump spawns a second copy of the book. External links lack `rel="noopener"`. Relative links to sibling `.md` files dead-end silently (`R05`) — a real product gap for a "webbook," discussed in §4.

**Heading identity.** Duplicate heading names collide on the same `id`, so TOC links always jump to the first occurrence (`T01`). Non-ASCII headings — the entire CJK and accented-Latin world — produce **empty `id` attributes**; a Chinese-language document gets a completely non-functional TOC (`T02`). Slugs are derived from raw Markdown text, so headings containing links or code diverge from their visible text (`T03`).

**Navigation behaviour.** There is no active-section highlighting (no scrollspy), the TOC is a flat list rather than a nested tree, and each TOC click pushes a history entry, so the back button walks through every heading the reader visited. The drawer-closing logic in JS keys off 800px while the CSS switches to a full-width drawer at 600px — two disagreeing thresholds for "mobile."

**State and error handling.** There is no `try/catch` anywhere. Clipboard writes have no fallback and no rejection handling — in any context where the clipboard API refuses permission, copy does nothing, with no feedback. Any exception during initialisation leaves a permanently blank page. The product has no empty, loading, or error states at all.

**Vestigial and unfinished details.** A transform transition on the content container that nothing ever triggers; TOC indentation styles that stop at level 4 while headings go to level 6; the `hr` element has no stylesheet rule and renders as the browser-default bar; `h5`/`h6` fall back to inconsistent UA styles; the footer prints "- EOF -" and the default toast reads "Action Complete."

### 2.4 Why incremental patching stops here

Every block-level classification keys off the blank-line split, and fence hoisting happens *before* that split. Supporting compact blocks, loose lists, and true nesting means replacing the tokeniser with line-based, consumer-driven parsing — which is simply a CommonMark implementation. Building one in-house is weeks of work followed by a permanent correctness tail (the CommonMark spec has 600+ edge-case tests); adopting a maintained, spec-compliant library is kilobytes and deletes the defect class. This is the clearest possible case for **replace rather than refactor**, and it is the anchor decision of the roadmap (§6, §16).

---

## 3. Product Definition & Personas

> A portable, self-contained Markdown **reading environment** that opens directly from disk in any modern browser, can be loaded with Markdown content in seconds, customised for comfortable long-form reading, and used with no server, account, build step, or network.

Three people use this product, and today two of them cannot.

**The author/importer** wants a finished `.md` to become a readable artefact fast. Today they must open the HTML in an editor, paste Markdown into an embedded script block by hand, and hope it contains no closing-script-tag text (which breaks the page) and no constructs from §2.3 (most of which render wrong). There is no metadata beyond a separate hand-edited title block, and the fallback title logic truncates to twelve characters mid-word. Their goal for the rework: **open a `.md` file in under five seconds, with the title, language, and structure derived automatically.**

**The reader** wants comfort over a long sitting. Today they get one fixed measure of roughly 90–100 characters per line (well past the 45–75 comfort band), one type size, one family, a manual light/dark toggle, a TOC that gives no indication of where they are, no search, and no way to jump back to top. Their goal: **presets for width, size, family, and theme that persist, plus navigation that always answers "where am I?"**

**The power user** brings large technical documents — code-heavy chapters, wide tables, deep heading trees, keyboard-first habits. Today: no syntax highlighting, no find-in-page, no keyboard shortcuts, tables that mis-align on empty cells, and code blocks whose content can be corrupted by surrounding formatting. Their goal: **dependable rendering at scale, search, and a keyboard path for every common action.**

**Design principles for the rework.** Correctness before features — a reader that mis-renders the book has no features. The reader chrome is quiet until summoned. The file is the platform: single self-contained HTML, zero network, file://-first, and every new capability must survive being emailed as an attachment. Presets over sliders — meaningful choices, sensible defaults. Degradation with dignity — every feature that can fail (clipboard, print, quota) falls back to something useful and says so.

---

## 4. Creation, Import & Document Lifecycle

The lifecycle is the biggest missing product surface. It should be designed as a small state machine — **empty → loading → reading → (replacing) → error** — with every transition user-initiated or clearly announced.

**Import paths, in priority order.** (1) *Open* button and keyboard shortcut → native file picker accepting `.md`, `.markdown`, `.txt`. (2) *Drag-and-drop* anywhere onto the window, with a full-window drop zone that appears on `dragover` (today there is no drop affordance at all). (3) *Paste* Markdown from the clipboard into the empty state or via a Paste command. (4) *URL parameter* (`?src=`) — only meaningful when served over http(s); when opened from `file://`, fetching sibling files is blocked by browser security, and the app should say so honestly rather than fail silently. (5) *Improved embedding* for authors who want content baked into the file: keep the embedded-script approach but escape closing-script sequences when generating embeds (§14), and treat it as the "publish" path rather than the primary reading path.

**Replace and new.** Loading a document while one is open must confirm (native confirm in v1 is acceptable) — imported content is user data and today's product has no concept of it being lost. "New document" creates a blank state with a prompted title. Neither concept exists today because nothing can be loaded.

**Persistence and recents.** Persist the currently loaded imported document to localStorage automatically (with a size guard — localStorage caps around 5 MB; above the guard, keep the session in memory only and say so in the document bar). Maintain a **Recent documents** list (title, timestamp, size, source type) capped at ~10 entries, surfaced in the empty state and the overflow menu. On launch with no embedded document, restore the last document and toast "Restored *Title*". This makes refresh and accidental-close lossless — the "recovery after navigation" requirement — and removes the need for an aggressive `beforeunload` guard (keep one only for the not-yet-persisted window between import and first save).

**Metadata model.** Derive document metadata with explicit precedence: YAML frontmatter (strip it from the body; support `title`, `author`, `date`, `lang`) → first H1 → filename → "Untitled". Feed the result to the browser tab title, the header title, the download filename, the `html lang` attribute (an accessibility win for non-English books), and the TOC. Today's separate title block and 12-character fallback disappear into this model.

**Large documents and failure modes.** Parsing a multi-megabyte document is fine; *rendering* it in one assignment is what janks. Render in phases with a progress indicator for documents above ~500 KB (§16, rework 4), and warn above ~2 MB. Binary or undecodable files are rejected with a clear toast, not a blank screen. The parser should never throw on any input, but wrap it anyway and route failures to a visible error state.

**Relative paths and local assets, stated honestly.** A `file://` webbook cannot resolve sibling image files — browser security, not an implementation gap. The rework should render a visible fallback (alt text with a quiet "unavailable when opened from disk" style) instead of a broken-image icon, show the first-run hint once, and support full relative-asset resolution when the file is served over http(s). Pretending otherwise (today: broken icons) is worse than a truthful one-line note.

---

## 5. Export & Portability

Export is how the product keeps its promises; treat it as first-class.

| Capability | Status today | Plan |
|---|---|---|
| Copy raw Markdown | Present; silently fails where clipboard is blocked | Keep; add `execCommand` fallback + success/error feedback |
| Download `.md` | Present; filename from weak 12-char title | Keep; filename from metadata model (§4) |
| Copy rendered text | Missing | New — plain-text clipboard write of the rendered document (for email/notes) |
| **Export standalone HTML** | Missing | **New flagship** — serialise app shell + current document into a fresh, fully self-contained HTML file that keeps TOC, theme, and reader settings; zero external references |
| Print / PDF | Missing | New print stylesheet (below); browser Print→PDF is the dependable PDF path |
| Share link / hosted sync | — | Explicitly rejected: impossible on `file://`, betrays portability |

The **standalone HTML export** is the feature that makes the webbook a format rather than a tool: it must embed the Markdown source *and* the runtime, escape closing-script sequences, and open offline anywhere. The **print stylesheet** hides chrome, widens the measure to the full page, prevents `pre`/table rows/headings from splitting across pages, and optionally appends link URLs in parentheses for paper reading. Programmatic PDF generation (pdf-lib, print libraries) is rejected — hundreds of KB for worse output than the print dialog. Every export must remain **completely self-contained**: system fonts, no CDN, no network beacons; that is the product's portability contract.

---

## 6. Markdown Support & Parser Verdict

**Target dialect: CommonMark (0.31.x) + GitHub Flavored Markdown extensions** — tables (with alignment), task lists, strikethrough, autolinks, and hard breaks. Reference links come free with CommonMark; footnotes are a deliberate optional (P3). This is the dialect real-world documents are actually written in, and it is testable against published spec suites.

**Verified gap summary** (full corpus in Appendix A):

| Construct group | Behaviour today | CommonMark/GFM expectation |
|---|---|---|
| Compact blocks (heading/paragraph/list adjacency) | Headings & lists lost (`B10`–`B13`, `R13`) | Line-based block parsing |
| Fenced code variants (`c++`, `~~~`, 4+ backticks, unclosed) | Literal text / stray backticks (`B01`–`B04`, `B08`) | Spec-compliant fences |
| Code inside lists/quotes/tables | Context destroyed, rows vanish, numbering resets (`R01`, `R02`, `B05`–`B07`) | Code parses in place |
| Nested & loose lists | Flattened / split (`B16`, `B17`) | True nesting, single list |
| Ordered lists (`1)`, start numbers) | Unsupported / renumbered (`B18`, `B19`) | Supported |
| Task lists (mixed, `[X]`) | Markers leak (`B20`, `B21`, `R15`) | GFM task items |
| Blockquote content & nesting | Flattened, literal `#` (`B22`, `B23`) | Recursive block parsing |
| Tables (empty cells, alignment, escaped pipes) | Columns shift / ignored (`B24`, `B26`, `B27`) | GFM tables |
| Inline: intraword `_`, code spans, entities, escapes | Corruption / double-escape (`I03`–`I07`) | Spec inline rules |
| Reference links, autolinks | Unsupported (`I08`, `I09`) | CommonMark/GFM |
| URLs with parens / titles | Truncated / mangled (`I10`, `R11`) | Balanced parsing |
| Heading IDs (duplicates, Unicode) | Collide / empty (`T01`, `T02`) | Dedup + unicode slugs |

> ### Verdict: replace the custom parser. Do not extend it.
>
> **Adopt `marked` (vendored, minified, inlined into the single file) + `DOMPurify` for sanitisation.** Rationale: marked is CommonMark-compliant, synchronous, tiny (~40 KB min), dependency-free in the browser, and battle-tested against exactly the constructs above; DOMPurify (~22 KB min) is the standard sanitizer. Alternative: `markdown-it` (comparable, pluggable, slightly larger) — acceptable if a plugin architecture is wanted; **keeping or hardening the custom pipeline is not an option worth costing** (§2.4).
>
> **Keep a thin product layer**: parse (marked) → sanitise (DOMPurify) → inject → enhance (heading IDs via a unicode-aware dedup slugger, TOC collection, code-block chrome, figure wrapping). The enhancement layer is where product value lives; re-implementing block parsing is not.
>
> **Cost/trade-offs:** +~60 KB minified (total file ~90–120 KB — still a portable single file, still offline); a permanent but light dependency-upgrade discipline (roughly yearly); ~3 days to integrate and wire the enhancement layer.

**Scope guard — what NOT to add:** KaTeX/MathJax, Mermaid, MDX/JSX, custom emoji pipelines, media embeds. Each adds 100 KB+ and a network or fragility tax that betrays the portability ethos. Authors who need them can link to externally rendered images.

---

## 7. Reading Experience & Typography

Typography is the product, not decoration. Today's defaults are a start but the measure is wrong and everything is fixed.

**Measure.** The 800px container yields ~90–100 characters per line — far past the 45–75 band where long-form reading stays comfortable. Default the reading measure to **68ch** and expose width presets **S / M / L = 60 / 72 / 86ch**. This single change does more for perceived quality than any colour tweak.

**Type system.** Base body size **17–18px** with `line-height: 1.65`; headings on a modular scale with consistent top/bottom rhythm and `line-height: 1.25`; style `h5`/`h6` (currently UA defaults, inconsistent with the custom `h1`–`h4`); style `hr` as a quiet rule (currently a bare browser bar). Use a spacing scale (§12) instead of uniform 16px margins so hierarchy reads through whitespace. Code gets a dedicated mono stack at ~0.88em with `tab-size: 4`.

**Reader controls — one popover, presets only.** An **"Aa" button** opens a compact panel: *Family* (Sans / Serif), *Size* (S / M / L), *Width* (S / M / L), *Theme* (Light / Dark / Auto). Line-height couples to the size preset rather than becoming a fifth slider. Every choice persists. No free-text font pickers, no numeric sliders — a settings panel full of arbitrary dials is how reading apps become dashboards.

**Fonts.** System stacks only (zero network, zero KB): the current sans stack is fine; add a serif stack (Georgia/Charter-class system serifs) for the family option. Bundled webfonts are rejected on portability grounds.

**Content presentation.** Images: `max-width: 100%`, subtle radius/border, lazy loading (today there is *no* image CSS rule — wide images overflow and, because the body hides horizontal overflow, get silently clipped). Promote images whose alt text reads like a sentence into figures with captions. Long words and URLs: `overflow-wrap: anywhere` so nothing is ever silently clipped again.

---

## 8. UI/UX & Interaction Design

**Toolbar audit.** Composition is sound (TOC + title left, actions right) but: three of four buttons are labelled only by hover tooltips (no accessible name), touch targets measure ~26px (half the 44px minimum), and there is no overflow behaviour — on narrow screens a long title and the action cluster collide. The theme toggle lives in the wrong place for its importance: theme belongs inside the reader settings popover; the toolbar spot is better spent on *Search* and *Open*.

**Proposed composition.** `[≡ TOC] [Open]  ·  Document title  ·  [Search] [Aa] [⋯]` where the overflow menu holds Copy Markdown, Copy rendered text, Download `.md`, Export HTML, Print, Recent documents, Keyboard shortcuts. Below 720px the overflow menu absorbs everything non-essential automatically.

**States (all missing today).** *Empty*: brand mark, "Open a Markdown file" primary action, drag-drop hint, paste hint, recents. *Loading*: progress for large documents. *Error*: message + Retry + Open another file — replacing today's blank-page-on-exception behaviour. *Restored/Success*: toasts, which must become screen-reader-announced (§11). *Destructive*: confirm before replacing a loaded document and before clearing recents.

**Keyboard layer.** `/` or `Ctrl/Cmd+K` → find-in-page; `T` → TOC; `Esc` → close overlay/drawer/search; `?` → shortcut help overlay. Single-letter shortcuts fire only when no modifier is held and focus is not in an input. The help overlay doubles as discoverability for everything above. A command palette is deliberately deferred to P2 — find-in-page plus TOC covers the daily 80%.

---

## 9. Navigation & Long-Document Ergonomics

The TOC should graduate from "list of links" to a navigation system.

**Structure.** Build a **nested tree** from heading levels (today: flat list with indentation classes that stop at level 4), tolerating imperfect source hierarchies (an `h3` after an `h1` becomes its child rather than vanishing from the tree).

**Active-section tracking.** An `IntersectionObserver`-based scrollspy highlights the current section and auto-scrolls the TOC entry into view. Today there is zero position feedback — for a long book this is the difference between a map and a phone book.

**Movement correctness.** Click-to-scroll should use `scrollIntoView` and let CSS scroll margin handle the header offset (deleting the manual offset arithmetic, which duplicates the scroll-margin mechanism), and hash updates should use `replaceState` so the back button means "previous document," not "previous heading." Handle `hashchange`/`popstate` for real deep links, and persist **scroll position per document** so refresh restores where you were. (Note: `history.pushState` is historically restricted on `file://` in some browsers — hash assignment is the portable mechanism.)

**Heading identity.** Replace the ASCII-only slugger with a GitHub-style, **Unicode-aware, de-duplicating** slugger (`Setup`, `Setup-1`, `Setup-2`; CJK headings keep their characters). Give headings a hover permalink button that copies the deep link. Without this, international books have no working TOC at all (`T02`).

**Aids.** A thin reading-progress bar under the toolbar; a back-to-top control that appears after two viewports; previous/next section buttons in the footer (P2). Documents without headings get an informative TOC panel (metadata + hint), never a dead sidebar.

**Mobile drawer.** Add a scrim, `Esc`-to-close, focus trap, `aria-expanded` on the toggle, and unify the mobile threshold with the CSS breakpoint (today: 800px in JS vs 600px in CSS).

---

## 10. Desktop, Tablet & Mobile

Do not just add breakpoints — adapt the interaction model.

- **Breakpoints:** fluid-first with one compact tier (<720px). The toolbar auto-collapses into the overflow menu; the TOC becomes a full drawer *with scrim* below 720px and a side panel above it (one threshold everywhere).
- **Touch targets:** every control ≥44×44px (today ~26px), including the per-code-block copy buttons; add `@media (hover: none)` styles so touch devices don't get sticky hover states.
- **Code overflow:** keep horizontal scroll, add a global **wrap-lines** toggle (persisted); never clip.
- **Tables:** keep the scroll wrapper; reduce cell padding/font on compact tier; cap `white-space: nowrap` on headers with a min-width so a wide header can't wedge the whole table.
- **The clipping crutch:** the body currently hides horizontal overflow, which silently clips over-wide images and unbreakable strings. Replace with proper wrapping (`overflow-wrap: anywhere`) and `min-width: 0` on flex children, so **content is never unreachable**.
- **Safe areas:** pad the toolbar, toast, and drawer with `env(safe-area-inset-*)` for notched phones; keep the toast above the on-screen keyboard (visualViewport-aware, or simply top-anchored on compact tier).
- **Orientation changes:** re-run scrollspy measurement on `resize`/`orientationchange` so the active-section highlight doesn't drift.

---

## 11. Accessibility

Treat as product quality, not a compliance pass. Current gaps, in priority order:

1. **Names and states.** Give every icon button an accessible name (three of four toolbar buttons are tooltip-only), and wire `aria-expanded`/`aria-controls` on the TOC toggle — today the state is visible only as a colour change.
2. **Live regions.** The toast is invisible to screen readers; add `role="status"`/`aria-live="polite"` so "Copied"/"Restored" are announced.
3. **Focus.** A visible `:focus-visible` ring token everywhere; focus trap in the drawer/menus with focus returned to the trigger on close (today focus walks behind the open drawer).
4. **Scrollable regions.** Code blocks need `tabindex="0"` (with a visually-hidden "scrollable" hint) so keyboard users can scroll them — WCAG 2.1.1.
5. **Structure.** The sidebar's "Contents" `h3` sits above the document's own `h1` in the outline; demote chrome headings to styled non-heading elements so the document owns the outline. Add a skip link to content. Update `html lang` from document metadata.
6. **Contrast.** The dark-mode accent on the dark background sits around 4:1 — borderline for body-size links; darken the accent or always underline body links (also fixes color-alone link identification).
7. **Motion.** Respect `prefers-reduced-motion`: disable the drawer transition, smooth scrolling, and progress animations (today none of the motion is conditional).

Exit criteria for P0 should include a keyboard-only walkthrough and a VoiceOver/NVDA pass of the core loop (open → navigate → search → copy).

---

## 12. Visual Design & Polish

The palette and general restraint are good; what's missing is **systemisation**. Formalise a token layer (both themes derive from it): spacing on a 4px scale (4/8/12/16/24/32/48), radii `sm/md/lg` (4/8/12 — today 3, 4, and 6 appear arbitrarily), two elevation shadows, a documented z-index scale (header / drawer / scrim / toast), the type scale, and control sizes (including the 44px touch minimum).

Consistency fixes with outsized perceived quality: style `hr`; style `h5`/`h6`; TOC levels 5–6; a themed text-selection colour; themed thin scrollbars; a multi-line-safe toast with sensible max-width; replace "- EOF -" with a quiet "Title · Markdown Webbook" (or nothing); replace the default "Action Complete" toast copy; add a pressed state (`scale(0.98)`) to buttons; swap the code-copy icon to a checkmark for 1.5s on success (toast alone is too indirect for a 14px target).

Dark-mode quality: dim images slightly (`brightness(0.9)`) so white-background screenshots don't glare; verify code-header and zebra-row contrast against the darker palette. Empty/loading/error states get one calm visual treatment each — centered, quiet, one accent — specified once and reused. The overall character to protect through the rework: **quiet, typographic, restrained — GitHub-adjacent but warmer.**

---

## 13. Code Blocks & Rich Content

Code is a primary use case for this product's likely corpus (technical books, READMEs, API docs), and today it gets chrome (language chip, copy button) but no highlighting — and, per §2.3, code content itself can be corrupted by surrounding formatting. With the parser replaced, the correctness problems disappear; what remains is presentation.

**Syntax highlighting:** vendor **highlight.js** with a curated common-language bundle (~30–40 KB min: JS/TS, Python, Bash, JSON, HTML, CSS, YAML, SQL, C/C++, Go, Rust…) — or Prism core plus the same language set if a smaller footprint matters more than auto-class coverage. Integrate it in the *enhancement* phase (post-render, progressive), never block first paint on it, and skip network CDN references entirely. Unknown or absent language: show a neutral "code" chip or hide the chip; keep the copy button. Auto-detection stays off (footprint and false positives).

**Block ergonomics:** a global persisted **wrap-lines** toggle; horizontal scroll by default with the block focusable for keyboard scrolling; the copy button gets an inline success state (§12); empty code blocks render as an empty block with header rather than collapsing. **Line numbers** are P3 — they add clutter for reading-focused docs and are only worth it behind the settings popover.

**Richer content:** images become figures with captions when alt text reads like one; `loading="lazy"`; visible fallback for unresolvable local images (§4). Media (`audio`/`video`) passthrough is P3. **Explicitly out of scope:** diagrams (Mermaid), math (KaTeX), oEmbed-style embeds — §6's portability guard applies. Embedded HTML inside Markdown becomes *supported* through sanitisation (§14) — `<details>`, `<kbd>`, `<abbr>` in real documents currently render as literal text (`H01`), which reads as broken to authors.

---

## 14. Security & Reliability

**Security model: imported Markdown is untrusted input.** The product invites arbitrary files; the pipeline must assume hostile content. Concretely: parse with marked → sanitise the resulting HTML with **DOMPurify** (allow-list tags/attributes) → render. This closes today's verified hole — `javascript:` URLs pass unfiltered into link hrefs (`I11`), a one-click XSS — and makes raw-HTML support safe to *enable*.

**URL policy.** Allow-list schemes: `http`, `https`, `mailto`, protocol-relative, relative, and `#anchors`. Strip `javascript:`, `data:`, `vbscript:`. Apply `target="_blank"` **only** to cross-origin external links, always with `rel="noopener noreferrer"` — and stop forcing in-page anchors into new tabs (`R04`), which is both a security smell and an everyday annoyance.

**Raw HTML policy.** Sanitised inline HTML on by default (fidelity with real-world docs); an optional *strict mode* in settings (P2) escapes all HTML for readers who want pure-Markdown rendering. Document the trade-off in the help overlay.

**The embedding hazard.** Content containing a literal closing-script-tag sequence terminates the embedded payload early and breaks the whole page — any webbook *about* HTML/JS dies on first render. Any embed/export code path must escape that sequence (or store the document as a JSON string inside the script block). This must land **before** the Export-HTML feature ships, because export multiplies the hazard.

**Reliability engineering, currently at zero:** clipboard writes get `try/catch` with a hidden-textarea `execCommand` fallback and explicit failure toasts (today: silent no-op); initialisation gets an error boundary — a caught exception renders a visible failure panel with Reload, never a blank page; localStorage writes catch quota errors and degrade to memory-only with a notice; the parser is wrapped so that even an unexpected throw routes to the error state with the raw file still downloadable. `file://` limitations (no sibling fetch, no service worker, history-API quirks in some browsers) belong in a short "About" panel rather than being discovered as bugs.

---

## 15. Performance & Portability

The current file is exemplary on startup: one file, zero requests, parse-and-render in a few milliseconds. The rework must *keep* those properties while adding ~60 KB of vendored libraries.

**Budgets:** total single file ≤ ~150 KB minified; first content paint < 50 ms; parse+render < 100 ms for a 100 KB document; interaction stays smooth at 2 MB documents (achieved via phased rendering, §16). Regressions against these budgets belong in the test harness.

**Techniques.** Parse once, render once — no full re-render on settings changes (reader preferences apply through CSS custom properties and data-attributes, never by touching HTML). Build DOM via DocumentFragment and append in phases for large documents. Use `IntersectionObserver` (not scroll-thrash listeners) for scrollspy, progress, and back-to-top. Delegate events (today every TOC link carries its own listener). No layout thrash: measurements batched in `requestAnimationFrame`.

**Compatibility.** Evergreen Chrome/Edge/Firefox/Safari including iOS Safari. Optional chaining requires Safari 13.1+ — acceptable, but state it. `backdrop-filter` needs the `-webkit-` prefix for older Safari (harmless fallback today). The clipboard API requires a secure context — `file://` is generally treated as trustworthy, but the fallback (§14) covers the exceptions. Prefer `location.hash` assignment over `pushState` for file://-safety. Zero CDN references, an inline favicon (today the missing favicon triggers a 404 request when served over http), and no external font/image/host calls ever — **the file is the deployment**.

---

## 16. Architecture & Rework Opportunities

Eight reworks, each eliminating a class of problems rather than patching symptoms.

**1. Markdown engine — replace.**
*Current:* custom two-phase pipeline (fence-hoisting → blank-line split → per-block dispatch → regex inline chain). *Problem:* fails 34/44 verified constructs; the block model is load-bearing, so every fix fights the architecture. *Recommended:* vendored marked + DOMPurify behind a thin adapter, keeping the product-facing enhancement layer. *Benefit:* the entire parsing defect class disappears by fiat; security baseline included; correctness maintenance outsourced. *Cost/risk:* ~3 days + 60 KB; risk is low — behaviour only *improves* — but regression-test against the corpus (Appendix A) before switching the default.

**2. Heading identity — replace the slugger.**
*Current:* ASCII-only slugger, no dedup — duplicate IDs, empty IDs for CJK. *Problem:* TOC and deep links broken for duplicates and non-English books. *Recommended:* GitHub-style Unicode-aware slugger with `-1`/`-2` dedup, run in the enhancement layer. *Benefit:* working TOC everywhere; stable deep links. *Cost:* ~0.5 day. No dependencies.

**3. Application state — explicit store.**
*Current:* ad-hoc singleton with properties; UI state implicit in CSS classes; only theme persisted. *Problem:* settings, documents, and UI flags have no single home, so every new feature invents its own wiring; nothing is testable. *Recommended:* a tiny store — `{ document, settings, ui }` with publish/subscribe — plus one persistence adapter (localStorage with quota guards). *Benefit:* reader settings, recents, and scroll restoration become trivial; future undo/multi-doc possible. *Cost:* ~1.5 days; **must land before the reader-controls work** (P0→P1 dependency).

**4. Render pipeline — phases, not one assignment.**
*Current:* parse and string-concatenate, then assign the whole thing in one operation. *Problem:* large documents block; enhancements (TOC, code chrome, figures) are tangled into generation. *Recommended:* explicit phases — parse → sanitise → fragment build (chunked, with progress for >500 KB) → enhance (heading IDs, TOC collection, code chrome, figures, highlighting). *Benefit:* progressive rendering, clean hook points for every P1/P2 feature, no re-parse for settings. *Cost:* ~1 day, rides on rework 1.

**5. Navigation system — CSS + observers, not arithmetic.**
*Current:* manual scroll-offset math, per-click `pushState`, flat TOC, no scrollspy. *Problem:* duplicated offset logic, back-button pollution, no position feedback, file:// fragility. *Recommended:* `scroll-margin-top` + `scrollIntoView`, `replaceState`/hash assignment, `hashchange` handling, IntersectionObserver scrollspy, per-document scroll restoration. *Benefit:* correct back/forward, "where am I" always answered, a11y state wiring natural. *Cost:* ~2 days.

**6. Theming & tokens — data-attribute-driven.**
*Current:* two hand-tuned palettes; reader preferences don't exist. *Problem:* every new setting would trigger re-renders or duplicated CSS. *Recommended:* token layer (§12) with `data-theme` plus `data-size`/`data-width`/`data-family` attributes driving CSS custom properties. *Benefit:* instant, re-render-free reader controls; consistent visuals. *Cost:* ~2 days including the consistency fixes.

**7. Single-file layering — named modules without a build step.**
*Current:* one inline script; readable but undifferentiated. *Problem:* no ownership boundaries; things that *look* separable (exporter, store, parser) can't be tested in isolation. *Recommended:* keep the single HTML file but structure the script into clearly delimited IIFE modules with a documented internal API (`Source`, `Parser`, `Sanitizer`, `Enhancer`, `Store`, `Settings`, `Nav`, `Exporter`, `UI`) — no build step, preserving "view-source and edit" as a feature. *Benefit:* Appendix B's ownership map becomes real; the Node harness can extract and test modules directly. *Cost:* ~0.5 day of discipline during rework 1.

**8. Verification harness — corpus as code.**
*Current:* nothing. *Problem:* every change is manual-QA'd or untested; parser regressions are invisible until a reader finds them. *Recommended:* the Appendix A corpus as a runnable fixture — pipeline-level tests in Node (extract module, assert outputs) plus a small browser smoke page; wire into the workflow so the 34-broken baseline ticks down monotonically. *Benefit:* regression safety for every future change; the audit becomes measurable. *Cost:* ~1 day.

---

## 17. Prioritised Roadmap (P0–P3)

Estimates are person-days for one experienced engineer, including manual QA; "Depends on" references roadmap IDs. Total ≈ **50 days**.

### P0 — Fundamental (≈21d): the app becomes dependable

| ID | Item | Problem → Change | User benefit | Days | Depends on |
|---|---|---|---|---|---|
| R1 | Parser replacement (marked + DOMPurify, vendored) | 34/44 constructs fail → spec-compliant engine behind adapter | Everything renders correctly; XSS hole closed | 3 | R8 |
| R2 | URL & sanitisation policy | `javascript:` links, anchor links in new tabs → scheme allow-list, scoped `target=_blank`, `noopener` | Safe clicking; anchors stay in-page | 1.5 | R1 |
| R3 | Import flows | No way to load content → Open picker, drag-drop zone, paste, replace-confirm | 5-second file-to-reading loop | 3 | R5 |
| R4 | Lifecycle: persistence, recents, metadata | Refresh loses everything; weak titles → auto-persist, recents, frontmatter/H1 metadata, `lang` | Lossless refresh; correct titles everywhere | 3 | R3 |
| R5 | States & error boundary | Blank pages, silent failures → empty/loading/error states, clipboard fallbacks, quota guards | Software that talks back | 2.5 | — |
| R6 | Navigation rework | No scrollspy, history spam, broken IDs → nested TOC, observer scrollspy, replaceState, slugger fix, scroll restore | Long documents become navigable | 3 | R1 |
| R7 | Accessibility fundamentals | Unnamed buttons, no live regions, no focus mgmt, pre not keyboard-scrollable, reduced-motion ignored | Usable with keyboard & screen reader | 2.5 | R6 |
| R8 | Verification harness | No tests → Appendix A corpus runnable in Node + browser smoke | Every change regression-safe | 1 | — |
| R9 | Unicode dedup slugger | Empty/colliding heading IDs → GitHub-style slugs | CJK/duplicate headings work | 0.5 | R1 |
| R10 | Embedding escape fix | Closing-script-tag content breaks the page → escape payloads on embed/export | HTML-tutorial books survive | 1 | — |

### P1 — Product quality (≈17d): the app becomes pleasant

| ID | Item | Problem → Change | User benefit | Days | Depends on |
|---|---|---|---|---|---|
| R11 | Reader controls (Aa popover) | Fixed measure/size/family → presets for size/width/family/theme, persisted | Comfortable long-form reading | 3 | §16.3 (store) |
| R12 | Typography & token overhaul | 90–100 CPL, uniform spacing, unstyled hr/h5–h6 → 68ch default, spacing scale, consistency fixes | Looks finished | 3 | §16.6 (theme tokens) |
| R13 | Find-in-page | No search → `/` search with match count, next/prev, highlight-all | The book is queryable | 3 | R8 |
| R14 | Export suite | No standalone export → Export HTML, copy rendered text, print stylesheet/PDF path | The file becomes a format | 3.5 | R10 |
| R15 | Responsive & touch overhaul | 26px targets, clipping, breakpoint mismatch → 44px targets, overflow menu, drawer scrim/trap, wrapping, safe areas | Genuinely good on phones | 3 | R5, R6 |
| R16 | Progress, back-to-top, scroll restore | No position feedback → progress bar, FAB, per-doc restoration | Always know where you are | 1.5 | R6 |

### P2 — Advanced (≈8d): power-user depth

| ID | Item | Problem → Change | User benefit | Days | Depends on |
|---|---|---|---|---|---|
| R17 | Command palette | No fast jumping → `Ctrl/Cmd+K` palette over headings + commands | Keyboard-first navigation | 2.5 | R13 |
| R18 | Syntax highlighting | Plain code → vendored highlight.js common bundle | Technical books read properly | 2 | R1 |
| R19 | Shortcut layer + help overlay | Undiscoverable keys → full shortcut map + `?` overlay | Discoverability | 1.5 | R7 |
| R20 | Strict-mode sanitise toggle + per-doc settings | One size fits all → strict HTML mode; overrides per document | Trust + flexibility | 1 | R11 |
| R21 | Prev/next section + heading permalinks | Linear reading friction → footer section nav, `¶` copy-link | Book-like flow | 1 | R6 |

### P3 — Optional (≈4d): only if they stay cheap

Footnotes plugin (1), image click-to-zoom with accessible dialog (1), sepia/paper theme (0.5), UI translations (1), line numbers behind settings (0.5). **Reject list (do not build):** math rendering, Mermaid, editor mode, cloud sync, share links, bundled webfonts, plugin marketplace. Each betrays the size/portability contract or the read-only product focus.

---

## 18. Final Target State

Open `markdown_webbook.html` from disk and you land in a calm empty state: the app's mark, an **Open** button, a drag-drop hint, and your recent documents. Drop or pick a `.md` file and it renders in under a beat — correct headings, nested lists, aligned tables, highlighted code — with the title derived from frontmatter or the first heading, the language attribute set, and a thin progress bar if the file is huge. The toolbar reads `[≡] [Open] Title [Search] [Aa] [⋯]`; nothing else competes for attention.

Reading is the product. The measure defaults to 68 characters; **Aa** offers Sans/Serif, three sizes, three widths, and Light/Dark/Auto theme — every choice persists. The TOC is a nested outline that tracks your position as you scroll; clicking a section glides there and the back button still means "previous document." A back-to-top control appears when you've earned it, and refreshing restores your exact place. Press `/` and the document is searchable with match counts and next/previous jumps. Code blocks scroll, wrap on demand, carry a language chip, and copy with a satisfying inline check. Images become figures with captions; `javascript:` links simply don't exist; embedded `<details>` and `<kbd>` render — sanitised.

Export closes the loop: copy the raw Markdown, copy the rendered text, download the `.md`, print to PDF through a real print stylesheet — or **export a standalone HTML** that is the entire webbook, document and runtime in one file, offline-capable, exactly as portable as the app itself.

Across desktop, tablet, and phone the interaction model adapts rather than shrinks: touch targets never dip below 44px, the toolbar collapses into an overflow menu, the TOC becomes a scrimmed drawer, nothing is ever silently clipped. Every control has an accessible name and state; the drawer traps and restores focus; toasts are announced; motion respects the reader's motion preferences. A keyboard-only reader and a screen-reader reader complete the core loop — open, navigate, search, copy, export.

Architecturally it remains one self-contained HTML file: no build step, no network, view-source-friendly, with named internal modules (source, parser, sanitizer, enhancer, store, settings, navigation, exporter, UI) owned per Appendix B and guarded by a corpus test harness whose baseline — 34 broken constructs — reads zero in the finished product. Performance budgets are explicit and tested: ≤150 KB file, <100 ms render for a 100 KB book. Visually it is quiet, typographic, and restrained — GitHub-adjacent but warmer — with two (optionally three) coherent themes derived from one token system. That is the finished Markdown Webbook: **a small, careful document reader that respects the reader, the author, and the file.**

---

## Appendix A: Verification Corpus & Test Checklist

Baseline measured by extracting the shipped pipeline and executing it against 44 constructs: **7 OK / 3 partial / 34 broken.** After R1/R9, the same corpus must pass in the Node harness and in a browser smoke page. Keep it as a committed fixture; new regressions must fail loudly.

**Block structures**

- [ ] B01 Fence with `c++` language — currently literal text. Expected: code block, language chip
- [ ] B02 Fence, trailing space after language — currently literal text. Expected: code block
- [ ] B03 Tilde fence `~~~` — currently literal text. Expected: code block
- [ ] B04 Four-backtick fence — currently stray backtick. Expected: code block
- [ ] B05/B06/B07 Fence inside ordered/unordered list item and blockquote — currently hoisted out of context. Expected: parsed in place within the parent structure
- [ ] B08 Unclosed fence — currently literal text. Expected: code block to end of document
- [ ] B09 Empty fenced block — OK today; keep passing
- [ ] B10 Setext heading — currently demoted. Expected: `h1`/`h2`
- [ ] B11 Compact heading (no blank line) — currently lost. Expected: heading
- [ ] B12 Heading followed directly by list — currently merged paragraph. Expected: heading + list
- [ ] B13 HR variants `-----`, `- - -`, `___` — currently none render. Expected: `<hr>` each
- [ ] B14 YAML frontmatter — currently leaks as text. Expected: stripped into metadata
- [ ] B15 Closing hashes `## H ##` — currently literal. Expected: stripped

**Lists**

- [ ] B16 Nested list (3 levels) — currently flattened. Expected: nested `<ul>`
- [ ] B17 Blank line inside list — currently split into two lists. Expected: one list (loose)
- [ ] B18 `1)` ordered style — currently literal. Expected: `<ol>`
- [ ] B19 Ordered start `5.` — currently renumbered. Expected: `start="5"`
- [ ] B20 Task marker mid-list — currently leaks. Expected: task item
- [ ] B21 Uppercase `[X]` — currently defeats detection. Expected: checked task item
- [ ] R08 Nested child inside task list — currently rendered as second task with literal marker. Expected: nested list under task
- [ ] R15 Task marker mid-item — currently literal. Expected: literal is correct per GFM; assert no checkbox injected

**Blockquotes & tables**

- [ ] B22 Heading inside blockquote — currently literal `#`. Expected: heading inside quote
- [ ] B23 Nested blockquote — currently flattened. Expected: nested quotes
- [ ] B24 Empty table cell — currently columns shift. Expected: empty cell preserved
- [ ] B25 Table without leading pipe — currently literal. Expected: GFM table
- [ ] B26 Alignment colons — currently ignored. Expected: aligned columns
- [ ] B27 Escaped pipe `\|` — currently splits cell. Expected: literal pipe in cell
- [ ] R02 Fence inside table cell — currently row destroyed. Expected: code rendered in cell (or documented limitation)

**Inline & links**

- [ ] I01 `***x***` — currently misnested tags. Expected: `<em><strong>`
- [ ] I02 Nested emphasis — currently misnested. Expected: valid nesting
- [ ] I03 `snake_case` / `__dunder__` — currently emphasised mid-word. Expected: literal
- [ ] I04/I05 Formatting markers inside inline code — currently converted. Expected: literal
- [ ] I06 Backslash escapes — currently ignored. Expected: escaped literal
- [ ] I07 Entities `&copy; &amp;` — currently double-escaped. Expected: rendered glyph/ampersand
- [ ] I08 Reference links — currently literal. Expected: links
- [ ] I09 Autolinks `<https://…>` — currently literal. Expected: links
- [ ] I10 URL with parentheses — currently truncated `href`. Expected: full URL
- [ ] R11 Link titles — currently swallowed into URL. Expected: title parsed out
- [ ] R10 Empty link text — currently invisible link. Expected: visible fallback text
- [ ] R12 Image alt with formatting — currently markup in alt. Expected: plain-text alt
- [ ] I12 Badge pattern `[![img]](link)` — OK today; keep passing
- [ ] I13 Wide image — no size rule today. Expected: constrained to measure

**Security & identity**

- [ ] I11 `javascript:` link — currently passes into `href`. Expected: stripped by sanitiser
- [ ] R04 In-page anchor link — currently opens new tab. Expected: in-page navigation
- [ ] R05 Relative `.md` link — currently silent dead-end. Expected: documented no-op hint (file://)
- [ ] T01 Duplicate heading names — currently colliding IDs. Expected: `-1`, `-2` suffixes
- [ ] T02 CJK headings — currently empty IDs. Expected: unicode-preserving slugs
- [ ] T03 Heading with markdown in text — currently slug diverges. Expected: slug from rendered text
- [ ] H01 Raw HTML (`<details>`) — currently literal text. Expected: sanitised, rendered
- [ ] H02 Raw `<script>` — correctly escaped today; must stay inert after sanitiser swap
- [ ] Embedding: document containing closing-script-tag sequence — currently breaks the page. Expected: escaped payload (R10)

**Manual passes (each release)**

- [ ] Keyboard-only core loop: open → navigate TOC → search → copy → export
- [ ] Screen reader pass (VoiceOver + NVDA): landmarks, TOC state, toast announcements
- [ ] Viewport sweep: 320 / 375 / 600 / 768 / 1024 / 1440 / 1920 px, plus landscape phone
- [ ] Zoom: 200% browser zoom and OS large-text; no clipped content
- [ ] Print preview: chrome hidden, no split code blocks/rows, measure fills page
- [ ] Double-context run: `file://` and served over http(s)
- [ ] `prefers-reduced-motion` and `prefers-color-scheme` honoured
- [ ] Large-document budget: 1 MB and 2 MB documents render with progress, stay interactive

---

## Appendix B: Module Boundaries & Hand-off Notes

The single-file ethos stays; the script becomes named IIFE modules with a documented internal API. Suggested ownership split for an engineering team:

| Module | Responsibility | Public surface | Hand-off notes |
|---|---|---|---|
| `Source` | Embedding, import (picker/drop/paste/URL), persistence, recents, metadata | `load(file)`, `persist()`, `recent()`, `meta` | Owns localStorage schema + quota guards; escape payload rule lives here (R10) |
| `Parser` | marked adapter: parse → sanitise pipeline entry | `render(markdown) → DOM` | Only module allowed to know marked/DOMPurify exist; keep swappable |
| `Sanitizer` | DOMPurify config, URL scheme allow-list, target/noopener policy | `clean(html) → html` | Policy changes require security review; test I11/R04 corpus rows |
| `Slugger` | Unicode-aware, dedup heading IDs | `slug(text) → id` | Pure function; first module to unit-test |
| `Enhancer` | Post-render passes: TOC collection, code chrome, figures, highlighting hook | `enhance(root, store)` | Ordering matters: slugs before TOC; highlighting last |
| `Store` | `{ document, settings, ui }` state + pub/sub | `get/set/subscribe` | No DOM access; Settings UI subscribes here |
| `Nav` | TOC tree, scrollspy, hash policy, scroll restoration, progress | `buildToC()`, `observe()`, `restore()` | One threshold constant shared with CSS via custom property |
| `Exporter` | Copy raw/rendered, download, standalone-HTML export, print prep | `export(kind)` | Must re-run Source's escape rules; zero external refs guaranteed |
| `UI` | Toolbar, menus, drawer, Aa popover, toasts, states (empty/loading/error) | `init(store)`, `toast(msg)` | All a11y wiring (labels, aria, focus trap) is owned here |
| `Harness` | Corpus runner (Node + browser smoke) | CLI + page | Baseline = Appendix A; failures block merge |

**Team conventions.** No build step — the shipped artefact and the source are the same file; keep modules IIFE-delimited in the order above. Carry an `APP_VERSION` constant and a changelog comment block at the top of the file. All new behaviour lands with a corpus row (Appendix A) or a harness assertion. Security changes (`Sanitizer`, `Source`) require a second reviewer. Performance budgets from §15 are re-measured at each priority milestone, not at the end.
