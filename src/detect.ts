import type { DependencyUpdate } from "./types.ts";
import { parseYamlMappings as parseYaml } from "./yaml.ts";

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function cleanPnpmVersion(value: string): string {
  let version = value.trim();
  if (version.startsWith("npm:")) {
    const alias = version.slice(4);
    const separator = alias.lastIndexOf("@");
    version = separator > 0 ? alias.slice(separator + 1) : alias;
  }
  if (version.startsWith("link:") || version.startsWith("workspace:") || version.startsWith("file:")) return version;
  const peerStart = version.indexOf("(");
  if (peerStart >= 0) version = version.slice(0, peerStart);
  return version;
}

function pnpmAliasPackage(value: string): string | undefined {
  if (!value.startsWith("npm:")) return undefined;
  const alias = value.slice(4);
  const separator = alias.lastIndexOf("@");
  return separator > 0 ? alias.slice(0, separator) : undefined;
}

function pnpmCatalogVersions(document: UnknownRecord): Map<string, string> {
  const result = new Map<string, string>();
  // The plural `catalogs` map (named catalogs, lockfile format) and the singular
  // `catalog` shorthand (default catalog in pnpm-workspace.yaml) both apply.
  const catalogs = [object(document.catalog), ...Object.values(object(document.catalogs))];
  for (const catalog of catalogs) {
    for (const [name, rawEntry] of Object.entries(object(catalog))) {
      // Entries are either `pkg: version` (workspace shorthand) or `pkg: { specifier, version }` (lockfile).
      const resolved = text(rawEntry) ?? text(object(rawEntry).version);
      if (!resolved) continue;
      const version = cleanPnpmVersion(resolved);
      if (/^(link|workspace|file):/.test(version)) continue;
      result.set(name, version);
    }
  }
  return result;
}

function pnpmImporterDependencies(lockfile: UnknownRecord): Map<string, { version: string; importer: string; sourcePackage?: string }> {
  const result = new Map<string, { version: string; importer: string; sourcePackage?: string }>();
  const importers = object(lockfile.importers);
  for (const [importer, rawImporter] of Object.entries(importers)) {
    const importerData = object(rawImporter);
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, rawDependency] of Object.entries(object(importerData[field]))) {
        const dependency = object(rawDependency);
        const resolved = text(dependency.version) ?? text(rawDependency);
        if (!resolved) continue;
        const version = cleanPnpmVersion(resolved);
        if (/^(link|workspace|file):/.test(version)) continue;
        result.set(`${importer}\0${name}`, { version, importer, sourcePackage: pnpmAliasPackage(resolved) });
      }
    }
  }
  return result;
}

export interface PnpmFeatures {
  lockfileVersion?: string;
  pnpmMajor?: number;
  hasCatalogs: boolean;
  hasConfigDependencies: boolean;
  hasPackageManagerResolution: boolean;
  simplifiedPatchedDependencies: boolean;
  dedupePeers: boolean;
}

export function inspectPnpmFeatures(content: string, packageJson?: string, workspaceYaml?: string): PnpmFeatures {
  const lockfile = object(parseYaml(content));
  const workspace = workspaceYaml ? object(parseYaml(workspaceYaml)) : {};
  const manifest = packageJson ? object(JSON.parse(packageJson)) : {};
  const devPackageManager = object(object(manifest.devEngines).packageManager);
  const lockedPackageManager = object(lockfile.packageManager);
  const packageManager = text(manifest.packageManager)
    ?? text(object(manifest.devEngines).packageManager)
    ?? (text(devPackageManager.name) === "pnpm" ? `pnpm@${text(devPackageManager.version) ?? ""}` : undefined)
    ?? (text(lockedPackageManager.name) === "pnpm" ? `pnpm@${text(lockedPackageManager.version) ?? ""}` : undefined)
    ?? text(lockfile.packageManager);
  const match = packageManager?.match(/pnpm@?[^\d]*(\d+)/);
  const patches = Object.values(object(lockfile.patchedDependencies));
  return {
    lockfileVersion: text(lockfile.lockfileVersion),
    pnpmMajor: match ? Number(match[1]) : undefined,
    hasCatalogs: [lockfile.catalog, lockfile.catalogs, workspace.catalog, workspace.catalogs]
      .some((value) => Object.keys(object(value)).length > 0),
    hasConfigDependencies: Object.keys(object(lockfile.configDependencies)).length > 0
      || Object.keys(object(workspace.configDependencies)).length > 0,
    hasPackageManagerResolution: "packageManager" in lockfile || "packageManager" in object(lockfile.devEngines),
    simplifiedPatchedDependencies: patches.some((patch) => typeof patch === "string"),
    dedupePeers: object(lockfile.settings).dedupePeers === true || workspace.dedupePeers === true,
  };
}

export function detectPnpmUpdates(base: string, head: string, path = "pnpm-lock.yaml"): DependencyUpdate[] {
  const baseLock = object(parseYaml(base));
  const headLock = object(parseYaml(head));
  const before = pnpmImporterDependencies(baseLock);
  const after = pnpmImporterDependencies(headLock);
  const grouped = new Map<string, DependencyUpdate>();

  for (const [key, current] of after) {
    const previous = before.get(key);
    if (!previous || previous.version === current.version) continue;
    const name = key.split("\0")[1]!;
    const identity = `${name}\0${previous.version}\0${current.version}`;
    const existing = grouped.get(identity);
    const manifest = current.importer === "." ? "package.json" : `${current.importer}/package.json`;
    if (existing) {
      if (!existing.manifests.includes(manifest)) existing.manifests.push(manifest);
    } else {
      grouped.set(identity, {
        kind: "npm",
        name,
        previousVersion: previous.version,
        newVersion: current.version,
        manifests: [manifest, path],
        sourcePackage: current.sourcePackage,
      });
    }
  }

  const beforeCatalogs = pnpmCatalogVersions(baseLock);
  const afterCatalogs = pnpmCatalogVersions(headLock);
  for (const [name, current] of afterCatalogs) {
    const previous = beforeCatalogs.get(name);
    if (!previous || previous === current) continue;
    const identity = `${name}\0${previous}\0${current}`;
    const existing = grouped.get(identity);
    if (existing) {
      if (!existing.manifests.includes("pnpm-workspace.yaml")) existing.manifests.push("pnpm-workspace.yaml");
    } else {
      grouped.set(identity, {
        kind: "npm",
        name,
        previousVersion: previous,
        newVersion: current,
        manifests: [...new Set(["pnpm-workspace.yaml", path])],
      });
    }
  }
  return [...grouped.values()];
}

function packageLockVersions(content: string): Map<string, string> {
  const lock = JSON.parse(content) as UnknownRecord;
  const result = new Map<string, string>();
  for (const [path, rawPackage] of Object.entries(object(lock.packages))) {
    if (!path.startsWith("node_modules/") || path.slice("node_modules/".length).includes("/node_modules/")) continue;
    const name = path.slice("node_modules/".length);
    const version = text(object(rawPackage).version);
    if (version) result.set(name, version);
  }
  if (result.size === 0) {
    for (const [name, rawDependency] of Object.entries(object(lock.dependencies))) {
      const version = text(object(rawDependency).version);
      if (version) result.set(name, version);
    }
  }
  return result;
}

export function detectPackageLockUpdates(base: string, head: string, path = "package-lock.json"): DependencyUpdate[] {
  const before = packageLockVersions(base);
  const after = packageLockVersions(head);
  return [...after.entries()]
    .filter(([name, version]) => before.has(name) && before.get(name) !== version)
    .map(([name, version]) => ({
      kind: "npm",
      name,
      previousVersion: before.get(name)!,
      newVersion: version,
      manifests: ["package.json", path],
    }));
}

export function detectManifestUpdates(base: string, head: string, path: string): DependencyUpdate[] {
  const before = object(JSON.parse(base));
  const after = object(JSON.parse(head));
  const updates: DependencyUpdate[] = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const previousDependencies = object(before[field]);
    for (const [name, rawVersion] of Object.entries(object(after[field]))) {
      const previous = text(previousDependencies[name]);
      const version = text(rawVersion);
      if (!previous || !version || previous === version || /^(workspace|file|link):/.test(version)) continue;
      updates.push({
        kind: "npm",
        name,
        previousVersion: previous,
        newVersion: version,
        manifests: [path],
      });
    }
  }
  return updates;
}

interface WorkflowUse {
  ref: string;
  release?: string;
}

function workflowUses(content: string): Map<string, WorkflowUse> {
  const result = new Map<string, WorkflowUse>();
  const pattern = /^\s*(?:-\s*)?uses:\s*["']?([^@\s"']+)@([^\s"'#]+)["']?(?:\s*#\s*(\S+))?/gm;
  for (const match of content.matchAll(pattern)) {
    const release = match[3] && /^v?\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(match[3])
      ? match[3]
      : undefined;
    result.set(match[1]!, { ref: match[2]!, release });
  }
  return result;
}

export function detectActionUpdates(base: string, head: string, path: string): DependencyUpdate[] {
  const before = workflowUses(base);
  const after = workflowUses(head);
  return [...after.entries()]
    .filter(([name, current]) => before.has(name) && before.get(name)?.ref !== current.ref)
    .map(([name, current]) => ({
      kind: "github-action",
      name,
      previousVersion: before.get(name)!.ref,
      newVersion: current.ref,
      previousRelease: before.get(name)!.release,
      newRelease: current.release,
      manifests: [path],
      sourceUrl: `https://github.com/${name}`,
    }));
}

export function deduplicateUpdates(updates: DependencyUpdate[]): DependencyUpdate[] {
  const resolvedNames = new Set(
    updates
      .filter((update) => update.kind === "npm" && update.manifests.some((path) => /(?:package-lock\.json|pnpm-lock\.yaml)$/.test(path)))
      .map((update) => update.name),
  );
  const result = new Map<string, DependencyUpdate>();
  for (const update of updates) {
    if (
      update.kind === "npm"
      && resolvedNames.has(update.name)
      && update.manifests.every((path) => path.endsWith("package.json"))
    ) {
      const resolved = [...result.values()].find((candidate) =>
        candidate.kind === "npm"
        && candidate.name === update.name
        && candidate.manifests.some((path) => /(?:package-lock\.json|pnpm-lock\.yaml)$/.test(path)),
      );
      if (resolved) resolved.manifests = [...new Set([...resolved.manifests, ...update.manifests])];
      continue;
    }
    const key = `${update.kind}\0${update.name}\0${update.previousVersion}\0${update.newVersion}`;
    const existing = result.get(key);
    if (!existing) {
      result.set(key, { ...update, manifests: [...update.manifests] });
      continue;
    }
    existing.manifests = [...new Set([...existing.manifests, ...update.manifests])];
  }
  for (const update of updates) {
    if (
      update.kind !== "npm"
      || !resolvedNames.has(update.name)
      || !update.manifests.every((path) => path.endsWith("package.json"))
    ) continue;
    const resolved = [...result.values()].find((candidate) =>
      candidate.kind === "npm"
      && candidate.name === update.name
      && candidate.manifests.some((path) => /(?:package-lock\.json|pnpm-lock\.yaml)$/.test(path)),
    );
    if (resolved) resolved.manifests = [...new Set([...resolved.manifests, ...update.manifests])];
  }
  return [...result.values()];
}
