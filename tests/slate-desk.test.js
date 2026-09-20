import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorial, slateArticles, slateFinalArticles, weekMode, bestProjBenchSwap } from "../src/domain.js";

const side = (rid, team, starters = [], bench = [], pts = 0, proj_total = 90) => ({
  rid, team, pts, starters, bench,
  proj_total, proj_covered: 9, proj_slots: 9,
});
const p = (name, pos, proj = 15, pts = 0, positions) => ({
  pid: "1", name, pos, positions: positions || [pos], slot: pos, proj, pts,
});
const g = (mid, a, b, proj_total_a, proj_total_b) => ({
  mid,
  a: side(a.rid, a.team, a.starters, a.bench, a.pts, proj_total_a),
  b: side(b.rid, b.team, b.starters, b.bench, b.pts, proj_total_b),
  margin: Math.abs(a.pts - b.pts), total: a.pts + b.pts,
});

const base = (status) => ({
  season: "2026",
  league: { url: "https://sleeper.com/leagues/1" },
  next_week: {
    week: 3, status,
    games: [
      g(1,
        { rid: 1, team: "Alpha", starters: [p("Sam RB", "RB", 20), p("Kim WR", "WR", 18)], bench: [p("Zed RB", "RB", 25)] },
        { rid: 2, team: "Beta", starters: [p("Ray RB", "RB", 19), p("Wren WR", "WR", 16)], bench: [p("Ivy WR", "WR", 12)] },
        90, 89),
      g(2,
        { rid: 3, team: "Gamma", starters: [p("Oak QB", "QB", 22)], bench: [] },
        { rid: 4, team: "Delta", starters: [p("Pine QB", "QB", 21)], bench: [] },
        95, 95),
    ],
  },
  last_week: { week: 2, games: [], top_performers: [] },
  standings: [
    { rid: 1, name: "Alpha", wins: 1, losses: 1, rank: 1 },
    { rid: 2, name: "Beta", wins: 1, losses: 1, rank: 2 },
    { rid: 3, name: "Gamma", wins: 2, losses: 0, rank: 3 },
    { rid: 4, name: "Delta", wins: 0, losses: 2, rank: 4 },
  ],
  players: [],
  transactions: [],
  articles: [],
  rivalries: [],
  trending: [],
  injuries: [],
  team_form: {},
  draft: null,
  champions: [],
  methodology: {},
});

test("slate desk builds the full pack in preview mode", () => {
  const d = base("upcoming");
  const slate = slateArticles(d);
  const ids = slate.map((a) => a.id);
  assert.deepEqual(ids, ["w3-slate", "w3-edge", "w3-bench"]);
  assert.equal(slate.every((a) => a.tag === "Slate desk"), true);
  assert.equal(slate.every((a) => a.week === 3), true);
  const edge = slate.find((a) => a.id === "w3-edge");
  // Gamma vs Delta (95-95, edge 0.00) is the tightest gap on the slate.
  assert.ok(edge.headline.includes("Gamma") && edge.headline.includes("Delta"));
  assert.ok(edge.dek.includes("0.00"));
  const bench = slate.find((a) => a.id === "w3-bench");
  // Zed RB (25) over Sam RB (20) is the biggest legal swing on the slate.
  assert.ok(bench, "bench article present");
  assert.ok(bench.headline.includes("Zed RB"));
  assert.ok(bench.headline.includes("25.00"));
  assert.ok(bench.dek.includes("5.00"));
  assert.ok(!/undefined|NaN/.test(slate.map((a) => a.headline + a.dek + a.body).join(" ")));
});

test("slate desk decider only appears while the slate is live", () => {
  const d = base("in_progress");
  d.next_week.games[1].a.pts = 41;
  d.next_week.games[1].b.pts = 39;
  const slate = slateArticles(d);
  assert.ok(slate.some((a) => a.id === "w3-decider"), "decider present when live");
  const decider = slate.find((a) => a.id === "w3-decider");
  assert.ok(decider.headline.includes("Gamma"));
  assert.ok(decider.headline.includes("2.00"));
  // Running scores appear in the slate overview.
  const overview = slate.find((a) => a.id === "w3-slate");
  assert.ok(overview.body.includes("41.00–39.00"));
});

test("slate desk has no decider when the slate is not live", () => {
  const d = base("upcoming");
  assert.equal(slateArticles(d).some((a) => a.id === "w3-decider"), false);
});

test("slate desk is empty without a slate", () => {
  const d = base("upcoming");
  d.next_week.games = [];
  assert.deepEqual(slateArticles(d), []);
});

test("slate desk and baker-decree coexist without id collisions", () => {
  const d = base("in_progress");
  d.next_week.games.push(g(5,
    { rid: 7, team: "Emery’s Hash Browns", starters: [p("Baker Mayfield", "QB", 17.27)], bench: [] },
    { rid: 8, team: "Tuten Hurts", starters: [], bench: [] },
    90, 90));
  d.standings.push(
    { rid: 7, name: "Emery’s Hash Browns", wins: 1, losses: 0, rank: 5, fpts: 108 },
    { rid: 8, name: "Tuten Hurts", wins: 0, losses: 1, rank: 6, fpts: 97.9 },
  );
  const editorial = buildEditorial(d);
  const slate = slateArticles(d);
  const all = [...editorial, ...slate];
  const ids = all.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate story ids");
  assert.ok(editorial.some((a) => a.id === "baker-decree"));
});

test("bestProjBenchSwap respects position eligibility", () => {
  const sideA = {
    starters: [p("Sam RB", "RB", 20, 0), p("Kim WR", "WR", 18, 0)],
    bench: [p("Zed QB", "QB", 30, 0)], // QB cannot replace an RB
  };
  assert.equal(bestProjBenchSwap(sideA), null);
  const sideB = { ...sideA, bench: [p("Zed RB", "RB", 25, 0)] };
  const best = bestProjBenchSwap(sideB);
  assert.equal(best.bench.name, "Zed RB");
  assert.equal(best.gain, 5);
});

test("slate desk final phase: last week's queue survives rollover, scores only", () => {
  const d = base("in_progress");
  d.last_week = {
    week: 2,
    games: [
      g(9,
        { rid: 3, team: "Gamma", starters: [p("Oak QB", "QB", 22, 33.5)], bench: [] },
        { rid: 4, team: "Delta", starters: [p("Pine QB", "QB", 21, 31.5)], bench: [] },
        95, 95),
    ],
    top_performers: [],
  };
  d.last_week.games[0].a.pts = 41;
  d.last_week.games[0].b.pts = 39;
  const final = slateFinalArticles(d);
  const ids = final.map((a) => a.id);
  assert.deepEqual(ids, ["w2-slate", "w2-decider"]);
  const decider = final.find((a) => a.id === "w2-decider");
  assert.ok(decider.headline.includes("Gamma") && decider.headline.includes("beats"));
  assert.ok(decider.body.includes("final league scores") || decider.body.includes("completed box score"));
  const overview = final.find((a) => a.id === "w2-slate");
  assert.ok(overview.body.includes("final 41.00–39.00"));
  // No pregame projection claims leak into the final phase.
  assert.ok(!overview.body.includes("projected favorite"));
});

test("weekMode unaffected by slate desk", () => {
  const m = weekMode(base("upcoming"));
  assert.equal(m.mode, "preview");
});
