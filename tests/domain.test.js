import test from "node:test";
import assert from "node:assert/strict";
import {
  rosterPoints,
  projection,
  bestBenchSwap,
  completedWeek,
  rankStandings,
  scoreOf,
  pairGames,
  buildEditorial,
  refreshWindow,
} from "../src/domain.js";

test("Sleeper decimal component is hundredths, including leading zero and zero integer", () => {
  assert.equal(rosterPoints({ fpts: 100, fpts_decimal: 5 }, "fpts"), 100.05);
  assert.equal(rosterPoints({ fpts: 0, fpts_decimal: 75 }, "fpts"), 0.75);
});
test("custom points overrides raw points, including explicit zero", () => {
  assert.equal(scoreOf({ points: 90, custom_points: 0 }), 0);
});
test("null matchups and malformed groups are not games", () => {
  assert.equal(
    pairGames([{ matchup_id: null }, { matchup_id: null }]).length,
    0,
  );
});
test("standard projection preserves zero and does not invent missing values", () => {
  assert.equal(projection({ pts_std: 16.25 }), 16.25);
  assert.equal(projection({ pts_std: 0 }), 0);
  assert.equal(projection({ adp_dd_ppr: 1000 }), null);
  assert.equal(projection(null), null);
});
test("bench comparisons require actual eligible starting slots", () => {
  const s = {
    starters: [
      { pid: "q", name: "QB", pos: "QB", slot: "QB", pts: 0 },
      { pid: "w", name: "WR", pos: "WR", slot: "WR", pts: 12 },
    ],
    bench: [{ pid: "b", name: "Bench WR", pos: "WR", pts: 25 }],
  };
  assert.equal(bestBenchSwap(s).gain, 13);
  assert.equal(bestBenchSwap(s).starter.pid, "w");
  s.starters = [{ pid: "q", pos: "QB", slot: "QB", pts: 0 }];
  assert.equal(bestBenchSwap(s), null);
});
test("flex eligibility and missing points are handled honestly", () => {
  assert.equal(
    bestBenchSwap({
      starters: [{ pid: "r", pos: "RB", slot: "FLEX", pts: 3 }],
      bench: [{ pid: "t", pos: "TE", pts: 15 }],
    }).gain,
    12,
  );
  assert.equal(
    bestBenchSwap({
      starters: [{ pos: "RB", slot: "FLEX", pts: null }],
      bench: [{ pos: "TE", pts: 15 }],
    }),
    null,
  );
});
test("last_scored_leg is the completion authority, not a future NFL week", () => {
  assert.equal(
    completedWeek({ settings: { last_scored_leg: 1 } }, { week: 3 }),
    1,
  );
  assert.equal(
    completedWeek({ settings: { last_scored_leg: 0 } }, { week: 1 }),
    0,
  );
});
test("standings include half a win for ties", () => {
  const ranked = rankStandings([
    { rid: 1, wins: 1, losses: 1, ties: 0, fpts: 120 },
    { rid: 2, wins: 1, losses: 0, ties: 1, fpts: 100 },
  ]);
  assert.equal(ranked[0].rid, 2);
});
test("empty editorial creates no fabricated results", () => {
  assert.deepEqual(
    buildEditorial({
      last_week: null,
      next_week: { games: [] },
      transactions: [],
      standings: [],
      rivalries: [],
      league: { url: "https://sleeper.com", faab: 100 },
    }),
    [],
  );
});
test("tied games do not produce a fictional winner", () => {
  const side = { rid: 1, team: "A", pts: 70, starters: [], bench: [] };
  const g = { a: side, b: { ...side, rid: 2, team: "B" }, margin: 0 };
  const d = {
    last_week: {
      week: 1,
      games: [g],
      team_of_the_week: { name: "A", rid: 1, pts: 70 },
      nail_biter: g,
      top_performers: [],
    },
    next_week: { week: 2, games: [] },
    transactions: [],
    standings: [],
    rivalries: [],
    league: { url: "https://sleeper.com", faab: 100 },
  };
  assert.equal(
    buildEditorial(d).some((a) => a.headline.includes("wins by")),
    false,
  );
  assert.ok(buildEditorial(d).every((a) => !a.body.includes("undefined")));
});
test("refresh window: live game window polls every 2 minutes, otherwise 15", () => {
  const game = { a: { rid: 1, team: "A", pts: 10 }, b: { rid: 2, team: "B", pts: 5 } };
  const live = refreshWindow({
    week_mode: { mode: "live", week: 3 },
    next_week: { status: "in_progress", games: [game] },
  });
  assert.equal(live.live, true);
  assert.equal(live.poll_ms, 120000);
  const off = refreshWindow({
    week_mode: { mode: "preview" },
    next_week: { status: "upcoming", games: [game] },
  });
  assert.equal(off.live, false);
  assert.equal(off.poll_ms, 900000);
});
test("refresh window: in_progress status with games is live even without week_mode", () => {
  const game = { a: { rid: 1 }, b: { rid: 2 } };
  assert.equal(refreshWindow({ next_week: { status: "in_progress", games: [game] } }).live, true);
  assert.equal(refreshWindow({ next_week: { status: "in_progress", games: [] } }).live, false);
  assert.equal(refreshWindow({}).poll_ms, 900000);
});
