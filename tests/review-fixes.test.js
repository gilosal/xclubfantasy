import test from "node:test";
import assert from "node:assert/strict";
import { gameStory, matchupCard, slateFinalArticles, weeklyAwards } from "../src/domain.js";

const side = (rid, team, pts, { starters = [], bench = [], proj = null } = {}) => ({
  rid, team, pts, starters, bench, proj_total: proj, proj_covered: 0, proj_slots: 9,
});
const player = (name, pts, pos = "WR", slot = pos) => ({ name, pts, pos, slot, team: "KC", proj: null });

function finalPayload(a, b, margin = Math.abs(a.pts - b.pts)) {
  const game = { mid: 1, a, b, margin, total: a.pts + b.pts };
  return {
    league: { url: "https://sleeper.com/leagues/test" },
    season: "2026",
    standings: [],
    rivalries: [],
    team_form: {},
    injuries: [],
    next_week: { week: 2, status: "upcoming", games: [] },
    last_week: { week: 1, games: [game], top_performers: [] },
  };
}

test("biggest upset compares the winner and opponent win rates", () => {
  const winner = side(1, "Underdog", 100);
  const loser = side(2, "Favorite", 99);
  const d = finalPayload(winner, loser, 1);
  d.standings = [
    { rid: 1, wins: 1, losses: 4, ties: 0 },
    { rid: 2, wins: 4, losses: 1, ties: 0 },
  ];
  const upset = weeklyAwards(d).find((award) => award.id === "biggest-upset");
  assert.equal(upset?.rid, 1);
});

test("bench hindsight narrows a loss when the swap is smaller than the deficit", () => {
  const winner = side(1, "Alpha", 100, { starters: [player("Starter A", 20)] });
  const loser = side(2, "Beta", 96, {
    starters: [player("Starter B", 5)],
    bench: [player("Bench B", 6)],
  });
  const story = gameStory({ a: winner, b: loser, margin: 4 }, finalPayload(winner, loser, 4));
  assert.match(story.decidedBy.text, /narrow/i);
  assert.doesNotMatch(story.decidedBy.text, /flip/i);
});

test("final slate preserves published article IDs and handles tied results", () => {
  const a = side(1, "Alpha", 100, { starters: [player("Starter A", 20)] });
  const b = side(2, "Beta", 100, {
    starters: [player("Starter B", 5)],
    bench: [player("Bench B", 6)],
  });
  const articles = slateFinalArticles(finalPayload(a, b, 0));
  const ids = articles.map((article) => article.id);
  for (const id of ["w1-slate", "w1-edge", "w1-bench", "w1-decider"]) {
    assert.ok(ids.includes(id), `missing rollover-safe article ${id}`);
  }
  const slate = articles.find((article) => article.id === "w1-slate");
  assert.match(slate.body, /tied|tie/i);
  assert.doesNotMatch(slate.body, /won by/i);
});

test("a completed prior-week card is not marked live because the next week is live", () => {
  const oldGame = { mid: 1, a: side(1, "Alpha", 90), b: side(2, "Beta", 80), margin: 10, total: 170 };
  const currentGame = { mid: 1, a: side(1, "Alpha", 20), b: side(3, "Gamma", 18), margin: 2, total: 38 };
  const d = {
    standings: [], team_form: {}, injuries: [], rivalries: [],
    next_week: { week: 2, status: "in_progress", games: [currentGame] },
  };
  assert.equal(matchupCard(oldGame, d, 1, "recap").live, false);
  assert.equal(matchupCard(currentGame, d, 2, "recap").live, true);
});
