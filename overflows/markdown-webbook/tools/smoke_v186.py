"""v1.8.6 Chromium smoke: the Data URI embedding engine is retired — the
media pipeline is a single "Strip remote media" privacy switch (default
off = untouched passthrough, on = the stripping pass runs before render
AND store), the clipboard flow invokes navigator.clipboard.readText()
inside the direct user-gesture call stack (native permission semantics),
and the lightbox image gains object-fit: contain with an explicit safe
area that reserves the floating close button's row. A real 127.0.0.1
HTTP server serves the remote images so passthrough rendering is
observable; carried on top of the v1.8.5/v1.8.4/…/v1.8.0 regressions."""
import os
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = "file://" + os.path.join(HERE, os.pardir, "dist", "markdown_webbook.html")
fails = []
notes = []
errors = []


def check(cid, cond, note=""):
    if cond:
        notes.append(cid)
        print("[PASS] " + cid + (" " + str(note) if note else ""))
    else:
        fails.append(cid + " :: " + str(note))
        print("[FAIL] " + cid + " -> " + str(note))


MD = "# From the web\n\nFetched body text.\n"
MDX = "# MDX Guide\n\nFetched mdx body.\n"
HEADERS = {"content-type": "text/markdown", "access-control-allow-origin": "*"}
PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>'
BIG_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="2600" height="1800">'
    b'<rect width="2600" height="1800" fill="#266d8a"/></svg>'
)

# ------------------------- local origin server -----------------------------
ROUTES = {
    "/ok.png": (PNG, "image/png"),
    "/ok.svg": (SVG, "image/svg+xml"),
    "/big.svg": (BIG_SVG, "image/svg+xml"),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        entry = ROUTES.get(path)
        if entry is None:
            self.send_response(404)
            self.end_headers()
            return
        body, ctype = entry
        self.send_response(200)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def start_server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    srv.daemon_threads = True
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, "http://127.0.0.1:%d" % srv.server_address[1]


def stub_readtext_with(md):
    return """() => {
    const md = %s;
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: () => Promise.resolve(md) },
    });
}""" % json.dumps(md)


STUB_TEXT_CLIPBOARD = """() => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: () => Promise.resolve(
            "# Pasted Doc\\n\\nHello from the clipboard") },
    });
}"""

STUB_NOTEXT_CLIPBOARD = """() => {
    const err = new Error('No valid data on clipboard.');
    err.name = 'NotFoundError';
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: () => Promise.reject(err) },
    });
}"""

STUB_SHORTCUT_CLIPBOARD = """() => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: () => Promise.resolve(
            "# Shortcut Doc\\n\\nbody via the key layer") },
    });
}"""

RESTORE_NATIVE_CLIPBOARD = "() => { delete navigator.clipboard; }"

INSTRUMENT_READTEXT = """() => {
    const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
    const board = d.get.call(navigator);
    const orig = board.readText.bind(board);
    window.__rb = { calls: 0, active: null };
    board.readText = (...a) => {
        window.__rb.calls += 1;
        window.__rb.active = !!(navigator.userActivation &&
                                navigator.userActivation.hasBeenActive);
        return orig(...a);
    };
}"""


def main():
    srv, ORIGIN = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.on("console", lambda m: errors.append(m.text)
                    if m.type == "error" and "Failed to load resource" not in m.text
                    and "clipboard" not in m.text.lower()
                    and "permission" not in m.text.lower()
                    else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(FILE)
            page.wait_for_function("() => window.MDWebbook && window.MDWebbook.version")

            # ---- 1. Version -------------------------------------------------
            check("ver.1.8.6", page.evaluate("window.MDWebbook.version") == "1.8.6")

            # ---- 2. Menu placements + renamed toggle ------------------------
            page.click("#btn-docs")
            page.wait_for_selector("#doc-menu:not([hidden])")
            boxes = page.evaluate("""() => {
                const g = (id) => { const el = document.getElementById(id);
                    return el ? el.getBoundingClientRect() : null; };
                const next = (id) => { const el = document.getElementById(id);
                    return el && el.nextElementSibling ? el.nextElementSibling : null; };
                return {
                    open: g('mi-open'), url: g('mi-open-url'), paste: g('mi-paste'),
                    print: g('mi-print'), meta: g('mi-meta'), strip: g('mi-strip'),
                    pub: g('mi-pubmenu'),
                    pasteNext: next('mi-paste') ? next('mi-paste').tagName : null,
                    printNext: next('mi-print') ? next('mi-print').tagName : null,
                    metaNext: next('mi-meta') ? next('mi-meta').tagName : null,
                    stripChecked: document.getElementById('mi-strip').getAttribute('aria-checked'),
                    stripSwitch: !!document.querySelector('#mi-strip .pub-switch .pub-knob'),
                    stripLabel: document.getElementById('mi-strip').textContent.indexOf('Strip remote media') !== -1,
                    pasteAria: document.getElementById('mi-paste').getAttribute('aria-keyshortcuts') || '',
                };
            }""")
            check("menu.placement",
                  boxes["url"] and boxes["open"] and
                  boxes["url"]["y"] >= boxes["open"]["y"] + boxes["open"]["height"] - 2,
                  'open y=%.0f url y=%.0f' % (boxes["open"]["y"], boxes["url"]["y"]))
            check("menu.paste.placement",
                  boxes["paste"] and
                  boxes["paste"]["y"] >= boxes["url"]["y"] + boxes["url"]["height"] - 2
                  and boxes["pasteNext"] == "HR",
                  'url y=%.0f paste y=%.0f next=%s' % (
                      boxes["url"]["y"], boxes["paste"]["y"], boxes["pasteNext"]))
            check("menu.meta.placement",
                  boxes["meta"] and boxes["printNext"] == "HR"
                  and boxes["meta"]["y"] > boxes["print"]["y"] + boxes["print"]["height"] - 2,
                  'print y=%.0f meta y=%.0f' % (boxes["print"]["y"], boxes["meta"]["y"]))
            check("menu.strip.toggle",
                  boxes["metaNext"] == "HR" and boxes["strip"]
                  and boxes["strip"]["y"] > boxes["meta"]["y"] + boxes["meta"]["height"] - 2
                  and boxes["strip"]["y"] < boxes["pub"]["y"]
                  and boxes["stripChecked"] == "false" and boxes["stripSwitch"]
                  and boxes["stripLabel"],
                  'checked=%s next=%s' % (boxes["stripChecked"], boxes["metaNext"]))
            check("menu.paste.aria", "Control+Shift+V" in boxes["pasteAria"]
                  and "Meta+Shift+V" in boxes["pasteAria"], boxes["pasteAria"])
            page.keyboard.press("Escape")
            page.wait_for_timeout(120)

            # ---- 3. Url modal shell (v1.8.0 regression) ----------------------
            page.click("#btn-docs")
            page.click("#mi-open-url")
            page.wait_for_selector("#openurl-backdrop:not([hidden])")
            shell = page.evaluate("""() => {
                const panel = document.getElementById('openurl-panel');
                const cs = getComputedStyle(panel);
                const h2 = document.getElementById('openurl-heading');
                const input = document.getElementById('mfu-url');
                const ics = getComputedStyle(input);
                const x = document.getElementById('openurl-close');
                const mcs = getComputedStyle(x);
                return {
                    cls: panel.className, w: cs.width, pad: cs.padding,
                    h2w: getComputedStyle(h2).fontWeight,
                    ih: ics.height, ialign: ics.textAlign,
                    label: !!document.querySelector('label[for="mfu-url"]'),
                    ph: input.placeholder,
                    spinner: !!document.querySelector('#openurl-open .mbtn-spinner'),
                    xw: mcs.width,
                };
            }""")
            check("modal.shell",
                  shell["cls"] == "help-panel meta-panel" and shell["w"] == "520px"
                  and shell["pad"] == "0px" and shell["h2w"] == "700"
                  and not shell["label"] and shell["ih"] == "38px"
                  and shell["ialign"] == "left"
                  and shell["ph"] == "https://example.com/book.md"
                  and shell["spinner"] and shell["xw"] == "30px",
                  json.dumps(shell))
            page.keyboard.press("Escape")
            page.wait_for_timeout(120)

            # ---- 4. Loading state + silent success --------------------------
            pending = {}

            def grab_notes(route):
                pending["route"] = route

            page.route("**://example.com/notes.md", grab_notes)
            page.click("#btn-docs")
            page.click("#mi-open-url")
            page.fill("#mfu-url", "https://example.com/notes.md")
            toast_before = page.inner_text("#toast")
            page.click("#openurl-open")
            page.wait_for_function(
                "() => document.getElementById('openurl-open').classList.contains('is-loading')",
                timeout=4000)
            loading = page.evaluate("""() => {
                const b = document.getElementById('openurl-open');
                const sp = b.querySelector('.mbtn-spinner');
                return { disabled: b.disabled, busy: b.getAttribute('aria-busy'),
                         spinVis: !!sp && sp.offsetWidth > 0,
                         labelHidden: getComputedStyle(b.querySelector('.mbtn-label')).display === 'none' };
            }""")
            page.screenshot(path=os.path.join(HERE, "smoke_v186_loading.png"))
            pending["route"].fulfill(status=200, headers=HEADERS, body=MD)
            page.wait_for_selector("#openurl-backdrop[hidden]", state="attached", timeout=8000)
            page.wait_for_timeout(150)
            toast_after = page.inner_text("#toast")
            check("url.loading.state",
                  loading["disabled"] and loading["busy"] == "true"
                  and loading["spinVis"] and loading["labelHidden"],
                  json.dumps(loading))
            rendered = page.evaluate(
                "() => document.getElementById('content').textContent.indexOf('From the web') !== -1")
            check("url.silent.success", rendered and toast_after == toast_before,
                  'rendered=%s toast="%s"' % (rendered, toast_after))

            # ---- 5. 404 failure -> toast, form re-enabled --------------------
            page.route("**://example.com/missing.md",
                       lambda r: r.fulfill(status=404, headers={"access-control-allow-origin": "*"},
                                           body="nope"))
            page.click("#btn-docs")
            page.click("#mi-open-url")
            page.fill("#mfu-url", "https://example.com/missing.md")
            page.click("#openurl-open")
            page.wait_for_selector("#toast.show.is-error")
            toast_txt = page.inner_text("#toast")
            after_fail = page.evaluate("""() => {
                const b = document.getElementById('openurl-open');
                return { disabled: b.disabled, busy: b.classList.contains('is-loading'),
                         open: !document.getElementById('openurl-backdrop').hidden };
            }""")
            page.screenshot(path=os.path.join(HERE, "smoke_v186_error.png"))
            check("url.fail.toast",
                  "404" in toast_txt and not after_fail["disabled"]
                  and not after_fail["busy"] and after_fail["open"],
                  '"%s" %s' % (toast_txt, after_fail))
            page.keyboard.press("Escape")
            page.wait_for_timeout(120)

            # ---- 6. Unsupported extension never fetches ----------------------
            fetched = {"n": 0}

            def count_route(route):
                fetched["n"] += 1
                route.fulfill(status=200, headers=HEADERS, body=MD)

            page.route("**://example.com/picture.zip", count_route)
            page.click("#btn-docs")
            page.click("#mi-open-url")
            page.fill("#mfu-url", "https://example.com/picture.zip")
            page.click("#openurl-open")
            page.wait_for_timeout(300)
            check("url.unsupported.ext",
                  fetched["n"] == 0 and "Unsupported file type (.zip)" in page.inner_text("#toast"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(120)

            # ---- 7. mdx import flips the Download label ----------------------
            page.route("**://example.com/guide.mdx",
                       lambda r: r.fulfill(status=200, headers=HEADERS, body=MDX))
            page.click("#btn-docs")
            page.click("#mi-open-url")
            page.fill("#mfu-url", "https://example.com/guide.mdx")
            page.click("#openurl-open")
            page.wait_for_selector("#openurl-backdrop[hidden]", state="attached", timeout=8000)
            page.click("#btn-docs")
            page.wait_for_selector("#doc-menu:not([hidden])")
            dl_label = page.inner_text("#mi-download")
            check("mdx.download.label",
                  "Download .mdx" in dl_label and "Download .md" not in dl_label.replace("Download .mdx", ""),
                  '"%s"' % dl_label.strip())
            page.keyboard.press("Escape")
            page.wait_for_timeout(120)

            # ---- 8. Paste: readText renders; strip OFF keeps remote media ----
            page.evaluate(stub_readtext_with(
                "# Pasted Media\n\n![pic](%s/ok.png)" % ORIGIN))
            page.evaluate("document.getElementById('btn-docs').click()")
            page.click("#mi-paste")
            page.wait_for_function(
                "() => !!document.querySelector('#content img')", timeout=6000)
            page.wait_for_timeout(400)
            paste_state = page.evaluate("""() => {
                const img = document.querySelector('#content img');
                return {
                    rendered: document.getElementById('content').textContent.indexOf('Pasted Media') !== -1,
                    remoteSrc: img ? (img.getAttribute('src') || '') : '',
                    displays: !!img && img.complete && img.naturalWidth > 0,
                    toast: document.getElementById('toast').textContent,
                    err: document.getElementById('toast').classList.contains('is-error'),
                };
            }""")
            check("paste.passthrough.keeps",
                  paste_state["rendered"]
                  and paste_state["remoteSrc"] == ORIGIN + "/ok.png"
                  and paste_state["displays"]
                  and "Pasted Media" in paste_state["toast"]
                  and not paste_state["err"],
                  json.dumps(paste_state))

            # ---- 9. Paste guard: non-text clipboard --------------------------
            page.evaluate(STUB_NOTEXT_CLIPBOARD)
            page.evaluate("document.getElementById('btn-docs').click()")
            page.click("#mi-paste")
            page.wait_for_selector("#toast.show.is-error")
            page.wait_for_timeout(150)
            guard_state = page.evaluate("""() => ({
                toast: document.getElementById('toast').textContent,
            })""")
            check("paste.nontext.refused",
                  "any text" in guard_state["toast"],
                  '"%s"' % guard_state["toast"])

            # ---- 10. Strip ON: media removed pre-render, zero requests -------
            _img_requests = []

            def count_img(route):
                _img_requests.append(1)
                route.continue_()

            page.route("**/ok.png", count_img)

            page.evaluate(stub_readtext_with(
                "# Stripped Doc\n\n![pic](%s/ok.png)" % ORIGIN))
            page.evaluate("document.getElementById('btn-docs').click()")
            page.evaluate("document.getElementById('mi-strip').click()")
            strip_on = page.evaluate(
                "() => document.getElementById('mi-strip').getAttribute('aria-checked')")
            page.click("#mi-paste")
            page.wait_for_function(
                "() => document.getElementById('content').textContent.indexOf('Stripped Doc') !== -1",
                timeout=6000)
            page.wait_for_timeout(500)
            strip_state = page.evaluate("""() => ({
                noImg: !document.querySelector('#content img'),
                text: document.getElementById('content').textContent.indexOf('Stripped Doc') !== -1,
                toast: document.getElementById('toast').textContent,
            })""")
            check("strip.on.removes",
                  strip_on == "true" and strip_state["noImg"] and strip_state["text"],
                  json.dumps(strip_state))
            check("strip.zero.requests", len(_img_requests) == 0,
                  "ok.png requests during strip-on import: %d" % len(_img_requests))

            # ---- 11. Strip ON: the STORED source is already stripped ---------
            stored = page.evaluate("""() => {
                const rec = JSON.parse(localStorage.getItem('mdwb:current') || 'null');
                return rec ? { clean: rec.source.indexOf('""" + ORIGIN + """/ok.png') === -1,
                               text: rec.source.indexOf('Stripped Doc') !== -1 } : null;
            }""")
            check("strip.source.persisted",
                  stored and stored["clean"] and stored["text"],
                  json.dumps(stored))

            # ---- 12. Strip OFF again: passthrough + storage keep the url -----
            page.evaluate("document.getElementById('btn-docs').click()")
            page.evaluate("document.getElementById('mi-strip').click()")
            page.evaluate(stub_readtext_with(
                "# Passthrough Doc\n\n![pic](%s/ok.png)" % ORIGIN))
            page.click("#mi-paste")
            page.wait_for_function(
                "() => !!document.querySelector('#content img')", timeout=6000)
            page.wait_for_timeout(400)
            keep_state = page.evaluate("""() => {
                const img = document.querySelector('#content img');
                const rec = JSON.parse(localStorage.getItem('mdwb:current') || 'null');
                return {
                    src: img ? (img.getAttribute('src') || '') : '',
                    displays: !!img && img.complete && img.naturalWidth > 0,
                    storedRemote: !!rec && rec.source.indexOf('""" + ORIGIN + """/ok.png') !== -1,
                };
            }""")
            check("strip.off.keeps",
                  keep_state["src"] == ORIGIN + "/ok.png"
                  and keep_state["displays"] and keep_state["storedRemote"],
                  json.dumps(keep_state))
            check("strip.request.resumed", len(_img_requests) >= 1,
                  "ok.png requests after passthrough import: %d" % len(_img_requests))

            # ---- 13. Native clipboard: real readText, denied on file:// ------
            page.evaluate(RESTORE_NATIVE_CLIPBOARD)
            native_kind = page.evaluate(
                "() => { const b = navigator.clipboard; return b && typeof b.readText === 'function' ? 'native' : 'none'; }")
            page.evaluate("document.getElementById('btn-docs').click()")
            page.click("#mi-paste")
            page.wait_for_selector("#toast.show.is-error", timeout=6000)
            page.wait_for_timeout(150)
            denied_toast = page.inner_text("#toast")
            check("clipboard.native.denied",
                  native_kind == "native" and "denied" in denied_toast,
                  'api=%s toast="%s"' % (native_kind, denied_toast))

            # ---- 14. readText fires inside the direct user-gesture stack -----
            page.evaluate(INSTRUMENT_READTEXT)
            page.evaluate(
                "() => document.getElementById('mi-paste').dispatchEvent("
                "new MouseEvent('click', { bubbles: true, cancelable: true }))")
            rb = page.evaluate("() => ({ calls: window.__rb.calls })")
            # dispatchEvent from evaluate is synchronous: the counter must
            # already have moved when evaluate returns — the direct call
            # stack that keeps the native permission prompt reachable.
            check("clipboard.gesture.sync", rb["calls"] == 1, json.dumps(rb))

            # ---- 15. Keyboard shortcut pastes with success toast -------------
            page.evaluate(STUB_SHORTCUT_CLIPBOARD)
            page.evaluate("if (document.activeElement) document.activeElement.blur()")
            page.keyboard.press("Control+Shift+V")
            page.wait_for_function(
                "() => document.getElementById('content').textContent.indexOf('Shortcut Doc') !== -1",
                timeout=6000)
            page.wait_for_timeout(250)
            sc_state = page.evaluate("""() => ({
                rendered: document.getElementById('content').textContent.indexOf('Shortcut Doc') !== -1,
                toast: document.getElementById('toast').textContent,
                err: document.getElementById('toast').classList.contains('is-error'),
            })""")
            check("shortcut.paste.success",
                  sc_state["rendered"] and "Shortcut Doc" in sc_state["toast"]
                  and not sc_state["err"], json.dumps(sc_state))

            # ---- 16. Keyboard shortcut failure path (denied) -----------------
            page.evaluate("""() => {
                const err = new Error('denied');
                err.name = 'NotAllowedError';
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { readText: () => Promise.reject(err) },
                });
            }""")
            page.keyboard.press("Control+Shift+V")
            page.wait_for_selector("#toast.show.is-error")
            page.wait_for_timeout(150)
            denied_toast = page.inner_text("#toast")
            check("shortcut.denied.toast", "denied" in denied_toast,
                  '"%s"' % denied_toast)

            # ---- 17. Help row present; publication drops it ------------------
            page.keyboard.press("?")
            page.wait_for_selector("#help-backdrop:not([hidden])")
            help_state = page.evaluate("""() => {
                const row = Array.from(document.querySelectorAll('#help-panel .help-row'))
                    .find((r) => r.querySelector('span').textContent.trim() === 'Paste from clipboard');
                if (!row) return { found: false };
                const keys = Array.from(row.querySelectorAll('.kbd')).map((k) => k.textContent.trim());
                return { found: true, keys: keys };
            }""")
            check("help.paste.row",
                  help_state["found"] and help_state["keys"] == ["Ctrl", "Shift", "V"],
                  json.dumps(help_state))
            page.keyboard.press("Escape")
            page.wait_for_timeout(120)
            pub_check = page.evaluate("""() => {
                const html = window.MDWebbook.publication.build();
                const d = new DOMParser().parseFromString(html, 'text/html');
                const rows = Array.from(
                    d.querySelectorAll('#help-panel .help-row span:first-child'))
                    .map((s) => s.textContent.trim());
                return {
                    pubFlag: html.includes('window.MDWB_PUB = {"v":1,"menu":true}'),
                    rowGone: rows.indexOf('Paste from clipboard') === -1 &&
                        rows.indexOf('Open a file') === -1,
                    readingKept: rows.indexOf('Reading settings') !== -1,
                    pasteItemGone: !d.getElementById('mi-paste'),
                    stripItemGone: !d.getElementById('mi-strip'),
                };
            }""")
            check("pub.shortcut.excluded",
                  pub_check["pubFlag"] and pub_check["rowGone"]
                  and pub_check["readingKept"] and pub_check["pasteItemGone"]
                  and pub_check["stripItemGone"],
                  json.dumps(pub_check))

            # ---- 18. Lightbox: contain, safe area, zero close overlap --------
            page.evaluate(stub_readtext_with(
                "# Lightbox\n\n![](%s/big.svg)" % ORIGIN))
            page.evaluate("document.getElementById('btn-docs').click()")
            page.click("#mi-paste")
            page.wait_for_function(
                "() => !!document.querySelector('#content img') && "
                "document.querySelector('#content img').complete",
                timeout=6000)
            page.wait_for_timeout(300)
            page.click("#content img")
            page.wait_for_selector("#lightbox:not([hidden])")
            page.wait_for_timeout(300)
            lb = page.evaluate("""() => {
                const box = document.querySelector('.lightbox');
                const img = document.getElementById('lightbox-img');
                const btn = document.getElementById('lightbox-close');
                const cs = getComputedStyle(box);
                const ics = getComputedStyle(img);
                const r = img.getBoundingClientRect();
                const b = btn.getBoundingClientRect();
                const vw = window.innerWidth, vh = window.innerHeight;
                const overlap = !(r.right <= b.left + 1 || b.right <= r.left + 1 ||
                                  r.bottom <= b.top + 1 || b.bottom <= r.top + 1);
                return {
                    fit: ics.objectFit,
                    pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
                    rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
                    btn: { l: b.left, t: b.top, r: b.right, b: b.bottom },
                    vw: vw, vh: vh,
                    inBounds: r.left >= 12 && r.top >= 12 &&
                              r.right <= vw - 12 && r.bottom <= vh - 12,
                    noOverlap: !overlap,
                    ratio: r.width / r.height,
                };
            }""")
            page.screenshot(path=os.path.join(HERE, "smoke_v186_lightbox.png"))
            check("lightbox.contain", lb["fit"] == "contain", lb["fit"])
            check("lightbox.padding",
                  float(lb["pad"][0].replace("px", "")) >= 60 and
                  all(float(p.replace("px", "")) >= 20 for p in lb["pad"][1:]),
                  json.dumps(lb["pad"]))
            check("lightbox.bounds", lb["inBounds"], json.dumps(lb["rect"]))
            check("lightbox.no.overlap", lb["noOverlap"],
                  json.dumps({"img": lb["rect"], "btn": lb["btn"]}))
            check("lightbox.ratio", abs(lb["ratio"] - 2600 / 1800) < 0.03,
                  "ratio=%.3f want=%.3f" % (lb["ratio"], 2600 / 1800))
            page.keyboard.press("Escape")
            page.wait_for_timeout(150)

            # ---- 19. Metadata: empty title clears to Untitled everywhere -----
            page.evaluate("document.getElementById('btn-docs').click()")
            page.click("#mi-meta")
            page.wait_for_selector("#meta-backdrop:not([hidden])")
            before_title = page.title()
            page.fill("#mf-title", "")
            page.click("#meta-save")
            page.wait_for_function(
                "() => document.getElementById('toast').textContent === 'Metadata saved'",
                timeout=4000)
            cleared = page.evaluate("""() => ({
                tab: document.title,
                header: document.getElementById('header-title').textContent,
                footer: document.getElementById('footer-title').textContent,
            })""")
            check("meta.empty.untitled",
                  cleared["tab"] == "Untitled" and cleared["header"] == "Untitled"
                  and cleared["footer"] == "Untitled" and before_title != "Untitled",
                  json.dumps({"before": before_title, **cleared}))
            page.evaluate("document.getElementById('btn-docs').click()")
            page.click("#mi-meta")
            page.wait_for_selector("#meta-backdrop:not([hidden])")
            reopen = page.evaluate("""() => {
                const f = document.getElementById('mf-title');
                return { value: f.value, ph: f.placeholder };
            }""")
            check("meta.empty.placeholder",
                  reopen["value"] == "" and reopen["ph"] == "Untitled",
                  json.dumps(reopen))
            page.screenshot(path=os.path.join(HERE, "smoke_v186_meta.png"))

            # ---- 20. Metadata: captured title drives every surface -----------
            page.fill("#mf-title", "Custom Book Name")
            page.fill("#mf-author", "A. Author")
            page.click("#meta-save")
            page.wait_for_function(
                "() => document.getElementById('toast').textContent === 'Metadata saved'",
                timeout=4000)
            custom = page.evaluate("""() => ({
                tab: document.title,
                header: document.getElementById('header-title').textContent,
                footer: document.getElementById('footer-title').textContent,
                name: window.MDWebbook.downloadName(),
            })""")
            check("meta.custom.title",
                  custom["tab"] == "Custom Book Name"
                  and custom["header"] == "Custom Book Name"
                  and custom["footer"] == "Custom Book Name"
                  and custom["name"] == "custom-book-name.md",
                  json.dumps(custom))
            page.evaluate("document.getElementById('btn-docs').click()")
            page.click("#mi-meta")
            page.wait_for_selector("#meta-backdrop:not([hidden])")
            reopen2 = page.evaluate(
                "() => document.getElementById('mf-title').value")
            check("meta.custom.reopen", reopen2 == "Custom Book Name", reopen2)
            page.click("#meta-cancel")
            page.wait_for_timeout(120)

            # ---- 21. toc/findbar mutual exclusion (v1.8.0 regression) --------
            page.evaluate("document.getElementById('btn-toc').click()")
            page.wait_for_timeout(150)
            toc1 = page.evaluate("document.getElementById('toc-sidebar').classList.contains('open')")
            page.keyboard.press("/")
            page.wait_for_timeout(200)
            excl1 = page.evaluate("""() => ({
                find: document.getElementById('findbar').getAttribute('data-open') === 'on',
                toc: document.getElementById('toc-sidebar').classList.contains('open') })""")
            page.click("#btn-toc")
            page.wait_for_timeout(200)
            excl2 = page.evaluate("""() => ({
                find: document.getElementById('findbar').getAttribute('data-open') === 'on',
                toc: document.getElementById('toc-sidebar').classList.contains('open') })""")
            check("toc.find.exclusive",
                  toc1 and excl1["find"] and not excl1["toc"]
                  and excl2["toc"] and not excl2["find"],
                  "toc=%s find1=%s toc2=%s" % (toc1, excl1, excl2))
            page.keyboard.press("Escape")

            # ---- 22. btn-top below the toc drawer ----------------------------
            z = page.evaluate("""() => ({
                top: getComputedStyle(document.getElementById('btn-top')).zIndex,
                toc: getComputedStyle(document.getElementById('toc-sidebar')).zIndex })""")
            check("btnTop.below.toc", int(z["top"]) < int(z["toc"]), '%s < %s' % (z["top"], z["toc"]))

            # ---- 23. Panel paddings + shared modal-x (v1.7.3 regression) -----
            panels = page.evaluate("""() => {
                const g = (sel) => { const el = document.querySelector(sel);
                    return el ? getComputedStyle(el).padding : null; };
                const xw = (sel) => getComputedStyle(document.querySelector(sel)).width;
                return { help: g('#help-panel'), meta: g('#meta-panel'),
                         openurl: g('#openurl-panel'),
                         mx: xw('#meta-close'), hx: xw('#help-close'), ux: xw('#openurl-close') };
            }""")
            check("panel.paddings",
                  panels["meta"] == "0px" and panels["openurl"] == "0px"
                  and panels["help"] == "16px",
                  json.dumps(panels))
            check("modalx.trio", panels["mx"] == "30px" and panels["hx"] == "30px"
                  and panels["ux"] == "30px",
                  '%s/%s/%s' % (panels["mx"], panels["hx"], panels["ux"]))
            page.screenshot(path=os.path.join(HERE, "smoke_v186_modal.png"))

            # ---- 24. Console clean -------------------------------------------
            check("console.clean", len(errors) == 0, "; ".join(errors[:3]))

            browser.close()
    finally:
        srv.shutdown()

    print("SMOKE " + ("OK: " if not fails else "FAILED: ") + str(len(notes)) + " checks passed")
    if fails:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
