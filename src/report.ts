import type { DependencyUpdate, RepositoryContext, ReviewAnalysis } from "./types.ts";

export const COMMENT_MARKER = "<!-- dependabot-ai-review -->";

function list(items: string[], empty: string): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

export function renderReport(
  updates: DependencyUpdate[],
  analysis: ReviewAnalysis,
  context: RepositoryContext,
  fixPrUrl?: string,
  remediationWarning?: string,
): string {
  const dependencies = analysis.dependencySummaries.map((summary) => {
    const update = updates.find((candidate) => candidate.name === summary.name);
    const comparison = update ? `${update.previousVersion} -> ${update.newVersion}` : "updated";
    return [
      `<details><summary><strong>${summary.name}</strong> (${comparison})</summary>`,
      "",
      summary.summary,
      "",
      "**Notable changes**",
      list(summary.notableChanges, "None identified."),
      "",
      "**Unclear or undocumented changes**",
      list(summary.hiddenOrUnclearChanges, "None identified."),
      update?.sourceUrl ? `\nUpstream: ${update.sourceUrl}` : "",
      update?.upstreamWarning ? `\n> Coverage warning: ${update.upstreamWarning}` : "",
      "",
      "</details>",
    ].join("\n");
  }).join("\n\n");

  const findings = analysis.findings.map((finding) => [
    `### ${finding.severity.toUpperCase()}: ${finding.title}`,
    `${finding.details}`,
    `- Confidence: ${finding.confidence}`,
    `- Files: ${finding.files.length ? finding.files.map((path) => `\`${path}\``).join(", ") : "No file identified"}`,
    `- Required action: ${finding.requiredAction}`,
  ].join("\n")).join("\n\n");

  const coverage = context.omittedFiles.length
    ? `${context.includedFiles.length} files included; ${context.omittedFiles.length} omitted by safety or context limits.`
    : `${context.includedFiles.length} files included; no eligible files omitted.`;

  return [
    COMMENT_MARKER,
    "# AI dependency review",
    "",
    `**Overall risk: ${analysis.riskLevel.toUpperCase()}**`,
    "",
    analysis.summary,
    "",
    "## Dependency changes",
    dependencies || "No dependency summaries returned.",
    "",
    "## Codebase impact",
    findings || "No concrete codebase changes were identified.",
    "",
    "## Remediation",
    fixPrUrl
      ? `A separate remediation PR is available: ${fixPrUrl}`
      : analysis.fixRequired
        ? "Code changes appear necessary. No remediation PR was created."
        : "No required code changes were identified.",
    remediationWarning ? `\n> ${remediationWarning}` : "",
    "",
    "## Analysis coverage",
    coverage,
    context.omittedFiles.length ? `<details><summary>Omitted files</summary>\n\n${list(context.omittedFiles.slice(0, 200), "None")}\n</details>` : "",
    "",
    "_This analysis complements human review. Verify conclusions and run the repository's normal CI before merging._",
  ].filter((part) => part !== "").join("\n");
}
