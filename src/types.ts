import type { ModelReasoningEffort } from "@openai/codex-sdk";

export type RouteName = "luna-low" | "terra-medium" | "sol-high" | "sol-xhigh-review";
export type ModelName = "luna" | "terra" | "sol";
export type ModelId = "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
export type ReasoningLevel = Extract<ModelReasoningEffort, "low" | "medium" | "high" | "xhigh">;
export type Workflow = "single-agent" | "development-review";
export type Permissions = "read-only" | "workspace-write";
export type UncertaintyLevel = "low" | "medium" | "high";
export type RoutingSource = "luna" | "preset" | "legacy-fallback" | "terra-fallback" | "user";
export type RiskLevel = "low" | "medium" | "high";
export type ConfidenceLevel = "low" | "medium" | "high";
export type ExperimentalIntent = "advice" | "analysis" | "implementation" | "bugfix" | "review";
export type TaskFamily = "advice" | "localized_edit" | "mechanical_change" | "repo_bugfix" | "feature" | "long_refactor" | "terminal_heavy";
export type TaskScope = "local" | "multi_file" | "multi_package" | "unknown";
export type DocumentationQuality = "poor" | "partial" | "good";
export type ExperimentalRisk = "low" | "medium" | "high" | "critical";
export type TaskIntent = "discussion" | "ideation" | "planning" | "analysis" | "implementation" | "fix" | "review";
export type ExpectedResult = "text-response" | "plan" | "project-changes" | "review-report";
export type MissionStatus = "running" | "completed" | "failed" | "permission_required" | "cancelled" | "timed_out" | "interrupted";
export type MissionStep = "docs" | "files" | "route" | "execution" | "tests";

export interface ProjectContext {
  root: string;
  docs: Array<{ path: string; content: string }>;
  manifests: string[];
  signals: string[];
}

export interface RoutingDecision {
  preset?: RouteName;
  modelName: ModelName;
  model: ModelId;
  reasoning: ReasoningLevel;
  workflow: Workflow;
  permissions: Permissions;
  uncertainty: UncertaintyLevel;
  intent: TaskIntent;
  expectedResult: ExpectedResult;
  requiresConfirmation: boolean;
  reason: string;
  unknowns: string[];
  source: RoutingSource;
  legacyScores?: Record<RouteName, number>;
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface RoutingResult {
  brief: RoutingBrief;
  decision: RoutingDecision;
  routerUsage: TokenUsage;
  lunaAttempts: number;
  fallbackReason?: string;
}

export interface TaskProfile {
  intent: ExperimentalIntent;
  family: TaskFamily;
  scope: TaskScope;
  reasoningDepth: "low" | "medium" | "high";
  mechanicalVolume: "low" | "medium" | "high";
  uncertainty: "low" | "medium" | "high";
  risk: ExperimentalRisk;
  terminalIntensity: "low" | "medium" | "high";
  documentationQuality: DocumentationQuality;
  requiresWrite: boolean;
  availableValidations: string[];
  summary: string;
}

export interface BenchmarkPrior {
  source: string;
  version: string;
  measuredAt: string;
  family: TaskFamily;
  model: ModelName;
  reasoning: ReasoningLevel;
  score: number;
  confidence: ConfidenceLevel;
}

export interface BenchmarkSnapshot { schemaVersion: "benchmark-priors-v1"; priors: BenchmarkPrior[]; }
export interface ExperimentalCandidate {
  modelName: ModelName;
  reasoning: ReasoningLevel;
  workflow: Workflow;
  permissions: Permissions;
  qualityIndex: number | null;
  costIndex: number;
  confidence: ConfidenceLevel;
  reason: string;
}
export interface ExperimentalRouting {
  taskProfile?: TaskProfile;
  snapshotVersion: string;
  candidates: ExperimentalCandidate[];
  suggestion?: ExperimentalCandidate;
  error?: string;
}

export interface CitedProjectFile { path: string; exists: boolean; summary?: string; }
export interface RoutingBrief {
  request: string;
  projectRoot: string;
  documentationSummary: string;
  agentsSummary: string;
  readmeSummary: string;
  stack: string[];
  structure: string[];
  sensitiveAreas: string[];
  gitStatus: string[];
  testCommands: string[];
  citedFiles: CitedProjectFile[];
}

export interface ProjectFileChange { path: string; kind: "add" | "delete" | "update"; }
export interface GitChangeMetrics { filesModified: number; linesAdded: number; linesDeleted: number; }
export interface CommandResult { command: string; exitCode?: number; status: "completed" | "failed"; }
export type ProgressSeverity = "info" | "warning" | "error";
export interface CodexProgressEvent {
  kind: "activity" | "journal" | "file" | "command" | "error" | "response";
  step?: MissionStep;
  severity?: ProgressSeverity;
  message: string;
  detail?: string;
  at: number;
}
export interface RunResult {
  finalResponse: string;
  reviewResponse?: string;
  reviewHadFindings: boolean;
  threadIds: string[];
  changes: ProjectFileChange[];
  commands: CommandResult[];
  usage: { executor: TokenUsage; reviewer: TokenUsage; total: TokenUsage };
}
