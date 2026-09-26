import test from "node:test";
import assert from "node:assert/strict";
import { initialRoute, matchupPhase, projectionCoverage, projectionPair, resolveGameLink, thursdayGame } from "../public/view-models.js";

const game = (mid, name) => ({ mid, name });
const week = (number, status, games) => ({ week: number, status, games });

test("TNF highlight uses the legacy matchup-one feed when no marker is published", () => {
  // The live Sleeper-derived Week 3 feed has no `tnf` field; the prior site
  // contract highlighted matchup 1. Keep that visible and use both real
  // projection totals rather than inferring a favorite from one side.
  const tnf = {
    mid: 1,
    a: { team: "Alpha", proj_total: 91.92 },
    b: { team: "Bravo", proj_total: 105.42 },
  };
  const slate = week(3, "in_progress", [tnf, game(2, "C-D")]);
  assert.equal(Object.hasOwn(slate, "tnf"), false);
  assert.equal(thursdayGame(slate), tnf);
  assert.deepEqual(projectionPair(tnf.a, tnf.b), {
    aTotal: 91.92, bTotal: 105.42, favorite: "b", gap: 13.5,
  });
});

test("an explicit TNF marker is exact-week and never falls back when malformed", () => {
  const games = [game(1, "A-B"), game(2, "C-D")];
  assert.equal(thursdayGame({ ...week(3, "upcoming", games), tnf: { week: 2, mid: 1 } }), null);
  assert.equal(thursdayGame({ ...week(3, "upcoming", games), tnf: { week: 3, mid: 2 } }), games[1]);
  assert.equal(thursdayGame({ ...week(3, "upcoming", games), tnf: { week: 3, mid: 7 } }), null);
  assert.equal(thursdayGame({ ...week(3, "upcoming", games), tnf: null }), null);
});

test("projection coverage never substitutes missing data with zeros", () => {
  assert.equal(projectionCoverage({ proj_covered: 9, proj_slots: 9 }), "9/9");
  assert.equal(projectionCoverage({ proj_covered: 0, proj_slots: 9 }), "0/9");
  assert.equal(projectionCoverage({ proj_covered: null, proj_slots: null }), "coverage unavailable");
  assert.equal(projectionCoverage({}), "coverage unavailable");
});

test("projection pair reports both source totals and the higher favorite", () => {
  assert.deepEqual(projectionPair({ proj_total: 92.18 }, { proj_total: 105.76 }), {
    aTotal: 92.18, bTotal: 105.76, favorite: "b", gap: 13.58,
  });
  assert.equal(projectionPair({ proj_total: 90 }, { proj_total: 90 }).favorite, null);
  assert.deepEqual(projectionPair({ proj_total: null }, { proj_total: 80 }), {
    aTotal: null, bTotal: 80, favorite: null, gap: null,
  });
});

test("week-qualified links never substitute a reused matchup ID", () => {
  const old = week(1, "complete", [game(3, "Week 1"), game(5, "Week 1 other")]);
  const current = week(2, "in_progress", [game(3, "Week 2")]);
  assert.deepEqual(resolveGameLink(old, current, 1, 3), { game: old.games[0], week: 1, phase: "final", source: "last" });
  assert.equal(resolveGameLink(old, current, 0, 3), null);
  assert.equal(resolveGameLink(old, current, 1, 4), null);
  assert.deepEqual(resolveGameLink(old, current, 2, 3), { game: current.games[0], week: 2, phase: "live", source: "next" });
});

test("bare matchup IDs prefer the completed game but explicit week selects current", () => {
  const old = week(1, "complete", [game(3, "Week 1")]);
  const current = week(2, "upcoming", [game(3, "Week 2")]);
  assert.equal(resolveGameLink(old, current, null, 3).source, "last");
  assert.equal(resolveGameLink(old, current, 2, 3).source, "next");
});

test("matchup display phase distinguishes historical final, upcoming preview, and live", () => {
  assert.equal(matchupPhase("upcoming", false), "preview");
  assert.equal(matchupPhase("in_progress", false), "live");
  assert.equal(matchupPhase("complete", false), "final");
  assert.equal(matchupPhase("in_progress", true), "final");
});
test("Hype share pathname initializes the Hype route, but explicit hash wins", () => {
  assert.equal(initialRoute("", "/weekend"), "weekend");
  assert.equal(initialRoute("#weekend", "/"), "weekend");
  assert.equal(initialRoute("", "/"), "home");
});
