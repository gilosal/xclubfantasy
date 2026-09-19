import test from "node:test";
import assert from "node:assert/strict";
import { waiverDesk } from "../src/domain.js";

// Shape mirrors the real /api/data payload for the fields waiverDesk reads.
const base = (over = {}) => ({
  current_week: 2,
  league: { faab: 100, trade_deadline: 13, regular_end: 14 },
  standings: [
    { rid: 1, name: "Alpha", faab_used: 0 },
    { rid: 2, name: "Beta", faab_used: 30 },
    { rid: 3, name: "Gamma", faab_used: 100 },
  ],
  transactions: [
    { type: "waiver", week: 2, bid: 5 },
    { type: "free_agent", week: 2 },
    { type: "waiver", week: 1, bid: 2 },
    { type: "trade", week: 1 },
  ],
  ...over,
});

test("trade window is open before the deadline and counts weeks left", () => {
  const w = waiverDesk(base());
  assert.equal(w.trade_open, true);
  assert.equal(w.trade_week, 13);
  assert.equal(w.trade_weeks_left, 11); // 13 - 2
  assert.equal(w.week, 2);
  assert.equal(w.regular_end, 14);
});

test("final trade week reads as the last window, still open", () => {
  const w = waiverDesk(base({ current_week: 13 }));
  assert.equal(w.trade_open, true);
  assert.equal(w.trade_weeks_left, 0);
});

test("trade window closes after the deadline week", () => {
  const w = waiverDesk(base({ current_week: 14 }));
  assert.equal(w.trade_open, false);
  assert.equal(w.trade_weeks_left, 0);
});

test("FAAB pool and per-team spent/remaining are derived from standings", () => {
  const w = waiverDesk(base());
  assert.equal(w.faab, 100);
  const beta = w.faab_teams.find((t) => t.rid === 2);
  assert.equal(beta.used, 30);
  assert.equal(beta.left, 70);
  const gamma = w.faab_teams.find((t) => t.rid === 3);
  assert.equal(gamma.left, 0); // fully spent, clamped at zero
  assert.equal(w.faab_teams.length, 3);
});

test("transaction counts are tallied by type", () => {
  const w = waiverDesk(base());
  assert.deepEqual(w.counts, { waiver: 2, free_agent: 1, trade: 1 });
});

test("unknown transaction types are ignored by the counts", () => {
  const w = waiverDesk(base({
    transactions: [
      { type: "waiver" },
      { type: "some_future_type" },
    ],
  }));
  assert.deepEqual(w.counts, { waiver: 1, free_agent: 0, trade: 0 });
});

test("no configured deadline means no open trade window", () => {
  const w = waiverDesk(base({ league: { faab: 0, trade_deadline: 0, regular_end: 14 } }));
  assert.equal(w.trade_open, false);
  assert.equal(w.trade_week, null);
  assert.equal(w.faab, 0);
});

test("Sleeper's negative/over-pool waiver budgets are clamped to a sane range", () => {
  const w = waiverDesk(base({
    standings: [
      { rid: 1, name: "Negative", faab_used: -1 },   // refund quirk -> 0 used
      { rid: 2, name: "Overspent", faab_used: 140 },  // over pool -> 100 used, 0 left
    ],
  }));
  const neg = w.faab_teams.find((t) => t.rid === 1);
  assert.equal(neg.used, 0);
  assert.equal(neg.left, 100);
  const over = w.faab_teams.find((t) => t.rid === 2);
  assert.equal(over.used, 140);
  assert.equal(over.left, 0);
  // Nothing shows more left than the pool, and no negative spend.
  for (const t of w.faab_teams)
    assert.ok(t.used >= 0 && t.left >= 0 && t.left <= w.faab, `in range: ${t.name}`);
});

test("missing transactions or standings degrade to empty, no crash", () => {
  const w = waiverDesk({ current_week: 3, league: { faab: 50, trade_deadline: 10 }, transactions: [], standings: [] });
  assert.equal(w.trade_open, true);
  assert.equal(w.trade_weeks_left, 7);
  assert.equal(w.faab_teams.length, 0);
  assert.deepEqual(w.counts, { waiver: 0, free_agent: 0, trade: 0 });
});

test("no undefined/NaN leaks in the derived object", () => {
  const w = waiverDesk(base());
  const blob = JSON.stringify(w);
  assert.ok(!/undefined|NaN/.test(blob), `clean output: ${blob}`);
});
