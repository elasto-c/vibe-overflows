# Quality-of-Life Improvement Plan — Markdown Webbook

**Source brief:** `quality-of-life-refinement.md` — *"from current state → masterpiece."*
**Baseline:** `markdown_webbook.html` v1.3.1 (P0 + P1 + P2 + UI refinements shipped, 118/118 harness checks green).
**Nature:** a refinement pass, not a feature pass. Every milestone below tightens what exists; the only feature additions are the two proposals in M5, and only the one explicitly approved (Proposal A) is implemented.

## Hard constraints (every milestone)

- Single self-contained HTML file, zero network, `file://`-first, no build step for readers.
- Behavioural regressions are unacceptable: the 44-construct Appendix A corpus harness must stay at **0 broken** after every change.
- Removals remove state, not visibility; no dead code left behind.
- Calm, editorial restraint: no dashboards, no decorative motion, no novelty for its own sake.

## Milestones

### M0 — Reliability & correctness pass

*Goal: boringly dependable. Hunt broken interactions, inconsistent state, crashes and edge states.*

| # | Item | Why it matters | Status |
|---|------|----------------|--------|
| 0.1 | Guard `Nav.updateActive()` against documents with **zero headings** — the scrollspy read `headings[0].id` unguarded, so a heading-less `.md` crashed straight to the fatal screen | Real crash on valid input | ✅ v1.4.0 |
| 0.2 | Close open popovers on window **resize / orientation change** — the document menu is positioned under its trigger at open time and drifted after geometry changes | Stale-positioned UI | ✅ v1.4.0 |
| 0.3 | Ship the approved-but-missing **interactive task-list checkboxes** refinement: GFM task boxes are clickable, update instantly with no re-render and no scroll interruption, persist to `localStorage` keyed by document + item index, and **never rewrite the Markdown source** | Approved refinement that had not landed | ✅ v1.4.0 |
| 0.4 | Close the image lightbox on `beforeprint` so a print run never captures overlay state | Print correctness | ✅ v1.4.0 |

### M1 — Codebase refinement

*Goal: simplify hot paths, remove duplication, keep behaviour identical.*

| # | Item | Why it matters | Status |
|---|------|----------------|--------|
| 1.1 | Merge the two delegated content click listeners (code toolbar + permalink) into one — one pass, one ordering story (wrap → copy → permalink → image) | Event-handling clarity | ✅ v1.4.0 |
| 1.2 | Task-state persistence rides the existing `DocPref` store (`mdwb:docpref:<content-hash>`), sharing the strict-HTML override's lifecycle instead of adding a parallel mechanism | One per-document store | ✅ v1.4.0 |
| 1.3 | Checkbox state is re-applied from the store after every render (strict-HTML toggle, reload) rather than patched ad hoc | Consistent state model | ✅ v1.4.0 |

### M2 — Elite UI/UX polish

*Goal: every interaction is understandable, its state obvious, its behaviour expected.*

| # | Item | Why it matters | Status |
|---|------|----------------|--------|
| 2.1 | Popovers get a subtle 120 ms fade/scale entrance (covered by the existing reduced-motion kill switch) | Overlays that appear without snapping | ✅ v1.4.0 |
| 2.2 | Native checkboxes adopt `accent-color: var(--accent-color)` and a pointer cursor — theme-consistent, clearly interactive | Small control, visible state | ✅ v1.4.0 |
| 2.3 | The lightbox fades/scales in over a dark scrim with a single rounded-square close control matching the toolbar's control language | One motion language | ✅ v1.4.0 |

### M3 — Craftsmanship details

*Goal: the last 10% that distinguishes "works" from "someone cared".*

| # | Item | Why it matters | Status |
|---|------|----------------|--------|
| 3.1 | Reading-settings rows stay on one spacing rhythm; the new **Header accent** row is stacked (label above control) so five options breathe instead of squeezing | Consistent control geometry | ✅ v1.4.0 |
| 3.2 | Sample-book manual updated for every new behaviour (task ticks, header accent, print settings, image zoom) — the manual always tells the truth | Coherent terminology | ✅ v1.4.0 |

### M4 — Coherence & final verification

*Goal: dark/light parity, a11y, and proof.*

| # | Item | Why it matters | Status |
|---|------|----------------|--------|
| 4.1 | Accent hues are tuned per theme: soft **pastel tints** in dark mode, muted **pastel tones** readable on white in light mode | Dark/light parity | ✅ v1.4.0 |
| 4.2 | Print/PDF output **preserves the reading settings** — theme (with `print-color-adjust: exact` so dark prints faithfully), text size, line height, width, typeface and header accent all flow through; chrome stays hidden | Reader choices respected on paper | ✅ v1.4.0 |
| 4.3 | Harness extended (NH1, TC1–TC2, HA1–HA2, PR1, LX1–LX2, RV1) and the full 44-construct corpus re-run against the built file | Zero-regression proof | ✅ v1.4.0 |
| 4.4 | Chromium smoke: accent in both themes, print emulation, lightbox, task ticks, popover behaviour | Browser-level confidence | ✅ v1.4.0 |

### M5 — The two feature proposals

*The brief allowed exactly two additions. Only Proposal A was approved for implementation; Proposal B is recorded and deliberately left unimplemented.*

#### Proposal A — Image lightbox zoom ✅ approved & implemented

- **Feature:** click (or tap) any content image to view it full-size in a calm dark overlay; `Esc`, a click, or the close button dismisses it; the alt text becomes a quiet caption. Linked images (badges) are excluded.
- **Why it earns inclusion:** webbooks are figure-heavy; images constrained to the reading column lose fine detail, and today the only escape is opening the file itself.
- **Why it belongs in this product:** reading-focused viewing of a book's own figures is the reader's job, not an external tool's; it works offline on `file://` because it only ever re-uses the image that is already rendered.
- **Why it stays small and focused:** one overlay, one delegated click, no gallery, no pan/zoom physics, no captions editor — roughly sixty lines in total.

#### Proposal B — Reading-time & document statistics ⛔ not implemented (declined per instruction)

- **Feature:** a quiet "≈ N min read · M words" line in the document menu.
- **Why it earns inclusion:** cheap, honest, and genuinely consulted in long-form reading tools.
- **Why it would belong here:** it respects the editorial calm and needs no new surface — a menu row.
- **Why it should remain small:** one computed string; any charts, goals or streaks would break the product's restraint.
- **Status:** described for completeness only — **not implemented** on instruction ("Proposal A only, not Proposal B").

## Verification contract

Every milestone lands with the harness green (44-construct corpus + P1 + P2 + v1.3.1 suites + the M4 additions) and a Chromium smoke pass. The file remains one self-contained HTML document with zero external requests.
