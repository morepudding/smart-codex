import type { ExpectedResult, ModelId, ModelName, Permissions, ProjectContext, ReasoningLevel, RouteName, RoutingDecision, RoutingSource, TaskIntent, UncertaintyLevel, Workflow } from "./types.js";

export const MODEL_IDS: Record<ModelName, ModelId> = { luna: "gpt-5.6-luna", terra: "gpt-5.6-terra", sol: "gpt-5.6-sol" };
export const SUPPORTED_REASONING: Record<ModelName, readonly ReasoningLevel[]> = {
  luna: ["low", "medium", "high", "xhigh"],
  terra: ["low", "medium", "high", "xhigh"],
  sol: ["low", "medium", "high", "xhigh"],
};

type Preset = Pick<RoutingDecision, "modelName" | "model" | "reasoning" | "workflow">;
export const ROUTE_PRESETS: Record<RouteName, Preset> = {
  "luna-low": { modelName: "luna", model: MODEL_IDS.luna, reasoning: "low", workflow: "single-agent" },
  "terra-medium": { modelName: "terra", model: MODEL_IDS.terra, reasoning: "medium", workflow: "single-agent" },
  "sol-high": { modelName: "sol", model: MODEL_IDS.sol, reasoning: "high", workflow: "single-agent" },
  "sol-xhigh-review": { modelName: "sol", model: MODEL_IDS.sol, reasoning: "xhigh", workflow: "development-review" },
};

const MODEL_NAMES = Object.keys(MODEL_IDS) as ModelName[];
const REASONING_LEVELS: ReasoningLevel[] = ["low", "medium", "high", "xhigh"];
const WORKFLOWS: Workflow[] = ["single-agent", "development-review"];
const PERMISSIONS: Permissions[] = ["read-only", "workspace-write"];
const UNCERTAINTY_LEVELS: UncertaintyLevel[] = ["low", "medium", "high"];
const INTENTS: TaskIntent[] = ["discussion", "ideation", "planning", "analysis", "implementation", "fix", "review"];
const ADVICE_PATTERN = /\b(tu (?:en )?penses quoi|qu[' ]?en penses[- ]?tu|tu verrais|tu ferais comment|comment (?:tu|pourrait|devrait|faire)|que proposes[- ]?tu|propose[- ]?moi|donne[- ]?moi des idees|brainstorm)\b/i;
const PLAN_PATTERN = /\b(plan(?:ifie|ification)?|architecture|approche|strategie|etapes|roadmap)\b/i;
const REVIEW_PATTERN = /^\s*(?:fais\s+(?:une\s+)?|effectue\s+(?:une\s+)?)?(?:revue|review|audit|evalue|relis)\b/i;
const ANALYSIS_PATTERN = /^\s*(?:analyse|explique|inspecte|diagnostique|cherche|compare|resume|pourquoi)\b/i;
const FIX_PATTERN = /^\s*(?:corrige|repare|fixe|resous|debugge)\b/i;
const IMPLEMENT_PATTERN = /^\s*(?:implemente|modifie|ajoute|cree|supprime|retire|refactorise|migre|integre|branche|connecte|revois|rends|affiche|separe|transforme|compacte|applique)\b/i;
const HIGH_PATTERN = /\b(architecture|migration|refactor|debug|debog|diagnosti|performance|securite|security|concurren|race condition|root cause|cause racine)\b/i;
const CRITICAL_PATTERN = /(tout le projet|toute la solution|sans regression|de bout en bout|end[- ]to[- ]end|migration complete|audit de securite complet|production critique)/i;
const LOW_PATTERN = /\b(faute|orthographe|reformule|traduis|traduction|renomme|typo|explique en une phrase)\b/i;

function normalizedText(request: string): string { return request.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export function classifyIntent(request: string, fallback: TaskIntent = "discussion"): TaskIntent {
  const text = normalizedText(request);
  if (ADVICE_PATTERN.test(text)) return PLAN_PATTERN.test(text) ? "planning" : "ideation";
  if (FIX_PATTERN.test(text)) return "fix";
  if (IMPLEMENT_PATTERN.test(text)) return "implementation";
  if (REVIEW_PATTERN.test(text)) return "review";
  if (ANALYSIS_PATTERN.test(text)) return "analysis";
  if (/\b(propose|imagine|idee|idees|concept)\b/i.test(text)) return PLAN_PATTERN.test(text) ? "planning" : "ideation";
  return fallback;
}

export function expectedResultFor(intent: TaskIntent): ExpectedResult {
  if (intent === "implementation" || intent === "fix") return "project-changes";
  if (intent === "planning") return "plan";
  if (intent === "review") return "review-report";
  return "text-response";
}

export function permissionsForIntent(intent: TaskIntent): Permissions { return intent === "implementation" || intent === "fix" ? "workspace-write" : "read-only"; }

export function requestNeedsConfirmation(request: string): boolean {
  const text = normalizedText(request);
  return /\b(supprime|efface|detruit|purge|ecrase|drop|truncate|force[- ]push)\b/i.test(text)
    || /\bgit\s+reset\s+--hard\b/i.test(text)
    || /\b(reinitialise|reinitialiser)\b.*\b(base|donnees|production)\b/i.test(text);
}

export function createDecision(
  parameters: { modelName: ModelName; reasoning: ReasoningLevel; workflow: Workflow; permissions: Permissions },
  metadata: {
    preset?: RouteName; uncertainty?: UncertaintyLevel; requiresConfirmation?: boolean; reason: string; unknowns?: string[];
    source: RoutingSource; legacyScores?: Record<RouteName, number>; intent?: TaskIntent; expectedResult?: ExpectedResult;
  },
): RoutingDecision {
  const intent = metadata.intent ?? (parameters.permissions === "workspace-write" ? "implementation" : "analysis");
  return {
    ...(metadata.preset ? { preset: metadata.preset } : {}),
    modelName: parameters.modelName,
    model: MODEL_IDS[parameters.modelName],
    reasoning: parameters.reasoning,
    workflow: parameters.workflow,
    permissions: parameters.permissions,
    uncertainty: metadata.uncertainty ?? "medium",
    requiresConfirmation: metadata.requiresConfirmation ?? false,
    reason: metadata.reason,
    unknowns: metadata.unknowns ?? [],
    source: metadata.source,
    ...(metadata.legacyScores ? { legacyScores: metadata.legacyScores } : {}),
    intent,
    expectedResult: metadata.expectedResult ?? expectedResultFor(intent),
  };
}

export function createPresetDecision(preset: RouteName, permissions: Permissions, metadata: Omit<Parameters<typeof createDecision>[1], "preset">): RoutingDecision {
  return createDecision({ ...ROUTE_PRESETS[preset], permissions }, { ...metadata, preset });
}

export function validateLunaDecision(value: unknown, request: string): RoutingDecision {
  if (!isRecord(value)) throw new Error("La decision Luna doit etre un objet JSON.");
  const { model, reasoning, workflow, intent: proposedIntent, uncertainty, requiresConfirmation, reason, unknowns } = value;
  if (typeof model !== "string" || !MODEL_NAMES.includes(model as ModelName)) throw new Error("Modele Luna inconnu.");
  if (typeof reasoning !== "string" || !REASONING_LEVELS.includes(reasoning as ReasoningLevel)) throw new Error("Niveau de reflexion Luna invalide.");
  if (!SUPPORTED_REASONING[model as ModelName].includes(reasoning as ReasoningLevel)) throw new Error("Ce niveau de reflexion n'est pas accepte par le modele.");
  if (typeof workflow !== "string" || !WORKFLOWS.includes(workflow as Workflow)) throw new Error("Workflow Luna invalide.");
  if (typeof proposedIntent !== "string" || !INTENTS.includes(proposedIntent as TaskIntent)) throw new Error("Intention Luna invalide.");
  if (typeof uncertainty !== "string" || !UNCERTAINTY_LEVELS.includes(uncertainty as UncertaintyLevel)) throw new Error("Incertitude Luna invalide.");
  if (typeof requiresConfirmation !== "boolean") throw new Error("Confirmation Luna invalide.");
  if (requestNeedsConfirmation(request) && !requiresConfirmation) throw new Error("Une action destructive exige une confirmation.");
  if (typeof reason !== "string" || reason.trim().length === 0 || reason.length > 300) throw new Error("Motif Luna invalide.");
  if (!Array.isArray(unknowns) || unknowns.length > 10 || unknowns.some((item) => typeof item !== "string" || item.length > 240)) throw new Error("Liste des inconnues Luna invalide.");
  const intent = classifyIntent(request, proposedIntent as TaskIntent);
  return createDecision({ modelName: model as ModelName, reasoning: reasoning as ReasoningLevel, workflow: workflow as Workflow, permissions: permissionsForIntent(intent) }, {
    uncertainty: uncertainty as UncertaintyLevel,
    requiresConfirmation,
    reason: reason.trim(), unknowns: unknowns as string[], source: "luna", intent,
  });
}

export function validateExecutionDecision(decision: RoutingDecision, request: string, confirmed: boolean): void {
  if (MODEL_IDS[decision.modelName] !== decision.model) throw new Error("Identifiant de modele invalide.");
  if (!SUPPORTED_REASONING[decision.modelName]?.includes(decision.reasoning)) throw new Error("Niveau de reflexion non accepte par le modele.");
  if (!WORKFLOWS.includes(decision.workflow)) throw new Error("Workflow d'execution invalide.");
  if (!PERMISSIONS.includes(decision.permissions)) throw new Error("Permissions d'execution invalides.");
  if ((decision.requiresConfirmation || requestNeedsConfirmation(request)) && !confirmed) throw new Error("Cette action exige une confirmation explicite.");
}

export function routeRequest(request: string, context: ProjectContext): RoutingDecision {
  const text = normalizedText(request);
  const intent = classifyIntent(request);
  const scores: Record<RouteName, number> = { "luna-low": 0, "terra-medium": 3, "sol-high": 0, "sol-xhigh-review": 0 };
  const reasons: string[] = ["intention " + intent];
  if (request.length <= 600 && (LOW_PATTERN.test(text) || intent === "discussion" || intent === "ideation")) { scores["luna-low"] += 7; reasons.push("reponse courte ou exploratoire"); }
  if (intent === "implementation" || intent === "fix") { scores["terra-medium"] += 4; reasons.push("modification explicite du projet"); }
  if (HIGH_PATTERN.test(text) || intent === "review") { scores["sol-high"] += 8; reasons.push("analyse structurelle ou revue approfondie"); }
  if (CRITICAL_PATTERN.test(text)) { scores["sol-xhigh-review"] += 14; reasons.push("portee critique ou exigence forte de non-regression"); }
  if (request.length >= 1_200) scores["sol-high"] += 4;
  if (request.length >= 3_000) scores["sol-xhigh-review"] += 8;
  if (context.signals.includes("monorepo")) scores["sol-high"] += 2;
  if (context.docs.length >= 5) scores["sol-high"] += 1;
  const preset = (Object.entries(scores) as Array<[RouteName, number]>).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "terra-medium";
  return createPresetDecision(preset, permissionsForIntent(intent), {
    uncertainty: "medium", requiresConfirmation: requestNeedsConfirmation(request), reason: reasons.join("; "), source: "preset", legacyScores: scores, intent,
  });
}

export function forceRoute(preset: RouteName, request: string): RoutingDecision {
  const intent = classifyIntent(request);
  return createPresetDecision(preset, permissionsForIntent(intent), {
    uncertainty: "low", requiresConfirmation: requestNeedsConfirmation(request), reason: "Preset force par l'utilisateur.", source: "user", intent,
  });
}
