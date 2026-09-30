import test from "node:test";
import assert from "node:assert/strict";
import { mergePublishedArticles, withPublishedArticles } from "../src/published-articles.js";

const story = (week, overrides = {}) => ({
  season: "2026",
  week,
  article: {
    id: `w${week}-waiver-dispatch`,
    tag: "The Waiver Desk",
    headline: `Week ${week} waiver wire unsettles the league`,
    dek: "A real transaction receives an appropriately unreasonable amount of attention.",
    body: "The public transaction log confirms the move.\n\nThe waiver desk files the morning's completed claims.",
    byline: "XClub Waiver Desk",
    period: `Week ${week} · Waiver edition`,
    source_url: "https://sleeper.com/leagues/1",
    source_label: "Transaction facts from public Sleeper league data.",
    column: true,
    ...overrides,
  },
});

const payload = () => ({
  season: "2026",
  current_week: 4,
  week_mode: { mode: "preview", leadStory: "weekly-lead" },
  articles: [{ id: "weekly-lead", headline: "Existing" }],
  archive: [{ week: 3, articles: [{ id: "w3-weekly-lead" }] }],
});

test("current published edition is featured live and retained in the archive", () => {
  const out = mergePublishedArticles(payload(), [story(4)]);
  assert.equal(out.articles[0].id, "w4-waiver-dispatch");
  assert.equal(out.week_mode.leadStory, "w4-waiver-dispatch");
  assert.equal(out.archive[0].week, 4);
  assert.equal(out.archive[0].articles[0].id, "w4-waiver-dispatch");
  assert.deepEqual(out.published_articles.map((x) => x.week), [4]);
});

test("a prior published article supplements, but does not replace, a reconstructed week", () => {
  const out = mergePublishedArticles(payload(), [story(3)]);
  assert.deepEqual(out.articles.map((x) => x.id), ["weekly-lead"]);
  const week3 = out.archive.find((x) => x.week === 3);
  assert.deepEqual(week3.articles.map((x) => x.id), ["w3-weekly-lead", "w3-waiver-dispatch"]);
});

test("invalid-season, invalid-week, non-column editions, and wrong IDs are not surfaced", () => {
  const invalid = [
    { ...story(4), season: "2025" },
    { ...story(19), week: 19 },
    story(4, { id: "wrong-id" }),
    story(4, { column: false }),
  ];
  const out = mergePublishedArticles(payload(), invalid);
  assert.deepEqual(out.published_articles, []);
  assert.deepEqual(out.articles.map((x) => x.id), ["weekly-lead"]);
  assert.deepEqual(out.archive.map((x) => x.week), [3]);
});

test("KV loader reads only the season manifest and degrades safely", async () => {
  const calls = [];
  const kv = {
    get: async (key, type) => {
      calls.push([key, type]);
      return [story(4)];
    },
  };
  const out = await withPublishedArticles(payload(), kv);
  assert.deepEqual(calls, [["published-articles:2026", "json"]]);
  assert.equal(out.articles[0].id, "w4-waiver-dispatch");
  const failed = await withPublishedArticles(payload(), { get: async () => { throw new Error("KV offline"); } });
  assert.deepEqual(failed.published_articles, []);
  assert.equal(failed.articles[0].id, "weekly-lead");
});
