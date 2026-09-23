"""v1.8.0 Chromium smoke: Open-from-url feature (menu placement, meta-panel
shell modal, label-less left-aligned url field, loading state with spinner,
silent success / toast-on-failure, publication-safe), .mdx imports with the
dynamic Download label, toc/findbar mutual exclusion, btn-top below the toc
drawer, and v1.7.3 panel/modal regressions."""
import json
import os
import time
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


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda m: errors.append(m.text)
                if m.type == "error" and "Failed to load resource" not in m.text
                else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        # NOTE: "Failed to load resource" lines are the browser's own network
        # log for the deliberately-404ing route below, not app errors.
        page.goto(FILE)
        page.wait_for_function("() => window.MDWebbook && window.MDWebbook.version")

        # ---- 1. Version -----------------------------------------------------
        check("ver.1.8.0", page.evaluate("window.MDWebbook.version") == "1.8.0")

        # ---- 2. Menu placement ---------------------------------------------
        page.click("#btn-docs")
        page.wait_for_selector("#doc-menu:not([hidden])")
        mi_open = page.locator("#mi-open").bounding_box()
        mi_url = page.locator("#mi-open-url").bounding_box()
        check("menu.placement",
              mi_url and mi_open and mi_url["y"] >= mi_open["y"] + mi_open["height"] - 2
              and abs(mi_url["x"] - mi_open["x"]) < 4
              and "Open from url…" in page.inner_text("#mi-open-url"),
              f'y {mi_open["y"]:.0f}->{mi_url["y"]:.0f}')
        page.click("#mi-open-url")
        page.wait_for_selector("#openurl-backdrop:not([hidden])")

        # ---- 3. Meta-panel shell -------------------------------------------
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
                h2w: getComputedStyle(h2).fontWeight, h2s: getComputedStyle(h2).fontSize,
                xw: mcs.width, xr: mcs.borderRadius, xbg: mcs.backgroundColor,
                ih: ics.height, ialign: ics.textAlign,
                label: !!document.querySelector('label[for="mfu-url"]'),
                ph: input.placeholder,
                spinner: !!document.querySelector('#openurl-open .mbtn-spinner'),
                labelText: document.querySelector('#openurl-open .mbtn-label').textContent,
            };
        }""")
        check("modal.shell",
              shell["cls"] == "help-panel meta-panel" and shell["w"] == "520px"
              and shell["pad"] == "0px",
              f'{shell["cls"]} {shell["w"]} pad={shell["pad"]}')
        check("modal.header.voice",
              shell["h2w"] == "700" and shell["h2s"] == "16.8px",
              f'{shell["h2w"]}/{shell["h2s"]}')
        check("modal.field",
              not shell["label"] and shell["ih"] == "38px"
              and shell["ialign"] == "left"
              and shell["ph"] == "https://example.com/book.md",
              f'h={shell["ih"]} align={shell["ialign"]}')
        check("modal.close.parity",
              shell["xw"] == "30px" and shell["xr"] == "8px"
              and shell["xbg"] == "rgba(0, 0, 0, 0)" and shell["spinner"],
              f'{shell["xw"]}/{shell["xr"]}')

        # ---- 4. Loading state + silent success ------------------------------
        # Grab the request, assert the loading state mid-flight, then fulfill.
        pending = {}

        def grab_notes(route):
            pending["route"] = route

        page.route("**://example.com/notes.md", grab_notes)
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
                     cls: b.classList.contains('is-loading'),
                     spinVis: !!sp && sp.offsetWidth > 0,
                     labelHidden: getComputedStyle(b.querySelector('.mbtn-label')).display === 'none' };
        }""")
        page.screenshot(path=os.path.join(HERE, "smoke_v180_loading.png"))
        pending["route"].fulfill(status=200, headers=HEADERS, body=MD)
        page.wait_for_selector("#openurl-backdrop[hidden]", state="attached", timeout=8000)
        page.wait_for_timeout(150)
        toast_after = page.inner_text("#toast")
        check("url.loading.state",
              loading["disabled"] and loading["cls"] and loading["busy"] == "true"
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
        page.screenshot(path=os.path.join(HERE, "smoke_v180_error.png"))
        check("url.fail.toast",
              "404" in toast_txt and not after_fail["disabled"]
              and not after_fail["busy"] and after_fail["open"],
              f'"{toast_txt}" {after_fail}')
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

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
        page.wait_for_timeout(150)

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
        page.wait_for_timeout(150)

        # ---- 8. toc/findbar mutual exclusion --------------------------------
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

        # ---- 9. btn-top below the toc drawer --------------------------------
        z = page.evaluate("""() => ({
            top: getComputedStyle(document.getElementById('btn-top')).zIndex,
            toc: getComputedStyle(document.getElementById('toc-sidebar')).zIndex })""")
        check("btnTop.below.toc", int(z["top"]) < int(z["toc"]), f'{z["top"]} < {z["toc"]}')

        # ---- 10. v1.7.3 regressions: panel paddings + shared modal-x --------
        panels = page.evaluate("""() => {
            const g = (sel) => { const el = document.querySelector(sel);
                const cs = getComputedStyle(el); return cs.padding; };
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
        page.screenshot(path=os.path.join(HERE, "smoke_v180_modal.png"))

        # ---- 11. Console clean ----------------------------------------------
        check("console.clean", len(errors) == 0, "; ".join(errors[:3]))

        browser.close()

    print("SMOKE " + ("OK: " if not fails else "FAILED: ") + str(len(notes)) + " checks passed")
    if fails:
        print(json.dumps({"fails": fails}, indent=2))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
