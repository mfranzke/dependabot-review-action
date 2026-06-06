import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClient } from "../src/github.ts";

test("updates an existing marker comment", async (t) => {
  const requests: Array<{ url: string; method: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });
    if (method === "PATCH") {
      return Response.json({ html_url: "https://github.test/comment/42" });
    }
    return Response.json([{ id: 42, body: "<!-- marker --> old", html_url: "old" }]);
  });
  const github = new GitHubClient({ token: "token", owner: "owner", repo: "repo" });
  const url = await github.upsertComment(1, "<!-- marker -->", "new");
  assert.equal(url, "https://github.test/comment/42");
  assert.equal(requests.at(-1)?.method, "PATCH");
});

test("creates a marker comment when none exists", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ html_url: "https://github.test/comment/new" });
    return Response.json([]);
  });
  const github = new GitHubClient({ token: "token", owner: "owner", repo: "repo" });
  assert.equal(await github.upsertComment(1, "<!-- marker -->", "new"), "https://github.test/comment/new");
});
