#!/usr/bin/env node
/*
 * Markdown Webbook — build script.
 *
 * Assembles the single-file artifact `dist/markdown_webbook.html` from the
 * sources under `src/`. Zero npm dependencies; requires Node.js >= 16.
 *
 *   node build.js              -> writes ./dist/markdown_webbook.html
 *   node build.js --out PATH   -> write somewhere else
 *
 * Assembly contract
 * -----------------
 * `src/index.html` is the document shell. Each inline <style>/<script>
 * block holds exactly one __WB_INLINE_*__ token, replaced byte-exactly
 * with the payloads listed in INLINE_MANIFEST (order mirrors the
 * document):
 *
 *   kind "js"  — containment escape, then inline. Two byte sequences can
 *                terminate an inline <script> early, so before inlining:
 *                  </script  ->  <\/script   (premature tag close in JS
 *                                             strings/regexes)
 *                  <!--      ->  <\!--       (the HTML tokenizer's
 *                                             script-data-escaped state)
 *                Both replacements are no-ops for the JS engine, so the
 *                running code is unaffected. The vendored/app sources
 *                already carry the escaped forms (the regex delimiter
 *                escape in /<\/script/gi is mandatory JS syntax), so in
 *                practice this pass is a verified safety net for future
 *                edits that introduce a raw sequence.
 *   kind "css" — concatenated verbatim, in the listed order.
 *   kind "md"  — verbatim (textContent of the default-document block).
 *
 * Self-checks (the build fails loudly on any violation):
 *   - every manifest file exists and is non-empty
 *   - every token occurs exactly once in the shell and gets replaced
 *   - zero unreplaced __WB_INLINE_*__ tokens remain in the artifact
 *   - exactly 5 `</script>` closers (boot, default doc, marked, purify,
 *     app) and exactly 5 `<script` openers in the shell
 *   - the default document contains no `</script` / `<!--`
 *
 * The build is deterministic: identical sources produce a byte-identical
 * artifact (LF endings are enforced repo-wide via .gitattributes). The
 * assembled artifact is committed at `dist/markdown_webbook.html`; CI
 * rebuilds it on every push and fails if the committed copy drifts from
 * the sources.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;

/* Inline manifest — document order matters. */
const INLINE_MANIFEST = [
    { token: "__WB_INLINE_JS_BOOT__", kind: "js", files: ["src/js/boot.js"] },
    {
        token: "__WB_INLINE_CSS__",
        kind: "css",
        files: [
            "src/styles/tokens.css",
            "src/styles/base.css",
            "src/styles/chrome.css",
            "src/styles/content.css",
            "src/styles/panels.css",
            "src/styles/states.css",
            "src/styles/responsive-print.css",
        ],
    },
    {
        token: "__WB_INLINE_DOC_DEFAULT__",
        kind: "md",
        files: ["src/content/default-document.md"],
    },
    { token: "__WB_INLINE_JS_MARKED__", kind: "js", files: ["src/vendor/marked.umd.js"] },
    { token: "__WB_INLINE_JS_PURIFY__", kind: "js", files: ["src/vendor/purify.min.js"] },
    { token: "__WB_INLINE_JS_APP__", kind: "js", files: ["src/js/app.js"] },
];

const SHELL = "src/index.html";
const DEFAULT_OUTPUT = "dist/markdown_webbook.html";
const EXPECTED_SCRIPT_BLOCKS = 5; /* boot, default doc, marked, purify, app */

function fail(msg) {
    console.error("build: FATAL — " + msg);
    process.exit(1);
}

function read(rel) {
    const p = path.join(ROOT, rel);
    let data;
    try {
        data = fs.readFileSync(p, "utf8");
    } catch (e) {
        fail("cannot read " + rel + " (" + e.message + ")");
    }
    if (!data || !data.trim()) {
        fail(rel + " is empty");
    }
    return data;
}

/* Containment escape for inline <script> payloads (see contract above). */
function escapeForInlineScript(code) {
    return code
        .replace(/<\/script/g, "<\\/script")
        .replace(/<!--/g, "<\\!--");
}

/* ---------------------------------------------------------- 1. shell */
let shell = read(SHELL);
const shellOpeners = (shell.match(/<script(?=[\s>])/g) || []).length;
if (shellOpeners !== EXPECTED_SCRIPT_BLOCKS) {
    fail(
        SHELL + " should hold exactly " + EXPECTED_SCRIPT_BLOCKS +
        " <script> openers, found " + shellOpeners
    );
}
if ((shell.match(/<style(?=[\s>])/g) || []).length !== 1) {
    fail(SHELL + " should hold exactly one <style> block");
}

/* ------------------------------------------------------ 2. assemble */
let html = shell;
let reported = [];
for (const entry of INLINE_MANIFEST) {
    const occurrences = html.split(entry.token).length - 1;
    if (occurrences !== 1) {
        fail(
            entry.token + " expected exactly once in " + SHELL +
            ", found " + occurrences
        );
    }
    const payload = entry.files.map(read).join("");
    if (entry.kind === "md") {
        if (payload.includes("</script")) {
            fail(entry.files[0] + " contains </script — cannot inline safely");
        }
        if (payload.includes("<!--")) {
            fail(
                entry.files[0] +
                " contains <!-- — the script-data-escaped state makes the" +
                " real closing tag unsafe; remove it from the document"
            );
        }
        html = html.replace(entry.token, function () { return payload; });
    } else if (entry.kind === "js") {
        html = html.replace(entry.token, function () {
            return escapeForInlineScript(payload);
        });
    } else {
        html = html.replace(entry.token, function () { return payload; });
    }
    reported.push(
        "  " + entry.token.padEnd(28) +
        String(payload.length).padStart(8) + " B  <- " + entry.files.join(" + ")
    );
}

/* -------------------------------------------------- 3. self-checks */
const leftovers = html.match(/__WB_INLINE_[A-Z_]+__/g);
if (leftovers) {
    fail("unreplaced tokens remain: " + leftovers.join(", "));
}
const closers = (html.match(/<\/script>/g) || []).length;
if (closers !== EXPECTED_SCRIPT_BLOCKS) {
    fail(
        "expected exactly " + EXPECTED_SCRIPT_BLOCKS + " </script> closers" +
        " in the artifact, found " + closers
    );
}

/* ------------------------------------------------------ 4. write */
const argv = process.argv.slice(2);
let outRel = DEFAULT_OUTPUT;
const outFlag = argv.indexOf("--out");
if (outFlag !== -1) {
    const v = argv[outFlag + 1];
    if (!v) fail("--out requires a path");
    outRel = v;
}
const outPath = path.isAbsolute(outRel) ? outRel : path.join(ROOT, outRel);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, "utf8");

const sha = crypto.createHash("sha256").update(html, "utf8").digest("hex");
console.log("build: " + path.relative(ROOT, outPath));
console.log(reported.join("\n"));
console.log(
    "  artifact" + " ".repeat(21) + String(html.length).padStart(8) + " B"
);
console.log("  self-check       5/5 </script> closers · 0 leftover tokens");
console.log("  sha256           " + sha);
console.log("done.");
