import sys, pathlib, asyncio
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "shots")
OUT.mkdir(parents=True, exist_ok=True)
URL = (ROOT / "renderer" / "index.html").as_uri()
MOCK = (ROOT / "test" / "mock-api.js").read_text()

async def page_for(browser, scheme="light", w=1120, h=760, pre=""):
    ctx = await browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=2)
    page = await ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    await page.add_init_script(pre + MOCK)
    await page.goto(URL)
    return page, errors

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        all_errors = []

        # scanning state
        page, errs = await page_for(b, pre="window.__MOCK_SCAN_DELAY__=4000;")
        await page.wait_for_timeout(500)
        await page.screenshot(path=OUT / "0-scanning.png"); all_errors += errs

        for scheme in ["light", "dark"]:
            page, errs = await page_for(b, scheme)
            await page.wait_for_selector(".hero-figure", timeout=8000)
            await page.screenshot(path=OUT / f"1-overview-{scheme}.png")
            if scheme == "dark":
                all_errors += errs
                continue
            # node_modules category with one expanded
            await page.click('[data-view="deps"] >> nth=0')
            await page.click('.item[data-id="d4"] .expander')
            await page.screenshot(path=OUT / "2-node_modules.png")
            # leftovers
            await page.click('#nav [data-view="leftovers"]')
            await page.click('.item[data-id="w2"] .expander')
            await page.screenshot(path=OUT / "3-leftovers.png")
            # select duplicate copy to see the strip move
            await page.click('.item[data-id="c1"] .check')
            await page.screenshot(path=OUT / "3b-leftovers-selected.png")
            # review sheet
            await page.click('[data-act="review"]')
            await page.wait_for_selector(".sheet[open]"); await page.wait_for_timeout(400)
            await page.screenshot(path=OUT / "4-review.png")
            # clean + result
            await page.click('[data-act="clean-go"]')
            await page.wait_for_selector(".result-figure")
            await page.screenshot(path=OUT / "5-result.png")
            await page.click('[data-act="result-done"]')
            # no automatic re-scan: the overview shows what was freed and waits
            await page.wait_for_selector(".state h2:has-text(\"freed\")", timeout=8000)
            await page.screenshot(path=OUT / "5b-after-clean.png")
            # settings
            await page.click('#nav-settings')
            await page.screenshot(path=OUT / "6-settings.png")
            all_errors += errs

        # narrow window
        page, errs = await page_for(b, "light", 920, 620)
        await page.wait_for_selector(".hero-figure", timeout=8000)
        await page.click('#nav [data-view="build"]')
        await page.screenshot(path=OUT / "7-narrow-build.png"); all_errors += errs

        print("ERRORS:", all_errors or "none")
        await b.close()

asyncio.run(main())
