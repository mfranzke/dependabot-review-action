import assert from "node:assert/strict";
import test from "node:test";
import { COMMENT_MARKER, renderReport } from "../src/report.ts";

test("renders an idempotent marker and coverage warning", () => {
  const report = renderReport(
    [{ kind: "npm", name: "react", previousVersion: "18", newVersion: "19", manifests: ["package.json"] }],
    {
      summary: "Review summary",
      riskLevel: "high",
      fixRequired: true,
      findings: [{
        title: "API changed", severity: "high", confidence: "high", details: "Update the call.", files: ["src/app.ts"], requiredAction: "Edit it.",
      }],
      dependencySummaries: [{
        name: "react", summary: "Major update", notableChanges: ["Changed API"], hiddenOrUnclearChanges: [],
      }],
    },
    { content: "", includedFiles: ["package.json"], omittedFiles: ["generated.ts"], totalCharacters: 2 },
  );
  assert.match(report, new RegExp(COMMENT_MARKER));
  assert.match(report, /Overall risk: HIGH/);
  assert.match(report, /generated\.ts/);
});
