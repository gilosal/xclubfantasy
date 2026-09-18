import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../src/domain.js';

const league=(done,status='in_season')=>({season:'2026',status,settings:{last_scored_leg:done,leg:2}});
const state=(week=2)=>({season:'2026',season_type:'regular',week});
test('week handoff advances the preview when NFL state still shows the completed week',()=>{
  assert.deepEqual(domain.weekWindow(league(2),state(2)),{current:2,completed:2,matchup:3});
});
test('in-progress weeks remain the current matchup; season completion has no phantom week 19',()=>{
  assert.deepEqual(domain.weekWindow(league(1),state(2)),{current:2,completed:1,matchup:2});
  assert.deepEqual(domain.weekWindow(league(18,'complete'),state(18)),{current:18,completed:18,matchup:18});
  assert.equal(domain.weekWindow(league(17,'complete'),state(18)).matchup,17);
});
test('missing completion metadata never imports a different NFL season into this league',()=>{
  assert.equal(domain.completedWeek({season:'2026',settings:{}},{season:'2027',week:8}),0);
});
const side=(rid,team,pts)=>({rid,team,pts,proj_total:90,starters:[],bench:[]});
function payload(status='complete',week=1){
  const a=side(1,'Alpha',100),b=side(2,'Beta',90);
  return {league:{url:'https://sleeper.com',faab:100},last_week:{week:1,games:[{a,b,margin:10,total:190}],top_performers:[]},next_week:{week,status,games:[{a,b,margin:0,total:180}]},transactions:[],standings:[],rivalries:[]};
}
test('finished games do not get preview articles or next-up copy',()=>{
  const articles=domain.buildEditorial(payload());
  assert.equal(articles.some(a=>a.id==='next-week'),false);
  assert.equal(articles.some(a=>a.body.includes('Next up:')),false);
});
test('in-progress matchup coverage does not call games a future kickoff',()=>{
  const articles=domain.buildEditorial(payload('in_progress',2));
  assert.equal(articles.some(a=>a.id==='next-week'),false);
  assert.equal(articles.some(a=>a.body.includes('Next up:')),false);
});
test('upcoming matchup still receives its preview',()=>{
  assert.equal(domain.buildEditorial(payload('upcoming',2)).some(a=>a.id==='next-week'),true);
});
