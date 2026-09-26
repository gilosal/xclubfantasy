export function forceRefreshDue(forceRequested, lastBuild, now, minimumInterval) {
  return Boolean(forceRequested && now - Number(lastBuild || 0) > minimumInterval);
}

/** Keep the force flag at the Worker scheduled-event boundary. */
export function schedulePayloadRefresh(env, ctx, getPayload) {
  return ctx.waitUntil(getPayload(env, ctx, { forceRequested: true }));
}
