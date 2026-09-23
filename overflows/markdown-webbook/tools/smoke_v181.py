"""v1.8.1 Chromium smoke: Paste from clipboard (menu item placement, text/type
inspection with error toasts, success render) and the Fetch & embed remote
media switch (default off, off strips media on import, on rewrites image urls
to data uris over an intercepted route), the regrouped Edit HTML metadata
placement, plus the carried v1.8.0 url-modal/loading/mdx and v1.7.3 panel
regressions."""
import json
import os
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

STUB_TEXT_CLIPBOARD = """() => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { read: () => Promise.resolve([{
            types: ['text/plain'],
            getType: () => Promise.resolve(new Blob(
                ["# Pasted Doc\\n\\nHello ![x](https://img.example/gone.png) from the clipboard"],
                { type: 'text/plain' })),
        }]) },
    });
}"""

STUB_IMAGE_CLIPBOARD = """() => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { read: () => Promise.resolve([{ types: ['image/png'] }]) },
    });
}"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda m: errors.append(m.text)
                if m.type == "error" and "Failed to load resource" not in m.text
                else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(FILE)
        page.wait_for_function("() => window.MDWebbook && window.MDWebbook.version")

        # ---- 1. Version -----------------------------------------------------
        check("ver.1.8.1", page.evaluate("window.MDWebbook.version") == "1.8.1")

        # ---- 2. Menu placements ---------------------------------------------
        page.click("#btn-docs")
        page.wait_for_selector("#doc-menu:not([hidden])")
        boxes = page.evaluate("""() => {
            const g = (id) => { const el = document.getElementById(id);
                return el ? el.getBoundingClientRect() : null; };
            const next = (id) => { const el = document.getElementById(id);
                return el && el.nextElementSibling ? el.nextElementSibling : null; };
            return {
                open: g('mi-open'), url: g('mi-open-url'), paste: g('mi-paste'),
                print: g('mi-print'), meta: g('mi-meta'), embed: g('mi-embed'),
                pub: g('mi-pubmenu'),
                pasteNext: next('mi-paste') ? next('mi-paste').tagName : null,
                printNext: next('mi-print') ? next('mi-print').tagName : null,
                metaNext: next('mi-meta') ? next('mi-meta').tagName : null,
                embedChecked: document.getElementById('mi-embed').getAttribute('aria-checked'),
                embedSwitch: !!document.querySelector('#mi-embed .pub-switch .pub-knob'),
                embedLabel: document.getElementById('mi-embed').textContent.indexOf('Fetch & embed remote media') !== -1,
            };
        }""")
        check("menu.placement",
              boxes["url"] and boxes["open"] and
              boxes["url"]["y"] >= boxes["open"]["y"] + boxes["open"]["height"] - 2,
              f'open y={boxes["open"]["y"]:.0f} url y={boxes["url"]["y"]:.0f}')
        check("menu.paste.placement",
              boxes["paste"] and
              boxes["paste"]["y"] >= boxes["url"]["y"] + boxes["url"]["height"] - 2
              and boxes["pasteNext"] == "HR",
              f'url y={boxes["url"]["y"]:.0f} paste y={boxes["paste"]["y"]:.0f} next={boxes["pasteNext"]}')
        check("menu.meta.placement",
              boxes["meta"] and boxes["printNext"] == "HR"
              and boxes["meta"]["y"] > boxes["print"]["y"] + boxes["print"]["height"] - 2,
              f'print y={boxes["print"]["y"]:.0f} meta y={boxes["meta"]["y"]:.0f}')
        check("menu.embed.toggle",
              boxes["metaNext"] == "HR" and boxes["embed"]
              and boxes["embed"]["y"] > boxes["meta"]["y"] + boxes["meta"]["height"] - 2
              and boxes["embed"]["y"] < boxes["pub"]["y"]
              and boxes["embedChecked"] == "false" and boxes["embedSwitch"]
              and boxes["embedLabel"],
              f'checked={boxes["embedChecked"]} next={boxes["metaNext"]}')
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)

        # ---- 3. Url modal shell (v1.8.0 regression) -------------------------
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

        # ---- 4. Loading state + silent success ------------------------------
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
        page.screenshot(path=os.path.join(HERE, "smoke_v181_loading.png"))
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
              f'rendered={rendered} toast="{toast_after}"')

        # ---- 5. 404 failure -> toast, form re-enabled -----------------------
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
        page.screenshot(path=os.path.join(HERE, "smoke_v181_error.png"))
        check("url.fail.toast",
              "404" in toast_txt and not after_fail["disabled"]
              and not after_fail["busy"] and after_fail["open"],
              f'"{toast_txt}" {after_fail}')
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)

        # ---- 6. Unsupported extension never fetches -------------------------
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

        # ---- 7. mdx import flips the Download label -------------------------
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
              f'"{dl_label.strip()}"')
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)

        # ---- 8. Paste from clipboard: text renders, media stripped ----------
        page.route("**://img.example/gone.png",
                   lambda r: fetched.__setitem__("n", fetched["n"] + 1) or r.fulfill(
                       status=200, headers=HEADERS, body=PNG))
        page.evaluate(STUB_TEXT_CLIPBOARD)
        page.evaluate("document.getElementById('btn-docs').click()")
        page.click("#mi-paste")
        page.wait_for_function(
            "() => document.getElementById('content').textContent.indexOf('Pasted Doc') !== -1",
            timeout=6000)
        page.wait_for_timeout(250)
        paste_state = page.evaluate("""() => ({
            rendered: document.getElementById('content').textContent.indexOf('Pasted Doc') !== -1,
            noImg: !document.querySelector('#content img'),
            toast: document.getElementById('toast').textContent,
            err: document.getElementById('toast').classList.contains('is-error'),
        })""")
        check("paste.text.succeeds",
              paste_state["rendered"] and paste_state["noImg"]
              and "Pasted Doc" in paste_state["toast"] and not paste_state["err"],
              json.dumps(paste_state))

        # ---- 9. Paste guards: non-text clipboard ----------------------------
        page.evaluate(STUB_IMAGE_CLIPBOARD)
        before_txt = page.inner_text("#content")
        page.evaluate("document.getElementById('btn-docs').click()")
        page.click("#mi-paste")
        page.wait_for_selector("#toast.show.is-error")
        page.wait_for_timeout(150)
        guard_state = page.evaluate("""() => ({
            toast: document.getElementById('toast').textContent,
            same: document.getElementById('content').textContent !== '',
        })""")
        check("paste.nontext.refused",
              "any text" in guard_state["toast"],
              f'"{guard_state["toast"]}"')

        # ---- 10. Fetch & embed: pasted image becomes a data uri -------------
        page.route("**://img.example/one.png",
                   lambda r: r.fulfill(status=200, headers={
                       "content-type": "image/png",
                       "access-control-allow-origin": "*"}, body=PNG))
        page.evaluate(STUB_TEXT_CLIPBOARD.replace("gone.png", "one.png"))
        page.evaluate("document.getElementById('mi-embed').click()")
        embed_on = page.evaluate(
            "() => document.getElementById('mi-embed').getAttribute('aria-checked')")
        page.evaluate("document.getElementById('btn-docs').click()")
        page.click("#mi-paste")
        page.wait_for_function(
            "() => !!document.querySelector('#content img')", timeout=10000)
        page.wait_for_timeout(200)
        embed_state = page.evaluate("""() => {
            const img = document.querySelector('#content img');
            return { isData: img ? (img.getAttribute('src') || '').startsWith('data:image/png;base64,') : false,
                     srcHead: img ? (img.getAttribute('src') || '').slice(0, 30) : null,
                     toast: document.getElementById('toast').textContent };
        }""")
        page.screenshot(path=os.path.join(HERE, "smoke_v181_embed.png"))
        check("embed.paste.datauri",
              embed_on == "true" and embed_state["isData"],
              json.dumps(embed_state))
        page.evaluate("document.getElementById('btn-docs').click()")
        page.evaluate("document.getElementById('mi-embed').click()")  # restore off
        page.keyboard.press("Escape")

        # ---- 11. toc/findbar mutual exclusion (v1.8.0 regression) -----------
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
              f"toc={toc1} find1={excl1} toc2={excl2}")
        page.keyboard.press("Escape")

        # ---- 12. btn-top below the toc drawer -------------------------------
        z = page.evaluate("""() => ({
            top: getComputedStyle(document.getElementById('btn-top')).zIndex,
            toc: getComputedStyle(document.getElementById('toc-sidebar')).zIndex })""")
        check("btnTop.below.toc", int(z["top"]) < int(z["toc"]), f'{z["top"]} < {z["toc"]}')

        # ---- 13. Panel paddings + shared modal-x (v1.7.3 regression) --------
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
              f'{panels["mx"]}/{panels["hx"]}/{panels["ux"]}')
        page.screenshot(path=os.path.join(HERE, "smoke_v181_modal.png"))

        # ---- 14. Console clean ----------------------------------------------
        check("console.clean", len(errors) == 0, "; ".join(errors[:3]))

        browser.close()

    print("SMOKE " + ("OK: " if not fails else "FAILED: ") + str(len(notes)) + " checks passed")
    if fails:
        print(json.dumps({"fails": fails}, indent=2))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
