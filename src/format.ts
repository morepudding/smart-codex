import type { ProjectContext, RoutingDecision } from "./types.js";

export function formatDecision(decision: RoutingDecision, context: ProjectContext): string {
  const lines = [
    "Decision du routeur",
    `  Modele       ${decision.model}`,
    `  Raisonnement ${decision.reasoning}`,
    `  Agents       ${decision.agentCount}`,
    `  Acces        ${decision.sandbox}`,
    `  Projet       ${context.root}`,
    `  Pourquoi     ${decision.reasons.join("; ")}`,
  ];
  return lines.join("\n");
}

