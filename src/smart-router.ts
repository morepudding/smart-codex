import { Codex } from "@openai/codex-sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_REASONING } from "./router.js";
import type { BenchmarkSnapshot, ConfidenceLevel, ExperimentalCandidate, ExperimentalRouting, ModelName, Permissions, ProjectContext, ReasoningLevel, TaskProfile, Workflow } from "./types.js";

const profiles = ["advice", "analysis", "implementation", "bugfix", "review"] as const;
const families = ["advice", "localized_edit", "mechanical_change", "repo_bugfix", "feature", "long_refactor", "terminal_heavy"] as const;
const scopes = ["local", "multi_file", "multi_package", "unknown"] as const;
const depths = ["low", "medium", "high"] as const;
const risks = ["low", "medium", "high", "critical"] as const;
const documentation = ["poor", "partial", "good"] as const;
const models: ModelName[] = ["luna", "terra", "sol"];
const workflows: Workflow[] = ["single-agent", "development-review"];
const permissions: Permissions[] = ["read-only", "workspace-write"];
const cost: Record<ModelName, number> = { luna: 1, terra: 2, sol: 3 };
const effortCost: Record<ReasoningLevel, number> = { low: 1, medium: 2, high: 3, xhigh: 4 };

function member<T extends readonly string[]>(value: unknown, values: T): value is T[number] { return typeof value === "string" && values.includes(value as T[number]); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export function validateTaskProfile(value: unknown): TaskProfile {
  if (!record(value) || !member(value.intent, profiles) || !member(value.family, families) || !member(value.scope, scopes)
    || !member(value.reasoningDepth, depths) || !member(value.mechanicalVolume, depths) || !member(value.uncertainty, depths)
    || !member(value.risk, risks) || !member(value.terminalIntensity, depths) || !member(value.documentationQuality, documentation)
    || typeof value.requiresWrite !== "boolean" || !Array.isArray(value.availableValidations)
    || value.availableValidations.some((item) => typeof item !== "string" || item.length > 160)
    || typeof value.summary !== "string" || value.summary.trim().length === 0 || value.summary.length > 300) throw new Error("TaskProfile Luna invalide.");
  return { intent: value.intent, family: value.family, scope: value.scope, reasoningDepth: value.reasoningDepth, mechanicalVolume: value.mechanicalVolume, uncertainty: value.uncertainty, risk: value.risk, terminalIntensity: value.terminalIntensity, documentationQuality: value.documentationQuality, requiresWrite: value.requiresWrite, availableValidations: value.availableValidations, summary: value.summary.trim() };
}

export async function loadBenchmarkSnapshot(filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "benchmark-priors-v1.json")): Promise<BenchmarkSnapshot> {
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!record(value) || value.schemaVersion !== "benchmark-priors-v1" || !Array.isArray(value.priors)) throw new Error("Snapshot de benchmark invalide.");
  for (const prior of value.priors) {
    if (!record(prior) || typeof prior.source !== "string" || typeof prior.version !== "string" || typeof prior.measuredAt !== "string"
      || !member(prior.family, families) || !member(prior.model, models) || !member(prior.reasoning, ["low", "medium", "high", "xhigh"] as const)
      || typeof prior.score !== "number" || !Number.isFinite(prior.score) || !member(prior.confidence, depths)) throw new Error("Entree de benchmark invalide.");
  }
  return value as unknown as BenchmarkSnapshot;
}

export function rankExperimentalCandidates(profile: TaskProfile, snapshot: BenchmarkSnapshot): ExperimentalCandidate[] {
  const candidates: ExperimentalCandidate[] = [];
  for (const modelName of models) for (const reasoning of SUPPORTED_REASONING[modelName]) for (const workflow of workflows) for (const permission of permissions) {
    if (profile.requiresWrite !== (permission === "workspace-write")) continue;
    const prior = snapshot.priors.find((item) => item.family === profile.family && item.model === modelName && item.reasoning === reasoning);
    const qualityIndex = prior?.score ?? null;
    const confidence: ConfidenceLevel = prior?.confidence ?? "low";
    const costIndex = cost[modelName] * 10 + effortCost[reasoning] * 3 + (workflow === "development-review" ? 8 : 0);
    candidates.push({ modelName, reasoning, workflow, permissions: permission, qualityIndex, costIndex, confidence, reason: prior ? `Benchmark ${prior.source} ${prior.version}; indice relatif.` : "Aucune mesure directe; estimation non classee." });
  }
  const nonDominated = candidates.filter((candidate) => !candidates.some((other) => other !== candidate && candidate.qualityIndex !== null && other.qualityIndex !== null && other.costIndex < candidate.costIndex && other.qualityIndex >= candidate.qualityIndex));
  return nonDominated.sort((a, b) => (b.qualityIndex ?? -1) - (a.qualityIndex ?? -1) || a.costIndex - b.costIndex || a.modelName.localeCompare(b.modelName)).slice(0, 3);
}

export async function profileTaskWithLuna(request: string, context: ProjectContext): Promise<TaskProfile> {
  const thread = new Codex().startThread({ model: "gpt-5.6-luna", modelReasoningEffort: "xhigh", workingDirectory: path.dirname(fileURLToPath(import.meta.url)), sandboxMode: "read-only", approvalPolicy: "never", skipGitRepoCheck: true });
  const payload = JSON.stringify({ request, signals: context.signals, manifests: context.manifests, docs: context.docs.map((doc) => doc.path) });
  const prompt = `Tu es Luna max. Retourne uniquement un JSON TaskProfile: intent (advice|analysis|implementation|bugfix|review), family (advice|localized_edit|mechanical_change|repo_bugfix|feature|long_refactor|terminal_heavy), scope (local|multi_file|multi_package|unknown), reasoningDepth, mechanicalVolume, uncertainty, risk (low|medium|high|critical), terminalIntensity (low|medium|high), documentationQuality (poor|partial|good), requiresWrite boolean, availableValidations string[], summary court. Ne donne pas ton raisonnement detaille. Contexte: ${payload}`;
  let failure = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const turn = await thread.run(prompt + (attempt ? " Corrige strictement le JSON." : ""));
      return validateTaskProfile(JSON.parse(turn.finalResponse) as unknown);
    }
    catch (error) { failure = error instanceof Error ? error.message : String(error); }
  }
  throw new Error(failure || "Profil Luna indisponible.");
}

export async function suggestExperimentalRouting(request: string, context: ProjectContext, profiler = profileTaskWithLuna): Promise<ExperimentalRouting> {
  try {
    const snapshot = await loadBenchmarkSnapshot();
    const taskProfile = await profiler(request, context);
    const candidates = rankExperimentalCandidates(taskProfile, snapshot);
    return { taskProfile, snapshotVersion: snapshot.schemaVersion, candidates, ...(candidates[0] ? { suggestion: candidates[0] } : {}) };
  } catch (error) {
    return { snapshotVersion: "unavailable", candidates: [], error: error instanceof Error ? error.message : String(error) };
  }
}
