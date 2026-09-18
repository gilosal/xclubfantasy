"""Accessibility audit plus mobile WebKit smoke check; test-only injection of axe."""
import asyncio,json,pathlib,sys
from playwright.async_api import async_playwright,expect
from qa_gates import qa_success
ROOT=pathlib.Path(__file__).resolve().parents[1]
URL=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8788'
LABEL=sys.argv[2] if len(sys.argv)>2 else 'local'
OUT=ROOT/'qa'/LABEL

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    axe=(ROOT/'node_modules/axe-core/axe.min.js').read_text(encoding='utf8')
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        try:
            page=await browser.new_page(viewport={'width':390,'height':844})
            await page.goto(URL,wait_until='networkidle')
            await expect(page.locator('#app')).to_be_visible(timeout=40000)
            await page.evaluate(axe)
            for view in ['home','matchups','standings','players','history']:
                await page.locator(f'[data-nav="{view}"]').click()
                await expect(page.locator(f'#view-{view}')).to_be_visible()
                result=await page.evaluate("async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})")
                violations=[{'id':v['id'],'impact':v['impact'],'help':v['help'],'nodes':[{'target':n['target'],'summary':n.get('failureSummary')} for n in v['nodes'][:8]]} for v in result['violations']]
                results.append({'view':view,'violations':violations,'passes':len(result['passes'])})
            await page.locator('[data-nav="home"]').click()
            await page.locator('.lead .text-link').click()
            await expect(page.locator('#articleDialog')).to_be_visible()
            result=await page.evaluate("async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})")
            results.append({'view':'article','violations':[{'id':v['id'],'help':v['help'],'targets':[n['target'] for n in v['nodes']]} for v in result['violations']]})
        finally:await browser.close()
        try:
            webkit=await p.webkit.launch(headless=True)
            try:
                page=await webkit.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                await page.goto(URL,wait_until='networkidle')
                await expect(page.locator('#app')).to_be_visible(timeout=40000)
                await page.screenshot(path=str(OUT/'webkit-phone.png'))
                for view in ['matchups','standings','players','history','home']:
                    await page.locator(f'[data-nav="{view}"]').click()
                    await expect(page.locator(f'#view-{view}')).to_be_visible()
                    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),view
                await page.locator('.lead .text-link').click()
                await expect(page.locator('#articleDialog')).to_be_visible()
                await page.locator('#closeArticle').click()
                await expect(page.locator('#articleDialog')).not_to_be_visible()
                assert not errors,errors
                results.append({'webkit_mobile':'pass','errors':errors})
            finally:await webkit.close()
        except Exception as e:results.append({'webkit_mobile':'blocked-or-failed','error':str(e)[:1000]})
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'accessibility.json').write_text(json.dumps(results,indent=2),encoding='utf8')
    print(json.dumps(results,indent=2))
    assert qa_success(results),'Accessibility or required WebKit checks failed; see accessibility.json'

asyncio.run(main())
