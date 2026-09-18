import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekMode,
  weeklyAwards,
  injuryDesk,
  teamPage,
  gameStory,
} from "../src/domain.js";

const team = (rid, name, wins = 0, losses = 0, ties = 0) => ({
  rid,
  uid: `u${rid}`,
  name,
  manager: `M${rid}`,
  avatar: null,
  wins,
  losses,
  ties,
  fpts: 100,
  pa: 90,
  moves: 0,
  faab_used: 0,
  streak: "",
  rank: rid,
});

const side = (rid, name, pts, starters, bench = []) => ({
  rid,
  team: name,
  pts,
  starters,
  bench,
  proj_total: null,
  proj_covered: 0,
  proj_slots: 9,
});

const starter = (name, pts, pos = "WR", slot = "WR", proj = null) => ({
  pid: name.toLowerCase().replace(/\W/g, ""),
  name,
  pos,
  team: "KC",
  slot,
  pts,
  proj,
  img: null,
  injury: null,
});

const benchP = (name, pts, pos = "WR") => ({
  pid: `b${name.toLowerCase().replace(/\W/g, "")}`,
  name,
  pos,
  team: "KC",
  pts,
  proj: null,
  img: null,
  injury: null,
});

const game = (mid, a, b, margin = Math.abs(a.pts - b.pts)) => ({
  mid,
  a,
  b,
  margin,
  total: a.pts + b.pts,
});

const base = () => ({
  season: "2026",
  completed_week: 1,
  current_week: 2,
  last_week: {
    week: 1,
    games: [
      game(1, side(1, "Alpha", 120, [starter("QB1", 25, "QB", "QB")]), side(2, "Beta", 100, [starter("QB2", 12, "QB", "QB")])),
      game(2, side(3, "Gamma", 98, [starter("WR1", 30)]), side(4, "Delta", 97, [starter("WR2", 20)])),
      game(3, side(5, "Echo", 130, [starter("RB1", 22, "RB", "RB")]), side(6, "Foxtrot", 60, [starter("RB2", 8, "RB", "RB")], [benchP("BenchStar", 28)])),
    ],
    top_performers: [],
    team_of_the_week: { rid: 5, name: "Echo", pts: 130 },
    blowout: null,
    nail_biter: null,
    average: 100,
  },
  next_week: {
    week: 2,
    status: "upcoming",
    games: [
      game(4, side(1, "Alpha", 0, [starter("QB1", 0, "QB", "QB")]), side(3, "Gamma", 0, [starter("WR1", 0)])),
    ],
  },
  league: {
    name: "Tom Byrne Memorial FF League",
    url: "https://sleeper.com/leagues/1",
    id: "1",
    size: 12,
    scoring: "Standard",
    qb: "1QB",
    faab: 100,
    playoff_teams: 6,
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN"],
  },
  standings: [
    team(1, "Alpha", 1, 0),
    team(2, "Beta", 0, 1),
    team(3, "Gamma", 0, 0, 0),
    team(4, "Delta", 0, 1),
    team(5, "Echo", 1, 0),
    team(6, "Foxtrot", 0, 1),
  ],
  power_rankings: [],
  rivalries: [],
  transactions: [],
  players: [],
  articles: [],
  draft: null,
  champions: [],
  methodology: { projections: "x", rankings: "x", history: "x", editorial: "x" },
});

// --- weekMode -------------------------------------------------------------
test("weekMode picks recap when a completed week exists and preview is upcoming", () => {
  const d = base();
  const m = weekMode(d);
  assert.equal(m.mode, "recap");
  assert.equal(m.week, 1);
  assert.equal(m.nextWeek, 2);
  assert.ok(m.leadStory);
});

test("weekMode picks preview when nothing has completed yet", () => {
  const d = base();
  d.last_week = null;
  d.completed_week = 0;
  const m = weekMode(d);
  assert.equal(m.mode, "preview");
  assert.equal(m.week, 2);
});

test("weekMode picks live when current games have scored points", () => {
  const d = base();
  d.next_week.status = "in_progress";
  const m = weekMode(d);
  assert.equal(m.mode, "live");
  assert.equal(m.week, 2);
});

test("weekMode picks complete over in_progress when scores are final", () => {
  const d = base();
  d.next_week.status = "complete";
  const m = weekMode(d);
  assert.equal(m.mode, "recap");
  assert.equal(m.week, 1);
});

test("weekMode picks offseason after the league completes", () => {
  const d = base();
  d.completed_week = 18;
  d.next_week = { week: 18, status: "complete", games: [] };
  d.last_week = { ...d.last_week, week: 18 };
  const m = weekMode(d);
  assert.equal(m.mode, "offseason");
});

test("weekMode never fabricates a live week without games", () => {
  const d = base();
  d.next_week.status = "in_progress";
  d.next_week.games = [];
  const m = weekMode(d);
  assert.equal(m.mode, "recap");
});

// --- weeklyAwards ----------------------------------------------------------
test("awards compute real winners and never fabricate ties", () => {
  const d = base();
  const awards = weeklyAwards(d);
  const tot = awards.find((a) => a.id === "team-of-the-week");
  assert.equal(tot.rid, 5);
  assert.equal(tot.value, 130);
  // No upset in this fixture: every winner has a >= win-rate record
  // (Alpha 1-0 beat Beta 0-1, Echo 1-0 beat Foxtrot 0-1, Gamma 0-0 beat Delta 0-1).
  // Gamma's 0-0 rate (0.5) is NOT worse than Delta's 0.0, so no upset award is due.
  assert.equal(awards.find((a) => a.id === "biggest-upset"), undefined);
  const close = awards.find((a) => a.id === "closest-finish");
  assert.equal(close.rid, 3);
});

test("awards skip categories when data is missing", () => {
  const d = base();
  d.last_week.games = [];
  const awards = weeklyAwards(d);
  assert.equal(awards.length, 0);
});

test("awards flag all-play losers honestly", () => {
  const d = base();
  const awards = weeklyAwards(d);
  const unlucky = awards.find((a) => a.id === "unluckiest-loss");
  // Alpha 120, Beta 100, Gamma 98, Delta 97, Echo 130, Foxtrot 60.
  // "Unluckiest loss" = lost despite a score that beat the most opponents.
  // Beta (100, lost to Alpha's 120) would have beaten 3 of 5 — the most.
  assert.equal(unlucky.rid, 2);
  assert.equal(unlucky.value, 3);
});

// --- injuryDesk -------------------------------------------------------------
test("injuryDesk lists only rostered players with injury status", () => {
  const d = base();
  d.players = [
    { pid: "1", name: "Hurt One", pos: "RB", team: "KC", rid: 1, teamName: "Alpha", injury: "Q" },
    { pid: "2", name: "Healthy One", pos: "RB", team: "KC", rid: 1, teamName: "Alpha", injury: null },
    { pid: "3", name: "IR Guy", pos: "WR", team: "KC", rid: null, teamName: null, injury: "IR" },
  ];
  const desk = injuryDesk(d);
  // IR Guy is unrostered (rid null) — the desk covers this league's teams only.
  assert.equal(desk.length, 1);
  assert.deepEqual(desk.map((p) => p.pid), ["1"]);
});

test("injuryDesk sorts by severity then name", () => {
  const d = base();
  d.players = [
    { pid: "1", name: "Questionable", pos: "RB", team: "KC", rid: 1, injury: "Q" },
    { pid: "2", name: "Out", pos: "WR", team: "KC", rid: 2, injury: "O" },
    { pid: "3", name: "Doubtful", pos: "TE", team: "KC", rid: 3, injury: "D" },
  ];
  const desk = injuryDesk(d);
  assert.deepEqual(desk.map((p) => p.pid), ["2", "3", "1"]);
});

test("injuryDesk normalizes full-word statuses and ranks real data correctly", () => {
  const d = base();
  // Real Sleeper metadata uses full words, not abbreviations.
  d.players = [
    { pid: "1", name: "Alvin Kamara", pos: "RB", team: "NO", rid: 1, injury: "Questionable" },
    { pid: "2", name: "DeZhuan Stribling", pos: "WR", team: "SF", rid: 2, injury: "Doubtful" },
    { pid: "3", name: "Torn Up", pos: "WR", team: "KC", rid: 3, injury: "Injured Reserve" },
    { pid: "4", name: "Mystery Status", pos: "TE", team: "KC", rid: 4, injury: "New Status" },
    { pid: "5", name: "Pup Guy", pos: "RB", team: "KC", rid: 5, injury: "PUP" },
  ];
  const desk = injuryDesk(d);
  // O-level (PUP) → IR → Doubtful → Questionable → unknown last, still listed.
  assert.deepEqual(desk.map((p) => p.pid), ["5", "3", "2", "1", "4"]);
  // Chips are short abbreviations suitable for the severity badge.
  assert.deepEqual(desk.map((p) => p.injury_chip), ["PUP", "IR", "D", "Q", "?"]);
});

// --- teamPage ---------------------------------------------------------------
test("teamPage assembles record, results, H2H, and injury risk", () => {
  const d = base();
  const t = teamPage(d, "1");
  assert.equal(t.rid, 1);
  assert.equal(t.record, "1-0");
  assert.equal(t.lastGame.opponent.name, "Beta");
  assert.equal(t.lastGame.result, "W");
  assert.equal(t.nextGame.opponent.name, "Gamma");
  assert.equal(t.injuries.length, 0);
});

test("teamPage handles a team with no completed games", () => {
  const d = base();
  d.completed_week = 0;
  d.last_week = null;
  const t = teamPage(d, "1");
  assert.equal(t.lastGame, null);
});

test("teamPage computes all-play record from completed weeks", () => {
  const d = base();
  d.power_rankings = [{ rid: 5, ppg: 130, all_play: "4-1" }];
  const t = teamPage(d, "5");
  assert.ok(t.allPlay.includes("-"));
});

// --- gameStory --------------------------------------------------------------
test("gameStory highlights top scorer, closest battle, and legal bench swings", () => {
  const d = base();
  // BenchStar rides Echo's bench (WR). Give Echo a low-scoring WR starter so
  // the swap is position-legal, and keep RB1 as the game's top scorer.
  d.last_week.games[2].a.starters = [starter("WR0", 6, "WR", "WR"), starter("RB1", 8, "RB", "RB")];
  d.last_week.games[2].a.bench = [benchP("BenchStar", 28)]; // bench belongs to Echo, not Foxtrot
  const g = d.last_week.games[2]; // Echo 130 vs Foxtrot 60
  const s = gameStory(g, d);
  assert.equal(s.top.name, "RB1");
  assert.equal(s.benchSwing.bench.name, "BenchStar");
  assert.equal(s.benchSwing.gain, 22); // BenchStar 28 − WR0 6
});

test("gameStory is honest when nothing swings", () => {
  const d = base();
  const g = game(9, side(1, "Alpha", 120, [starter("QB1", 25, "QB", "QB")]), side(2, "Beta", 100, [starter("QB2", 30, "QB", "QB")]));
  const s = gameStory(g, d);
  assert.equal(s.benchSwing, null);
  assert.equal(s.top.name, "QB2"); // 30 > 25: QB2 is the real top scorer
});