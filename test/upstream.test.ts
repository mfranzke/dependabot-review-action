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
