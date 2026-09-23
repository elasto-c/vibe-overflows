"""v1.7.2 Chromium smoke: meta-form top padding 0, meta-edit margin 10px,
meta-pin borderless, mobile search field floor, table container-cap behaviour
(single line until 50cqw, wrap past cap, x-scroll for unbreakables, full
span, hidden bars, scroll-driven sticky edge shadows)."""
import json
import os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = "file://" + os.path.join(HERE, os.pardir, "markdown_webbook.html")
fails = []
notes = []


def check(name, cond, note=""):
    (notes if cond else fails).append(
        f"[{'PASS' if cond else 'FAIL'}] {name} {note}".rstrip()
    )


MD = """# Smoke v172

| A | B |
|---|---|
| 1 | 2 |

| Short | Long |
|---|---|
| ok | lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud |

| Name | Token |
|---|---|
| x | """ + "y" * 300 + """
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
    page.wait_for_timeout(300)

    # ---- 1. Meta panel adjustments ----------------------------------------
    meta = page.evaluate(
        """() => {
        const probe = document.createElement('div');
        probe.style.padding = '0px var(--space-5) var(--space-5)';
        document.body.appendChild(probe);
        const csP = getComputedStyle(probe);
        const expected = { l: csP.paddingLeft, b: csP.paddingBottom };
        probe.remove();
        window.MDWebbook.metaDialog.open();
        const form = document.getElementById('meta-form');
        const pin = document.querySelector('.meta-pin');
        const edit = document.getElementById('mf-desc');
        return {
            expLeft: expected.l, expBottom: expected.b,
            formTop: getComputedStyle(form).paddingTop,
            formLeft: getComputedStyle(form).paddingLeft,
            formBottom: getComputedStyle(form).paddingBottom,
            pinBw: getComputedStyle(pin).borderBottomWidth,
            pinBs: getComputedStyle(pin).borderBottomStyle,
            editM: getComputedStyle(edit).marginTop + ' ' +
                   getComputedStyle(edit).marginBottom,
            rowH: Math.round(edit.closest('.meta-row')
                        .getBoundingClientRect().height),
        };
    }"""
    )
    check("meta.form-padding", meta["formTop"] == "0px" and
          meta["formLeft"] == meta["expLeft"] and
          meta["formBottom"] == meta["expBottom"],
          f'top={meta["formTop"]} l={meta["formLeft"]} exp={meta["expLeft"]}')
    check("meta.pin-borderless",
          meta["pinBw"] == "0px" and meta["pinBs"] == "none",
          f'{meta["pinBw"]}/{meta["pinBs"]}')
    check("meta.edit-margin-10", meta["editM"] == "10px 10px", meta["editM"])
    check("meta.start-row-108", meta["rowH"] == 108,
          f'rowStart={meta["rowH"]} (88 + 2x10)')
    page.screenshot(path=HERE + "smoke_v172_meta.png")
    page.evaluate("window.MDWebbook.metaDialog.close()")

    # ---- 2. Table behaviour ------------------------------------------------
    tab = page.evaluate(
        """() => {
        const ws = [...document.querySelectorAll('#content .table-wrapper')];
        /* Count rendered line boxes of a cell's text via Range rects —
           cells in one row share their height, so height cannot tell
           wrapped from stretched. */
        const lines = (td) => {
            const target = td.querySelector('.td-cap') || td;
            const r = document.createRange();
            r.selectNodeContents(target);
            return [...r.getClientRects()].filter(x => x.width > 1).length;
        };
        const g = (w) => {
            const s = w.querySelector('.table-scroll');
            const t = w.querySelector('table');
            const tds = [...w.querySelectorAll('tbody td')];
            return {
                cw: s.clientWidth, sw: s.scrollWidth,
                tw: Math.round(t.getBoundingClientRect().width),
                lines: tds.map(lines),
                ox: getComputedStyle(s).overflowX,
                oy: getComputedStyle(s).overflowY,
                sbw: getComputedStyle(s).scrollbarWidth,
                wsb: getComputedStyle(s, '::-webkit-scrollbar').display,
                ct: getComputedStyle(w).containerType,
            };
        };
        return { narrow: g(ws[0]), wrapCase: g(ws[1]), wide: g(ws[2]) };
    }"""
    )
    # narrow table: no overflow, full span, single-line cells
    check("table.full-span",
          abs(tab["narrow"]["tw"] - tab["narrow"]["cw"]) <= 1,
          f'table={tab["narrow"]["tw"]} wrapper={tab["narrow"]["cw"]}')
    check("table.no-overflow-narrow",
          tab["narrow"]["sw"] == tab["narrow"]["cw"],
          f'sw={tab["narrow"]["sw"]} cw={tab["narrow"]["cw"]}')
    check("table.single-line-narrow",
          all(n == 1 for n in tab["narrow"]["lines"]),
          f'lines={tab["narrow"]["lines"]}')
    # long wrappable cell: single line under the cap would be 1 — it wraps;
    # the short cell stays one line; no x-overflow (cap keeps it inside)
    check("table.wrap-past-cap",
          tab["wrapCase"]["lines"][1] >= 2 and
          tab["wrapCase"]["lines"][0] == 1 and
          tab["wrapCase"]["sw"] == tab["wrapCase"]["cw"],
          f'lines={tab["wrapCase"]["lines"]} '
          f'sw={tab["wrapCase"]["sw"]} cw={tab["wrapCase"]["cw"]}')
    # unbreakable token: horizontal scroll engaged, y locked, bars hidden
    check("table.x-scroll-unbreakable",
          tab["wide"]["sw"] > tab["wide"]["cw"] and
          tab["wide"]["ox"] == "auto" and tab["wide"]["oy"] == "hidden",
          f'sw={tab["wide"]["sw"]} cw={tab["wide"]["cw"]} '
          f'ox={tab["wide"]["ox"]} oy={tab["wide"]["oy"]}')
    # the TABLE BOX itself must span the scrollable area (not ink-only
    # overflow over a truncated table)
    check("table.box-spans-scroll",
          tab["wide"]["tw"] > tab["wide"]["cw"],
          f'table={tab["wide"]["tw"]} scroller={tab["wide"]["cw"]}')
    check("table.bars-hidden",
          tab["wide"]["sbw"] == "none" and tab["wide"]["wsb"] == "none",
          f'sb={tab["wide"]["sbw"]} webkit={tab["wide"]["wsb"]}')
    check("table.container-query",
          tab["narrow"]["ct"] == "inline-size", tab["narrow"]["ct"])

    # ---- 3. Scroll-driven edge shadows (Chromium) --------------------------
    shadows = page.evaluate(
        """async () => {
        const w = [...document.querySelectorAll('#content .table-wrapper')][2];
        const s = w.querySelector('.table-scroll');
        if (!CSS.supports('animation-timeline: --table-scroll') ||
            !CSS.supports('timeline-scope: --table-scroll')) {
            return { supported: false };
        }
        const op = (sel) => getComputedStyle(w, sel).opacity;
        const grad = getComputedStyle(w, '::before').backgroundImage;
        const before0 = op('::before'), after0 = op('::after');
        s.scrollLeft = 80;
        await new Promise(r => requestAnimationFrame(() =>
            requestAnimationFrame(r)));
        const beforeScrolled = op('::before');
        s.scrollLeft = s.scrollWidth;
        await new Promise(r => requestAnimationFrame(() =>
            requestAnimationFrame(r)));
        const afterEnd = op('::after');
        s.scrollLeft = 0;
        return {
            supported: true, grad: grad.includes('gradient'),
            before0, after0, beforeScrolled, afterEnd,
        };
    }"""
    )
    if shadows.get("supported"):
        check("table.shadow-pseudos", shadows["grad"], str(shadows["grad"]))
        check("table.shadow-scroll-driven",
              float(shadows["before0"]) == 0 and
              float(shadows["beforeScrolled"]) > 0.9 and
              float(shadows["after0"]) == 1 and
              float(shadows["afterEnd"]) < 0.1,
              f'before 0->{shadows["before0"]}->{shadows["beforeScrolled"]} '
              f'after {shadows["after0"]}->{shadows["afterEnd"]}')
    else:
        notes.append("[SKIP] table.shadow-* (scroll-driven animations unsupported)")
    page.evaluate(
        "[...document.querySelectorAll('#content .table-scroll')][2]"
        ".scrollTo(0, 0)")

    # ---- 4. Mobile search field --------------------------------------------
    page.set_viewport_size({"width": 375, "height": 700})
    page.wait_for_timeout(200)
    page.keyboard.press("/")
    page.wait_for_timeout(250)
    mob = page.evaluate(
        """() => {
        const probe = document.createElement('div');
        probe.style.gap = 'var(--space-1)';
        document.body.appendChild(probe);
        const expGap = getComputedStyle(probe).gap;
        probe.remove();
        const field = document.querySelector('.search-field');
        const input = document.getElementById('find-input');
        const count = document.getElementById('find-count');
        return {
            expGap,
            gap: getComputedStyle(document.querySelector('.search-inner')).gap,
            fieldMin: getComputedStyle(field).minWidth,
            fieldW: Math.round(field.getBoundingClientRect().width),
            inputW: Math.round(input.getBoundingClientRect().width),
            countMin: getComputedStyle(count).minWidth,
            countFs: getComputedStyle(count).fontSize,
        };
    }"""
    )
    check("search.mobile-field-floor",
          mob["fieldMin"] == "140px" and mob["fieldW"] >= 140,
          f'min={mob["fieldMin"]} w={mob["fieldW"]}')
    check("search.mobile-input-usable", mob["inputW"] >= 80,
          f'inputW={mob["inputW"]}')
    check("search.mobile-count-shrinks",
          mob["countMin"] == "auto" and mob["countFs"] == "12px",
          f'min={mob["countMin"]} fs={mob["countFs"]}')
    check("search.mobile-gap", mob["gap"] == mob["expGap"],
          f'gap={mob["gap"]} exp={mob["expGap"]}')
    page.screenshot(path=HERE + "smoke_v172_mobile_search.png")

    check("console.clean", len(errors) == 0, "; ".join(errors[:3]))

    browser.close()

print("\n".join(notes))
if fails:
    print("\n".join(fails))
    print(f"\nSMOKE FAILED: {len(fails)} failure(s)")
    raise SystemExit(1)
print(f"\nSMOKE OK: {len(notes)} checks passed")
print(json.dumps({"checks": len(notes)}))
