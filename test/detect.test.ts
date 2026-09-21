import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cleanPnpmVersion,
  detectActionUpdates,
  detectManifestUpdates,
  detectPackageLockUpdates,
  detectPnpmUpdates,
  deduplicateUpdates,
  inspectPnpmFeatures,
} from "../src/detect.ts";

const fixture = (name: string) => readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("detects pnpm 11 direct updates and ignores config dependencies and workspace links", async () => {
  const updates = detectPnpmUpdates(
    await fixture("pnpm11-single-base.yaml"),
    await fixture("pnpm11-single-head.yaml"),
  );
  assert.deepEqual(updates.map(({ name, previousVersion, newVersion }) => ({ name, previousVersion, newVersion })), [
    { name: "react", previousVersion: "18.3.1", newVersion: "19.1.0" },
    { name: "vite", previousVersion: "5.4.10", newVersion: "6.1.2" },
  ]);
});

test("groups pnpm workspace catalog updates and handles npm aliases", async () => {
  const updates = detectPnpmUpdates(
    await fixture("pnpm11-workspace-base.yaml"),
    await fixture("pnpm11-workspace-head.yaml"),
  );
  const zod = updates.find((update) => update.name === "zod");
  assert.deepEqual(zod?.manifests, ["apps/web/package.json", "pnpm-lock.yaml", "packages/api/package.json", "pnpm-workspace.yaml"]);
  assert.equal(updates.find((update) => update.name === "@example/aliased")?.newVersion, "4.17.22");
  assert.equal(updates.find((update) => update.name === "@example/aliased")?.sourcePackage, "lodash");
});

test("detects catalog-only version bumps when importers are unchanged", () => {
  const base = "lockfileVersion: '9.0'\ncatalogs:\n  default:\n    zod:\n      specifier: ^3.23.0\n      version: 3.23.8\nimporters:\n  .: {}\n";
  const head = "lockfileVersion: '9.0'\ncatalogs:\n  default:\n    zod:\n      specifier: ^4.0.0\n      version: 4.0.5\nimporters:\n  .: {}\n";
  const updates = detectPnpmUpdates(base, head);
  assert.deepEqual(updates.map(({ name, previousVersion, newVersion, manifests }) => ({ name, previousVersion, newVersion, manifests })), [
    { name: "zod", previousVersion: "3.23.8", newVersion: "4.0.5", manifests: ["pnpm-workspace.yaml", "pnpm-lock.yaml"] },
  ]);
});

test("feature-detects pnpm 11 additions independently of lockfile version", async () => {
  const features = inspectPnpmFeatures(
    await fixture("pnpm11-single-head.yaml"),
    JSON.stringify({ devEngines: { packageManager: "pnpm@^11.0.0" } }),
  );
  assert.equal(features.lockfileVersion, "9.0");
  assert.equal(features.pnpmMajor, 11);
  assert.equal(features.hasConfigDependencies, true);
  assert.equal(features.simplifiedPatchedDependencies, true);
  assert.equal(features.dedupePeers, true);
});

test("normalizes peer suffixes and aliases", () => {
  assert.equal(cleanPnpmVersion("1.2.3(peer@2.0.0)"), "1.2.3");
  assert.equal(cleanPnpmVersion("npm:lodash@4.17.21"), "4.17.21");
  assert.equal(cleanPnpmVersion("workspace:*"), "workspace:*");
});

test("detects package-lock v3 changes", () => {
  const base = JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/lodash": { version: "4.17.20" } } });
  const head = JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/lodash": { version: "4.17.21" } } });
  assert.equal(detectPackageLockUpdates(base, head)[0]?.name, "lodash");
});

test("detects manifest and workflow updates", () => {
  assert.equal(
    detectManifestUpdates('{"dependencies":{"zod":"^3.0.0"}}', '{"dependencies":{"zod":"^4.0.0"}}', "apps/a/package.json")[0]?.name,
    "zod",
  );
  const actions = detectActionUpdates("steps:\n  - uses: actions/checkout@v4\n", "steps:\n  - uses: actions/checkout@v5\n", ".github/workflows/ci.yml");
  assert.deepEqual(actions.map((update) => [update.name, update.previousVersion, update.newVersion]), [["actions/checkout", "v4", "v5"]]);
});

test("retains release tags from pinned action comments", () => {
  const actions = detectActionUpdates(
    "steps:\n  - uses: actions/checkout@old-sha # v4.2.2\n",
    "steps:\n  - uses: actions/checkout@new-sha # v6.0.3\n",
    ".github/workflows/ci.yml",
  );
  assert.equal(actions[0]?.previousRelease, "v4.2.2");
  assert.equal(actions[0]?.newRelease, "v6.0.3");
});

test("merges manifest ranges into resolved lockfile updates", () => {
  const updates = deduplicateUpdates([
    { kind: "npm", name: "zod", previousVersion: "3.23.8", newVersion: "4.0.5", manifests: ["pnpm-lock.yaml"] },
    { kind: "npm", name: "zod", previousVersion: "^3.0.0", newVersion: "^4.0.0", manifests: ["package.json"] },
  ]);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]?.manifests, ["pnpm-lock.yaml", "package.json"]);
});

test("tolerates non-mapping lines in pnpm YAML", () => {
  assert.doesNotThrow(() => detectPnpmUpdates("lockfileVersion: '9.0'\ninvalid", "lockfileVersion: '9.0'"));
});
