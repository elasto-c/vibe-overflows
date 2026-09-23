/*
 * R8 verification harness — runs the 44-construct corpus PLUS integration,
 * security, P1 and P2 checks against the BUILT dist/markdown_webbook.html by
 * executing it inside jsdom (real marked + real DOMPurify + real app
 * pipeline). Expectations are CommonMark/GFM-correct behaviour (audit
 * Appendix A).
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

/* Portable: verify the artifact assembled into dist/ one level above. */
const FILE = path.join(__dirname, "..", "dist", "markdown_webbook.html");
const html = fs.readFileSync(FILE, "utf8");

const jsdomNoise = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  const msg = String((e && e.message) || e);
  if (/not implemented/i.test(msg)) return; /* scroll*, clipboard etc. */
  jsdomNoise.push(msg);
});

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://localhost/",
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
const B = "```";
const results = [];

function check(id, label, fn) {
  try {
    const r = fn(window.MDWebbook, window);
    results.push({ id, label, verdict: r.ok ? "PASS" : "FAIL", note: r.note || "" });
  } catch (e) {
    results.push({ id, label, verdict: "CRASH", note: e.message });
  }
}

const ok = (note) => ({ ok: true, note });
const bad = (note) => ({ ok: false, note });
const parse = (out) => window.document.implementation.createHTMLDocument ? new window.DOMParser().parseFromString(out, "text/html") : null;

/* Async checks (1.8.0): the url-import flow settles over microtasks. The
   bodies are chained strictly sequentially (they share the singleton
   OpenUrl dialog), run after the whole sync batch, and report() awaits
   every promise before printing. No timers — microtask hops only — so
   ordering against the export round-trip timers stays deterministic. */
const asyncPromises = [];
let asyncQueue = Promise.resolve();
function checkA(id, label, fn) {
  const entry = { id, label, verdict: "CRASH", note: "pending" };
  results.push(entry);
  const run = asyncQueue
    .then(() => fn(window.MDWebbook, window))
    .then((r) => {
      entry.verdict = r && r.ok ? "PASS" : "FAIL";
      entry.note = (r && r.note) || "";
    })
    .catch((e) => {
      entry.verdict = "CRASH";
      entry.note = e.message;
    });
  asyncPromises.push(run);
  asyncQueue = run;
}
const tick = () => Promise.resolve();
const drain = async (n) => {
  for (let i = 0; i < (n || 12); i++) await tick();
};

setTimeout(() => {
  const W = window.MDWebbook;
  if (!W) {
    console.error("FATAL: window.MDWebbook missing — app script did not run.");
    console.error("jsdomErrors:", jsdomNoise.slice(0, 5));
    process.exit(1);
  }
  const R = (md) => W.render(md);

  /* ------------------------- Block: fences ------------------------- */
  check("B01", "c++ fence", () => {
    const o = R(B + "c++\nint x = 0;\n" + B);
    return o.includes("<pre") && o.includes("language-c++")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("B02", "trailing space after lang", () => {
    const o = R(B + "js \nvar x;\n" + B);
    return o.includes("<pre") && o.includes("language-js") ? ok() : bad();
  });
  check("B03", "tilde fence", () => {
    const o = R("~~~js\nvar x;\n~~~");
    return o.includes("<pre") && o.includes("language-js") ? ok() : bad();
  });
  check("B04", "4-backtick fence", () => {
    const o = R(B + B + "js\nvar x;\n" + B + B);
    return o.includes("<pre") && !/```\w/.test(o.replace(/<[^>]*>/g, ""))
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("B05", "fence inside ordered list item", () => {
    const o = R("1. Step one\n\n   " + B + "bash\n   npm i\n   " + B + "\n");
    const d = parse(o);
    return d.querySelector("ol li pre") && !o.includes("__CODE_")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("B06", "fence inside unordered list item", () => {
    const o = R("- item\n\n  " + B + "py\n  print(1)\n  " + B + "\n");
    const d = parse(o);
    return d.querySelector("ul li pre") && !o.includes("__CODE_")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("B07", "fence inside blockquote", () => {
    const o = R("> " + B + "js\n> var x;\n> " + B);
    const d = parse(o);
    return d.querySelector("blockquote pre") && !o.includes("__CODE_")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("B08", "unclosed fence", () => {
    const o = R(B + "js\nvar x;");
    return o.includes("<pre") ? ok() : bad(o.slice(0, 80));
  });
  check("B09", "empty fenced block", () => {
    const o = R(B + "\n" + B);
    return o.includes("<pre") ? ok() : bad();
  });

  /* --------------------- Block: headings & hr ---------------------- */
  check("B10", "setext heading", () => {
    const o = R("Title\n=====\n\nBody");
    /* R21: heading text may be followed by the permalink anchor */
    return /<h1[^>]*>Title(<a class="h-anchor"[\s\S]*?<\/a>)?<\/h1>/.test(o)
      ? ok()
      : bad(o.slice(0, 80));
  });
  check("B11", "compact heading", () => {
    const o = R("# Title\nParagraph right after.");
    return /<h1[^>]*>Title(<a class="h-anchor"[\s\S]*?<\/a>)?<\/h1>/.test(o) && o.includes("<p>")
      ? ok()
      : bad(o.slice(0, 80));
  });
  check("B12", "heading followed directly by list", () => {
    const o = R("List:\n- a\n- b");
    const d = parse(o);
    return d.querySelector("p") && d.querySelector("ul")
      ? ok()
      : bad(o.slice(0, 80));
  });
  check("B13", "HR variants ----- / - - - / ___", () => {
    const o = R("a\n\n-----\n\nb\n\n- - -\n\nc\n\n___");
    return (o.match(/<hr/g) || []).length === 3
      ? ok()
      : bad((o.match(/<hr/g) || []).length + " hr");
  });
  check("B14", "YAML frontmatter stripped", () => {
    const o = R("---\ntitle: Book\nauthor: A\n---\n\n# Ch1");
    return !o.includes("title: Book") &&
      /<h1[^>]*>Ch1(<a class="h-anchor"[\s\S]*?<\/a>)?<\/h1>/.test(o)
      ? ok()
      : bad(o.slice(0, 80));
  });
  check("B15", "closing hashes stripped", () => {
    const o = R("## Heading ##");
    return /<h2[^>]*>Heading(<a class="h-anchor"[\s\S]*?<\/a>)?<\/h2>/.test(o) && !o.includes("##")
      ? ok()
      : bad(o.slice(0, 80));
  });

  /* -------------------------- Block: lists ------------------------- */
  check("B16", "nested list", () => {
    const o = R("- a\n  - a1\n    - a1i");
    const d = parse(o);
    return d.querySelector("li ul li ul") ? ok() : bad("not nested");
  });
  check("B17", "loose list stays one list", () => {
    const o = R("- a\n\n- b");
    return (o.match(/<ul>/g) || []).length === 1
      ? ok()
      : bad((o.match(/<ul>/g) || []).length + " uls");
  });
  check("B18", "ordered 1) style", () => {
    const o = R("1) one\n2) two");
    return o.includes("<ol>") ? ok() : bad(o.slice(0, 80));
  });
  check("B19", "ordered start number", () => {
    const o = R("5. five\n6. six");
    return o.includes('start="5"') ? ok() : bad(o.slice(0, 80));
  });
  check("B20", "mixed task markers", () => {
    const o = R("- plain\n- [ ] task");
    const d = parse(o);
    return d.querySelectorAll('input[type="checkbox"]').length === 1
      ? ok()
      : bad();
  });
  check("B21", "uppercase [X] task", () => {
    const o = R("- [X] done\n- [ ] todo");
    const d = parse(o);
    return d.querySelectorAll('input[type="checkbox"]').length === 2
      ? ok()
      : bad();
  });
  check("R08", "nested child under task item", () => {
    const o = R("- [ ] parent\n  - child step");
    const d = parse(o);
    const li = Array.prototype.find.call(d.querySelectorAll("li"), (l) =>
      l.textContent.includes("child step"),
    );
    return li && !/- child step/.test(li.textContent) && d.querySelector("li ul")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("R15", "mid-item task marker stays literal", () => {
    const o = R("- item [ ] with marker");
    const d = parse(o);
    return o.includes("[ ]") && d.querySelectorAll("input").length === 0
      ? ok()
      : bad(o.slice(0, 80));
  });
  check("R01", "list numbering continues after embedded fence", () => {
    const o = R("1. Step one\n\n   " + B + "bash\n   npm i\n   " + B + "\n\n2. Step two");
    const d = parse(o);
    const ols = d.querySelectorAll("ol");
    return (
      ols.length === 1 &&
      d.querySelectorAll("ol > li").length === 2 &&
      d.querySelector("ol li pre")
        ? ok()
        : bad(o.slice(0, 90))
    );
  });

  /* ------------------------ Block: quotes -------------------------- */
  check("B22", "heading inside blockquote", () => {
    const o = R("> # Title\n> body");
    const d = parse(o);
    return d.querySelector("blockquote h1") ? ok() : bad(o.slice(0, 80));
  });
  check("B23", "nested blockquote", () => {
    const o = R("> level1\n>\n> > level2");
    const d = parse(o);
    return d.querySelector("blockquote blockquote") ? ok() : bad();
  });

  /* ------------------------ Block: tables -------------------------- */
  check("B24", "empty cell preserved", () => {
    const o = R("| A | B | C |\n|---|---|---|\n| 1 |  | 3 |");
    const d = parse(o);
    const rows = d.querySelectorAll("tbody tr");
    const last = rows[rows.length - 1];
    return last && last.querySelectorAll("td").length === 3
      ? ok()
      : bad("td count wrong");
  });
  check("B25", "table without leading pipe", () => {
    const o = R("A | B\n--- | ---\n1 | 2");
    return o.includes("<table>") ? ok() : bad(o.slice(0, 80));
  });
  check("B26", "alignment colons", () => {
    const o = R("| L | C | R |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    const d = parse(o);
    const th = d.querySelectorAll("th");
    const center = Array.prototype.some.call(
      th,
      (h) => /center/i.test(h.getAttribute("style") || "") || h.getAttribute("align") === "center",
    );
    return center ? ok() : bad(o.slice(0, 120));
  });
  check("B27", "escaped pipe in cell", () => {
    const o = R("| A | B |\n|---|---|\n| x \\| y | 2 |");
    const d = parse(o);
    const rows = d.querySelectorAll("tbody tr");
    const last = rows[rows.length - 1];
    const tds = last ? last.querySelectorAll("td") : [];
    return (
      tds.length === 2 &&
      tds[0].textContent.includes("x | y")
        ? ok()
        : bad("cells: " + tds.length)
    );
  });
  check("R02", "fence in table cell degrades safely", () => {
    const o = R("| Cmd | Note |\n|---|---|\n| " + B + "js\nx\n" + B + " | runs |");
    return !o.includes("__CODE_") && !o.includes("undefined") ? ok() : bad(o.slice(0, 90));
  });

  /* --------------------------- Inline ------------------------------ */
  check("I01", "bold+italic ***x***", () => {
    const o = R("***x***");
    return o.includes("<em><strong>x</strong></em>") ||
      o.includes("<strong><em>x</em></strong>")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("I02", "nested emphasis is well-formed", () => {
    const o = R("**bold *inner***");
    return o.includes("<strong>bold <em>inner</em></strong>")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("I03", "intraword underscores literal", () => {
    const o = R("use file_name_v2 and file__name__v2 here");
    return !o.includes("<em>") && !o.includes("<strong>")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("I04", "markers literal inside code span", () => {
    const o = R("`a * b * c` stays literal");
    const d = parse(o);
    return d.querySelector("code") && !d.querySelector("code em") ? ok() : bad(o.slice(0, 90));
  });
  check("I05", "strikethrough marker literal in code", () => {
    const o = R("`~~x~~` stays literal");
    const d = parse(o);
    return d.querySelector("code") && !d.querySelector("code del") ? ok() : bad();
  });
  check("I06", "backslash escapes honoured", () => {
    const o = R("\\*not emphasised\\*");
    return !o.includes("<em>") && !o.includes("\\") ? ok() : bad(o.slice(0, 80));
  });
  check("I07", "entities not double-escaped", () => {
    const o = R("&copy; 2024 &amp; partners");
    return !o.includes("&amp;copy;") ? ok() : bad(o.slice(0, 90));
  });
  check("I08", "reference links", () => {
    const o = R("See [the docs][1].\n\n[1]: https://example.com");
    return o.includes('href="https://example.com"') ? ok() : bad(o.slice(0, 90));
  });
  check("I09", "autolinks", () => {
    const o = R("Visit <https://example.com> now");
    return o.includes('href="https://example.com"') ? ok() : bad(o.slice(0, 90));
  });
  check("I10", "URL with parentheses kept", () => {
    const o = R("[x](https://en.wikipedia.org/wiki/Foo_(bar))");
    return o.includes('href="https://en.wikipedia.org/wiki/Foo_(bar)"')
      ? ok()
      : bad((o.match(/href="[^"]*"/) || [""])[0]);
  });
  check("R11", "link title parsed out of href", () => {
    const o = R('[x](https://a.io "Title here")');
    return (
      o.includes('href="https://a.io"') && o.includes("Title here") && !o.includes("a.io &quot;")
        ? ok()
        : bad(o.slice(0, 100))
    );
  });
  check("R10", "empty link text keeps href", () => {
    const o = R("[](https://example.com)");
    return o.includes('href="https://example.com"') ? ok() : bad(o.slice(0, 80));
  });
  check("R12", "image alt is plain text", () => {
    const o = R("![**bold** alt](i.png)");
    return o.includes('alt="bold alt"') && !o.includes('alt="<strong>')
      ? ok()
      : bad((o.match(/<img[^>]*>/) || [""])[0]);
  });
  check("R06", "two-space hard break", () => {
    const o = R("line one  \nline two");
    return o.includes("<br") ? ok() : bad(o.slice(0, 80));
  });
  check("R07", "backslash hard break", () => {
    const o = R("line one\\\nline two");
    return o.includes("<br") && !o.includes("\\") ? ok() : bad(o.slice(0, 80));
  });
  check("R13", "adjacent headings both render", () => {
    const o = R("# One\n# Two");
    const h = (t) =>
      new RegExp('<h1[^>]*>' + t + '(<a class="h-anchor"[\\s\\S]*?</a>)?</h1>').test(o);
    return h("One") && h("Two") ? ok() : bad(o.slice(0, 80));
  });
  check("R14", "ul and ol adjacent", () => {
    const o = R("- a\n- b\n\n1. x\n2. y");
    return o.includes("<ul>") && o.includes("<ol>") ? ok() : bad(o.slice(0, 80));
  });
  check("R09", "inline formatting in ordered items", () => {
    const o = R("1. `first`\n2. **second**");
    return o.includes("<code>first</code>") && o.includes("<strong>second</strong>")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("R03", "compact heading before fence", () => {
    const o = R("## Title\n" + B + "js\nx\n" + B);
    return /<h2[^>]*>Title(<a class="h-anchor"[\s\S]*?<\/a>)?<\/h2>/.test(o) && o.includes("<pre") ? ok() : bad(o.slice(0, 80));
  });
  check("R05", "relative link preserved", () => {
    const o = R("[local file](./chapters/02.md)");
    return o.includes('href="./chapters/02.md"') ? ok() : bad(o.slice(0, 80));
  });
  check("I12", "badge pattern (image in link)", () => {
    const o = R("[![alt](i.png)](page.html)");
    const d = parse(o);
    return d.querySelector("a img") ? ok() : bad(o.slice(0, 90));
  });
  check("I13", "images constrained (CSS rule present in built file)", () => {
    return html.includes("max-width: 100%") && html.includes("#content img")
      ? ok()
      : bad("img CSS rule missing");
  });

  /* ----------------------- Security & identity ---------------------- */
  check("I11", "javascript: URL stripped", () => {
    const o = R("[click me](javascript:alert(document.cookie))");
    return !o.includes("javascript:") ? ok() : bad(o.slice(0, 90));
  });
  check("SEC1", "event handler attributes stripped", () => {
    const o = R('<img src="x" onerror="alert(1)">');
    return !o.includes("onerror") ? ok() : bad(o.slice(0, 90));
  });
  check("SEC2", "script tags stripped", () => {
    const o = R("text\n\n<script>alert(1)</script>\n\nmore");
    return !o.includes("<script") ? ok() : bad(o.slice(0, 90));
  });
  check("R04", "in-page anchor stays in-page", () => {
    const o = R("[jump to setup](#setup)");
    const d = parse(o);
    const a = d.querySelector('a[href="#setup"]');
    return a && !a.hasAttribute("target") ? ok() : bad(o.slice(0, 90));
  });
  check("SEC3", "external links get target + noopener", () => {
    const o = R("[ext](https://example.com)");
    const d = parse(o);
    const a = d.querySelector('a[href="https://example.com"]');
    return (
      a &&
      a.getAttribute("target") === "_blank" &&
      /noopener/.test(a.getAttribute("rel") || "")
        ? ok()
        : bad(o.slice(0, 100))
    );
  });
  check("T01", "duplicate headings deduped", () => {
    const o = R("## Setup\n\ntext\n\n## Setup");
    return o.includes('id="setup"') && o.includes('id="setup-1"')
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("T02", "CJK heading ids preserved", () => {
    const o = R("## 简介\n\n## 概述");
    return o.includes('id="简介"') && o.includes('id="概述"')
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("T03", "slug from rendered text", () => {
    const o = R("## [`code` and *em*](https://x.io)");
    return o.includes('id="code-and-em"') ? ok() : bad(o.slice(0, 90));
  });
  check("H01", "raw HTML (details) renders", () => {
    const o = R("<details>\n<summary>T</summary>\nbody\n</details>");
    return o.includes("<details>") && o.includes("<summary>")
      ? ok()
      : bad(o.slice(0, 90));
  });
  check("R10E", "escapeEmbed neutralises payload breakout", () => {
    const escaped = W.escapeEmbed("<script>x<\/script> after");
    return !/<\/script/i.test(escaped) ? ok() : bad(escaped.slice(0, 80));
  });
  check("META1", "frontmatter split", () => {
    const s = W.splitFrontmatter("---\ntitle: X\nlang: fr\n---\nbody");
    return s.meta.title === "X" && s.meta.lang === "fr" && s.body === "body"
      ? ok()
      : bad(JSON.stringify(s.meta));
  });

  /* ----------------- Integration: the real loaded app --------------- */
  check("INT1", "embedded sample book rendered", () => {
    const c = window.document.getElementById("content");
    return c && c.innerHTML.length > 1500 && !c.hidden ? ok() : bad("len=" + (c ? c.innerHTML.length : 0));
  });
  check("INT2", "TOC tree built with nested links", () => {
    const links = window.document.querySelectorAll("#toc-content a.toc-link");
    return links.length >= 6 && window.document.querySelector("#toc-content li ul")
      ? ok()
      : bad("links=" + links.length);
  });
  check("INT3", "heading IDs unique in embedded doc", () => {
    const hs = window.document.querySelectorAll("#content h1, #content h2, #content h3, #content h4");
    const ids = Array.prototype.map.call(hs, (h) => h.id);
    return new Set(ids).size === ids.length && ids.every(Boolean)
      ? ok()
      : bad("dup/empty ids");
  });
  check("INT4", "metadata applied (title + lang)", () => {
    return (
      window.document.title === "Welcome to the Markdown Webbook" &&
      window.document.documentElement.lang === "en"
        ? ok()
        : bad("title=" + window.document.title + " lang=" + window.document.documentElement.lang)
    );
  });
  check("INT5", "reading state: search enabled, no fatal panel", () => {
    return (
      window.document.getElementById("btn-search") &&
      window.document.getElementById("btn-search").disabled === false &&
      window.document.getElementById("fatal").hidden === true
        ? ok()
        : bad()
    );
  });
  check("INT6", "no fatal jsdom errors during boot", () => {
    return jsdomNoise.length === 0 ? ok() : bad(jsdomNoise[0]);
  });

  /* ================== P1: settings (R11) + typography (R12) ============= */
  const doc = window.document;
  const root = doc.documentElement;
  let exported = null; /* filled by E2, booted in the async E2B below */

  check("FIG1", "sentence-like alt becomes figure with caption", () => {
    const o = R(
      "![A screenshot of the settings panel with three sliders](img.png)",
    );
    const d = parse(o);
    const fig = d.querySelector("figure");
    return fig && fig.querySelector("figcaption") && fig.querySelector("img")
      ? ok()
      : bad(o.slice(0, 100));
  });
  check("FIG2", "badge-in-link alt stays a plain image", () => {
    const o = R("[![build](badge.svg)](https://example.com/build)");
    const d = parse(o);
    return d.querySelector("a img") && !d.querySelector("figure")
      ? ok()
      : bad(o.slice(0, 100));
  });

  check("S1", "settings apply via data-attributes", () => {
    if (!W.settings.set("width", "l")) return bad("set width");
    if (root.getAttribute("data-width") !== "l") return bad("width attr");
    if (!W.settings.set("family", "serif")) return bad("set family");
    if (root.getAttribute("data-family") !== "serif") return bad("family attr");
    if (!W.settings.set("lh", "l")) return bad("set lh");
    if (root.getAttribute("data-lh") !== "l") return bad("lh attr");
    if (!W.settings.set("size", "l")) return bad("set size");
    if (root.getAttribute("data-size") !== "l") return bad("size attr");
    return ok();
  });
  check("S2", "settings persist to localStorage", () => {
    const raw = window.localStorage.getItem("mdwb:settings");
    const s = raw ? JSON.parse(raw) : null;
    return s && s.width === "l" && s.family === "serif" && s.lh === "l" &&
      !("wrap" in s)
      ? ok()
      : bad(raw || "empty");
  });
  check("S3", "invalid + removed settings rejected", () => {
    return W.settings.set("size", "huge") === false &&
      W.settings.get("size") === "l" &&
      W.settings.set("wrap", "on") === false &&
      W.settings.get("wrap") === undefined
      ? ok()
      : bad();
  });
  check("S4", "theme light/dark/auto resolves via data-theme", () => {
    W.settings.set("theme", "dark");
    const dark = root.getAttribute("data-theme") === "dark";
    W.settings.set("theme", "light");
    const light = root.getAttribute("data-theme") === "light";
    W.settings.set("theme", "auto");
    const pref = root.getAttribute("data-theme-pref") === "auto";
    return dark && light && pref
      ? ok()
      : bad("dark=" + dark + " light=" + light + " pref=" + pref);
  });
  check("S5", "settings UI aria-pressed tracks state", () => {
    W.settings.set("family", "serif");
    const seg = doc.querySelector('.seg[data-setting="family"]');
    const on = seg ? seg.querySelector('[data-value="serif"]') : null;
    const off = seg ? seg.querySelector('[data-value="sans"]') : null;
    return on &&
      on.getAttribute("aria-pressed") === "true" &&
      off.getAttribute("aria-pressed") === "false"
      ? ok()
      : bad();
  });

  /* ========================= P1: find-in-page (R13) ===================== */
  check("F1", "find highlights all matches + counter", () => {
    const r = W.find.run("markdown");
    if (!(r.count > 5)) return bad("count=" + r.count);
    const marks = doc.querySelectorAll("#content mark.find-hl");
    if (marks.length !== r.count) return bad("marks=" + marks.length);
    return doc.querySelector("#content mark.find-hl-current") ? ok() : bad("no current");
  });
  check("F2", "find steps forward", () => {
    W.find.step(1);
    const st = W.find.state();
    return st.index === 1 && st.count > 5 ? ok() : bad("index=" + st.index);
  });
  check("F3", "no-match query reports cleanly", () => {
    const r = W.find.run("zzzqnope");
    return r.count === 0 &&
      doc.getElementById("find-count").textContent === "No matches"
      ? ok()
      : bad(doc.getElementById("find-count").textContent);
  });
  check("F4", "close restores pristine DOM, zero marks", () => {
    W.find.run("the");
    W.find.close();
    const left = doc.querySelectorAll("#content mark").length;
    const st = W.find.state();
    return left === 0 && st.open === false && st.count === 0
      ? ok()
      : bad("marks=" + left);
  });

  /* ==================== P1: export suite + aids (R14/R16) ================ */
  check("TX1", "rendered text extraction", () => {
    const t = W.renderedText();
    return t.includes("Happy reading") &&
      t.includes("Welcome to the Markdown Webbook")
      ? ok("len=" + t.length)
      : bad(t.slice(0, 80));
  });
  check("UI1", "reading aids + export chrome present", () => {
    const ids = [
      "read-progress",
      "read-progress-fill",
      "btn-top",
      "findbar",
      "aa-popover",
      "more-menu",
      "mi-export",
      "mi-print",
      "footer-title",
    ];
    const missing = ids.filter((id) => !doc.getElementById(id));
    return missing.length === 0 ? ok() : bad("missing: " + missing.join(","));
  });
  check("UI2", "P1 css present (measure/touch/print/safe-area)", () => {
    const cssOk =
      html.includes("--measure: 68ch") &&
      html.includes("--control-size: 44px") &&
      html.includes("@media print") &&
      html.includes("env(safe-area-inset-bottom)") &&
      html.includes("@media (hover: none)") &&
      html.includes("viewport-fit=cover");
    return cssOk ? ok() : bad("css token missing");
  });
  check("UI3", "toolbar composition v2 (outline, document, search, Aa, more)", () => {
    return doc.getElementById("btn-toc") &&
      doc.getElementById("btn-docs") &&
      doc.getElementById("btn-search") &&
      doc.getElementById("btn-aa") &&
      doc.getElementById("btn-more") &&
      doc.getElementById("doc-menu") &&
      !doc.getElementById("btn-open") &&
      !doc.getElementById("btn-theme")
      ? ok()
      : bad("wrong toolbar composition");
  });
  /* ============ UI v2: glass toolbar + search layer + P2 (R17–R21) ======= */

  check("UI4", "search layer + progress-on-toolbar + doc menu markup", () => {
    const fb = doc.getElementById("findbar");
    const rp = doc.getElementById("read-progress");
    const header = doc.querySelector("header.toolbar");
    return (
      fb && fb.classList.contains("search-layer") &&
      fb.querySelector(".search-field #find-input") &&
      rp && header && header.contains(rp) &&
      fb.querySelector("#find-prev") && fb.querySelector("#find-next") &&
      fb.querySelector("#find-close")
    ) ? ok() : bad("search layer structure");
  });
  check("SR1", "search layer opens/closes via data-open without hidden attr", () => {
    const fb = doc.getElementById("findbar");
    W.find.open();
    const on = fb.getAttribute("data-open") === "on" && !fb.hidden;
    W.find.close();
    const off = fb.getAttribute("data-open") === "off";
    return on && off ? ok() : bad("data-open=" + fb.getAttribute("data-open"));
  });
  check("HL1", "js code highlighted (keyword, string, comment)", () => {
    const o = R(B + "js\nconst greeting = \"hi\"; // note\n" + B);
    return o.includes("hljs-keyword") && o.includes("hljs-string") &&
      o.includes("hljs-comment")
      ? ok() : bad(o.slice(0, 120));
  });
  check("HL2", "unknown language left untouched", () => {
    const o = R(B + "whiplash\nconst x = 1\n" + B);
    return /<pre/.test(o) && !o.includes("hljs-") ? ok() : bad(o.slice(0, 120));
  });
  check("HL3", "highlighter output stays escaped", () => {
    const o = R(B + "html\n<script>alert(1)</script>\n" + B);
    return o.includes("&lt;script&gt;") && !o.includes("<script>alert")
      ? ok() : bad(o.slice(0, 120));
  });
  check("PN1", "heading permalinks appended (svg-only anchors)", () => {
    const o = R("## Alpha\n\ntext\n\n## Beta\n\nmore");
    return /<h2[^>]*id="alpha">Alpha<a class="h-anchor" href="#alpha"/.test(o) &&
      o.includes("<svg")
      ? ok() : bad(o.slice(0, 120));
  });
  check("PN2", "permalink click sets the hash", () => {
    const a = doc.querySelector('#content h2 a.h-anchor');
    if (!a) return bad("no anchor in embedded doc");
    a.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    return window.location.hash === a.getAttribute("href")
      ? ok("hash=" + window.location.hash)
      : bad("hash=" + window.location.hash);
  });
  check("ST2", "strict mode strips raw HTML, keeps text", () => {
    const o = W.render("hello <b>bold</b> and <em>em</em> world", { strict: "strip" });
    return !o.includes("<b>") && !o.includes("<em>") && o.includes("bold") &&
      o.includes("em") && o.includes("world")
      ? ok() : bad(o.slice(0, 100));
  });
  check("ST1", "default mode keeps sanitised HTML (control)", () => {
    const o = W.render("hello <b>bold</b> world");
    return o.includes("<b>") ? ok() : bad(o.slice(0, 100));
  });
  check("ST3", "raw HTML setting re-renders; per-doc override removed", () => {
    const clickSeg = (val) => {
      const b = doc.querySelector(
        '#aa-popover .seg[data-setting="rawHtml"] button[data-value="' +
          val +
          '"]',
      );
      b.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    };
    clickSeg("strip");
    const kbdGone = !doc.querySelector("#content kbd");
    const saved =
      JSON.parse(window.localStorage.getItem("mdwb:settings")).rawHtml ===
      "strip";
    const noDocToggle = !doc.getElementById("mi-strict");
    clickSeg("allow");
    const kbdBack = !!doc.querySelector("#content kbd");
    return kbdGone && saved && noDocToggle && kbdBack
      ? ok("global-only")
      : bad(
          "gone=" + kbdGone + " saved=" + saved +
            " noToggle=" + noDocToggle + " back=" + kbdBack,
        );
  });
  check("ST4", "strict keeps markdown structure, drops raw HTML only", () => {
    const md = "# Head One\n\n- item a\n- item b\n\n<b>raw</b> text\n\n```js\nconst x = \"<i>not touched</i>\";\n```\n\nAuto <https://example.com> kept";
    const o = W.render(md, { strict: "strip" });
    const d = parse(o);
    return !!d.querySelector("h1") && !!d.querySelector("ul li") &&
      !o.includes("<b>") && o.includes("raw") && o.includes("text") &&
      /* code fence content survives verbatim (escaped only for display) */
      o.includes("&lt;i&gt;not touched&lt;/i&gt;") &&
      /* autolink survives the strict stripper */
      d.querySelector('a[href="https://example.com"]')
      ? ok() : bad(o.slice(0, 160));
  });
  check("ST5", "strict preserves task-list checkboxes", () => {
    const o = W.render("- [x] done <span>gone</span>", { strict: "strip" });
    return o.includes('type="checkbox"') && !o.includes("<span>") && o.includes("done")
      ? ok() : bad(o.slice(0, 120));
  });
  check("ST6", "legacy per-document strict prefs are purged, not hidden", () => {
    const cur = JSON.parse(window.localStorage.getItem("mdwb:current"));
    const k = "mdwb:docpref:" + cur.id;
    window.localStorage.setItem(
      k,
      JSON.stringify({ rawHtml: "strip", tasks: { "0": true } }),
    );
    W.purgeLegacyPrefs();
    const after = JSON.parse(window.localStorage.getItem(k));
    return after && !("rawHtml" in after) && after.tasks &&
      after.tasks["0"] === true
      ? ok("rawHtml deleted, tasks kept")
      : bad(JSON.stringify(after));
  });
  check("PAL1", "palette lists commands + sections", () => {
    W.palette.open();
    const st = W.palette.state();
    const groups = W.palette.items().map((i) => i.group);
    return st.open && st.count > 8 && groups.includes("Commands") &&
      groups.includes("Sections")
      ? ok("count=" + st.count) : bad("count=" + st.count);
  });
  check("PAL2", "palette filters by query", () => {
    W.palette.query("print");
    const items = W.palette.items();
    W.palette.query("");
    return items.length >= 1 && items.length <= 5 &&
      items[0].label === "Print / save as PDF"
      ? ok() : bad(JSON.stringify(items));
  });
  check("PAL3", "palette executes a command (opens search)", () => {
    W.palette.query("search document");
    const idx = W.palette.items().findIndex((i) => i.label === "Search document");
    W.palette.execute(idx);
    const st = W.find.state();
    const palClosed = !W.palette.state().open;
    W.find.close();
    return st.open && palClosed ? ok() : bad("find=" + st.open);
  });
  check("HELP1", "shortcut overlay opens with shortcut map", () => {
    W.help.open();
    const backdrop = doc.getElementById("help-backdrop");
    const visible = !backdrop.hidden && backdrop.textContent.includes("Command palette");
    W.help.close();
    return visible && backdrop.hidden ? ok() : bad("overlay state");
  });
  check("KBD1", "Ctrl/Cmd+K toggles the palette (keydown)", () => {
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
    const opened = W.palette.state().open;
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    return opened && !W.palette.state().open ? ok() : bad("opened=" + opened);
  });
  check("KBD2", "? opens the shortcut map, Esc closes", () => {
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true }));
    const opened = W.help.state().open;
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    return opened && !W.help.state().open ? ok() : bad("opened=" + opened);
  });
  check("KBD3", "Ctrl/Cmd+O requests the file picker", () => {
    let requested = false;
    const fi = doc.getElementById("file-input");
    const orig = fi.click.bind(fi);
    fi.click = function () { requested = true; orig(); };
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "o", ctrlKey: true, bubbles: true, cancelable: true }));
    fi.click = orig;
    return requested ? ok() : bad("picker not requested");
  });
  check("AA2", "Aa popover exposes raw-HTML default control", () => {
    const seg = doc.querySelector('.seg[data-setting="rawHtml"]');
    return seg && seg.querySelector('[data-value="allow"]') &&
      seg.querySelector('[data-value="strip"]')
      ? ok() : bad("missing rawHtml segment");
  });
  /* ======= UI refinements v1.3.1: removals + line height + per-block
             wrap + tables + chrome repositioning ===================== */
  check("RM1", "recents feature fully removed (UI + palette)", () => {
    const ids = ["recents-wrap", "recents-list", "btn-clear-recents",
      "menu-recents", "mi-clear-recents"];
    const left = ids.filter((id) => doc.getElementById(id));
    W.palette.query("");
    const groups = W.palette.items().map((i) => i.group);
    return left.length === 0 && !groups.includes("Recent documents")
      ? ok("groups=" + groups.join("|"))
      : bad("left=" + left.join(",") + " groups=" + groups.join("|"));
  });
  check("RM2", "prev/next section nav removed from markup", () => {
    return !doc.getElementById("doc-nav") && !doc.querySelector(".doc-nav")
      ? ok() : bad("doc-nav still present");
  });
  check("LH1", "line-height S/M/L applies + persists", () => {
    if (!W.settings.set("lh", "s")) return bad("set s");
    const s = root.getAttribute("data-lh") === "s";
    if (!W.settings.set("lh", "l")) return bad("set l");
    const l = root.getAttribute("data-lh") === "l";
    const css = html.includes('html[data-lh="s"]') &&
      html.includes('html[data-lh="l"]') && html.includes('html[data-lh="m"]');
    W.settings.set("lh", "m");
    const saved = JSON.parse(window.localStorage.getItem("mdwb:settings"));
    return s && l && css && saved.lh === "m"
      ? ok() : bad("s=" + s + " l=" + l + " css=" + css);
  });
  check("CW1", "code blocks wrap by default with per-block control", () => {
    const btns = Array.prototype.slice.call(doc.querySelectorAll(".wrap-code-btn"));
    if (btns.length < 3) return bad("toggle buttons=" + btns.length);
    const allOn = btns.every((b) =>
      b.getAttribute("aria-pressed") === "true" &&
      b.closest(".code-wrapper").classList.contains("is-wrapped"));
    return allOn && !doc.querySelector('.seg[data-setting="wrap"]')
      ? ok("blocks=" + btns.length) : bad("allOn=" + allOn);
  });
  check("CW2", "wrap toggle is independent per block", () => {
    const btns = Array.prototype.slice.call(doc.querySelectorAll(".wrap-code-btn"));
    btns[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const firstOff = !btns[0].closest(".code-wrapper").classList.contains("is-wrapped");
    const restOn = btns.slice(1).every((b) =>
      b.closest(".code-wrapper").classList.contains("is-wrapped"));
    btns[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const restored = btns[0].closest(".code-wrapper").classList.contains("is-wrapped");
    return firstOff && restOn && restored
      ? ok() : bad("off=" + firstOff + " rest=" + restOn + " back=" + restored);
  });
  check("LN1", "code blocks carry line numbers in a minimal gutter", () => {
    W.openMarkdown("# LN\n\n```js\nvar a = 1;\n\nvar b = 2;\n```\n");
    const lines = Array.prototype.slice.call(
      doc.querySelectorAll("#content .code-wrapper .code-line"));
    if (lines.length !== 3) return bad("lines=" + lines.length);
    const gutter = /#content pre code\s*{[^}]*counter-reset:\s*src-line/.test(html) &&
      /\.code-wrapper \.code-line::before\s*{[^}]*content:\s*counter\(src-line\)/.test(html);
    const textOk = lines[0].textContent === "var a = 1;" &&
      lines[1].textContent === "" && lines[2].textContent === "var b = 2;";
    return gutter && textOk ? ok() : bad("gutter=" + gutter + " text=" + textOk);
  });
  check("LN2", "multi-line token spans stay coloured across the split", () => {
    W.openMarkdown("# LN2\n\n```c\n/* one\n   two */\nint x;\n```\n");
    const lines = Array.prototype.slice.call(
      doc.querySelectorAll("#content .code-wrapper .code-line"));
    if (lines.length !== 3) return bad("lines=" + lines.length);
    const coloured = lines.slice(0, 2).every(
      (l) => !!l.querySelector("span.hljs-comment"));
    return coloured ? ok() : bad("comment colour kept=" + coloured);
  });
  check("CL1", "collapse control folds a block to an 88px window", () => {
    W.openMarkdown("# CL\n\n```js\n" + "var x = 1;\n".repeat(12) + "```\n");
    const btn = doc.querySelector("#content .collapse-code-btn");
    if (!btn) return bad("no collapse button");
    const wrap = btn.closest(".code-wrapper");
    const order = !!btn.nextElementSibling &&
      btn.nextElementSibling.classList.contains("wrap-code-btn");
    const expanded = !wrap.classList.contains("is-collapsed") &&
      btn.getAttribute("aria-pressed") === "false";
    btn.click();
    const folded = wrap.classList.contains("is-collapsed") &&
      btn.getAttribute("aria-pressed") === "true";
    const css = /#content \.code-wrapper\.is-collapsed pre\s*{[^}]*height:\s*88px/.test(html) &&
      html.includes("linear-gradient(") &&
      /\.code-btn\[aria-pressed="true"\]\s*{[^}]*color:\s*var\(--accent-color\)/.test(html);
    btn.click();
    const unfolded = !wrap.classList.contains("is-collapsed");
    return order && expanded && folded && css && unfolded
      ? ok() : bad("order=" + order + " exp=" + expanded + " fold=" + folded +
                   " css=" + css + " back=" + unfolded);
  });
  check("TB1", "tables: container-capped columns, full span, hidden-bar horizontal scroll", () => {
    const scrollable = /\.table-scroll\s*{[^}]*overflow-x:\s*auto/.test(html);
    const noYS = /\.table-scroll\s*{[^}]*overflow-y:\s*hidden/.test(html);
    const noSb = /\.table-scroll::-webkit-scrollbar\s*{[^}]*display:\s*none/.test(html) &&
      html.includes("scrollbar-width: none");
    const cq = /\.table-wrapper\s*{[^}]*container-type:\s*inline-size/.test(html) &&
      /\.table-wrapper\s*{[^}]*--wb-col-cap:\s*50cqw/.test(html) &&
      /\.table-wrapper\s*{[^}]*timeline-scope:\s*--table-scroll/.test(html);
    const cap = /@supports \(width: 1cqw\)\s*{\s*\.table-wrapper th > \.td-cap,\s*\.table-wrapper td > \.td-cap\s*{[^}]*max-width:\s*var\(--wb-col-cap\)/.test(html);
    const span = /#content table\s*{[^}]*width:\s*100%/.test(html);
    const noFloor = !/#content th,\s*#content td\s*{[^}]*min-width:\s*150px/.test(html);
    const shadows = /@supports \(animation-timeline: --table-scroll\) and\s*\(timeline-scope: --table-scroll\)/.test(html) &&
      /\.table-wrapper\.is-pannable::before\s*{[^}]*animation-timeline:\s*--table-scroll/.test(html) &&
      /\.table-wrapper\.is-pannable::after\s*{[^}]*animation-timeline:\s*--table-scroll/.test(html);
    /* 1.7.3: shadows are gated on a real overflow measurement — the
       settle pass must toggle .is-pannable on the wrapper. */
    const gate = /classList\.toggle\(\s*"is-pannable",\s*pannable,?\s*\)/.test(html);
    /* Structural: the enhancer must actually wrap rendered tables. */
    W.openMarkdown("# TB\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
    const tw = doc.querySelector("#content .table-wrapper");
    const wrapped = !!tw && !!tw.querySelector(".table-scroll table") &&
      !!tw.querySelector(".td-cap") &&
      !doc.querySelector("#content > table") &&
      !doc.querySelector("#content .table-wrapper > table");
    return scrollable && noYS && noSb && cq && cap && span && noFloor &&
      shadows && gate && wrapped
      ? ok() : bad("scroll=" + scrollable + " y=" + noYS + " sb=" + noSb +
                   " cq=" + cq + " cap=" + cap + " span=" + span +
                   " floorGone=" + noFloor + " shadow=" + shadows +
                   " gate=" + gate + " wrapped=" + wrapped);
  });
  check("DRG1", "tables pan by mouse drag with scrollbars hidden", () => {
    const drag = html.includes("Table drag-to-scroll") &&
      /pointerType !== "mouse"/.test(html) &&
      /tableDrag\.w\.scrollLeft = tableDrag\.sl - dx;/.test(html);
    const stop = /if \(tableDragClick\) {\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);/.test(html);
    return drag && stop ? ok() : bad("drag=" + drag + " stop=" + stop);
  });
  check("PB1", "progress line tagged to the toolbar's bottom edge", () => {
    const read = /\.read-progress\s*{[^}]*bottom:\s*0/.test(html) &&
      !/\.read-progress\s*{[^}]*top:\s*0/.test(html);
    const load = /\.progress\s*{[^}]*bottom:\s*0/.test(html);
    return read && load ? ok() : bad("read=" + read + " load=" + load);
  });
  check("BT1", "back-to-top is a rounded square (not a circle)", () => {
    const m = html.match(/\.btn-top\s*{[^}]*border-radius:\s*([^;]+);/);
    return m && m[1].indexOf("50%") === -1 ? ok(m[1].trim()) : bad(m ? m[1] : "missing");
  });
  check("DM1", "document menu anchors beneath the document icon", () => {
    const m = doc.getElementById("doc-menu");
    return m && m.getAttribute("data-anchor") === "trigger-left" &&
      /getBoundingClientRect\(\)\.left/.test(html)
      ? ok() : bad("anchor missing");
  });
  check("SAF1", "Safari-style rounded-square plates on toolbar buttons", () => {
    return html.includes("--btn-plate") &&
      /\.toolbar \.btn\s*{[^}]*background:\s*var\(--btn-plate\)/.test(html)
      ? ok() : bad("plate style missing");
  });
  /* ======= QoL v1.4.0: M0–M5 — headingless docs, live task checkboxes,
             header accent, print preservation, lightbox, resize ========= */
  check("NH1", "heading-less document loads without fatal error", () => {
    W.openMarkdown("Just a paragraph, no headings here.\n\nAnd another one.");
    const fatalHidden = doc.getElementById("fatal").hidden;
    const hasP = !!doc.querySelector("#content p");
    const tocEmpty = !!doc.querySelector("#toc-content .toc-empty");
    return fatalHidden && hasP && tocEmpty
      ? ok() : bad("fatal=" + !fatalHidden + " p=" + hasP);
  });
  check("TC1", "task checkboxes are interactive + persist per doc+index", () => {
    const src = "- [x] alpha\n- [ ] beta\n- [ ] gamma";
    W.openMarkdown(src);
    const boxes = Array.prototype.slice.call(
      doc.querySelectorAll("#content .task-checkbox"));
    if (boxes.length !== 3) return bad("boxes=" + boxes.length);
    boxes[1].click();
    if (!boxes[1].checked) return bad("click did not tick");
    const cur = JSON.parse(window.localStorage.getItem("mdwb:current"));
    const srcUntouched = cur && cur.source.includes("- [ ] beta") &&
      cur.source.includes("- [x] alpha");
    /* Look up the pref by the current document's id (other docs legitimately
       hold docprefs too — e.g. ST3's sample-doc strict toggle). */
    const prefKey = cur ? "mdwb:docpref:" + cur.id : null;
    const prefs = prefKey ? JSON.parse(window.localStorage.getItem(prefKey)) : null;
    const persisted = !!(prefs && prefs.tasks && prefs.tasks["1"] === true);
    return srcUntouched && persisted
      ? ok("pref=" + prefKey)
      : bad("src=" + srcUntouched + " prefKey=" + prefKey +
            " prefs=" + JSON.stringify(prefs));
  });
  check("TC2", "task ticks restore after a re-render of the same source", () => {
    W.openMarkdown("- [x] alpha\n- [ ] beta\n- [ ] gamma");
    const boxes = doc.querySelectorAll("#content .task-checkbox");
    return boxes.length === 3 && boxes[1].checked === true && boxes[2].checked === false
      ? ok() : bad("b1=" + boxes[1].checked + " b2=" + boxes[2].checked);
  });
  check("HA1", "header accent setting applies, validates and persists", () => {
    if (!W.settings.set("accent", "blue")) return bad("set blue rejected");
    const on = root.getAttribute("data-accent") === "blue";
    const rejected = W.settings.set("accent", "red") === false;
    const css = html.includes('html[data-accent="blue"] #content h1') &&
      html.includes('html[data-accent="yellow"] #content h6') &&
      html.includes("dot-orange");
    W.settings.set("accent", "none");
    const saved = JSON.parse(window.localStorage.getItem("mdwb:settings"));
    return on && rejected && css && saved.accent === "none"
      ? ok() : bad("on=" + on + " rej=" + rejected + " css=" + css);
  });
  check("HA2", "accent control is stacked and sits below Raw HTML", () => {
    const rows = Array.prototype.slice.call(
      doc.querySelectorAll("#aa-popover .pop-row"));
    const rawIdx = rows.findIndex(
      (r) => r.querySelector('.seg[data-setting="rawHtml"]'));
    const accIdx = rows.findIndex(
      (r) => r.querySelector('.seg[data-setting="accent"]'));
    if (rawIdx === -1 || accIdx === -1) return bad("rows missing");
    if (accIdx !== rawIdx + 1) return bad("raw=" + rawIdx + " accent=" + accIdx);
    const row = rows[accIdx];
    const buttons = row.querySelectorAll(".seg button");
    return row.classList.contains("stacked") && buttons.length === 5 &&
      buttons[0].getAttribute("data-value") === "none"
      ? ok("5 swatches") : bad("stacked=" + row.classList.contains("stacked"));
  });
  check("PR1", "print preserves reading settings (no forced light)", () => {
    /* Scope to the template's print block: everything up to its closing
       </style> — the app script later in the file legitimately contains
       the publication stylesheet's own tokens. */
    const pb = (html.match(/@media print[\s\S]*?<\/style>/) || [""])[0];
    const forced = html.includes("Always print light") ||
      /--bg-color:\s*#/.test(pb) ||
      /background:\s*#fff/.test(pb);
    const exact = /print-color-adjust:\s*exact/.test(pb);
    const chromeHidden = /\.lightbox,/.test(pb);
    const containerKept = /\.container\s*{[^}]*padding:\s*0/.test(pb) &&
      !/\.container\s*{[^}]*max-width:\s*100%/.test(pb);
    return !forced && exact && chromeHidden && containerKept
      ? ok() : bad("forced=" + forced + " exact=" + exact + " cw=" + containerKept);
  });
  check("LX1", "image lightbox opens on click, closes on Esc", () => {
    W.openMarkdown("![A calm figure caption](figure.png)\n\nText after.");
    const img = doc.querySelector("#content img");
    if (!img) return bad("no img");
    img.click();
    const lb = doc.getElementById("lightbox");
    const cap = doc.getElementById("lightbox-cap");
    const opened = !lb.hidden && W.lightbox.state().open === true &&
      lb.querySelector("img").src.indexOf("figure.png") !== -1 &&
      !cap.hidden && cap.textContent === "A calm figure caption" &&
      root.getAttribute("data-lightbox") === "on";
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    const closed = lb.hidden && !W.lightbox.state().open &&
      root.getAttribute("data-lightbox") !== "on";
    return opened && closed ? ok() : bad("open=" + opened + " close=" + closed);
  });
  check("LX2", "linked images (badges) never open the lightbox", () => {
    W.openMarkdown("[![badge](b.png)](https://example.com)");
    const img = doc.querySelector("#content a img");
    if (!img) return bad("no linked img");
    img.click();
    const opened = W.lightbox.state().open;
    W.lightbox.close();
    return !opened ? ok() : bad("opened=" + opened);
  });
  check("RV1", "resize closes open popovers (no stale anchor)", () => {
    const btn = doc.getElementById("btn-docs");
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const menu = doc.getElementById("doc-menu");
    const opened = !menu.hidden;
    window.dispatchEvent(new window.Event("resize"));
    const closed = menu.hidden;
    return opened && closed ? ok() : bad("open=" + opened + " close=" + closed);
  });
  check("MENU1", "doc menu: publication items ordered, strict gone", () => {
    const menu = doc.getElementById("doc-menu");
    const ids = Array.prototype.map.call(
      Array.prototype.filter.call(
        menu.children,
        (el) => el.tagName === "BUTTON",
      ),
      (b) => b.id,
    );
    const expected = [
      "mi-open", "mi-open-url", "mi-paste", "mi-copy-md", "mi-copy-text",
      "mi-download", "mi-export", "mi-publish", "mi-print", "mi-meta",
      "mi-embed", "mi-pubmenu",
    ];
    const same =
      ids.length === expected.length &&
      expected.every((v, i) => ids[i] === v);
    const toggleRight = !!menu.querySelector(
      "#mi-pubmenu .pub-switch .pub-knob",
    );
    return same && toggleRight
      ? ok(ids.join(","))
      : bad(ids.join(",") + " switch=" + toggleRight);
  });
  check("META1", "metadata dialog saves per-document state", () => {
    W.openMarkdown("# T\n\nbody text");
    W.metaDialog.open();
    const opened = W.metaDialog.state().open &&
      !doc.getElementById("meta-backdrop").hidden;
    doc.getElementById("mf-title").value = "Pub Title";
    doc.getElementById("mf-author").value = "Jane Doe & Co <jane@x.io>";
    doc.getElementById("mf-desc").textContent = "  A test description  ";
    W.metaDialog.save();
    const closed = doc.getElementById("meta-backdrop").hidden;
    const cur = JSON.parse(window.localStorage.getItem("mdwb:current"));
    const prefs = JSON.parse(
      window.localStorage.getItem("mdwb:docpref:" + cur.id),
    );
    const savedMeta = !!(
      prefs && prefs.meta && prefs.meta.title === "Pub Title" &&
      prefs.meta.author === "Jane Doe & Co <jane@x.io>" &&
      prefs.meta.description === "A test description"
    );
    W.metaDialog.open();
    const shown = doc.getElementById("mf-title").value === "Pub Title";
    W.metaDialog.close();
    return opened && closed && savedMeta && shown
      ? ok()
      : bad("open=" + opened + " close=" + closed + " saved=" + savedMeta +
            " shown=" + shown);
  });
  check("MP1", "meta panel polish: 38px rows, 88px editor, inverted Save", () => {
    const token = html.includes("--space-5: 20px;");
    const row38 = /\.meta-row\s*{[^}]*height:\s*38px/.test(html);
    const sub = /\.meta-sub\s*{[^}]*padding:\s*var\(--space-6\)\s+0/.test(html);
    const edit = /\.meta-row \.meta-edit\s*{[^}]*height:\s*88px[^}]*scrollbar-width:\s*none/.test(html) &&
      /<div id="mf-desc" class="meta-edit" contenteditable="true"/.test(html);
    const btn38 = /\.mbtn\s*{[^}]*height:\s*38px/.test(html);
    const save = /\.mbtn\.primary\s*{[^}]*background:\s*var\(--text-color\)[^}]*color:\s*var\(--bg-color\)/.test(html);
    const label = /#mi-embed \.mi-label,\s*#mi-pubmenu \.mi-label\s*{[^}]*color:\s*var\(--text-color\)/.test(html);
    return token && row38 && sub && edit && btn38 && save && label
      ? ok() : bad("token=" + token + " row=" + row38 + " sub=" + sub +
                   " edit=" + edit + " btn=" + btn38 + " save=" + save +
                   " label=" + label);
  });
  check("UX73", "v1.7.3 coherence: shared modal-x, panel paddings, 720px find bar", () => {
    /* One shared close-button voice for both modals; the old .meta-x
       rules are fully retired. */
    const sharedX = /<button id="meta-close" class="modal-x"/.test(html) &&
      /<button id="help-close" class="modal-x"/.test(html) &&
      /\.modal-x\s*{[^}]*width:\s*30px/.test(html) &&
      /\.modal-x:active\s*{[^}]*transform:\s*scale\(0\.95\)/.test(html) &&
      !/\.meta-x\b/.test(html);
    /* Panel paddings: help --space-4; meta 0 through the doubled
       selector that beats the later .help-panel declaration; shared
       1.05rem/700 header voice. */
    const helpPad = /\.help-panel\s*{[^}]*padding:\s*var\(--space-4\)/.test(html);
    const metaIso = /\.help-panel\.meta-panel\s*{[^}]*padding:\s*0/.test(html) &&
      /\.help-panel\.meta-panel\s*{[^}]*width:\s*min\(520px,\s*100%\)/.test(html);
    const head = /\.help-title\s*{[^}]*font-weight:\s*700/.test(html) &&
      /\.meta-head h2\s*{[^}]*font-weight:\s*700/.test(html);
    /* 720px find bar: no flex gap, 30px nav/close lanes, content-sized
       count, slim field padding. (Base rules differ, so each pattern is
       unique to the media block.) */
    const sGap = /\.search-inner\s*{[^}]*gap:\s*0;/.test(html);
    const sField = /\.search-field\s*{[^}]*min-width:\s*140px[^}]*padding:\s*0\s+var\(--space-2\)/.test(html);
    const sCount = /\.find-count\s*{[^}]*width:\s*max-content[^}]*max-width:\s*none/.test(html);
    const sBtns = /#find-prev,\s*#find-next,\s*#find-close\s*{\s*width:\s*30px;/.test(html);
    return sharedX && helpPad && metaIso && head && sGap && sField &&
      sCount && sBtns
      ? ok() : bad("x=" + sharedX + " helpPad=" + helpPad +
                   " metaIso=" + metaIso + " head=" + head + " gap=" + sGap +
                   " field=" + sField + " count=" + sCount + " btns=" + sBtns);
  });

  /* ---------------- v1.8.0: url import, mdx, exclusivity ---------------- */
  const UrlStubs = {
    md: (text) => ({
      ok: true, status: 200, statusText: "OK",
      headers: { get: (k) => (/content-type/i.test(k) ? "text/markdown" : null) },
      text: () => Promise.resolve(text),
    }),
    err: (status, statusText) => ({
      ok: false, status, statusText,
      headers: { get: () => null },
      text: () => Promise.resolve(""),
    }),
  };
  const curRec = () => {
    const raw = window.localStorage.getItem("mdwb:current");
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  };
  const toastText = () =>
    window.document.getElementById("toast").textContent;

  check("U09", "url dialog: meta-panel shell, label-less left field, spinner", () => {
    /* Placement: directly beneath Open Markdown file… in the doc menu. */
    const miOpen = doc.getElementById("mi-open");
    const miUrl = doc.getElementById("mi-open-url");
    const placed = miOpen && miUrl && miOpen.nextElementSibling === miUrl &&
      /Open from url…/.test(miUrl.textContent);
    /* Modal reuses the meta-panel shell; the field is label-less, typed
       for urls, left-aligned; spinner + loading styles ship. */
    const shell = /<div id="openurl-panel" class="help-panel meta-panel"/.test(html);
    const field = /<input id="mfu-url" name="url" type="url" inputmode="url" [^>]*aria-label="Markdown file url"/.test(html) &&
      !/label[^>]*for="mfu-url"/.test(html);
    const left = /\.openurl-row input\s*{[^}]*text-align:\s*left/.test(html);
    const formPad = /#openurl-form\s*{[^}]*padding:\s*0px var\(--space-5\) var\(--space-5\)/.test(html);
    const spin = /\.mbtn \.mbtn-spinner\s*{[^}]*border-radius:\s*50%/.test(html) &&
      /@keyframes mbtn-spin/.test(html) &&
      /\.mbtn\.is-loading \.mbtn-label\s*{[^}]*display:\s*none/.test(html) &&
      /\.mbtn\.is-loading \.mbtn-spinner\s*{[^}]*display:\s*inline-block/.test(html);
    const btn = !!doc.getElementById("openurl-open") &&
      !!doc.querySelector("#openurl-open .mbtn-label") &&
      !!doc.querySelector("#openurl-open .mbtn-spinner") &&
      doc.getElementById("openurl-open").textContent.indexOf("Open") !== -1;
    const closedAtBoot = doc.getElementById("openurl-backdrop").hidden === true;
    return placed && shell && field && left && formPad && spin && btn &&
      closedAtBoot
      ? ok() : bad("place=" + placed + " shell=" + shell + " field=" + field +
                   " left=" + left + " pad=" + formPad + " spin=" + spin +
                   " btn=" + btn + " boot=" + closedAtBoot);
  });
  check("U10", "url dialog: opens from the doc menu, Esc closes, busy locks", () => {
    W.openMarkdown("# U10\n\nbody");
    doc.getElementById("btn-docs").click();
    const viaMenu = doc.getElementById("doc-menu").hidden === false;
    doc.getElementById("mi-open-url").click();
    const opened = W.openUrlDialog.state().open &&
      doc.getElementById("openurl-backdrop").hidden === false;
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    const closed = doc.getElementById("openurl-backdrop").hidden === true &&
      !W.openUrlDialog.state().open;
    return viaMenu && opened && closed
      ? ok() : bad("menu=" + viaMenu + " open=" + opened + " close=" + closed);
  });
  check("U11", "toc drawer and findbar are mutually exclusive", () => {
    W.openMarkdown("# U11\n\n" + "para\n\n".repeat(8) + "## Tail\n");
    doc.getElementById("btn-toc").click();
    const tocFirst = doc.getElementById("toc-sidebar").classList.contains("open");
    W.find.open();
    const findOpen = doc.getElementById("findbar").getAttribute("data-open") === "on";
    const tocAfterFind = doc.getElementById("toc-sidebar").classList.contains("open");
    doc.getElementById("btn-toc").click();
    const tocAgain = doc.getElementById("toc-sidebar").classList.contains("open");
    const findAfterToc = doc.getElementById("findbar").getAttribute("data-open") === "on";
    W.find.close();
    doc.getElementById("btn-toc").click(); /* leave closed */
    return tocFirst && findOpen && !tocAfterFind && tocAgain && !findAfterToc
      ? ok() : bad("toc1=" + tocFirst + " find=" + findOpen +
                   " toc2=" + tocAfterFind + " toc3=" + tocAgain +
                   " find3=" + findAfterToc);
  });
  check("U12", "btn-top sits below the toc drawer in z-order", () => {
    const tok = html.match(/--z-btn-top:\s*(\d+)/);
    const drawer = html.match(/--z-drawer:\s*(\d+)/);
    const used = /\.btn-top\s*{[^}]*z-index:\s*var\(--z-btn-top\)/.test(html);
    const lower = tok && drawer && Number(tok[1]) < Number(drawer[1]);
    return tok && drawer && used && lower
      ? ok("btn-top=" + tok[1] + " < drawer=" + drawer[1])
      : bad("tok=" + (tok && tok[1]) + " drawer=" + (drawer && drawer[1]) +
            " used=" + used);
  });
  check("U13", "mdx import allowed; welcome-paste feature fully removed", () => {
    const accept = /id="file-input"\s+accept="\.md,\.markdown,\.mdown,\.mdx,\.txt,text\/markdown,text\/plain"/.test(html);
    const handle = html.indexOf("(md|markdown|mdown|mdx|txt)$/i") !== -1;
    const noPasteDoc = !html.includes("Copy some Markdown and paste it");
    const noPasteListener = !/document\.addEventListener\("paste"/.test(html);
    const noEmptyPasteCopy = !html.includes("paste Markdown to begin");
    return accept && handle && noPasteDoc && noPasteListener && noEmptyPasteCopy
      ? ok() : bad("accept=" + accept + " handle=" + handle +
                   " doc=" + noPasteDoc + " listener=" + noPasteListener +
                   " empty=" + noEmptyPasteCopy);
  });
  check("U14", "download label/name: extension-aware defaults", () => {
    W.openMarkdown("# Welcome To The Markdown Webbook\n\nbody");
    const label = W.downloadLabel();
    const name = W.downloadName();
    const itemText = doc.getElementById("mi-download").textContent;
    const labelOk = label === "Download .md" &&
      itemText.indexOf("Download .md") !== -1 &&
      itemText.indexOf("Download .mdx") === -1;
    const nameOk = /^welcome-to-the-markdown-webbook\.md$/.test(name);
    return labelOk && nameOk
      ? ok("name=" + name)
      : bad("label=" + label + " name=" + name + " item=" + itemText.trim());
  });
  checkA("U01", "url import success: silent render, provenance kept", async (Wl) => {
    Wl.openMarkdown("# Seed\n\ntext");
    const toastBefore = toastText();
    window.fetch = () => Promise.resolve(UrlStubs.md("# From URL\n\nhello url body"));
    Wl.openUrlDialog.submit("https://example.com/docs/notes.md");
    await drain();
    const st = Wl.openUrlDialog.state();
    const rendered = doc.getElementById("content").textContent.indexOf("From URL") !== -1;
    const silent = toastText() === toastBefore;
    const rec = curRec();
    const prov = rec.fileName === "notes.md" && rec.fileExt === "md";
    const label = Wl.downloadLabel() === "Download .md";
    return !st.open && !st.busy && rendered && silent && prov && label
      ? ok("file=" + rec.fileName)
      : bad("open=" + st.open + " busy=" + st.busy + " rendered=" + rendered +
            " silent=" + silent + " prov=" + prov + " label=" + label);
  });
  checkA("U02", "mdx via url: label flips to Download .mdx, name preserved", async (Wl) => {
    Wl.openMarkdown("# Seed\n\ntext");
    window.fetch = () => Promise.resolve(UrlStubs.md("# MDX Guide\n\nbody"));
    Wl.openUrlDialog.submit("https://example.com/guide.mdx");
    await drain();
    const st = Wl.openUrlDialog.state();
    const rec = curRec();
    const itemText = doc.getElementById("mi-download").textContent;
    const label = Wl.downloadLabel() === "Download .mdx" &&
      itemText.indexOf("Download .mdx") !== -1;
    const name = Wl.downloadName() === "guide.mdx";
    const rendered = doc.getElementById("content").textContent.indexOf("MDX Guide") !== -1;
    return !st.open && rec.fileExt === "mdx" && rec.fileName === "guide.mdx" &&
      label && name && rendered
      ? ok("label=Download .mdx name=" + Wl.downloadName())
      : bad("open=" + st.open + " ext=" + rec.fileExt + " label=" + label +
            " name=" + name + " rendered=" + rendered);
  });
  checkA("U03", "url import 404: toast, form re-enabled, dialog stays", async (Wl) => {
    Wl.openMarkdown("# Seed\n\ntext");
    window.fetch = () => Promise.resolve(UrlStubs.err(404, "Not Found"));
    Wl.openUrlDialog.submit("https://example.com/missing.md");
    await drain();
    const st = Wl.openUrlDialog.state();
    const btn = doc.getElementById("openurl-open");
    const toastOk = toastText().indexOf("404") !== -1 &&
      doc.getElementById("toast").classList.contains("is-error");
    return st.open && !st.busy && !btn.disabled && toastOk
      ? ok("toast=" + toastText())
      : bad("open=" + st.open + " busy=" + st.busy +
            " disabled=" + btn.disabled + " toast=" + toastText());
  });
  checkA("U04", "url import network failure: reachable-error toast", async (Wl) => {
    Wl.openMarkdown("# Seed\n\ntext");
    window.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    Wl.openUrlDialog.submit("https://example.com/down.md");
    await drain();
    const st = Wl.openUrlDialog.state();
    const toastOk = toastText().indexOf("Couldn't reach that url") !== -1;
    return st.open && !st.busy && toastOk
      ? ok() : bad("open=" + st.open + " busy=" + st.busy +
                   " toast=" + toastText());
  });
  checkA("U05", "url import: unsupported extension rejected before fetch", async (Wl) => {
    Wl.openMarkdown("# Seed\n\ntext");
    let called = false;
    window.fetch = () => { called = true; return Promise.resolve(UrlStubs.md("x")); };
    Wl.openUrlDialog.submit("https://example.com/picture.zip");
    await drain();
    const toastOk = toastText().indexOf("Unsupported file type (.zip)") !== -1;
    const st = Wl.openUrlDialog.state();
    return !called && !st.busy && st.open && toastOk
      ? ok() : bad("fetched=" + called + " busy=" + st.busy +
                   " open=" + st.open + " toast=" + toastText());
  });
  check("U06", "url import: non-http(s) and junk input rejected", () => {
    W.openMarkdown("# Seed\n\ntext");
    window.fetch = () => Promise.resolve(UrlStubs.md("x"));
    W.openUrlDialog.submit("ftp://example.com/x.md");
    const t1 = toastText();
    W.openUrlDialog.submit("not a url at all");
    const t2 = toastText();
    const st = W.openUrlDialog.state();
    return t1 === "Enter a valid http(s) url" &&
      t2 === "Enter a valid http(s) url" && st.open && !st.busy
      ? ok() : bad("t1=" + t1 + " t2=" + t2 + " open=" + st.open);
  });
  checkA("U07", "url import: Open button enters loading state mid-flight", async (Wl) => {
    Wl.openMarkdown("# Seed\n\ntext");
    let resolveFetch;
    window.fetch = () => new Promise((res) => { resolveFetch = res; });
    Wl.openUrlDialog.submit("https://example.com/slow.md");
    const btn = doc.getElementById("openurl-open");
    const midBusy = Wl.openUrlDialog.state().busy && btn.disabled &&
      btn.classList.contains("is-loading") &&
      btn.getAttribute("aria-busy") === "true";
    resolveFetch(UrlStubs.md("# Loaded later\n\nlate body"));
    await drain();
    const st = Wl.openUrlDialog.state();
    const rendered = doc.getElementById("content").textContent.indexOf("late body") !== -1;
    return midBusy && !st.busy && !st.open && !btn.disabled && rendered
      ? ok() : bad("midBusy=" + midBusy + " busy=" + st.busy +
                   " open=" + st.open + " rendered=" + rendered);
  });
  checkA("U08", "url import: HTML pages and binary payloads are refused", async (Wl) => {
    Wl.openMarkdown("# Seed\n\ntext");
    window.fetch = () =>
      Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        headers: { get: (k) => (/content-type/i.test(k) ? "text/html; charset=utf-8" : null) },
        text: () => Promise.resolve("<!DOCTYPE html>\n<html><body>hi</body></html>"),
      });
    Wl.openUrlDialog.submit("https://example.com/page.md");
    await drain();
    const htmlGuard = toastText().indexOf("HTML page, not a Markdown file") !== -1;
    const st1 = Wl.openUrlDialog.state();
    window.fetch = () =>
      Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        headers: { get: () => "application/octet-stream" },
        text: () => Promise.resolve("PK\u0000\u0000binary\u0000stuff"),
      });
    Wl.openUrlDialog.submit("https://example.com/blob.md");
    await drain();
    const binGuard = toastText().indexOf("binary file, not Markdown") !== -1;
    return htmlGuard && binGuard && st1.open && !st1.busy &&
      !Wl.openUrlDialog.state().busy
      ? ok() : bad("html=" + htmlGuard + " bin=" + binGuard +
                   " toast=" + toastText());
  });
  /* ------- v1.8.1: paste from clipboard + remote media pipeline ------- */
  check("M01", "menu: paste + embed placements, meta below print, toggle off", () => {
    const menu = doc.getElementById("doc-menu");
    const openUrl = doc.getElementById("mi-open-url");
    const paste = doc.getElementById("mi-paste");
    const print = doc.getElementById("mi-print");
    const meta = doc.getElementById("mi-meta");
    const embed = doc.getElementById("mi-embed");
    const pub = doc.getElementById("mi-pubmenu");
    /* Paste sits directly under Open from url… with the first separator
       right beneath it (spec: below Open from url…, above the menu-sep). */
    const pasteOk = openUrl.nextElementSibling === paste &&
      /Paste from clipboard/.test(paste.textContent) &&
      paste.nextElementSibling && paste.nextElementSibling.tagName === "HR";
    /* Edit HTML metadata moved under Print / save as PDF with its own
       separator between them. */
    const metaOk = print.nextElementSibling &&
      print.nextElementSibling.tagName === "HR" &&
      print.nextElementSibling.nextElementSibling === meta;
    /* The embed toggle is the next group: separator → embed → pubmenu,
       a checkbox switch, default off, sharing the pub-switch visuals. */
    const sep = meta.nextElementSibling;
    const embedOk = sep && sep.tagName === "HR" && sep.nextElementSibling === embed &&
      embed.nextElementSibling === pub &&
      embed.getAttribute("aria-checked") === "false" &&
      /Embed remote media/.test(embed.textContent) &&
      !!embed.querySelector(".pub-switch .pub-knob") &&
      !!embed.querySelector(".mi-label");
    const css = /#mi-embed \.mi-label,\s*#mi-pubmenu \.mi-label\s*{/.test(html);
    return pasteOk && metaOk && embedOk && css
      ? ok() : bad("paste=" + pasteOk + " meta=" + metaOk +
                   " embed=" + embedOk + " css=" + css);
  });
  check("M02", "embed toggle: flips, persists, toasts, syncs the switch", () => {
    W.openMarkdown("# M02\n\ntext");
    const item = doc.getElementById("mi-embed");
    item.click();
    const on = item.getAttribute("aria-checked") === "true" &&
      W.media.enabled() === true &&
      window.localStorage.getItem("mdwb:embedMedia") === "true";
    const t1 = toastText();
    item.click();
    const off = item.getAttribute("aria-checked") === "false" &&
      W.media.enabled() === false &&
      window.localStorage.getItem("mdwb:embedMedia") === "false";
    return on && off && /remote media/i.test(t1)
      ? ok(t1) : bad("on=" + on + " off=" + off + " toast=" + t1);
  });
  check("M03", "strip pass: media gone, text/links/code untouched", () => {
    W.media.setEnabled(false);
    const src = [
      "# Doc", "",
      "Hello ![one](https://x/1.png) world", "",
      "[![badge](https://x/b.svg)](https://repo/proj)", "",
      "![r][pic]", "",
      "[pic]: https://x/pic.png \"P\"", "",
      "![solo]", "",
      "[solo]: https://x/solo.png", "",
      "A ![ghost] stays.", "",
      "<video controls><source src=\"https://x/v.mp4\"><track src=\"https://x/t.vtt\">fallback text</video>", "",
      "<audio src=\"https://x/a.mp3\"></audio>", "",
      "<img src=\"https://x/i.jpg\" alt=\"pic\">", "",
      "Keep [a link](https://ok/page) and a [ref link][lnk].", "",
      "[lnk]: https://ok/lnk-target", "",
      "```", "![keep](https://x/kept.png)", "```", "",
      "Tail after code.",
    ].join("\n");
    const out = W.media.strip(src);
    const gone = ["1.png", "b.svg", "repo/proj", "pic.png", "solo.png",
      "v.mp4", "t.vtt", "a.mp3", "i.jpg", "fallback text", "<video",
      "<audio", "<img", "[pic]:", "[solo]:"]
      .every((frag) => out.indexOf(frag) === -1);
    const kept = ["Hello", "world", "![ghost] stays", "a link",
      "https://ok/page", "ref link", "https://ok/lnk-target", "[lnk]:",
      "![keep](https://x/kept.png)", "Tail after code", "# Doc"]
      .every((frag) => out.indexOf(frag) !== -1);
    return gone && kept
      ? ok() : bad("gone=" + gone + " kept=" + kept + " out=" + out.slice(0, 400));
  });
  check("M09", "sanitiser: data:image survives, other data: schemes stay blocked", () => {
    const o = R(
      '![px](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg) and [x](data:text/html,evil)',
    );
    const d = parse(o);
    const img = d.querySelector("img");
    const a = d.querySelector("a");
    const imgOk = img &&
      (img.getAttribute("src") || "").indexOf("data:image/png;base64,") === 0;
    const linkSafe = a && !a.getAttribute("href");
    return imgOk && linkSafe
      ? ok() : bad("img=" + imgOk + " href=" + (a ? a.getAttribute("href") : "none"));
  });
  checkA("M04", "embed pass: rendered images become data uris; failures keep urls", async (Wl) => {
    /* 1.8.5: the automatic path — openMarkdown renders, the pass walks
       the compiled DOM, captures each remote img through the (faked)
       canvas and rewrites DOM, source and storage; the url the fake
       env rejects keeps its remote form everywhere. */
    Wl.media.setEnabled(true);
    const restore = Wl.media.env(fakeEnv(/^https:\/\/img\/fail\.png$/));
    try {
      const src = [
        "# M", "",
        "![a](https://img/one.png)", "",
        "![b][p2]", "",
        "[p2]: https://img/two.png \"T\"", "",
        "<img src=\"https://img/three.png\" alt=\"c\">", "",
        "![bad](https://img/fail.png)", "",
      ].join("\n");
      Wl.openMarkdown(src);
      await drain(30);
      const content = doc.getElementById("content");
      const srcs = Array.from(content.querySelectorAll("img"))
        .map((i) => i.getAttribute("src"));
      const captured = srcs.filter((s) =>
        s.indexOf("data:image/png;base64,FAKE=") === 0).length;
      const kept = srcs.some((s) => s === "https://img/fail.png");
      const rec = JSON.parse(
        window.localStorage.getItem("mdwb:current") || "null");
      const sourceOk = !!rec && rec.source
        .indexOf("![a](data:image/png;base64,FAKE=") !== -1 &&
        rec.source.indexOf("[p2]: data:image/png;base64,FAKE=") !== -1 &&
        rec.source.indexOf("\"T\"") !== -1 &&
        rec.source.indexOf("src=\"data:image/png;base64,FAKE=") !== -1 &&
        rec.source.indexOf("![bad](https://img/fail.png)") !== -1;
      return captured === 3 && kept && sourceOk
        ? ok("3 captured, 1 kept; source + storage rewritten")
        : bad("captured=" + captured + " kept=" + kept +
              " srcs=" + JSON.stringify(srcs));
    } finally {
      Wl.media.setEnabled(false);
      restore();
    }
  });
  checkA("M05", "clipboard paste: text renders, media pass runs, success toast", async (Wl) => {
    Wl.openMarkdown("# Seed\n\nbefore paste");
    window.navigator.clipboard = {
      read: () => Promise.resolve([
        {
          types: ["text/plain"],
          getType: () => Promise.resolve(new window.Blob(
            ["# Pasted Doc\n\nHello ![x](https://img/gone.png)"],
            { type: "text/plain" })),
        },
      ]),
    };
    Wl.clipboard.paste();
    await drain();
    const txt = doc.getElementById("content").textContent;
    const rendered = txt.indexOf("Pasted Doc") !== -1;
    const stripped = txt.indexOf("gone.png") === -1 &&
      !doc.querySelector("#content img");
    const toasted = toastText().indexOf("Pasted Doc") !== -1;
    return rendered && stripped && toasted
      ? ok(toastText())
      : bad("render=" + rendered + " strip=" + stripped + " toast=" + toastText());
  });
  checkA("M06", "clipboard guards: non-text, empty and denied all toast errors", async (Wl) => {
    Wl.openMarkdown("# Seed\n\nstable");
    const before = doc.getElementById("content").textContent;
    window.navigator.clipboard = {
      read: () => Promise.resolve([{ types: ["image/png"] }]),
    };
    Wl.clipboard.paste();
    await drain();
    const nonText = toastText();
    window.navigator.clipboard = {
      read: () => Promise.resolve([{
        types: ["text/plain"],
        getType: () => Promise.resolve(new window.Blob(["   "], { type: "text/plain" })),
      }]),
    };
    Wl.clipboard.paste();
    await drain();
    const empty = toastText();
    const deniedErr = new Error("denied");
    deniedErr.name = "NotAllowedError";
    window.navigator.clipboard = { read: () => Promise.reject(deniedErr) };
    Wl.clipboard.paste();
    await drain();
    const denied = toastText();
    const untouched = doc.getElementById("content").textContent === before;
    const all = /any text/.test(nonText) && /empty/i.test(empty) &&
      /denied/i.test(denied) && untouched;
    return all
      ? ok(nonText + " | " + empty + " | " + denied)
      : bad("nontext=" + nonText + " empty=" + empty + " denied=" + denied +
            " untouched=" + untouched);
  });
  checkA("M08", "url import runs the media pass: stripped by default", async (Wl) => {
    Wl.openMarkdown("# Seed\n\nx");
    window.fetch = () => Promise.resolve(
      UrlStubs.md("# Remote\n\n![pic](https://img/stripped.png)\n"),
    );
    Wl.openUrlDialog.submit("https://example.com/media.md");
    await drain();
    const st = Wl.openUrlDialog.state();
    const txt = doc.getElementById("content").textContent;
    const noImg = !doc.querySelector("#content img");
    return !st.open && !st.busy && txt.indexOf("Remote") !== -1 && noImg
      ? ok() : bad("open=" + st.open + " busy=" + st.busy +
                   " img=" + !noImg + " txt=" + txt.slice(0, 60));
  });
  check("M07", "publication: new authoring items excluded, seps prune cleanly", () => {
    W.openMarkdown("# M07\n\nbody");
    const out = W.publication.build();
    const d = parse(out);
    const gone = ["mi-open", "mi-open-url", "mi-paste", "mi-meta",
      "mi-publish", "mi-embed", "mi-pubmenu"]
      .every((id) => !d.getElementById(id));
    const menu = d.getElementById("doc-menu");
    const kids = Array.prototype.map.call(menu.children, (el) => el);
    const noDangling = kids[0].tagName !== "HR" &&
      kids[kids.length - 1].tagName !== "HR";
    let adjacent = false;
    for (let i = 1; i < kids.length; i++)
      if (kids[i].tagName === "HR" && kids[i - 1].tagName === "HR") adjacent = true;
    const kept = ["mi-copy-md", "mi-copy-text", "mi-download", "mi-export",
      "mi-print"].every((id) => !!d.getElementById(id));
    return gone && noDangling && !adjacent && kept
      ? ok("items=" + kids.length)
      : bad("gone=" + gone + " dang=" + noDangling + " adj=" + adjacent +
            " kept=" + kept);
  });

  /* ---------------- v1.8.5: native capture embed (no fetch) ----------------
     jsdom decodes no images and implements no canvas, so every embed
     check swaps the pass's environment adapters for deterministic
     fakes: a loader that resolves "decoded" probes (or rejects for
     urls matching the fail pattern) and a canvas whose toPng answers
     a fixed data uri. The pipeline under test — DOM detection, probe
     guards, pool, DOM swap, masked source rewrite, persistence — is
     the production code. */

  const fakeEnv = (fail) => ({
    loadImage: (u) => (fail && fail.test(u))
      ? Promise.reject(new Error("image load blocked"))
      : Promise.resolve({ naturalWidth: 8, naturalHeight: 8 }),
    makeCanvas: () => ({
      drawImage() {},
      toPng: () => "data:image/png;base64,FAKE=",
    }),
  });

  check("N01", "DOM detection: every rendered remote image is collected", () => {
    const src = [
      "# K", "",
      "![plain](https://x/a.png)",
      "![angle](<https://x/b.png>)",
      "![paren](https://x/c(1).png)",
      "![titled](https://x/e.png \"T\")",
      "![mline](https://x/k.png",
      "\"t\")",
      "![ref][r1]", "",
      "[r1]: https://x/d.svg", "",
      "> ![quoted](https://x/f.png)", "",
      "- ![listed](https://x/g.png)", "",
      "| ![tabled](https://x/h.png) |", "",
      "| --- |", "",
      "<img src=\"https://x/i.png\" alt=\"raw\">", "",
      "![dup](https://x/a.png)", "",
      "`![code](https://x/skip1.png)`", "",
      B, "![fenced](https://x/skip2.png)", B, "",
      "    ![indented](https://x/skip3.png)", "",
      "![data](data:image/png;base64,iVBOR)", "",
      "![rel](/local.png)", "",
      "[link only](https://x/j.png)", "",
    ].join("\n");
    W.openMarkdown(src);
    const urls = W.media.collect(doc.getElementById("content"));
    const want = ["https://x/a.png", "https://x/b.png", "https://x/c(1).png",
      "https://x/d.svg", "https://x/e.png", "https://x/f.png",
      "https://x/g.png", "https://x/h.png", "https://x/i.png",
      "https://x/k.png"];
    const missing = want.filter((u) => urls.indexOf(u) === -1);
    const noJunk = urls.every((u) =>
      u !== "https://x/skip1.png" && u !== "https://x/skip2.png" &&
      u !== "https://x/skip3.png" && u !== "https://x/j.png" &&
      u !== "/local.png" && u.indexOf("data:") !== 0);
    const deduped = urls.filter((u) => u === "https://x/a.png").length === 1;
    return !missing.length && noJunk && deduped
      ? ok("collected " + urls.length +
           " urls incl. paren/multi-line/reference/img-src nesting; code, data, relative and link-only excluded; duplicates once")
      : bad("missing=" + JSON.stringify(missing) +
            " urls=" + JSON.stringify(urls));
  });

  checkA("N02", "capture: DOM swap, badge links, code masking, summary", async (Wl) => {
    Wl.media.setEnabled(true);
    const restore = Wl.media.env(fakeEnv(/^https:\/\/img\/fail\.png$/));
    try {
      const src = [
        "# S", "",
        "![a](https://img/one.png)", "",
        "[![badge](https://img/badge.png)](https://img/badge.png)", "",
        "![bad](https://img/fail.png)", "",
        B, "documented: ![doc](https://img/one.png)", B, "",
        "![d](data:image/png;base64,iVBOR)", "",
      ].join("\n");
      Wl.openMarkdown(src);
      await drain(30);
      const content = doc.getElementById("content");
      const srcs = Array.from(content.querySelectorAll("img"))
        .map((i) => i.getAttribute("src"));
      const badgeLink = content.querySelector("a[href^=\"data:image/png\"]");
      const failKept = srcs.some((s) => s === "https://img/fail.png");
      const dataUntouched = srcs.some((s) =>
        s === "data:image/png;base64,iVBOR");
      const rec = JSON.parse(
        window.localStorage.getItem("mdwb:current") || "null");
      const fenceAlive = !!rec && rec.source
        .indexOf("![doc](https://img/one.png)") !== -1;
      /* Direct path on a fresh host: the summary numbers, and the badge
         markdown rewritten in source (image + link target). */
      const host = doc.createElement("div");
      host.innerHTML = Wl.render(src);
      const sum = await Wl.media.embed(host, { source: src });
      const sumSource = sum.source || "";
      const domOk = srcs.filter((s) =>
        s.indexOf("data:image/png;base64,FAKE=") === 0).length === 2 &&
        !!badgeLink && failKept && dataUntouched;
      const sumOk = sum.total === 3 && sum.captured === 2 && sum.kept === 1 &&
        sumSource.indexOf("[![badge](data:image/png;base64,FAKE=") !== -1 &&
        sumSource.indexOf(")](data:image/png;base64,FAKE=") !== -1 &&
        sumSource.indexOf("![bad](https://img/fail.png)") !== -1 &&
        fenceAlive;
      return domOk && sumOk
        ? ok("2 captured + badge link swapped; fail kept; fence untouched")
        : bad("dom=" + JSON.stringify({ srcs, badge: !!badgeLink }) +
              " sum=" + JSON.stringify(sum).slice(0, 200));
    } finally {
      Wl.media.setEnabled(false);
      restore();
    }
  });

  checkA("N03", "graceful degradation: failing captures never break the flow", async (Wl) => {
    Wl.media.setEnabled(true);
    const restore = Wl.media.env(fakeEnv(/./)); /* everything fails */
    try {
      const src = "# G\n\n![x](https://img/x.png) and <img src=\"https://img/y.png\">";
      Wl.openMarkdown(src);
      await drain(30);
      const content = doc.getElementById("content");
      const rendered = content.textContent.indexOf("G") !== -1;
      const srcs = Array.from(content.querySelectorAll("img"))
        .map((i) => i.getAttribute("src"));
      const allRemote = srcs.every((s) => /^https?:\/\//.test(s));
      const rec = JSON.parse(
        window.localStorage.getItem("mdwb:current") || "null");
      const sourceIntact = !!rec && rec.source === src;
      const host = doc.createElement("div");
      host.innerHTML = Wl.render(src);
      const sum = await Wl.media.embed(host, { source: src });
      return rendered && allRemote && sourceIntact &&
        sum.total === 2 && sum.captured === 0 && sum.kept === 2
        ? ok("urls kept, source byte-intact, render flow unaffected")
        : bad("rendered=" + rendered + " allRemote=" + allRemote +
              " intact=" + sourceIntact + " sum=" + JSON.stringify(sum));
    } finally {
      Wl.media.setEnabled(false);
      restore();
    }
  });

  /* ---------------- v1.8.5: capture guards (idempotence, caps) ------------- */

  checkA("N11", "idempotence: a captured document re-imports as a no-op", async (Wl) => {
    Wl.media.setEnabled(true);
    const restore = Wl.media.env(fakeEnv(null));
    try {
      const src = "# I\n\n![p](https://img/idem.png)";
      Wl.openMarkdown(src);
      await drain(30);
      const rec1 = JSON.parse(
        window.localStorage.getItem("mdwb:current") || "null");
      const embedded1 = !!rec1 &&
        rec1.source.indexOf("![p](data:image/png;base64,FAKE=") !== -1;
      /* Re-import the embedded form: nothing remote remains, so the pass
         must not touch anything and the id must stay stable. */
      Wl.openMarkdown(rec1.source);
      await drain(30);
      const remote = W.media.collect(doc.getElementById("content"));
      const rec2 = JSON.parse(
        window.localStorage.getItem("mdwb:current") || "null");
      return embedded1 && remote.length === 0 &&
        rec2 && rec2.source === rec1.source && rec2.id === rec1.id
        ? ok("second import changed nothing (source + id byte-stable)")
        : bad("embedded=" + embedded1 + " remote=" + JSON.stringify(remote) +
              " stable=" + (!!rec2 && rec2.source === rec1.source));
    } finally {
      Wl.media.setEnabled(false);
      restore();
    }
  });

  checkA("N12", "caps: oversized pixels, dimensionless and oversized encodes keep their url", async (Wl) => {
    Wl.media.setEnabled(true);
    const restore = Wl.media.env({
      loadImage: (u) => /zero/.test(u)
        ? Promise.resolve({ naturalWidth: 0, naturalHeight: 0 })
        : /big/.test(u)
          ? Promise.resolve({ naturalWidth: 9, naturalHeight: 9 })
          : /huge/.test(u)
            ? Promise.resolve({ naturalWidth: 5000, naturalHeight: 5000 })
            : Promise.resolve({ naturalWidth: 8, naturalHeight: 8 }),
      /* Only the 9x9 "big" probe encodes over the budget; the 8x8 one
         encodes normally, proving the encode cap is per-image. */
      makeCanvas: (w) => ({
        drawImage() {},
        toPng: () => w === 9
          ? "data:image/png;base64," + "A".repeat(26 * 1024 * 1024)
          : "data:image/png;base64,FAKE=",
      }),
    });
    const md = [
      "![h](https://img/huge.png)",
      "![z](https://img/zero.png)",
      "![b](https://img/big.png)",
      "![k](https://img/ok.png)",
    ].join("\n");
    const host = doc.createElement("div");
    host.innerHTML = Wl.render(md);
    const sum = await Wl.media.embed(host, { source: md });
    Wl.media.setEnabled(false);
    restore();
    const okOnly = sum.captured === 1 && sum.kept === 3 &&
      sum.source.indexOf("![k](data:image/png;base64,") !== -1 &&
      sum.source.indexOf("![h](https://img/huge.png)") !== -1 &&
      sum.source.indexOf("![z](https://img/zero.png)") !== -1 &&
      sum.source.indexOf("![b](https://img/big.png)") !== -1;
    return okOnly
      ? ok("25MP pixel cap, 0px probe and 26MB encode all kept; ok.png captured")
      : bad("sum=" + JSON.stringify({ c: sum.captured, k: sum.kept }) +
            " src=" + (sum.source || "").slice(0, 160));
  });

  checkA("N13", "timeout: a probe that never settles is abandoned", async (Wl) => {
    Wl.media.setEnabled(true);
    const restoreEnv = Wl.media.env({
      loadImage: () => new Promise(() => {}), /* never settles */
      makeCanvas: () => ({
        drawImage() {},
        toPng: () => "data:image/png;base64,FAKE=",
      }),
    });
    const restoreT = Wl.media.timeout(10);
    const md = "![t](https://img/slow.png)";
    const host = doc.createElement("div");
    host.innerHTML = Wl.render(md);
    const sum = await Wl.media.embed(host, { source: md });
    restoreT();
    restoreEnv();
    Wl.media.setEnabled(false);
    return sum.total === 1 && sum.captured === 0 && sum.kept === 1 &&
      sum.source === md
      ? ok("never-settling probe abandoned within the window; url kept")
      : bad("sum=" + JSON.stringify(sum).slice(0, 160));
  });

  /* ---------------- v1.8.5: rewrite precision + repro cases ---------------- */

  checkA("N14", "prefix-sharing urls each rewrite exactly", async (Wl) => {
    Wl.media.setEnabled(true);
    const restore = Wl.media.env(fakeEnv(null));
    const md = "![a](https://x/p.png) then ![b](https://x/p.png?raw=1)";
    const host = doc.createElement("div");
    host.innerHTML = Wl.render(md);
    const sum = await Wl.media.embed(host, { source: md });
    const domSrcs = Array.from(host.querySelectorAll("img"))
      .map((i) => i.getAttribute("src"));
    Wl.media.setEnabled(false);
    restore();
    const aOk = sum.source.indexOf("![a](data:image/png;base64,FAKE=") === 0;
    const bOk = sum.source.indexOf("![b](data:image/png;base64,FAKE=") !== -1;
    const noMangle = sum.source.indexOf("?raw=1") === -1 &&
      sum.source.indexOf("https://x/p.png") === -1;
    const domOk = domSrcs.every((s) =>
      s.indexOf("data:image/png;base64,FAKE=") === 0);
    return aOk && bOk && noMangle && domOk && sum.captured === 2
      ? ok("shared-prefix urls both captured, nothing mangled")
      : bad("a=" + aOk + " b=" + bOk + " clean=" + noMangle +
            " dom=" + JSON.stringify(domSrcs) + " sum=" + JSON.stringify(sum).slice(0, 120));
  });

  checkA("N15", "repro: wikimedia .PNG and usefresh .svg both embed natively", async (Wl) => {
    Wl.media.setEnabled(true);
    const restore = Wl.media.env(fakeEnv(null));
    try {
      const md = [
        "`image 1` embeds successfully",
        "![image 1](https://upload.wikimedia.org/wikipedia/commons/e/ef/X%5E4_-_4%5Ex.PNG)",
        "",
        "`image 2` does not embed; the link is untouched",
        "![image 2](https://usefresh.dev/docs/architecture-flow-v2.svg)",
      ].join("\n");
      Wl.openMarkdown(md);
      await drain(30);
      const content = doc.getElementById("content");
      const srcs = Array.from(content.querySelectorAll("img"))
        .map((i) => i.getAttribute("src"));
      const rec = JSON.parse(
        window.localStorage.getItem("mdwb:current") || "null");
      const bothData = srcs.length === 2 && srcs.every((s) =>
        s.indexOf("data:image/png;base64,FAKE=") === 0);
      const clean = !!rec && rec.source.indexOf("upload.wikimedia.org") === -1 &&
        rec.source.indexOf("usefresh.dev") === -1;
      const textAlive = !!rec &&
        rec.source.indexOf("`image 1` embeds successfully") !== -1 &&
        rec.source.indexOf("`image 2` does not embed") !== -1;
      return bothData && clean && textAlive
        ? ok("both repro images embedded via the browser's own load; no remote urls left")
        : bad("srcs=" + JSON.stringify(srcs) + " clean=" + clean +
              " text=" + textAlive);
    } finally {
      Wl.media.setEnabled(false);
      restore();
    }
  });

  checkA("N16", "no fetch: the capture pass performs zero programmatic requests", async (Wl) => {
    const prevFetch = window.fetch;
    let calls = 0;
    window.fetch = function () {
      calls += 1;
      return prevFetch.apply(window, arguments);
    };
    Wl.media.setEnabled(true);
    const restore = Wl.media.env(fakeEnv(null));
    try {
      Wl.openMarkdown("# F\n\n![p](https://img/nf.png) and <img src=\"https://img/nf2.png\">");
      await drain(30);
      const srcs = Array.from(doc.getElementById("content").querySelectorAll("img"))
        .map((i) => i.getAttribute("src"));
      const embedded = srcs.length === 2 && srcs.every((s) =>
        s.indexOf("data:image/png;base64,FAKE=") === 0);
      return calls === 0 && embedded
        ? ok("2 images embedded with window.fetch untouched (0 calls)")
        : bad("fetchCalls=" + calls + " srcs=" + JSON.stringify(srcs));
    } finally {
      window.fetch = prevFetch;
      Wl.media.setEnabled(false);
      restore();
    }
  });

  checkA("N04", "keyboard shortcut pastes the clipboard with success toast", async (Wl) => {
    Wl.openMarkdown("# Seed\n\nbefore shortcut");
    window.navigator.clipboard = {
      read: () => Promise.resolve([{
        types: ["text/plain"],
        getType: () => Promise.resolve(new window.Blob(
          ["# Via Shortcut\n\nbody"], { type: "text/plain" })),
      }]),
    };
    doc.body.focus();
    doc.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "V", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    await drain();
    const rendered = doc.getElementById("content").textContent
      .indexOf("Via Shortcut") !== -1;
    const toasted = toastText().indexOf("Via Shortcut") !== -1;
    return rendered && toasted
      ? ok(toastText())
      : bad("render=" + rendered + " toast=" + toastText());
  });
  checkA("N05", "shortcut failure paths toast (denied, non-text)", async (Wl) => {
    const denied = new Error("no");
    denied.name = "NotAllowedError";
    window.navigator.clipboard = { read: () => Promise.reject(denied) };
    doc.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "V", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    await drain();
    const deniedToast = toastText();
    window.navigator.clipboard = {
      read: () => Promise.resolve([{ types: ["image/png"] }]),
    };
    doc.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "V", metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    await drain();
    const nonText = toastText();
    const both = /denied/i.test(deniedToast) && /any text/.test(nonText);
    return both
      ? ok(deniedToast + " | " + nonText)
      : bad("denied=" + deniedToast + " nontext=" + nonText);
  });
  check("N06", "shortcut guards: editable focus and MDWB_PUB skip the paste", () => {
    W.openMarkdown("# N06\n\nstable");
    const before = doc.getElementById("content").textContent;
    let calls = 0;
    window.navigator.clipboard = {
      read: () => {
        calls++;
        return Promise.resolve([{
          types: ["text/plain"],
          getType: () => Promise.resolve(new window.Blob(
            ["# HIJACK"], { type: "text/plain" })),
        }]);
      },
    };
    /* Inside an editable control the browser's own paste stays native. */
    const input = doc.getElementById("palette-input");
    input.focus();
    input.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "V", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    /* A publication build never installs the behaviour. */
    window.MDWB_PUB = { v: 1, menu: true };
    doc.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "V", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    doc.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "V", metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    window.MDWB_PUB = undefined;
    input.blur();
    const untouched = doc.getElementById("content").textContent === before;
    return calls === 0 && untouched
      ? ok() : bad("calls=" + calls + " untouched=" + untouched);
  });
  check("N07", "help panel lists the paste shortcut; publications drop it", () => {
    const row = Array.prototype.find.call(
      doc.querySelectorAll("#help-panel .help-row"),
      (r) => r.querySelector("span").textContent.trim() === "Paste from clipboard",
    );
    const keys = row ? row.textContent.replace(/\s+/g, "") : "";
    const keysOk = keys.indexOf("Ctrl") !== -1 &&
      keys.indexOf("Shift") !== -1 && keys.indexOf("V") !== -1;
    const aria = doc.getElementById("mi-paste").getAttribute("aria-keyshortcuts") || "";
    const ariaOk = aria.indexOf("Control+Shift+V") !== -1 &&
      aria.indexOf("Meta+Shift+V") !== -1;
    W.openMarkdown("# N07\n\nbody");
    const pub = parse(W.publication.build());
    const pubRows = Array.prototype.map.call(
      pub.querySelectorAll("#help-panel .help-row span:first-child"),
      (s) => s.textContent.trim(),
    );
    const dropped = pubRows.indexOf("Paste from clipboard") === -1 &&
      pubRows.indexOf("Open a file") === -1 &&
      pubRows.indexOf("Reading settings") !== -1;
    return !!row && keysOk && ariaOk && dropped
      ? ok() : bad("row=" + !!row + " keys=" + keysOk + " aria=" + ariaOk +
                   " dropped=" + dropped);
  });
  check("N08", "meta save: empty title clears to Untitled on every surface", () => {
    W.openMarkdown("# Real Heading\n\nbody");
    const fb = doc.title === "Real Heading" &&
      doc.getElementById("header-title").textContent === "Real Heading" &&
      doc.getElementById("footer-title").textContent === "Real Heading";
    doc.getElementById("mi-meta").click();
    doc.getElementById("mf-title").value = "";
    doc.getElementById("meta-form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    const cleared = doc.title === "Untitled" &&
      doc.getElementById("header-title").textContent === "Untitled" &&
      doc.getElementById("footer-title").textContent === "Untitled";
    const pub = parse(W.publication.build());
    const pubTitle = pub.querySelector("title").textContent === "Untitled";
    doc.getElementById("mi-meta").click();
    const field = doc.getElementById("mf-title");
    const reopen = field.value === "" && field.placeholder === "Untitled";
    doc.getElementById("meta-cancel").click();
    const cur = JSON.parse(window.localStorage.getItem("mdwb:current"));
    const stored = JSON.parse(
      window.localStorage.getItem("mdwb:docpref:" + cur.id),
    ).meta;
    const storedOk = stored && "title" in stored && stored.title === "";
    return fb && cleared && pubTitle && reopen && storedOk
      ? ok() : bad("fb=" + fb + " clr=" + cleared + " pub=" + pubTitle +
                   " re=" + reopen + " st=" + storedOk);
  });
  check("N09", "meta save: captured title drives surfaces, naming, exports", () => {
    W.openMarkdown("# Doc Title\n\nbody text with words");
    doc.getElementById("mi-meta").click();
    doc.getElementById("mf-title").value = "  Custom Book Name  ";
    doc.getElementById("mf-author").value = "A. Author";
    doc.getElementById("meta-form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    const surfaces = doc.title === "Custom Book Name" &&
      doc.getElementById("header-title").textContent === "Custom Book Name" &&
      doc.getElementById("footer-title").textContent === "Custom Book Name";
    const named = W.downloadName() === "custom-book-name.md";
    const pub = parse(W.publication.build());
    const pubOk = pub.querySelector("title").textContent === "Custom Book Name" &&
      pub.querySelector('meta[name="author"]').getAttribute("content") === "A. Author";
    /* The next editor visit shows the captured value in the field. */
    doc.getElementById("mi-meta").click();
    const field = doc.getElementById("mf-title");
    const reopen = field.value === "Custom Book Name" &&
      field.placeholder === "Custom Book Name";
    doc.getElementById("meta-cancel").click();
    return surfaces && named && pubOk && reopen
      ? ok(W.downloadName())
      : bad("s=" + surfaces + " name=" + named + " pub=" + pubOk +
            " re=" + reopen);
  });
  check("N10", "cleared author stays cleared; the absent-entry fallback holds", () => {
    W.openMarkdown(
      "---\ntitle: FM Title\nauthor: FM Author\n---\n\n# FM Title\n\nbody",
    );
    const pub0 = parse(W.publication.build());
    const fallback = pub0.querySelector('meta[name="author"]') &&
      pub0.querySelector('meta[name="author"]').getAttribute("content") === "FM Author" &&
      pub0.querySelector("title").textContent === "FM Title";
    doc.getElementById("mi-meta").click();
    doc.getElementById("mf-author").value = "   ";
    doc.getElementById("meta-form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    const pub1 = parse(W.publication.build());
    /* Exact capture: the untouched empty title cleared too, so the export
       reads "Untitled"; the cleared author writes no meta element. */
    const cleared = pub1.querySelector("title").textContent === "Untitled" &&
      !pub1.querySelector('meta[name="author"]');
    return fallback && cleared
      ? ok() : bad("fb=" + fallback + " clr=" + cleared);
  });

  check("PUB1", "publishable export: 1:1 replica with metadata in head", () => {
    W.openMarkdown("# T\n\nbody text");
    const out = W.publication.build();
    if (!out) return bad("null");
    const d = parse(out);
    /* Full reader replica: content area, settings popover, outline. */
    const replica = ["content", "aa-popover", "toc-sidebar", "help-panel",
      "meta-backdrop", "btn-docs", "doc-menu", "palette-backdrop"]
      .every((id) => !!d.getElementById(id));
    const t = d.querySelector("title");
    const author = d.querySelector('meta[name="author"]');
    const desc = d.querySelector('meta[name="description"]');
    const gen = d.querySelector('meta[name="generator"]');
    const metaOk =
      t && t.textContent === "Pub Title" &&
      author && author.getAttribute("content") === "Jane Doe & Co <jane@x.io>" &&
      desc && desc.getAttribute("content") === "A test description" &&
      gen && gen.getAttribute("content").indexOf("Markdown Webbook") === 0;
    const embedded = /window\.MDWB_EMBED\s*=/.test(out);
    const runtime = out.includes("marked v");
    return replica && metaOk && embedded && runtime
      ? ok("title=" + t.textContent)
      : bad("replica=" + replica + " meta=" + metaOk +
            " embed=" + embedded + " runtime=" + runtime);
  });
  check("PUB2", "publication replica: menu visibility + authoring exclusions", () => {
    W.openMarkdown("# T\n\nbody text");
    W.publication.setIncludeMenu(true);
    const withMenu = W.publication.build();
    W.publication.setIncludeMenu(false);
    const without = W.publication.build();
    W.publication.setIncludeMenu(true);
    const d1 = parse(withMenu);
    const d2 = parse(without);
    /* Conditional visibility: shown when on, hidden when off. */
    const on = d1.getElementById("btn-docs").hidden === false &&
      d1.getElementById("doc-menu").hidden === false;
    const off = d2.getElementById("btn-docs").hidden === true &&
      d2.getElementById("doc-menu").hidden === true;
    /* Always excluded: removed from the doc-menu in both variants. */
    const excludedGone = ["mi-open", "mi-open-url", "mi-paste", "mi-meta",
      "mi-publish", "mi-embed", "mi-pubmenu"]
      .every((id) => !d1.getElementById(id) && !d2.getElementById(id));
    /* Everything else is 1:1: the export group stays intact. */
    const kept = ["mi-copy-md", "mi-copy-text", "mi-download", "mi-export",
      "mi-print"].every((id) => !!d1.getElementById(id));
    /* Shortcut rows removed from the Help panel; the rest stays. */
    const rows = Array.prototype.map.call(
      d1.querySelectorAll("#help-panel .help-row span:first-child"),
      (s) => s.textContent.trim(),
    );
    const helpClean = !rows.some((t) =>
      t === "Open a file" || t === "Import, export & strict HTML" ||
      t === "Paste from clipboard");
    const readingRowKept = rows.indexOf("Reading settings") !== -1;
    /* Boot flag mirrors the toggle. */
    const flagOn = withMenu.includes('window.MDWB_PUB = {"v":1,"menu":true}');
    const flagOff = without.includes('window.MDWB_PUB = {"v":1,"menu":false}');
    const cur = JSON.parse(window.localStorage.getItem("mdwb:current"));
    const persisted =
      JSON.parse(window.localStorage.getItem("mdwb:docpref:" + cur.id))
        .pubMenu === true;
    return on && off && excludedGone && kept && helpClean && readingRowKept &&
      flagOn && flagOff && persisted
      ? ok()
      : bad("on=" + on + " off=" + off + " excl=" + excludedGone +
            " kept=" + kept + " help=" + helpClean + " row=" + readingRowKept +
            " f1=" + flagOn + " f0=" + flagOff + " persist=" + persisted);
  });
  check("PUB3", "publication carries the payload; bespoke reader is gone", () => {
    W.openMarkdown(
      "# Head One\n\n- [x] done\n- [ ] open\n\n" + B + "js\nvar a = 1;\n" + B +
        "\n\n![alt text](pic.png)",
    );
    const out = W.publication.build();
    const d = parse(out);
    /* The v1.5.0 bespoke reader chrome must be fully gone. */
    const noBespoke = !d.querySelector(".pub-bar") &&
      !d.querySelector(".pub-toc") &&
      !d.getElementById("pub-menu-panel") &&
      !d.querySelector(".pub-body");
    /* The document rides as a fully-escaped JSON payload. */
    const m = out.match(/<script>window\.MDWB_EMBED = ([\s\S]*?)<\/script>/);
    const payloadOk = !!m && !m[1].includes("<") &&
      m[1].includes("Head One") && m[1].includes("pic.png");
    /* Replica chrome + runtime intact. */
    const full = ["content", "toc-sidebar", "aa-popover", "btn-top", "lightbox"]
      .every((id) => !!d.getElementById(id));
    const runtime = out.includes("marked v") &&
      out.includes("Apply persisted theme");
    return noBespoke && payloadOk && full && runtime
      ? ok("payload=" + (m && m[1].length) + "B")
      : bad("bespoke=" + !noBespoke + " payload=" + payloadOk +
            " full=" + full + " runtime=" + runtime);
  });
  check("PUB4", "publication containment survives hostile content", () => {
    W.openMarkdown(
      '---\ntitle: H"x&<w>\n---\n\n# X\n\n</script><script>alert(1)</script> text\n\n<img src=x onerror="alert(1)"> & <b onmouseover=x>bad</b>',
    );
    const out = W.publication.build();
    const d = parse(out);
    const scripts = d.querySelectorAll("script");
    const closers = (out.match(/<\/script>/gi) || []).length;
    /* Exactly six scripts: prepaint, payload, flag, marked, purify, app. */
    const six = scripts.length === 6 && closers === 6;
    /* The payload is fully \u003c-escaped: no raw "<" can survive in it. */
    let payloadClean = false;
    Array.prototype.forEach.call(scripts, (s) => {
      if (/^\s*window\.MDWB_EMBED\s*=/.test(s.textContent))
        payloadClean = !s.textContent.includes("<");
    });
    /* Hostile metadata is escaped by the DOM, not string-concatenated. */
    const title = d.querySelector("title");
    const titleOk = title && title.textContent === 'H"x&<w>';
    return six && payloadClean && titleOk
      ? ok("scripts=" + scripts.length)
      : bad("scripts=" + scripts.length + " closers=" + closers +
            " payload=" + payloadClean + " title=" + titleOk);
  });
  check("PR2", "print: full-bleed page, themed canvas, cloned margins", () => {
    const pageZero = /@media print[\s\S]*?@page\s*{[^}]*margin:\s*0[^}]*}/.test(html);
    const oldGone = !/@page\s*{[^}]*margin:\s*18mm/.test(html);
    const bodyClone =
      /@media print[\s\S]*?body\s*{[^}]*padding:\s*18mm 16mm[^}]*box-decoration-break:\s*clone/.test(html);
    const themedCanvas =
      /@media print[\s\S]*?html,\s*\n?\s*body\s*{[^}]*background:\s*var\(--bg-color\)/.test(html);
    /* The publication is the app replica: it inherits this same print
       block verbatim, so paper follows the theme there too. */
    W.openMarkdown("# PR2\n\nprint body");
    const pubPrint = W.publication.build().includes(
      "box-decoration-break: clone",
    );
    return pageZero && oldGone && bodyClone && themedCanvas && pubPrint
      ? ok()
      : bad("pg0=" + pageZero + " oldGone=" + oldGone +
            " clone=" + bodyClone + " canvas=" + themedCanvas +
            " pubPrint=" + pubPrint);
  });
  check("RP1", "rawHtml re-render pins the live scroll position", () => {
    W.openMarkdown("# RP\n\n" + "filler paragraph\n\n".repeat(30) + "## Tail\n");
    /* A stale URL hash must NOT hijack the restore: the pin branch runs
       first (synchronously) and bypasses both the hash and the
       sessionStorage paths. */
    const h1 = doc.querySelector("#content h1");
    window.location.hash = "#" + (h1 && h1.id ? h1.id : "rp");
    /* jsdom cannot scroll: shadow the scrollY getter so the toggle
       captures a real, non-zero live position. */
    Object.defineProperty(window, "scrollY", {
      get: () => 812,
      configurable: true,
    });
    const y = [];
    const orig = window.scrollTo;
    window.scrollTo = function (x, yy) {
      y.push(yy);
    };
    W.scrollPin.set(812);
    const setOk = W.scrollPin.get() === 812;
    /* Drive the REAL rawHtml toggle: pin -> re-render -> consume. */
    const seg = doc.querySelector(
      '#aa-popover .seg[data-setting="rawHtml"]',
    );
    seg.querySelector('button[data-value="strip"]').click();
    const consumed = W.scrollPin.get() === null;
    const restoredSync = y.indexOf(812) !== -1;
    /* Leave the setting as found (the API setter never re-renders). */
    window.scrollTo = orig;
    delete window.scrollY;
    W.settings.set("rawHtml", "allow");
    return setOk && consumed && restoredSync
      ? ok("restored=" + y.join(","))
      : bad("set=" + setOk + " consumed=" + consumed +
            " restored=" + restoredSync + " calls=" + y.join(","));
  });
  check("E1", "standalone export: embed + containment", () => {
    const s = W.buildStandaloneHTML();
    if (!s) return bad("null");
    if (s.indexOf("MDWB_EMBED") === -1) return bad("no embed block");
    const closers = (s.match(/<\/script>/gi) || []).length;
    if (closers !== 5) return bad("closers=" + closers);
    /* Exactly one `<script id="markdown-source"` must remain: the app's own
       regex literal — the real sample block was replaced by the embed. */
    const opens = (s.match(/<script id="markdown-source"/g) || []).length;
    if (opens !== 1) return bad("sample-block opens=" + opens);
    return ok("len=" + s.length);
  });
  check("E2", "hostile doc export: containment", () => {
    const hostile =
      "---\ntitle: Hostile Book\nlang: de\n---\n\n# H\n\n<!--<script>alert(1)</script>-->\n\ntext with </script> inside\n\n<script>\n";
    W.openMarkdown(hostile);
    const s = W.buildStandaloneHTML();
    if (!s) return bad("export null");
    const closers = (s.match(/<\/script>/gi) || []).length;
    if (closers !== 5) return bad("closers=" + closers);
    exported = s;
    return ok("len=" + s.length);
  });

  /* The exported file boots asynchronously (DOMContentLoaded -> App.boot),
     so the round-trip assertions run on a later tick. */
  setTimeout(() => {
    const vc2 = new VirtualConsole();
    vc2.on("jsdomError", () => {});
    const dom2 = new JSDOM(exported, {
      runScripts: "dangerously",
      url: "http://localhost/exported/",
      pretendToBeVisual: true,
      virtualConsole: vc2,
    });
    setTimeout(() => {
      check("E2B", "hostile export boots and renders", () => {
        const w2 = dom2.window;
        if (!w2.MDWebbook) return bad("app did not boot in export");
        const c2 = w2.document.getElementById("content");
        const h1 = c2 ? c2.querySelector("h1") : null;
        const goodTitle = w2.document.title === "Hostile Book";
        return h1 && h1.textContent === "H" && goodTitle
          ? ok("title=" + w2.document.title)
          : bad(
              "h1=" + (h1 ? h1.textContent : "none") +
                " title=" + w2.document.title,
            );
      });
      Promise.all(asyncPromises).then(report, report);
    }, 120);
  }, 30);
  return;

  /* ------------------------------ report ---------------------------- */
  function report() {
  let pass = 0, fail = 0, crash = 0;
  console.log("# P0+P1 verification harness — built markdown_webbook.html in jsdom\n");
  for (const r of results) {
    if (r.verdict === "PASS") pass++;
    else if (r.verdict === "FAIL") fail++;
    else crash++;
    console.log("[" + r.verdict + "] " + r.id + " " + r.label + (r.verdict === "PASS" ? "" : "\n       -> " + r.note));
  }
  console.log("\nTotals: " + pass + " pass / " + fail + " fail / " + crash + " crash of " + results.length);
  console.log("Baseline comparison: 34 broken -> " + (fail + crash) + " broken");
  console.log("P1 additions: settings, find, figures, export, reading aids");
  console.log("P2 additions: palette, highlighting, shortcuts, strict HTML, glass toolbar");
  console.log("v1.3.1 additions: recents/doc-nav removal, line height, per-block wrap, table fit, bottom progress, Safari plates");
  console.log("v1.4.0 additions (QoL M0-M5): headingless-doc fix, live task checkboxes, header accent, print settings preservation, image lightbox, popover/resize hygiene");
  console.log("v1.5.0 additions (publication): metadata dialog, publishable export with publication-only menu, include-menu toggle, per-doc strict removal, themed print margins");
  console.log("v1.6.0 additions (replica publication): exact 1:1 published replica with authoring exclusions + MDWB_PUB listener suppression, conditional doc-menu visibility, rawHtml scroll pin, iOS grouped-list metadata editor, fixed menu measure + blue toggle label");
  console.log("v1.7.0 additions (polish): meta-panel spacing/size/colour pass (38px rows, 88px plain-text Description editor, inverted solid Save, space-6 subtext), plain-text publication toggle label, code line numbers + per-block COLLAPSE with fading 88px window, table column floors/caps with hidden-bar drag-to-scroll");
  console.log("v1.8.0 additions: Open-from-url import (meta-panel modal, loading state, http(s)+extension validation, HTML/binary guards, toasts on failure only, always excluded from publications), .mdx imports with preserved download naming + dynamic Download label, toc/findbar mutual exclusion, btn-top below the toc drawer, welcome-paste removal");
  console.log("v1.8.1 additions: Paste from clipboard (doc-menu item, text/type inspection with error toasts, success toast via render) and the Fetch & embed remote media switch (default off; off strips media constructs at import, on rewrites image urls to sanitiser-allowed data uris), both load-path wired (file/url/clipboard/drag) and excluded from publications; Edit HTML metadata regrouped under Print / save as PDF");
  console.log("v1.8.2 additions: embed allowlist widened to the standard image formats (png/jpg/jpeg/gif/webp/svg+xml/bmp/ico/avif with canonical aliases + svg/avif magic-byte sniffs), Paste-from-clipboard keyboard shortcut (Ctrl/Cmd+Shift+V, toasts, help-panel row, dropped from publications), and exact-capture metadata save (empty field clears the entry, cleared title reads Untitled, captured title applied to toolbar/footer/tab/placeholder/downloads/exports)");
  console.log("v1.8.3 additions: image format identification is extension-first (a recognised png/jpg/jpeg/gif/webp/svg/bmp/ico/avif ending names the canonical type outright — svg served as text/xml now embeds) with the content-type allowlist + magic-byte sniff kept as the fallback for unrecognised or missing extensions");
  console.log("v1.8.4 additions: the embed pass is AST-driven and conversion-integrated (image nodes collected from the parsed token tree — paren urls, multi-line titles, references, nesting, <img> — with boundary-checked exact rewrites), and the detection chain ends in the payload's magic bytes (extension, then Content-Type, then the bytes — a real image is never rejected for lacking an extension); repro-case suite covers the wikimedia .PNG + usefresh .svg pair");
    console.log("v1.8.5 additions: the embed transport is now the browser's own image load — images are detected on the compiled DOM and captured through a CORS-approved probe + offscreen canvas + toDataURL (no fetch() anywhere, no extension/header/magic-byte chain), then swapped into the live DOM and rewritten into the source (badge links included, code masked out) and re-persisted; per-image failures, oversize caps, dimensionless probes and never-settling loads keep the remote url and never break the import flow");
  process.exit(fail + crash > 0 ? 1 : 0);
  }
}, 150);
