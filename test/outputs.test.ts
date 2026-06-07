import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setPromptOutputs } from "../src/outputs.ts";

test("leaves AI-specific outputs empty in prompt mode", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dependabot-review-outputs-"));
  const output = join(directory, "outputs");
  const previous = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = output;
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previous;
  });

  setPromptOutputs("https://github.test/comment/1", 2);

  assert.equal(await readFile(output, "utf8"), [
    "review-comment-url=https://github.test/comment/1",
    "risk-level=",
    "fix-required=",
    "fix-pr-url=",
    "dependencies-reviewed=2",
    "",
  ].join("\n"));
});
