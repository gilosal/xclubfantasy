import { test } from "node:test";
import assert from "node:assert/strict";
import { matchupCard, weekendHype, weekendNarrative, ogMeta } from "../src/domain.js";

// A two-team league: A (rid 3) and B (rid 11). A is 1-0, B is 0-1.
const d = () => ({
  season: "2026",
  league: { url: "https://sleeper.com/leagues/1" },
  next_week: {
    week: 2,
    status: "upcoming",
    games: [
      {
        mid: 1,
        margin: 0,
        total: 0,
        a: {
          rid: 3,
          team: "A",
          proj_total: 96.5,
          starters: [
            { name: "P1", pos: "QB", proj: 20, pts: 0, injury: null },
            { name: "P2", pos: "RB", proj: 15, pts: 0, injury: null },
          ],
          bench: [],
        },
        b: {
          rid: 11,
          team: "B",
          proj_total: 86.4,
          starters: [{ name: "Q1", pos: "QB", proj: 18, pts: 0, injury: null }],
          bench: [],
        },
      },
    ],
  },
  last_week: {
    week: 1,
    status: "complete",
    games: [
      {
        mid: 9,
        margin: 4.2,
        total: 200,
        a: {
          rid: 3,
          team: "A",
          pts: 105,
          starters: [
            { name: "P1", pos: "QB", slot: "QB", pts: 25 },
            { name: "P2", pos: "RB", slot: "RB", pts: 10 },
          ],
          bench: [],
        },
        b: {
          rid: 11,
          team: "B",
          pts: 100.8,
          starters: [{ name: "Q1", pos: "QB", slot: "QB", pts: 22 }],
          bench: [],
        },
      },
    ],
  },
  standings: [
    { rid: 3, wins: 1, losses: 0, ties: 0, fpts: 105, streak: "1W", rank: 1 },
    { rid: 11, wins: 0, losses: 1, ties: 0, fpts: 100.8, streak: "1L", rank: 2 },
  ],
  rivalries: [
    {
      a: "A",
      b: "B",
      a_rid: 3,
      b_rid: 11,
      a_wins: 2,
      b_wins: 1,
      ties: 0,
      gp: 3,
      rec: "2-1",
      big: { margin: 14.5, season: "2025" },
      this_week: true,
    },
  ],
  injuries: [
    { pid: "1", name: "Zed", pos: "RB", rid: 11, injury: "D", injury_chip: "D", injury_rank: 3 },
  ],
  team_form: {
    "3": [{ week: 1, pts: 105, result: "W", margin: 4.2, mid: 9 }],
    "11": [{ week: 1, pts: 100.8, result: "L", margin: 4.2, mid: 9 }],
  },
  season_top: {},
  awards: [],
  injuries_desk: null,
  current_week: 2,
  completed_week: 1,
});

test("matchupCard: preview mode projects the edge, h2h, form, injuries", () => {
  const c = matchupCard(d().next_week.games[0], d(), 2);
  assert.equal(c.mode, "preview");
  assert.equal(c.mid, 1);
  assert.equal(c.week, 2);
  assert.equal(c.fav.team, "A");
  assert.equal(c.edge, 10.1);
  assert.ok(c.h2h);
  assert.equal(c.h2h.leader, "A");
  assert.equal(c.h2h.rec, "2-1");
  assert.equal(c.a.rec, "1-0");
  assert.equal(c.a.rank, 1);
  assert.equal(c.a.pts_last, 105);
  assert.equal(c.a.result_last, "W");
  assert.equal(c.b.pts_last, 100.8);
  assert.equal(c.b.injuries.length, 1);
  assert.equal(c.b.injuries[0].name, "Zed");
  assert.equal(c.b.injuries[0].chip, "D");
  assert.equal(c.a.injuries.length, 0);
  assert.ok(c.narrative.length >= 3, "narrative should have multiple sentences");
  assert.ok(c.narrative[0].includes("10.1"), "first sentence states the projection edge");
  assert.ok(c.narrative.join(" ").includes("2-1"), "h2h mentioned");
  assert.ok(c.narrative.join(" ").includes("Zed"), "injury mentioned");
  assert.ok(!c.narrative.join(" ").includes("105"), "preview narrative must not cite final scores");
});

test("matchupCard: recap mode reports result, decider, and where it leaves them", () => {
  const c = matchupCard(d().last_week.games[0], d(), 1);
  assert.equal(c.mode, "recap");
  assert.equal(c.week, 1);
  assert.equal(c.scoreA, 105);
  assert.equal(c.scoreB, 100.8);
  assert.equal(c.margin, 4.2);
  assert.equal(c.winner.team, "A");
  assert.equal(c.top.name, "P1");
  assert.equal(c.top.pts, 25);
  assert.ok(c.battle);
  assert.equal(c.battle.slot, "QB");
  assert.ok(c.leaves.a.rec.startsWith("1-0"));
  assert.ok(c.leaves.b.rec.startsWith("0-1"));
  assert.ok(c.narrative.join(" ").includes("105"), "recap narrative states the score");
  assert.ok(c.narrative.join(" ").includes("P1"), "recap names the decider");
});

test("matchupCard: live slate with partial scores is a recap with live flag", () => {
  const p = d();
  p.next_week.status = "in_progress";
  p.next_week.games[0].a.pts = 40;
  p.next_week.games[0].b.pts = 30;
  p.next_week.games[0].total = 70;
  p.next_week.games[0].margin = 10;
  const c = matchupCard(p.next_week.games[0], p, 2);
  assert.equal(c.mode, "recap");
  assert.equal(c.live, true);
});

test("weekendNarrative: exposes pre and recap card lists", () => {
  const h = weekendNarrative(d());
  assert.equal(h.pre.length, 1);
  assert.equal(h.recap.length, 1);
  assert.equal(h.pre[0].mode, "preview");
  assert.equal(h.recap[0].mode, "recap");
  assert.equal(h.week, 2);
  assert.equal(h.lwWeek, 1);
});

test("weekendHype: close count only from preview edges", () => {
  const p = d();
  p.next_week.games[0].b.proj_total = 94; // edge 2.5 -> close
  const h = weekendHype(p);
  assert.equal(h.closeCount, 1);
});

test("ogMeta: /weekend adapts to recap vs pre-game", () => {
  const h = ogMeta("/weekend", d());
  assert.ok(h.description.toLowerCase().includes("pre-game"), h.description);
  assert.ok(h.description.includes("Week 2"));
  assert.ok(h.description.includes("recaps from Week 1"), h.description);
});
