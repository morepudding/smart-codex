import { Codex, type Thread, type ThreadEvent } from "@openai/codex-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexProgressEvent, CommandResult, ProjectContext, ProjectFileChange, ReasoningLevel, RoutingDecision, RunResult, TokenUsage } from "./types.js";
import { captureGitStatus, changesSince, mergeFileChanges } from "./git-changes.js";
import { addTokenUsage, tokenUsageFromSdk, zeroTokenUsage } from "./token-usage.js";

export interface RunCodexOptions {
  signal?: AbortSignal;
  onProgress?: (event: CodexProgressEvent) => void;
}

export function executionPrompt(request: string, context: ProjectContext, decision: RoutingDecision): string {
  const knownDocs = context.docs.map((doc) => doc.path).join("\n- ");
  const patchHelper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "windows-apply-patch.mjs");
  const windowsPatchProtocol = process.platform === "win32" ? `

Protocole d'ecriture Windows obligatoire:
- Pour toute modification par patch, utilise exclusivement le helper Node ${patchHelper}.
- Ne tente pas directement apply_patch, apply_patch.bat, git apply, Bash, WSL, Set-Content ou Add-Content.
- Place le patch dans la variable SMART_CODEX_PATCH avec une here-string PowerShell litterale, puis lance:
  node "${patchHelper}"
- Dans PowerShell, les marqueurs de here-string doivent imperativement commencer en colonne 1, sans espace.
- Exemple exact:
$env:SMART_CODEX_PATCH = @'
*** Begin Patch
*** Update File: chemin/du/fichier
@@
-ancien texte
+nouveau texte
*** End Patch
'@
node "${patchHelper}"
Remove-Item Env:SMART_CODEX_PATCH -ErrorAction SilentlyContinue
- Le helper doit etre essaye une seule fois par patch. S'il echoue, remonte son erreur; n'improvise pas une autre methode d'ecriture.

Protocole de test Windows:
- Pour le runner natif Node, utilise --test-isolation=none afin d'eviter la creation de processus enfants interdite par le sandbox.
- Si une commande de test echoue avec spawn EPERM, ne la relance pas a l'identique et ne conclus pas a un echec metier. Relance uniquement avec l'option sans isolation supportee par le runner, ou remonte permission_required si le runner ne la supporte pas.

Protocole d'encodage Windows:
- Conserve les fichiers texte en UTF-8 sans BOM et leurs fins de ligne existantes.
- N'utilise pas Set-Content ou Add-Content pour ecrire du code. Le helper de patch preserve le transport UTF-8.
- Avant une commande PowerShell qui doit afficher du texte non ASCII, initialise [Console]::OutputEncoding et $OutputEncoding avec [System.Text.UTF8Encoding]::new($false).
` : "";
  return `$i-have-adhd

Tu travailles dans le projet ${context.root}.

Demande utilisateur:
${request}

Le routeur a selectionne ${decision.model} avec un effort ${decision.reasoning}.
Lis et respecte les instructions du projet avant d'agir. Les documents deja reperes sont:
- ${knownDocs || "aucun document detecte"}
${windowsPatchProtocol}

Mene la demande jusqu'au bout, valide le comportement reel proportionnellement au risque, puis donne une reponse finale concise en francais.`;
}

function reviewerPrompt(request: string, context: ProjectContext): string {
  return `Agis comme relecteur independant en lecture seule dans ${context.root}.

Demande initiale:
${request}

Inspecte le travail actuellement present dans le dossier. Cherche en priorite les regressions, erreurs de logique, risques de securite et validations manquantes. Ne modifie aucun fichier. Retourne une decision structuree avec hasFindings et findings. Chaque constat doit etre actionnable.`;
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    hasFindings: { type: "boolean" },
    findings: { type: "array", items: { type: "string" }, maxItems: 20 },
  },
  required: ["hasFindings", "findings"],
  additionalProperties: false,
} as const;

function shortCommand(command: string): string {
  return command.length > 120 ? `${command.slice(0, 117)}...` : command;
}

function emit(options: RunCodexOptions, event: Omit<CodexProgressEvent, "at">): void {
  options.onProgress?.({ ...event, at: Date.now() });
}

function trackEvent(
  event: ThreadEvent,
  options: RunCodexOptions,
  changes: ProjectFileChange[],
  commands: CommandResult[],
): string | undefined {
  if (event.type === "error" || event.type === "turn.failed") {
    const message = event.type === "error" ? event.message : event.error.message;
    emit(options, { kind: "error", step: "execution", message });
    return undefined;
  }
  if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") {
    return undefined;
  }

  const { item } = event;
  if (item.type === "agent_message") {
    emit(options, { kind: "response", step: "execution", severity: "info", message: item.text });
    return event.type === "item.completed" ? item.text : undefined;
  }
  if (item.type === "command_execution") {
    const isFinal = item.status !== "in_progress";
    const testCommand = /(^|\\s)(npm|pnpm|yarn|vitest|jest|pytest|cargo test|go test)\\b/i.test(item.command);
    const step = testCommand ? "tests" : "execution";
    if (!isFinal) {
      emit(options, { kind: "command", step, message: `Exécution : ${shortCommand(item.command)}` });
    } else {
      commands.push({ command: item.command, status: item.status === "completed" ? "completed" : "failed", ...(item.exit_code === undefined ? {} : { exitCode: item.exit_code }) });
      emit(options, {
        kind: item.status === "failed" ? "error" : "command",
        step,
        message: item.status === "failed" ? `Échec : ${shortCommand(item.command)}` : `Terminé : ${shortCommand(item.command)}`,
        ...(item.exit_code === undefined ? {} : { detail: `Code de sortie ${item.exit_code}` }),
      });
    }
    return undefined;
  }
  if (item.type === "file_change" && event.type === "item.completed") {
    changes.push(...item.changes);
    const labels = item.changes.slice(0, 3).map((change) => change.path).join(", ");
    emit(options, { kind: "file", step: "execution", message: `Modification : ${labels || "fichier mis à jour"}` });
    return undefined;
  }
  if (item.type === "todo_list") {
    const finished = item.items.filter((todo) => todo.completed).length;
    emit(options, { kind: "activity", step: "execution", message: "Plan de travail mis à jour", detail: `${finished}/${item.items.length} étapes terminées` });
  }
  if (item.type === "error") emit(options, { kind: "error", step: "execution", message: item.message });
  return undefined;
}

async function runStream(
  prompt: string,
  context: ProjectContext,
  decision: RoutingDecision,
  options: RunCodexOptions,
  changes: ProjectFileChange[],
  commands: CommandResult[],
  existingThread?: Thread,
  outputSchema?: unknown,
): Promise<{ finalResponse: string; threadId: string | null; thread: Thread; usage: TokenUsage }> {
  const thread = existingThread ?? new Codex().startThread({
    model: decision.model,
    modelReasoningEffort: decision.reasoning,
    workingDirectory: context.root,
    sandboxMode: decision.permissions,
    approvalPolicy: "never",
    skipGitRepoCheck: !context.signals.includes("git"),
  });
  const turnOptions = { ...(options.signal ? { signal: options.signal } : {}), ...(outputSchema ? { outputSchema } : {}) };
  const { events } = await thread.runStreamed(prompt, Object.keys(turnOptions).length ? turnOptions : undefined);
  let finalResponse = "";
  let usage = zeroTokenUsage();
  for await (const event of events) {
    if (event.type === "turn.completed") usage = addTokenUsage(usage, tokenUsageFromSdk(event.usage));
    const message = trackEvent(event, options, changes, commands);
    if (message) finalResponse = message;
  }
  return { finalResponse, threadId: thread.id, thread, usage };
}

function reviewReasoning(reasoning: ReasoningLevel): ReasoningLevel {
  return reasoning === "xhigh" ? "high" : reasoning;
}

export async function runCodex(
  request: string,
  context: ProjectContext,
  decision: RoutingDecision,
  options: RunCodexOptions = {},
): Promise<RunResult> {
  const changes: ProjectFileChange[] = [];
  const commands: CommandResult[] = [];
  const gitBefore = context.signals.includes("git") ? await captureGitStatus(context.root) : new Map();
  const finalChanges = async () => {
    if (!context.signals.includes("git")) return changes;
    const gitAfter = await captureGitStatus(context.root);
    return mergeFileChanges(changes, changesSince(gitBefore, gitAfter));
  };
  emit(options, { kind: "activity", step: "execution", message: "Codex commence l’inspection du projet" });
  const primary = await runStream(executionPrompt(request, context, decision), context, decision, options, changes, commands);
  const threadIds = primary.threadId ? [primary.threadId] : [];

  if (decision.workflow === "single-agent") {
    const reviewer = zeroTokenUsage();
    return { finalResponse: primary.finalResponse, reviewHadFindings: false, threadIds, changes: await finalChanges(), commands, usage: { executor: primary.usage, reviewer, total: primary.usage } };
  }

  emit(options, { kind: "activity", step: "tests", message: "Revue indépendante en lecture seule" });
  const reviewDecision: RoutingDecision = {
    ...decision,
    reasoning: reviewReasoning(decision.reasoning),
    workflow: "single-agent",
    permissions: "read-only",
  };
  const review = await runStream(reviewerPrompt(request, context), context, reviewDecision, options, changes, commands, undefined, REVIEW_SCHEMA);
  if (review.threadId) threadIds.push(review.threadId);

  let reviewHadFindings = true;
  let reviewResponse = review.finalResponse;
  try {
    const parsed = JSON.parse(review.finalResponse) as { hasFindings: boolean; findings: string[] };
    reviewHadFindings = parsed.hasFindings;
    reviewResponse = parsed.findings.join("\n");
  } catch {
    reviewResponse = review.finalResponse;
  }

  if (!reviewHadFindings) {
    const total = addTokenUsage(primary.usage, review.usage);
    return { finalResponse: primary.finalResponse, reviewResponse, reviewHadFindings: false, threadIds, changes: await finalChanges(), commands, usage: { executor: primary.usage, reviewer: review.usage, total } };
  }

  emit(options, { kind: "activity", step: "execution", message: "Correction des constats de revue" });
  const final = await runStream(
    `Voici la revue independante du travail:\n\n${reviewResponse}\n\nCorrige tous les constats actionnables qui concernent la demande, relance les validations utiles, puis donne la reponse finale.`,
    context,
    decision,
    options,
    changes,
    commands,
    primary.thread,
  );
  const executor = addTokenUsage(primary.usage, final.usage);
  const total = addTokenUsage(executor, review.usage);
  return { finalResponse: final.finalResponse, reviewResponse, reviewHadFindings: true, threadIds, changes: await finalChanges(), commands, usage: { executor, reviewer: review.usage, total } };
}
