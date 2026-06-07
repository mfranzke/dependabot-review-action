import assert from "node:assert/strict";
import test from "node:test";
import { input } from "../src/io.ts";

test("reads hyphenated GitHub Action inputs", (t) => {
  const key = "INPUT_GITHUB-APP-TOKEN";
  const previous = process.env[key];
  process.env[key] = "  installation-token  ";
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });

  assert.equal(input("github-app-token", true), "installation-token");
});

test("reports a missing required input", (t) => {
  const key = "INPUT_GITHUB-APP-TOKEN";
  const previous = process.env[key];
  delete process.env[key];
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });

  assert.throws(
    () => input("github-app-token", true),
    /Missing required input: github-app-token/,
  );
});
