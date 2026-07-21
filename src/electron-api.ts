import type { RunResult } from "./types.js";

export interface DesktopRequest {
  request: string;
  projectPath: string;
}

export interface UiRoutingDecision {
  route: string;
  model: string;
  reasoning: string;
  agentCount: number;
  sandbox: string;
  reasons: string[];
  projectPath: string;
}

export interface DesktopRunResponse {
  decision: UiRoutingDecision;
  result: RunResult;
}

export interface SmartCodexDesktopApi {
  selectProject(): Promise<string | null>;
  decide(request: DesktopRequest): Promise<UiRoutingDecision>;
  run(request: DesktopRequest): Promise<DesktopRunResponse>;
}

declare global {
  interface Window {
    smartCodex: SmartCodexDesktopApi;
  }
}

