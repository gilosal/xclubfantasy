import asyncio, json, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa' / 'before'

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
            errors=[]
            page.on('pageerror',lambda e: errors.append(str(e)))
            await page.goto('https://xclubfantasy.robsplex.com',wait_until='domcontentloaded',timeout=40000)
            await page.wait_for_selector('#app:not(.hidden)',timeout=40000)
            await page.screenshot(path=str(OUT/'desktop.png'))
            await page.set_viewport_size({'width':390,'height':844})
            await page.screenshot(path=str(OUT/'mobile.png'))
            print(json.dumps({'errors':errors,'overflow':await page.evaluate('document.documentElement.scrollWidth > innerWidth'),'page_height':await page.evaluate('document.documentElement.scrollHeight'),'screenshots':str(OUT)}))
        finally: await browser.close()

asyncio.run(main())
