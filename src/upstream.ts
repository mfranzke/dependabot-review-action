import type { DependencyUpdate } from "./types.ts";

interface SourceRepository {
  host: "github" | "gitlab";
  owner: string;
  repo: string;
  url: string;
}

function normalizeRepository(value: unknown): SourceRepository | undefined {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object" && "url" in value ? String((value as { url: unknown }).url) : "";
  const shorthand = raw.match(/^(github|gitlab):([^/]+)\/(.+)$/i);
  const ssh = raw.match(/^(?:git\+ssh:\/\/git@|git@)(github\.com|gitlab\.com)[:/]([^/]+)\/(.+)$/i);
  const normalized = shorthand
    ? `https://${shorthand[1]!.toLowerCase()}.com/${shorthand[2]}/${shorthand[3]}`
    : ssh
      ? `https://${ssh[1]}/${ssh[2]}/${ssh[3]}`
      : raw;
  const cleaned = normalized.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git(?:#.*)?$/, "");
  const match = cleaned.match(/^https?:\/\/(github\.com|gitlab\.com)\/([^/]+)\/([^/#]+)(?:\/.*)?$/i);
  if (!match) return undefined;
  return {
    host: match[1]!.toLowerCase() === "github.com" ? "github" : "gitlab",
    owner: match[2]!,
    repo: match[3]!,
    url: `https://${match[1]}/${match[2]}/${match[3]}`,
  };
}

async function responseText(response: Response, label: string): Promise<string> {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.text();
}

function truncate(value: string, maximum = 60_000): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n\n[truncated]`;
}

type UpstreamDetails = Pick<DependencyUpdate, "releaseNotes" | "upstreamDiff" | "releaseUrl" | "comparisonUrl">;

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

interface GitHubRelease {
  tag_name: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function semanticVersion(value: string | undefined): SemanticVersion | undefined {
  if (!value) return undefined;
  const candidate = value.slice(value.lastIndexOf("@") + 1).replace(/^v/, "");
  const match = candidate.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true });
}

function withoutGeneratedComparison(body: string): string {
  return body
    .split("\n")
    .filter((line) =>
      !/^\s*(?:[-*]\s*)?\**Full Changelog\**:\s*https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/compare\/\S+\s*$/i.test(line)
    )
    .join("\n")
    .trim();
}

async function githubReleaseRange(
  source: SourceRepository,
  from: string | undefined,
  to: string | undefined,
  headers: Record<string, string>,
): Promise<{ notes: string; url?: string } | undefined> {
  const lower = semanticVersion(from);
  const upper = semanticVersion(to);
  if (!lower || !upper || compareSemanticVersions(lower, upper) >= 0) return undefined;

  const releases: Array<{ release: GitHubRelease; version: SemanticVersion }> = [];
  for (let page = 1; page <= 3; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=100&page=${page}`,
      { headers },
    );
    if (!response.ok) return undefined;
    const batch = await response.json() as GitHubRelease[];
    for (const release of batch) {
      const version = semanticVersion(release.tag_name);
      if (
        !release.draft
        && version
        && compareSemanticVersions(version, lower) > 0
        && compareSemanticVersions(version, upper) <= 0
      ) {
        releases.push({ release, version });
      }
    }
    if (batch.length < 100) break;
  }
  if (!releases.length) return undefined;

  releases.sort((left, right) => compareSemanticVersions(right.version, left.version));
  const notes = releases.map(({ release }) => {
    const body = withoutGeneratedComparison(release.body ?? "");
    return [
      `## ${release.name ?? release.tag_name}`,
      body,
      release.html_url ?? "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
  return { notes, url: releases[0]!.release.html_url };
}

async function githubDetails(
  source: SourceRepository,
  from: string,
  to: string,
  token: string,
  fromRelease?: string,
  toRelease?: string,
): Promise<UpstreamDetails> {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "dependabot-review-action",
  };
  const releaseCandidates = (version: string, release?: string) =>
    unique([release, version, `v${version}`, `${source.repo}@${version}`]);
  const comparisonCandidates = (version: string, release?: string) =>
    unique([version, release, `v${version}`, `${source.repo}@${version}`]);
  let releaseNotes = "";
  let releaseUrl: string | undefined;
  const releaseRange = await githubReleaseRange(source, fromRelease ?? from, toRelease ?? to, headers);
  if (releaseRange) {
    releaseNotes = releaseRange.notes;
    releaseUrl = releaseRange.url;
  } else {
    for (const tag of releaseCandidates(to, toRelease)) {
      const response = await fetch(`https://api.github.com/repos/${source.owner}/${source.repo}/releases/tags/${encodeURIComponent(tag)}`, { headers });
      if (response.ok) {
        const release = await response.json() as GitHubRelease;
        releaseNotes = [
          release.name ?? tag,
          withoutGeneratedComparison(release.body ?? ""),
          release.html_url ?? "",
        ].filter(Boolean).join("\n");
        releaseUrl = release.html_url;
        break;
      }
    }
  }
  if (!releaseNotes) {
    for (const path of ["CHANGELOG.md", "Changelog.md", "changelog.md", "CHANGES.md", "HISTORY.md"]) {
      const response = await fetch(
        `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${path}?ref=${encodeURIComponent(to)}`,
        { headers: { ...headers, accept: "application/vnd.github.raw+json" } },
      );
      if (response.ok) {
        releaseUrl = `${source.url}/blob/${encodeURIComponent(to)}/${path}`;
        releaseNotes = `${path}\n${await response.text()}\n${releaseUrl}`;
        break;
      }
    }
  }
  let upstreamDiff = "";
  let comparisonUrl: string | undefined;
  for (const oldRef of comparisonCandidates(from, fromRelease)) {
    for (const newRef of comparisonCandidates(to, toRelease)) {
      const response = await fetch(
        `https://api.github.com/repos/${source.owner}/${source.repo}/compare/${encodeURIComponent(oldRef)}...${encodeURIComponent(newRef)}`,
        { headers: { ...headers, accept: "application/vnd.github.v3.diff" } },
      );
      if (response.ok) {
        upstreamDiff = await response.text();
        comparisonUrl = `${source.url}/compare/${encodeURIComponent(oldRef)}...${encodeURIComponent(newRef)}`;
        break;
      }
    }
    if (upstreamDiff) break;
  }
  return { releaseNotes: truncate(releaseNotes, 20_000), upstreamDiff: truncate(upstreamDiff), releaseUrl, comparisonUrl };
}

async function gitlabDetails(source: SourceRepository, from: string, to: string, token?: string): Promise<UpstreamDetails> {
  const project = encodeURIComponent(`${source.owner}/${source.repo}`);
  const headers: Record<string, string> = token ? { "PRIVATE-TOKEN": token } : {};
  const candidates = (version: string) => [version, `v${version}`, `${source.repo}@${version}`];
  let releaseNotes = "";
  let releaseUrl: string | undefined;
  for (const tag of candidates(to)) {
    const response = await fetch(`https://gitlab.com/api/v4/projects/${project}/releases/${encodeURIComponent(tag)}`, { headers });
    if (response.ok) {
      const release = await response.json() as { name?: string; description?: string; _links?: { self?: string } };
      releaseNotes = `${release.name ?? tag}\n${release.description ?? ""}\n${release._links?.self ?? ""}`;
      releaseUrl = release._links?.self;
      break;
    }
  }
  let upstreamDiff = "";
  let comparisonUrl: string | undefined;
  for (const oldRef of candidates(from)) {
    for (const newRef of candidates(to)) {
      const response = await fetch(
        `https://gitlab.com/api/v4/projects/${project}/repository/compare?from=${encodeURIComponent(oldRef)}&to=${encodeURIComponent(newRef)}&straight=true`,
        { headers },
      );
      if (response.ok) {
        const comparison = await response.json() as { diffs?: Array<{ old_path: string; new_path: string; diff: string }> };
        upstreamDiff = (comparison.diffs ?? []).map((diff) => `diff --git a/${diff.old_path} b/${diff.new_path}\n${diff.diff}`).join("\n");
        comparisonUrl = `${source.url}/-/compare/${encodeURIComponent(oldRef)}...${encodeURIComponent(newRef)}`;
        break;
      }
    }
    if (upstreamDiff) break;
  }
  return { releaseNotes: truncate(releaseNotes, 20_000), upstreamDiff: truncate(upstreamDiff), releaseUrl, comparisonUrl };
}

export async function enrichUpdate(
  update: DependencyUpdate,
  githubToken: string,
  gitlabToken?: string,
): Promise<DependencyUpdate> {
  try {
    let source = normalizeRepository(update.sourceUrl);
    if (update.kind === "npm") {
      const packageName = update.sourcePackage ?? update.name;
      const metadataResponse = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
      const metadata = JSON.parse(await responseText(metadataResponse, `npm metadata for ${update.name}`)) as {
        repository?: unknown;
        versions?: Record<string, { repository?: unknown }>;
      };
      source = normalizeRepository(metadata.versions?.[update.newVersion]?.repository ?? metadata.repository);
    }
    if (!source) return { ...update, upstreamWarning: "No supported GitHub or GitLab source repository could be resolved." };
    const details = source.host === "github"
      ? await githubDetails(
        source,
        update.previousVersion,
        update.newVersion,
        githubToken,
        update.previousRelease,
        update.newRelease,
      )
      : await gitlabDetails(source, update.previousVersion, update.newVersion, gitlabToken);
    return {
      ...update,
      sourceUrl: source.url,
      ...details,
      upstreamWarning: details.upstreamDiff ? undefined : "The upstream tag comparison could not be resolved.",
    };
  } catch (error) {
    return { ...update, upstreamWarning: error instanceof Error ? error.message : String(error) };
  }
}
