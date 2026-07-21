import type { UiRoutingDecision } from "./electron-api.js";

type Phase = "idle" | "routing" | "running" | "done" | "error";
type ActivityState = "pending" | "active" | "done" | "error";
type ActivityStep = "docs" | "files" | "route" | "execution" | "tests";

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Element introuvable: ${selector}`);
  return value;
}

const promptInput = element<HTMLTextAreaElement>("#prompt");
const projectName = element<HTMLElement>("#project-name");
const projectPath = element<HTMLSpanElement>("#project-path");
const chooseButton = element<HTMLButtonElement>("#choose-project");
const launchButton = element<HTMLButtonElement>("#launch");
const launchLabel = element<HTMLSpanElement>("#launch-label");
const appStatus = element<HTMLDivElement>("#app-status");
const activitySummary = element<HTMLElement>("#activity-summary");
const routeStepLabel = element<HTMLElement>("#route-step-label");
const resultOutput = element<HTMLPreElement>("#result-output");
const resultStatus = element<HTMLSpanElement>("#result-status");
const resultCaption = element<HTMLElement>("#result-caption");

let selectedProject = localStorage.getItem("smart-codex.project") ?? "";
let phase: Phase = "idle";

function projectLabel(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function setProject(value: string): void {
  selectedProject = value;
  projectName.textContent = value ? projectLabel(value) : "Aucun projet";
  projectPath.textContent = value || "Choisis un dossier de travail";
  projectPath.title = value;
  chooseButton.textContent = value ? "Changer" : "Choisir";
  if (value) localStorage.setItem("smart-codex.project", value);
}

function setPhase(next: Phase): void {
  phase = next;
  document.body.dataset.phase = next;
  const busy = next === "routing" || next === "running";
  chooseButton.disabled = busy;
  launchButton.disabled = busy;
  promptInput.disabled = busy;
  launchButton.classList.toggle("is-running", busy);
  launchLabel.textContent = busy ? "Analyse en cours…" : next === "done" ? "Relancer" : "Lancer";
  appStatus.className = `app-status is-${next}`;
  appStatus.querySelector("span")!.textContent = busy ? "En cours" : next === "error" ? "Erreur" : "Prêt";
}

function setActivity(step: ActivityStep, state: ActivityState): void {
  const item = element<HTMLLIElement>(`[data-step="${step}"]`);
  item.dataset.state = state;
}

function resetActivity(): void {
  for (const step of ["docs", "files", "route", "execution", "tests"] as ActivityStep[]) {
    setActivity(step, "pending");
  }
  routeStepLabel.textContent = "Choix du modèle";
}

function renderDecision(decision: UiRoutingDecision): void {
  const model = decision.model.replace("gpt-5.6-", "").toUpperCase();
  element<HTMLElement>("#decision-model").textContent = model;
  element<HTMLElement>("#decision-reasoning").textContent = decision.reasoning.toUpperCase();
  element<HTMLElement>("#decision-agents").textContent =
    `${decision.agentCount} ${decision.agentCount > 1 ? "AGENTS" : "AGENT"}`;
  element<HTMLElement>("#decision-access").textContent =
    decision.sandbox === "read-only" ? "LECTURE SEULE" : "ÉCRITURE PROJET";
  element<HTMLElement>("#decision-why").textContent = decision.reasons.join(" · ");
  routeStepLabel.textContent = `Choix de ${model[0]}${model.slice(1).toLowerCase()} ${decision.reasoning}`;
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  setPhase("error");
  resultStatus.textContent = "Erreur";
  resultCaption.textContent = "L’exécution n’a pas pu aboutir.";
  resultOutput.textContent = message;
  resultOutput.classList.add("has-error");
  activitySummary.textContent = "Une étape a échoué";
  const active = document.querySelector<HTMLLIElement>('.activity-list li[data-state="active"]');
  if (active) active.dataset.state = "error";
}

async function chooseProject(): Promise<void> {
  try {
    chooseButton.disabled = true;
    chooseButton.textContent = "Ouverture…";
    const selected = await window.smartCodex.selectProject();
    if (selected) setProject(selected);
  } catch (error) {
    showError(error);
  } finally {
    chooseButton.disabled = phase === "routing" || phase === "running";
    chooseButton.textContent = selectedProject ? "Changer" : "Choisir";
  }
}

async function launch(): Promise<void> {
  const request = promptInput.value.trim();
  resultOutput.classList.remove("has-error");

  if (!selectedProject) {
    showError("Choisis d’abord le dossier du projet.");
    return;
  }
  if (!request) {
    showError("Écris une demande avant de lancer Codex.");
    promptInput.focus();
    return;
  }

  resetActivity();
  setPhase("routing");
  setActivity("docs", "active");
  activitySummary.textContent = "Préparation du contexte";
  resultStatus.textContent = "Préparation";
  resultCaption.textContent = "La demande est en cours d’analyse.";
  resultOutput.textContent = "Smart Codex prépare la meilleure stratégie…";

  const filesTimer = window.setTimeout(() => {
    setActivity("docs", "done");
    setActivity("files", "active");
  }, 450);

  try {
    const payload = { request, projectPath: selectedProject };
    const decision = await window.smartCodex.decide(payload);
    window.clearTimeout(filesTimer);
    setActivity("docs", "done");
    setActivity("files", "done");
    renderDecision(decision);
    setActivity("route", "done");
    setActivity("execution", "active");
    setPhase("running");
    activitySummary.textContent = "Codex travaille sur le projet";
    resultStatus.textContent = "En cours";
    resultCaption.textContent = "Le résultat s’affichera dès que Codex aura terminé.";
    resultOutput.textContent = "Codex exécute la demande dans le projet sélectionné…";

    const response = await window.smartCodex.run(payload);
    renderDecision(response.decision);
    setActivity("execution", "done");
    setActivity("tests", "done");
    activitySummary.textContent = "Travail terminé";
    resultOutput.textContent = response.result.finalResponse || "Codex n’a retourné aucun texte.";
    resultStatus.textContent = "Terminé";
    resultCaption.textContent = "Réponse finale de Codex";
    setPhase("done");
  } catch (error) {
    window.clearTimeout(filesTimer);
    showError(error);
  }
}

chooseButton.addEventListener("click", () => void chooseProject());
launchButton.addEventListener("click", () => void launch());
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void launch();
  }
});

resetActivity();
setProject(selectedProject);
setPhase("idle");
promptInput.focus();

