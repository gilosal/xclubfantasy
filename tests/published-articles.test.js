import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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

test("explicit current front-page column coexists with the waiver and promotes only the lead", () => {
  const base = payload();
  base.archive.push({ week: 4, articles: [{ id: "w4-weekly-lead" }] });
  const waiver = story(4);
  const column = story(4, {
    id: "w4-opinion-column", front_page: true, published_at: "2026-10-05T14:30:00Z",
  });
  for (const entries of [[waiver, column], [column, waiver]]) {
    const out = mergePublishedArticles(base, entries);
    assert.deepEqual(out.articles, [...entries.map((entry) => entry.article), ...base.articles]);
    assert.deepEqual(out.archive[0].articles, [base.archive[1].articles[0], ...entries.map((entry) => entry.article)]);
    assert.deepEqual(out.archive[1], base.archive[0]);
    assert.deepEqual(out.week_mode, { ...base.week_mode, leadStory: column.article.id });
    assert.deepEqual(out.published_articles, entries);
    assert.deepEqual(mergePublishedArticles(out, entries), out, "repeated overlays do not duplicate articles");
  }
});

test("prior front-page columns stay archived without changing the current feed or lead", () => {
  const base = payload();
  const column = story(3, { id: "w3-opinion-column", front_page: true });
  const out = mergePublishedArticles(base, [column]);
  assert.deepEqual(out.articles, base.articles);
  assert.deepEqual(out.week_mode, base.week_mode);
  assert.deepEqual(out.archive[0].articles, [...base.archive[0].articles, column.article]);
  assert.deepEqual(mergePublishedArticles(base, []).week_mode, base.week_mode);
});

test("additional columns require matching season/week, exact week-scoped IDs and boolean flags", () => {
  const column = (overrides = {}) => story(4, { id: "w4-opinion-column", front_page: true, ...overrides });
  const invalid = [
    { ...column(), season: "2025" },
    ...[0, 19, 4.5, "invalid"].map((week) => ({ ...column(), week })),
    ...["w3-opinion-column", "w04-opinion-column", "w4-Opinion-column", "w4-", "w4-opinion_ column", "w4-opinion--column", "w4-opinion-column-extra!", "w4-opinion-column\n", null]
      .map((id) => column({ id })),
    ...[false, "true", undefined].flatMap((flag) => [column({ column: flag }), column({ front_page: flag })]),
  ];
  for (const entry of invalid) {
    const out = mergePublishedArticles(payload(), [entry]);
    assert.deepEqual(out.published_articles, [], JSON.stringify(entry));
    assert.deepEqual(out.articles, payload().articles);
    assert.deepEqual(out.archive, payload().archive);
    assert.deepEqual(out.week_mode, payload().week_mode);
  }
});

test("waivers and additional columns retain required string validation and validate optional publication timestamps", () => {
  for (const overrides of [{}, { id: "w4-opinion-column", front_page: true }]) {
    for (const key of ["tag", "headline", "dek", "body", "byline", "period", "source_url", "source_label"]) {
      for (const value of [undefined, null, 42, "", " \n "]) {
        assert.deepEqual(mergePublishedArticles(payload(), [story(4, { ...overrides, [key]: value })]).published_articles, []);
      }
    }
    for (const published_at of [undefined, null, 42, "", "not-a-timestamp"]) {
      assert.deepEqual(mergePublishedArticles(payload(), [story(4, { ...overrides, published_at })]).published_articles, []);
    }
    for (const timestamp of [{}, { published_at: "2026-10-05T14:30:00Z" }]) {
      const entry = story(4, { ...overrides, ...timestamp });
      assert.deepEqual(mergePublishedArticles(payload(), [entry]).published_articles, [entry]);
    }
  }
});

test("article byline renders its publication timestamp or the existing feed update timestamp", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const helpers = app.slice(app.indexOf("const $ ="), app.indexOf("let DATA,"));
  const renderer = app.slice(app.indexOf("function showArticle(id)"), app.indexOf("function route("));
  const asof = Date.parse("2026-10-06T18:00:00Z");
  for (const published of [true, false]) {
    const article = story(4, published ? { published_at: "2026-10-05T14:30:00Z" } : {}).article;
    const content = {};
    const dialog = { open: true };
    const document = { getElementById: (id) => id === "articleContent" ? content : dialog };
    runInNewContext(`${helpers}\n${renderer}\nshowArticle(article.id);`, {
      document, article, DATA: { season: "2026", asof }, findArticle: () => article,
    });
    const expectedDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(published ? article.published_at : asof));
    assert.ok(content.innerHTML.includes(`${published ? "Published" : "Updated"} ${expectedDate} ET`));
    assert.ok(!content.innerHTML.includes(published ? "Updated " : "Published "));
  }
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
