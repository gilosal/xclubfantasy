import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorial, weekMode, bakerSpiteMatchup } from "../src/domain.js";

// Minimal payload shaped like the real one, focused on the fields bakerDecree reads.
const side = (rid, team, starters = [], bench = []) => ({
  rid, team, pts: 0, starters, bench,
  proj_total: 90, proj_covered: 9, proj_slots: 9,
});
const bakerRow = (pts = 0, proj = 17.27) => ({
  pid: "4892", name: "Baker Mayfield", pos: "QB", positions: ["QB"],
  team: "TB", injury: null, img: null, slot: "QB", pts, proj,
});
const base = () => ({
  season: "2026",
  league: { url: "https://sleeper.com/leagues/1", faab: 100 },
  next_week: {
    week: 2, status: "upcoming",
    games: [
      { mid: 5, a: side(7, "Emery\u2019s Hash Browns", [bakerRow()]), b: side(8, "Tuten Hurts", []) },
      { mid: 6, a: side(4, "Brock Stars", []), b: side(11, "Ladd to the Bone", []) },
    ],
  },
  last_week: {
    week: 1,
    games: [
      { mid: 4, a: side(7, "Emery\u2019s Hash Browns", [bakerRow(11.64)]), b: side(10, "Chemo Induced Nacua-sea", []), margin: 2.7, total: 213.3 },
      { mid: 1, a: side(1, "Alpha", []), b: side(2, "Beta", []), margin: 10, total: 190 },
    ],
    top_performers: [],
  },
  standings: [
    { rid: 7, name: "Emery\u2019s Hash Browns", wins: 1, losses: 0, rank: 4, fpts: 108, streak: "1W" },
    { rid: 8, name: "Tuten Hurts", wins: 0, losses: 1, rank: 9, fpts: 97.92, streak: "1L" },
    { rid: 4, name: "Brock Stars", wins: 0, losses: 1, rank: 10, fpts: 93.6, streak: "1L" },
  ],
  rivalries: [
    { a: "Emery\u2019s Hash Browns", b: "Tuten Hurts", a_wins: 3, b_wins: 1, gp: 4 },
  ],
  trending: [],
  players: [{ pid: "4892", name: "Baker Mayfield", pos: "QB", team: "TB", rid: 7, teamName: "Emery\u2019s Hash Browns", last_pts: 11.64, proj: 17.27 }],
  transactions: [],
  articles: [],
  draft: null,
  champions: [],
  methodology: { projections: "x", rankings: "x", history: "x", editorial: "x" },
});

test("baker-decree is emitted when Emery starts Baker and faces Tuten Hurts", () => {
  const d = base();
  const articles = buildEditorial(d);
  const lead = articles.find(a => a.id === "baker-decree");
  assert.ok(lead, "baker-decree article present");
  assert.equal(lead.satire, true);
  assert.equal(lead.tag, "League banter");
  assert.equal(lead.rid, 7);
  assert.equal(lead.hero?.src, "/memes/baker-decree.gif", "meme hero attached");
  // real stats are woven in
  assert.ok(lead.body.includes("108.00"), "Emery week-1 points");
  assert.ok(lead.body.includes("11.64"), "Baker week-1 bench points");
  assert.ok(lead.body.includes("17.27"), "Baker week-2 projection");
  assert.ok(lead.body.includes("Brock Stars"), "spite target named");
  assert.ok(lead.body.includes("Tampa Bay Buccaneer"), "Bucs fan tie-in");
  assert.ok(!/undefined|NaN/.test(lead.headline + lead.dek + lead.body), "no leaks");
  assert.ok(articles.some(a => a.id === "weekly-lead"), "other weekly articles still built");
});

test("baker-decree becomes the home lead while the gate is active", () => {
  const d = base();
  const m = weekMode(d);
  assert.equal(m.leadStory, "baker-decree");
  assert.equal(bakerSpiteMatchup(d), true);
});

test("baker-decree self-cleans when the Emery/Tuten matchup is not upcoming", () => {
  const d = base();
  d.next_week.games = [{ mid: 1, a: side(1, "Alpha", []), b: side(2, "Beta", []) }];
  assert.equal(bakerSpiteMatchup(d), false);
  assert.equal(weekMode(d).leadStory, "weekly-lead");
  assert.equal(buildEditorial(d).some(a => a.id === "baker-decree"), false);
});

test("baker-decree does not run if Baker is not actually starting", () => {
  const d = base();
  // Move Baker to the bench: not in the starters list.
  const g = d.next_week.games[0];
  g.a.starters = [];
  g.a.bench = [bakerRow()];
  assert.equal(buildEditorial(d).some(a => a.id === "baker-decree"), false);
});

test("baker-decree falls back gracefully when standings are missing", () => {
  const d = base();
  d.standings = [];
  const articles = buildEditorial(d);
  const lead = articles.find(a => a.id === "baker-decree");
  assert.ok(lead, "still emitted with a real matchup + starting Baker");
  assert.ok(!/undefined|NaN/.test(lead.headline + lead.dek + lead.body), "no leaks without standings");
});
