const MAX_WEEK = 18;

function validEntry(entry, season) {
  const week = Number(entry?.week);
  const article = entry?.article;
  if (String(entry?.season) !== season || !Number.isInteger(week) || week < 1 || week > MAX_WEEK) return false;
  if (article?.id !== `w${week}-waiver-dispatch` || article?.column !== true) return false;
  return ["tag", "headline", "dek", "body", "byline", "period", "source_url", "source_label"]
    .every((key) => typeof article[key] === "string" && article[key].trim().length > 0);
}

/** Overlay persisted newsroom editions without changing reconstructed scores or articles. */
export function mergePublishedArticles(payload, entries) {
  const season = String(payload?.season ?? "");
  const published = (Array.isArray(entries) ? entries : [])
    .filter((entry) => validEntry(entry, season))
    .sort((a, b) => Number(b.week) - Number(a.week));
  const archiveByWeek = new Map();
  for (const item of Array.isArray(payload?.archive) ? payload.archive : []) {
    const week = Number(item?.week);
    if (!Number.isInteger(week) || week < 1 || week > MAX_WEEK) continue;
    if (!archiveByWeek.has(week)) archiveByWeek.set(week, { ...item, week, articles: [...(item.articles || [])] });
  }
  for (const entry of published) {
    const week = Number(entry.week);
    const item = archiveByWeek.get(week) || { week, articles: [] };
    if (!item.articles.some((article) => article?.id === entry.article.id)) item.articles.push(entry.article);
    archiveByWeek.set(week, item);
  }
  const currentWeek = Number(payload?.current_week);
  const currentEntries = published.filter((entry) => Number(entry.week) === currentWeek);
  const currentIds = new Set((payload?.articles || []).map((article) => article?.id));
  const currentStories = currentEntries
    .map((entry) => entry.article)
    .filter((article) => !currentIds.has(article.id));
  const articles = [...currentStories, ...(Array.isArray(payload?.articles) ? payload.articles : [])];
  const weekMode = currentEntries.length
    ? { ...(payload.week_mode || {}), leadStory: currentEntries[0].article.id }
    : payload.week_mode;
  return {
    ...payload,
    ...(weekMode ? { week_mode: weekMode } : {}),
    articles,
    archive: [...archiveByWeek.values()].sort((a, b) => b.week - a.week),
    published_articles: published,
  };
}

export async function withPublishedArticles(payload, kv) {
  const season = String(payload?.season ?? "");
  let entries = [];
  if (kv && /^\d{4}$/.test(season)) {
    try {
      const stored = await kv.get(`published-articles:${season}`, "json");
      if (Array.isArray(stored)) entries = stored;
    } catch {
      // The public box-score feed must remain usable if the optional newsroom
      // manifest is unavailable.
    }
  }
  return mergePublishedArticles(payload, entries);
}
