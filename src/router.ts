import type { ProjectContext, RouteName, RoutingDecision } from "./types.js";

const ROUTES: Record<RouteName, Omit<RoutingDecision, "reasons" | "scores" | "sandbox">> = {
  "luna-low": {
    route: "luna-low",
    model: "gpt-5.6-luna",
    reasoning: "low",
    agentCount: 1,
  },
  "terra-medium": {
    route: "terra-medium",
    model: "gpt-5.6-terra",
    reasoning: "medium",
    agentCount: 1,
  },
  "sol-high": {
    route: "sol-high",
    model: "gpt-5.6-sol",
    reasoning: "high",
    agentCount: 1,
  },
  "sol-xhigh": {
    route: "sol-xhigh",
    model: "gpt-5.6-sol",
    reasoning: "xhigh",
    agentCount: 2,
  },
};

const LOW_PATTERN = /\b(faute|orthographe|reformule|traduis|traduction|renomme|typo|explique en une phrase)\b/i;
const HIGH_PATTERN = /\b(architecture|migration|refactor|debug|debog|diagnosti|performance|securite|security|concurren|race condition|root cause|cause racine)\b/i;
const CRITICAL_PATTERN = /(tout le projet|toute la solution|sans regression|de bout en bout|end[- ]to[- ]end|migration complete|audit de securite complet|production critique)/i;
const READ_ONLY_PATTERN = /^\s*(analyse|analyze|explique|explain|inspecte|review|revue|cherche|find|compare|resume|summarize)\b/i;
const WRITE_PATTERN = /\b(ajoute|add|cree|create|implemente|implement|corrige|fix|modifie|change|supprime|delete|refactor|migre|migrate|branche|connecte)\b/i;

function normalizedText(request: string): string {
  return request
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function routeRequest(request: string, context: ProjectContext): RoutingDecision {
  const text = normalizedText(request);
  const scores: Record<RouteName, number> = {
    "luna-low": 0,
    "terra-medium": 3,
    "sol-high": 0,
    "sol-xhigh": 0,
  };
  const reasons: string[] = [];

  if (request.length <= 400 && LOW_PATTERN.test(text)) {
    scores["luna-low"] += 8;
    reasons.push("demande courte et mecanique");
  }
  if (WRITE_PATTERN.test(text)) {
    scores["terra-medium"] += 3;
    reasons.push("modification de code ou de fichiers");
  }
  if (HIGH_PATTERN.test(text)) {
    scores["sol-high"] += 8;
    reasons.push("analyse structurelle ou diagnostic complexe");
  }
  if (CRITICAL_PATTERN.test(text)) {
    scores["sol-xhigh"] += 14;
    reasons.push("portee critique ou exigence forte de non-regression");
  }
  if (request.length >= 1_200) {
    scores["sol-high"] += 4;
    reasons.push("demande longue avec plusieurs contraintes");
  }
  if (request.length >= 3_000) {
    scores["sol-xhigh"] += 8;
    reasons.push("cahier des charges tres volumineux");
  }
  if (context.signals.includes("monorepo")) {
    scores["sol-high"] += 2;
    reasons.push("projet multi-package");
  }
  if (context.docs.length >= 5) {
    scores["sol-high"] += 1;
    reasons.push("contexte projet riche");
  }

  const route = (Object.entries(scores) as Array<[RouteName, number]>).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "terra-medium";
  const sandbox = READ_ONLY_PATTERN.test(text) && !WRITE_PATTERN.test(text) ? "read-only" : "workspace-write";

  if (reasons.length === 0) reasons.push("tache de developpement courante");
  return { ...ROUTES[route], sandbox, reasons, scores };
}

export function forceRoute(route: RouteName, request: string): RoutingDecision {
  const text = normalizedText(request);
  const sandbox = READ_ONLY_PATTERN.test(text) && !WRITE_PATTERN.test(text) ? "read-only" : "workspace-write";
  return {
    ...ROUTES[route],
    sandbox,
    reasons: ["route forcee par l'utilisateur"],
    scores: { "luna-low": 0, "terra-medium": 0, "sol-high": 0, "sol-xhigh": 0, [route]: 100 },
  };
}

