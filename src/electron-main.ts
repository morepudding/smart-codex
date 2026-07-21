import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { continueCodex, runCodex } from "./codex-runner.js";
import type { DesktopContinueRequest, DesktopRequest, DesktopRoutingRequest, DesktopRunRequest, DesktopRunResponse, ManualRoutingSelection, MissionOutcomeMetrics, MissionSession, UiMissionEvent, UiRoutingDecision, UiRoutingProposal, ValidationMetrics } from "./electron-api.js";
import { captureGitHead, captureGitLineSnapshot, lineMetricsSince, type GitLineSnapshot } from "./git-changes.js";
import { routeWithLuna } from "./luna-router.js";
import { addSelectedContextFiles, loadProjectContext } from "./project-context.js";
import { buildRoutingBrief } from "./routing-brief.js";
import { createDecision, createManualDecision, permissionsForIntent, SUPPORTED_REASONING, validateExecutionDecision } from "./router.js";
import { SessionStore } from "./session-store.js";
import { suggestExperimentalRouting } from "./smart-router.js";
import { addTokenUsage, zeroTokenUsage } from "./token-usage.js";
import type { ModelName, Permissions, ProjectContext, ReasoningLevel, RoutingDecision, RoutingResult, TaskIntent, Workflow } from "./types.js";
import { validationMetrics } from "./validation-metrics.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const OBSERVATION_MISSIONS = 20;
const MODEL_NAMES: ModelName[] = ["luna", "terra", "sol"];
const REASONING_LEVELS: ReasoningLevel[] = ["low", "medium", "high", "xhigh"];
const WORKFLOWS: Workflow[] = ["single-agent", "development-review"];
const PERMISSIONS: Permissions[] = ["read-only", "workspace-write"];
const INTENTS: TaskIntent[] = ["discussion", "ideation", "planning", "analysis", "implementation", "fix", "review"];

let mainWindow: BrowserWindow | null = null;
interface ActiveMission { controller: AbortController; owner: WebContents; sessionId: string; projectPath: string; permissions: Permissions; }
const activeMissions = new Map<string, ActiveMission>();
let sessionStore: SessionStore;
const preparedProposals = new Map<string, {
  request: DesktopRequest;
  context: ProjectContext;
  routing: RoutingResult;
  experimental: import("./types.js").ExperimentalRouting;
  gitStartCommit?: string;
  gitLineStart: GitLineSnapshot;
  createdAt: number;
}>();

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Source IPC non autorisee.");
}

function validateRequest(value: unknown): DesktopRequest {
  if (!value || typeof value !== "object") throw new Error("Requete invalide.");
  const candidate = value as Partial<DesktopRequest>;
  if (typeof candidate.request !== "string" || candidate.request.trim().length === 0) throw new Error("Ecris une demande avant de lancer Codex.");
  if (candidate.request.length > 50_000) throw new Error("La demande est trop longue.");
  if (typeof candidate.projectPath !== "string" || !path.isAbsolute(candidate.projectPath)) throw new Error("Choisis un dossier projet valide.");
  const projectPath = path.resolve(candidate.projectPath);
  const contextFiles = candidate.contextFiles ?? [];
  if (!Array.isArray(contextFiles) || contextFiles.some((filePath) => typeof filePath !== "string" || !path.isAbsolute(filePath))) throw new Error("Fichiers de contexte invalides.");
  return { request: candidate.request.trim(), projectPath, contextFiles: [...new Set(contextFiles.map((filePath) => path.resolve(filePath)))] };
}

function validateRoutingRequest(value: unknown): DesktopRoutingRequest {
  const request = validateRequest(value);
  const candidate = value as Partial<DesktopRoutingRequest>;
  if (candidate.routingMode !== "luna" && candidate.routingMode !== "manual") throw new Error("Mode de routage invalide.");
  if (candidate.routingMode === "luna") return { ...request, routingMode: "luna" };
  return { ...request, routingMode: "manual", manualDecision: validateManualDecision(candidate.manualDecision) };
}

function validateManualDecision(value: unknown): ManualRoutingSelection {
  if (!value || typeof value !== "object") throw new Error("Configuration manuelle manquante.");
  const manual = value as Partial<ManualRoutingSelection>;
  if (!manual.intent || !INTENTS.includes(manual.intent)) throw new Error("Mode manuel invalide.");
  if (!manual.modelName || !MODEL_NAMES.includes(manual.modelName)) throw new Error("Modele manuel invalide.");
  if (!manual.reasoning || !REASONING_LEVELS.includes(manual.reasoning)) throw new Error("Reflexion manuelle invalide.");
  if (!manual.workflow || !WORKFLOWS.includes(manual.workflow)) throw new Error("Workflow manuel invalide.");
  if (!SUPPORTED_REASONING[manual.modelName].includes(manual.reasoning)) throw new Error("Cette reflexion n'est pas acceptee par le modele manuel.");
  return manual as ManualRoutingSelection;
}

function validateRunRequest(value: unknown): DesktopRunRequest {
  const request = validateRequest(value);
  const candidate = value as Partial<DesktopRunRequest>;
  if (typeof candidate.proposalId !== "string" || !/^[a-f0-9-]{36}$/i.test(candidate.proposalId)) throw new Error("Proposition de routage invalide.");
  if (typeof candidate.clientRunId !== "string" || !/^[a-f0-9-]{36}$/i.test(candidate.clientRunId)) throw new Error("Identifiant de lancement invalide.");
  if (candidate.intent !== undefined && !INTENTS.includes(candidate.intent)) throw new Error("Mode modifie invalide.");
  if (candidate.modelName !== undefined && !MODEL_NAMES.includes(candidate.modelName)) throw new Error("Modele modifie invalide.");
  if (candidate.reasoning !== undefined && !REASONING_LEVELS.includes(candidate.reasoning)) throw new Error("Reflexion modifiee invalide.");
  if (candidate.workflow !== undefined && !WORKFLOWS.includes(candidate.workflow)) throw new Error("Workflow modifie invalide.");
  if (candidate.permissions !== undefined && !PERMISSIONS.includes(candidate.permissions)) throw new Error("Permissions modifiees invalides.");
  if (candidate.confirmed !== true) throw new Error("La decision doit etre validee visuellement avant le lancement.");
  return {
    ...request,
    proposalId: candidate.proposalId,
    clientRunId: candidate.clientRunId,
    confirmed: true,
    ...(candidate.intent ? { intent: candidate.intent } : {}),
    ...(candidate.modelName ? { modelName: candidate.modelName } : {}),
    ...(candidate.reasoning ? { reasoning: candidate.reasoning } : {}),
    ...(candidate.workflow ? { workflow: candidate.workflow } : {}),
    ...(candidate.permissions ? { permissions: candidate.permissions } : {}),
  };
}

function validateContinueRequest(value: unknown): DesktopContinueRequest {
  if (!value || typeof value !== "object") throw new Error("Requete invalide.");
  const candidate = value as Partial<DesktopContinueRequest>;
  if (!isSessionId(candidate.sessionId)) throw new Error("Identifiant de session invalide.");
  if (typeof candidate.message !== "string" || candidate.message.trim().length === 0) throw new Error("Ecris un message avant de l'envoyer.");
  if (candidate.message.length > 50_000) throw new Error("Le message est trop long.");
  return { sessionId: candidate.sessionId, message: candidate.message.trim(), manualDecision: validateManualDecision(candidate.manualDecision) };
}

function toUiDecision(decision: RoutingDecision, projectPath: string): UiRoutingDecision {
  return {
    modelName: decision.modelName,
    model: decision.model,
    reasoning: decision.reasoning,
    workflow: decision.workflow,
    permissions: decision.permissions,
    uncertainty: decision.uncertainty,
    intent: decision.intent,
    expectedResult: decision.expectedResult,
    requiresConfirmation: decision.requiresConfirmation,
    reason: decision.reason,
    unknowns: decision.unknowns,
    source: decision.source,
    projectPath,
  };
}

function toRoutingDecision(decision: UiRoutingDecision): RoutingDecision {
  return {
    modelName: decision.modelName, model: decision.model as RoutingDecision["model"], reasoning: decision.reasoning, workflow: decision.workflow,
    permissions: decision.permissions, uncertainty: decision.uncertainty, intent: decision.intent,
    expectedResult: decision.expectedResult, requiresConfirmation: decision.requiresConfirmation,
    reason: decision.reason, unknowns: decision.unknowns, source: decision.source,
  };
}

function completionIssue(decision: RoutingDecision, finalResponse: string, filesModified: number): { status: "failed" | "permission_required"; message: string } | undefined {
  if (decision.expectedResult !== "project-changes" || filesModified > 0) return undefined;
  if (/CreateProcessAsUserW|spawn\s+EPERM|operation not permitted|access denied|acc[eè]s refus[eé]|bloqu[eé].{0,40}sandbox/i.test(finalResponse)) {
    return { status: "permission_required", message: "Le sandbox a empêché l’implémentation avant toute modification du projet." };
  }
  return { status: "failed", message: "La mission demandait une implémentation, mais aucune modification du projet n’a été détectée." };
}

function titleFromRequest(request: string): string {
  const compact = request.replace(/\s+/g, " ").trim();
  return compact.length > 52 ? compact.slice(0, 49) + "…" : compact;
}

function isSessionId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value); }
function sendMissionEvent(owner: WebContents, event: UiMissionEvent): void {
  if (owner.isDestroyed()) return;
  owner.send("codex:mission-event", event);
  if (event.type !== "terminal") return;
  const window = BrowserWindow.fromWebContents(owner);
  if (!window || window.isFocused()) return;
  window.flashFrame(true);
  const stopFlash = (): void => { if (!window.isDestroyed()) window.flashFrame(false); };
  window.once("focus", stopFlash);
  setTimeout(stopFlash, 12_000);
}

async function decide(value: unknown): Promise<UiRoutingProposal> {
  const routingRequest = validateRoutingRequest(value);
  const request: DesktopRequest = { request: routingRequest.request, projectPath: routingRequest.projectPath };
  const context = await addSelectedContextFiles(await loadProjectContext(request.projectPath), request.contextFiles ?? []);
  const routingPromise: Promise<RoutingResult> = routingRequest.routingMode === "luna"
    ? routeWithLuna(request.request, context)
    : buildRoutingBrief(request.request, context).then((brief) => ({
        brief,
        decision: createManualDecision(routingRequest.manualDecision!, request.request),
        routerUsage: zeroTokenUsage(),
        lunaAttempts: 0,
      }));
  const [routing, experimental, gitStartCommit, gitLineStart] = await Promise.all([
    routingPromise,
    suggestExperimentalRouting(request.request, context),
    context.signals.includes("git") ? captureGitHead(context.root) : Promise.resolve(undefined),
    context.signals.includes("git") ? captureGitLineSnapshot(context.root) : Promise.resolve(new Map()),
  ]);
  const observed = sessionStore.list().filter((session) => session.tokens?.router).length;
  const proposalId = crypto.randomUUID();
  preparedProposals.set(proposalId, {
    request: { ...request, projectPath: context.root },
    context,
    routing,
    experimental,
    ...(gitStartCommit ? { gitStartCommit } : {}),
    gitLineStart,
    createdAt: Date.now(),
  });
  for (const [id, proposal] of preparedProposals) if (Date.now() - proposal.createdAt > 30 * 60_000) preparedProposals.delete(id);
  return {
    proposalId,
    routingMode: routingRequest.routingMode,
    decision: toUiDecision(routing.decision, context.root),
    observationIndex: Math.min(observed + 1, OBSERVATION_MISSIONS),
    remainingObservations: Math.max(0, OBSERVATION_MISSIONS - observed - 1),
    lunaAttempts: routing.lunaAttempts,
    routerUsage: routing.routerUsage,
    experimental,
    ...(routing.fallbackReason ? { fallbackReason: routing.fallbackReason } : {}),
  };
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 680, backgroundColor: "#f6f4f1", show: false,
    title: "Smart Codex", autoHideMenuBar: true,
    webPreferences: { preload: path.join(currentDir, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.once("did-finish-load", async () => {
    if (process.env.SMART_CODEX_SMOKE_TEST !== "1") return;
    const smoke = await mainWindow?.webContents.executeJavaScript(`(() => {
      const bridge = Boolean(window.smartCodex && typeof window.smartCodex.listSessions === "function" && typeof window.smartCodex.getSession === "function" && typeof window.smartCodex.continueSession === "function" && typeof window.smartCodex.stop === "function");
      const source = "# Proposition\\n\\n- **Murs** : vie et résistance\\n- **Armes** : archers\\n\\n| Type | Valeur |\\n| --- | --- |\\n| Code | \`inline\` |\\n\\n<img src=x onerror=alert(1)>";
      const rendered = window.DOMPurify.sanitize(window.marked.parse(source, { gfm: true }), { FORBID_TAGS: ["script"], FORBID_ATTR: ["onerror"] });
      const markdown = rendered.includes("<h1>") && rendered.includes("<strong>Murs</strong>") && rendered.includes("<table>") && rendered.includes("<code>inline</code>") && !rendered.includes("onerror");
      const structure = Boolean(document.querySelector("#conversation") && document.querySelector("#follow-up-form") && document.querySelector("#follow-up-intent") && document.querySelector("#follow-up-model") && document.querySelector("#follow-up-reasoning") && document.querySelector("#follow-up-workflow") && document.querySelector("#context-mode") && document.querySelector("#return-to-result") && document.querySelector("#routing-mode-luna") && document.querySelector("#routing-mode-manual") && document.querySelector("#manual-routing-settings") && document.querySelector("#mission-beacon"));
      return { bridge, markdown, structure };
    })()`);
    if (!smoke?.bridge || !smoke.markdown || !smoke.structure) { console.error("SMART_CODEX_RENDERER_INVALID", smoke); app.exit(1); return; }
    console.log("SMART_CODEX_RENDERER_READY");
    console.log("SMART_CODEX_MARKDOWN_READY");
    setTimeout(() => app.quit(), 100);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadFile(path.join(currentDir, "ui", "index.html"));
}

app.whenReady().then(async () => {
  sessionStore = new SessionStore(path.join(app.getPath("userData"), "mission-history.json"));
  await sessionStore.initialize();

  ipcMain.handle("project:select", async (event) => {
    assertTrustedSender(event);
    const options = { title: "Choisir le projet", buttonLabel: "Choisir ce dossier", properties: ["openDirectory"] as Array<"openDirectory"> };
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const selectedPaths = owner ? dialog.showOpenDialogSync(owner, options) : dialog.showOpenDialogSync(options);
    return selectedPaths?.[0] ?? null;
  });
  ipcMain.handle("context:select-files", async (event, projectPathValue: unknown) => {
    assertTrustedSender(event);
    if (typeof projectPathValue !== "string" || !path.isAbsolute(projectPathValue)) throw new Error("Choisis d'abord un projet valide.");
    const projectPath = path.resolve(projectPathValue);
    const options = {
      title: "Ajouter des fichiers de contexte",
      buttonLabel: "Ajouter au contexte",
      defaultPath: projectPath,
      properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
    };
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const selectedPaths = owner ? dialog.showOpenDialogSync(owner, options) : dialog.showOpenDialogSync(options);
    if (!selectedPaths?.length) return [];
    await addSelectedContextFiles(await loadProjectContext(projectPath), selectedPaths);
    return selectedPaths.map((selectedPath) => path.resolve(selectedPath));
  });
  ipcMain.handle("router:decide", async (event, value: unknown) => { assertTrustedSender(event); return decide(value); });
  ipcMain.handle("history:list", (event) => { assertTrustedSender(event); return sessionStore.list(); });
  ipcMain.handle("history:get", (event, id: unknown) => { assertTrustedSender(event); if (!isSessionId(id)) throw new Error("Identifiant de session invalide."); return sessionStore.get(id) ?? null; });
  ipcMain.handle("history:delete", async (event, id: unknown) => {
    assertTrustedSender(event);
    if (!isSessionId(id)) throw new Error("Identifiant de session invalide.");
    if (activeMissions.has(id)) throw new Error("Impossible de supprimer une conversation en cours.");
    await sessionStore.delete(id);
  });
  ipcMain.handle("codex:stop", async (event, id: unknown) => {
    assertTrustedSender(event);
    if (!isSessionId(id)) throw new Error("Identifiant de session invalide.");
    const mission = activeMissions.get(id);
    if (!mission || mission.owner !== event.sender) throw new Error("Cette mission n'est plus active.");
    mission.controller.abort();
  });

  ipcMain.handle("codex:run", async (event, value: unknown): Promise<DesktopRunResponse> => {
    assertTrustedSender(event);
    const request = validateRunRequest(value);
    const proposal = preparedProposals.get(request.proposalId);
    if (!proposal) throw new Error("Cette proposition a expire. Relance l'analyse Luna.");
    const proposedFiles = proposal.request.contextFiles ?? [];
    const requestedFiles = request.contextFiles ?? [];
    if (proposal.request.request !== request.request || proposal.context.root.toLowerCase() !== path.resolve(request.projectPath).toLowerCase() || proposedFiles.length !== requestedFiles.length || proposedFiles.some((filePath, index) => filePath.toLowerCase() !== requestedFiles[index]?.toLowerCase())) throw new Error("La demande, le projet ou le contexte ne correspond plus a la proposition validee.");

    const initialDecision = proposal.routing.decision;
    const intent = request.intent ?? (request.permissions === "workspace-write" && initialDecision.permissions === "read-only" ? "implementation" : initialDecision.intent);
    const parameters = {
      modelName: request.modelName ?? initialDecision.modelName,
      reasoning: request.reasoning ?? initialDecision.reasoning,
      workflow: request.workflow ?? initialDecision.workflow,
      permissions: permissionsForIntent(intent),
      intent,
    };
    if (!SUPPORTED_REASONING[parameters.modelName].includes(parameters.reasoning)) throw new Error("Ce niveau de reflexion n'est pas accepte par ce modele.");
    const manualCorrection = parameters.modelName !== initialDecision.modelName || parameters.reasoning !== initialDecision.reasoning || parameters.workflow !== initialDecision.workflow || parameters.permissions !== initialDecision.permissions || parameters.intent !== initialDecision.intent;
    const executedDecision = manualCorrection
      ? createDecision(parameters, {
          uncertainty: initialDecision.uncertainty,
          requiresConfirmation: initialDecision.requiresConfirmation,
          reason: "Décision automatique corrigée manuellement. " + initialDecision.reason,
          unknowns: initialDecision.unknowns,
          source: "user",
          intent: parameters.intent,
        })
      : initialDecision;
    validateExecutionDecision(executedDecision, request.request, request.confirmed);

    const context = proposal.context;
    const conflictingMission = [...activeMissions.values()].find((mission) => mission.projectPath.toLowerCase() === context.root.toLowerCase() && (mission.permissions === "workspace-write" || executedDecision.permissions === "workspace-write"));
    if (conflictingMission) throw new Error("Une mission qui peut modifier ce projet est déjà en cours. Lance cette tâche sur un autre projet ou attends sa fin.");

    const initialUi = toUiDecision(initialDecision, context.root);
    const executedUi = toUiDecision(executedDecision, context.root);
    const previousFailure = sessionStore.list().find((session) => session.request === request.request && session.projectPath.toLowerCase() === context.root.toLowerCase() && session.status !== "completed");
    const rerunWithDifferentModel = Boolean(previousFailure?.executedDecision && previousFailure.executedDecision.modelName !== executedDecision.modelName);
    const sessionId = crypto.randomUUID();
    const createdAt = Date.now();
    const session: MissionSession = {
      id: sessionId, title: titleFromRequest(request.request), request: request.request, projectPath: context.root,
      ...(proposal.gitStartCommit ? { gitStartCommit: proposal.gitStartCommit } : {}),
      status: "running", createdAt, updatedAt: createdAt,
      initialDecision: initialUi, executedDecision: executedUi, liveEvents: [], events: [],
      experimentalRouting: proposal.experimental,
      messages: [{ role: "user", content: request.request, at: createdAt }],
    };
    const controller = new AbortController();
    activeMissions.set(sessionId, { controller, owner: event.sender, sessionId, projectPath: context.root, permissions: executedDecision.permissions });
    try { await sessionStore.create(session); }
    catch (error) { activeMissions.delete(sessionId); throw error; }
    const events: UiMissionEvent[] = [];
    const publish = (payload: Omit<UiMissionEvent, "sessionId">): void => {
      const missionEvent: UiMissionEvent = { ...payload, sessionId, clientRunId: request.clientRunId };
      events.push(missionEvent);
      sendMissionEvent(event.sender, missionEvent);
    };

    try {
      publish({ type: "activity", step: "docs", message: "Resume court du projet reutilise", at: Date.now() });
      publish({ type: "strategy", decision: executedUi, at: Date.now() });
      publish({ type: "activity", step: "route", message: `Stratégie : ${executedDecision.modelName} ${executedDecision.reasoning} / ${executedDecision.workflow}`, at: Date.now() });
      const result = await runCodex(request.request, context, executedDecision, { signal: controller.signal, onProgress: (progress) => publish({ type: progress.kind, severity: progress.severity ?? (progress.kind === "error" ? "warning" : "info"), ...(progress.step ? { step: progress.step } : {}), message: progress.message, ...(progress.detail ? { detail: progress.detail } : {}), at: progress.at }) });
      const durationMs = Date.now() - createdAt;
      const gitAfter = context.signals.includes("git") ? await captureGitLineSnapshot(context.root) : new Map();
      const gitMetrics = lineMetricsSince(proposal.gitLineStart, gitAfter);
      gitMetrics.filesModified = Math.max(gitMetrics.filesModified, result.changes.length);
      const validations = validationMetrics(result.commands);
      const issue = completionIssue(executedDecision, result.finalResponse, gitMetrics.filesModified);
      const missionStatus = issue?.status ?? "completed";
      const outcome: MissionOutcomeMetrics = { status: missionStatus, durationMs, validations, ...gitMetrics };
      const router = proposal.routing.routerUsage;
      const runUsage = result.usage;
      const total = addTokenUsage(router, runUsage.total);
      const firstTrySuccess = missionStatus === "completed" && !previousFailure && !manualCorrection && !result.reviewHadFindings && validations.tests.failed === 0 && validations.build.failed === 0;
      publish({ type: "terminal", status: missionStatus, message: issue?.message ?? "Mission terminee", at: Date.now() });
      await sessionStore.update(sessionId, {
        status: missionStatus,
        ...(issue ? { error: issue.message } : {}),
        tokens: { router, executor: runUsage.executor, reviewer: runUsage.reviewer, total },
        outcome,
        routingQuality: { firstTrySuccess, escalationNeeded: Boolean(previousFailure), manualCorrection, rerunWithDifferentModel },
        summary: { finalResponse: result.finalResponse, ...(result.reviewResponse ? { reviewResponse: result.reviewResponse } : {}) },
        result,
        ...(result.threadIds[0] ? { threadId: result.threadIds[0] } : {}),
        messages: [...(session.messages ?? []), { role: "assistant", content: result.finalResponse, at: Date.now() }],
        events,
        technicalTrace: { expiresAt: sessionStore.failureTraceExpiry(), error: "", events, commands: result.commands },
      });
      preparedProposals.delete(request.proposalId);
      return { sessionId, decision: executedUi, result, durationMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = controller.signal.aborted ? "cancelled" : /permission|approval|access denied|operation not permitted|eperm/i.test(message) ? "permission_required" : /timed?\s*out|timeout/i.test(message) ? "timed_out" : "failed";
      const durationMs = Date.now() - createdAt;
      const gitAfter = context.signals.includes("git") ? await captureGitLineSnapshot(context.root) : new Map();
      const gitMetrics = lineMetricsSince(proposal.gitLineStart, gitAfter);
      publish({ type: "terminal", status, message, at: Date.now() });
      await sessionStore.update(sessionId, {
        status,
        error: message,
        tokens: { router: proposal.routing.routerUsage, executor: zeroTokenUsage(), reviewer: zeroTokenUsage(), total: proposal.routing.routerUsage },
        outcome: { status, durationMs, validations: { tests: { run: 0, failed: 0 }, build: { run: 0, failed: 0 } }, ...gitMetrics },
        routingQuality: { firstTrySuccess: false, escalationNeeded: Boolean(previousFailure), manualCorrection, rerunWithDifferentModel },
        technicalTrace: { expiresAt: sessionStore.failureTraceExpiry(), error: message, events, commands: [] },
        events,
      });
      throw error;
    } finally { activeMissions.delete(sessionId); }
  });

  ipcMain.handle("codex:continue", async (event, value: unknown): Promise<DesktopRunResponse> => {
    assertTrustedSender(event);
    const request = validateContinueRequest(value);
    const session = sessionStore.get(request.sessionId);
    if (!session) throw new Error("Conversation introuvable.");
    if (!session.threadId || !session.executedDecision) throw new Error("Cette ancienne conversation ne peut pas etre reprise.");
    const context = await loadProjectContext(session.projectPath);
    const decision = createManualDecision(request.manualDecision, request.message);
    const conflictingMission = [...activeMissions.values()].find((mission) => mission.sessionId !== session.id && mission.projectPath.toLowerCase() === context.root.toLowerCase() && (mission.permissions === "workspace-write" || decision.permissions === "workspace-write"));
    if (conflictingMission) throw new Error("Une mission qui peut modifier ce projet est déjà en cours. Attends sa fin avant de reprendre cette conversation.");
    const controller = new AbortController();
    activeMissions.set(session.id, { controller, owner: event.sender, sessionId: session.id, projectPath: context.root, permissions: decision.permissions });
    const startedAt = Date.now();
    const events: UiMissionEvent[] = [];
    const messages = [...(session.messages ?? []), { role: "user" as const, content: request.message, at: startedAt }];
    const publish = (payload: Omit<UiMissionEvent, "sessionId">): void => {
      const missionEvent: UiMissionEvent = { ...payload, sessionId: session.id };
      events.push(missionEvent); sendMissionEvent(event.sender, missionEvent);
    };
    try { await sessionStore.update(session.id, { status: "running", error: undefined, events, messages }); }
    catch (error) { activeMissions.delete(session.id); throw error; }
    try {
      const result = await continueCodex(request.message, context, decision, session.threadId, {
        signal: controller.signal,
        onProgress: (progress) => publish({ type: progress.kind, severity: progress.severity ?? (progress.kind === "error" ? "warning" : "info"), ...(progress.step ? { step: progress.step } : {}), message: progress.message, ...(progress.detail ? { detail: progress.detail } : {}), at: progress.at }),
      });
      const durationMs = Date.now() - startedAt;
      const validations = validationMetrics(result.commands);
      const outcome: MissionOutcomeMetrics = { status: "completed", durationMs, validations, filesModified: result.changes.length, linesAdded: 0, linesDeleted: 0 };
      const currentTokens = session.tokens ?? { router: zeroTokenUsage(), executor: zeroTokenUsage(), reviewer: zeroTokenUsage(), total: zeroTokenUsage() };
      const executor = addTokenUsage(currentTokens.executor, result.usage.executor);
      const reviewer = addTokenUsage(currentTokens.reviewer, result.usage.reviewer);
      const total = addTokenUsage(currentTokens.total, result.usage.total);
      publish({ type: "terminal", status: "completed", message: "Conversation terminee", at: Date.now() });
      await sessionStore.update(session.id, {
        status: "completed", durationMs, outcome, events, threadId: result.threadIds[0] ?? session.threadId,
        executedDecision: toUiDecision(decision, context.root), decision: toUiDecision(decision, context.root),
        tokens: { router: currentTokens.router, executor, reviewer, total },
        summary: { finalResponse: result.finalResponse }, result,
        messages: [...messages, { role: "assistant", content: result.finalResponse, at: Date.now() }],
        technicalTrace: { expiresAt: sessionStore.failureTraceExpiry(), error: "", events, commands: result.commands },
      });
      return { sessionId: session.id, decision: session.executedDecision, result, durationMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = controller.signal.aborted ? "cancelled" : "failed";
      publish({ type: "terminal", status, message, at: Date.now() });
      await sessionStore.update(session.id, {
        status, error: message, durationMs: Date.now() - startedAt, events, messages,
        technicalTrace: { expiresAt: sessionStore.failureTraceExpiry(), error: message, events, commands: [] },
      });
      throw error;
    } finally { activeMissions.delete(session.id); }
  });

  await createWindow();
  app.on("activate", async () => { if (BrowserWindow.getAllWindows().length === 0) await createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
