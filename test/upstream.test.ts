import assert from "node:assert/strict";
import test from "node:test";
import { enrichUpdate } from "../src/upstream.ts";

test("retains resolved release and comparison links", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://registry.npmjs.org/")) {
      return Response.json({ repository: "https://github.com/example/package.git" });
    }
    if (url.includes("/releases/tags/2.0.0")) {
      return Response.json({
        name: "Version 2",
        body: "Release details",
        html_url: "https://github.com/example/package/releases/tag/2.0.0",
      });
    }
    if (url.includes("/compare/1.0.0...2.0.0")) {
      return new Response("diff --git a/index.js b/index.js");
    }
    return new Response("not found", { status: 404 });
  });

  const result = await enrichUpdate({
    kind: "npm",
    name: "package",
    previousVersion: "1.0.0",
    newVersion: "2.0.0",
    manifests: ["package.json"],
  }, "token");

  assert.equal(result.releaseUrl, "https://github.com/example/package/releases/tag/2.0.0");
  assert.equal(result.comparisonUrl, "https://github.com/example/package/compare/1.0.0...2.0.0");
  assert.match(result.releaseNotes ?? "", /Release details/);
  assert.match(result.upstreamDiff ?? "", /diff --git/);
});

test("uses action version comments to resolve releases for SHA pins", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/releases/tags/v6.0.3")) {
      return Response.json({
        name: "v6.0.3",
        body: "SHA-256 repository fixes",
        html_url: "https://github.com/actions/checkout/releases/tag/v6.0.3",
      });
    }
    if (url.includes("/compare/old-sha...new-sha")) {
      return new Response("diff --git a/action.yml b/action.yml");
    }
    return new Response("not found", { status: 404 });
  });

  const result = await enrichUpdate({
    kind: "github-action",
    name: "actions/checkout",
    previousVersion: "old-sha",
    newVersion: "new-sha",
    previousRelease: "v4.2.2",
    newRelease: "v6.0.3",
    manifests: [".github/workflows/ci.yml"],
    sourceUrl: "https://github.com/actions/checkout",
  }, "token");

  assert.equal(result.releaseUrl, "https://github.com/actions/checkout/releases/tag/v6.0.3");
  assert.match(result.releaseNotes ?? "", /SHA-256 repository fixes/);
  assert.equal(result.comparisonUrl, "https://github.com/actions/checkout/compare/old-sha...new-sha");
  assert.ok(requests.some((url) => url.includes("/releases/tags/v6.0.3")));
});

test("resolves releases and comparisons for direct action tags", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases/tags/v6")) {
      return Response.json({
        name: "v6",
        body: "Major release details",
        html_url: "https://github.com/actions/checkout/releases/tag/v6",
      });
    }
    if (url.includes("/compare/v5...v6")) {
      return new Response("diff --git a/action.yml b/action.yml");
    }
    return new Response("not found", { status: 404 });
  });

  const result = await enrichUpdate({
    kind: "github-action",
    name: "actions/checkout",
    previousVersion: "v5",
    newVersion: "v6",
    manifests: [".github/workflows/ci.yml"],
    sourceUrl: "https://github.com/actions/checkout",
  }, "token");

  assert.equal(result.releaseUrl, "https://github.com/actions/checkout/releases/tag/v6");
  assert.equal(result.comparisonUrl, "https://github.com/actions/checkout/compare/v5...v6");
  assert.match(result.releaseNotes ?? "", /Major release details/);
});

test("falls back to a changelog at the target ref", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/contents/CHANGELOG.md?ref=new-sha")) {
      return new Response("# Changelog\n\n## v2\nUseful changes");
    }
    if (url.includes("/compare/old-sha...new-sha")) {
      return new Response("diff --git a/index.js b/index.js");
    }
    return new Response("not found", { status: 404 });
  });

  const result = await enrichUpdate({
    kind: "github-action",
    name: "example/action",
    previousVersion: "old-sha",
    newVersion: "new-sha",
    manifests: [".github/workflows/ci.yml"],
    sourceUrl: "https://github.com/example/action",
  }, "token");

  assert.equal(result.releaseUrl, "https://github.com/example/action/blob/new-sha/CHANGELOG.md");
  assert.match(result.releaseNotes ?? "", /Useful changes/);
});
