import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readConfig } from "../src/config.ts";

const inputKeys = [
  "INPUT_GITHUB-TOKEN",
  "INPUT_REVIEW-MODE",
  "INPUT_OPENAI-API-KEY",
  "INPUT_OPENAI-MODEL",
  "INPUT_CREATE-FIX-PR",
  "INPUT_MAX-CONTEXT-CHARACTERS",
];

function inputs(t: TestContext, values: Record<string, string> = {}): void {
  const previous = new Map(inputKeys.map((key) => [key, process.env[key]]));
  for (const key of inputKeys) delete process.env[key];
  process.env["INPUT_GITHUB-TOKEN"] = "token";
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("defaults to prompt mode without OpenAI credentials", (t) => {
  inputs(t, { "INPUT_MAX-CONTEXT-CHARACTERS": "invalid-in-prompt-mode" });
  const config = readConfig();
  assert.equal(config.reviewMode, "prompt");
  assert.equal(config.openaiApiKey, undefined);
  assert.equal(config.openaiModel, undefined);
});

test("accepts explicit OpenAI mode with credentials", (t) => {
  inputs(t, {
    "INPUT_REVIEW-MODE": "openai",
    "INPUT_OPENAI-API-KEY": "secret",
    "INPUT_OPENAI-MODEL": "gpt-5.4",
    "INPUT_CREATE-FIX-PR": "true",
  });
  const config = readConfig();
  assert.equal(config.reviewMode, "openai");
  assert.equal(config.openaiModel, "gpt-5.4");
  assert.equal(config.createFixPr, true);
});

test("rejects invalid modes and missing OpenAI inputs", (t) => {
  inputs(t, { "INPUT_REVIEW-MODE": "automatic" });
  assert.throws(() => readConfig(), /review-mode must be either prompt or openai/);
});

test("requires OpenAI credentials in OpenAI mode", (t) => {
  inputs(t, { "INPUT_REVIEW-MODE": "openai" });
  assert.throws(() => readConfig(), /openai-api-key/);
  process.env["INPUT_OPENAI-API-KEY"] = "secret";
  assert.throws(() => readConfig(), /openai-model/);
});

test("rejects remediation in prompt mode", (t) => {
  inputs(t, { "INPUT_CREATE-FIX-PR": "true" });
  assert.throws(() => readConfig(), /create-fix-pr can only be enabled.*openai/);
});
