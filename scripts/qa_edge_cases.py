"""Simulated edge cases derived from a saved real API payload; never production data writes."""
import asyncio,copy,json,pathlib,sys
from playwright.async_api import async_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
URL=sys.argv[1] if len(sys.argv)>1 else 'https://xclubfantasy.robsplex.com'
LABEL=sys.argv[2] if len(sys.argv)>2 else 'astra-review/edges-before'
BASE=json.loads((ROOT/'qa/astra-review/before/payload.json').read_text(encoding='utf8'))

async def main():
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        try:
            for case in ['no_completed_week_with_preview','malformed_refresh_retains_usable_page','follow_team_shortcut','player_score_sorting']:
                context=await browser.new_context(viewport={'width':390,'height':844})
                page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                data=copy.deepcopy(BASE)
                if case=='no_completed_week_with_preview':
                    data['last_week']=None;data['completed_week']=0
                    data['articles']=[a for a in data['articles'] if a['id']=='next-week']
                await page.route('**/api/data*',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(data)))
                try:
                    await page.goto(URL,wait_until='networkidle')
                    await expect(page.locator('#app')).to_be_visible(timeout=6000)
                    if case=='no_completed_week_with_preview':
                        await expect(page.locator('#error')).not_to_be_visible()
                        await expect(page.locator('a[data-story="next-week"]').first).to_be_visible()
                        await page.locator('[data-nav="matchups"]').click()
                        await expect(page.locator('#view-matchups')).to_be_visible()
                    elif case=='malformed_refresh_retains_usable_page':
                        before=await page.locator('#view-home').inner_html()
                        data['next_week']=None
                        await page.locator('#refreshBtn').click()
                        await expect(page.locator('#notice')).to_contain_text('Refresh failed')
                        assert await page.locator('#view-home').inner_html()==before
                        await page.locator('#followTeam').select_option('2')
                        await expect(page.locator('.follow-summary')).to_contain_text('The Strib Club Reviews')
                    elif case=='follow_team_shortcut':
                        await page.locator('[data-nav="matchups"]').click()
                        await page.locator('#matchFollow').select_option('2',timeout=3000)
                        await expect(page.locator('.game').first).to_contain_text('The Strib Club Reviews')
                    elif case=='player_score_sorting':
                        await page.locator('[data-nav="players"]').click()
                        await page.locator('#playerSort').select_option('last_pts',timeout=3000)
                        await expect(page.locator('#playerRows tr').first).to_contain_text('Caleb Williams')
                    assert not errors,errors
                    results.append({'case':case,'passed':True,'simulated':True})
                except Exception as e:
                    results.append({'case':case,'passed':False,'simulated':True,'error':str(e)[:1200],'page_errors':errors})
                finally:await context.close()
        finally:await browser.close()
    out=ROOT/'qa'/LABEL;out.mkdir(parents=True,exist_ok=True)
    (out/'results.json').write_text(json.dumps(results,indent=2),encoding='utf8')
    print(json.dumps(results,indent=2))
    assert all(r['passed'] for r in results),'Edge-case regressions remain'

if __name__=='__main__':asyncio.run(main())
