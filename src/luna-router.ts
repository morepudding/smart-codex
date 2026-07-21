import { Codex } from "@openai/codex-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectContext, RoutingBrief, RoutingResult, TokenUsage } from "./types.js";
import { createPresetDecision, routeRequest, validateLunaDecision } from "./router.js";
import { buildRoutingBrief } from "./routing-brief.js";
import { addTokenUsage, tokenUsageFromSdk, zeroTokenUsage } from "./token-usage.js";

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    model: { type: "string", enum: ["luna", "terra", "sol"] },
    reasoning: { type: "string", enum: ["low", "medium", "high", "xhigh"] },
    workflow: { type: "string", enum: ["single-agent", "development-review"] },
    permissions: { type: "string", enum: ["read-only", "workspace-write"] },
    uncertainty: { type: "string", enum: ["low", "medium", "high"] },
    reason: { type: "string", maxLength: 300 },
    unknowns: { type: "array", maxItems: 10, items: { type: "string", maxLength: 240 } },
  },
  required: ["model", "reasoning", "workflow", "permissions", "uncertainty", "reason", "unknowns"],
  additionalProperties: false,
} as const;

interface ProviderResponse { decision: unknown; usage?: TokenUsage; }
export type LunaDecisionProvider = (brief: RoutingBrief, attempt: number) => Promise<unknown | ProviderResponse>;

function routingPayload(brief: RoutingBrief) {
  return {
    request: brief.request,
    documentationSummary: brief.documentationSummary,
    stack: brief.stack,
    structure: brief.structure,
    testCommands: brief.testCommands,
    gitStatus: brief.gitStatus,
    citedFiles: brief.citedFiles,
    sensitiveAreas: brief.sensitiveAreas,
  };
}

export function lunaRoutingPrompt(brief: RoutingBrief, retryMessage?: string): string {
  return [
    "Tu es Luna max, le routeur principal de Smart Codex.",
    "",
    "Choisis la combinaison la moins couteuse ayant de fortes chances de reussir la mission du premier coup.",
    "",
    "Choisis séparément model (luna, terra, sol), reasoning (low, medium, high, xhigh), workflow (single-agent, development-review), permissions (read-only, workspace-write), uncertainty (low, medium, high), une justification courte et les inconnues.",
    "Base ton choix sur la portee reelle, la documentation, le nombre de composants concernes et les consequences d'une erreur.",
    "Ne choisis pas Sol ou une revue pour un risque seulement theorique.",
    "development-review est strictement sequentiel: developpement avec ecriture, revue independante en lecture seule, puis correction par le developpeur.",
    "danger-full-access est interdit. N'invente aucun modele, niveau, workflow ou permission.",
    "N'inspecte pas le depot et ne lance aucun outil. Le resume ci-dessous est ton unique source.",
    retryMessage ? `\nTa decision precedente etait techniquement invalide: ${retryMessage}\nRetourne une decision strictement conforme.` : "",
    "",
    "CONTEXTE COURT",
    JSON.stringify(routingPayload(brief), null, 2),
  ].join("\n");
}

async function askLunaWithSdk(brief: RoutingBrief, attempt: number): Promise<ProviderResponse> {
  const routerDirectory = path.dirname(fileURLToPath(import.meta.url));
  const thread = new Codex().startThread({ model: "gpt-5.6-luna", modelReasoningEffort: "xhigh", workingDirectory: routerDirectory, sandboxMode: "read-only", approvalPolicy: "never", skipGitRepoCheck: true });
  const turn = await thread.run(lunaRoutingPrompt(brief, attempt > 1 ? "format ou combinaison refusee" : undefined), { outputSchema: DECISION_SCHEMA });
  return { decision: JSON.parse(turn.finalResponse) as unknown, usage: tokenUsageFromSdk(turn.usage) };
}

function unwrapProviderResponse(value: unknown | ProviderResponse): { decision: unknown; usage: TokenUsage } {
  if (value && typeof value === "object" && "decision" in value) {
    const response = value as ProviderResponse;
    return { decision: response.decision, usage: response.usage ?? zeroTokenUsage() };
  }
  return { decision: value, usage: zeroTokenUsage() };
}

export async function routeWithLuna(request: string, context: ProjectContext, provider: LunaDecisionProvider = askLunaWithSdk): Promise<RoutingResult> {
  const brief = await buildRoutingBrief(request, context);
  let routerUsage = zeroTokenUsage();
  let failureReason = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response: { decision: unknown; usage: TokenUsage };
    try {
      response = unwrapProviderResponse(await provider(brief, attempt));
      routerUsage = addTokenUsage(routerUsage, response.usage);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const legacy = { ...routeRequest(request, context), source: "legacy-fallback" as const };
      return { brief, decision: legacy, routerUsage, lunaAttempts: attempt, fallbackReason: reason };
    }
    try {
      return { brief, decision: validateLunaDecision(response.decision, request), routerUsage, lunaAttempts: attempt };
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
    }
  }
  const legacy = routeRequest(request, context);
  const decision = createPresetDecision("terra-medium", legacy.permissions, {
    uncertainty: "high", requiresConfirmation: legacy.requiresConfirmation,
    reason: "Deux decisions Luna invalides ou indisponibles; fallback Terra medium.",
    unknowns: failureReason ? [failureReason] : [], source: "terra-fallback", intent: legacy.intent,
  });
  return { brief, decision, routerUsage, lunaAttempts: 2, fallbackReason: failureReason };
}
