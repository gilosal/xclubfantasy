"""Real Chromium/WebKit responsive and interaction QA, with evidence screenshots.
Use: python scripts/qa_browser.py [base_url] [output_label]
Error states are deliberately simulated and identified as such in results.
"""
import asyncio,json,pathlib,sys
from playwright.async_api import async_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
URL=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8788'
LABEL=sys.argv[2] if len(sys.argv)>2 else 'local'
OUT=ROOT/'qa'/LABEL

async def overflow(page):
    return await page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1})')

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        try:
            for width in [360,390,430,768,1440]:
                errors=[]
                ctx=await browser.new_context(viewport={'width':width,'height':900 if width>600 else 844},device_scale_factor=1,reduced_motion='reduce')
                page=await ctx.new_page()
                page.on('pageerror',lambda e:errors.append(str(e)))
                await page.goto(URL,wait_until='networkidle',timeout=60000)
                await expect(page.locator('#app')).to_be_visible(timeout=40000)
                checks={'width':width,'home_overflow':await overflow(page),'console_errors':errors}
                assert not checks['home_overflow']['overflow'],checks
                await page.screenshot(path=str(OUT/f'home-{width}.png'),full_page=True)
                if width==390: await page.screenshot(path=str(OUT/'phone-first-screen.png'))
                if width==390:
                    tnf=page.locator('.tnf-feature')
                    await expect(tnf).to_be_visible()
                    assert await tnf.count()==1
                    tnf_state=await tnf.evaluate("""el=>{const sides=[...el.querySelectorAll('.tnf-side')];const values=sides.map(s=>{const n=Number((s.querySelector('.tnf-pts')?.textContent||'').replace(/,/g,''));return Number.isFinite(n)?n:null});const favorite=sides.findIndex(s=>s.classList.contains('tnf-fav'));const expected=values.length!==2||values.some(v=>v===null)||values[0]===values[1]?-1:values[0]>values[1]?0:1;return{values,favorite,expected}}""")
                    assert tnf_state['favorite']==tnf_state['expected'],tnf_state
                    checks['tnf_projection_favorite']=tnf_state
                for nav in ['matchups','standings','players','history']:
                    await page.locator(f'[data-nav="{nav}"]').click()
                    await expect(page.locator(f'#view-{nav}')).to_be_visible()
                    assert not (await overflow(page))['overflow'],f'{width}: {nav} overflow'
                    if width in [390,1440]: await page.screenshot(path=str(OUT/f'{nav}-{width}.png'),full_page=True)
                if width==390:
                    await page.locator('[data-nav="home"]').click()
                    await page.locator('#view-home .lead .text-link').click()
                    await expect(page.locator('#articleDialog')).to_be_visible()
                    assert len(await page.locator('.article-body').inner_text())>500
                    assert not await page.locator('#articleDialog').evaluate('(e)=>e.scrollWidth>e.clientWidth+1')
                    await page.screenshot(path=str(OUT/'article-phone.png'))
                    await page.locator('#closeArticle').click()
                    await expect(page.locator('#articleDialog')).not_to_be_visible()
                    await page.locator('#followTeam').select_option('2')
                    assert 'The Strib Club Reviews' in await page.locator('.follow-summary').inner_text()
                    await page.reload(wait_until='networkidle')
                    await expect(page.locator('#followTeam')).to_have_value('2')
                    checks['follow_persistence']=True
                    await page.locator('[data-nav="matchups"]').click()
                    await page.locator('.lineup-details summary').first.click()
                    await expect(page.locator('.lineup-columns').first).to_be_visible()
                    assert 'Bench' in await page.locator('.lineup-columns').first.inner_text()
                    await page.locator('[data-match-mode="next"]').click()
                    assert await page.locator('.game').count()==6
                    await page.locator('.lineup-details summary').first.click()
                    assert not (await overflow(page))['overflow']
                    await page.screenshot(path=str(OUT/'lineup-phone.png'),full_page=True)
                    checks['recap_preview_lineups']=True
                    await page.locator('[data-nav="players"]').click()
                    await page.locator('#playerSearch').fill('Jalen Coker')
                    assert await page.locator('#playerRows tr').count()==1
                    assert 'Jalen Coker' in await page.locator('#playerRows').inner_text()
                    await page.locator('#playerSearch').fill('<img src=x onerror=alert(1)>')
                    await expect(page.locator('#playerEmpty')).to_be_visible()
                    assert await page.locator('#playerRows img').count()==0
                    await page.locator('#resetFilters').click()
                    await page.locator('#positionFilter').select_option('RB')
                    await page.locator('#availabilityFilter').select_option('free')
                    assert await page.locator('#playerRows tr').count()>0
                    assert 'Rostered' not in await page.locator('#playerRows').inner_text()
                    await page.locator('#ownerFilter').select_option('2')
                    await expect(page.locator('#playerEmpty')).to_be_visible()
                    await page.locator('#availabilityFilter').select_option('')
                    assert await page.locator('#playerRows tr').count()>0
                    await page.locator('#resetFilters').click()
                    before=await page.locator('#playerRows tr').count()
                    await page.locator('#morePlayers').click()
                    assert await page.locator('#playerRows tr').count()>before
                    checks['search_filters_empty_pagination']=True
                    await page.locator('[data-nav="history"]').click()
                    assert 'firegettleman1' in await page.locator('.champions').inner_text()
                    await page.goto(URL+'/#story/bench-notebook',wait_until='networkidle')
                    await expect(page.locator('#articleDialog')).to_be_visible()
                    await page.keyboard.press('Escape')
                    await expect(page.locator('#articleDialog')).not_to_be_visible()
                    await page.locator('[data-nav="home"]').click()
                    await page.locator('#followTeam').select_option('')
                    checks['direct_article_escape']=True
                assert not errors,errors
                results.append(checks)
                await ctx.close()
            # Failure is injected, never mistaken for a production outage.
            ctx=await browser.new_context(viewport={'width':390,'height':844})
            page=await ctx.new_page()
            await page.route('**/api/data*',lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"simulated"}'))
            await page.goto(URL,wait_until='networkidle')
            await expect(page.locator('#error')).to_be_visible()
            await page.screenshot(path=str(OUT/'simulated-error.png'))
            await page.unroute('**/api/data*')
            await page.locator('#retryBtn').click()
            await expect(page.locator('#app')).to_be_visible(timeout=40000)
            await page.route('**/api/data*',lambda route:route.fulfill(status=503,body='simulated'))
            await page.locator('#refreshBtn').click()
            await expect(page.locator('#notice')).to_contain_text('Refresh failed')
            await expect(page.locator('#app')).to_be_visible()
            results.append({'simulated_initial_error_retry':True,'simulated_refresh_failure_retains_content':True})
            await ctx.close()
        finally:await browser.close()
    (OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(json.dumps({'url':URL,'passed':results,'evidence':str(OUT)},indent=2))

asyncio.run(main())
