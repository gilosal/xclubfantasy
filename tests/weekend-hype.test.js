import { test } from "node:test";
import assert from "node:assert/strict";
import { weekendHype, ogMeta } from "../src/domain.js";

const side = (rid, team, proj_total, pts, stars) => ({
  rid,
  team,
  proj_total,
  pts,
  proj_slots: stars.length,
  proj_covered: stars.filter((s) => s.proj != null).length,
  starters: stars,
  bench: [],
});
const star = (name, pos, proj, team) => ({
  name,
  pos,
  slot: pos,
  proj,
  pts: null,
  team,
  img: null,
  injury: null,
});

const payload = (over = {}) => ({
  build: "test",
  season: 2026,
  current_week: 2,
  completed_week: 1,
  league: { size: 12, name: "Test League" },
  last_week: {
    week: 1,
    status: "complete",
    games: [
      {
        mid: 1,
        a: side("1", "Team A", null, 100, [
          star("Big Scorer", "QB", 20, "KC"),
        ]),
        b: side("2", "Team B", null, 90, [
          star("Other Guy", "RB", 15, "SF"),
        ]),
      },
    ],
  },
  next_week: {
    week: 2,
    status: "upcoming",
    games: [
      {
        mid: 10,
        a: side("1", "Team A", 100, null, [
          star("Alpha", "QB", 22, "KC"),
          star("Beta", "WR", 18, "DAL"),
        ]),
        b: side("2", "Team B", 99.5, null, [
          star("Gamma", "RB", 21, "SF"),
        ]),
      },
      {
        mid: 11,
        a: side("3", "Team C", 95, null, [
          star("Delta", "TE", 16, "GB"),
        ]),
        b: side("4", "Team D", 90, null, [
          star("Epsilon", "WR", 14, "PHI"),
        ]),
      },
      {
        mid: 12,
        a: side("5", "Team E", null, null, [
          star("NoProj", "QB", null, "NYG"),
        ]),
        b: side("6", "Team F", 88, null, [
          star("Zeta", "RB", 17, "BAL"),
        ]),
      },
    ],
  },
  standings: [
    { rid: "1", name: "Team A", wins: 1, losses: 0, ties: 0, fpts: 100, pa: 90 },
  ],
  ...over,
});

test("weekendHype: weeks, status and game count", () => {
  const h = weekendHype(payload());
  assert.equal(h.week, 2);
  assert.equal(h.status, "upcoming");
  assert.equal(h.games.length, 3);
});

test("weekendHype: projected edges and close-game flag", () => {
  const h = weekendHype(payload());
  const g10 = h.games.find((g) => g.mid === 10);
  assert.equal(g10.edge, 0.5);
  assert.equal(g10.close, true);
  const g12 = h.games.find((g) => g.mid === 12);
  // One side has no projection -> edge unavailable, never "close".
  assert.equal(g12.edge, null);
  assert.equal(g12.close, false);
});

test("weekendHype: games sort close-first, unknown edges last", () => {
  const h = weekendHype(payload());
  assert.deepEqual(
    h.games.map((g) => g.mid),
    [10, 11, 12],
  );
});

test("weekendHype: each side carries its own projected star", () => {
  const h = weekendHype(payload());
  const g10 = h.games.find((g) => g.mid === 10);
  assert.equal(g10.a.star.name, "Alpha");
  assert.equal(g10.b.star.name, "Gamma");
  assert.equal(g10.a.rid, "1");
  assert.equal(g10.b.rid, "2");
});

test("weekendHype: top stars across the slate, capped at six", () => {
  const h = weekendHype(payload());
  assert.equal(h.topStars.length, 5); // only 5 starters carry projections here
  assert.equal(h.topStars[0].name, "Alpha"); // 22
  assert.equal(h.topStars[1].name, "Gamma"); // 21
  assert.equal(h.topStars[2].name, "Zeta"); // 17
  assert.equal(h.topStars[2].team, "BAL");
  assert.equal(h.topStars[2].pos, "RB");
});

test("weekendHype: missing projections are honest", () => {
  const h = weekendHype(payload());
  const g12 = h.games.find((g) => g.mid === 12);
  assert.equal(g12.a.proj_total, null);
  assert.equal(g12.a.star, null);
  // At least one game has full projections, so edges are generally available.
  assert.equal(h.projAvailable, true);
});

test("weekendHype: no projections at all -> projAvailable false", () => {
  const p = payload();
  for (const g of p.next_week.games)
    for (const s of [g.a, g.b]) s.proj_total = null;
  const h = weekendHype(p);
  assert.equal(h.projAvailable, false);
  assert.equal(h.closeCount, 0);
});

test("weekendHype: empty slate returns empty shape", () => {
  const p = payload();
  p.next_week.games = [];
  const h = weekendHype(p);
  assert.equal(h.games.length, 0);
  assert.equal(h.closeCount, 0);
  assert.equal(h.topStars.length, 0);
  assert.equal(h.projAvailable, false);
});

test("ogMeta: home shows the week slate with close-game count", () => {
  const d = payload();
  d.awards = [];
  d.injuries = [];
  const { title, description } = ogMeta("/", d);
  assert.ok(title.startsWith("XClub Fantasy"));
  assert.ok(description.includes("Week 2"));
  assert.ok(description.includes("3 matchups"));
});

test("ogMeta: /weekend is a hype title", () => {
  const d = payload();
  const { title, description } = ogMeta("/weekend", d);
  assert.ok(title.includes("Week 2"));
  assert.ok(description.toLowerCase().includes("projected edges"));
});

test("ogMeta: unknown route falls back to the generic site card", () => {
  const d = payload();
  const { title, description } = ogMeta("/bogus", d);
  assert.ok(title.startsWith("XClub Fantasy"));
  assert.ok(description.includes("Tom Byrne"));
});
