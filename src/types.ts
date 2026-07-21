import type { ModelReasoningEffort, SandboxMode } from "@openai/codex-sdk";

export type RouteName = "luna-low" | "terra-medium" | "sol-high" | "sol-xhigh";

export interface ProjectContext {
  root: string;
  docs: Array<{ path: string; content: string }>;
  manifests: string[];
  signals: string[];
}

export interface RoutingDecision {
  route: RouteName;
  model: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
  reasoning: ModelReasoningEffort;
  agentCount: 1 | 2;
  sandbox: SandboxMode;
  reasons: string[];
  scores: Record<RouteName, number>;
}

export interface RunResult {
  finalResponse: string;
  reviewResponse?: string;
  threadIds: string[];
}

