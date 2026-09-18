import { test } from "node:test";
import assert from "node:assert/strict";
import {
  teamForm,
  seasonTopPerformers,
  teamPage,
} from "../src/domain.js";

const row = (rid, matchup_id, pts, players_points = {}) => ({
  roster_id: rid,
  matchup_id,
  points: pts,
  custom_points: pts,
  players_points,
});

// --- teamForm ---------------------------------------------------------------
test("teamForm returns one row per completed week, oldest first, with result and margin", () => {
  const weeks = [
    [row(1, 10, 120), row(2, 10, 100)],
    [row(1, 11, 90), row(3, 11, 90)], // tie
    [row(2, 12, 110), row(1, 12, 130)],
  ];
  const form = teamForm(weeks, 1);
  assert.deepEqual(form, [
    { week: 1, pts: 120, result: "W", margin: 20, mid: 10 },
    { week: 2, pts: 90, result: "T", margin: 0, mid: 11 },
    { week: 3, pts: 130, result: "W", margin: 20, mid: 12 },
  ]);
});

test("teamForm skips weeks in which the team had no recorded game", () => {
  const weeks = [
    [row(2, 10, 100), row(3, 10, 90)],
    [row(1, 11, 120), row(3, 11, 95)],
  ];
  const form = teamForm(weeks, 1);
  assert.equal(form.length, 1);
  assert.equal(form[0].week, 2);
  assert.equal(form[0].result, "W");
});

test("teamForm handles missing opponent rows and unknown teams", () => {
  // Orphan row (no opponent in the slate) still reports the team's score.
  const form = teamForm([[row(1, 10, 110)]], 1);
  assert.equal(form.length, 1);
  assert.equal(form[0].pts, 110);
  assert.equal(form[0].result, "W"); // no opponent recorded: score stands as is
  assert.deepEqual(teamForm([[row(2, 10, 100), row(3, 10, 90)]], 99), []);
});

// --- seasonTopPerformers ----------------------------------------------------
test("seasonTopPerformers sums every recorded player across completed weeks", () => {
  const weeks = [
    [row(1, 10, 120, { A: 50, B: 20, C: 10 })],
    [row(1, 11, 90, { A: 30, D: 15 })],
  ];
  const top = seasonTopPerformers(weeks, 1);
  assert.equal(top[0].pid, "A");
  assert.equal(top[0].pts, 80);
  assert.equal(top[1].pid, "B");
  assert.equal(top[1].pts, 20);
  assert.equal(top[2].pid, "D");
});

test("seasonTopPerformers normalizes TEAM_ pids and respects the cap", () => {
  const weeks = [
    [row(1, 10, 60, { TEAM_KC: 25, A: 20, B: 20, C: 1 })],
  ];
  const top = seasonTopPerformers(weeks, 1, 3);
  assert.equal(top.length, 3);
  assert.equal(top[0].pid, "KC");
  assert.deepEqual(top.map((x) => x.pid), ["KC", "A", "B"]); // ties break deterministically
});

test("seasonTopPerformers ignores other teams and non-finite values", () => {
  const weeks = [
    [row(1, 10, 60, { A: 30, "bad": Number.NaN }), row(2, 10, 50, { E: 99 })],
  ];
  const top = seasonTopPerformers(weeks, 1);
  assert.deepEqual(top.map((x) => x.pid), ["A"]);
});

// --- teamPage deep-dive passthrough ------------------------------------------
const side = (rid, name, pts, starters, bench = []) => ({
  rid, team: name, pts, starters, bench,
  proj_total: null, proj_covered: 0, proj_slots: 9,
});
const starter = (name, pts, pos = "WR", slot = "WR", proj = null) => ({
  pid: name.toLowerCase().replace(/\W/g, ""), name, pos, team: "KC", slot,
  pts, proj, img: null, injury: null,
});
const game = (mid, a, b) => ({ mid, a, b, margin: Math.abs(a.pts - b.pts), total: a.pts + b.pts });

test("teamPage passes form, season top, draft picks, transactions, and next side", () => {
  const d = {
    season: "2026",
    completed_week: 2,
    last_week: {
      week: 2,
      games: [game(10, side(1, "Alpha", 120, [starter("QB1", 30, "QB", "QB")]), side(2, "Beta", 100, [starter("QB2", 25, "QB", "QB")])),
      game(11, side(3, "Gamma", 98, []), side(4, "Delta", 97, []))],
      top_performers: [],
    },
    next_week: {
      week: 3,
      status: "upcoming",
      games: [game(20, side(1, "Alpha", 0, [starter("QB1", 0, "QB", "QB", 18)]), side(3, "Gamma", 0, []))],
    },
    standings: [
      { rid: 1, uid: "u1", name: "Alpha", manager: "M", avatar: null, wins: 2, losses: 0, ties: 0, fpts: 240, pa: 200, moves: 1, faab_used: 5, streak: "W2", rank: 1 },
      { rid: 2, uid: "u2", name: "Beta", manager: "M", avatar: null, wins: 0, losses: 2, ties: 0, fpts: 200, pa: 240, moves: 0, faab_used: 0, streak: "", rank: 2 },
    ],
    power_rankings: [],
    rivalries: [],
    transactions: [
      { id: 9, week: 2, type: "waiver", bid: 25, adds: [{ pid: "X", name: "Waiver Guy", rid: 1, teamName: "Alpha" }], drops: [], lines: ["Waiver Guy → Alpha"] },
      { id: 8, week: 1, type: "trade", bid: null, adds: [{ pid: "Y", name: "Traded In", rid: 2, teamName: "Beta" }], drops: [{ pid: "Z", name: "Traded Out", rid: 1, teamName: "Alpha" }], lines: ["Traded In → Beta", "Alpha dropped Traded Out"] },
      { id: 7, week: 1, type: "waiver", bid: null, adds: [{ pid: "W", name: "Someone Else", rid: 2, teamName: "Beta" }], drops: [], lines: ["Someone Else → Beta"] },
    ],
    players: [],
    draft: { picks: [{ pid: "D1", name: "Draft Pick", pos: "RB", team: "KC", round: 1, pick_no: 7, owner: "Alpha", rid: 1, pts: 25.6 }, { pid: "D2", name: "Other Pick", pos: "QB", team: "CHI", round: 2, pick_no: 15, owner: "Beta", rid: 2, pts: null }] },
    team_form: { "1": [ { week: 1, pts: 120, result: "W", margin: 20, mid: 9 }, { week: 2, pts: 120, result: "W", margin: 20, mid: 10 } ] },
    season_top: { "1": [{ pid: "A1", name: "Season Star", pos: "RB", team: "KC", pts: 80, img: null, injury: null }] },
    awards: [],
  };
  const t = teamPage(d, 1);
  assert.equal(t.form.length, 2);
  assert.equal(t.form[0].week, 1);
  assert.equal(t.seasonTop[0].name, "Season Star");
  assert.equal(t.seasonTop[0].pts, 80);
  assert.deepEqual(t.draftPicks.map((p) => p.pid), ["D1"]);
  assert.deepEqual(t.tx.map((x) => x.id), [9, 8]); // both Alpha's moves, not Beta's waiver
  assert.equal(t.nextGame.side.rid, 1);
  assert.equal(t.nextGame.side.starters[0].proj, 18);
  assert.equal(t.lastGame.self.rid, 1);
});

test("teamPage deep-dive fields default to empty when payload predates them", () => {
  const d = {
    season: "2026",
    completed_week: 0,
    last_week: null,
    next_week: { week: 1, status: "upcoming", games: [] },
    standings: [{ rid: 1, uid: "u1", name: "Alpha", manager: "M", avatar: null, wins: 0, losses: 0, ties: 0, fpts: 0, pa: 0, moves: 0, faab_used: 0, streak: "", rank: 1 }],
    power_rankings: [],
    rivalries: [],
    transactions: [],
    players: [],
    draft: null,
    awards: [],
  };
  const t = teamPage(d, 1);
  assert.deepEqual(t.form, []);
  assert.deepEqual(t.seasonTop, []);
  assert.deepEqual(t.draftPicks, []);
  assert.deepEqual(t.tx, []);
  assert.equal(t.nextGame, null);
});
