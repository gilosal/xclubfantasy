import test from "node:test";
import assert from "node:assert/strict";
import { isHtmlDocumentRequest, rewrittenHtmlHeaders } from "../src/http-headers.js";

test("API data navigation redirects human HTML requests, not fetch clients", () => {
  const browser = new Request("https://xclubfantasy.robsplex.com/api/data", {
    headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  });
  const fetch = new Request("https://xclubfantasy.robsplex.com/api/data", {
    headers: { accept: "*/*" },
  });
  const json = new Request("https://xclubfantasy.robsplex.com/api/data", {
    headers: { accept: "application/json" },
  });
  assert.equal(isHtmlDocumentRequest(browser), true);
  assert.equal(isHtmlDocumentRequest(fetch), false);
  assert.equal(isHtmlDocumentRequest(json), false);
  assert.equal(isHtmlDocumentRequest(new Request("https://xclubfantasy.robsplex.com/api/data", {
    method: "HEAD",
    headers: { accept: "text/html" },
  })), false);
});

test("rewritten HTML retains the full static security policy and removes stale length", () => {
  const policy = "default-src 'self'; script-src 'self'; frame-ancestors 'none'";
  const headers = rewrittenHtmlHeaders(new Headers({
    "content-security-policy": policy,
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-length": "2048",
    "content-encoding": "gzip",
    etag: "\"stale-static-hash\"",
    "last-modified": "Sat, 26 Sep 2026 12:00:00 GMT",
    "accept-ranges": "bytes",
  }), "build-1");
  assert.equal(headers.get("content-security-policy"), policy);
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("permissions-policy"), "camera=(), microphone=()");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(headers.get("x-xclub-build"), "build-1");
  assert.equal(headers.get("content-length"), null);
  assert.equal(headers.get("content-encoding"), null);
  assert.equal(headers.get("etag"), null);
  assert.equal(headers.get("last-modified"), null);
  assert.equal(headers.get("accept-ranges"), null);
});
