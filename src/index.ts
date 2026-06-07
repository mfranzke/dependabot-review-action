import { collectRepositoryContext } from "./context.ts";
import { readConfig } from "./config.ts";
import {
  deduplicateUpdates,
  detectActionUpdates,
  detectManifestUpdates,
  detectPackageLockUpdates,
  detectPnpmUpdates,
  inspectPnpmFeatures,
} from "./detect.ts";
import { GitHubClient, readPullRequestContext } from "./github.ts";
import { fail, info, setOutput, warning } from "./io.ts";
import { OpenAIClient } from "./openai.ts";
import { setPromptOutputs } from "./outputs.ts";
import { renderPromptReport } from "./prompt.ts";
import { createOrUpdateRemediation } from "./remediation.ts";
import { COMMENT_MARKER, renderReport } from "./report.ts";
import type { DependencyUpdate } from "./types.ts";
import { enrichUpdate } from "./upstream.ts";

async function detectUpdates(
  github: GitHubClient,
  prNumber: number,
  baseSha: string,
  headSha: string,
): Promise<DependencyUpdate[]> {
  const changed = await github.changedFiles(prNumber);
  const updates: DependencyUpdate[] = [];

  for (const path of changed) {
    const relevant = path === "package-lock.json"
      || path === "pnpm-lock.yaml"
      || path.endsWith("/pnpm-lock.yaml")
      || path === "package.json"
      || path.endsWith("/package.json")
      || /^\.github\/workflows\/.+\.ya?ml$/.test(path);
    if (!relevant) continue;
    const [base, head] = await Promise.all([
      github.getFile(path, baseSha),
      github.getFile(path, headSha),
    ]);
    if (base === undefined || head === undefined) continue;
    try {
      if (path.endsWith("pnpm-lock.yaml")) updates.push(...detectPnpmUpdates(base, head, path));
      else if (path.endsWith("package-lock.json")) updates.push(...detectPackageLockUpdates(base, head, path));
      else if (path.endsWith("package.json")) updates.push(...detectManifestUpdates(base, head, path));
      else updates.push(...detectActionUpdates(base, head, path));
    } catch (error) {
      throw new Error(`Failed to parse changed dependency file ${path}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return deduplicateUpdates(updates);
}

async function main(): Promise<void> {
  const config = readConfig();
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const context = await readPullRequestContext();
  const github = new GitHubClient({ token: config.githubToken, owner: context.owner, repo: context.repo });
  info(`Inspecting Dependabot PR #${context.number}`);
  const detected = await detectUpdates(github, context.number, context.baseSha, context.headSha);
  if (detected.length === 0) throw new Error("No supported npm, pnpm, or GitHub Actions dependency updates were detected");
  info(`Detected ${detected.length} dependency update(s)`);

  const rootPnpmLock = await github.getFile("pnpm-lock.yaml", context.headSha);
  if (rootPnpmLock) {
    const [manifest, workspaceYaml] = await Promise.all([
      github.getFile("package.json", context.headSha),
      github.getFile("pnpm-workspace.yaml", context.headSha),
    ]);
    const features = inspectPnpmFeatures(rootPnpmLock, manifest, workspaceYaml);
    info(`pnpm lockfile ${features.lockfileVersion ?? "unknown"}; pnpm major ${features.pnpmMajor ?? "not declared"}`);
    if (features.pnpmMajor !== undefined && features.pnpmMajor > 11) {
      warning(`Repository declares pnpm ${features.pnpmMajor}; this action is tested through pnpm 11`);
    }
  }

  const updates = await Promise.all(detected.map((update) =>
    enrichUpdate(update, config.githubToken, config.gitlabToken)
  ));
  if (config.reviewMode === "prompt") {
    const commentUrl = await github.upsertComment(context.number, COMMENT_MARKER, renderPromptReport(updates));
    setPromptOutputs(commentUrl, updates.length);
    info(`Review prompt published: ${commentUrl}`);
    return;
  }

  const repositoryContext = await collectRepositoryContext(
    workspace,
    updates,
    config.maxContextCharacters,
    config.customExcludes,
  );
  if (repositoryContext.omittedFiles.length) {
    warning(`${repositoryContext.omittedFiles.length} repository files were omitted by safety or context limits`);
  }

  const openai = new OpenAIClient(config.openaiApiKey!, config.openaiModel!, config.openaiBaseUrl);
  const analysis = await openai.analyze(updates, repositoryContext);
  let fixPrUrl: string | undefined;
  let remediationWarning: string | undefined;

  if (analysis.fixRequired && config.createFixPr) {
    try {
      const generated = await openai.createPatch(updates, repositoryContext, analysis);
      fixPrUrl = await createOrUpdateRemediation(github, context, generated.patch, generated.summary, workspace);
    } catch (error) {
      remediationWarning = `A remediation PR could not be created: ${error instanceof Error ? error.message : error}`;
      warning(remediationWarning);
    }
  }

  const report = renderReport(updates, analysis, repositoryContext, fixPrUrl, remediationWarning);
  const commentUrl = await github.upsertComment(context.number, COMMENT_MARKER, report);
  setOutput("review-comment-url", commentUrl);
  setOutput("risk-level", analysis.riskLevel);
  setOutput("fix-required", analysis.fixRequired);
  setOutput("fix-pr-url", fixPrUrl ?? "");
  setOutput("dependencies-reviewed", updates.length);
  info(`Review published: ${commentUrl}`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
