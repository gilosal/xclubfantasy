/** Apply response headers for rewritten static HTML without dropping _headers security policy. */
export function rewrittenHtmlHeaders(assetHeaders, build) {
  const headers = new Headers(assetHeaders);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=60, stale-while-revalidate=600");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-xclub-build", build);
  for (const name of ["content-length", "content-encoding", "etag", "last-modified", "accept-ranges"]) {
    headers.delete(name);
  }
  return headers;
}
