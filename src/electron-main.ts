import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodex } from "./codex-runner.js";
import type { DesktopRequest, DesktopRunRequest, DesktopRunResponse, MissionOutcomeMetrics, MissionSession, UiMissionEvent, UiRoutingDecision, UiRoutingProposal, ValidationMetrics } from "./electron-api.js";
import { captureGitHead, captureGitLineSnapshot, lineMetricsSince, type GitLineSnapshot } from "./git-changes.js";
import { routeWithLuna } from "./luna-router.js";
import { loadProjectContext } from "./project-context.js";
import { createDecision, SUPPORTED_REASONING, validateExecutionDecision } from "./router.js";
import { SessionStore } from "./session-store.js";
import { addTokenUsage, zeroTokenUsage } from "./token-usage.js";
import type { ModelName, Permissions, ProjectContext, ReasoningLevel, RoutingDecision, RoutingResult, Workflow } from "./types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const OBSERVATION_MISSIONS = 20;
const MODEL_NAMES: ModelName[] = ["luna", "terra", "sol"];
const REASONING_LEVELS: ReasoningLevel[] = ["low", "medium", "high", "xhigh"];
const WORKFLOWS: Workflow[] = ["single-agent", "development-review"];
const PERMISSIONS: Permissions[] = ["read-only", "workspace-write"];

let mainWindow: BrowserWindow | null = null;
let activeMission: { controller: AbortController; owner: WebContents; sessionId: string } | null = null;
let sessionStore: SessionStore;
const preparedProposals = new Map<string, {
  request: DesktopRequest;
  context: ProjectContext;
  routing: RoutingResult;
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
  return { request: candidate.request.trim(), projectPath: path.resolve(candidate.projectPath) };
}

function validateRunRequest(value: unknown): DesktopRunRequest {
  const request = validateRequest(value);
  const candidate = value as Partial<DesktopRunRequest>;
  if (typeof candidate.proposalId !== "string" || !/^[a-f0-9-]{36}$/i.test(candidate.proposalId)) throw new Error("Proposition de routage invalide.");
  if (candidate.modelName !== undefined && !MODEL_NAMES.includes(candidate.modelName)) throw new Error("Modele modifie invalide.");
  if (candidate.reasoning !== undefined && !REASONING_LEVELS.includes(candidate.reasoning)) throw new Error("Reflexion modifiee invalide.");
  if (candidate.workflow !== undefined && !WORKFLOWS.includes(candidate.workflow)) throw new Error("Workflow modifie invalide.");
  if (candidate.permissions !== undefined && !PERMISSIONS.includes(candidate.permissions)) throw new Error("Permissions modifiees invalides.");
  if (candidate.confirmed !== true) throw new Error("La decision doit etre validee visuellement avant le lancement.");
  return {
    ...request,
    proposalId: candidate.proposalId,
    confirmed: true,
    ...(candidate.modelName ? { modelName: candidate.modelName } : {}),
    ...(candidate.reasoning ? { reasoning: candidate.reasoning } : {}),
    ...(candidate.workflow ? { workflow: candidate.workflow } : {}),
    ...(candidate.permissions ? { permissions: candidate.permissions } : {}),
  };
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

function validationMetrics(commands: Array<{ command: string; status: "completed" | "failed" }>): ValidationMetrics {
  const tests = commands.filter((item) => /(^|\s)(test|vitest|jest|pytest|unittest|cargo test|go test)\b/i.test(item.command));
  const builds = commands.filter((item) => /(^|\s)(build|typecheck|type-check|tsc|lint|check:utf8)\b/i.test(item.command));
  return {
    tests: { run: tests.length, failed: tests.filter((item) => item.status === "failed").length },
    build: { run: builds.length, failed: builds.filter((item) => item.status === "failed").length },
  };
}

function titleFromRequest(request: string): string {
  const compact = request.replace(/\s+/g, " ").trim();
  return compact.length > 52 ? compact.slice(0, 49) + "…" : compact;
}

function isSessionId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value); }
function sendMissionEvent(owner: WebContents, event: UiMissionEvent): void { if (!owner.isDestroyed()) owner.send("codex:mission-event", event); }

async function decide(value: unknown): Promise<UiRoutingProposal> {
  const request = validateRequest(value);
  const context = await loadProjectContext(request.projectPath);
  const [routing, gitStartCommit, gitLineStart] = await Promise.all([
    routeWithLuna(request.request, context),
    context.signals.includes("git") ? captureGitHead(context.root) : Promise.resolve(undefined),
    context.signals.includes("git") ? captureGitLineSnapshot(context.root) : Promise.resolve(new Map()),
  ]);
  const observed = sessionStore.list().filter((session) => session.tokens?.router).length;
  const proposalId = crypto.randomUUID();
  preparedProposals.set(proposalId, {
    request: { ...request, projectPath: context.root },
    context,
    routing,
    ...(gitStartCommit ? { gitStartCommit } : {}),
    gitLineStart,
    createdAt: Date.now(),
  });
  for (const [id, proposal] of preparedProposals) if (Date.now() - proposal.createdAt > 30 * 60_000) preparedProposals.delete(id);
  return {
    proposalId,
    decision: toUiDecision(routing.decision, context.root),
    observationIndex: Math.min(observed + 1, OBSERVATION_MISSIONS),
    remainingObservations: Math.max(0, OBSERVATION_MISSIONS - observed - 1),
    lunaAttempts: routing.lunaAttempts,
    routerUsage: routing.routerUsage,
    ...(routing.fallbackReason ? { fallbackReason: routing.fallbackReason } : {}),
  };
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 680, backgroundColor: "#0f0f10", show: false,
    title: "Smart Codex", autoHideMenuBar: true,
    webPreferences: { preload: path.join(currentDir, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.once("did-finish-load", async () => {
    if (process.env.SMART_CODEX_SMOKE_TEST !== "1") return;
    const smoke = await mainWindow?.webContents.executeJavaScript(`(() => {
      const bridge = Boolean(window.smartCodex && typeof window.smartCodex.listSessions === "function" && typeof window.smartCodex.getSession === "function" && typeof window.smartCodex.stop === "function");
      const source = "# Proposition\\n\\n- **Murs** : vie et résistance\\n- **Armes** : archers\\n\\n| Type | Valeur |\\n| --- | --- |\\n| Code | \`inline\` |\\n\\n<img src=x onerror=alert(1)>";
      const rendered = window.DOMPurify.sanitize(window.marked.parse(source, { gfm: true }), { FORBID_TAGS: ["script"], FORBID_ATTR: ["onerror"] });
      const markdown = rendered.includes("<h1>") && rendered.includes("<strong>Murs</strong>") && rendered.includes("<table>") && rendered.includes("<code>inline</code>") && !rendered.includes("onerror");
      const structure = Boolean(document.querySelector("#conversation") && document.querySelector("#context-mode") && document.querySelector("#return-to-result"));
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
  ipcMain.handle("router:decide", async (event, value: unknown) => { assertTrustedSender(event); return decide(value); });
  ipcMain.handle("history:list", (event) => { assertTrustedSender(event); return sessionStore.list(); });
  ipcMain.handle("history:get", (event, id: unknown) => { assertTrustedSender(event); if (!isSessionId(id)) throw new Error("Identifiant de session invalide."); return sessionStore.get(id) ?? null; });
  ipcMain.handle("codex:stop", async (event) => { assertTrustedSender(event); if (!activeMission || activeMission.owner !== event.sender) throw new Error("Aucune mission active a arreter."); activeMission.controller.abort(); });

  ipcMain.handle("codex:run", async (event, value: unknown): Promise<DesktopRunResponse> => {
    assertTrustedSender(event);
    if (activeMission) throw new Error("Une execution Codex est deja en cours.");
    const request = validateRunRequest(value);
    const proposal = preparedProposals.get(request.proposalId);
    if (!proposal) throw new Error("Cette proposition a expire. Relance l'analyse Luna.");
    if (proposal.request.request !== request.request || proposal.context.root.toLowerCase() !== path.resolve(request.projectPath).toLowerCase()) throw new Error("La demande ou le projet ne correspond plus a la proposition validee.");

    const initialDecision = proposal.routing.decision;
    const parameters = {
      modelName: request.modelName ?? initialDecision.modelName,
      reasoning: request.reasoning ?? initialDecision.reasoning,
      workflow: request.workflow ?? initialDecision.workflow,
      permissions: request.permissions ?? initialDecision.permissions,
    };
    if (!SUPPORTED_REASONING[parameters.modelName].includes(parameters.reasoning)) throw new Error("Ce niveau de reflexion n'est pas accepte par ce modele.");
    const manualCorrection = parameters.modelName !== initialDecision.modelName || parameters.reasoning !== initialDecision.reasoning || parameters.workflow !== initialDecision.workflow || parameters.permissions !== initialDecision.permissions;
    const executedDecision = manualCorrection
      ? createDecision(parameters, {
          uncertainty: initialDecision.uncertainty,
          requiresConfirmation: initialDecision.requiresConfirmation,
          reason: "Décision automatique corrigée manuellement. " + initialDecision.reason,
          unknowns: initialDecision.unknowns,
          source: "user",
          intent: parameters.permissions === "workspace-write" && initialDecision.permissions === "read-only" ? "implementation" : initialDecision.intent,
          expectedResult: parameters.permissions === "workspace-write" && initialDecision.permissions === "read-only" ? "project-changes" : initialDecision.expectedResult,
        })
      : initialDecision;
    validateExecutionDecision(executedDecision, request.request, request.confirmed);

    const context = proposal.context;
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
    };
    await sessionStore.create(session);
    const controller = new AbortController();
    activeMission = { controller, owner: event.sender, sessionId };
    const events: UiMissionEvent[] = [];
    const publish = (payload: Omit<UiMissionEvent, "sessionId">): void => {
      const missionEvent: UiMissionEvent = { ...payload, sessionId };
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
      const outcome: MissionOutcomeMetrics = { status: "completed", durationMs, validations, ...gitMetrics };
      const router = proposal.routing.routerUsage;
      const runUsage = result.usage;
      const total = addTokenUsage(router, runUsage.total);
      const firstTrySuccess = !previousFailure && !manualCorrection && !result.reviewHadFindings && validations.tests.failed === 0 && validations.build.failed === 0;
      publish({ type: "terminal", status: "completed", message: "Mission terminee", at: Date.now() });
      await sessionStore.update(sessionId, {
        status: "completed",
        tokens: { router, executor: runUsage.executor, reviewer: runUsage.reviewer, total },
        outcome,
        routingQuality: { firstTrySuccess, escalationNeeded: Boolean(previousFailure), manualCorrection, rerunWithDifferentModel },
        summary: { finalResponse: result.finalResponse, ...(result.reviewResponse ? { reviewResponse: result.reviewResponse } : {}) },
        result,
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
    } finally { activeMission = null; }
  });

  await createWindow();
  app.on("activate", async () => { if (BrowserWindow.getAllWindows().length === 0) await createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
