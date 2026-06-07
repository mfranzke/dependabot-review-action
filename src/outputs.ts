import { setOutput } from "./io.ts";

export function setPromptOutputs(commentUrl: string, dependencyCount: number): void {
  setOutput("review-comment-url", commentUrl);
  setOutput("risk-level", "");
  setOutput("fix-required", "");
  setOutput("fix-pr-url", "");
  setOutput("dependencies-reviewed", dependencyCount);
}
