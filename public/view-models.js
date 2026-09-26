const finiteScore = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Resolve the highlighted matchup for this exact week. Newer payloads may
 * provide an explicit `tnf` marker; the live Sleeper-derived payload does not,
 * and the established site convention highlights matchup 1 in that case.
 */
export function thursdayGame(nextWeek) {
  if (!nextWeek) return null;
  const games = Array.isArray(nextWeek.games) ? nextWeek.games : [];
  if (Object.prototype.hasOwnProperty.call(nextWeek, "tnf")) {
    const marker = nextWeek.tnf;
    if (!marker || Number(marker.week) !== Number(nextWeek.week) || marker.mid == null) return null;
    return games.find((game) => String(game.mid) === String(marker.mid)) || null;
  }
  return games.find((game) => String(game.mid) === "1") || null;
}

/** Return measured estimate coverage without inventing zero counts. */
export function projectionCoverage(team) {
  const covered = team?.proj_covered;
  const slots = team?.proj_slots;
  if (covered == null || slots == null || !Number.isFinite(Number(covered)) || !Number.isFinite(Number(slots))) {
    return "coverage unavailable";
  }
  return `${Number(covered)}/${Number(slots)}`;
}

/** Display both supplied totals and identify the higher projection correctly. */
export function projectionPair(a, b) {
  const aTotal = finiteScore(a?.proj_total);
  const bTotal = finiteScore(b?.proj_total);
  const favorite =
    aTotal == null || bTotal == null || aTotal === bTotal
      ? null
      : aTotal > bTotal ? "a" : "b";
  return {
    aTotal,
    bTotal,
    favorite,
    gap: aTotal === null || bTotal === null
      ? null
      : Math.round((Math.abs(aTotal - bTotal) + Number.EPSILON) * 100) / 100,
  };
}

export function matchupPhase(status, historical = false) {
  if (historical || status === "complete") return "final";
  if (status === "upcoming") return "preview";
  if (status === "in_progress") return "live";
  return "unknown";
}

/** Exact week-qualified game lookup; never substitute a reused matchup ID. */
export function resolveGameLink(lastWeek, nextWeek, requestedWeek, mid) {
  const match = (week) => (week?.games || []).find((game) => String(game.mid) === String(mid)) || null;
  if (requestedWeek != null) {
    const week = Number(requestedWeek);
    if (week === Number(lastWeek?.week)) {
      const game = match(lastWeek);
      return game ? { game, week, phase: "final", source: "last" } : null;
    }
    if (week === Number(nextWeek?.week)) {
      const game = match(nextWeek);
      if (!game) return null;
      const phase = matchupPhase(nextWeek.status);
      return phase === "unknown" ? null : { game, week, phase, source: "next" };
    }
    return null;
  }
  const last = match(lastWeek);
  if (last) return { game: last, week: Number(lastWeek.week), phase: "final", source: "last" };
  const upcoming = match(nextWeek);
  if (!upcoming) return null;
  const phase = matchupPhase(nextWeek.status);
  return phase === "unknown" ? null : { game: upcoming, week: Number(nextWeek.week), phase, source: "next" };
}

/** Preserve pathname-based share links while the app is otherwise hash-routed. */
export function initialRoute(hash, pathname) {
  const route = String(hash || "").replace(/^#/, "");
  return route || (pathname === "/weekend" ? "weekend" : "home");
}
