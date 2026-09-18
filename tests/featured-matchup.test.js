import { test } from "node:test";
import assert from "node:assert/strict";
import { featuredMatchup, weekendNarrative, weekMode } from "../src/domain.js";

const side = (rid, team, proj_total, pts) => ({
  rid,
  team,
  proj_total,
  pts,
  starters: [],
  bench: [],
});
const standings = [
  { rid: "1", name: "Team A", rank: 1, wins: 1, losses: 0, ties: 0, streak: "W1" },
  { rid: "2", name: "Team B", rank: 2, wins: 0, losses: 1, ties: 0, streak: "L1" },
  { rid: "3", name: "Team C", rank: 3, wins: 0, losses: 1, ties: 0, streak: "L1" },
  { rid: "4", name: "Team D", rank: 4, wins: 0, losses: 1, ties: 0, streak: "L1" },
  { rid: "5", name: "Team E", rank: 5, wins: 0, losses: 1, ties: 0, streak: "L1" },
  { rid: "6", name: "Team F", rank: 6, wins: 0, losses: 1, ties: 0, streak: "L1" },
];

// No completed games yet: weekMode is "preview", so the feature comes from
// the upcoming slate's projections.
const previewBase = {
  build: "test",
  season: 2026,
  current_week: 1,
  completed_week: 0,
  league: { size: 12, name: "Test League" },
  standings,
  team_form: {},
  injuries: [],
  rivalries: [],
  last_week: { week: 0, status: "complete", games: [] },
  next_week: {
    week: 1,
    status: "upcoming",
    games: [
      {
        mid: 10,
        a: side("1", "Team A", 100, null),
        b: side("2", "Team B", 99.5, null),
      },
      {
        mid: 11,
        a: side("3", "Team C", 95, null),
        b: side("4", "Team D", 90, null),
      },
    ],
  },
};

// One completed week behind, next week upcoming: weekMode is "recap", so the
// feature comes from the finished slate's margins.
const recapBase = {
  ...previewBase,
  current_week: 2,
  completed_week: 1,
  standings: standings.map((s) => ({ ...s, wins: s.wins, losses: 1 })),
  last_week: {
    week: 1,
    status: "complete",
    games: [
      { mid: 1, a: side("1", "Team A", null, 100), b: side("2", "Team B", null, 90), margin: 10, total: 190 },
      { mid: 2, a: side("3", "Team C", null, 51.5), b: side("4", "Team D", null, 50), margin: 1.5, total: 101.5 },
      { mid: 3, a: side("5", "Team E", null, 30), b: side("6", "Team F", null, 42), margin: 12, total: 72 },
    ],
  },
  next_week: { week: 2, status: "upcoming", games: [] },
};

test("preview: picks the closest projected finish", () => {
  const d = previewBase;
  assert.equal(weekMode(d).mode, "preview");
  const feat = featuredMatchup(d);
  assert.ok(feat, "expected a featured matchup");
  assert.equal(feat.mid, 10, "closest projected edge (0.5) should win");
  assert.equal(feat.edge, 0.5);
  assert.equal(feat.close, true);
  assert.equal(feat.why, "projected to be a coin flip");
  assert.ok(feat.narrative.length, "narrative sentences are attached");
});

test("preview: falls back to the next closest projected gap", () => {
  const d = {
    ...previewBase,
    next_week: {
      week: 1,
      status: "upcoming",
      games: [
        { mid: 11, a: side("3", "Team C", 96, null), b: side("4", "Team D", 90, null) },
        { mid: 12, a: side("5", "Team E", 99, null), b: side("6", "Team F", 70, null) },
      ],
    },
  };
  const feat = featuredMatchup(d);
  assert.equal(feat.mid, 11, "6-point edge beats 29-point edge");
  assert.equal(feat.edge, 6);
  assert.equal(feat.why, "projected 6.00 apart");
});

test("preview: returns null when no projections are available", () => {
  const d = {
    ...previewBase,
    next_week: {
      week: 1,
      status: "upcoming",
      games: [{ mid: 10, a: side("1", "Team A", null, null), b: side("2", "Team B", null, null) }],
    },
  };
  assert.equal(featuredMatchup(d), null);
});

test("recap: picks the closest actual finish", () => {
  const d = recapBase;
  assert.equal(weekMode(d).mode, "recap");
  const feat = featuredMatchup(d);
  assert.equal(feat.mid, 2, "1.5-point margin is the closest finish");
  assert.equal(feat.margin, 1.5);
  assert.equal(feat.winner.rid, "3");
  assert.equal(feat.why, "won by just 1.50");
});

test("recap: tie games are not featureable (margin must be positive)", () => {
  const d = {
    ...recapBase,
    last_week: {
      week: 1,
      status: "complete",
      games: [
        { mid: 1, a: side("1", "Team A", null, 50), b: side("2", "Team B", null, 50), margin: 0, total: 100 },
        { mid: 2, a: side("3", "Team C", null, 60), b: side("4", "Team D", null, 55), margin: 5, total: 115 },
      ],
    },
  };
  const feat = featuredMatchup(d);
  assert.equal(feat.mid, 2, "only the non-tie game is eligible");
});

test("recap: among equal margins, the bigger total wins", () => {
  const d = {
    ...recapBase,
    last_week: {
      week: 1,
      status: "complete",
      games: [
        { mid: 1, a: side("1", "Team A", null, 51.5), b: side("2", "Team B", null, 50), margin: 1.5, total: 101.5 },
        { mid: 2, a: side("3", "Team C", null, 91.5), b: side("4", "Team D", null, 90), margin: 1.5, total: 181.5 },
      ],
    },
  };
  const feat = featuredMatchup(d);
  assert.equal(feat.mid, 2, "equal 1.5 margins: the 181.5-point game is the bigger story");
});

test("no games: null in either mode", () => {
  const preview = { ...previewBase, next_week: { week: 1, status: "upcoming", games: [] } };
  const recap = { ...recapBase, last_week: { week: 1, status: "complete", games: [] } };
  assert.equal(featuredMatchup(preview), null);
  assert.equal(featuredMatchup(recap), null);
});

test("accepts a precomputed narrative and carries the week", () => {
  const d = previewBase;
  const n = weekendNarrative(d);
  const feat = featuredMatchup(d, n);
  assert.equal(feat.mid, 10);
  assert.equal(feat.week, 1);
});
