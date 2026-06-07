import { booleanInput, input } from "./io.ts";

export type ReviewMode = "prompt" | "openai";

export interface ActionConfig {
  githubToken: string;
  reviewMode: ReviewMode;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl: string;
  gitlabToken?: string;
  createFixPr: boolean;
  maxContextCharacters: number;
  customExcludes: string[];
}

export function readConfig(): ActionConfig {
  const githubToken = input("github-token", true);
  const reviewModeInput = input("review-mode") || "prompt";
  if (reviewModeInput !== "prompt" && reviewModeInput !== "openai") {
    throw new Error("review-mode must be either prompt or openai");
  }
  const reviewMode = reviewModeInput as ReviewMode;
  const createFixPr = booleanInput("create-fix-pr");
  if (createFixPr && reviewMode !== "openai") {
    throw new Error("create-fix-pr can only be enabled when review-mode is openai");
  }

  const openaiApiKey = input("openai-api-key");
  const openaiModel = input("openai-model");
  if (reviewMode === "openai" && !openaiApiKey) {
    throw new Error("Missing required input for openai review mode: openai-api-key");
  }
  if (reviewMode === "openai" && !openaiModel) {
    throw new Error("Missing required input for openai review mode: openai-model");
  }

  const maxContextCharacters = Number(input("max-context-characters") || "600000");
  if (
    reviewMode === "openai"
    && (!Number.isSafeInteger(maxContextCharacters) || maxContextCharacters < 10_000)
  ) {
    throw new Error("max-context-characters must be an integer of at least 10000");
  }

  return {
    githubToken,
    reviewMode,
    openaiApiKey: openaiApiKey || undefined,
    openaiModel: openaiModel || undefined,
    openaiBaseUrl: input("openai-base-url") || "https://api.openai.com/v1",
    gitlabToken: input("gitlab-token") || undefined,
    createFixPr,
    maxContextCharacters,
    customExcludes: input("exclude").split(/\r?\n/).map((line) => line.trim()),
  };
}
