import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIClient } from "../src/openai.ts";

test("sends a strict Responses API schema and parses structured output", async (t) => {
  let requestBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            summary: "Looks safe",
            riskLevel: "low",
            fixRequired: false,
            findings: [],
            dependencySummaries: [{
              name: "zod",
              summary: "Updated",
              notableChanges: [],
              hiddenOrUnclearChanges: [],
            }],
          }),
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const client = new OpenAIClient("secret", "test-model", "https://example.test/v1/");
  const result = await client.analyze(
    [{ kind: "npm", name: "zod", previousVersion: "3", newVersion: "4", manifests: ["package.json"] }],
    { content: "--- FILE: package.json ---\n{}", includedFiles: ["package.json"], omittedFiles: [], totalCharacters: 2 },
  );
  assert.equal(result.riskLevel, "low");
  assert.equal(requestBody?.model, "test-model");
  assert.equal((requestBody?.text as { format: { strict: boolean } }).format.strict, true);
});

test("reports Responses API failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("rate limited", { status: 429 }));
  const client = new OpenAIClient("secret", "test-model", "https://example.test/v1");
  await assert.rejects(
    client.analyze([], { content: "", includedFiles: [], omittedFiles: [], totalCharacters: 0 }),
    /429.*rate limited/,
  );
});

test("explains insufficient API quota", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    error: {
      message: "You exceeded your current quota",
      type: "insufficient_quota",
      code: "insufficient_quota",
    },
  }, { status: 429 }));
  const client = new OpenAIClient("secret", "test-model", "https://example.test/v1");
  await assert.rejects(
    client.analyze([], { content: "", includedFiles: [], omittedFiles: [], totalCharacters: 0 }),
    /quota is unavailable.*billing.*credit balance.*organization usage limits/i,
  );
});
