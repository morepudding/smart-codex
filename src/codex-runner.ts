import { Codex, type Thread, type ThreadEvent } from "@openai/codex-sdk";
import { execFile } from "node:child_process";
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
- Execute les tests, le typecheck et le build comme des commandes d'outil distinctes afin que leur résultat soit comptabilisé séparément.
- Dans la réponse finale, annonce uniquement les validations réellement exécutées avec succès.

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

const BLOCKED_CHILD_ENV = /^(?:ELECTRON_|npm_|NODE_CHANNEL_FD$|NODE_UNIQUE_ID$|NODE_OPTIONS$|INIT_CWD$)/i;

export function codexChildEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !BLOCKED_CHILD_ENV.test(entry[0])),
  );
}

export function reconcileElectronSmokeResponse(finalResponse: string): string {
  return finalResponse.replace(/\s*(?:Le|La)\s+(?:smoke Electron|validation Electron)[^.!?\n]*(?:bloqu|échou|refus)[^.!?\n]*[.!?]?/giu, "").trim();
}

function createCodexClient(): Codex {
  return new Codex({
    env: codexChildEnvironment(),
    ...(process.platform === "win32" ? { config: { windows: { sandbox: "unelevated" } } } : {}),
  });
}

function sameWindowsPath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function recoverElectronSmoke(
  context: ProjectContext,
  options: RunCodexOptions,
  commands: CommandResult[],
  finalResponse: string,
): Promise<string> {
  const attemptedInSandbox = commands.some((item) => item.status === "failed" && /npm(?:\.cmd)?\s+run\s+desktop:smoke\b/i.test(item.command));
  const alreadyRecovered = commands.some((item) => item.command === "host:desktop:smoke");
  const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (process.platform !== "win32" || !attemptedInSandbox || alreadyRecovered || !sameWindowsPath(context.root, applicationRoot)) return finalResponse;

  emit(options, { kind: "activity", step: "tests", message: "Smoke Electron relancé par l’hôte Windows" });
  const scriptPath = path.join(applicationRoot, "scripts", "smoke-electron.ps1");
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
        { cwd: applicationRoot, windowsHide: true, timeout: 60_000, maxBuffer: 1_000_000 },
        (error, stdout, stderr) => error ? reject(new Error((stderr || stdout || error.message).trim())) : resolve(`${stdout}\n${stderr}`),
      );
    });
    if (!output.includes("SMART_CODEX_RENDERER_READY") || !output.includes("SMART_CODEX_MARKDOWN_READY")) throw new Error("Les marqueurs du renderer Electron sont absents.");
    commands.push({ command: "host:desktop:smoke", status: "completed", exitCode: 0 });
    emit(options, { kind: "command", step: "tests", message: "Smoke Electron validé par l’hôte Windows" });
    const reconciledResponse = reconcileElectronSmokeResponse(finalResponse);
    return `Validation finale réussie : le smoke Electron a échoué dans le sandbox, puis a été validé par le processus hôte Windows.\n\n${reconciledResponse}`;
  } catch (error) {
    commands.push({ command: "host:desktop:smoke", status: "failed" });
    const message = error instanceof Error ? error.message : String(error);
    emit(options, { kind: "error", step: "tests", message: `Échec du smoke Electron hôte : ${message}` });
    return `${finalResponse}\n\nValidation hôte : le smoke Electron a également échoué (${message}).`;
  }
}

function emit(options: RunCodexOptions, event: Omit<CodexProgressEvent, "at">): void {
  options.onProgress?.({ ...event, at: Date.now() });
}

interface ProgressDigestState { toolCalls: number; }

export function commandProgressLabel(command: string): string {
  if (/desktop:smoke/i.test(command)) return "Validation de l’interface Electron";
  if (/check:utf8/i.test(command)) return "Vérification de l’encodage";
  if (/typecheck|type-check|\btsc\b/i.test(command)) return "Vérification des types";
  if (/\b(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run\s+)?test\b|vitest|jest|pytest|cargo test|go test/i.test(command)) return "Exécution des tests";
  if (/\b(?:npm|pnpm|yarn)(?:\.cmd)?\s+run\s+build\b/i.test(command)) return "Compilation du projet";
  if (/windows-apply-patch|apply_patch/i.test(command)) return "Application des modifications";
  if (/\bgit\s+(?:diff|status|log|show)\b/i.test(command)) return "Vérification des changements Git";
  if (/(?:^|\s)rg(?:\.exe)?\s|select-string/i.test(command)) return "Recherche dans le code";
  if (/get-content|readfile|read_file/i.test(command)) return "Lecture des fichiers utiles";
  return "Analyse technique du projet";
}

function publishToolDigest(options: RunCodexOptions, state: ProgressDigestState, message: string, step: "execution" | "tests" = "execution"): void {
  state.toolCalls += 1;
  if (state.toolCalls !== 1 && state.toolCalls % 3 !== 0) return;
  emit(options, { kind: "activity", step, message, detail: `${state.toolCalls} action${state.toolCalls > 1 ? "s" : ""} technique${state.toolCalls > 1 ? "s" : ""}` });
}

function trackEvent(
  event: ThreadEvent,
  options: RunCodexOptions,
  changes: ProjectFileChange[],
  commands: CommandResult[],
  progress: ProgressDigestState,
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
    const testCommand = /(^|\s)(npm|pnpm|yarn|vitest|jest|pytest|cargo test|go test)\b/i.test(item.command);
    const step = testCommand ? "tests" : "execution";
    const label = commandProgressLabel(item.command);
    if (event.type === "item.started") {
      publishToolDigest(options, progress, label, step);
    } else if (event.type === "item.completed" && isFinal) {
      commands.push({ command: item.command, status: item.status === "completed" ? "completed" : "failed", ...(item.exit_code === undefined ? {} : { exitCode: item.exit_code }) });
      if (item.status === "failed") emit(options, { kind: "error", step, message: `${label} échouée`, ...(item.exit_code === undefined ? {} : { detail: `Code ${item.exit_code}` }) });
    }
    return undefined;
  }
  if (item.type === "mcp_tool_call") {
    if (event.type === "item.started") publishToolDigest(options, progress, "Consultation d’un outil connecté");
    if (event.type === "item.completed" && item.status === "failed") emit(options, { kind: "error", step: "execution", message: "Outil connecté indisponible" });
    return undefined;
  }
  if (item.type === "web_search" && event.type === "item.started") {
    publishToolDigest(options, progress, "Recherche de sources en ligne");
    return undefined;
  }
  if (item.type === "file_change" && event.type === "item.completed") {
    changes.push(...item.changes);
    emit(options, { kind: "file", step: "execution", message: `${item.changes.length || 1} fichier${item.changes.length > 1 ? "s" : ""} modifié${item.changes.length > 1 ? "s" : ""}` });
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
  const thread = existingThread ?? createCodexClient().startThread({
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
  const progress: ProgressDigestState = { toolCalls: 0 };
  for await (const event of events) {
    if (event.type === "turn.completed") usage = addTokenUsage(usage, tokenUsageFromSdk(event.usage));
    const message = trackEvent(event, options, changes, commands, progress);
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
    const finalResponse = await recoverElectronSmoke(context, options, commands, primary.finalResponse);
    return { finalResponse, reviewHadFindings: false, threadIds, changes: await finalChanges(), commands, usage: { executor: primary.usage, reviewer, total: primary.usage } };
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
    const finalResponse = await recoverElectronSmoke(context, options, commands, primary.finalResponse);
    return { finalResponse, reviewResponse, reviewHadFindings: false, threadIds, changes: await finalChanges(), commands, usage: { executor: primary.usage, reviewer: review.usage, total } };
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
  const finalResponse = await recoverElectronSmoke(context, options, commands, final.finalResponse);
  return { finalResponse, reviewResponse, reviewHadFindings: true, threadIds, changes: await finalChanges(), commands, usage: { executor, reviewer: review.usage, total } };
}

export async function continueCodex(
  request: string,
  context: ProjectContext,
  decision: RoutingDecision,
  threadId: string,
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
  emit(options, { kind: "activity", step: "execution", message: "Codex reprend la conversation" });
  const thread = createCodexClient().resumeThread(threadId, {
    model: decision.model,
    modelReasoningEffort: decision.reasoning,
    workingDirectory: context.root,
    sandboxMode: decision.permissions,
    approvalPolicy: "never",
    skipGitRepoCheck: !context.signals.includes("git"),
  });
  const continued = await runStream(request, context, decision, options, changes, commands, thread);
  const threadIds = continued.threadId ? [continued.threadId] : [threadId];

  if (decision.workflow === "single-agent") {
    const finalResponse = await recoverElectronSmoke(context, options, commands, continued.finalResponse);
    return {
      finalResponse,
      reviewHadFindings: false,
      threadIds,
      changes: await finalChanges(),
      commands,
      usage: { executor: continued.usage, reviewer: zeroTokenUsage(), total: continued.usage },
    };
  }

  emit(options, { kind: "activity", step: "tests", message: "Revue indépendante en lecture seule" });
  const reviewDecision: RoutingDecision = { ...decision, reasoning: reviewReasoning(decision.reasoning), workflow: "single-agent", permissions: "read-only" };
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
    const finalResponse = await recoverElectronSmoke(context, options, commands, continued.finalResponse);
    const total = addTokenUsage(continued.usage, review.usage);
    return { finalResponse, reviewResponse, reviewHadFindings: false, threadIds, changes: await finalChanges(), commands, usage: { executor: continued.usage, reviewer: review.usage, total } };
  }

  emit(options, { kind: "activity", step: "execution", message: "Correction des constats de revue" });
  const final = await runStream(
    `Voici la revue independante du travail:\n\n${reviewResponse}\n\nCorrige tous les constats actionnables qui concernent la demande, relance les validations utiles, puis donne la reponse finale.`,
    context,
    decision,
    options,
    changes,
    commands,
    continued.thread,
  );
  const executor = addTokenUsage(continued.usage, final.usage);
  const total = addTokenUsage(executor, review.usage);
  const finalResponse = await recoverElectronSmoke(context, options, commands, final.finalResponse);
  return {
    finalResponse,
    reviewResponse,
    reviewHadFindings: true,
    threadIds,
    changes: await finalChanges(),
    commands,
    usage: { executor, reviewer: review.usage, total },
  };
}
