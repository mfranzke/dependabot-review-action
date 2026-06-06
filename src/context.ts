import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { DependencyUpdate, RepositoryContext } from "./types.ts";

const DEFAULT_EXCLUDES = [
  ".git/**", "node_modules/**", "dist/**", "build/**", "coverage/**", ".next/**",
  ".env", ".env.*", "**/.env", "**/.env.*",
  "*.pem", "*.key", "*.p12", "*.pfx", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx",
  "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.webp", "**/*.ico",
  "**/*.zip", "**/*.gz", "**/*.pdf", "**/*.woff", "**/*.woff2",
];

function globPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\0", ".*");
  return new RegExp(`^(?:${escaped})$`);
}

function excluded(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globPattern(pattern).test(path));
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, 8192);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
  }
  return sample.length === 0 || suspicious / sample.length < 0.02;
}

async function listFiles(root: string, patterns: string[], directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (excluded(path, patterns) || excluded(`${path}/`, patterns)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...await listFiles(root, patterns, absolute));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function priority(path: string, dependencyNames: string[]): number {
  if (/^(package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(path)) return 0;
  if (path.startsWith(".github/workflows/")) return 1;
  if (dependencyNames.some((name) => path.toLowerCase().includes(name.toLowerCase().replaceAll("/", "-")))) return 2;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml)$/.test(path)) return 3;
  return 4;
}

export async function collectRepositoryContext(
  root: string,
  updates: DependencyUpdate[],
  maxCharacters: number,
  customExcludes: string[],
): Promise<RepositoryContext> {
  const patterns = [...DEFAULT_EXCLUDES, ...customExcludes.filter(Boolean)];
  const names = updates.map((update) => update.name);
  const files = (await listFiles(root, patterns)).sort((a, b) => priority(a, names) - priority(b, names) || a.localeCompare(b));
  const chunks: string[] = [];
  const includedFiles: string[] = [];
  const omittedFiles: string[] = [];
  let totalCharacters = 0;

  for (const path of files) {
    const absolute = resolve(root, path);
    const stat = await lstat(absolute);
    if (stat.size > 1_000_000) {
      omittedFiles.push(path);
      continue;
    }
    const buffer = await readFile(absolute);
    if (!isProbablyText(buffer)) {
      omittedFiles.push(path);
      continue;
    }
    const content = buffer.toString("utf8");
    const chunk = `\n--- FILE: ${path} ---\n${content}\n`;
    if (totalCharacters + chunk.length > maxCharacters) {
      omittedFiles.push(path);
      continue;
    }
    chunks.push(chunk);
    includedFiles.push(path);
    totalCharacters += chunk.length;
  }
  return { content: chunks.join(""), includedFiles, omittedFiles, totalCharacters };
}
