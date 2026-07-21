import type { MissionSession, UiMissionEvent, UiRoutingDecision, UiRoutingProposal } from "./electron-api.js";

type Phase = "idle" | "routing" | "review" | "running" | "done" | "failed" | "permission_required" | "cancelled" | "timed_out" | "interrupted";
type MessageKind = "user" | "assistant" | "error";
function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error("Élément introuvable : " + selector);
  return value;
}

const promptInput = element<HTMLTextAreaElement>("#prompt");
const chooseProject = element<HTMLButtonElement>("#choose-project");
const projectName = element<HTMLElement>("#project-name");
const projectPath = element<HTMLElement>("#project-path");
const launchButton = element<HTMLButtonElement>("#launch");
const launchLabel = element<HTMLElement>("#launch-label");
const newMissionButton = element<HTMLButtonElement>("#new-mission");
const historyList = element<HTMLElement>("#history-list");
const emptyState = element<HTMLElement>("#empty-state");
const missionView = element<HTMLElement>("#mission-view");
const missionTitle = element<HTMLElement>("#mission-title");
const missionProject = element<HTMLElement>("#mission-project");
const missionMeta = element<HTMLElement>("#mission-meta");
const conversation = element<HTMLElement>("#conversation");
const returnToResult = element<HTMLButtonElement>("#return-to-result");
const stopButton = element<HTMLButtonElement>("#stop-mission");
const showRequest = element<HTMLButtonElement>("#show-request");
const appStatus = element<HTMLElement>("#app-status");
const contextProject = element<HTMLElement>("#context-project");
const contextPath = element<HTMLElement>("#context-path");
const contextMode = element<HTMLElement>("#context-mode");
const contextAccess = element<HTMLElement>("#context-access");
const contextResult = element<HTMLElement>("#context-result");
const strategyMain = element<HTMLElement>("#strategy-main");
const strategySub = element<HTMLElement>("#strategy-sub");
const strategyDetailsToggle = element<HTMLButtonElement>("#strategy-details-toggle");
const strategyDetails = element<HTMLElement>("#strategy-details");
const contextStatus = element<HTMLElement>("#context-status");
const contextDuration = element<HTMLElement>("#context-duration");
const contextValidation = element<HTMLElement>("#context-validation");
const contextFiles = element<HTMLElement>("#context-files");
const contextLines = element<HTMLElement>("#context-lines");
const contextToggle = element<HTMLButtonElement>("#toggle-context");
const permissionCard = element<HTMLElement>("#permission-card");
const permissionMessage = element<HTMLElement>("#permission-message");
const retryPermission = element<HTMLButtonElement>("#retry-permission");
const routingProposal = element<HTMLElement>("#routing-proposal");
const proposalTitle = element<HTMLElement>("#proposal-title");
const proposalGrid = element<HTMLElement>(".proposal-grid");
const proposalObservation = element<HTMLElement>("#proposal-observation");
const proposalIntent = element<HTMLElement>("#proposal-intent");
const proposalResult = element<HTMLElement>("#proposal-result");
const proposalModel = element<HTMLSelectElement>("#proposal-model");
const proposalReasoning = element<HTMLSelectElement>("#proposal-reasoning");
const proposalWorkflow = element<HTMLSelectElement>("#proposal-workflow");
const proposalPermissions = element<HTMLSelectElement>("#proposal-permissions");
const proposalUncertainty = element<HTMLElement>("#proposal-uncertainty");
const proposalReason = element<HTMLElement>("#proposal-reason");
const proposalUnknowns = element<HTMLElement>("#proposal-unknowns");
const confirmationNote = element<HTMLElement>("#confirmation-note");
const modifyRoute = element<HTMLButtonElement>("#modify-route");
const confirmLaunch = element<HTMLButtonElement>("#confirm-launch");

let selectedProject = localStorage.getItem("smart-codex.project") ?? "";
let sessions: MissionSession[] = [];
let activeSession: MissionSession | null = null;
let activeSessionId = "";
let runningEvents: UiMissionEvent[] = [];
let runningStartedAt = 0;
let liveResponse = "";
let pendingProposal: UiRoutingProposal | null = null;
let autoScroll = true;
let programmaticScroll = false;

function projectLabel(value: string): string { return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value; }
function durationLabel(milliseconds?: number): string {
  if (!milliseconds) return "—";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds < 60 ? seconds + " s" : Math.floor(seconds / 60) + " min " + (seconds % 60) + " s";
}
function dateLabel(timestamp: number): string { return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(timestamp); }
function statusLabel(status: MissionSession["status"]): string {
  return ({ running: "En cours", completed: "Terminée", failed: "Erreur", permission_required: "Permission requise", cancelled: "Arrêtée", timed_out: "Délai dépassé", interrupted: "Interrompue" } as const)[status];
}
function phaseFor(status: MissionSession["status"]): Phase { return status === "completed" ? "done" : status; }
function modelLabel(model: UiRoutingDecision["modelName"]): string { return model.charAt(0).toUpperCase() + model.slice(1); }
function workflowLabel(workflow: UiRoutingDecision["workflow"]): string { return workflow === "single-agent" ? "Agent unique" : "Développement + revue"; }
function modeLabel(intent?: UiRoutingDecision["intent"]): string {
  if (!intent) return "—";
  return ({ discussion: "Conseil", ideation: "Idéation", planning: "Planification", analysis: "Analyse", implementation: "Implémentation", fix: "Correction", review: "Revue" } as const)[intent];
}
function resultLabel(result?: UiRoutingDecision["expectedResult"]): string {
  if (!result) return "—";
  return ({ "text-response": "Réponse textuelle", plan: "Plan", "project-changes": "Modifications projet", "review-report": "Rapport de revue" } as const)[result];
}
function sessionDecision(session?: MissionSession | null): UiRoutingDecision | undefined { return session?.executedDecision ?? session?.decision ?? session?.initialDecision; }
function sessionEvents(session: MissionSession): UiMissionEvent[] { return session.events.length ? session.events : session.liveEvents ?? session.technicalTrace?.events ?? []; }

function renderMarkdown(target: HTMLElement, markdown: string): void {
  const html = window.marked.parse(markdown, { gfm: true, breaks: false });
  target.innerHTML = window.DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button", "svg", "math"],
    FORBID_ATTR: ["style", "onclick", "onerror", "onload"],
  });
  for (const link of target.querySelectorAll<HTMLAnchorElement>("a")) {
    link.rel = "noreferrer noopener";
    link.addEventListener("click", (event) => event.preventDefault());
  }
}

function makeMessage(kind: MessageKind, title: string, content: string, at?: number): HTMLElement {
  const message = document.createElement("article"); message.className = "message message-" + kind;
  const heading = document.createElement("header");
  const label = document.createElement("strong"); label.textContent = title;
  const time = document.createElement("time"); time.textContent = dateLabel(at ?? Date.now());
  heading.append(label, time);
  const body = document.createElement("div"); body.className = "message-body";
  if (kind === "assistant") renderMarkdown(body, content); else body.textContent = content;
  message.append(heading, body); return message;
}

function eventSeverity(event: UiMissionEvent, status: MissionSession["status"]): "info" | "warning" | "error" {
  if (event.type === "terminal" && event.status === "failed") return "error";
  if (event.severity) return event.severity === "error" && status === "completed" ? "warning" : event.severity;
  return event.type === "error" ? "warning" : "info";
}

interface TechnicalItem { severity: "info" | "warning" | "error"; title: string; detail: string; count: number; }
function technicalItems(events: UiMissionEvent[], status: MissionSession["status"]): TechnicalItem[] {
  const items = new Map<string, TechnicalItem>();
  let websocketCount = 0; let skillCount = 0;
  for (const event of events) {
    if (event.type === "strategy" || event.type === "response" || (event.type === "terminal" && event.status === "completed")) continue;
    const content = [event.message, event.detail].filter(Boolean).join(" ");
    if (/websocket|reconnexion|reconnect|transport ws|connexion https/i.test(content)) { websocketCount += 1; continue; }
    if (/skill descriptions were shortened|skills context budget/i.test(content)) { skillCount += 1; continue; }
    const severity = eventSeverity(event, status);
    const title = event.message || (event.step ? "Étape " + event.step : "Événement");
    const detail = event.detail || "";
    const key = severity + "|" + title + "|" + detail;
    const existing = items.get(key);
    if (existing) existing.count += 1; else items.set(key, { severity, title, detail, count: 1 });
  }
  if (websocketCount) items.set("websocket", { severity: "warning", title: "Transport WebSocket indisponible", detail: "Connexion HTTPS utilisée automatiquement · Aucun impact sur la mission", count: websocketCount });
  if (skillCount) items.set("skills", { severity: "warning", title: "Descriptions de skills raccourcies", detail: "Contexte ajusté automatiquement · Aucun impact sur la mission", count: skillCount });
  return [...items.values()];
}

function buildProgress(events: UiMissionEvent[], status: MissionSession["status"]): HTMLElement {
  const card = document.createElement("section"); card.className = "mission-progress"; card.dataset.complete = String(status === "completed");
  const header = document.createElement("header");
  const title = document.createElement("strong"); title.textContent = "Smart Codex";
  const state = document.createElement("span"); state.textContent = statusLabel(status);
  header.append(title, state);
  const steps: Array<{ label: string; step: UiMissionEvent["step"] }> = [
    { label: "Préparation", step: "docs" }, { label: "Analyse", step: "files" }, { label: "Routage", step: "route" },
    { label: "Exécution", step: "execution" }, { label: "Validation", step: "tests" },
  ];
  const list = document.createElement("ol"); list.className = "progress-steps";
  const seen = new Set(events.map((event) => event.step).filter(Boolean));
  for (const step of steps) {
    const item = document.createElement("li");
    const done = status === "completed" || seen.has(step.step);
    item.dataset.state = done ? "done" : status === "running" ? "pending" : "skipped";
    item.textContent = step.label + (done ? " ✓" : ""); list.append(item);
  }
  card.append(header, list);
  const technical = technicalItems(events, status);
  if (technical.length) {
    const warnings = technical.filter((item) => item.severity === "warning").length;
    const errors = technical.filter((item) => item.severity === "error").length;
    const details = document.createElement("details"); details.className = "technical-log";
    const summary = document.createElement("summary");
    if (errors) summary.textContent = errors + " erreur" + (errors > 1 ? "s bloquantes" : " bloquante");
    else if (warnings) summary.textContent = warnings + " avertissement" + (warnings > 1 ? "s techniques" : " technique");
    else summary.textContent = "Journal technique";
    const entries = document.createElement("div"); entries.className = "technical-entries";
    for (const item of technical) {
      const row = document.createElement("div"); row.className = "technical-entry is-" + item.severity;
      const label = document.createElement("strong"); label.textContent = item.title + (item.count > 1 ? " ×" + item.count : "");
      const detail = document.createElement("span"); detail.textContent = item.detail;
      row.append(label, detail); entries.append(row);
    }
    details.append(summary, entries); card.append(details);
  }
  return card;
}

function scrollToLatest(force = false): void {
  if (!force && !autoScroll) { returnToResult.hidden = false; return; }
  programmaticScroll = true; conversation.scrollTop = conversation.scrollHeight; returnToResult.hidden = true;
  requestAnimationFrame(() => { programmaticScroll = false; });
}

function renderConversation(session: MissionSession, response = ""): void {
  const previousTop = conversation.scrollTop; const follow = autoScroll;
  conversation.replaceChildren();
  conversation.append(makeMessage("user", "Toi", session.request, session.createdAt));
  conversation.append(buildProgress(sessionEvents(session), session.status));
  const finalResponse = response || session.summary?.finalResponse || session.result?.finalResponse || "";
  if (finalResponse) conversation.append(makeMessage("assistant", "Codex", finalResponse, session.updatedAt));
  if (session.error && session.status !== "permission_required") conversation.append(makeMessage("error", "Erreur bloquante", session.error, session.updatedAt));
  if (follow) scrollToLatest(); else { conversation.scrollTop = previousTop; returnToResult.hidden = !finalResponse; }
}

function setProject(value: string): void {
  selectedProject = value; projectName.textContent = value ? projectLabel(value) : "Aucun projet";
  projectPath.textContent = value || "Choisir un dossier projet"; projectPath.title = value;
  contextProject.textContent = value ? projectLabel(value) : "Aucun projet"; contextPath.textContent = value || "—";
  if (value) localStorage.setItem("smart-codex.project", value);
}

function setPhase(phase: Phase): void {
  document.body.dataset.phase = phase;
  const running = phase === "running"; const busy = running || phase === "routing";
  launchButton.disabled = busy; promptInput.disabled = busy; chooseProject.disabled = busy; stopButton.hidden = !running;
  launchLabel.textContent = phase === "routing" ? "Luna analyse…" : "Analyser la mission";
  appStatus.className = "app-status is-" + phase;
  appStatus.querySelector("span")!.textContent = ({ idle: "Prêt", routing: "Routage Luna", review: "À valider", running: "Exécution", done: "Terminée", failed: "Erreur", permission_required: "Permission", cancelled: "Arrêtée", timed_out: "Délai dépassé", interrupted: "Interrompue" } as const)[phase];
}

function clearProposal(): void {
  pendingProposal = null; routingProposal.hidden = true;
  proposalModel.disabled = true; proposalReasoning.disabled = true; proposalWorkflow.disabled = true; proposalPermissions.disabled = true;
  modifyRoute.textContent = "Modifier";
}
function renderProposal(proposal: UiRoutingProposal): void {
  pendingProposal = proposal;
  const decision = proposal.decision;
  routingProposal.hidden = false; proposalGrid.hidden = false; modifyRoute.hidden = false;
  proposalTitle.textContent = modelLabel(decision.modelName); proposalModel.value = decision.modelName;
  proposalIntent.textContent = modeLabel(decision.intent); proposalResult.textContent = resultLabel(decision.expectedResult);
  proposalReasoning.value = decision.reasoning; proposalWorkflow.value = decision.workflow;
  proposalPermissions.value = decision.permissions; proposalUncertainty.textContent = decision.uncertainty;
  proposalReason.textContent = decision.reason;
  proposalUnknowns.hidden = decision.unknowns.length === 0;
  proposalUnknowns.textContent = decision.unknowns.length ? "Inconnues : " + decision.unknowns.join(" · ") : "";
  confirmationNote.hidden = !decision.requiresConfirmation; confirmLaunch.hidden = false;
  confirmLaunch.textContent = decision.requiresConfirmation ? "Confirmer et lancer" : decision.expectedResult === "project-changes" ? "Lancer" : "Demander à Codex";
  proposalObservation.hidden = proposal.remainingObservations === 0;
  proposalObservation.textContent = "Observation " + proposal.observationIndex + "/20";
  renderDecision(decision); setPhase("review");
}

function renderDecision(decision?: UiRoutingDecision): void {
  if (!decision) {
    contextMode.textContent = "—"; contextAccess.textContent = "—"; contextResult.textContent = "—";
    strategyMain.textContent = "En attente"; strategySub.textContent = "—";
    strategyDetailsToggle.hidden = true; strategyDetails.hidden = true; return;
  }
  const model = decision.model.replace("gpt-5.6-", "");
  contextMode.textContent = modeLabel(decision.intent);
  contextAccess.textContent = decision.permissions === "read-only" ? "Lecture seule" : "Écriture projet";
  contextResult.textContent = resultLabel(decision.expectedResult);
  strategyMain.textContent = model.charAt(0).toUpperCase() + model.slice(1) + " · " + decision.reasoning;
  strategySub.textContent = workflowLabel(decision.workflow);
  const details = [decision.reason, ...decision.unknowns.map((unknown) => "Inconnu : " + unknown)];
  strategyDetails.replaceChildren(...details.map((reason) => {
    const line = document.createElement("p"); line.textContent = reason; return line;
  }));
  strategyDetailsToggle.hidden = details.length === 0;
}

function renderContext(session?: MissionSession | null): void {
  const source = session?.projectPath ?? selectedProject; const decision = sessionDecision(session);
  contextProject.textContent = source ? projectLabel(source) : "Aucun projet"; contextPath.textContent = source || "—";
  contextStatus.textContent = session ? statusLabel(session.status) : "Prête";
  const duration = session?.outcome?.durationMs ?? session?.durationMs;
  contextDuration.textContent = duration ? durationLabel(duration) : session?.status === "running" ? "En cours" : "—";
  const validations = session?.outcome?.validations;
  contextValidation.textContent = validations ? (validations.tests.run + validations.build.run) + " commande(s)" : decision?.expectedResult === "project-changes" ? "En attente" : "Non requise";
  const files = session?.outcome?.filesModified ?? session?.result?.changes.length;
  contextFiles.textContent = decision?.expectedResult !== "project-changes" ? "Aucune demandée" : files === undefined ? "En attente" : String(files);
  contextLines.textContent = session?.outcome ? "+" + session.outcome.linesAdded + " / −" + session.outcome.linesDeleted : "—";
  renderDecision(decision);
}

function relativeGroup(timestamp: number): string {
  const day = new Date(timestamp); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const delta = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  return delta === 0 ? "Aujourd’hui" : delta === 1 ? "Hier" : "Plus tôt";
}
function renderHistory(): void {
  historyList.replaceChildren();
  const groups = new Map<string, MissionSession[]>();
  for (const session of sessions) {
    const group = relativeGroup(session.createdAt); groups.set(group, [...(groups.get(group) ?? []), session]);
  }
  for (const [label, items] of groups) {
    const heading = document.createElement("h2"); heading.textContent = label; historyList.append(heading);
    for (const session of items) {
      const button = document.createElement("button"); button.type = "button"; button.className = "history-item";
      button.dataset.active = String(session.id === activeSessionId);
      const title = document.createElement("strong"); title.textContent = session.title;
      const meta = document.createElement("span"); meta.textContent = projectLabel(session.projectPath) + " · " + statusLabel(session.status);
      button.append(title, meta); button.addEventListener("click", () => void openSession(session.id)); historyList.append(button);
    }
  }
  if (!sessions.length) {
    const empty = document.createElement("p"); empty.className = "history-empty";
    empty.textContent = "Tes missions récentes apparaîtront ici."; historyList.append(empty);
  }
}

function showNewMission(): void {
  activeSession = null; activeSessionId = ""; runningEvents = []; liveResponse = ""; autoScroll = true;
  clearProposal(); emptyState.hidden = false; missionView.hidden = true; permissionCard.hidden = true; returnToResult.hidden = true;
  setPhase("idle"); renderContext(); renderHistory(); promptInput.focus();
}
function renderSession(session: MissionSession): void {
  activeSession = session; activeSessionId = session.id; runningEvents = [...sessionEvents(session)];
  liveResponse = session.summary?.finalResponse ?? session.result?.finalResponse ?? "";
  emptyState.hidden = true; missionView.hidden = false; permissionCard.hidden = true;
  missionProject.textContent = projectLabel(session.projectPath); missionTitle.textContent = session.title;
  const duration = session.outcome?.durationMs ?? session.durationMs;
  missionMeta.textContent = statusLabel(session.status) + (duration ? " · " + durationLabel(duration) : "");
  setProject(session.projectPath); setPhase(phaseFor(session.status)); renderContext(session); renderHistory(); renderConversation(session, liveResponse);
  if (session.status === "permission_required") {
    permissionMessage.textContent = session.error ?? "Codex a demandé un accès d’écriture."; permissionCard.hidden = false;
  }
}

async function refreshHistory(): Promise<void> { sessions = await window.smartCodex.listSessions(); renderHistory(); }
async function openSession(id: string): Promise<void> { const session = await window.smartCodex.getSession(id); if (session) renderSession(session); }
function autosizePrompt(): void { promptInput.style.height = "auto"; promptInput.style.height = Math.min(280, Math.max(128, promptInput.scrollHeight)) + "px"; }
async function pickProject(): Promise<void> {
  const selected = await window.smartCodex.selectProject();
  if (selected) { setProject(selected); clearProposal(); }
}

async function prepareMission(): Promise<void> {
  const request = promptInput.value.trim();
  if (!selectedProject) { projectPath.textContent = "Choisis d’abord le dossier projet"; return; }
  if (!request) { promptInput.focus(); return; }
  clearProposal(); setPhase("routing");
  try { renderProposal(await window.smartCodex.decide({ request, projectPath: selectedProject })); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    routingProposal.hidden = false; proposalTitle.textContent = "Routage impossible"; proposalReason.textContent = message;
    proposalGrid.hidden = true; modifyRoute.hidden = true;
    confirmationNote.hidden = true; confirmLaunch.hidden = true; setPhase("failed");
  }
}

async function executeProposal(permissionsOverride?: "read-only" | "workspace-write"): Promise<void> {
  if (!pendingProposal) { await prepareMission(); return; }
  const request = promptInput.value.trim();
  if (permissionsOverride) proposalPermissions.value = permissionsOverride;
  emptyState.hidden = true; missionView.hidden = false; permissionCard.hidden = true;
  activeSessionId = ""; runningEvents = []; runningStartedAt = Date.now(); liveResponse = ""; autoScroll = true;
  const decision = {
    ...pendingProposal.decision,
    modelName: proposalModel.value as UiRoutingDecision["modelName"],
    reasoning: proposalReasoning.value as UiRoutingDecision["reasoning"],
    workflow: proposalWorkflow.value as UiRoutingDecision["workflow"],
    permissions: proposalPermissions.value as UiRoutingDecision["permissions"],
  };
  activeSession = {
    id: "pending", title: request.slice(0, 52), request, projectPath: selectedProject, status: "running",
    createdAt: runningStartedAt, updatedAt: runningStartedAt, initialDecision: pendingProposal.decision,
    executedDecision: decision, decision, events: [],
  };
  missionProject.textContent = projectLabel(selectedProject); missionTitle.textContent = activeSession.title;
  missionMeta.textContent = "En cours"; renderContext(activeSession); renderConversation(activeSession); setPhase("running");
  try {
    const response = await window.smartCodex.run({
      request, projectPath: selectedProject, proposalId: pendingProposal.proposalId,
      modelName: proposalModel.value as UiRoutingDecision["modelName"],
      reasoning: proposalReasoning.value as UiRoutingDecision["reasoning"],
      workflow: proposalWorkflow.value as UiRoutingDecision["workflow"],
      permissions: proposalPermissions.value as UiRoutingDecision["permissions"], confirmed: true,
    });
    const saved = await window.smartCodex.getSession(response.sessionId);
    pendingProposal = null; await refreshHistory(); if (saved) renderSession(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!activeSessionId && activeSession) {
      activeSession.status = "failed"; activeSession.error = message; renderConversation(activeSession); setPhase("failed");
    }
    await refreshHistory();
  }
}

async function stopMission(): Promise<void> {
  stopButton.disabled = true; stopButton.textContent = "Arrêt…";
  try { await window.smartCodex.stop(); } finally { stopButton.disabled = false; stopButton.textContent = "Arrêter"; }
}

function handleMissionEvent(event: UiMissionEvent): void {
  if (!activeSessionId && event.sessionId) {
    activeSessionId = event.sessionId;
    if (activeSession) activeSession.id = event.sessionId;
    void refreshHistory();
  }
  if (event.sessionId !== activeSessionId || !activeSession) return;
  if (event.type === "response") liveResponse = event.message ?? liveResponse; else runningEvents.push(event);
  activeSession.events = [...runningEvents]; activeSession.updatedAt = event.at ?? Date.now();
  if (event.type === "strategy" && event.decision) {
    activeSession.executedDecision = event.decision; activeSession.decision = event.decision;
  }
  if (event.type === "terminal") {
    activeSession.status = event.status ?? "failed"; activeSession.durationMs = Date.now() - runningStartedAt;
    missionMeta.textContent = statusLabel(activeSession.status) + " · " + durationLabel(activeSession.durationMs);
    if (activeSession.status !== "completed" && event.message) activeSession.error = event.message;
    setPhase(phaseFor(activeSession.status));
    if (activeSession.status === "permission_required") {
      permissionMessage.textContent = event.message ?? "Une permission est nécessaire."; permissionCard.hidden = false;
    }
  }
  renderContext(activeSession); renderConversation(activeSession, liveResponse);
}

chooseProject.addEventListener("click", () => void pickProject());
newMissionButton.addEventListener("click", showNewMission);
launchButton.addEventListener("click", () => void prepareMission());
confirmLaunch.addEventListener("click", () => void executeProposal());
modifyRoute.addEventListener("click", () => {
  const editing = proposalModel.disabled;
  proposalModel.disabled = !editing; proposalReasoning.disabled = !editing;
  proposalWorkflow.disabled = !editing; proposalPermissions.disabled = !editing;
  modifyRoute.textContent = editing ? "Terminer" : "Modifier";
});
proposalModel.addEventListener("change", () => { proposalTitle.textContent = modelLabel(proposalModel.value as UiRoutingDecision["modelName"]); });
stopButton.addEventListener("click", () => void stopMission());
retryPermission.addEventListener("click", () => void executeProposal("workspace-write"));
showRequest.addEventListener("click", () => { promptInput.value = activeSession?.request ?? ""; showNewMission(); autosizePrompt(); });
strategyDetailsToggle.addEventListener("click", () => {
  strategyDetails.hidden = !strategyDetails.hidden;
  strategyDetailsToggle.textContent = strategyDetails.hidden ? "Voir les détails" : "Masquer les détails";
});
contextToggle.addEventListener("click", () => { document.body.classList.toggle("context-hidden"); });
returnToResult.addEventListener("click", () => { autoScroll = true; scrollToLatest(true); });
conversation.addEventListener("scroll", () => {
  if (programmaticScroll) return;
  autoScroll = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 90;
  returnToResult.hidden = autoScroll;
});
promptInput.addEventListener("input", () => { autosizePrompt(); if (pendingProposal) clearProposal(); });
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void prepareMission(); }
});
window.smartCodex.onMissionEvent(handleMissionEvent);

setProject(selectedProject); autosizePrompt(); showNewMission(); void refreshHistory();
