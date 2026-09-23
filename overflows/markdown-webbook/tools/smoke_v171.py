"""v1.7.1 Chromium smoke: help-panel zero padding, meta-row 6px vertical
margins (start label + description editor), labels follow the theme typeface."""
import json
import os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = "file://" + os.path.join(HERE, os.pardir, "markdown_webbook.html")
OUT = HERE + os.sep
fails = []
notes = []


def check(name, cond, note=""):
    (notes if cond else fails).append(
        f"[{'PASS' if cond else 'FAIL'}] {name} {note}".rstrip()
    )


MD = """# Smoke v171

Some prose so the reader renders.

```js
const a = 1;
```
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(FILE)
    page.wait_for_timeout(400)
    page.evaluate("md => window.MDWebbook.openMarkdown(md)", MD)
    page.wait_for_timeout(250)

    # ---- 1. Help panel: zero padding --------------------------------------
    help_res = page.evaluate(
        """() => {
        const el = document.getElementById('help-panel');
        const cs = getComputedStyle(el);
        return {
            pad: cs.paddingTop + ' ' + cs.paddingRight + ' ' +
                 cs.paddingBottom + ' ' + cs.paddingLeft,
            title: getComputedStyle(el.querySelector('.help-title')).marginLeft,
        };
    }"""
    )
    check("help.padding-zero",
          help_res["pad"] == "0px 0px 0px 0px", help_res["pad"])

    # open it for a real screenshot (shortcut map via the app API)
    page.evaluate("window.MDWebbook.help && window.MDWebbook.help.open && window.MDWebbook.help.open()")
    page.wait_for_timeout(200)
    page.screenshot(path=OUT + "smoke_v171_help.png")
    page.keyboard.press("Escape")

    # ---- 2. Meta panel: 6px vertical margins ------------------------------
    meta = page.evaluate(
        """() => {
        window.MDWebbook.metaDialog.open();
        const label = document.querySelector('.meta-row-start label');
        const edit = document.getElementById('mf-desc');
        const csL = getComputedStyle(label);
        const csE = getComputedStyle(edit);
        return {
            labelM: csL.marginTop + ' ' + csL.marginBottom,
            editM: csE.marginTop + ' ' + csE.marginBottom,
            rowStartH: Math.round(edit.closest('.meta-row')
                        .getBoundingClientRect().height),
        };
    }"""
    )
    check("meta.start-label-margin-6", meta["labelM"] == "6px 6px" or
          meta["labelM"] == "6px", meta["labelM"])
    check("meta.edit-margin-6", meta["editM"] == "6px 6px" or
          meta["editM"] == "6px", meta["editM"])
    check("meta.start-row-100", meta["rowStartH"] == 100,
          f'rowStart={meta["rowStartH"]} (88 editor + 2x6 margin)')
    page.screenshot(path=OUT + "smoke_v171_meta.png")

    # ---- 3. Label typeface follows the theme ------------------------------
    fam = page.evaluate(
        """() => {
        const label = document.querySelector('.meta-row label');
        const body = document.body;
        const serifProbe = document.createElement('span');
        serifProbe.style.fontFamily = 'var(--font-serif)';
        document.body.appendChild(serifProbe);
        const serifStack = getComputedStyle(serifProbe).fontFamily;
        serifProbe.remove();
        return {
            label: getComputedStyle(label).fontFamily,
            body: getComputedStyle(body).fontFamily,
            serif: serifStack,
        };
    }"""
    )
    check("label.follows-theme-sans",
          fam["label"] == fam["body"] and "Charter" not in fam["label"],
          f'label={fam["label"][:48]}… body={fam["body"][:48]}…')

    # flip the reading typeface to serif: the label must follow
    fam_serif = page.evaluate(
        """() => {
        document.documentElement.setAttribute('data-family', 'serif');
        const label = document.querySelector('.meta-row label');
        return getComputedStyle(label).fontFamily;
    }"""
    )
    check("label.follows-theme-serif",
          fam_serif == fam["serif"], f'label={fam_serif[:48]}…')
    page.evaluate("document.documentElement.setAttribute('data-family', 'sans')")
    page.evaluate("window.MDWebbook.metaDialog.close()")

    # ---- 4. Console hygiene ------------------------------------------------
    check("console.clean", len(errors) == 0, "; ".join(errors[:3]))
    page.screenshot(path=OUT + "smoke_v171_reader.png")

    browser.close()

print("\n".join(notes))
if fails:
    print("\n".join(fails))
    print(f"\nSMOKE FAILED: {len(fails)} failure(s)")
    raise SystemExit(1)
print(f"\nSMOKE OK: {len(notes)} checks passed")
print(json.dumps({"checks": len(notes)}))
