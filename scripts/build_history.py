"""Build verified archive: completed regular-season games and playoff champions.
Current-season matchups are added by the Worker, never frozen into the archive.
"""
import concurrent.futures
import datetime
import json
import pathlib
import urllib.request

CUR = '1371971946459201536'
ROOT = pathlib.Path(__file__).resolve().parents[1]
API = 'https://api.sleeper.app/v1'


def get(path):
    req = urllib.request.Request(API + path, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def played_weeks(league):
    settings = league.get('settings') or {}
    end = min(settings.get('last_scored_leg') or 0, (settings.get('playoff_week_start') or 15) - 1)
    return list(range(max(1, settings.get('start_week') or 1), end + 1))


def champion_rid(league, bracket):
    if league.get('status') != 'complete':
        return None
    final = next((m for m in bracket if m.get('p') == 1 and m.get('w') is not None), None)
    return final['w'] if final else None


def main():
    chain = []
    lid = CUR
    while lid:
        league = get('/league/' + lid)
        chain.append(league)
        lid = league.get('previous_league_id')
    chain.reverse()
    seasons, h2h = [], {}
    for lg in chain:
        lid = lg['league_id']
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            endpoints = [f'/league/{lid}/users', f'/league/{lid}/rosters', f'/league/{lid}/winners_bracket']
            users, rosters, bracket = list(ex.map(get, endpoints))
            weeks = played_weeks(lg) if lid != CUR else []
            matchups = list(ex.map(get, [f'/league/{lid}/matchups/{w}' for w in weeks]))
        names = {u['user_id']: u.get('display_name') or u.get('username') or 'Unknown manager' for u in users}
        identities = {r['roster_id']: r['owner_id'] for r in rosters if r.get('owner_id')}
        table = []
        for r in rosters:
            if not r.get('owner_id'):
                continue
            s = r.get('settings') or {}
            table.append({'uid':r['owner_id'],'name':names.get(r['owner_id'],'Unknown manager'),
                'rid':r['roster_id'],'w':s.get('wins',0),'l':s.get('losses',0),'t':s.get('ties',0),
                'fpts':round((s.get('fpts') or 0)+(s.get('fpts_decimal') or 0)/100,2)})
        table.sort(key=lambda r:(-r['w']-r['t']*.5,-r['fpts']))
        for i,r in enumerate(table): r['rank']=i+1
        crid=champion_rid(lg,bracket or [])
        champion=next((r for r in table if r['rid']==crid),None)
        seasons.append({'season':lg['season'],'lid':lid,'status':lg['status'],'table':table,'champion':champion,
            'champion_source':f'{API}/league/{lid}/winners_bracket' if champion else None,'reg_weeks':len(weeks)})
        for week,rows in zip(weeks,matchups):
            groups={}
            for m in rows:
                if m.get('matchup_id') is not None: groups.setdefault(m['matchup_id'],[]).append(m)
            for sides in groups.values():
                if len(sides)!=2: continue
                a,b=sides
                ua,ub=identities.get(a['roster_id']),identities.get(b['roster_id'])
                if not ua or not ub or ua==ub: continue
                pa=a.get('custom_points') if a.get('custom_points') is not None else a.get('points',0)
                pb=b.get('custom_points') if b.get('custom_points') is not None else b.get('points',0)
                if ua>ub: ua,ub,pa,pb=ub,ua,pb,pa
                key=f'{ua}|{ub}'
                e=h2h.setdefault(key,{'a':ua,'b':ub,'gp':0,'w_a':0,'w_b':0,'t':0,'p_a':0,'p_b':0,'big':None})
                e['gp']+=1;e['w_a']+=int(pa>pb);e['w_b']+=int(pb>pa);e['t']+=int(pa==pb)
                e['p_a']=round(e['p_a']+pa,2);e['p_b']=round(e['p_b']+pb,2)
                margin=round(abs(pa-pb),2)
                if e['big'] is None or margin>e['big']['m']:
                    e['big']={'m':margin,'season':lg['season'],'week':week,'p1':pa,'p2':pb}
        print(f"{lg['season']}: {len(weeks)} archived weeks; playoff champion: {champion['name'] if champion else 'not decided'}")
    out={'generated':datetime.datetime.now(datetime.timezone.utc).isoformat(),'current_lid':CUR,
         'includes_current_season':False,'seasons':seasons,'h2h':list(h2h.values())}
    (ROOT/'public/data/history.json').write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
    print(f"Archived pairs: {len(h2h)}; genuine tied games: {sum(e['t'] for e in h2h.values())}")

if __name__=='__main__':main()
