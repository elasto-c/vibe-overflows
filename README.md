# vibe-overflows

> Apps, tools, and artifacts that started in a chat window and overflowed into a repo.

A monorepo of vibe-coded projects. Everything here was built in conversation with a model, committed as-is, and kept if it works. Each folder is one **overflow** — an artifact that outgrew the chat.

The rendered catalog lives in [`index.html`](./index.html) — point GitHub Pages at the repo root and it becomes the front door.

## Catalog

| #   | Artifact                                         | What it is                                                 | Links |
| --- | ------------------------------------------------ | ---------------------------------------------------------- | ----- |
| 001 | [Markdown Webbook](./overflows/markdown-webbook) | Single-file Markdown reader and publisher — Markdown in, one self-contained HTML file out[cite: 1] | [live](https://elasto-c.github.io/vibe-overflows/overflows/markdown-webbook/dist/markdown_webbook.html) · [source](https://github.com/elasto-c/vibe-overflows/tree/main/overflows/markdown-webbook) |

<!-- "live" links assume GitHub Pages serving from the repo root; adjust if your setup differs -->

## Anatomy of an overflow

```txt
overflows/<slug>/
├── README.md     # what it is, how to run or use it
└── ...           # whatever source files, builds, or assets the project needs

```

House rules:

* one folder per artifact using a `kebab-case` slug
* tech-stack agnostic — static web pages, CLI utilities, single-file scripts, or multi-file apps
* every artifact includes its own `README.md` explaining what it does and how to run or view it

## Adding an overflow

```sh
mkdir -p overflows/<slug>
# vibe
git commit -m "<slug>: escaped the chat"

```

Then add a row to the [catalog](https://www.google.com/search?q=%2523catalog&utm_source=gemini) and an entry to [`index.html`](https://www.google.com/search?q=./index.html&utm_source=gemini).

## License

Each overflow carries its own license — see the artifact's folder.
