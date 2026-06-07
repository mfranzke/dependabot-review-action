export type DependencyKind = "npm" | "github-action";

export interface DependencyUpdate {
  kind: DependencyKind;
  name: string;
  previousVersion: string;
  newVersion: string;
  previousRelease?: string;
  newRelease?: string;
  manifests: string[];
  sourcePackage?: string;
  sourceUrl?: string;
  releaseUrl?: string;
  comparisonUrl?: string;
  releaseNotes?: string;
  upstreamDiff?: string;
  upstreamWarning?: string;
}

export interface PullRequestContext {
  owner: string;
  repo: string;
  number: number;
  baseSha: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  headRepoOwner: string;
  htmlUrl: string;
}

export interface AnalysisFinding {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: "low" | "medium" | "high";
  details: string;
  files: string[];
  requiredAction: string;
}

export interface ReviewAnalysis {
  summary: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  fixRequired: boolean;
  findings: AnalysisFinding[];
  dependencySummaries: Array<{
    name: string;
    summary: string;
    notableChanges: string[];
    hiddenOrUnclearChanges: string[];
  }>;
}

export interface RepositoryContext {
  content: string;
  includedFiles: string[];
  omittedFiles: string[];
  totalCharacters: number;
}
