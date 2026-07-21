import { Codex } from "@openai/codex-sdk";
import type { ProjectContext, RoutingDecision, RunResult } from "./types.js";

function executionPrompt(request: string, context: ProjectContext, decision: RoutingDecision): string {
  const knownDocs = context.docs.map((doc) => doc.path).join("\n- ");
  return `Tu travailles dans le projet ${context.root}.

Demande utilisateur:
${request}

Le routeur a selectionne ${decision.model} avec un effort ${decision.reasoning}.
Lis et respecte les instructions du projet avant d'agir. Les documents deja reperes sont:
- ${knownDocs || "aucun document detecte"}

Mene la demande jusqu'au bout, valide le comportement reel proportionnellement au risque, puis donne une reponse finale concise en francais.`;
}

function reviewerPrompt(request: string, context: ProjectContext): string {
  return `Agis comme relecteur independant en lecture seule dans ${context.root}.

Demande initiale:
${request}

Inspecte le travail actuellement present dans le dossier. Cherche en priorite les regressions, erreurs de logique, risques de securite et validations manquantes. Ne modifie aucun fichier. Retourne uniquement les constats actionnables, ou indique clairement qu'il n'y en a pas.`;
}

export async function runCodex(
  request: string,
  context: ProjectContext,
  decision: RoutingDecision,
): Promise<RunResult> {
  const codex = new Codex();
  const primary = codex.startThread({
    model: decision.model,
    modelReasoningEffort: decision.reasoning,
    workingDirectory: context.root,
    sandboxMode: decision.sandbox,
    approvalPolicy: "never",
    skipGitRepoCheck: !context.signals.includes("git"),
  });

  const first = await primary.run(executionPrompt(request, context, decision));
  const threadIds = primary.id ? [primary.id] : [];

  if (decision.agentCount === 1) {
    return { finalResponse: first.finalResponse, threadIds };
  }

  const reviewer = codex.startThread({
    model: "gpt-5.6-sol",
    modelReasoningEffort: "high",
    workingDirectory: context.root,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    skipGitRepoCheck: !context.signals.includes("git"),
  });
  const review = await reviewer.run(reviewerPrompt(request, context));
  if (reviewer.id) threadIds.push(reviewer.id);

  const final = await primary.run(`Voici la revue independante du travail:\n\n${review.finalResponse}\n\nCorrige tous les constats actionnables qui concernent la demande, relance les validations utiles, puis donne la reponse finale.`);
  return {
    finalResponse: final.finalResponse,
    reviewResponse: review.finalResponse,
    threadIds,
  };
}

