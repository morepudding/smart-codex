import type {
  ExpectedResult,
  GitChangeMetrics,
  MissionStatus,
  MissionStep,
  ProgressSeverity,
  ReasoningLevel,
  ModelName,
  Permissions,
  RoutingSource,
  RunResult,
  TaskIntent,
  TokenUsage,
  UncertaintyLevel,
  Workflow,
} from "./types.js";

export interface DesktopRequest { request: string; projectPath: string; }

export interface DesktopRunRequest extends DesktopRequest {
  proposalId: string;
  modelName?: ModelName;
  reasoning?: ReasoningLevel;
  workflow?: Workflow;
  permissions?: Permissions;
  confirmed: boolean;
}

export interface UiRoutingDecision {
  modelName: ModelName;
  model: string;
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
  projectPath: string;
}

export interface UiRoutingProposal {
  proposalId: string;
  decision: UiRoutingDecision;
  observationIndex: number;
  remainingObservations: number;
  lunaAttempts: number;
  routerUsage: TokenUsage;
  fallbackReason?: string;
}

export interface UiMissionEvent {
  type: "activity" | "strategy" | "journal" | "file" | "command" | "error" | "response" | "terminal";
  severity?: ProgressSeverity;
  sessionId?: string;
  status?: Exclude<MissionStatus, "running">;
  step?: MissionStep;
  message?: string;
  detail?: string;
  at?: number;
  decision?: UiRoutingDecision;
}

export interface ValidationMetrics {
  tests: { run: number; failed: number };
  build: { run: number; failed: number };
}

export interface MissionTokenMetrics {
  router: TokenUsage;
  executor: TokenUsage;
  reviewer: TokenUsage;
  total: TokenUsage;
}

export interface RoutingQualityMetrics {
  firstTrySuccess: boolean;
  escalationNeeded: boolean;
  manualCorrection: boolean;
  rerunWithDifferentModel: boolean;
}

export interface MissionOutcomeMetrics extends GitChangeMetrics {
  status: MissionStatus;
  durationMs: number;
  validations: ValidationMetrics;
}

export interface TechnicalTrace {
  expiresAt: number;
  error: string;
  events: UiMissionEvent[];
  commands: RunResult["commands"];
}

export interface MissionSession {
  id: string;
  title: string;
  request: string;
  projectPath: string;
  gitStartCommit?: string;
  status: MissionStatus;
  createdAt: number;
  updatedAt: number;
  durationMs?: number;
  initialDecision?: UiRoutingDecision;
  executedDecision?: UiRoutingDecision;
  decision?: UiRoutingDecision;
  tokens?: MissionTokenMetrics;
  outcome?: MissionOutcomeMetrics;
  routingQuality?: RoutingQualityMetrics;
  summary?: { finalResponse: string; reviewResponse?: string };
  technicalTrace?: TechnicalTrace;
  liveEvents?: UiMissionEvent[];
  result?: RunResult;
  events: UiMissionEvent[];
  error?: string;
}

export interface DesktopRunResponse {
  sessionId: string;
  decision: UiRoutingDecision;
  result: RunResult;
  durationMs: number;
}

export interface SmartCodexDesktopApi {
  selectProject(): Promise<string | null>;
  decide(request: DesktopRequest): Promise<UiRoutingProposal>;
  run(request: DesktopRunRequest): Promise<DesktopRunResponse>;
  stop(): Promise<void>;
  listSessions(): Promise<MissionSession[]>;
  getSession(id: string): Promise<MissionSession | null>;
  onMissionEvent(listener: (event: UiMissionEvent) => void): () => void;
}

declare global {
  interface Window {
    smartCodex: SmartCodexDesktopApi;
    marked: { parse(markdown: string, options?: Record<string, unknown>): string };
    DOMPurify: { sanitize(html: string, options?: Record<string, unknown>): string };
  }
}
