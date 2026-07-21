import type { ProjectContext, RoutingDecision } from "./types.js";

export function formatDecision(decision: RoutingDecision, context: ProjectContext): string {
  const lines = [
    "Decision du routeur",
    `  Modele       ${decision.model}`,
    `  Raisonnement ${decision.reasoning}`,
    `  Workflow     ${decision.workflow}`,
    `  Acces        ${decision.permissions}`,
    `  Projet       ${context.root}`,
    `  Incertitude  ${decision.uncertainty}`,
    `  Pourquoi     ${decision.reason}`,
  ];
  return lines.join("\n");
}
