import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectRepositoryContext } from "../src/context.ts";

test("prioritizes manifests and excludes secrets and binaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "dependency-context-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "package.json"), '{"dependencies":{"react":"19.0.0"}}');
  await writeFile(join(root, ".env"), "SECRET=do-not-send");
  await writeFile(join(root, "root.pem"), "PRIVATE KEY");
  await writeFile(join(root, "src", ".env.local"), "NESTED=do-not-send");
  await writeFile(join(root, "src", "app.ts"), "import React from 'react';");
  await writeFile(join(root, "image.png"), Buffer.from([0, 1, 2, 3]));
  const context = await collectRepositoryContext(root, [{
    kind: "npm", name: "react", previousVersion: "18", newVersion: "19", manifests: ["package.json"],
  }], 10_000, []);
  assert.deepEqual(context.includedFiles, ["package.json", "src/app.ts"]);
  assert.doesNotMatch(context.content, /do-not-send/);
  assert.doesNotMatch(context.content, /PRIVATE KEY/);
});

test("reports files omitted by the context budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "dependency-context-"));
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "large.ts"), "x".repeat(12_000));
  const context = await collectRepositoryContext(root, [], 10_000, []);
  assert.deepEqual(context.includedFiles, ["package.json"]);
  assert.deepEqual(context.omittedFiles, ["large.ts"]);
});
