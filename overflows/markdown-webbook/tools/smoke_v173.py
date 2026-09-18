"""v1.7.3 Chromium smoke: table edge shadows gated on REAL scrollability
(.is-pannable toggled by settleTables, re-evaluated on resize — inactive
timelines must not leave raw gradients painted on non-scrolling tables),
one shared .modal-x close-button voice across modals, meta/help panel
padding isolation (meta 0, help var(--space-4)) with a coherent 1.05rem/
700 header voice, and the 720px find bar (gap 0, 30px buttons, max-content
count, slim field padding). Keeps v1.7.2 meta/table regressions alive."""
import json
import os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = "file://" + os.path.join(HERE, os.pardir, "dist", "markdown_webbook.html")
fails = []
notes = []


def check(name, cond, note=""):
    (notes if cond else fails).append(
        f"[{'PASS' if cond else 'FAIL'}] {name} {note}".rstrip()
    )


MD = """# Smoke v173

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

    # ---- 0. Version ---------------------------------------------------------
    ver = page.evaluate("window.MDWebbook.version")
    check("app.version-173", ver == "1.7.3", str(ver))

    # ---- 1. Shadow gating: only pannable tables carry shadows ---------------
    gate = page.evaluate(
        """() => {
        const ws = [...document.querySelectorAll('#content .table-wrapper')];
        const state = (w) => {
            const s = w.querySelector('.table-scroll');
            return {
                cls: w.classList.contains('is-pannable'),
                bContent: getComputedStyle(w, '::before').content,
                aContent: getComputedStyle(w, '::after').content,
                bGrad: getComputedStyle(w, '::before').backgroundImage,
                sw: s.scrollWidth, cw: s.clientWidth,
            };
        };
        return { n: ws.length, narrow: state(ws[0]), wrap: state(ws[1]),
                 wide: state(ws[2]) };
    }"""
    )
    for key in ("narrow", "wrap"):
        g = gate[key]
        check(f"table.no-shadow-when-static.{key}",
              g["cls"] is False and g["bContent"] == "none" and
              g["aContent"] == "none" and g["bGrad"] == "none" and
              g["sw"] == g["cw"],
              f'cls={g["cls"]} content={g["bContent"]} grad={g["bGrad"]} '
              f'sw={g["sw"]} cw={g["cw"]}')
    gw = gate["wide"]
    check("table.shadow-when-pannable",
          gw["cls"] is True and gw["bContent"] != "none" and
          "gradient" in gw["bGrad"] and gw["sw"] > gw["cw"],
          f'cls={gw["cls"]} content={gw["bContent"]} '
          f'sw={gw["sw"]} cw={gw["cw"]}')

    # ---- 2. Scroll-driven opacities on the pannable table (Chromium) --------
    if page.evaluate(
        "CSS.supports('animation-timeline: --table-scroll') && "
        "CSS.supports('timeline-scope: --table-scroll')"):
        opac = page.evaluate(
            """async () => {
            const w = [...document.querySelectorAll('#content .table-wrapper')][2];
            const s = w.querySelector('.table-scroll');
            const op = (sel) => parseFloat(getComputedStyle(w, sel).opacity);
            const raf = () => new Promise(r => requestAnimationFrame(() =>
                requestAnimationFrame(r)));
            const b0 = op('::before'), a0 = op('::after');
            s.scrollLeft = 80; await raf();
            const bMid = op('::before');
            s.scrollLeft = s.scrollWidth; await raf();
            const aEnd = op('::after');
            s.scrollTo(0, 0); await raf();
            return { b0, a0, bMid, aEnd };
        }"""
        )
        check("table.shadow-scroll-driven",
              opac["b0"] == 0 and opac["bMid"] > 0.9 and
              opac["a0"] == 1 and opac["aEnd"] < 0.1,
              f'before {opac["b0"]}->{opac["bMid"]} '
              f'after {opac["a0"]}->{opac["aEnd"]}')
    else:
        notes.append("[SKIP] table.shadow-scroll-driven (no SDA support)")

    # ---- 3. Re-evaluation: settle pass re-gates on resize -------------------
    regate = page.evaluate(
        """async () => {
        const t3 = [...document.querySelectorAll('#content table')][2];
        t3.querySelectorAll('tbody td .td-cap')[1].textContent = 'short';
        window.dispatchEvent(new Event('resize'));
        await new Promise(r => setTimeout(r, 450));
        const w = t3.closest('.table-wrapper');
        const s = w.querySelector('.table-scroll');
        return {
            cls: w.classList.contains('is-pannable'),
            bContent: getComputedStyle(w, '::before').content,
            pinned: t3.style.minWidth,
            sw: s.scrollWidth, cw: s.clientWidth,
        };
    }"""
    )
    check("table.regate-on-resize",
          regate["cls"] is False and regate["bContent"] == "none" and
          regate["pinned"] == "" and regate["sw"] == regate["cw"],
          f'cls={regate["cls"]} content={regate["bContent"]} '
          f'pin="{regate["pinned"]}" sw={regate["sw"]} cw={regate["cw"]}')
    # restore the unbreakable token and re-settle for later sections
    page.evaluate(
        """() => {
        const t3 = [...document.querySelectorAll('#content table')][2];
        t3.querySelectorAll('tbody td .td-cap')[1].textContent = 'y'.repeat(300);
        window.dispatchEvent(new Event('resize'));
    }"""
    )
    page.wait_for_timeout(400)

    # ---- 4. Shared .modal-x close buttons -----------------------------------
    closes = page.evaluate(
        """() => {
        window.MDWebbook.metaDialog.open();
        const probe = (el) => {
            const cs = getComputedStyle(el);
            const svg = getComputedStyle(el.querySelector('svg'));
            return { w: cs.width, h: cs.height, r: cs.borderRadius,
                     bg: cs.backgroundColor, col: cs.color,
                     pad: cs.padding, sw: svg.width, sh: svg.height };
        };
        const m = probe(document.getElementById('meta-close'));
        const h = probe(document.getElementById('help-close'));
        return { m, h,
                 mcls: document.getElementById('meta-close').className,
                 hcls: document.getElementById('help-close').className };
    }"""
    )
    check("modalx.same-voice",
          closes["m"] == closes["h"] and closes["mcls"] == "modal-x" and
          closes["hcls"] == "modal-x",
          f'meta={closes["m"]} help={closes["h"]}')
    check("modalx.30px-square",
          closes["m"]["w"] == "30px" and closes["m"]["h"] == "30px" and
          closes["m"]["sw"] == "16px" and closes["m"]["sh"] == "16px",
          f'{closes["m"]["w"]}x{closes["m"]["h"]} svg {closes["m"]["sw"]}')
    page.screenshot(path=os.path.join(HERE, "smoke_v173_meta.png"))
    page.evaluate("window.MDWebbook.metaDialog.close()")

    # ---- 5. Panel isolation + coherent header voice -------------------------
    page.evaluate("window.MDWebbook.metaDialog.open()")
    page.wait_for_timeout(200)
    meta_p = page.evaluate(
        """() => {
        const mp = document.getElementById('meta-panel');
        return {
            metaPad: getComputedStyle(mp).padding,
            metaRadius: getComputedStyle(mp).borderRadius,
            metaW: Math.round(mp.getBoundingClientRect().width),
            mHw: getComputedStyle(mp.querySelector('.meta-head h2')).fontWeight,
            mHs: getComputedStyle(mp.querySelector('.meta-head h2')).fontSize,
        };
    }"""
    )
    page.evaluate("window.MDWebbook.metaDialog.close()")
    page.evaluate(
        "window.MDWebbook.help && window.MDWebbook.help.open && "
        "window.MDWebbook.help.open()")
    page.wait_for_timeout(250)
    if page.evaluate("document.getElementById('help-panel').hidden"):
        page.keyboard.press("?")
        page.wait_for_timeout(250)
    help_p = page.evaluate(
        """() => {
        const hp = document.getElementById('help-panel');
        return {
            helpPad: getComputedStyle(hp).padding,
            helpRadius: getComputedStyle(hp).borderRadius,
            hTw: getComputedStyle(hp.querySelector('.help-title')).fontWeight,
            hTs: getComputedStyle(hp.querySelector('.help-title')).fontSize,
        };
    }"""
    )
    check("panel.help-pad-space4",
          help_p["helpPad"] == "16px", help_p["helpPad"])
    check("panel.meta-pad-zero",
          meta_p["metaPad"] == "0px" and meta_p["metaW"] == 520,
          f'pad={meta_p["metaPad"]} w={meta_p["metaW"]}')
    check("panel.same-radius",
          help_p["helpRadius"] == meta_p["metaRadius"],
          f'{help_p["helpRadius"]} / {meta_p["metaRadius"]}')
    check("panel.header-voice",
          help_p["hTw"] == "700" and meta_p["mHw"] == "700" and
          help_p["hTs"] == meta_p["mHs"],
          f'help {help_p["hTw"]}/{help_p["hTs"]} '
          f'meta {meta_p["mHw"]}/{meta_p["mHs"]}')
    page.screenshot(path=os.path.join(HERE, "smoke_v173_help.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # ---- 6. Meta v1.7.2 regressions -----------------------------------------
    meta = page.evaluate(
        """() => {
        window.MDWebbook.metaDialog.open();
        const form = document.getElementById('meta-form');
        const pin = document.querySelector('.meta-pin');
        const edit = document.getElementById('mf-desc');
        return {
            formTop: getComputedStyle(form).paddingTop,
            formLeft: getComputedStyle(form).paddingLeft,
            formBottom: getComputedStyle(form).paddingBottom,
            pinBw: getComputedStyle(pin).borderBottomWidth,
            editM: getComputedStyle(edit).marginTop + ' ' +
                   getComputedStyle(edit).marginBottom,
            rowH: Math.round(edit.closest('.meta-row')
                        .getBoundingClientRect().height),
        };
    }"""
    )
    check("meta.form-padding",
          meta["formTop"] == "0px" and meta["formLeft"] == "20px" and
          meta["formBottom"] == "20px",
          f't={meta["formTop"]} l={meta["formLeft"]} b={meta["formBottom"]}')
    check("meta.pin-borderless", meta["pinBw"] == "0px", meta["pinBw"])
    check("meta.edit-margin-10", meta["editM"] == "10px 10px", meta["editM"])
    check("meta.start-row-108", meta["rowH"] == 108,
          f'rowStart={meta["rowH"]} (88 + 2x10)')
    page.evaluate("window.MDWebbook.metaDialog.close()")

    # ---- 7. 720px find bar ---------------------------------------------------
    page.set_viewport_size({"width": 375, "height": 700})
    page.wait_for_timeout(250)
    page.keyboard.press("/")
    page.wait_for_timeout(250)
    page.fill("#find-input", "lorem")
    page.wait_for_timeout(250)
    mob = page.evaluate(
        """() => {
        const probe = document.createElement('div');
        probe.style.gap = '0';
        document.body.appendChild(probe);
        const expGap = getComputedStyle(probe).gap;
        probe.remove();
        const field = document.querySelector('.search-field');
        const input = document.getElementById('find-input');
        const count = document.getElementById('find-count');
        const b = document.getElementById('find-prev');
        const cs = getComputedStyle(b);
        const ccs = getComputedStyle(count);
        const fcs = getComputedStyle(field);
        return {
            expGap,
            gap: getComputedStyle(document.querySelector('.search-inner')).gap,
            btnW: cs.width, btnR: Math.round(b.getBoundingClientRect().width),
            nextW: getComputedStyle(document.getElementById('find-next')).width,
            closeW: getComputedStyle(document.getElementById('find-close')).width,
            countMax: ccs.maxWidth, countMin: ccs.minWidth,
            countFs: ccs.fontSize,
            countW: Math.round(count.getBoundingClientRect().width),
            fPadL: fcs.paddingLeft, fPadR: fcs.paddingRight,
            fW: Math.round(field.getBoundingClientRect().width),
            inputW: Math.round(input.getBoundingClientRect().width),
        };
    }"""
    )
    check("search.mobile-gap-zero", mob["gap"] == mob["expGap"],
          f'gap={mob["gap"]} exp={mob["expGap"]}')
    check("search.mobile-btn-30",
          mob["btnW"] == "30px" and mob["btnR"] == 30 and
          mob["nextW"] == "30px" and mob["closeW"] == "30px",
          f'prev={mob["btnW"]}/{mob["btnR"]} next={mob["nextW"]} '
          f'close={mob["closeW"]}')
    check("search.mobile-count-max-content",
          mob["countMax"] == "none" and mob["countMin"] == "0px" and
          mob["countFs"] == "12px" and 0 < mob["countW"] <= 70,
          f'max={mob["countMax"]} min={mob["countMin"]} '
          f'fs={mob["countFs"]} w={mob["countW"]}')
    check("search.mobile-field-pad",
          mob["fPadL"] == "8px" and mob["fPadR"] == "8px" and
          mob["fW"] >= 140 and mob["inputW"] >= 80,
          f'pad={mob["fPadL"]}/{mob["fPadR"]} field={mob["fW"]} '
          f'input={mob["inputW"]}')
    page.screenshot(path=os.path.join(HERE, "smoke_v173_mobile_search.png"))

    check("console.clean", len(errors) == 0, "; ".join(errors[:3]))

    browser.close()

print("\n".join(notes))
if fails:
    print("\n".join(fails))
    print(f"\nSMOKE FAILED: {len(fails)} failure(s)")
    raise SystemExit(1)
print(f"\nSMOKE OK: {len(notes)} checks passed")
print(json.dumps({"checks": len(notes)}))
