import test from "node:test";
import assert from "node:assert/strict";
import {
  archivedWeekArticles,
  archiveWeeks,
  trackPageKey,
  TRACK_PAGES,
  buildEditorial,
  waiverDispatchArticle,
  standingsThroughWeeks,
} from "../src/domain.js";

// ---- fixtures (mirrors slate-desk.test.js conventions) -------------------
const side = (rid, team, starters = [], bench = [], pts = 0, proj_total = 90) => ({
  rid, team, pts, starters, bench,
  proj_total, proj_covered: 9, proj_slots: 9,
});
const p = (name, pos, proj = 15, pts = 0, positions, pid = "1") => ({
  pid, name, pos, team: "SEA", positions: positions || [pos], slot: pos, proj, pts,
});
const g = (mid, a, b, proj_total_a, proj_total_b) => ({
  mid,
  a: side(a.rid, a.team, a.starters, a.bench, a.pts ?? 0, proj_total_a),
  b: side(b.rid, b.team, b.starters, b.bench, b.pts ?? 0, proj_total_b),
  margin: Math.abs((a.pts ?? 0) - (b.pts ?? 0)), total: (a.pts ?? 0) + (b.pts ?? 0),
});

const completedWeek2 = {
  week: 2,
  games: [
    g(9,
      { rid: 3, team: "Gamma", pts: 33.5, starters: [p("Oak QB", "QB", 22, 33.5, null, "101")], bench: [p("Pine RB", "RB", 18, 21, null, "102")] },
      { rid: 4, team: "Delta", pts: 31.5, starters: [p("Pine QB", "QB", 21, 31.5, null, "103")], bench: [] },
      95, 95),
    g(10,
      { rid: 1, team: "Alpha", pts: 40, starters: [p("Sam RB", "RB", 20, 40, null, "201")], bench: [] },
      { rid: 2, team: "Beta", pts: 25, starters: [p("Ray RB", "RB", 19, 25, null, "202")], bench: [] },
      90, 89),
  ],
  top_performers: [],
};
const completedWeek1 = {
  week: 1,
  games: [
    g(5,
      { rid: 1, team: "Alpha", pts: 55, starters: [p("Sam RB", "RB", 18, 55, null, "201")], bench: [] },
      { rid: 2, team: "Beta", pts: 30, starters: [p("Ray RB", "RB", 17, 30, null, "202")], bench: [] },
      90, 89),
  ],
  top_performers: [],
};

const base = () => ({
  season: "2026",
  completed_week: 2,
  current_week: 3,
  league: { url: "https://sleeper.com/leagues/1", regular_end: 14 },
  last_week: completedWeek2,
  next_week: { week: 3, status: "upcoming", games: [] },
  standings: [
    { rid: 1, name: "Alpha", wins: 1, losses: 1, rank: 1 },
    { rid: 2, name: "Beta", wins: 0, losses: 2, rank: 2 },
    { rid: 3, name: "Gamma", wins: 1, losses: 1, rank: 3 },
    { rid: 4, name: "Delta", wins: 1, losses: 1, rank: 4 },
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

test("waiver dispatch covers only Wednesday's completed claims for the preceding Sleeper leg", () => {
  const d = base();
  d.current_week = 4;
  d.league.faab = 100;
  d.transactions = [
    { id: "prior", week: 3, when: Date.parse("2026-09-23T07:04:25Z"), type: "waiver", bid: 99, adds: [{ name: "Past Player", teamName: "Beta", pos: "RB" }], drops: [] },
    { id: "different-leg", week: 4, when: Date.parse("2026-09-30T07:04:25Z"), type: "waiver", bid: 101, adds: [{ name: "Wrong Leg", teamName: "Gamma", pos: "WR" }], drops: [] },
    { id: "ollie", week: 3, when: Date.parse("2026-09-30T07:04:25Z"), type: "waiver", bid: 100, adds: [{ name: "Ollie Gordon", teamName: "Alpha", pos: "RB", team: "MIA" }], drops: [{ name: "Mike Washington Jr." }] },
    { id: "sadiq", week: 3, when: Date.parse("2026-09-30T07:05:25Z"), type: "waiver", bid: 22, adds: [{ name: "Kenyon Sadiq", teamName: "Gamma", pos: "TE" }], drops: [{ name: "Dontayvion Wicks" }] },
    { id: "bears", week: 3, when: Date.parse("2026-09-30T07:06:25Z"), type: "waiver", bid: 2, adds: [{ name: "Chicago Bears", teamName: "Delta", pos: "DEF" }], drops: [] },
    { id: "packers", week: 3, when: Date.parse("2026-09-30T07:07:25Z"), type: "waiver", bid: 0, adds: [{ name: "Green Bay Packers", teamName: "Beta", pos: "DEF" }], drops: [] },
  ];
  const article = waiverDispatchArticle(d, "2026-09-30");
  assert.ok(article);
  assert.equal(article.column, true);
  assert.equal(article.period, "Week 4 · Waiver edition");
  assert.match(article.headline, /Alpha|Ollie Gordon/);
  assert.match(article.body, /\$100/);
  assert.match(article.body, /Ollie Gordon/);
  assert.match(article.body, /Mike Washington Jr\./);
  assert.match(article.body, /Kenyon Sadiq/);
  assert.match(article.body, /Chicago Bears/);
  assert.match(article.body, /4 completed claims moved \$124/);
  assert.ok(article.body.split("\n\n").length >= 6, "full roundup, not a stub");
  assert.doesNotMatch(article.body + article.dek + article.source_label, /satire|fictional|imaginary|invented|banter/i, "no satire-warning language");
  assert.doesNotMatch(article.body, /Past Player|Wrong Leg|undefined|NaN/);
  assert.match(article.source_label, /public Sleeper/);
  assert.equal(buildEditorial(d).some((a) => a.id === article.id), false, "not released before cron publication");
});

test("waiver dispatch skips a morning without verified new claims", () => {
  const d = base();
  d.current_week = 4;
  d.transactions = [
    { id: "prior", week: 3, when: Date.parse("2026-09-23T07:04:25Z"), type: "waiver", bid: 99, adds: [{ name: "Past Player", teamName: "Beta", pos: "RB" }], drops: [] },
  ];
  assert.equal(waiverDispatchArticle(d, "2026-09-30"), null);
  assert.equal(buildEditorial(d).some((a) => a.id === "w4-waiver-dispatch"), false);
});
test("historical standings are rebuilt through the selected week, not copied from live records", () => {
  const teams = Object.fromEntries([1, 2, 3, 4].map((rid) => [rid, {
    rid, name: `Team ${rid}`, wins: 9, losses: 0, ties: 0, fpts: 999,
  }]));
  const rows = [
    [
      { roster_id: 1, matchup_id: 1, points: 99, custom_points: 100 },
      { roster_id: 2, matchup_id: 1, points: 90 },
      { roster_id: 3, matchup_id: 2, points: 75 },
      { roster_id: 4, matchup_id: 2, points: 75 },
    ],
    [
      { roster_id: 1, matchup_id: 3, points: 10 },
      { roster_id: 3, matchup_id: 3, points: 20 },
      { roster_id: 2, matchup_id: 4, points: 40 },
      { roster_id: 4, matchup_id: 4, points: 30 },
    ],
  ];
  const weekOne = standingsThroughWeeks(teams, rows, 1);
  assert.deepEqual(weekOne.map((t) => [t.rid, t.wins, t.losses, t.ties]), [
    [1, 1, 0, 0], [3, 0, 0, 1], [4, 0, 0, 1], [2, 0, 1, 0],
  ]);
  const weekTwo = standingsThroughWeeks(teams, rows, 2);
  assert.deepEqual(weekTwo.map((t) => [t.rid, t.wins, t.losses, t.ties]), [
    [3, 1, 0, 1], [2, 1, 1, 0], [1, 1, 1, 0], [4, 0, 1, 1],
  ]);
  assert.equal(weekTwo.find((t) => t.rid === 1).fpts, 110);
  assert.equal(weekTwo.find((t) => t.rid === 2).fpts, 130);
});

test("archived week pack uses week-qualified home IDs and the final slate pack", () => {
  const d = base();
  const articles = archivedWeekArticles(completedWeek2, d);
  const ids = articles.map((a) => a.id);
  // Home-desk stories keep their shape but are prefixed with the week.
  assert.ok(ids.includes("w2-weekly-lead"), "weekly lead present");
  assert.ok(ids.includes("w2-fine-margins"), "fine margins present");
  // The final slate pack (identical pipeline to slate_final).
  assert.ok(ids.includes("w2-slate"));
  assert.ok(ids.includes("w2-edge"));
  assert.ok(ids.includes("w2-bench"));
  assert.ok(ids.includes("w2-decider"));
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids in the pack");
  // Every archived article is stamped with its week.
  assert.equal(articles.every((a) => a.period === "Week 2 · Final"), true);
  assert.ok(!/undefined|NaN/.test(articles.map((a) => a.headline + a.dek + a.body).join(" ")));
});

test("archived home IDs never collide with the live week's IDs", () => {
  const d = base();
  const live = buildEditorial(d).map((a) => a.id);
  const archived = archivedWeekArticles(completedWeek2, d).map((a) => a.id);
  const archivedWeek1 = archivedWeekArticles(completedWeek1, d).map((a) => a.id);
  assert.equal(live.filter((id) => archived.includes(id)).length, 0);
  assert.equal(live.filter((id) => archivedWeek1.includes(id)).length, 0);
  // Two archived weeks cannot collide with each other either.
  assert.equal(archived.filter((id) => archivedWeek1.includes(id)).length, 0);
});

test("archived week resolves the final facts from that week's box only", () => {
  const d = base();
  const articles = archivedWeekArticles(completedWeek2, d);
  const lead = articles.find((a) => a.id === "w2-weekly-lead");
  // Week 2's highest score was Alpha's 40.00 (not any later week's data).
  assert.ok(lead.headline.includes("Alpha"));
  assert.ok(lead.dek.includes("40.00"));
  const decider = articles.find((a) => a.id === "w2-decider");
  // Closest finish in Week 2 was Alpha vs Beta (40.00–25.00)? No: 15.00 apart.
  // The other game is 33.5–31.5 = 2.00 apart, so the decider is Gamma–Delta.
  assert.ok(decider.headline.includes("Gamma"));
  assert.ok(decider.headline.includes("2.00"));
});

test("archived week recomputes the draft ledger from that week's points", () => {
  const d = base();
  d.draft = {
    picks: [
      { pid: "201", name: "Sam RB", pos: "RB", pick_no: 15, round: 9, owner: "Alpha", rid: 1, pts: null },
    ],
    steals: [], busts: [], first_round: [],
  };
  const articles = archivedWeekArticles(completedWeek2, d);
  const notebook = articles.find((a) => a.id === "w2-draft-notebook");
  assert.ok(notebook, "draft notebook present for an archived week");
  // Sam RB scored 40.00 in the archived week — not the live week's number.
  assert.ok(notebook.dek.includes("40.00"));
});

test("archived draft ledger includes a drafted player who scored from the bench", () => {
  const d = base();
  d.draft = {
    picks: [
      { pid: "102", name: "Pine RB", pos: "RB", pick_no: 14, round: 8, owner: "Gamma", rid: 3, pts: null },
    ],
    steals: [], busts: [], first_round: [],
  };
  const notebook = archivedWeekArticles(completedWeek2, d).find((a) => a.id === "w2-draft-notebook");
  assert.ok(notebook);
  assert.match(notebook.dek, /21\.00/);
  assert.match(notebook.body, /whether he started or sat/);
});

test("archiveWeeks orders newest first and skips empty weeks", () => {
  const d = base();
  const weeks = archiveWeeks(d, [completedWeek1, completedWeek2, { week: 3, games: [] }, { ...completedWeek1, week: 15 }, { week: 99, games: [g(1, { rid: 1, team: "A", starters: [], bench: [], pts: 1 }, { rid: 2, team: "B", starters: [], bench: [], pts: 0 }, 1, 0)] }]);
  assert.deepEqual(weeks.map((w) => w.week), [2, 1]);
  assert.equal(weeks.every((w) => w.season === "2026"), true);
  assert.equal(weeks.every((w) => Array.isArray(w.articles) && w.articles.length > 0), true);
});

test("archivedWeekArticles is empty for a week without games", () => {
  assert.deepEqual(archivedWeekArticles({ week: 4, games: [] }, base()), []);
  assert.deepEqual(archivedWeekArticles(null, base()), []);
});

test("trackPageKey normalises pages and clamps the week bucket", () => {
  for (const pg of TRACK_PAGES)
    assert.equal(trackPageKey(pg, 0), `${pg}:0`);
  assert.equal(trackPageKey("home", 3), "home:3");
  assert.equal(trackPageKey("home", 99), "home:0"); // out of season range
  assert.equal(trackPageKey("home", 0), "home:0");
  assert.equal(trackPageKey("home", -1), "home:0");
  assert.equal(trackPageKey("home", "3"), "home:0"); // non-integer week
  assert.equal(trackPageKey("nonsense", 1), "other:1");
  assert.equal(trackPageKey(null, 1), "other:1");
});
