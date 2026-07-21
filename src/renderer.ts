import type { DesktopRoutingMode, MissionSession, UiMissionEvent, UiRoutingDecision, UiRoutingProposal } from "./electron-api.js";

type Phase = "idle" | "routing" | "review" | "running" | "done" | "failed" | "permission_required" | "cancelled" | "timed_out" | "interrupted";
type MessageKind = "user" | "assistant" | "error";
function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error("Élément introuvable : " + selector);
  return value;
}

const promptInput = element<HTMLTextAreaElement>("#prompt");
const chooseProject = element<HTMLButtonElement>("#choose-project");
const composerProject = element<HTMLButtonElement>("#composer-project");
const addContext = element<HTMLButtonElement>("#add-context");
const contextFileLabel = element<HTMLElement>("#context-file-label");
const composerProjectLabel = element<HTMLElement>("#composer-project-label");
const projectName = element<HTMLElement>("#project-name");
const projectPath = element<HTMLElement>("#project-path");
const launchButton = element<HTMLButtonElement>("#launch");
const launchLabel = element<HTMLElement>("#launch-label");
const composerHint = element<HTMLElement>("#composer-hint");
const routingPill = element<HTMLButtonElement>("#routing-pill");
const routingPillLabel = element<HTMLElement>("#routing-pill-label");
const routingPopover = element<HTMLElement>("#routing-popover");
const closeRoutingPopover = element<HTMLButtonElement>("#close-routing-popover");
const popoverModel = element<HTMLElement>("#popover-model");
const popoverReasoning = element<HTMLElement>("#popover-reasoning");
const popoverWorkflow = element<HTMLElement>("#popover-workflow");
const routingSummary = element<HTMLElement>(".routing-summary");
const routingModeLuna = element<HTMLButtonElement>("#routing-mode-luna");
const routingModeManual = element<HTMLButtonElement>("#routing-mode-manual");
const manualRoutingSettings = element<HTMLElement>("#manual-routing-settings");
const manualIntent = element<HTMLSelectElement>("#manual-intent");
const manualIntentButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-manual-intent]")];
const manualModel = element<HTMLSelectElement>("#manual-model");
const manualReasoning = element<HTMLSelectElement>("#manual-reasoning");
const manualWorkflow = element<HTMLSelectElement>("#manual-workflow");
const manualRoutingMatrix = element<HTMLElement>("#manual-routing-matrix");
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
const followUpForm = element<HTMLFormElement>("#follow-up-form");
const followUpPrompt = element<HTMLTextAreaElement>("#follow-up-prompt");
const followUpSend = element<HTMLButtonElement>("#follow-up-send");
const followUpIntent = element<HTMLSelectElement>("#follow-up-intent");
const followUpModel = element<HTMLSelectElement>("#follow-up-model");
const followUpReasoning = element<HTMLSelectElement>("#follow-up-reasoning");
const followUpWorkflow = element<HTMLSelectElement>("#follow-up-workflow");
const appStatus = element<HTMLElement>("#app-status");
const missionBeacon = element<HTMLElement>("#mission-beacon");
const beaconTitle = element<HTMLElement>("#beacon-title");
const beaconDetail = element<HTMLElement>("#beacon-detail");
const beaconDuration = element<HTMLElement>("#beacon-duration");
const closeBeacon = element<HTMLButtonElement>("#close-beacon");
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
const proposalRoutingLabel = element<HTMLElement>("#proposal-routing-label");
const proposalGrid = element<HTMLElement>(".proposal-grid");
const proposalObservation = element<HTMLElement>("#proposal-observation");
const proposalIntent = element<HTMLSelectElement>("#proposal-intent");
const proposalResult = element<HTMLElement>("#proposal-result");
const proposalModel = element<HTMLSelectElement>("#proposal-model");
const proposalReasoning = element<HTMLSelectElement>("#proposal-reasoning");
const proposalWorkflow = element<HTMLSelectElement>("#proposal-workflow");
const proposalPermissions = element<HTMLSelectElement>("#proposal-permissions");
const proposalRoutingMatrix = element<HTMLElement>("#proposal-routing-matrix");
const proposalUncertainty = element<HTMLElement>("#proposal-uncertainty");
const proposalReason = element<HTMLElement>("#proposal-reason");
const proposalSummary = element<HTMLElement>("#proposal-summary");
const proposalUnknowns = element<HTMLElement>("#proposal-unknowns");
const confirmationNote = element<HTMLElement>("#confirmation-note");
const modifyRoute = element<HTMLButtonElement>("#modify-route");
const confirmLaunch = element<HTMLButtonElement>("#confirm-launch");
const sidebarToggle = element<HTMLButtonElement>("#toggle-sidebar");
const technicalDrawer = element<HTMLElement>("#technical-drawer");
const technicalDrawerContent = element<HTMLElement>("#technical-drawer-content");
const drawerBackdrop = element<HTMLElement>("#drawer-backdrop");
const openTechnicalDrawer = element<HTMLButtonElement>("#open-technical-drawer");
const closeTechnicalDrawer = element<HTMLButtonElement>("#close-technical-drawer");

let selectedProject = localStorage.getItem("smart-codex.project") ?? "";
let selectedContextFiles: string[] = [];
let selectedRoutingMode: DesktopRoutingMode = "luna";
let sessions: MissionSession[] = [];
let activeSession: MissionSession | null = null;
let activeSessionId = "";
let activeClientRunId = "";
let runningEvents: UiMissionEvent[] = [];
let runningStartedAt = 0;
let liveResponse = "";
let pendingProposal: UiRoutingProposal | null = null;
const liveResponsesBySession = new Map<string, string>();
let autoScroll = true;
let programmaticScroll = false;
let beaconStartedAt = 0;
let beaconTick: number | undefined;
let beaconDismiss: number | undefined;
let renderManualMatrix = (): void => {};
let renderProposalMatrix = (): void => {};

const matrixModels = ["luna", "terra", "sol"] as const;
const matrixReasoning = ["low", "medium", "high", "xhigh"] as const;
const matrixReasoningLabels = ["Rapide", "Normal", "Profond", "Max"] as const;

function setupRoutingMatrix(container: HTMLElement, model: HTMLSelectElement, reasoning: HTMLSelectElement, workflow: HTMLSelectElement, onChange: () => void): () => void {
  const xAxis = document.createElement("div"); xAxis.className = "matrix-x-axis";
  const columnLabels = matrixModels.map((value) => { const label = document.createElement("span"); label.className = "matrix-header"; label.textContent = modelLabel(value); xAxis.append(label); return label; });
  const yAxis = document.createElement("div"); yAxis.className = "matrix-y-axis";
  const rowLabels = matrixReasoningLabels.map((value) => { const label = document.createElement("span"); label.className = "matrix-row-label"; label.textContent = value; yAxis.append(label); return label; });
  const surface = document.createElement("div"); surface.className = "matrix-surface";
  const cells = matrixReasoning.map((reasoningValue, reasoningIndex) => matrixModels.map((modelValue, modelIndex) => {
    const cell = document.createElement("div"); cell.className = "matrix-cell"; cell.dataset.modelIndex = String(modelIndex); cell.dataset.reasoningIndex = String(reasoningIndex);
    const orb = document.createElement("span"); orb.className = "matrix-orb"; orb.setAttribute("aria-hidden", "true");
    const label = document.createElement("span"); label.className = "matrix-cell-label";
    cell.append(orb, label); surface.append(cell); return { cell, label };
  }));
  const particles = document.createElement("div"); particles.className = "matrix-particles"; particles.setAttribute("aria-hidden", "true");
  [[10, 24], [24, 76], [41, 18], [63, 71], [78, 31], [91, 82]].forEach(([x, y], index) => {
    const particle = document.createElement("i"); particle.style.setProperty("--particle-x", x + "%"); particle.style.setProperty("--particle-y", y + "%"); particle.style.setProperty("--particle-delay", (-index * .37) + "s"); particles.append(particle);
  });
  const cursor = document.createElement("button"); cursor.type = "button"; cursor.className = "matrix-cursor"; cursor.setAttribute("aria-label", "Sélection du routage");
  const status = document.createElement("div"); status.className = "matrix-status";
  const workflowButton = document.createElement("button"); workflowButton.type = "button"; workflowButton.className = "matrix-workflow"; workflowButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>1 agent</span>';
  surface.append(particles, cursor); container.append(xAxis, yAxis, surface, status, workflowButton);
  const render = (): void => {
    const modelIndex = Math.max(0, matrixModels.indexOf(model.value as typeof matrixModels[number]));
    const reasoningIndex = Math.max(0, matrixReasoning.indexOf(reasoning.value as typeof matrixReasoning[number]));
    cursor.style.left = ((modelIndex + .5) / matrixModels.length * 100) + "%";
    cursor.style.top = ((reasoningIndex + .5) / matrixReasoning.length * 100) + "%";
    columnLabels.forEach((label, index) => label.classList.toggle("is-active", index === modelIndex));
    rowLabels.forEach((label, index) => label.classList.toggle("is-active", index === reasoningIndex));
    cells.flat().forEach(({ cell, label }) => {
      const cellModelIndex = Number(cell.dataset.modelIndex); const cellReasoningIndex = Number(cell.dataset.reasoningIndex);
      const selected = cellModelIndex === modelIndex && cellReasoningIndex === reasoningIndex;
      cell.classList.toggle("is-selected", selected);
      cell.classList.toggle("is-active-column", cellModelIndex === modelIndex);
      cell.classList.toggle("is-active-row", cellReasoningIndex === reasoningIndex);
      label.textContent = "";
    });
    const multi = workflow.value === "development-review";
    container.dataset.multi = String(multi);
    status.textContent = modelLabel(matrixModels[modelIndex] ?? "luna") + " · " + (matrixReasoningLabels[reasoningIndex] ?? "Rapide") + " · " + (multi ? "Multi-agent" : "Agent unique");
    workflowButton.querySelector("span")!.textContent = multi ? "2 agents" : "1 agent";
    workflowButton.dataset.active = String(multi);
    cursor.title = status.textContent;
    cursor.setAttribute("aria-label", status.textContent + ". Clic droit pour changer l’organisation.");
  };
  const selectAt = (event: PointerEvent): void => {
    if (model.disabled) return;
    const bounds = surface.getBoundingClientRect();
    const x = Math.min(.999, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(.999, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    model.value = matrixModels[Math.floor(x * matrixModels.length)] ?? "luna"; reasoning.value = matrixReasoning[Math.floor(y * matrixReasoning.length)] ?? "low";
    render(); onChange();
  };
  let dragging = false;
  surface.addEventListener("pointerdown", (event) => { if (event.button !== 0 || model.disabled) return; dragging = true; surface.setPointerCapture(event.pointerId); selectAt(event); });
  surface.addEventListener("pointermove", (event) => { if (dragging) selectAt(event); });
  surface.addEventListener("pointerup", (event) => { dragging = false; if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); });
  cursor.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); if (workflow.disabled) return; workflow.value = workflow.value === "single-agent" ? "development-review" : "single-agent"; render(); onChange(); });
  workflowButton.addEventListener("click", () => { if (workflow.disabled) return; workflow.value = workflow.value === "single-agent" ? "development-review" : "single-agent"; render(); onChange(); });
  container.addEventListener("keydown", (event) => {
    if (model.disabled) return;
    let x = matrixModels.indexOf(model.value as typeof matrixModels[number]); let y = matrixReasoning.indexOf(reasoning.value as typeof matrixReasoning[number]);
    if (event.key === "ArrowLeft") x = Math.max(0, x - 1); else if (event.key === "ArrowRight") x = Math.min(matrixModels.length - 1, x + 1); else if (event.key === "ArrowUp") y = Math.max(0, y - 1); else if (event.key === "ArrowDown") y = Math.min(matrixReasoning.length - 1, y + 1); else if (event.key.toLowerCase() === "m") workflow.value = workflow.value === "single-agent" ? "development-review" : "single-agent"; else return;
    event.preventDefault(); model.value = matrixModels[x] ?? "luna"; reasoning.value = matrixReasoning[y] ?? "low"; render(); onChange();
  });
  render(); return render;
}

function projectLabel(value: string): string { return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value; }
function durationLabel(milliseconds?: number): string {
  if (!milliseconds) return "—";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds < 60 ? seconds + " s" : Math.floor(seconds / 60) + " min " + (seconds % 60) + " s";
}
function compactDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function phaseStatusLabel(phase: Phase): string {
  return phase === "routing" && selectedRoutingMode === "manual" ? "Préparation manuelle" : ({ idle: "Prêt", routing: "Routage Luna", review: "À valider", running: "Exécution", done: "Terminée", failed: "Erreur", permission_required: "Permission", cancelled: "Arrêtée", timed_out: "Délai dépassé", interrupted: "Interrompue" } as const)[phase];
}
function renderAppStatus(phase: Phase, label = phaseStatusLabel(phase)): void {
  appStatus.className = "app-status is-" + phase;
  appStatus.querySelector("span")!.textContent = label;
}
function syncAppStatus(): void {
  const runningCount = sessions.filter((session) => session.status === "running").length;
  if (runningCount > 0) {
    renderAppStatus("running", runningCount + " mission" + (runningCount > 1 ? "s" : "") + " en cours");
    return;
  }
  renderAppStatus((document.body.dataset.phase as Phase | undefined) ?? "idle");
}
function stopBeaconTimers(): void {
  if (beaconTick !== undefined) window.clearInterval(beaconTick);
  if (beaconDismiss !== undefined) window.clearTimeout(beaconDismiss);
  beaconTick = undefined; beaconDismiss = undefined;
}
function hideMissionBeacon(): void {
  stopBeaconTimers(); missionBeacon.hidden = true; document.title = "Smart Codex"; syncAppStatus();
}
function showRunningBeacon(title: string, detail: string, startedAt = Date.now()): void {
  if (missionBeacon.dataset.state !== "running") beaconStartedAt = startedAt;
  stopBeaconTimers(); missionBeacon.hidden = false; missionBeacon.dataset.state = "running";
  beaconTitle.textContent = title; beaconDetail.textContent = detail; document.title = "● En cours — Smart Codex";
  const renderTime = (): void => { beaconDuration.textContent = compactDuration(Date.now() - beaconStartedAt); };
  renderTime(); beaconTick = window.setInterval(renderTime, 1000);
}
function showFinishedBeacon(status: MissionSession["status"], title: string, detail: string, duration?: number): void {
  stopBeaconTimers(); missionBeacon.hidden = false; missionBeacon.dataset.state = status === "completed" ? "done" : "error";
  beaconTitle.textContent = title; beaconDetail.textContent = detail; beaconDuration.textContent = duration ? compactDuration(duration) : "";
  document.title = status === "completed" ? "✓ Terminée — Smart Codex" : "! Attention — Smart Codex";
  renderAppStatus(status === "completed" ? "done" : phaseFor(status));
  beaconDismiss = window.setTimeout(hideMissionBeacon, 12_000);
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
function expectedResultForIntent(intent: UiRoutingDecision["intent"]): UiRoutingDecision["expectedResult"] {
  if (intent === "implementation" || intent === "fix") return "project-changes";
  if (intent === "planning") return "plan";
  if (intent === "review") return "review-report";
  return "text-response";
}
function setRoutingMode(mode: DesktopRoutingMode): void {
  selectedRoutingMode = mode; localStorage.setItem("smart-codex.routing-mode", mode);
  routingModeLuna.dataset.active = String(mode === "luna"); routingModeManual.dataset.active = String(mode === "manual");
  routingModeLuna.setAttribute("aria-checked", String(mode === "luna")); updateManualIntentButtons();
  routingSummary.hidden = mode === "manual";
  manualRoutingSettings.hidden = mode !== "manual";
  launchLabel.textContent = "Lancer";
  composerHint.textContent = "Ctrl + Entrée";
  updateRoutingPill();
  clearProposal();
}
function manualIntentLabel(intent: string): string { return intent === "discussion" ? "Ask" : intent === "planning" ? "Plan" : "Do"; }
function updateManualIntentButtons(): void {
  for (const button of manualIntentButtons) {
    const active = selectedRoutingMode === "manual" && button.dataset.manualIntent === manualIntent.value;
    button.dataset.active = String(active); button.setAttribute("aria-checked", String(active));
  }
}
function setManualIntent(intent: UiRoutingDecision["intent"]): void {
  manualIntent.value = intent;
  persistManualSettings(); setRoutingMode("manual");
}
function updateRoutingPill(decision?: UiRoutingDecision): void {
  const current = decision ?? pendingProposal?.decision;
  if (selectedRoutingMode === "manual") {
    routingSummary.hidden = true;
    routingPillLabel.textContent = manualIntentLabel(manualIntent.value) + " · " + modelLabel(manualModel.value as UiRoutingDecision["modelName"]) + " · " + (manualReasoning.options[manualReasoning.selectedIndex]?.text ?? manualReasoning.value);
    popoverModel.textContent = modelLabel(manualModel.value as UiRoutingDecision["modelName"]);
    popoverReasoning.textContent = manualReasoning.value;
    popoverWorkflow.textContent = workflowLabel(manualWorkflow.value as UiRoutingDecision["workflow"]);
    return;
  }
  if (current) {
    routingSummary.hidden = false;
    routingPillLabel.textContent = "Luna · " + modelLabel(current.modelName) + " · " + current.reasoning;
    popoverModel.textContent = modelLabel(current.modelName);
    popoverReasoning.textContent = current.reasoning;
    popoverWorkflow.textContent = workflowLabel(current.workflow);
    return;
  }
  routingPillLabel.textContent = "Luna automatique";
  routingSummary.hidden = true;
  popoverModel.textContent = "Luna choisit"; popoverReasoning.textContent = "selon la mission"; popoverWorkflow.textContent = "Agent adapté";
}
function toggleRoutingPopover(force?: boolean): void {
  const open = force ?? routingPopover.hidden;
  routingPopover.hidden = !open; routingPill.setAttribute("aria-expanded", String(open));
}
function persistManualSettings(): void {
  localStorage.setItem("smart-codex.manual-intent", manualIntent.value);
  localStorage.setItem("smart-codex.manual-model", manualModel.value);
  localStorage.setItem("smart-codex.manual-reasoning", manualReasoning.value);
  localStorage.setItem("smart-codex.manual-workflow", manualWorkflow.value);
}
function applyIntent(intent: UiRoutingDecision["intent"]): void {
  const result = expectedResultForIntent(intent);
  proposalPermissions.value = intent === "implementation" || intent === "fix" ? "workspace-write" : "read-only";
  proposalResult.textContent = resultLabel(result);
  if (pendingProposal) confirmLaunch.textContent = pendingProposal.decision.requiresConfirmation ? "Confirmer et lancer" : result === "project-changes" ? "Lancer" : "Demander à Codex";
}
function sessionDecision(session?: MissionSession | null): UiRoutingDecision | undefined { return session?.executedDecision ?? session?.decision ?? session?.initialDecision; }
function applyFollowUpDecision(decision?: UiRoutingDecision): void {
  if (!decision) return;
  followUpIntent.value = decision.intent;
  followUpModel.value = decision.modelName;
  followUpReasoning.value = decision.reasoning;
  followUpWorkflow.value = decision.workflow;
}
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
  const body = document.createElement(kind === "assistant" ? "div" : "p"); body.className = "message-body";
  if (kind === "assistant") renderMarkdown(body, content); else body.textContent = content;
  message.append(heading, body);
  return message;
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
  const steps: Array<{ label: string; matches: UiMissionEvent["step"][] }> = [
    { label: "Analyse", matches: ["docs", "files"] }, { label: "Routage", matches: ["route"] },
    { label: "Exécution", matches: ["execution"] }, { label: "Validation", matches: ["tests"] },
  ];
  const list = document.createElement("ol"); list.className = "progress-steps";
  const seen = new Set(events.map((event) => event.step).filter(Boolean));
  const latestStep = events.at(-1)?.step;
  const activeIndex = status === "running" ? Math.max(0, steps.findIndex((step) => step.matches.includes(latestStep))) : -1;
  for (const [index, step] of steps.entries()) {
    const item = document.createElement("li");
    const done = status === "completed" || (activeIndex >= 0 ? index < activeIndex : step.matches.some((match) => seen.has(match)));
    item.dataset.state = done ? "done" : index === activeIndex ? "active" : "pending";
    item.textContent = step.label + (done ? " ✓" : ""); list.append(item);
  }
  card.append(header, list);
  const latest = events.at(-1);
  const context = document.createElement("p"); context.className = "progress-context";
  const defaultMessage = latest?.step === "tests" ? "Validation des fichiers modifiés…" : latest?.step === "execution" ? "Terra prépare les modifications…" : latest?.step === "route" ? "Luna choisit la stratégie adaptée…" : "Luna analyse le périmètre de la mission…";
  context.textContent = status === "completed" ? "Mission terminée et résultat prêt." : status !== "running" ? "La mission s’est arrêtée avant sa validation." : latest?.message?.trim() || defaultMessage;
  card.append(context);
  return card;
}

function renderTechnicalDrawer(session: MissionSession | null): void {
  technicalDrawerContent.replaceChildren();
  if (!session) return;
  const decision = sessionDecision(session);
  const summary = document.createElement("dl"); summary.className = "drawer-summary";
  const fields: Array<[string, string]> = [["Modèle", decision ? modelLabel(decision.modelName) : "—"], ["Réflexion", decision?.reasoning ?? "—"], ["Workflow", decision ? workflowLabel(decision.workflow) : "—"], ["Accès", decision?.permissions === "workspace-write" ? "Écriture projet" : "Lecture seule"]];
  for (const [label, value] of fields) { const row = document.createElement("div"); const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; row.append(dt, dd); summary.append(row); }
  const entries = document.createElement("div"); entries.className = "technical-entries";
  for (const item of technicalItems(sessionEvents(session), session.status)) { const row = document.createElement("div"); row.className = "technical-entry is-" + item.severity; const label = document.createElement("strong"); label.textContent = item.title + (item.count > 1 ? " ×" + item.count : ""); const detail = document.createElement("span"); detail.textContent = item.detail || "Étape enregistrée"; row.append(label, detail); entries.append(row); }
  if (!entries.childElementCount) { const empty = document.createElement("p"); empty.className = "drawer-empty"; empty.textContent = "Aucun événement technique détaillé pour cette mission."; entries.append(empty); }
  technicalDrawerContent.append(summary, entries);
}

function toggleTechnicalDrawer(open: boolean): void { technicalDrawer.hidden = !open; drawerBackdrop.hidden = !open; document.body.classList.toggle("drawer-open", open); if (open) renderTechnicalDrawer(activeSession); }

function scrollToLatest(force = false): void {
  if (!force && !autoScroll) { returnToResult.hidden = false; return; }
  programmaticScroll = true; conversation.scrollTop = conversation.scrollHeight; returnToResult.hidden = true;
  requestAnimationFrame(() => { programmaticScroll = false; });
}

function renderConversation(session: MissionSession, response = ""): void {
  const previousTop = conversation.scrollTop; const follow = autoScroll;
  conversation.replaceChildren();
  const messages = session.messages?.length
    ? session.messages
    : [{ role: "user" as const, content: session.request, at: session.createdAt }, ...(response ? [{ role: "assistant" as const, content: response, at: session.updatedAt }] : [])];
  for (const message of messages) conversation.append(makeMessage(message.role, message.role === "user" ? "Toi" : "Codex", message.content, message.at));
  conversation.append(buildProgress(sessionEvents(session), session.status));
  if (session.error && session.status !== "permission_required") conversation.append(makeMessage("error", "Erreur bloquante", session.error, session.updatedAt));
  if (follow) scrollToLatest(); else { conversation.scrollTop = previousTop; returnToResult.hidden = !messages.some((message) => message.role === "assistant"); }
}

function setProject(value: string): void {
  if (value !== selectedProject) { selectedContextFiles = []; updateContextFiles(); }
  selectedProject = value; projectName.textContent = value ? projectLabel(value) : "Aucun projet";
  projectPath.textContent = value || "Choisir un dossier projet"; projectPath.title = value;
  composerProjectLabel.textContent = value ? projectLabel(value) : "Choisir un projet";
  contextProject.textContent = value ? projectLabel(value) : "Aucun projet"; contextPath.textContent = value || "—";
  if (value) localStorage.setItem("smart-codex.project", value);
}
function updateContextFiles(): void {
  contextFileLabel.textContent = selectedContextFiles.length ? `Contexte (${selectedContextFiles.length})` : "Contexte";
  addContext.title = selectedContextFiles.length ? selectedContextFiles.map((filePath) => filePath.split(/[\\/]/).pop()).join(" · ") : "Ajouter des fichiers de contexte";
}
async function pickContextFiles(): Promise<void> {
  if (!selectedProject) { projectPath.textContent = "Choisis d’abord le dossier projet"; return; }
  const selected = await window.smartCodex.selectContextFiles(selectedProject);
  if (!selected.length) return;
  selectedContextFiles = selected; updateContextFiles(); clearProposal();
}

function setPhase(phase: Phase): void {
  document.body.dataset.phase = phase;
  const running = phase === "running"; const busy = running || phase === "routing";
  launchButton.disabled = busy; promptInput.disabled = busy; chooseProject.disabled = busy; stopButton.hidden = !running;
  routingModeLuna.disabled = busy; routingModeManual.disabled = busy;
  for (const select of [manualIntent, manualModel, manualReasoning, manualWorkflow]) select.disabled = busy;
  for (const button of manualIntentButtons) button.disabled = busy;
  followUpPrompt.disabled = busy; followUpSend.disabled = busy;
  for (const select of [followUpIntent, followUpModel, followUpReasoning, followUpWorkflow]) select.disabled = busy;
  launchLabel.textContent = phase === "routing" ? "…" : "Lancer";
  renderAppStatus(phase);
  if (phase === "routing") showRunningBeacon("Luna prépare la mission", "Choix de la meilleure configuration", Date.now());
  else if (phase === "running") showRunningBeacon("Mission en cours", activeSession?.title ?? "Codex travaille", runningStartedAt || Date.now());
  else if (phase === "idle" || phase === "review") hideMissionBeacon();
  else if (phase !== "done") showFinishedBeacon(phase as MissionSession["status"], ({ failed: "Mission en erreur", permission_required: "Permission requise", cancelled: "Mission arrêtée", timed_out: "Délai dépassé", interrupted: "Mission interrompue" } as const)[phase], activeSession?.title ?? "La mission n’a pas pu continuer");
}

function clearProposal(): void {
  pendingProposal = null; routingProposal.hidden = true;
  routingProposal.classList.remove("is-editing");
  proposalIntent.disabled = true; proposalModel.disabled = true; proposalReasoning.disabled = true; proposalWorkflow.disabled = true; proposalPermissions.disabled = true;
  modifyRoute.textContent = "Ajuster";
  updateRoutingPill();
}
function renderProposal(proposal: UiRoutingProposal): void {
  pendingProposal = proposal;
  const decision = proposal.decision;
  routingProposal.hidden = false; routingProposal.classList.remove("is-editing"); proposalGrid.hidden = false; modifyRoute.hidden = false;
  proposalRoutingLabel.textContent = proposal.routingMode === "manual" ? "CONFIGURATION MANUELLE" : "LUNA AUTOMATIQUE";
  proposalTitle.textContent = "Mission comprise"; proposalModel.value = decision.modelName;
  proposalSummary.textContent = promptInput.value.trim().replace(/\s+/g, " ").slice(0, 220) + (promptInput.value.trim().length > 220 ? "…" : "");
  proposalIntent.value = decision.intent; proposalResult.textContent = resultLabel(decision.expectedResult);
  proposalReasoning.value = decision.reasoning; proposalWorkflow.value = decision.workflow;
  renderProposalMatrix();
  proposalPermissions.value = decision.permissions; proposalUncertainty.textContent = decision.uncertainty;
  proposalReason.textContent = modeLabel(decision.intent) + " avec " + modelLabel(decision.modelName) + ", réflexion " + decision.reasoning + ", " + workflowLabel(decision.workflow).toLocaleLowerCase("fr-FR") + ".";
  proposalUnknowns.hidden = decision.unknowns.length === 0;
  proposalUnknowns.textContent = decision.unknowns.length ? "Inconnues : " + decision.unknowns.join(" · ") : "";
  confirmationNote.hidden = !decision.requiresConfirmation; confirmLaunch.hidden = false;
  confirmLaunch.textContent = decision.requiresConfirmation ? "Confirmer et lancer" : "Lancer la mission";
  proposalObservation.hidden = proposal.routingMode === "manual" || proposal.remainingObservations === 0;
  proposalObservation.textContent = "Observation " + proposal.observationIndex + "/20";
  if (proposal.routingMode === "manual") {
    proposalIntent.disabled = false; proposalModel.disabled = false; proposalReasoning.disabled = false; proposalWorkflow.disabled = false; proposalPermissions.disabled = false;
    modifyRoute.hidden = true;
  }
  updateRoutingPill(decision); toggleRoutingPopover(false); renderDecision(decision); setPhase("review");
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
  if (session?.experimentalRouting?.suggestion) {
    const shadow = session.experimentalRouting.suggestion;
    const executed = session.executedDecision;
    const modelCost = executed?.modelName === "luna" ? 10 : executed?.modelName === "terra" ? 20 : 30;
    const reasoningCost = executed?.reasoning === "low" ? 3 : executed?.reasoning === "medium" ? 6 : executed?.reasoning === "high" ? 9 : 12;
    const workflowCost = executed?.workflow === "development-review" ? 8 : 0;
    const difference = executed ? shadow.costIndex - modelCost - reasoningCost - workflowCost : 0;
    const line = document.createElement("p");
    line.textContent = `Suggestion expérimentale : ${shadow.modelName} ${shadow.reasoning} · coût relatif ${difference >= 0 ? "+" : ""}${difference} · confiance ${shadow.confidence}. ${shadow.reason}`;
    strategyDetails.append(line);
    strategyDetailsToggle.hidden = false;
  } else if (session?.experimentalRouting?.error) {
    const line = document.createElement("p"); line.textContent = "Suggestion expérimentale indisponible : " + session.experimentalRouting.error;
    strategyDetails.append(line); strategyDetailsToggle.hidden = false;
  }
}

function relativeGroup(timestamp: number): string {
  const day = new Date(timestamp); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const delta = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  return delta === 0 ? "Aujourd’hui" : delta === 1 ? "Hier" : delta < 7 ? "Cette semaine" : "Plus tôt";
}
function renderHistory(): void {
  historyList.replaceChildren();
  syncAppStatus();
  const groups = new Map<string, MissionSession[]>();
  for (const session of sessions) {
    const group = relativeGroup(session.createdAt); groups.set(group, [...(groups.get(group) ?? []), session]);
  }
  for (const [label, items] of groups) {
    const heading = document.createElement("h2"); heading.textContent = label; historyList.append(heading);
    for (const session of items) {
      const row = document.createElement("div"); row.className = "history-row";
      const button = document.createElement("button"); button.type = "button"; button.className = "history-item";
      button.dataset.active = String(session.id === activeSessionId);
      const title = document.createElement("strong"); title.textContent = session.title;
      const meta = document.createElement("span"); meta.className = "history-meta"; meta.dataset.status = session.status; meta.textContent = projectLabel(session.projectPath) + " · " + statusLabel(session.status);
      button.append(title, meta); button.addEventListener("click", () => void openSession(session.id));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button"; deleteButton.className = "history-delete"; deleteButton.textContent = "×";
      deleteButton.title = "Supprimer cette conversation"; deleteButton.setAttribute("aria-label", "Supprimer cette conversation");
      deleteButton.disabled = session.status === "running";
      deleteButton.addEventListener("click", (event) => { event.stopPropagation(); void deleteSession(session); });
      row.append(button, deleteButton); historyList.append(row);
    }
  }
  if (!sessions.length) {
    const empty = document.createElement("p"); empty.className = "history-empty";
    empty.textContent = "Tes missions récentes apparaîtront ici."; historyList.append(empty);
  }
}

function showNewMission(): void {
  activeSession = null; activeSessionId = ""; activeClientRunId = ""; runningEvents = []; liveResponse = ""; autoScroll = true;
  clearProposal(); emptyState.hidden = false; missionView.hidden = true; permissionCard.hidden = true; followUpForm.hidden = true; returnToResult.hidden = true;
  toggleRoutingPopover(false); toggleTechnicalDrawer(false); setPhase("idle"); renderContext(); renderHistory(); promptInput.focus();
}
function renderSession(session: MissionSession): void {
  activeSession = session; activeSessionId = session.id; runningEvents = [...sessionEvents(session)];
  activeClientRunId = "";
  liveResponse = liveResponsesBySession.get(session.id) ?? session.summary?.finalResponse ?? session.result?.finalResponse ?? "";
  emptyState.hidden = true; missionView.hidden = false; permissionCard.hidden = true;
  missionProject.textContent = projectLabel(session.projectPath); missionTitle.textContent = session.title;
  const duration = session.outcome?.durationMs ?? session.durationMs;
  missionMeta.textContent = statusLabel(session.status) + (duration ? " · " + durationLabel(duration) : "");
  setProject(session.projectPath); setPhase(phaseFor(session.status)); renderContext(session); renderHistory(); renderConversation(session, liveResponse);
  applyFollowUpDecision(sessionDecision(session));
  followUpForm.hidden = session.status === "running" || !session.threadId;
  if (session.status === "permission_required") {
    permissionMessage.textContent = session.error ?? "Codex a demandé un accès d’écriture."; permissionCard.hidden = false;
  }
}

async function refreshHistory(): Promise<void> { sessions = await window.smartCodex.listSessions(); renderHistory(); }
async function openSession(id: string): Promise<void> {
  const session = await window.smartCodex.getSession(id);
  const live = sessions.find((candidate) => candidate.id === id);
  if (session && live?.status === "running") {
    session.status = "running"; session.events = [...sessionEvents(live)];
    const executedDecision = live.executedDecision ?? session.executedDecision;
    const decision = live.decision ?? session.decision;
    if (executedDecision) session.executedDecision = executedDecision;
    if (decision) session.decision = decision;
  }
  if (session) renderSession(session);
}
async function deleteSession(session: MissionSession): Promise<void> {
  if (session.status === "running") return;
  const confirmed = window.confirm(`Supprimer la conversation « ${session.title} » ? Cette action est définitive.`);
  if (!confirmed) return;
  try {
    await window.smartCodex.deleteSession(session.id);
    if (activeSessionId === session.id) showNewMission();
    sessions = sessions.filter((candidate) => candidate.id !== session.id);
    renderHistory();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}
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
  try {
    renderProposal(await window.smartCodex.decide({
      request, projectPath: selectedProject, contextFiles: selectedContextFiles, routingMode: selectedRoutingMode,
      ...(selectedRoutingMode === "manual" ? { manualDecision: {
        intent: manualIntent.value as UiRoutingDecision["intent"],
        modelName: manualModel.value as UiRoutingDecision["modelName"],
        reasoning: manualReasoning.value as UiRoutingDecision["reasoning"],
        workflow: manualWorkflow.value as UiRoutingDecision["workflow"],
      } } : {}),
    }));
  }
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
  activeClientRunId = crypto.randomUUID();
  const decision = {
    ...pendingProposal.decision,
    intent: proposalIntent.value as UiRoutingDecision["intent"],
    modelName: proposalModel.value as UiRoutingDecision["modelName"],
    reasoning: proposalReasoning.value as UiRoutingDecision["reasoning"],
    workflow: proposalWorkflow.value as UiRoutingDecision["workflow"],
    permissions: proposalPermissions.value as UiRoutingDecision["permissions"],
    expectedResult: expectedResultForIntent(proposalIntent.value as UiRoutingDecision["intent"]),
  };
  activeSession = {
    id: "pending", title: request.slice(0, 52), request, projectPath: selectedProject, status: "running",
    createdAt: runningStartedAt, updatedAt: runningStartedAt, initialDecision: pendingProposal.decision,
    executedDecision: decision, decision, events: [], messages: [{ role: "user", content: request, at: runningStartedAt }],
  };
  const launchedSession = activeSession;
  missionProject.textContent = projectLabel(selectedProject); missionTitle.textContent = activeSession.title;
  missionMeta.textContent = "En cours"; followUpForm.hidden = true; renderContext(activeSession); renderConversation(activeSession); setPhase("running");
  try {
    const response = await window.smartCodex.run({
      request, projectPath: selectedProject, contextFiles: selectedContextFiles, proposalId: pendingProposal.proposalId, clientRunId: activeClientRunId,
      intent: proposalIntent.value as UiRoutingDecision["intent"],
      modelName: proposalModel.value as UiRoutingDecision["modelName"],
      reasoning: proposalReasoning.value as UiRoutingDecision["reasoning"],
      workflow: proposalWorkflow.value as UiRoutingDecision["workflow"],
      permissions: proposalPermissions.value as UiRoutingDecision["permissions"], confirmed: true,
    });
    const saved = await window.smartCodex.getSession(response.sessionId);
    pendingProposal = null; await refreshHistory();
    if (saved && (activeSession === launchedSession || activeSessionId === saved.id)) renderSession(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!launchedSession.id || launchedSession.id === "pending") {
      launchedSession.status = "failed"; launchedSession.error = message;
      if (activeSession === launchedSession) { renderConversation(launchedSession); setPhase("failed"); }
    }
    await refreshHistory();
  }
}

async function continueSession(): Promise<void> {
  const message = followUpPrompt.value.trim();
  if (!message || !activeSession || !activeSession.threadId || activeSession.status === "running") return;
  const sentAt = Date.now();
  activeSession.messages = [...(activeSession.messages ?? []), { role: "user", content: message, at: sentAt }];
  activeSession.status = "running"; activeSession.error = undefined; runningStartedAt = sentAt; runningEvents = [];
  liveResponse = ""; autoScroll = true; followUpPrompt.value = ""; followUpForm.hidden = true;
  missionMeta.textContent = "En cours"; setPhase("running"); renderContext(activeSession); renderConversation(activeSession);
  try {
    const response = await window.smartCodex.continueSession({ sessionId: activeSession.id, message, manualDecision: {
      intent: followUpIntent.value as UiRoutingDecision["intent"],
      modelName: followUpModel.value as UiRoutingDecision["modelName"],
      reasoning: followUpReasoning.value as UiRoutingDecision["reasoning"],
      workflow: followUpWorkflow.value as UiRoutingDecision["workflow"],
    } });
    const saved = await window.smartCodex.getSession(response.sessionId);
    await refreshHistory(); if (saved) renderSession(saved);
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    activeSession.status = "failed"; activeSession.error = failure; setPhase("failed"); renderConversation(activeSession); followUpForm.hidden = false;
    await refreshHistory();
  }
}

async function stopMission(): Promise<void> {
  if (!activeSessionId) return;
  stopButton.disabled = true; stopButton.textContent = "Arrêt…";
  try { await window.smartCodex.stop(activeSessionId); } finally { stopButton.disabled = false; stopButton.textContent = "Arrêter"; }
}

function handleMissionEvent(event: UiMissionEvent): void {
  if (!activeSessionId && event.sessionId && activeSession && event.clientRunId === activeClientRunId) {
    activeSessionId = event.sessionId;
    if (activeSession) activeSession.id = event.sessionId;
    void refreshHistory();
  }
  if (!event.sessionId) return;
  const historySession = sessions.find((session) => session.id === event.sessionId);
  if (historySession) {
    historySession.updatedAt = event.at ?? Date.now();
    if (event.type === "response" && event.message) liveResponsesBySession.set(event.sessionId, event.message);
    else historySession.events = [...sessionEvents(historySession), event];
    if (event.type === "strategy" && event.decision) { historySession.executedDecision = event.decision; historySession.decision = event.decision; }
    if (event.type === "terminal") { historySession.status = event.status ?? "failed"; if (event.status !== "completed" && event.message) historySession.error = event.message; setTimeout(() => void refreshHistory(), 0); }
    renderHistory();
  } else { void refreshHistory(); }
  if (event.sessionId !== activeSessionId || !activeSession) {
    if (event.type === "terminal") {
      const status = event.status ?? "failed";
      showFinishedBeacon(status, status === "completed" ? "Mission terminée" : statusLabel(status), historySession?.title ?? "Mission terminée");
    } else if (event.message && event.type !== "strategy" && event.type !== "response") {
      showRunningBeacon("Mission en cours", event.message, historySession?.createdAt ?? Date.now());
    }
    return;
  }
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
    showFinishedBeacon(activeSession.status, activeSession.status === "completed" ? "Mission terminée" : statusLabel(activeSession.status), activeSession.title, activeSession.durationMs);
    followUpForm.hidden = !activeSession.threadId;
    if (activeSession.status === "permission_required") {
      permissionMessage.textContent = event.message ?? "Une permission est nécessaire."; permissionCard.hidden = false;
    }
  }
  else if (event.message && event.type !== "strategy" && event.type !== "response") showRunningBeacon("Mission en cours", event.message, runningStartedAt || activeSession.createdAt);
  renderContext(activeSession); renderConversation(activeSession, liveResponse);
}

chooseProject.addEventListener("click", () => void pickProject());
composerProject.addEventListener("click", () => void pickProject());
addContext.addEventListener("click", () => void pickContextFiles());
routingPill.addEventListener("click", () => toggleRoutingPopover());
closeRoutingPopover.addEventListener("click", () => toggleRoutingPopover(false));
closeBeacon.addEventListener("click", hideMissionBeacon);
routingModeLuna.addEventListener("click", () => setRoutingMode("luna"));
routingModeManual.addEventListener("click", () => setRoutingMode("manual"));
[manualIntent, manualModel, manualReasoning, manualWorkflow].forEach((select) => select.addEventListener("change", () => { persistManualSettings(); updateRoutingPill(); }));
manualIntentButtons.forEach((button) => button.addEventListener("click", () => setManualIntent(button.dataset.manualIntent as UiRoutingDecision["intent"])));
newMissionButton.addEventListener("click", showNewMission);
launchButton.addEventListener("click", () => void prepareMission());
confirmLaunch.addEventListener("click", () => void executeProposal());
modifyRoute.addEventListener("click", () => {
  const editing = proposalModel.disabled;
  proposalIntent.disabled = !editing; proposalModel.disabled = !editing; proposalReasoning.disabled = !editing;
  proposalWorkflow.disabled = !editing; proposalPermissions.disabled = !editing;
  routingProposal.classList.toggle("is-editing", editing);
  proposalRoutingLabel.textContent = editing ? "AJUSTEMENT MANUEL" : "LUNA AUTOMATIQUE";
  renderProposalMatrix();
  modifyRoute.textContent = editing ? "Terminer" : "Ajuster";
});
proposalIntent.addEventListener("change", () => { applyIntent(proposalIntent.value as UiRoutingDecision["intent"]); });
proposalPermissions.addEventListener("change", () => {
  if (proposalPermissions.value === "workspace-write") proposalIntent.value = "implementation";
  else if (proposalIntent.value === "implementation" || proposalIntent.value === "fix") proposalIntent.value = "analysis";
  applyIntent(proposalIntent.value as UiRoutingDecision["intent"]);
});
proposalModel.addEventListener("change", () => { proposalTitle.textContent = modelLabel(proposalModel.value as UiRoutingDecision["modelName"]); });
stopButton.addEventListener("click", () => void stopMission());
retryPermission.addEventListener("click", () => void executeProposal("workspace-write"));
showRequest.addEventListener("click", () => { promptInput.value = activeSession?.request ?? ""; showNewMission(); autosizePrompt(); });
followUpForm.addEventListener("submit", (event) => { event.preventDefault(); void continueSession(); });
followUpPrompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void continueSession(); }
});
strategyDetailsToggle.addEventListener("click", () => {
  strategyDetails.hidden = !strategyDetails.hidden;
  strategyDetailsToggle.textContent = strategyDetails.hidden ? "Voir les détails" : "Masquer les détails";
});
contextToggle.addEventListener("click", () => { document.body.classList.toggle("context-hidden"); });
sidebarToggle.addEventListener("click", () => { const collapsed = document.body.classList.toggle("sidebar-collapsed"); sidebarToggle.textContent = collapsed ? "›" : "‹"; sidebarToggle.setAttribute("aria-label", collapsed ? "Déployer la sidebar" : "Réduire la sidebar"); });
openTechnicalDrawer.addEventListener("click", () => toggleTechnicalDrawer(true));
closeTechnicalDrawer.addEventListener("click", () => toggleTechnicalDrawer(false));
drawerBackdrop.addEventListener("click", () => toggleTechnicalDrawer(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { toggleRoutingPopover(false); toggleTechnicalDrawer(false); } });
document.addEventListener("pointerdown", (event) => { if (!routingPopover.hidden && !routingPopover.contains(event.target as Node) && !routingPill.contains(event.target as Node)) toggleRoutingPopover(false); });
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

renderManualMatrix = setupRoutingMatrix(manualRoutingMatrix, manualModel, manualReasoning, manualWorkflow, () => { persistManualSettings(); updateRoutingPill(); });
renderProposalMatrix = setupRoutingMatrix(proposalRoutingMatrix, proposalModel, proposalReasoning, proposalWorkflow, () => {
  proposalTitle.textContent = "Mission comprise";
  proposalReason.textContent = modeLabel(proposalIntent.value as UiRoutingDecision["intent"]) + " avec " + modelLabel(proposalModel.value as UiRoutingDecision["modelName"]) + ", réflexion " + proposalReasoning.value + ", " + workflowLabel(proposalWorkflow.value as UiRoutingDecision["workflow"]).toLocaleLowerCase("fr-FR") + ".";
});

const savedManualIntent = localStorage.getItem("smart-codex.manual-intent");
manualIntent.value = savedManualIntent === "discussion" || savedManualIntent === "planning" ? savedManualIntent : "implementation";
manualModel.value = localStorage.getItem("smart-codex.manual-model") ?? "terra";
manualReasoning.value = localStorage.getItem("smart-codex.manual-reasoning") ?? "medium";
manualWorkflow.value = localStorage.getItem("smart-codex.manual-workflow") ?? "single-agent";
renderManualMatrix(); renderProposalMatrix();
setProject(selectedProject); autosizePrompt(); setRoutingMode(selectedRoutingMode); showNewMission(); void refreshHistory();
