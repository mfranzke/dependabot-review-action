import assert from "node:assert/strict";
import test from "node:test";
import { validatePatchPaths } from "../src/remediation.ts";

const valid = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new
`;

test("accepts a normal unified patch", () => {
  assert.deepEqual(validatePatchPaths(valid), ["src/app.ts"]);
});

test("rejects traversal and sensitive files", () => {
  assert.throws(() => validatePatchPaths(valid.replaceAll("src/app.ts", "../app.ts")), /Unsafe/);
  assert.throws(() => validatePatchPaths(valid.replaceAll("src/app.ts", ".github/workflows/pwn.yml")), /forbidden/);
  assert.throws(() => validatePatchPaths(valid.replaceAll("src/app.ts", ".env")), /forbidden/);
  assert.throws(() => validatePatchPaths("not a patch"), /unified git diff/);
});
