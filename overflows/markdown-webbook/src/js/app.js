
            /*
 * Markdown Webbook — application layer (P0 + P1 + P2 + UI refinements + QoL)
 * Single-file, no build step. Modules are IIFE-scoped sections:
 *   Slugger, Parser (marked adapter), Sanitizer (DOMPurify), Highlight
 *   (compact tokenizer, R18), Enhancer (incl. live task checkboxes),
 *   Storage, Settings (reader prefs incl. header accent), Source/Exporter
 *   (import, lifecycle, export suite), Nav (TOC, scrollspy, progress),
 *   Find (search layer), Palette (R17), Help (R19), Lightbox (M5A),
 *   Meta, OpenUrl (1.8.0), UI, App.
 * Security model: imported Markdown is untrusted input; all rendered HTML is
 * sanitised and URL schemes are allow-listed before reaching the DOM. The
 * embed/export path stores the document as a JSON payload with every "<"
 * escaped, so no tag-opening sequence can break out of the script block.
 * Test hook: window.MDWebbook exposes the pure render pipeline plus settings,
 * find, palette, help, lightbox, strict-HTML and document-loading primitives
 * for the verification harness (see scripts/verify_refactor.js).
 */
(function () {
    "use strict";

    var APP_VERSION = "1.8.0";
    var LS_PREFIX = "mdwb:";
    var MOBILE_QUERY = "(max-width: 720px)";
    var HEAVY_DOC_CHARS = 200 * 1024; /* show a loading state above this */
    var HEADING_SCROLL_OFFSET = 96;

    /* ============================== Utilities ============================== */

    function $(id) {
        return document.getElementById(id);
    }

    function safeMatchMedia(query) {
        try {
            return window.matchMedia ? window.matchMedia(query) : null;
        } catch (e) {
            return null;
        }
    }

    function prefersReducedMotion() {
        var m = safeMatchMedia("(prefers-reduced-motion: reduce)");
        return !!(m && m.matches);
    }

    function isMobileWidth() {
        var m = safeMatchMedia(MOBILE_QUERY);
        return !!(m && m.matches);
    }

    function djb2(str) {
        var h = 5381;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(36);
    }

    function raf2(fn) {
        requestAnimationFrame(function () {
            requestAnimationFrame(fn);
        });
    }

    /* ============================== Slugger (R9) =========================== */
    /* GitHub-style, Unicode-aware, de-duplicating heading IDs. */

    function makeSlugger() {
        var seen = Object.create(null);
        return {
            slug: function (text) {
                var s = String(text)
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
                    .trim()
                    .replace(/\s+/g, "-")
                    .replace(/-{2,}/g, "-");
                if (!s) s = "section";
                if (s in seen) {
                    seen[s] += 1;
                    s = s + "-" + seen[s];
                } else {
                    seen[s] = 0;
                }
                return s;
            },
        };
    }

    /* ====================== Engine bootstrap (R1) ========================== */

    if (typeof marked === "undefined") {
        throw new Error("Markdown engine (marked) failed to load");
    }
    if (typeof DOMPurify === "undefined") {
        throw new Error("Sanitizer (DOMPurify) failed to load");
    }
    marked.setOptions({ gfm: true, breaks: false });

    /* =========================== Parser (R1, R10) ========================== */

    var Parser = {
        FRONTMATTER_RE: /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,

        splitFrontmatter: function (md) {
            var text = String(md == null ? "" : md).replace(/\r\n/g, "\n");
            var m = this.FRONTMATTER_RE.exec(text);
            if (!m) return { meta: {}, body: text };
            var meta = {};
            m[1].split("\n").forEach(function (line) {
                var i = line.indexOf(":");
                if (i > 0) {
                    var k = line.slice(0, i).trim().toLowerCase();
                    var v = line.slice(i + 1).trim();
                    if (k && v && !(k in meta)) meta[k] = v;
                }
            });
            return { meta: meta, body: text.slice(m[0].length) };
        },

        /* Strict mode (R20) strips raw HTML from the source *before* parsing,
           so markdown-generated structure (headings, lists, tables, task
           checkboxes) always survives; the default allow-list still
           sanitises whatever remains afterwards. */
        stripRawHtml: function (md) {
            var text = String(md == null ? "" : md);
            var lines = text.split("\n");
            var out = [];
            var fence = null; /* "```" | "~~~" marker when inside a fence */
            var indented = false;

            var FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];

                if (fence) {
                    out.push(line);
                    if (
                        line.indexOf(fence.marker) === 0 &&
                        /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line) &&
                        line.match(/^\s{0,3}(`{3,}|~{3,})/)[1].charAt(0) ===
                            fence.marker.charAt(0)
                    )
                        fence = null;
                    continue;
                }

                var fm = FENCE_RE.exec(line);
                if (fm && !indented) {
                    fence = { marker: fm[1] };
                    out.push(line);
                    continue;
                }

                /* Indented code block run (4+ spaces), incl. blank lines
                   inside the run. */
                if (/^ {4,}\S/.test(line)) {
                    indented = true;
                    out.push(line);
                    continue;
                }
                if (indented) {
                    if (!line.trim()) {
                        out.push(line);
                        continue;
                    }
                    indented = false;
                }

                out.push(Parser.stripLineRawHtml(line));
            }
            return out.join("\n");
        },

        /* Strip raw HTML from one free-text line: comments, processing
           instructions, declarations and tags are removed while their text
           stays. Code spans and autolinks are protected. */
        stripLineRawHtml: function (line) {
            if (line.indexOf("<") === -1) return line;

            var spans = [];
            var s = line.replace(/(`+)([\s\S]*?)\1/g, function (m) {
                spans.push(m);
                return "\u0000" + (spans.length - 1) + "\u0000";
            });

            s = s
                .replace(/<\!--[\s\S]*?-->/g, "")
                .replace(/<\?[\s\S]*?\?>/g, "")
                .replace(/<![A-Za-z][^>]*>/g, "")
                .replace(/<\/?[A-Za-z][^>]*>/g, function (m) {
                    /* Keep CommonMark autolinks: <https://…>, <mailto:…>,
                       <user@host>. */
                    if (/^<\/?[A-Za-z][A-Za-z0-9+.\-]*:/.test(m)) return m;
                    if (/^<[A-Za-z0-9.+-]+@[^>\s]+>$/.test(m)) return m;
                    return "";
                });

            return s.replace(/\u0000(\d+)\u0000/g, function (m, n) {
                return spans[Number(n)];
            });
        },

        render: function (md, strictHtml) {
            var split = this.splitFrontmatter(md);
            var body = split.body;
            if (strictHtml === "strip") body = Parser.stripRawHtml(body);
            var raw = marked.parse(body);
            /* Canonical pipeline: parse -> sanitise -> enhance. Enhancement
               runs in string space so every consumer gets identical output. */
            return Enhancer.enhance(Sanitizer.clean(raw));
        },
    };

    /* ========================== Sanitizer (R2) ============================= */
    /* Untrusted-input policy: allow-list schemes; DOMPurify handles tags. */

    var Sanitizer = {
        SAFE_URI:
            /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,

        /* Untrusted-input policy: allow-list schemes; DOMPurify handles tags.
           Strict mode never reaches this with an emptied allow-list — raw
           HTML is removed upstream (Parser.stripRawHtml) so markdown
           structure always survives (R20). */
        clean: function (html) {
            return DOMPurify.sanitize(html, {
                ADD_ATTR: ["target", "start"],
                ALLOWED_URI_REGEXP: Sanitizer.SAFE_URI,
            });
        },
    };

    /* ========================= Highlight (R18) ============================= */
    /* Compact dependency-free tokenizer for the common technical languages.
       The audit suggested a vendored highlight.js bundle (~100 KB minified
       for the common set); the file's size contract is the harder
       constraint, so this module emits the same hljs-* class names from
       ~180 lines. Unknown languages fall through untouched — cosmetic
       highlighting must never risk correctness. Output is always escaped
       here; it is only ever assigned to code elements as innerHTML. */

    var Highlight = (function () {
        var MAX_LEN = 30000;

        var ALIAS = {
            js: "javascript", jsx: "javascript", mjs: "javascript",
            cjs: "javascript", node: "javascript",
            ts: "typescript", tsx: "typescript",
            json: "json", jsonc: "json", json5: "json",
            html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
            css: "css", scss: "css", less: "css",
            sh: "bash", shell: "bash", zsh: "bash", console: "bash",
            py: "python", python: "python",
            c: "clike", h: "clike", cpp: "clike", "c++": "clike",
            cc: "clike", cxx: "clike", hpp: "clike",
            java: "clike", cs: "clike", "c#": "clike", csharp: "clike",
            go: "clike", golang: "clike", rust: "clike", rs: "clike",
            kt: "clike", kotlin: "clike", swift: "clike", scala: "clike",
            php: "php",
            sql: "sql", mysql: "sql", postgres: "sql", pgsql: "sql",
            yaml: "yaml", yml: "yaml",
            toml: "toml", ini: "toml",
            diff: "diff", patch: "diff",
            md: "markdown", markdown: "markdown",
        };

        var KW = {
            javascript: "as async await break case catch class const continue debugger default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of private protected public readonly return set static super switch this throw try typeof var void while with yield",
            typescript: "as abstract any async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let namespace never new number of private protected public readonly return set static string super switch symbol this throw try type typeof undefined union var void while with yield",
            clike: "alignas alignof and auto bool break case catch char char8_t char16_t char32_t class co_await co_return co_yield concept const consteval constexpr constinit const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false final float for friend goto if inline int int8_t int16_t int32_t int64_t long mutable namespace new noexcept not nullptr operator or override private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor override let func var string rune chan defer go map package select struct type interface impl fn mut pub use move trait where async await unsafe dyn crate mod self Self ref match loop in as box",
            python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self",
            bash: "break case continue do done elif else esac exit fi for function if in return select set shift then time until while alias source export local readonly declare unset eval exec trap",
            php: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null",
            sql: "add all alter and any as asc between by case check column constraint create cross database default delete desc distinct drop else end escape except exists foreign from full group having in index inner insert intersect into is join key left like limit natural not null offset on or order outer primary references right rollback select set table then top truncate union unique update values view when where with commit begin",
        };

        var LIT = {
            javascript: "true false null undefined NaN Infinity this",
            typescript: "true false null undefined NaN Infinity this never unknown any",
            clike: "true false null nullptr NULL True False None nil",
            python: "True False None",
            bash: "true false",
            php: "true false null TRUE FALSE NULL",
            sql: "NULL TRUE FALSE",
            yaml: "true false null yes no on off True False Null",
        };

        var BUILTIN = {
            javascript: "Array Boolean Date Error Function JSON Math Number Object Promise RegExp String Symbol console document fetch globalThis localStorage location navigator parseInt parseFloat setInterval setTimeout window",
            typescript: "Array Boolean Date Error Function JSON Math Number Object Partial Promise Readonly Record RegExp String Symbol console document fetch globalThis parseInt parseFloat setTimeout window",
            clike: "printf scanf cout cin endl std vector string int32_t int64_t uint32_t uint64_t println System out err String Object Integer Double Boolean Math List Map ArrayList HashMap Exception RuntimeException Error Option Result Some None Vec Box Rc Arc println",
            python: "abs all any bool bytes callable chr classmethod dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash hex id input int isinstance issubclass iter len list map max min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip __name__ __main__ self",
            bash: "cat cd chmod chown cp curl cut date diff du echo egrep find grep head kill less ln ls mkdir mv pwd rm rmdir sed sleep sort tail tar touch tr uname wc which whoami awk sudo git npm node python pip docker make",
            php: "array_diff array_filter array_map array_merge array_pop array_push array_slice count define echo empty explode implode in_array is_array isset json_decode json_encode max min preg_match print_r printf sprintf strlen str_replace strpos strtolower strtoupper substr trim unset var_dump",
            sql: "AVG COUNT MAX MIN SUM COALESCE CAST CONCAT NOW DATE TIMESTAMP VARCHAR CHAR INT BIGINT TEXT BOOLEAN",
        };

        function word(list) {
            if (!list) return null;
            return new RegExp("^(?:" + list.trim().split(/\s+/).join("|") + ")\\b", "i");
        }

        function makeRules(lang) {
            if (lang === "json") {
                return [
                    { re: /"(?:\\.|[^"\\])*"(?=\s*:)/y, cls: "hljs-attr" },
                    { re: /"(?:\\.|[^"\\])*"/y, cls: "hljs-string" },
                    { re: /\b(?:true|false|null)\b/y, cls: "hljs-literal" },
                    { re: /-?\b\d+(\.\d+)?([eE][+-]?\d+)?\b/y, cls: "hljs-number" },
                ];
            }
            if (lang === "xml") {
                return [
                    { re: /<\!--[\s\S]*?-->/y, cls: "hljs-comment" },
                    { re: /<!\[CDATA\[[\s\S]*?\]\]>/y, cls: "hljs-meta" },
                    { re: /<!DOCTYPE[^>]*>/iy, cls: "hljs-meta" },
                    { re: /<\/?[A-Za-z][\w:.-]*>?/y, cls: "hljs-tag" },
                    { re: /"[^"]*"|'[^']*'/y, cls: "hljs-string" },
                    { re: /[A-Za-z_][\w:.-]*(?==)/y, cls: "hljs-attr" },
                    { re: /\/?>/y, cls: "hljs-tag" },
                ];
            }
            if (lang === "css") {
                return [
                    { re: /\/\*[\s\S]*?\*\//y, cls: "hljs-comment" },
                    { re: /"[^"]*"|'[^']*'/y, cls: "hljs-string" },
                    { re: /@[\w-]+/y, cls: "hljs-keyword" },
                    { re: /#[0-9a-fA-F]{3,8}\b/y, cls: "hljs-number" },
                    { re: /-?\d+(\.\d+)?(px|em|rem|vh|vw|vmin|vmax|s|ms|deg|fr|%|ch|ex)?\b/y, cls: "hljs-number" },
                    { re: /[.#][\w-]+/y, cls: "hljs-selector-tag" },
                    { re: /[\w-]+(?=\s*:)/y, cls: "hljs-attr" },
                ];
            }
            if (lang === "yaml") {
                return [
                    { re: /#[^\n]*/y, cls: "hljs-comment" },
                    { re: /"[^"\n]*"|'[^'\n]*'/y, cls: "hljs-string" },
                    { re: /^\s*[\w.\/-]+(?=\s*:)/my, cls: "hljs-attr" },
                    { re: /[&*][\w-]+/y, cls: "hljs-symbol" },
                    { re: /-?\b\d+(\.\d+)?\b/y, cls: "hljs-number" },
                    { re: word(LIT.yaml), cls: "hljs-literal" },
                ];
            }
            if (lang === "toml") {
                return [
                    { re: /(#|;)[^\n]*/y, cls: "hljs-comment" },
                    { re: /^\s*\[[^\]\n]*\]/my, cls: "hljs-section" },
                    { re: /"[^"\n]*"|'[^'\n]*'/y, cls: "hljs-string" },
                    { re: /[\w.-]+(?=\s*=)/y, cls: "hljs-attr" },
                    { re: /-?\b\d+(\.\d+)?\b/y, cls: "hljs-number" },
                    { re: /\b(?:true|false)\b/y, cls: "hljs-literal" },
                ];
            }
            if (lang === "diff") {
                return [
                    { re: /^\+\+ [^\n]*/my, cls: "hljs-meta" },
                    { re: /^-- [^\n]*/my, cls: "hljs-meta" },
                    { re: /^@@[^\n]*/my, cls: "hljs-meta" },
                    { re: /^\+[^\n]*/my, cls: "hljs-addition" },
                    { re: /^-[^\n]*/my, cls: "hljs-deletion" },
                ];
            }
            if (lang === "markdown") {
                return [
                    { re: /^#{1,6}[^\n]*/my, cls: "hljs-section" },
                    { re: /```[\s\S]*?```|~~~[\s\S]*?~~~/y, cls: "hljs-code" },
                    { re: /\*\*[^*\n]+\*\*|__[^_\n]+__/y, cls: "hljs-strong" },
                    { re: /\*[^*\n]+\*|_[^_\n]+_/y, cls: "hljs-emphasis" },
                    { re: /`[^`\n]+`/y, cls: "hljs-code" },
                    { re: /\[[^\]\n]*\]\([^)\n]*\)/y, cls: "hljs-link" },
                    { re: /^[-*+]\s|^>\s?/my, cls: "hljs-bullet" },
                ];
            }
            /* C-family, JavaScript/TypeScript, Python, Bash, PHP, SQL */
            var rules = [];
            if (lang === "clike") {
                rules.push({ re: /#[ \t]*\w+[^\n]*/y, cls: "hljs-meta" }); /* preprocessor */
                rules.push({ re: /@[A-Za-z_]\w*/y, cls: "hljs-meta" }); /* annotations */
            }
            if (lang === "python") {
                rules.push({ re: /@[A-Za-z_][\w.]*/y, cls: "hljs-meta" }); /* decorators */
            }
            rules.push({ re: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/y, cls: "hljs-comment" });
            rules.push({ re: /"""[\s\S]*?"""|'''[\s\S]*?'''/y, cls: "hljs-string" });
            rules.push({ re: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y, cls: "hljs-string" });
            if (lang === "javascript" || lang === "typescript") {
                rules.push({ re: /`(?:\\.|[^`\\])*`/y, cls: "hljs-string" });
            }
            if (lang === "python" || lang === "bash" || lang === "php") {
                rules.push({ re: /#[^\n]*/y, cls: "hljs-comment" });
            }
            if (lang === "php") {
                rules.push({ re: /\$[A-Za-z_]\w*/y, cls: "hljs-variable" });
            }
            rules.push({ re: /:\w+/y, cls: "hljs-symbol" });
            rules.push({ re: /\b0[xX][0-9a-fA-F]+\b|\b\d+(\.\d+)?([eE][+-]?\d+)?[fFlLuU]*\b/y, cls: "hljs-number" });
            rules.push({ re: word(LIT[lang] || LIT.clike), cls: "hljs-literal" });
            rules.push({ re: word(KW[lang] || KW.clike), cls: "hljs-keyword" });
            rules.push({ re: word(BUILTIN[lang] || BUILTIN.clike), cls: "hljs-built_in" });
            rules.push({ re: /[A-Za-z_$][\w$]*(?=\s*\()/y, cls: "hljs-title" });
            return rules;
        }

        function escapeHtml(s) {
            return s
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
        }

        function highlight(code, lang) {
            var canonical = ALIAS[lang];
            if (!canonical || !code || code.length > MAX_LEN) return null;
            var rules;
            try {
                rules = makeRules(canonical);
            } catch (e) {
                return null;
            }
            var out = [];
            var pos = 0;
            var len = code.length;
            var guard = 0;
            while (pos < len && guard < 200000) {
                guard++;
                var matched = null;
                for (var i = 0; i < rules.length; i++) {
                    var re = rules[i].re;
                    re.lastIndex = pos;
                    var m = re.exec(code);
                    if (m && m.index === pos && m[0].length) {
                        matched = { text: m[0], cls: rules[i].cls };
                        break;
                    }
                }
                if (matched) {
                    out.push(
                        '<span class="' + matched.cls + '">' +
                            escapeHtml(matched.text) +
                            "</span>",
                    );
                    pos += matched.text.length;
                } else {
                    out.push(escapeHtml(code.charAt(pos)));
                    pos++;
                }
            }
            if (pos < len) out.push(escapeHtml(code.slice(pos)));
            return out.join("");
        }

        return { highlight: highlight, aliases: ALIAS };
    })();

    /* ==================== Enhancer (post-render passes) ==================== */

    var Enhancer = {
        /* Enhancement over sanitised HTML in string space: the payload is
           already sanitised, so parsing it into a detached container cannot
           execute anything. Serialised back after all passes. */
        enhance: function (html) {
            var box = document.createElement("div");
            box.innerHTML = html;
            Enhancer.runPasses(box);
            return box.innerHTML;
        },

        runPasses: function (root) {
            var slugger = makeSlugger();

            Array.prototype.forEach.call(
                root.querySelectorAll("h1, h2, h3, h4, h5, h6"),
                function (h) {
                    h.id = slugger.slug(h.textContent);
                },
            );

            /* Link policy: in-page anchors stay in-page; external links open
               safely; sanitiser already stripped javascript:/data: hrefs. */
            Array.prototype.forEach.call(
                root.querySelectorAll("a[href]"),
                function (a) {
                    var href = a.getAttribute("href") || "";
                    if (href.charAt(0) === "#") {
                        a.removeAttribute("target");
                    } else if (/^https?:/i.test(href)) {
                        a.setAttribute("target", "_blank");
                        a.setAttribute("rel", "noopener noreferrer");
                    }
                },
            );

            Array.prototype.forEach.call(
                root.querySelectorAll("img"),
                function (img) {
                    img.setAttribute("loading", "lazy");
                    img.setAttribute("draggable", "false");
                },
            );

            Enhancer.promoteFigures(root);

            /* GFM task lists become live checkboxes (M0 0.3): the disabled
               attribute is dropped, each box is indexed in document order
               (stable across re-renders of the same source), and its
               accessible name comes from the list item's own text. State
               application happens at load time — the Markdown source is
               never rewritten. */
            Enhancer.enhanceTasks(root);

            /* R21: heading permalinks. SVG-only (no text) so slugger and TOC
               text extraction stay unaffected. Slugs were assigned first. */
            Array.prototype.forEach.call(
                root.querySelectorAll("h1, h2, h3, h4, h5, h6"),
                function (h) {
                    if (!h.id) return;
                    var a = document.createElement("a");
                    a.className = "h-anchor";
                    a.href = "#" + h.id;
                    a.setAttribute("aria-label", "Copy link to this section");
                    a.innerHTML =
                        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
                    h.appendChild(a);
                },
            );

            /* Tables scroll horizontally inside a rounded, border-clipped
               frame (.table-wrapper > .table-scroll: overflow-x auto,
               scrollbars fully hidden, native touch + mouse drag still
               work). Wrapping runs in string space with the other passes,
               exactly once per table, so every render path — and the 1:1
               publication — gets identical structure. */
            Array.prototype.forEach.call(root.querySelectorAll("table"),
                function (table) {
                    if (
                        table.parentNode &&
                        table.parentNode.classList &&
                        table.parentNode.classList.contains("table-scroll")
                    )
                        return;
                    var wrap = document.createElement("div");
                    wrap.className = "table-wrapper";
                    var scroll = document.createElement("div");
                    scroll.className = "table-scroll";
                    table.parentNode.insertBefore(wrap, table);
                    wrap.appendChild(scroll);
                    scroll.appendChild(table);
                },
            );

            /* Cap each cell's content: the wrap cap lives on an inner
               block, not on the cell itself, so an unbreakable line still
               floors the cell's min-content (the table grows and the
               scroller pans a complete table) while wrappable content
               caps and wraps at half the wrapper. Runs exactly once per
               cell — re-wraps are no-ops. */
            Array.prototype.forEach.call(root.querySelectorAll("th, td"),
                function (cell) {
                    if (!cell.childNodes.length) return;
                    if (
                        cell.childNodes.length === 1 &&
                        cell.firstElementChild &&
                        cell.firstElementChild.classList &&
                        cell.firstElementChild.classList.contains("td-cap")
                    )
                        return;
                    var cap = document.createElement("div");
                    cap.className = "td-cap";
                    while (cell.firstChild) cap.appendChild(cell.firstChild);
                    cell.appendChild(cap);
                },
            );

            Array.prototype.forEach.call(
                root.querySelectorAll("pre > code"),
                function (code) {
                    Enhancer.wrapCode(code);
                },
            );
        },

        /* Settle pass (1.7.2; shadows gated 1.7.3): Blink lets an
           unbreakable line paint as ink beyond a width-capped table
           without growing the box, which would pan a truncated table
           (stripes and borders stop at the first screen). Once the
           content is live, pin any too-wide table to its full scrollable
           width so the box itself spans the pan. The same overflow
           measurement toggles .is-pannable on the wrapper — the edge
           shadows render only on tables that really can scroll, since a
           non-scrollable scroller has an inactive timeline whose
           animations apply nothing. Pins and classes are recomputed from
           scratch on every render and on resize. */
        settleTables: function (root) {
            Array.prototype.forEach.call(
                root.querySelectorAll(".table-scroll"),
                function (scroller) {
                    var table = scroller.querySelector("table");
                    if (!table) return;
                    table.style.minWidth = "";
                    var pannable =
                        scroller.scrollWidth > scroller.clientWidth + 1;
                    if (pannable)
                        table.style.minWidth = scroller.scrollWidth + "px";
                    if (scroller.parentNode && scroller.parentNode.classList)
                        scroller.parentNode.classList.toggle(
                            "is-pannable",
                            pannable,
                        );
                },
            );
        },

        /* Collect heading metadata from an already-enhanced DOM. */
        collect: function (root) {
            var headings = [];
            Array.prototype.forEach.call(
                root.querySelectorAll("h1, h2, h3, h4, h5, h6"),
                function (h) {
                    if (!h.id) return;
                    headings.push({
                        level: parseInt(h.tagName.substring(1), 10),
                        text: h.textContent.trim(),
                        id: h.id,
                    });
                },
            );
            return headings;
        },

        /* Promote images whose alt text reads like a sentence into figures
           with captions (§7). Badge images inside links are never promoted. */
        promoteFigures: function (root) {
            Array.prototype.slice
                .call(root.querySelectorAll("img"))
                .forEach(function (img) {
                    var alt = (img.getAttribute("alt") || "").trim();
                    if (!alt || img.closest("a") || img.closest("figure"))
                        return;
                    var words = alt.split(/\s+/).filter(Boolean).length;
                    if (words < 5) return;
                    var fig = document.createElement("figure");
                    var cap = document.createElement("figcaption");
                    cap.textContent = alt;
                    img.parentNode.insertBefore(fig, img);
                    fig.appendChild(img);
                    fig.appendChild(cap);
                });
        },

        /* Make every GFM task checkbox interactive and index it. */
        enhanceTasks: function (root) {
            Array.prototype.forEach.call(
                root.querySelectorAll('li > input[type="checkbox"]'),
                function (input, i) {
                    input.disabled = false;
                    input.classList.add("task-checkbox");
                    input.setAttribute("data-task-index", String(i));
                    var li = input.closest("li");
                    var text = li ? li.textContent.trim().slice(0, 120) : "";
                    if (text) input.setAttribute("aria-label", text);
                },
            );
        },

        /* Split escaped (and optionally highlighted) HTML into per-line
           chunks for the line-number gutter. Token spans that cross a
           newline — multi-line comments, triple-quoted strings — are
           closed at the break and re-opened on the next line, so their
           colour survives the split. A single trailing newline is
           dropped: editors never number the line after EOF. */
        numberLines: function (html) {
            var lines = [];
            var cur = "";
            var stack = [];
            var i = 0;
            var len = html.length;
            while (i < len) {
                var ch = html.charAt(i);
                if (ch === "<") {
                    var end = html.indexOf(">", i);
                    if (end === -1) {
                        cur += html.slice(i);
                        break;
                    }
                    var tag = html.slice(i, end + 1);
                    if (tag.charAt(1) === "/") stack.pop();
                    else if (tag.charAt(tag.length - 2) !== "/")
                        stack.push(tag);
                    cur += tag;
                    i = end + 1;
                } else if (ch === "\n") {
                    var s;
                    for (s = stack.length - 1; s >= 0; s--) cur += "</span>";
                    lines.push(cur);
                    cur = "";
                    for (s = 0; s < stack.length; s++) cur += stack[s];
                    i++;
                } else {
                    cur += ch;
                    i++;
                }
            }
            lines.push(cur);
            if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
            var out = [];
            for (var j = 0; j < lines.length; j++) {
                out.push('<span class="code-line">' + lines[j] + "</span>");
            }
            return out.join("");
        },

        wrapCode: function (code) {
            var pre = code.parentElement;
            if (!pre) return;
            if (
                pre.parentElement &&
                pre.parentElement.classList.contains("code-wrapper")
            )
                return;

            var lang = "";
            String(code.className || "")
                .split(/\s+/)
                .forEach(function (c) {
                    if (c.indexOf("language-") === 0) lang = c.slice(9);
                });

            var wrapper = document.createElement("div");
            wrapper.className = "code-wrapper";

            /* R18: cosmetic highlighting, best effort. The tokeniser escapes
               everything itself; a failure leaves plain, correct code. */
            var html = code.innerHTML; /* already entity-escaped */
            if (lang) {
                try {
                    var marked_ = Highlight.highlight(
                        code.textContent,
                        lang,
                    );
                    if (marked_) html = marked_;
                } catch (e) {}
            }
            /* Line numbers: one block span per logical line; the CSS
               counter gutter paints the numbers outside the text flow. */
            code.innerHTML = Enhancer.numberLines(html);

            var header = document.createElement("div");
            header.className = "code-header";

            var chip = document.createElement("span");
            chip.className = "code-lang";
            chip.textContent = lang || "code";

            var actions = document.createElement("span");
            actions.className = "code-actions";

            /* Per-block collapse control: expanded is the default; folding
               clips the block to an 88px window with a fading cut edge. */
            var collapseBtn = document.createElement("button");
            collapseBtn.type = "button";
            collapseBtn.className = "code-btn collapse-code-btn";
            collapseBtn.textContent = "Collapse";
            collapseBtn.title = "Fold this block to an 88px preview";
            collapseBtn.setAttribute("aria-pressed", "false");

            /* Per-block wrap control: wrapping is the default; each block
               toggles independently of the others and of any global state. */
            var wrapBtn = document.createElement("button");
            wrapBtn.type = "button";
            wrapBtn.className = "code-btn wrap-code-btn";
            wrapBtn.textContent = "Wrap";
            wrapBtn.title = "Toggle line wrapping for this block";
            wrapBtn.setAttribute("aria-pressed", "true");

            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "code-btn copy-code-btn";
            btn.textContent = "Copy";

            actions.appendChild(collapseBtn); /* prepended before Wrap */
            actions.appendChild(wrapBtn);
            actions.appendChild(btn);
            header.appendChild(chip);
            header.appendChild(actions);

            wrapper.classList.add("is-wrapped");
            pre.setAttribute("tabindex", "0");
            pre.setAttribute(
                "aria-label",
                "Code block" +
                    (lang ? ", language: " + lang : "") +
                    ", lines wrapped",
            );

            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(header);
            wrapper.appendChild(pre);
        },

        /* Flip one block's collapse state; the button's aria-pressed state
           reads active for as long as the block stays folded. */
        toggleCollapse: function (btnEl) {
            var wrapper = btnEl.closest(".code-wrapper");
            if (!wrapper) return;
            var on = !wrapper.classList.contains("is-collapsed");
            wrapper.classList.toggle("is-collapsed", on);
            btnEl.setAttribute("aria-pressed", on ? "true" : "false");
        },

        /* Flip one block's wrap state; the button's aria-pressed state and
           the block's accessible label follow. */
        toggleWrap: function (btnEl) {
            var wrapper = btnEl.closest(".code-wrapper");
            if (!wrapper) return;
            var on = !wrapper.classList.contains("is-wrapped");
            wrapper.classList.toggle("is-wrapped", on);
            btnEl.setAttribute("aria-pressed", on ? "true" : "false");
            var pre = wrapper.querySelector("pre");
            if (pre) {
                var base = (pre.getAttribute("aria-label") || "Code block")
                    .replace(/, (lines wrapped|scrollable horizontally)$/, "");
                pre.setAttribute(
                    "aria-label",
                    base +
                        (on
                            ? ", lines wrapped"
                            : ", scrollable horizontally"),
                );
            }
        },
    };

    /* ===================== Storage / Source (R3, R4, R10) ================== */

    var Storage = {
        available: (function () {
            try {
                var k = LS_PREFIX + "probe";
                localStorage.setItem(k, "1");
                localStorage.removeItem(k);
                return true;
            } catch (e) {
                return false;
            }
        })(),

        getJSON: function (key, fallback) {
            if (!this.available) return fallback;
            try {
                var v = localStorage.getItem(LS_PREFIX + key);
                return v ? JSON.parse(v) : fallback;
            } catch (e) {
                return fallback;
            }
        },

        setJSON: function (key, value) {
            if (!this.available) return false;
            try {
                localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
                return true;
            } catch (e) {
                return false;
            }
        },

        remove: function (key) {
            if (!this.available) return;
            try {
                localStorage.removeItem(LS_PREFIX + key);
            } catch (e) {}
        },
    };

    var Source = {
        /* Single-slot persistence: the open document survives a refresh.
           (The recents-list feature was removed by design — only the last
           document is remembered, and legacy recents state is purged.) */
        last: null,

        loadLast: function () {
            Storage.remove("recents");
            Storage.remove("last");
            var rec = Storage.getJSON("current", null);
            this.last =
                rec && typeof rec.source === "string" ? rec : null;
        },

        saveDoc: function (doc) {
            if (doc.origin === "embedded") return true;

            var rec = {
                id: doc.id,
                title: doc.meta.title || "Untitled",
                source: doc.source,
            };
            /* Import provenance rides along so a restored document keeps
               its extension-aware Download label and file naming (1.8.0). */
            if (doc.fileName) rec.fileName = doc.fileName;
            if (doc.fileExt) rec.fileExt = doc.fileExt;
            var ok = Storage.setJSON("current", rec);
            this.last = ok ? rec : null;
            return ok;
        },

        /* R10/R14: only a literal closing-script-tag sequence can break out
           of a raw-text script block. Legacy escape for text payloads. */
        escapeEmbed: function (md) {
            return String(md).replace(/<\/script/gi, "<\\/script");
        },
        /* R14 export path: the document travels as a JSON payload with every
           "<" rewritten to its escaped form, so no tag-opening or
           comment-opening sequence can survive into the host HTML. */
        embedPayload: function (md) {
            return JSON.stringify({
                v: 1,
                source: String(md == null ? "" : md),
            }).replace(/</g, "\\u003c");
        },
    };

    /* ================== Per-document preferences (R20) ===================== */
    /* Small per-document overrides (e.g. strict HTML), keyed by content hash
       so they survive across sessions and also work for embedded books. */

    var DocPref = {
        get: function (docId, key, fallback) {
            if (!docId) return fallback;
            var prefs = Storage.getJSON("docpref:" + docId, null);
            return prefs && key in prefs && prefs[key] != null
                ? prefs[key]
                : fallback;
        },

        set: function (docId, key, value) {
            if (!docId) return false;
            var prefs = Storage.getJSON("docpref:" + docId, {}) || {};
            prefs[key] = value;
            return Storage.setJSON("docpref:" + docId, prefs);
        },
    };

    /* ===================== Settings (R11, §16.3 store) ===================== */
    /* Reader preferences live in one store, persist to localStorage, and
       apply through data-attributes + CSS custom properties — never a
       re-render. Every consumer (theme, family, size, width, line height)
       reads the same values. Code-block wrapping is deliberately NOT a
       global setting: each block owns its independent toggle. */

    var Settings = {
        DEFAULTS: {
            theme: "auto",
            family: "sans",
            size: "m",
            width: "m",
            lh: "m",
            rawHtml: "allow",
            accent: "none",
        },
        VALUES: {
            theme: ["auto", "light", "dark"],
            family: ["sans", "serif"],
            size: ["s", "m", "l"],
            width: ["s", "m", "l"],
            lh: ["s", "m", "l"],
            rawHtml: ["allow", "strip"],
            accent: ["none", "blue", "orange", "yellow", "green"],
        },

        data: null,

        load: function () {
            var saved = Storage.getJSON("settings", {});
            var d = {};
            for (var k in Settings.DEFAULTS) {
                d[k] =
                    saved && Settings.VALUES[k].indexOf(saved[k]) !== -1
                        ? saved[k]
                        : Settings.DEFAULTS[k];
            }
            Settings.data = d;
        },

        get: function (key) {
            return Settings.data
                ? Settings.data[key]
                : Settings.DEFAULTS[key];
        },

        set: function (key, value) {
            if (
                !Settings.VALUES[key] ||
                Settings.VALUES[key].indexOf(value) === -1
            )
                return false;
            Settings.data[key] = value;
            Settings.persist();
            Settings.apply(key);
            return true;
        },

        getAll: function () {
            var out = {};
            for (var k in Settings.DEFAULTS) out[k] = Settings.get(k);
            return out;
        },

        resolvedTheme: function () {
            if (Settings.data.theme !== "auto") return Settings.data.theme;
            var m = safeMatchMedia("(prefers-color-scheme: dark)");
            return m && m.matches ? "dark" : "light";
        },

        persist: function () {
            Storage.setJSON("settings", Settings.data);
            /* The pre-paint script reads the resolved theme to avoid a
               flash; keep it in sync with the preference. */
            Storage.setJSON("theme", Settings.resolvedTheme());
        },

        apply: function (key) {
            var root = document.documentElement;
            if (key === "theme") {
                root.setAttribute("data-theme", Settings.resolvedTheme());
                root.setAttribute("data-theme-pref", Settings.data.theme);
            } else {
                root.setAttribute("data-" + key, Settings.data[key]);
            }
        },

        applyAll: function () {
            for (var k in Settings.DEFAULTS) Settings.apply(k);
        },

        watchSystem: function () {
            var m = safeMatchMedia("(prefers-color-scheme: dark)");
            if (!m) return;
            var onChange = function () {
                if (Settings.data.theme === "auto") {
                    Settings.apply("theme");
                    Settings.persist();
                }
            };
            if (typeof m.addEventListener === "function")
                m.addEventListener("change", onChange);
            else if (typeof m.addListener === "function")
                m.addListener(onChange);
        },
    };

    /* ============================ Exporter (R5, R14) ======================= */

    var Exporter = {
        copyText: function (text, okMsg) {
            function finish(ok) {
                if (ok) UI.toast(okMsg || "Copied");
                else
                    UI.toast(
                        "Copy failed — your browser blocked clipboard access",
                        true,
                    );
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard
                    .writeText(text)
                    .then(function () {
                        finish(true);
                    })
                    .catch(function () {
                        finish(Exporter.fallbackCopy(text));
                    });
            } else {
                finish(Exporter.fallbackCopy(text));
            }
        },

        fallbackCopy: function (text) {
            try {
                var ta = document.createElement("textarea");
                ta.value = text;
                ta.setAttribute("readonly", "");
                ta.style.cssText =
                    "position:fixed;top:-1000px;left:-1000px;opacity:0";
                document.body.appendChild(ta);
                ta.select();
                ta.setSelectionRange(0, text.length);
                var ok = document.execCommand("copy");
                document.body.removeChild(ta);
                return ok;
            } catch (e) {
                return false;
            }
        },

        /* Copy the rendered document as plain text (R14). Uses innerText where
           the browser provides real line breaks, textContent otherwise. */
        renderedText: function () {
            if (!App.current || !App.dom) return "";
            var el = App.dom.content;
            var t = null;
            try {
                t = el.innerText;
            } catch (e) {
                t = null;
            }
            if (typeof t !== "string" || !t) t = el.textContent || "";
            return t.replace(/\n{3,}/g, "\n\n").trim();
        },

        fileStem: function () {
            if (!App.current) return "document";
            return (
                App.current.meta.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 60) || "document"
            );
        },

        /* R14: the entire reader + current document as one standalone HTML
           file. The pristine boot DOM was captured before any mutation; the
           sample-embed script block is swapped for a JSON payload (all "<"
           escaped) so the exported file can never be broken by its content. */
        buildStandalone: function (doc) {
            if (!doc || !App.bootHTML) return null;
            var embed =
                "<script>window.MDWB_EMBED = " +
                Source.embedPayload(doc.source) +
                "<\/script>";
            var re = /<script id="markdown-source" type="text\/markdown">[\s\S]*?<\/script>/i;
            var html = re.test(App.bootHTML)
                ? App.bootHTML.replace(re, function () {
                      return embed;
                  })
                : App.bootHTML.replace(/<\/body>/i, function () {
                      /* Function form: a string replacement would interpret
                         $-patterns found in the user's document. */
                      return embed + "</body>";
                  });
            return html;
        },

        exportHTML: function () {
            if (!App.current) return;
            var html = Exporter.buildStandalone(App.current);
            if (!html) {
                UI.toast("Export failed — could not capture the page", true);
                return;
            }
            try {
                Exporter.downloadBlob(
                    html,
                    Exporter.fileStem() + ".html",
                    "text/html;charset=utf-8",
                );
                UI.toast("Standalone HTML exported");
            } catch (e) {
                UI.toast("Export failed", true);
            }
        },

        /* Publication export: a real web document built from state by the
           Publication renderer — not a screenshot of the reader. */
        exportPublication: function () {
            if (!App.current) return;
            var html = Publication.build(App.current);
            if (!html) {
                UI.toast("Export failed — nothing to publish", true);
                return;
            }
            try {
                Exporter.downloadBlob(
                    html,
                    Exporter.fileStem() + ".publish.html",
                    "text/html;charset=utf-8",
                );
                UI.toast("Publishable HTML exported");
            } catch (e) {
                UI.toast("Export failed", true);
            }
        },

        downloadBlob: function (text, filename, mime) {
            var blob = new Blob([text], { type: mime });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 1000);
        },

        /* Extension-aware download naming (1.8.0): an imported .mdx file
           downloads exactly as it was imported — original name, original
           extension, untouched content. Everything else keeps the classic
           "<title-slug>.md" behaviour. */
        downloadExt: function () {
            return App.current && App.current.fileExt === "mdx" ? "mdx" : "md";
        },

        downloadName: function () {
            if (!App.current) return "document.md";
            if (
                Exporter.downloadExt() === "mdx" &&
                App.current.fileName
            )
                return App.current.fileName;
            return Exporter.fileStem() + "." + Exporter.downloadExt();
        },

        downloadLabel: function () {
            return "Download ." + Exporter.downloadExt();
        },

        download: function () {
            if (!App.current) return;
            try {
                Exporter.downloadBlob(
                    App.current.source,
                    Exporter.downloadName(),
                    "text/markdown;charset=utf-8",
                );
                UI.toast("Download started");
            } catch (e) {
                UI.toast("Download failed", true);
            }
        },

        printDoc: function () {
            try {
                window.print();
            } catch (e) {
                UI.toast("Printing is not available here", true);
            }
        },
    };

    /* =================== Publication renderer (1.6.0) ======================
       The published file is an EXACT 1:1 replica of the Markdown Webbook
       itself — same markup, same styles, same runtime — built from the
       pristine boot snapshot (App.bootHTML) so the live DOM is never
       mutated. Exactly four authoring exceptions are applied, nothing more:

         1. Doc-menu, always excluded (removed): "Open Markdown file…",
            "Edit HTML metadata", "Export publishable HTML" and the
            "Include document menu in publication" switch.
         2. Shortcuts removed from the Help panel AND from the key
            listeners: Open a file (Ctrl+O) and the Document-menu row. The
            app skips them when it boots with window.MDWB_PUB set.
         3. Conditional visibility: with "Include document menu in
            publication" off, #btn-docs and #doc-menu are hidden.
         4. The current document travels inside the replica as the same
            contained JSON payload the standalone export uses.

       The document is embedded, metadata is mapped into <head>, and the
       author's reading prefs (theme/accent attrs on <html>) ship as the
       static defaults — a reader's own pre-paint script overrides them
       from their storage, exactly as in the original app. */

    var Publication = {
        /* Publication preference: keep the reader menu in the export?
           Per-document (DocPref), default on. */
        includeMenu: function (docId) {
            var v = DocPref.get(docId, "pubMenu", null);
            return v == null ? true : !!v;
        },

        esc: function (s) {
            return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
                switch (c) {
                    case "&": return "&amp;";
                    case "<": return "&lt;";
                    case ">": return "&gt;";
                    case '"': return "&quot;";
                    default: return "&#39;";
                }
            });
        },

        /* Authoring items that never travel with a publication (removed
           from the doc-menu, hidden from the Help map, listeners off).
           mi-open-url is ALWAYS excluded — a publication must not gain a
           network-fetching entry point. */
        EXCLUDED_MENU_IDS: [
            "mi-open", "mi-open-url", "mi-meta", "mi-publish", "mi-pubmenu",
        ],
        EXCLUDED_HELP_ROWS: ["Open a file", "Import, export & strict HTML"],

        /* Upsert one <meta name="…" content="…"> into the replica head. */
        setMeta: function (root, name, content) {
            if (!content) return;
            var m = root.querySelector('meta[name="' + name + '"]');
            if (!m) {
                m = root.createElement("meta");
                m.setAttribute("name", name);
                root.querySelector("head").appendChild(m);
            }
            m.setAttribute("content", content);
        },

        /* The document payload replaces the sample embed. In files that
           are themselves publications the sample block is already gone —
           the previous payload script takes its place, so re-exporting
           from a published copy stays self-consistent. The anchored
           regexes can only match the tiny payload/flag scripts, never the
           app script (whose source merely MENTIONS these assignments). */
        swapEmbed: function (root, doc) {
            var host = root.getElementById("markdown-source");
            if (!host) {
                var scripts = root.querySelectorAll("script");
                for (var i = 0; i < scripts.length; i++) {
                    if (/^\s*window\.MDWB_EMBED\s*=/.test(scripts[i].textContent)) {
                        host = scripts[i];
                        break;
                    }
                }
            }
            var embed = root.createElement("script");
            /* Same containment as the standalone export: every "<" becomes
               "\u003c", so no payload byte can open a tag or a comment. */
            embed.textContent =
                "window.MDWB_EMBED = " + Source.embedPayload(doc.source);
            if (host) host.parentNode.replaceChild(embed, host);
            else root.body.insertBefore(embed, root.body.firstChild);
        },

        /* Remove the excluded menu items, then prune separators that would
           dangle at the menu's edges (a hairline with nothing on one side). */
        stripMenuItems: function (root) {
            Publication.EXCLUDED_MENU_IDS.forEach(function (id) {
                var n = root.getElementById(id);
                if (n) n.parentNode.removeChild(n);
            });
            var menu = root.getElementById("doc-menu");
            if (!menu) return;
            var seps = menu.querySelectorAll("hr.menu-sep");
            Array.prototype.forEach.call(seps, function (hr) {
                if (!hr.previousElementSibling || !hr.nextElementSibling)
                    hr.parentNode.removeChild(hr);
            });
        },

        /* Shortcut map: the removed Document rows disappear with them. */
        stripHelpRows: function (root) {
            var rows = root.querySelectorAll("#help-panel .help-row");
            Array.prototype.forEach.call(rows, function (row) {
                var label = row.querySelector("span");
                if (
                    label &&
                    Publication.EXCLUDED_HELP_ROWS.indexOf(
                        label.textContent.trim(),
                    ) !== -1
                )
                    row.parentNode.removeChild(row);
            });
        },

        /* The app's own <script> (contains the public API assignment). */
        findAppScript: function (root) {
            var scripts = root.querySelectorAll("script");
            for (var i = scripts.length - 1; i >= 0; i--) {
                var s = scripts[i];
                if (s.getAttribute("src")) continue;
                if (/MDWebbook\s*=/.test(s.textContent)) return s;
            }
            return null;
        },

        build: function (doc) {
            if (!doc || !App.bootHTML || typeof DOMParser === "undefined")
                return null;
            var pm = Meta.docMeta();
            /* Metadata mapping: explicit metadata wins; sensible defaults
               the app already defines (frontmatter/heading title, frontmatter
               author) are preserved; nothing is invented. */
            var title = pm.title || doc.meta.title || "Untitled";
            var author = pm.author || doc.meta.author || "";
            var desc = pm.description || "";
            var withMenu = Publication.includeMenu(doc.id);

            var root = new DOMParser().parseFromString(
                App.bootHTML,
                "text/html",
            );

            /* 1. The document rides inside the replica. */
            Publication.swapEmbed(root, doc);

            /* 2. Head metadata (explicit wins; nothing invented). */
            var t = root.querySelector("title");
            if (!t) {
                t = root.createElement("title");
                root.querySelector("head").appendChild(t);
            }
            t.textContent = title;
            Publication.setMeta(root, "author", author);
            Publication.setMeta(root, "description", desc);
            Publication.setMeta(
                root,
                "generator",
                "Markdown Webbook " + APP_VERSION,
            );

            /* 3. Authoring exceptions: menu items + shortcut rows, always. */
            Publication.stripMenuItems(root);
            Publication.stripHelpRows(root);

            /* 4. Conditional visibility — set explicitly both ways so a
               re-export from a published copy normalises the state. */
            var btnDocs = root.getElementById("btn-docs");
            var docMenu = root.getElementById("doc-menu");
            if (btnDocs) btnDocs.hidden = !withMenu;
            if (docMenu) docMenu.hidden = !withMenu;

            /* 5. The publication flag: the app's key listeners drop the
               removed shortcuts when this is present at boot. A stale flag
               from a previous publication pass is replaced, not stacked. */
            var stale = root.querySelectorAll("script");
            Array.prototype.forEach.call(stale, function (s) {
                if (/^\s*window\.MDWB_PUB\s*=/.test(s.textContent))
                    s.parentNode.removeChild(s);
            });
            var flag = root.createElement("script");
            flag.textContent =
                'window.MDWB_PUB = ' +
                JSON.stringify({ v: 1, menu: !!withMenu }) +
                ";";
            var appScript = Publication.findAppScript(root);
            if (appScript)
                appScript.parentNode.insertBefore(flag, appScript);
            else root.body.appendChild(flag);

            return (
                "<!doctype html>\n" + root.documentElement.outerHTML
            );
        },
    };


    /* ============================== Nav (R6) =============================== */

    var Nav = {
        headings: [],
        activeId: null,

        buildToC: function (headings) {
            this.headings = headings;
            var host = $("toc-content");
            host.innerHTML = "";

            if (!headings.length) {
                var p = document.createElement("p");
                p.className = "toc-empty";
                p.textContent =
                    "This document has no headings, so there is no outline to show.";
                host.appendChild(p);
                return;
            }

            var rootUl = document.createElement("ul");
            rootUl.className = "toc-list";
            host.appendChild(rootUl);

            var stack = [{ level: 0, ul: rootUl, li: null }];

            headings.forEach(function (h) {
                while (
                    stack.length > 1 &&
                    stack[stack.length - 1].level >= h.level
                ) {
                    stack.pop();
                }
                var parent = stack[stack.length - 1];
                var targetUl = parent.ul;

                if (h.level > parent.level && parent.li) {
                    var sub = parent.li.querySelector(
                        ":scope > ul",
                    );
                    if (!sub) {
                        sub = document.createElement("ul");
                        sub.className = "toc-list";
                        parent.li.appendChild(sub);
                    }
                    targetUl = sub;
                }

                var li = document.createElement("li");
                var a = document.createElement("a");
                a.className = "toc-link";
                a.href = "#" + h.id;
                a.textContent = h.text;
                a.dataset.target = h.id;
                li.appendChild(a);
                targetUl.appendChild(li);

                stack.push({ level: h.level, ul: targetUl, li: li });
            });
        },

        bind: function () {
            $("toc-content").addEventListener("click", function (e) {
                var link = e.target.closest("a.toc-link");
                if (!link) return;
                e.preventDefault();
                Nav.goTo(link.dataset.target || link.getAttribute("href"));
                if (isMobileWidth()) App.closeToc();
            });

            window.addEventListener(
                "scroll",
                function () {
                    Nav.onScroll();
                },
                { passive: true },
            );

            window.addEventListener("hashchange", function () {
                var id = decodeURIComponent(
                    window.location.hash.replace(/^#/, ""),
                );
                if (id && document.getElementById(id)) {
                    Nav.scrollToHeading(id);
                    Nav.setActive(id);
                }
            });

            /* Orientation changes / resizes shift heading geometry — the
               active-section highlight would drift without a re-measure.
               Fixed-position popovers would keep a stale anchor, so they
               close (they are pointer-dismissable anyway). */
            var reMeasure = function () {
                App.closePopovers();
                Nav.updateActive();
                Nav.updateChrome();
            };
            window.addEventListener("resize", reMeasure);
            window.addEventListener("orientationchange", reMeasure);

            var btnTop = $("btn-top");
            if (btnTop) btnTop.addEventListener("click", Nav.goTop);
        },

        goTo: function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            Nav.scrollToHeading(id);
            Nav.setActive(id);
            try {
                history.replaceState(null, "", "#" + encodeURIComponent(id));
            } catch (e) {
                /* Some browsers restrict the history API on file:// — the
                   scroll already happened, so a hash fallback is cosmetic. */
                try {
                    window.location.hash = "#" + id;
                } catch (e2) {}
            }
        },

        scrollToHeading: function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            var behavior = prefersReducedMotion() ? "auto" : "smooth";
            try {
                el.scrollIntoView({ behavior: behavior, block: "start" });
            } catch (e) {
                try {
                    window.scrollTo(0, el.offsetTop - HEADING_SCROLL_OFFSET);
                } catch (e2) {}
            }
        },

        setActive: function (id) {
            if (this.activeId === id) return;
            this.activeId = id;
            var links = $("toc-content").querySelectorAll("a.toc-link");
            Array.prototype.forEach.call(links, function (a) {
                var isActive = a.dataset.target === id;
                a.classList.toggle("active", isActive);
                if (isActive) a.setAttribute("aria-current", "true");
                else a.removeAttribute("aria-current");
            });
        },

        onScroll: function () {
            if (Nav._tick) return;
            Nav._tick = true;
            requestAnimationFrame(function () {
                Nav._tick = false;
                if (App.state !== "reading" || !Nav.headings.length) {
                    Nav.updateChrome();
                    return;
                }
                Nav.updateActive();
                Nav.saveScroll();
                Nav.updateChrome();
            });
        },

        /* Reading aids (R16): thin progress bar + back-to-top after two
           viewports. Both ride the existing rAF-batched scroll tick. */
        updateChrome: function () {
            var fill = document.getElementById("read-progress-fill");
            var top = $("btn-top");
            if (App.state !== "reading") {
                if (fill) fill.style.width = "0%";
                if (top) top.hidden = true;
                return;
            }
            var doc = document.documentElement;
            var maxScroll =
                Math.max(
                    doc.scrollHeight || 0,
                    document.body ? document.body.scrollHeight : 0,
                ) - (window.innerHeight || 0);
            var y = window.scrollY || window.pageYOffset || 0;
            var pct =
                maxScroll > 0
                    ? Math.min(100, Math.max(0, (y / maxScroll) * 100))
                    : 0;
            if (fill) fill.style.width = pct.toFixed(2) + "%";
            if (top) top.hidden = y < (window.innerHeight || 0) * 2;
        },

        goTop: function () {
            var behavior = prefersReducedMotion() ? "auto" : "smooth";
            try {
                window.scrollTo({ top: 0, behavior: behavior });
            } catch (e) {
                try {
                    window.scrollTo(0, 0);
                } catch (e2) {}
            }
        },

        updateActive: function () {
            var headings = Nav.headings;
            /* A document without headings has no scrollspy state to update
               — and reading headings[0] unguarded once crashed the load. */
            if (!headings.length) return;
            var scrollY = window.scrollY || window.pageYOffset || 0;
            var fromTop = scrollY + HEADING_SCROLL_OFFSET;
            var activeId = headings[0].id;

            for (var i = 0; i < headings.length; i++) {
                var el = document.getElementById(headings[i].id);
                if (!el) continue;
                var top =
                    el.getBoundingClientRect().top +
                    (window.scrollY || window.pageYOffset || 0);
                if (top <= fromTop) activeId = headings[i].id;
            }

            /* Bottom edge: mark the last section as active. */
            var doc = document.documentElement;
            var atBottom =
                window.innerHeight + scrollY >=
                Math.max(doc.scrollHeight, document.body.scrollHeight) - 4;
            if (atBottom) activeId = headings[headings.length - 1].id;

            Nav.setActive(activeId);
            var activeLink = $("toc-content").querySelector(
                'a.toc-link[data-target="' +
                    (activeId && activeId.replace(/"/g, '\\"')) +
                    '"]',
            );
            if (activeLink && isMobileWidth() === false) {
                try {
                    activeLink.scrollIntoView({ block: "nearest" });
                } catch (e) {}
            }
        },

        restoreScroll: function () {
            /* Render-triggering setting changes (Raw HTML) pin the exact
               live position: the hash branch would yank the reader back to
               the last TOC/permalink anchor, and the sessionStorage value
               can be up to 400 ms stale. Consume-once, restored immediately
               and again after two frames (post-layout settle). */
            if (App._keepScrollY != null) {
                var pinned = App._keepScrollY;
                App._keepScrollY = null;
                var pin = function () {
                    try {
                        window.scrollTo(0, pinned);
                    } catch (e) {}
                };
                pin();
                raf2(pin);
                return;
            }
            var hash = decodeURIComponent(
                window.location.hash.replace(/^#/, ""),
            );
            if (hash && document.getElementById(hash)) {
                raf2(function () {
                    Nav.scrollToHeading(hash);
                    Nav.setActive(hash);
                });
                return;
            }
            var saved = Nav.readScroll(App.current && App.current.id);
            if (saved) {
                raf2(function () {
                    try {
                        window.scrollTo(0, saved);
                    } catch (e) {}
                });
            }
        },

        readScroll: function (docId) {
            if (!docId) return 0;
            try {
                return (
                    parseInt(
                        sessionStorage.getItem(LS_PREFIX + "scroll:" + docId),
                        10,
                    ) || 0
                );
            } catch (e) {
                return 0;
            }
        },

        saveScroll: function () {
            if (!App.current) return;
            var now = Date.now();
            if (Nav._lastSave && now - Nav._lastSave < 400) return;
            Nav._lastSave = now;
            try {
                sessionStorage.setItem(
                    LS_PREFIX + "scroll:" + App.current.id,
                    String(window.scrollY || 0),
                );
            } catch (e) {}
        },

        /* Unthrottled variant for render-triggering setting changes: the
           persisted position must match the pinned one exactly. */
        saveScrollNow: function () {
            Nav._lastSave = Date.now();
            if (!App.current) return;
            try {
                sessionStorage.setItem(
                    LS_PREFIX + "scroll:" + App.current.id,
                    String(window.scrollY || 0),
                );
            } catch (e) {}
        },
    };

    /* ============================== Find (R13) ============================= */
    /* Find-in-page: highlight every match, step through with next/prev,
       restore the pristine DOM on close. A snapshot of the rendered content
       is taken lazily on first search and dropped whenever the document
       changes. Matches are capped to keep huge documents responsive. */

    var Find = {
        MAX_MATCHES: 2000,

        isOpen: false,
        pristine: null,
        marks: [],
        index: -1,

        init: function () {
            Find.input = $("find-input");
            Find.countEl = $("find-count");
            Find.bar = $("findbar");

            $("btn-search").addEventListener("click", function () {
                if (Find.isOpen) Find.close();
                else Find.show();
            });
            $("find-close").addEventListener("click", function () {
                Find.close();
            });
            $("find-next").addEventListener("click", function () {
                Find.step(1);
            });
            $("find-prev").addEventListener("click", function () {
                Find.step(-1);
            });

            var debounce = null;
            Find.input.addEventListener("input", function () {
                clearTimeout(debounce);
                debounce = setTimeout(function () {
                    Find.run(Find.input.value);
                }, 180);
            });
            Find.input.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    Find.step(e.shiftKey ? -1 : 1);
                }
            });
        },

        show: function () {
            if (App.state !== "reading") return;
            Lightbox.close();
            App.closePopovers();
            Palette.close();
            /* The search layer and the contents drawer are mutually
               exclusive (1.8.0): opening one dismisses the other. */
            if (App.dom.tocSidebar.classList.contains("open"))
                App.closeToc();
            Find.isOpen = true;
            Find.bar.setAttribute("data-open", "on");
            document.documentElement.setAttribute("data-find", "on");
            var btn = App.dom && App.dom.btnSearch;
            if (btn) btn.classList.add("active");
            Find.input.focus();
            Find.input.select();
            if (Find.input.value) Find.run(Find.input.value);
            else Find.setCount("");
        },

        close: function () {
            Find.isOpen = false;
            /* Always restore, even if the search was driven programmatically
               and never "opened" through the UI. */
            Find.reset();
            Find.pristine = null;
            Find.bar.setAttribute("data-open", "off");
            document.documentElement.removeAttribute("data-find");
            var btn = App.dom && App.dom.btnSearch;
            if (btn) btn.classList.remove("active");
            Find.setCount("");
            if (btn && !btn.disabled) btn.focus();
        },

        run: function (q) {
            q = String(q == null ? (Find.input ? Find.input.value : "") : q);
            if (!App.current || !App.dom) return { count: 0 };
            if (Find.pristine === null)
                Find.pristine = App.dom.content.innerHTML;
            Find.reset();
            var n = q ? Find.markAll(q) : 0;
            if (n) {
                Find.index = 0;
                Find.marks[0].classList.add("find-hl-current");
                Find.setCount("1/" + n);
            } else {
                Find.setCount(q ? "No matches" : "");
            }
            return { count: n };
        },

        step: function (dir) {
            if (!Find.marks.length) {
                Find.run();
                if (!Find.marks.length) return;
            }
            var n = Find.marks.length;
            var next = (Find.index + dir + n) % n;
            if (Find.index >= 0)
                Find.marks[Find.index].classList.remove("find-hl-current");
            Find.index = next;
            var el = Find.marks[next];
            el.classList.add("find-hl-current");
            Find.setCount(next + 1 + "/" + n);
            try {
                el.scrollIntoView({ block: "center", behavior: "auto" });
            } catch (e) {}
        },

        markAll: function (q) {
            var ql = q.toLowerCase();
            if (!ql) return 0;
            var content = App.dom.content;
            var walker = document.createTreeWalker(
                content,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function (node) {
                        if (!node.nodeValue || !node.nodeValue.trim())
                            return NodeFilter.FILTER_REJECT;
                        var p = node.parentNode;
                        while (p && p !== content) {
                            var tag = p.nodeName;
                            if (
                                tag === "SCRIPT" ||
                                tag === "STYLE" ||
                                tag === "MARK"
                            )
                                return NodeFilter.FILTER_REJECT;
                            p = p.parentNode;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    },
                },
            );
            var nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);

            var count = 0;
            for (var i = 0; i < nodes.length && count < Find.MAX_MATCHES; i++) {
                var node = nodes[i];
                var text = node.nodeValue;
                var lower = text.toLowerCase();
                if (lower.indexOf(ql) === -1) continue;
                var frag = document.createDocumentFragment();
                var pos = 0;
                var hit;
                while (
                    (hit = lower.indexOf(ql, pos)) !== -1 &&
                    count < Find.MAX_MATCHES
                ) {
                    if (hit > pos)
                        frag.appendChild(
                            document.createTextNode(text.slice(pos, hit)),
                        );
                    var mark = document.createElement("mark");
                    mark.className = "find-hl";
                    mark.textContent = text.slice(hit, hit + q.length);
                    frag.appendChild(mark);
                    Find.marks.push(mark);
                    count++;
                    pos = hit + q.length;
                }
                if (pos < text.length)
                    frag.appendChild(document.createTextNode(text.slice(pos)));
                node.parentNode.replaceChild(frag, node);
            }
            return count;
        },

        /* Remove all highlight marks by restoring the pristine snapshot. */
        reset: function () {
            if (Find.pristine !== null && App.dom && App.dom.content)
                App.dom.content.innerHTML = Find.pristine;
            Find.marks = [];
            Find.index = -1;
        },

        clear: function () {
            Find.reset();
            Find.pristine = null;
            Find.setCount("");
        },

        setCount: function (s) {
            if (Find.countEl) Find.countEl.textContent = s;
        },

        /* New document loaded while the search layer is open: drop state and
           hide it — the snapshot no longer matches the DOM. */
        invalidate: function () {
            Find.pristine = null;
            Find.marks = [];
            Find.index = -1;
            if (Find.isOpen) {
                Find.isOpen = false;
                Find.bar.setAttribute("data-open", "off");
                document.documentElement.removeAttribute("data-find");
                if (App.dom && App.dom.btnSearch)
                    App.dom.btnSearch.classList.remove("active");
            }
        },

        state: function () {
            return { open: Find.isOpen, count: Find.marks.length, index: Find.index };
        },
    };

    /* ========================= Palette (R17) =============================== */
    /* Keyboard-first command palette: Ctrl/Cmd+K. Lists commands and the
       current document's sections; filters as you type; arrows + Enter
       execute. */

    var Palette = {
        MAX_ITEMS: 40,
        open: false,
        opener: null,
        filtered: [],
        sel: 0,

        ICON_SECTION:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
        ICON_CMD:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline><polyline points="15 18 21 12 15 6"></polyline></svg>',

        init: function () {
            Palette.backdrop = $("palette-backdrop");
            Palette.panel = Palette.backdrop.querySelector(".palette");
            Palette.input = $("palette-input");
            Palette.list = $("palette-list");

            Palette.backdrop.addEventListener("pointerdown", function (e) {
                if (e.target === Palette.backdrop) Palette.close(true);
            });
            Palette.input.addEventListener("input", function () {
                Palette.buildList(Palette.input.value);
            });
            Palette.input.addEventListener("keydown", function (e) {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    Palette.move(1);
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    Palette.move(-1);
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    Palette.execute(Palette.filtered[Palette.sel]);
                }
            });
            Palette.list.addEventListener("click", function (e) {
                var li = e.target.closest(".palette-item");
                if (!li) return;
                Palette.execute(Palette.filtered[Number(li.dataset.idx)]);
            });
        },

        /* The command set adapts to state: export commands exist only while
           a document is open. */
        commands: function () {
            var cmds = [
                {
                    group: "Commands",
                    label: "Toggle table of contents",
                    hint: "T",
                    run: function () {
                        App.toggleToc();
                    },
                },
                {
                    group: "Commands",
                    label: "Search document",
                    hint: "/",
                    run: function () {
                        Find.show();
                    },
                },
                {
                    group: "Commands",
                    label: "Reading settings",
                    run: function () {
                        App.toggleAa();
                    },
                },
                {
                    group: "Commands",
                    label: "Import a Markdown file…",
                    hint: "Ctrl O",
                    run: function () {
                        App.dom.fileInput.click();
                    },
                },
                {
                    group: "Commands",
                    label: "Toggle light / dark theme",
                    run: function () {
                        var cur = Settings.resolvedTheme();
                        Settings.set("theme", cur === "dark" ? "light" : "dark");
                        App.syncSettingsUi();
                    },
                },
                {
                    group: "Commands",
                    label: "Keyboard shortcuts",
                    hint: "?",
                    run: function () {
                        Help.openHelp();
                    },
                },
                {
                    group: "Commands",
                    label: "Back to top",
                    run: function () {
                        Nav.goTop();
                    },
                },
            ];
            if (App.current) {
                cmds.push(
                    {
                        group: "Commands",
                        label: "Copy Markdown",
                        run: function () {
                            Exporter.copyText(App.current.source, "Markdown copied");
                        },
                    },
                    {
                        group: "Commands",
                        label: "Copy rendered text",
                        run: function () {
                            Exporter.copyText(
                                Exporter.renderedText(),
                                "Rendered text copied",
                            );
                        },
                    },
                    {
                        group: "Commands",
                        label: Exporter.downloadLabel(),
                        run: function () {
                            Exporter.download();
                        },
                    },
                    {
                        group: "Commands",
                        label: "Export standalone HTML",
                        run: function () {
                            Exporter.exportHTML();
                        },
                    },
                    {
                        group: "Commands",
                        label: "Export publishable HTML",
                        run: function () {
                            Exporter.exportPublication();
                        },
                    },
                    {
                        group: "Commands",
                        label: "Edit HTML metadata",
                        run: function () {
                            Meta.openEditor();
                        },
                    },
                    {
                        group: "Commands",
                        label: "Print / save as PDF",
                        run: function () {
                            Exporter.printDoc();
                        },
                    },
                );
            }
            return cmds;
        },

        items: function () {
            var items = Palette.commands();

            if (App.state === "reading" && Nav.headings.length) {
                Nav.headings.slice(0, 60).forEach(function (h) {
                    items.push({
                        group: "Sections",
                        label: h.text,
                        level: h.level,
                        id: h.id,
                        icon: Palette.ICON_SECTION,
                        run: function () {
                            Nav.goTo(h.id);
                        },
                    });
                });
            }
            return items;
        },

        score: function (item, q) {
            if (!q) return 1;
            var label = item.label.toLowerCase();
            var idx = label.indexOf(q);
            if (idx === 0) return 100;
            if (idx > 0) {
                if (/[\s/:]/.test(label.charAt(idx - 1))) return 80;
                return 60;
            }
            /* Subsequence fallback */
            var li = 0;
            for (var i = 0; i < q.length; i++) {
                li = label.indexOf(q.charAt(i), li);
                if (li === -1) return 0;
                li++;
            }
            return 10;
        },

        buildList: function (q) {
            q = String(q || "").trim().toLowerCase();
            var all = Palette.items();
            Palette.filtered = all
                .map(function (it) {
                    return { it: it, s: Palette.score(it, q) };
                })
                .filter(function (r) {
                    return r.s > 0;
                })
                .sort(function (a, b) {
                    return b.s - a.s;
                })
                .slice(0, Palette.MAX_ITEMS)
                .map(function (r) {
                    return r.it;
                });
            Palette.sel = 0;

            Palette.list.innerHTML = "";
            if (!Palette.filtered.length) {
                var empty = document.createElement("li");
                empty.className = "palette-empty";
                empty.textContent = q
                    ? "Nothing matches \u201c" + q + "\u201d"
                    : "No commands available";
                Palette.list.appendChild(empty);
                Palette.input.setAttribute("aria-activedescendant", "");
                return;
            }

            var lastGroup = null;
            Palette.filtered.forEach(function (item, i) {
                if (item.group !== lastGroup) {
                    lastGroup = item.group;
                    var g = document.createElement("li");
                    g.className = "palette-group";
                    g.textContent = item.group;
                    Palette.list.appendChild(g);
                }
                var li = document.createElement("li");
                li.className = "palette-item";
                li.setAttribute("role", "option");
                li.id = "pi-" + i;
                li.dataset.idx = String(i);
                li.setAttribute(
                    "aria-selected",
                    i === Palette.sel ? "true" : "false",
                );
                li.insertAdjacentHTML("beforeend", item.icon || Palette.ICON_CMD);
                var lab = document.createElement("span");
                lab.className = "p-label";
                lab.textContent = item.label;
                if (item.level)
                    lab.style.marginLeft = (item.level - 1) * 12 + "px";
                li.appendChild(lab);
                if (item.hint) {
                    var hint = document.createElement("span");
                    hint.className = "p-hint kbd";
                    hint.textContent = item.hint;
                    li.appendChild(hint);
                }
                Palette.list.appendChild(li);
            });

            Palette.input.setAttribute("aria-activedescendant", "pi-0");
        },

        move: function (dir) {
            if (!Palette.filtered.length) return;
            var n = Palette.filtered.length;
            Palette.sel = (Palette.sel + dir + n) % n;
            Array.prototype.forEach.call(
                Palette.list.querySelectorAll(".palette-item"),
                function (li, i) {
                    li.setAttribute(
                        "aria-selected",
                        i === Palette.sel ? "true" : "false",
                    );
                },
            );
            var active = Palette.list.querySelector(
                '#pi-' + Palette.sel,
            );
            if (active) {
                try {
                    active.scrollIntoView({ block: "nearest" });
                } catch (e) {}
                Palette.input.setAttribute(
                    "aria-activedescendant",
                    active.id,
                );
            }
        },

        openPalette: function () {
            if (Palette.open) return;
            Lightbox.close();
            App.closePopovers();
            Find.close();
            Palette.opener = document.activeElement;
            Palette.open = true;
            Palette.backdrop.hidden = false;
            Palette.input.value = "";
            Palette.buildList("");
            Palette.input.focus();
        },

        close: function (refocus) {
            if (!Palette.open) return;
            Palette.open = false;
            Palette.backdrop.hidden = true;
            if (refocus && Palette.opener && Palette.opener.focus) {
                try {
                    Palette.opener.focus();
                } catch (e) {}
            }
            Palette.opener = null;
        },

        execute: function (item) {
            if (!item || typeof item.run !== "function") return;
            Palette.close(false);
            item.run();
        },

        state: function () {
            return {
                open: Palette.open,
                count: Palette.filtered.length,
            };
        },
    };

    /* ====================== Shortcut overlay (R19) ========================= */

    var Help = {
        open: false,
        opener: null,

        init: function () {
            Help.backdrop = $("help-backdrop");
            Help.panel = $("help-panel");
            Help.backdrop.addEventListener("pointerdown", function (e) {
                if (e.target === Help.backdrop) Help.close();
            });
            $("help-close").addEventListener("click", function () {
                Help.close();
            });
        },

        openHelp: function () {
            if (Help.open) return;
            App.closePopovers();
            Help.opener = document.activeElement;
            Help.open = true;
            Help.backdrop.hidden = false;
            var first = Help.panel.querySelector("button");
            if (first) first.focus();
        },

        close: function () {
            if (!Help.open) return;
            Help.open = false;
            Help.backdrop.hidden = true;
            if (Help.opener && Help.opener.focus) {
                try {
                    Help.opener.focus();
                } catch (e) {}
            }
            Help.opener = null;
        },

        toggle: function () {
            if (Help.open) Help.close();
            else Help.openHelp();
        },

        state: function () {
            return { open: Help.open };
        },
    };

    /* ================= HTML metadata editor (publication) ==================
       A compact dialog for the <head> metadata of the publishable export:
       title, author, description. Values are document state — persisted per
       document via DocPref — and never touch the Markdown source. Empty
       fields fall back to values the app already knows (frontmatter title /
       author, first heading), so nothing is ever invented. */

    var Meta = {
        open: false,
        opener: null,
        FIELDS: ["title", "author", "description"],

        init: function () {
            Meta.backdrop = $("meta-backdrop");
            Meta.panel = $("meta-panel");
            Meta.inputs = {
                title: $("mf-title"),
                author: $("mf-author"),
                description: $("mf-desc"),
            };
            Meta.backdrop.addEventListener("pointerdown", function (e) {
                if (e.target === Meta.backdrop) Meta.close();
            });
            $("meta-close").addEventListener("click", function () {
                Meta.close();
            });
            $("meta-cancel").addEventListener("click", function () {
                Meta.close();
            });
            $("meta-form").addEventListener("submit", function (e) {
                e.preventDefault();
                Meta.save();
            });
            /* iOS-style grouped rows: the Description editor is a plain-text
               contenteditable div, so paste is reduced to text/plain and
               the row label focuses it (a div is not labelable). */
            Meta.inputs.description.addEventListener("paste", function (e) {
                e.preventDefault();
                var text = "";
                try {
                    text =
                        (e.clipboardData || window.clipboardData).getData(
                            "text/plain",
                        ) || "";
                } catch (err) {}
                try {
                    document.execCommand("insertText", false, text);
                } catch (err) {
                    Meta.inputs.description.textContent += text;
                }
            });
            var descLabel = document.querySelector('label[for="mf-desc"]');
            if (descLabel)
                descLabel.addEventListener("click", function () {
                    Meta.inputs.description.focus();
                });
        },

        /* Effective metadata for the current document: explicit entries win,
           absent ones simply stay absent (the publication renderer applies
           the fallback chain). */
        docMeta: function () {
            return (App.current && DocPref.get(App.current.id, "meta", null)) || {};
        },

        openEditor: function () {
            if (!App.current || Meta.open) return;
            App.closePopovers();
            Meta.opener = document.activeElement;
            Meta.open = true;
            Meta.sync();
            Meta.backdrop.hidden = false;
            Meta.inputs.title.focus();
            Meta.inputs.title.select();
        },

        sync: function () {
            var m = Meta.docMeta();
            Meta.FIELDS.forEach(function (k) {
                var el = Meta.inputs[k];
                var v = m[k] || "";
                /* Description is the contenteditable div; the rest are
                   classic inputs. */
                if (k === "description") el.textContent = v;
                else el.value = v;
            });
            /* Placeholders show the fallback the export would use. */
            Meta.inputs.title.placeholder = App.current
                ? App.current.meta.title
                : "";
            Meta.inputs.author.placeholder = (App.current && App.current.meta.author) || "";
        },

        save: function () {
            if (!App.current) {
                Meta.close();
                return;
            }
            var out = {};
            Meta.FIELDS.forEach(function (k) {
                var el = Meta.inputs[k];
                var v = String(
                    k === "description" ? el.textContent : el.value,
                )
                    .trim()
                    .slice(0, 300);
                if (v) out[k] = v;
            });
            DocPref.set(App.current.id, "meta", out);
            Meta.close();
            UI.toast("Metadata saved");
        },

        close: function () {
            if (!Meta.open) return;
            Meta.open = false;
            Meta.backdrop.hidden = true;
            if (Meta.opener && Meta.opener.focus) {
                try {
                    Meta.opener.focus();
                } catch (e) {}
            }
            Meta.opener = null;
        },

        state: function () {
            return { open: Meta.open };
        },
    };

    /* ==================== Open from url (1.8.0) ============================
       Fetch a Markdown file (.md, .markdown, .mdx) straight from a web
       address. The dialog reuses the meta-panel shell — same 520px width,
       pinned header, inset card and 50/50 footer — with one label-less,
       left-aligned, single-line url field. The Open button owns the loading
       state (disabled + spinner while the fetch is in flight); failures
       re-enable the form and surface a toast, successes close silently and
       render. Fetches are strictly user-initiated: the app performs no
       network activity of its own. */

    var OpenUrl = {
        open: false,
        busy: false,
        opener: null,
        EXTS: ["md", "markdown", "mdx"],

        init: function () {
            OpenUrl.backdrop = $("openurl-backdrop");
            OpenUrl.panel = $("openurl-panel");
            OpenUrl.input = $("mfu-url");
            OpenUrl.openBtn = $("openurl-open");
            OpenUrl.backdrop.addEventListener("pointerdown", function (e) {
                if (e.target === OpenUrl.backdrop && !OpenUrl.busy)
                    OpenUrl.close();
            });
            $("openurl-close").addEventListener("click", function () {
                if (!OpenUrl.busy) OpenUrl.close();
            });
            $("openurl-cancel").addEventListener("click", function () {
                if (!OpenUrl.busy) OpenUrl.close();
            });
            $("openurl-form").addEventListener("submit", function (e) {
                e.preventDefault();
                if (!OpenUrl.busy) OpenUrl.fetch();
            });
        },

        openEditor: function () {
            if (OpenUrl.open || OpenUrl.busy) return;
            App.closePopovers();
            OpenUrl.opener = document.activeElement;
            OpenUrl.open = true;
            OpenUrl.input.value = "";
            OpenUrl.setBusy(false);
            OpenUrl.backdrop.hidden = false;
            OpenUrl.input.focus();
        },

        close: function () {
            if (!OpenUrl.open) return;
            OpenUrl.open = false;
            OpenUrl.backdrop.hidden = true;
            OpenUrl.setBusy(false);
            if (OpenUrl.opener && OpenUrl.opener.focus) {
                try {
                    OpenUrl.opener.focus();
                } catch (e) {}
            }
            OpenUrl.opener = null;
        },

        setBusy: function (on) {
            OpenUrl.busy = on;
            OpenUrl.openBtn.classList.toggle("is-loading", on);
            OpenUrl.openBtn.disabled = on;
            if (on) OpenUrl.openBtn.setAttribute("aria-busy", "true");
            else OpenUrl.openBtn.removeAttribute("aria-busy");
        },

        /* Validate the address: http(s) only, and — when the path carries a
           recognisable extension — one of the supported Markdown formats.
           Extension-less addresses are allowed (servers decide content). */
        parse: function (raw) {
            var v = String(raw == null ? "" : raw).trim();
            if (!v)
                return {
                    error: "Enter a url to open a Markdown file from the web",
                };
            var u = null;
            try {
                u = new URL(v);
            } catch (e) {
                u = null;
            }
            if (!u || (u.protocol !== "http:" && u.protocol !== "https:"))
                return { error: "Enter a valid http(s) url" };
            var m = /\.([a-z0-9]+)$/i.exec(u.pathname);
            if (
                m &&
                OpenUrl.EXTS.indexOf(m[1].toLowerCase()) === -1
            )
                return {
                    error:
                        "Unsupported file type (." +
                        m[1].toLowerCase() +
                        ") — use .md, .markdown or .mdx",
                };
            return { url: u.href };
        },

        /* Derive import provenance from the address: the decoded basename
           keeps a supported extension, extension-less paths gain ".md". */
        fileMeta: function (href) {
            var name = null;
            var ext = null;
            try {
                var u = new URL(href);
                var raw = (u.pathname.split("/").pop() || "").trim();
                var base = raw;
                try {
                    base = decodeURIComponent(raw);
                } catch (e) {}
                if (base) {
                    var m = /\.([a-z0-9]+)$/i.exec(base);
                    if (
                        m &&
                        OpenUrl.EXTS.indexOf(m[1].toLowerCase()) !== -1
                    ) {
                        ext = m[1].toLowerCase();
                        name = base;
                    } else if (!m) {
                        ext = "md";
                        name = base + ".md";
                    }
                }
            } catch (e) {}
            return { name: name, ext: ext };
        },

        fetch: function () {
            if (!OpenUrl.open || OpenUrl.busy) return;
            var parsed = OpenUrl.parse(OpenUrl.input.value);
            if (parsed.error) {
                UI.toast(parsed.error, true);
                return;
            }
            var doFetch = window.fetch || null;
            if (!doFetch) {
                UI.toast(
                    "Fetching isn't available in this browser",
                    true,
                );
                return;
            }
            OpenUrl.setBusy(true);
            var fail = function (msg) {
                OpenUrl.setBusy(false);
                UI.toast(msg, true);
            };
            var netFail = function () {
                fail("Couldn't reach that url — check it and your connection");
            };
            var p;
            try {
                p = doFetch(parsed.url, { credentials: "omit" });
            } catch (e) {
                netFail();
                return;
            }
            Promise.resolve(p)
                .then(function (res) {
                    if (!res.ok) {
                        fail(
                            "Couldn't load the file — the server returned " +
                                res.status +
                                (res.statusText
                                    ? " (" + res.statusText + ")"
                                    : ""),
                        );
                        return null;
                    }
                    var type =
                        res.headers && res.headers.get
                            ? res.headers.get("content-type") || ""
                            : "";
                    return res
                        .text()
                        .then(function (text) {
                            return { text: text, type: type };
                        });
                })
                .then(function (got) {
                    if (got === null) return; /* already toasted */
                    var text = String(got.text == null ? "" : got.text);
                    if (!text.trim()) {
                        fail("That url returned an empty file");
                        return;
                    }
                    if (
                        /text\/html/i.test(got.type) &&
                        /^\s*(<!doctype|<html)/i.test(text)
                    ) {
                        fail(
                            "That url returned an HTML page, not a Markdown file",
                        );
                        return;
                    }
                    if (text.indexOf("\u0000") !== -1) {
                        fail("That looks like a binary file, not Markdown");
                        return;
                    }
                    OpenUrl.setBusy(false);
                    OpenUrl.close();
                    App.pendingFile = OpenUrl.fileMeta(parsed.url);
                    App.loadDocument(text, "url");
                })
                .catch(function () {
                    netFail();
                });
        },

        state: function () {
            return { open: OpenUrl.open, busy: OpenUrl.busy };
        },
    };

    /* ==================== Image lightbox (M5, Proposal A) ==================
       Click any content image to read it at full size; Esc, a click or the
       close button dismisses it. Images inside links (badges) never zoom —
       the link wins. The overlay re-uses the image URL that is already
       rendered, so it works offline on file:// with zero new fetches. */

    var Lightbox = {
        open: false,
        opener: null,

        init: function () {
            Lightbox.el = $("lightbox");
            Lightbox.img = $("lightbox-img");
            Lightbox.cap = $("lightbox-cap");
            Lightbox.el.addEventListener("click", function () {
                Lightbox.close();
            });
        },

        openFor: function (sourceImg) {
            if (Lightbox.open || !sourceImg || !sourceImg.src) return;
            Lightbox.opener = document.activeElement;
            Lightbox.img.src = sourceImg.src;
            var alt = (sourceImg.getAttribute("alt") || "").trim();
            if (alt) {
                Lightbox.cap.textContent = alt;
                Lightbox.cap.hidden = false;
            } else {
                Lightbox.cap.textContent = "";
                Lightbox.cap.hidden = true;
            }
            Lightbox.el.hidden = false;
            document.documentElement.setAttribute("data-lightbox", "on");
            Lightbox.open = true;
            var btn = $("lightbox-close");
            if (btn) btn.focus();
        },

        close: function () {
            if (!Lightbox.open) return;
            Lightbox.open = false;
            Lightbox.el.hidden = true;
            document.documentElement.removeAttribute("data-lightbox");
            /* Drop the src so an in-flight large image stops decoding. */
            Lightbox.img.removeAttribute("src");
            var op = Lightbox.opener;
            Lightbox.opener = null;
            if (op && op.focus) {
                try {
                    op.focus();
                } catch (e) {}
            }
        },

        state: function () {
            return { open: Lightbox.open };
        },
    };

    /* =============================== UI (R5, R7) =========================== */

    var UI = {
        toast: function (msg, isError) {
            var t = $("toast");
            t.textContent = msg;
            t.classList.toggle("is-error", !!isError);
            t.classList.add("show");
            clearTimeout(UI._toastTimer);
            UI._toastTimer = setTimeout(function () {
                t.classList.remove("show");
            }, 2200);
        },

        showLoading: function () {
            $("progress").hidden = false;
        },

        hideLoading: function () {
            $("progress").hidden = true;
        },

        showDrop: function () {
            $("drop-overlay").hidden = false;
        },

        hideDrop: function () {
            $("drop-overlay").hidden = true;
        },
    };

    /* ================================ App ================================== */

    var App = {
        state: "booting", /* booting | empty | loading | reading | error */
        current: null,
        pendingFile: null,
        persistFailed: false,

        cacheDom: function () {
            App.dom = {
                content: $("content"),
                empty: $("empty-state"),
                fatal: $("fatal"),
                fatalMsg: $("fatal-msg"),
                headerTitle: $("header-title"),
                footerTitle: $("footer-title"),
                footerSep: $("footer-sep"),
                btnToc: $("btn-toc"),
                btnDocs: $("btn-docs"),
                btnOpenEmpty: $("btn-open-empty"),
                fileInput: $("file-input"),
                btnSearch: $("btn-search"),
                btnAa: $("btn-aa"),
                btnMore: $("btn-more"),
                aaPopover: $("aa-popover"),
                docMenu: $("doc-menu"),
                moreMenu: $("more-menu"),
                scrim: $("scrim"),
                tocSidebar: $("toc-sidebar"),
            };
        },

        boot: function () {
            try {
                /* First thing, before any mutation: snapshot the pristine
                   page — the standalone-HTML export is rebuilt from it. */
                App.captureBootHTML();
                App.cacheDom();
                App.bindChrome();
                Nav.bind();
                Settings.load();
                Settings.applyAll();
                Settings.watchSystem();
                App.syncSettingsUi();
                Find.init();
                Palette.init();
                Help.init();
                Meta.init();
                OpenUrl.init();
                Lightbox.init();
                App.purgeLegacyStrictPrefs();
                Source.loadLast();

                var embedded = App.readEmbedded();
                if (embedded) {
                    App.loadDocument(embedded, "embedded");
                } else if (Source.last && Source.last.source) {
                    /* Restored docs keep their import provenance so the
                       extension-aware Download label survives a refresh. */
                    App.pendingFile = Source.last.fileExt
                        ? {
                              name: Source.last.fileName || null,
                              ext: Source.last.fileExt,
                          }
                        : null;
                    App.loadDocument(Source.last.source, "restored");
                } else {
                    App.showEmpty();
                }
            } catch (err) {
                App.showFatal(err);
            }
        },

        captureBootHTML: function () {
            try {
                App.bootHTML =
                    "<!doctype html>\n" +
                    document.documentElement.outerHTML;
            } catch (e) {
                App.bootHTML = null;
            }
        },

        readEmbedded: function () {
            /* R14 JSON embed (export path) — checked first. */
            if (
                window.MDWB_EMBED &&
                typeof window.MDWB_EMBED.source === "string" &&
                window.MDWB_EMBED.source.trim()
            ) {
                return window.MDWB_EMBED.source;
            }
            var src = $("markdown-source");
            if (src) {
                var t = (src.textContent || "").trim();
                if (t) return t;
            }
            /* Legacy two-block embedding */
            var contentEl = $("markdown-content");
            if (contentEl) {
                var c = (contentEl.textContent || "").trim();
                if (c) {
                    var titleEl = $("markdown-title");
                    var title = titleEl
                        ? (titleEl.textContent || "").trim()
                        : "";
                    if (title) c = "---\ntitle: " + title + "\n---\n\n" + c;
                    return c;
                }
            }
            return null;
        },

        /* -------------------- document lifecycle (R3, R4) ------------------ */

        loadDocument: function (source, origin) {
            if (
                !App._skipConfirm &&
                App.current &&
                App.current.persisted === false &&
                App.current.origin !== "embedded"
            ) {
                var proceed = window.confirm(
                    "Replace the current document? It could not be saved on this device and will be lost.",
                );
                if (!proceed) return;
            }
            App._skipConfirm = false;

            App.persistFailed = false;
            App.state = "loading";
            App.closePopovers();
            Palette.close();
            Find.invalidate();

            if (source.length > HEAVY_DOC_CHARS) {
                UI.showLoading();
                setTimeout(function () {
                    App.doLoad(source, origin);
                }, 30);
            } else {
                App.doLoad(source, origin);
            }
        },

        doLoad: function (source, origin) {
            try {
                var split = Parser.splitFrontmatter(source);
                var docId = djb2(source);
                /* Raw HTML handling is a reading setting (Aa popover, R20).
                   The former per-document doc-menu override was removed —
                   global setting only. */
                var strictHtml = Settings.get("rawHtml");
                var html = Parser.render(split.body, strictHtml);

                App.dom.content.innerHTML = html;
                /* Pin too-wide tables to their scrollable width now that
                   the content is live (see Enhancer.settleTables). */
                Enhancer.settleTables(App.dom.content);
                var headings = Enhancer.collect(App.dom.content);
                var meta = App.resolveMeta(split.meta, headings);

                var doc = {
                    source: source,
                    meta: meta,
                    id: docId,
                    origin: origin,
                    headings: headings,
                    strictHtml: strictHtml,
                    persisted: origin === "embedded",
                    /* Import provenance (1.8.0): the original file name and
                       extension when the document arrived from a file or a
                       url — null for embedded/restored-without-provenance. */
                    fileName: App.pendingFile ? App.pendingFile.name : null,
                    fileExt: App.pendingFile ? App.pendingFile.ext : null,
                };
                App.pendingFile = null;
                App.current = doc;

                App.applyDoc(doc);
                /* Persisted task ticks re-apply after every render, so a
                   strict-HTML toggle or reload never loses them (M1 1.3). */
                App.applyTaskStates(doc);

                if (doc.origin !== "embedded") {
                    doc.persisted = Source.saveDoc(doc);
                    if (!doc.persisted) {
                        App.persistFailed = true;
                        UI.toast(
                            "Couldn't save locally — a refresh may lose this document",
                            true,
                        );
                    }
                }

                UI.hideLoading();
                App.state = "reading";
                App.syncToolbar();
                App.syncDownloadLabel();

                if (origin === "restored")
                    UI.toast('Restored "' + meta.title + '"');
                else if (origin === "imported" || origin === "pasted")
                    UI.toast('Opened "' + meta.title + '"');
                /* origin "url" stays silent by design: the dialog closing is
                   the success signal (1.8.0). */
            } catch (err) {
                UI.hideLoading();
                App.showFatal(err);
            }
        },

        resolveMeta: function (fmMeta, headings) {
            var meta = {
                title: "",
                author: "",
                date: "",
                lang: "",
            };
            ["title", "author", "date", "lang"].forEach(function (k) {
                if (fmMeta && fmMeta[k]) meta[k] = String(fmMeta[k]).slice(0, 200);
            });

            if (!meta.title) {
                for (var i = 0; i < headings.length; i++) {
                    if (headings[i].level === 1) {
                        meta.title = headings[i].text;
                        break;
                    }
                }
            }
            meta.title = meta.title
                ? meta.title.slice(0, 80)
                : "Untitled";
            return meta;
        },

        applyDoc: function (doc) {
            document.title = doc.meta.title;
            App.dom.headerTitle.textContent = doc.meta.title;
            App.dom.footerTitle.textContent = doc.meta.title;
            App.dom.footerTitle.hidden = false;
            App.dom.footerSep.hidden = false;
            if (doc.meta.lang)
                document.documentElement.lang = doc.meta.lang;

            App.dom.empty.hidden = true;
            App.dom.content.hidden = false;

            Nav.buildToC(doc.headings);
            Nav.activeId = null;
            Nav.restoreScroll();
            Nav.updateActive();
            Nav.updateChrome();
        },

        /* Re-apply persisted task ticks to the freshly rendered DOM. */
        applyTaskStates: function (doc) {
            var saved = DocPref.get(doc.id, "tasks", null);
            if (!saved) return;
            Array.prototype.forEach.call(
                App.dom.content.querySelectorAll(".task-checkbox"),
                function (box) {
                    var idx = box.getAttribute("data-task-index");
                    if (idx != null && idx in saved) box.checked = !!saved[idx];
                },
            );
        },

        showEmpty: function () {
            App.state = "empty";
            App.current = null;
            document.title = "Markdown Webbook";
            App.dom.headerTitle.textContent = "Markdown Webbook";
            App.dom.footerTitle.hidden = true;
            App.dom.footerSep.hidden = true;
            App.dom.content.hidden = true;
            App.dom.content.innerHTML = "";
            App.dom.empty.hidden = false;
            Nav.buildToC([]);
            Nav.updateChrome();
            App.syncToolbar();
            App.syncDownloadLabel();
        },

        /* ------------------------- chrome & states ------------------------- */

        syncToolbar: function () {
            var disabled = App.state !== "reading";
            App.dom.btnSearch.disabled = disabled;
            [
                "mi-copy-md",
                "mi-copy-text",
                "mi-download",
                "mi-export",
                "mi-publish",
                "mi-print",
                "mi-meta",
                "mi-pubmenu",
                "mi-find",
            ].forEach(function (id) {
                var el = $(id);
                if (el) el.disabled = disabled;
            });
        },

        /* Extension-aware doc-menu label (1.8.0): "Download .mdx" for an
           imported .mdx file, "Download .md" otherwise. Only the item's
           text node is rewritten — the icon must survive. */
        syncDownloadLabel: function () {
            var item = $("mi-download");
            if (!item) return;
            var label = Exporter.downloadLabel();
            for (var i = 0; i < item.childNodes.length; i++) {
                var n = item.childNodes[i];
                if (
                    n.nodeType === 3 &&
                    n.nodeValue &&
                    n.nodeValue.indexOf("Download") !== -1
                ) {
                    n.nodeValue = n.nodeValue.replace(
                        /Download\s+\.[a-z0-9]+/i,
                        label,
                    );
                    break;
                }
            }
        },

        /* ------------------- popovers (Aa settings, menu) ------------------ */

        /* Publication preference: does the exported publishable HTML keep
           its reader menu? Per-document (DocPref), default on. */
        syncPubMenuUi: function () {
            var item = $("mi-pubmenu");
            if (!item) return;
            var on = App.current
                ? Publication.includeMenu(App.current.id)
                : true;
            item.setAttribute("aria-checked", on ? "true" : "false");
        },

        togglePubMenu: function () {
            if (!App.current) return;
            var next = !Publication.includeMenu(App.current.id);
            DocPref.set(App.current.id, "pubMenu", next);
            App.syncPubMenuUi();
            UI.toast(
                next
                    ? "Publication will include the document menu"
                    : "Publication will be the document only",
            );
        },

        /* One-time cleanup: the per-document raw-HTML override was removed
           with its doc-menu control — leftover state is deleted, not kept
           hidden (remove, don't hide). */
        purgeLegacyStrictPrefs: function () {
            if (!Storage.available) return;
            var stale = [];
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(LS_PREFIX + "docpref:") === 0)
                        stale.push(k);
                }
            } catch (e) {
                return;
            }
            stale.forEach(function (k) {
                try {
                    var prefs = JSON.parse(localStorage.getItem(k));
                    if (prefs && "rawHtml" in prefs) {
                        delete prefs.rawHtml;
                        var empty = true;
                        for (var any in prefs) {
                            empty = false;
                            break;
                        }
                        if (empty) localStorage.removeItem(k);
                        else localStorage.setItem(k, JSON.stringify(prefs));
                    }
                } catch (e) {}
            });
        },

        openPopover: function (pop, trigger) {
            Lightbox.close();
            App.closePopovers();
            pop.hidden = false;
            /* Popovers marked data-anchor="trigger-left" hang directly
               beneath their trigger — the document menu opens under the
               document icon on every viewport size. */
            if (pop.getAttribute("data-anchor") === "trigger-left") {
                var left = trigger.getBoundingClientRect().left;
                var maxLeft = (window.innerWidth || 0) - pop.offsetWidth - 8;
                pop.style.right = "auto";
                pop.style.left = Math.max(8, Math.min(left, maxLeft)) + "px";
            }
            trigger.classList.add("active");
            trigger.setAttribute("aria-expanded", "true");
            App.activePopover = { pop: pop, trigger: trigger };
            var first = pop.querySelector(
                "button:not([disabled]), [aria-pressed]",
            );
            if (first) first.focus();
        },

        closePopovers: function (refocus) {
            var active = App.activePopover;
            if (!active) return;
            App.activePopover = null;
            active.pop.hidden = true;
            active.trigger.classList.remove("active");
            active.trigger.setAttribute("aria-expanded", "false");
            if (refocus && !active.trigger.disabled) active.trigger.focus();
        },

        toggleAa: function () {
            if (
                App.activePopover &&
                App.activePopover.pop === App.dom.aaPopover
            )
                App.closePopovers(true);
            else App.openPopover(App.dom.aaPopover, App.dom.btnAa);
        },

        toggleDocs: function () {
            if (
                App.activePopover &&
                App.activePopover.pop === App.dom.docMenu
            )
                App.closePopovers(true);
            else {
                App.syncToolbar();
                App.syncPubMenuUi();
                App.openPopover(App.dom.docMenu, App.dom.btnDocs);
            }
        },

        toggleMore: function () {
            if (
                App.activePopover &&
                App.activePopover.pop === App.dom.moreMenu
            )
                App.closePopovers(true);
            else {
                App.syncToolbar();
                App.openPopover(App.dom.moreMenu, App.dom.btnMore);
            }
        },

        syncSettingsUi: function () {
            if (!App.dom || !App.dom.aaPopover) return;
            Array.prototype.forEach.call(
                App.dom.aaPopover.querySelectorAll(".seg"),
                function (seg) {
                    var key = seg.getAttribute("data-setting");
                    var value = Settings.get(key);
                    Array.prototype.forEach.call(
                        seg.querySelectorAll("button"),
                        function (btn) {
                            btn.setAttribute(
                                "aria-pressed",
                                btn.getAttribute("data-value") === value
                                    ? "true"
                                    : "false",
                            );
                        },
                    );
                },
            );
        },

        openToc: function () {
            Lightbox.close();
            /* Contents drawer and search layer are mutually exclusive
               (1.8.0): opening the drawer dismisses an open findbar. */
            if (Find.isOpen) Find.close();
            App.dom.tocSidebar.classList.add("open");
            App.dom.btnToc.classList.add("active");
            App.dom.btnToc.setAttribute("aria-expanded", "true");
            if (isMobileWidth()) App.dom.scrim.hidden = false;
            var first = App.dom.tocSidebar.querySelector("a.toc-link");
            if (first) first.focus();
        },

        closeToc: function () {
            var wasOpen = App.dom.tocSidebar.classList.contains("open");
            App.dom.tocSidebar.classList.remove("open");
            App.dom.btnToc.classList.remove("active");
            App.dom.btnToc.setAttribute("aria-expanded", "false");
            App.dom.scrim.hidden = true;
            if (wasOpen) App.dom.btnToc.focus();
        },

        toggleToc: function () {
            if (App.dom.tocSidebar.classList.contains("open")) App.closeToc();
            else App.openToc();
        },

        bindChrome: function () {
            App.dom.btnToc.addEventListener("click", App.toggleToc);
            App.dom.scrim.addEventListener("click", App.closeToc);
            App.dom.btnAa.addEventListener("click", App.toggleAa);
            App.dom.btnMore.addEventListener("click", App.toggleMore);
            App.dom.btnDocs.addEventListener("click", App.toggleDocs);
            App.dom.btnOpenEmpty.addEventListener("click", function () {
                App.dom.fileInput.click();
            });

            App.dom.fileInput.addEventListener(
                "change",
                function () {
                    if (App.dom.fileInput.files.length)
                        App.handleFile(App.dom.fileInput.files[0]);
                    App.dom.fileInput.value = "";
                },
            );

            /* Document menu: import, url import, metadata, export suite
               (R14, 1.8.0) and the publication preference. Published
               replicas strip the authoring items (mi-open / mi-open-url /
               mi-meta / mi-publish / mi-pubmenu), so those bindings must
               tolerate absence — removed, not hidden. */
            var bindMenuItem = function (id, fn) {
                var el = $(id);
                if (el) el.addEventListener("click", fn);
            };
            bindMenuItem("mi-open", function () {
                App.closePopovers();
                App.dom.fileInput.click();
            });
            bindMenuItem("mi-open-url", function () {
                App.closePopovers();
                OpenUrl.openEditor();
            });
            bindMenuItem("mi-meta", function () {
                App.closePopovers();
                Meta.openEditor();
            });
            $("mi-copy-md").addEventListener("click", function () {
                App.closePopovers();
                if (App.current)
                    Exporter.copyText(App.current.source, "Markdown copied");
            });
            $("mi-copy-text").addEventListener("click", function () {
                App.closePopovers();
                if (App.current)
                    Exporter.copyText(
                        Exporter.renderedText(),
                        "Rendered text copied",
                    );
            });
            $("mi-download").addEventListener("click", function () {
                App.closePopovers();
                Exporter.download();
            });
            $("mi-export").addEventListener("click", function () {
                App.closePopovers();
                Exporter.exportHTML();
            });
            bindMenuItem("mi-publish", function () {
                App.closePopovers();
                Exporter.exportPublication();
            });
            $("mi-print").addEventListener("click", function () {
                App.closePopovers();
                Exporter.printDoc();
            });
            bindMenuItem("mi-pubmenu", function () {
                App.togglePubMenu();
            });

            /* Compact more-menu (search + customisation collapse here) and
               palette/shortcuts entries (R17/R19). */
            $("mi-find").addEventListener("click", function () {
                App.closePopovers();
                Find.show();
            });
            $("mi-settings").addEventListener("click", function () {
                App.closePopovers();
                App.toggleAa();
            });
            $("mi-palette").addEventListener("click", function () {
                App.closePopovers();
                Palette.openPalette();
            });
            $("mi-shortcuts-menu").addEventListener("click", function () {
                App.closePopovers();
                Help.openHelp();
            });
            $("mi-shortcuts-aa").addEventListener("click", function () {
                App.closePopovers();
                Help.openHelp();
            });

            /* Reader settings: segmented buttons, one delegate (R11).
               Raw HTML is the one setting that changes rendering output, so
               it re-renders the current document in place (scroll kept) —
               it used to be mirrored by a per-document doc-menu toggle,
               which was removed as redundant. */
            App.dom.aaPopover.addEventListener("click", function (e) {
                var btn = e.target.closest(".seg button");
                if (!btn) return;
                var key = btn.closest(".seg").getAttribute("data-setting");
                var prev = Settings.get(key);
                if (!Settings.set(key, btn.getAttribute("data-value"))) return;
                App.syncSettingsUi();
                if (
                    key === "rawHtml" &&
                    App.current &&
                    prev !== Settings.get(key)
                ) {
                    /* Keep the reader exactly where they are: pin the live
                       position (never the throttled save or the URL hash),
                       then re-render in place. */
                    App._keepScrollY = window.scrollY || 0;
                    Nav.saveScrollNow();
                    App._skipConfirm = true;
                    App.loadDocument(App.current.source, "reloaded");
                    UI.toast(
                        Settings.get("rawHtml") === "strip"
                            ? "Raw HTML is now stripped"
                            : "Raw HTML is now sanitised",
                    );
                }
            });

            /* Popovers close on outside pointer press */
            document.addEventListener("pointerdown", function (e) {
                if (!App.activePopover) return;
                var t = App.activePopover.trigger;
                if (App.activePopover.pop.contains(e.target)) return;
                if (t && (e.target === t || t.contains(e.target))) return;
                App.closePopovers(false);
            });

            /* Task-list checkboxes (M0 0.3): instant toggle, persisted per
               document + item index. No re-render, so reading position is
               untouched; the Markdown source is never rewritten. */
            App.dom.content.addEventListener("change", function (e) {
                var box = e.target;
                if (!box.classList || !box.classList.contains("task-checkbox"))
                    return;
                if (!App.current) return;
                var idx = box.getAttribute("data-task-index");
                if (idx == null) return;
                var tasks = DocPref.get(App.current.id, "tasks", {}) || {};
                tasks[idx] = !!box.checked;
                DocPref.set(App.current.id, "tasks", tasks);
            });

            /* Content clicks (delegated, one listener, M1 1.1): per-block
               code toolbar, heading permalinks, and the image lightbox
               trigger (M5A). Order matters: block controls first, then the
               permalink, then images — links containing images always win. */
            App.dom.content.addEventListener("click", function (e) {
                var collapseBtn = e.target.closest(".collapse-code-btn");
                if (collapseBtn) {
                    Enhancer.toggleCollapse(collapseBtn);
                    return;
                }
                var wrapBtn = e.target.closest(".wrap-code-btn");
                if (wrapBtn) {
                    Enhancer.toggleWrap(wrapBtn);
                    return;
                }
                var copyBtn = e.target.closest(".copy-code-btn");
                if (copyBtn) {
                    var wrapper = copyBtn.closest(".code-wrapper");
                    var code = wrapper && wrapper.querySelector("pre code");
                    if (code) {
                        Exporter.copyText(code.innerText, "Code copied");
                        copyBtn.textContent = "Copied";
                        copyBtn.classList.add("is-copied");
                        setTimeout(function () {
                            copyBtn.textContent = "Copy";
                            copyBtn.classList.remove("is-copied");
                        }, 1500);
                    }
                    return;
                }
                var anchor = e.target.closest("a.h-anchor");
                if (anchor) {
                    e.preventDefault();
                    var id = (anchor.getAttribute("href") || "#").slice(1);
                    try {
                        history.replaceState(
                            null,
                            "",
                            "#" + encodeURIComponent(id),
                        );
                    } catch (err) {}
                    var base = String(window.location.href || "").split("#")[0];
                    Exporter.copyText(base + "#" + id, "Link copied");
                    return;
                }
                var img = e.target.closest("img");
                if (img && !img.closest("a") && App.state === "reading") {
                    Lightbox.openFor(img);
                }
            });

            /* Table drag-to-scroll: the scrollers hide their scrollbars,
               so give mouse users the gesture back — press and drag
               sideways to pan a wide table (touch already pans natively).
               The drag is direction-locked, so vertical moves keep
               selecting text, and a genuine drag swallows the trailing
               click so links and permalinks never fire mid-pan. */
            var tableDrag = null;
            var tableDragClick = false;
            App.dom.content.addEventListener("pointerdown", function (e) {
                if (e.pointerType !== "mouse" || e.button !== 0) return;
                var w =
                    e.target.closest && e.target.closest(".table-scroll");
                if (!w || w.scrollWidth <= w.clientWidth + 1) return;
                tableDrag = {
                    w: w,
                    id: e.pointerId,
                    x: e.clientX,
                    y: e.clientY,
                    sl: w.scrollLeft,
                    locked: false,
                    moved: false,
                };
            });
            document.addEventListener(
                "pointermove",
                function (e) {
                    if (!tableDrag || e.pointerId !== tableDrag.id) return;
                    var dx = e.clientX - tableDrag.x;
                    var dy = e.clientY - tableDrag.y;
                    if (!tableDrag.locked) {
                        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
                        if (Math.abs(dx) <= Math.abs(dy)) {
                            tableDrag = null; /* vertical intent: selection */
                            return;
                        }
                        tableDrag.locked = true;
                        try {
                            window.getSelection().removeAllRanges();
                        } catch (err) {}
                    }
                    tableDrag.moved = true;
                    tableDrag.w.scrollLeft = tableDrag.sl - dx;
                    e.preventDefault();
                },
                { passive: false },
            );
            function endTableDrag(e) {
                if (!tableDrag || (e && e.pointerId !== tableDrag.id)) return;
                var wasDrag = tableDrag.moved && tableDrag.locked;
                tableDrag = null;
                if (wasDrag) {
                    tableDragClick = true;
                    setTimeout(function () {
                        tableDragClick = false;
                    }, 0);
                }
            }
            document.addEventListener("pointerup", endTableDrag);
            document.addEventListener("pointercancel", endTableDrag);

            /* Re-settle pinned tables when the reading measure changes. */
            var settleTimer = null;
            window.addEventListener("resize", function () {
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(function () {
                    settleTimer = null;
                    Enhancer.settleTables(App.dom.content);
                }, 150);
            });
            App.dom.content.addEventListener(
                "click",
                function (e) {
                    if (tableDragClick) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                },
                true,
            );

            /* Reload button lives outside boot's try/catch so it always binds */
            var reload = $("btn-reload");
            if (reload)
                reload.addEventListener("click", function () {
                    window.location.reload();
                });

            /* Keyboard layer (§8, R17, R19): Esc priority lightbox > palette >
               url-open > metadata > help > find > popover > drawer; Tab traps
               whichever overlay is open; Ctrl/Cmd+K palette, Ctrl/Cmd+F search,
               Ctrl/Cmd+O open file, / search, ? shortcut map, T contents.
               Single letters need no modifier and never fire while typing. */
            document.addEventListener("keydown", function (e) {
                if (e.key === "Escape") {
                    if (Lightbox.open) {
                        e.preventDefault();
                        Lightbox.close();
                        return;
                    }
                    if (Palette.open) {
                        e.preventDefault();
                        Palette.close(true);
                        return;
                    }
                    if (OpenUrl.open) {
                        e.preventDefault();
                        /* A fetch in flight owns the dialog — it cannot be
                           dismissed until the request settles. */
                        if (!OpenUrl.busy) OpenUrl.close();
                        return;
                    }
                    if (Meta.open) {
                        e.preventDefault();
                        Meta.close();
                        return;
                    }
                    if (Help.open) {
                        e.preventDefault();
                        Help.close();
                        return;
                    }
                    if (Find.isOpen) {
                        e.preventDefault();
                        Find.close();
                        return;
                    }
                    if (App.activePopover) {
                        e.preventDefault();
                        App.closePopovers(true);
                        return;
                    }
                    if (App.dom.tocSidebar.classList.contains("open")) {
                        e.preventDefault();
                        App.closeToc();
                    }
                    return;
                }

                if ((e.ctrlKey || e.metaKey) && !e.altKey) {
                    var k = e.key.toLowerCase();
                    if (k === "k") {
                        e.preventDefault();
                        if (Palette.open) Palette.close(true);
                        else Palette.openPalette();
                        return;
                    }
                    if (k === "f") {
                        e.preventDefault();
                        if (Find.isOpen) {
                            Find.input.focus();
                            Find.input.select();
                        } else Find.show();
                        return;
                    }
                    if (k === "o") {
                        /* Published replicas (window.MDWB_PUB) have no
                           open-file shortcut: the row is gone from the Help
                           map and the listener is not installed, so Ctrl+O
                           falls through untouched. */
                        if (!window.MDWB_PUB) {
                            e.preventDefault();
                            App.dom.fileInput.click();
                        }
                        return;
                    }
                    return; /* other browser shortcuts stay untouched */
                }
                if (e.ctrlKey || e.metaKey || e.altKey) return;

                if (e.key === "Tab") {
                    var container = Lightbox.open
                        ? Lightbox.el
                        : Palette.open
                        ? Palette.panel
                        : Meta.open
                          ? Meta.panel
                          : OpenUrl.open
                            ? OpenUrl.panel
                            : Help.open
                              ? Help.panel
                              : App.activePopover
                                ? App.activePopover.pop
                                : App.dom.tocSidebar.classList.contains("open")
                                  ? App.dom.tocSidebar
                                  : null;
                    if (!container) return;
                    var focusables = container.querySelectorAll(
                        'a[href], button:not([disabled]), input, textarea, [contenteditable="true"]',
                    );
                    if (!focusables.length) return;
                    var first = focusables[0];
                    var last = focusables[focusables.length - 1];
                    if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    } else if (
                        !e.shiftKey &&
                        document.activeElement === last
                    ) {
                        e.preventDefault();
                        first.focus();
                    }
                    return;
                }

                if (e.key.length !== 1) return;
                var t = e.target;
                if (
                    t &&
                    (t.tagName === "INPUT" ||
                        t.tagName === "TEXTAREA" ||
                        t.isContentEditable)
                )
                    return;
                if (e.key === "/") {
                    if (App.state === "reading" && !Find.isOpen) {
                        e.preventDefault();
                        Find.show();
                    }
                } else if (e.key === "?") {
                    e.preventDefault();
                    Help.toggle();
                } else if (e.key === "t" || e.key === "T") {
                    /* No Find guard: opening the contents drawer now closes
                       an open search layer (mutual exclusion, 1.8.0). */
                    if (!Help.open) App.toggleToc();
                }
            });

            /* Printing with highlights on would print them — clear before,
               re-run after if the search is still open; the lightbox is
               dismissed so a print run never captures overlay state (R14,
               M0 0.4) */
            window.addEventListener("beforeprint", function () {
                Lightbox.close();
                Meta.close();
                if (Find.isOpen) Find.reset();
            });
            window.addEventListener("afterprint", function () {
                if (Find.isOpen && Find.input.value)
                    Find.run(Find.input.value);
            });

            /* Import: drag & drop (R3) */
            var dragDepth = 0;
            function hasFiles(e) {
                return (
                    e.dataTransfer &&
                    Array.prototype.indexOf.call(
                        e.dataTransfer.types || [],
                        "Files",
                    ) !== -1
                );
            }
            document.addEventListener("dragenter", function (e) {
                if (!hasFiles(e)) return;
                e.preventDefault();
                dragDepth++;
                UI.showDrop();
            });
            document.addEventListener("dragover", function (e) {
                if (hasFiles(e)) e.preventDefault();
            });
            document.addEventListener("dragleave", function () {
                dragDepth = Math.max(0, dragDepth - 1);
                if (!dragDepth) UI.hideDrop();
            });
            document.addEventListener("drop", function (e) {
                e.preventDefault();
                dragDepth = 0;
                UI.hideDrop();
                var files = e.dataTransfer && e.dataTransfer.files;
                if (files && files.length) {
                    App.handleFile(files[0]);
                    return;
                }
                var text =
                    e.dataTransfer && e.dataTransfer.getData("text/plain");
                if (text && text.trim())
                    App.loadDocument(text, "pasted");
            });

            /* Import: paste while the empty state is showing was removed
               (1.8.0) — the behaviour never worked reliably and the welcome
               document no longer advertises it. */

            /* Recovery guard: only armed when a document could not persist */
            window.addEventListener("beforeunload", function (e) {
                if (App.persistFailed && App.current) {
                    e.preventDefault();
                    e.returnValue = "";
                }
            });
        },

        /* ---------------------------- import (R3) -------------------------- */

        handleFile: function (file) {
            var okName = /\.(md|markdown|mdown|mdx|txt)$/i.test(file.name || "");
            var okType = /^text\/|markdown/i.test(file.type || "");
            if (!okName && !okType) {
                UI.toast(
                    "Unsupported file — please open .md, .markdown or .mdx",
                    true,
                );
                return;
            }
            /* Provenance for the extension-aware Download label + naming:
               .mdx imports download exactly as they were imported (1.8.0). */
            var m = /\.([a-z0-9]+)$/i.exec(file.name || "");
            App.pendingFile = {
                name: file.name || null,
                ext: m ? m[1].toLowerCase() : null,
            };
            var read;
            if (file.text) read = file.text();
            else {
                read = new Promise(function (resolve, reject) {
                    var r = new FileReader();
                    r.onload = function () {
                        resolve(String(r.result));
                    };
                    r.onerror = function () {
                        reject(r.error);
                    };
                    r.readAsText(file);
                });
            }
            read.then(
                function (text) {
                    if (text.indexOf("\u0000") !== -1) {
                        UI.toast(
                            "That looks like a binary file, not Markdown",
                            true,
                        );
                        return;
                    }
                    App.loadDocument(text, "imported");
                },
                function () {
                    UI.toast("Could not read that file", true);
                },
            );
        },

        /* ------------------------- error boundary (R5) --------------------- */

        showFatal: function (err) {
            App.state = "error";
            UI.hideLoading();
            var msg = err && err.message ? String(err.message) : String(err);
            /* A trimmed stack helps report failures precisely; most readers
               will never see this panel, and those who do deserve detail. */
            if (err && err.stack) {
                var lines = String(err.stack)
                    .split("\n")
                    .slice(1, 4)
                    .map(function (l) {
                        return l.trim().replace(/\(.*$/, "");
                    })
                    .filter(Boolean);
                if (lines.length) msg += "  [" + lines.join(" | ") + "]";
            }
            try {
                $("fatal-msg").textContent =
                    "The reader hit an unexpected error and could not continue. " +
                    msg;
                App.dom.fatal.hidden = false;
                App.dom.content.hidden = true;
                App.dom.empty.hidden = true;
            } catch (e) {
                /* Even the error UI failed; leave the message in the console. */
                if (window.console && console.error) console.error(err);
            }
        },
    };

    /* Top-level guards: never a blank page (R5) */
    var fatalShown = false;
    function onGlobalError(err) {
        if (fatalShown) return;
        fatalShown = true;
        try {
            App.showFatal(err);
        } catch (e) {}
    }
    window.addEventListener("error", function (e) {
        onGlobalError(e.error || e.message);
    });
    window.addEventListener("unhandledrejection", function (e) {
        onGlobalError(e.reason);
    });

    /* Public test hook for the verification harness (corpus runner) */
    window.MDWebbook = {
        version: APP_VERSION,
        render: function (md, opts) {
            return Parser.render(md, opts && opts.strict);
        },
        splitFrontmatter: function (md) {
            return Parser.splitFrontmatter(md);
        },
        escapeEmbed: function (md) {
            return Source.escapeEmbed(md);
        },
        embedPayload: function (md) {
            return Source.embedPayload(md);
        },
        openMarkdown: function (md) {
            App.loadDocument(String(md == null ? "" : md), "imported");
        },
        settings: {
            get: function (k) {
                return Settings.get(k);
            },
            set: function (k, v) {
                var ok = Settings.set(k, v);
                if (ok) App.syncSettingsUi();
                return ok;
            },
            all: function () {
                return Settings.getAll();
            },
        },
        find: {
            run: function (q) {
                return Find.run(q);
            },
            step: function (dir) {
                Find.step(dir);
                return Find.state();
            },
            open: function () {
                Find.show();
            },
            close: function () {
                Find.close();
            },
            state: function () {
                return Find.state();
            },
        },
        palette: {
            open: function () {
                Palette.openPalette();
            },
            close: function () {
                Palette.close();
            },
            query: function (q) {
                Palette.buildList(q);
            },
            items: function () {
                return Palette.filtered.map(function (it) {
                    return {
                        label: it.label,
                        group: it.group,
                        level: it.level || 0,
                    };
                });
            },
            execute: function (i) {
                Palette.execute(Palette.filtered[i]);
            },
            state: function () {
                return Palette.state();
            },
        },
        help: {
            open: function () {
                Help.openHelp();
            },
            close: function () {
                Help.close();
            },
            state: function () {
                return Help.state();
            },
        },
        lightbox: {
            openFor: function (el) {
                Lightbox.openFor(el);
            },
            close: function () {
                Lightbox.close();
            },
            state: function () {
                return Lightbox.state();
            },
        },
        strict: null, /* per-document strict toggle removed (1.5.0) */
        /* Verification hook (RP1): the consume-once scroll pin that
           render-triggering setting changes use to keep the exact reading
           position. */
        scrollPin: {
            set: function (y) {
                App._keepScrollY = y;
            },
            get: function () {
                return App._keepScrollY == null ? null : App._keepScrollY;
            },
        },
        publication: {
            build: function () {
                return Publication.build(App.current);
            },
            includeMenu: function () {
                return App.current
                    ? Publication.includeMenu(App.current.id)
                    : null;
            },
            setIncludeMenu: function (v) {
                if (!App.current) return false;
                DocPref.set(App.current.id, "pubMenu", !!v);
                App.syncPubMenuUi();
                return true;
            },
        },
        metaDialog: {
            open: function () {
                Meta.openEditor();
            },
            close: function () {
                Meta.close();
            },
            save: function () {
                Meta.save();
            },
            state: function () {
                return Meta.state();
            },
        },
        openUrlDialog: {
            open: function () {
                OpenUrl.openEditor();
            },
            close: function () {
                if (!OpenUrl.busy) OpenUrl.close();
            },
            /* Harness/test hook: prefill the field and submit in one call. */
            submit: function (url) {
                if (!OpenUrl.open) OpenUrl.openEditor();
                OpenUrl.input.value = url == null ? "" : String(url);
                OpenUrl.fetch();
            },
            state: function () {
                return OpenUrl.state();
            },
        },
        downloadName: function () {
            return Exporter.downloadName();
        },
        downloadLabel: function () {
            return Exporter.downloadLabel();
        },
        purgeLegacyPrefs: function () {
            App.purgeLegacyStrictPrefs();
        },
        buildStandaloneHTML: function () {
            return Exporter.buildStandalone(App.current);
        },
        renderedText: function () {
            return Exporter.renderedText();
        },
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            App.boot();
        });
    } else {
        App.boot();
    }
})();

        