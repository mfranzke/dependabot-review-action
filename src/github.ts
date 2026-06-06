import { readFile } from "node:fs/promises";
import type { PullRequestContext } from "./types.ts";

interface GitHubOptions {
  token: string;
  owner: string;
  repo: string;
}

export class GitHubClient {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;

  constructor(options: GitHubOptions) {
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "dependabot-review-action",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async getFile(path: string, ref: string): Promise<string | undefined> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          accept: "application/vnd.github.raw+json",
          authorization: `Bearer ${this.token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "dependabot-review-action",
        },
      },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Unable to read ${path}@${ref}: ${response.status}`);
    return response.text();
  }

  async changedFiles(pr: number): Promise<string[]> {
    const files: string[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.request<Array<{ filename: string }>>(
        `/repos/${this.owner}/${this.repo}/pulls/${pr}/files?per_page=100&page=${page}`,
      );
      files.push(...batch.map((file) => file.filename));
      if (batch.length < 100) return files;
    }
  }

  async upsertComment(pr: number, marker: string, body: string): Promise<string> {
    const comments: Array<{ id: number; body?: string; html_url: string }> = [];
    for (let page = 1; ; page++) {
      const batch = await this.request<Array<{ id: number; body?: string; html_url: string }>>(
        `/repos/${this.owner}/${this.repo}/issues/${pr}/comments?per_page=100&page=${page}`,
      );
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    const existing = comments.find((comment) => comment.body?.includes(marker));
    if (existing) {
      const updated = await this.request<{ html_url: string }>(
        `/repos/${this.owner}/${this.repo}/issues/comments/${existing.id}`,
        { method: "PATCH", body: JSON.stringify({ body }) },
      );
      return updated.html_url;
    }
    const created = await this.request<{ html_url: string }>(
      `/repos/${this.owner}/${this.repo}/issues/${pr}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    return created.html_url;
  }

  async findOpenPullRequest(head: string, base: string): Promise<{ number: number; html_url: string } | undefined> {
    const prs = await this.request<Array<{ number: number; html_url: string }>>(
      `/repos/${this.owner}/${this.repo}/pulls?state=open&head=${encodeURIComponent(`${this.owner}:${head}`)}&base=${encodeURIComponent(base)}`,
    );
    return prs[0];
  }

  async createPullRequest(head: string, base: string, body: string): Promise<{ number: number; html_url: string }> {
    return this.request(`/repos/${this.owner}/${this.repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: "Apply changes required by dependency updates",
        head,
        base,
        body,
      }),
    });
  }
}

export async function readPullRequestContext(): Promise<PullRequestContext> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not set");
  const event = JSON.parse(await readFile(eventPath, "utf8")) as {
    pull_request?: {
      number: number;
      html_url: string;
      base: { sha: string; ref: string; repo: { name: string; owner: { login: string } } };
      head: { sha: string; ref: string; repo: { owner: { login: string } } };
      user: { login: string };
    };
  };
  const pr = event.pull_request;
  if (!pr) throw new Error("This action only supports pull_request events");
  if (pr.user.login !== "dependabot[bot]") throw new Error("The pull request was not opened by dependabot[bot]");
  return {
    owner: pr.base.repo.owner.login,
    repo: pr.base.repo.name,
    number: pr.number,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    headRepoOwner: pr.head.repo.owner.login,
    htmlUrl: pr.html_url,
  };
}
