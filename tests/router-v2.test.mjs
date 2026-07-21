import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { routeWithLuna } from "../dist/luna-router.js";
import { addSelectedContextFiles, loadProjectContext } from "../dist/project-context.js";
import { createManualDecision, validateExecutionDecision, validateLunaDecision } from "../dist/router.js";
import { buildRoutingBrief } from "../dist/routing-brief.js";

const fixtureRoot = path.resolve("fixtures/e2e-node");

function validDecision(overrides = {}) {
  return {
    model: "terra",
    reasoning: "medium",
    workflow: "single-agent",
    intent: "implementation",
    uncertainty: "medium",
    requiresConfirmation: false,
    reason: "Fonctionnalite localisee avec documentation et tests existants.",
    unknowns: [],
    ...overrides,
  };
}

test("valide uniquement le contrat de decision Luna autorise", () => {
  const decision = validateLunaDecision(validDecision(), "Ajoute une fonction de remise");
  assert.equal(decision.modelName, "terra");
  assert.equal(decision.model, "gpt-5.6-terra");
  assert.equal(decision.permissions, "workspace-write");
  assert.equal(decision.source, "luna");
  assert.throws(() => validateLunaDecision(validDecision({ intent: "inconnue" }), "Analyse le projet"), /intention/i);
});

test("impose une confirmation pour une action destructive explicite", () => {
  assert.throws(() => validateLunaDecision(validDecision(), "Supprime definitivement les donnees"), /confirmation/);
  assert.equal(validateLunaDecision(validDecision({ requiresConfirmation: true }), "Supprime definitivement les donnees").requiresConfirmation, true);
});

test("revalide le profil et la confirmation juste avant execution", () => {
  const decision = validateLunaDecision(validDecision({ requiresConfirmation: true }), "Analyse puis purge les donnees");
  assert.throws(() => validateExecutionDecision(decision, "Analyse puis purge les donnees", false), /confirmation/);
  assert.throws(() => validateExecutionDecision({ ...decision, model: "gpt-5.6-sol" }, "Ajoute un test", true), /modele/i);
  assert.doesNotThrow(() => validateExecutionDecision(decision, "Analyse puis purge les donnees", true));
});

test("prepare un dossier compact avec documentation, stack, Git, tests et fichier cite", async () => {
  const context = await loadProjectContext(fixtureRoot);
  const brief = await buildRoutingBrief("Corrige src/discount.js", context);
  assert.match(brief.agentsSummary, /Fixture Smart Codex/i);
  assert.notEqual(brief.readmeSummary, "Aucun README detecte.");
  assert.ok(brief.stack.includes("node"));
  assert.ok(brief.structure.includes("src/"));
  assert.ok(brief.testCommands.some((command) => /test/i.test(command)));
  assert.deepEqual(brief.citedFiles.map((file) => [file.path.replaceAll("\\", "/"), file.exists]), [["src/discount.js", true]]);
  assert.ok(brief.gitStatus.length > 0);
  assert.ok(JSON.stringify(brief).length < 20_000);
});

test("ajoute un vrai fichier de contexte sans autoriser les fichiers sensibles", async () => {
  const context = await loadProjectContext(fixtureRoot);
  const readmePath = path.join(fixtureRoot, "README.md");
  const enriched = await addSelectedContextFiles(context, [readmePath]);
  assert.ok(enriched.docs.some((doc) => doc.path === readmePath && doc.content.length > 0));
  await assert.rejects(() => addSelectedContextFiles(context, [path.join(fixtureRoot, ".env")]), /\.env/i);
  await assert.rejects(() => addSelectedContextFiles(context, [path.resolve("package.json")]), /projet actif/i);
});

test("retente Luna une fois apres une decision invalide", async () => {
  const context = await loadProjectContext(fixtureRoot);
  const attempts = [];
  const routed = await routeWithLuna("Ajoute un test de remise", context, async (_brief, attempt) => {
    attempts.push(attempt);
    return attempt === 1 ? { route: "modele-invente" } : validDecision();
  });
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(routed.decision.modelName, "terra");
  assert.equal(routed.decision.source, "luna");
});

test("se replie sur Terra apres deux decisions Luna invalides", async () => {
  const context = await loadProjectContext(fixtureRoot);
  const routed = await routeWithLuna("Ajoute un test de remise", context, async () => ({ route: "invalide" }));
  assert.equal(routed.decision.modelName, "terra");
  assert.equal(routed.decision.source, "terra-fallback");
  assert.equal(routed.lunaAttempts, 2);
});

test("conserve l'ancien routeur comme secours si Luna est indisponible", async () => {
  const context = await loadProjectContext(fixtureRoot);
  const routed = await routeWithLuna("Corrige cette faute de frappe", context, async () => { throw new Error("modele indisponible"); });
  assert.equal(routed.decision.preset, "luna-low");
  assert.equal(routed.decision.source, "legacy-fallback");
});

test("corrige une intention Luna trop agressive pour une demande de conseil", () => {
  const decision = validateLunaDecision(validDecision(), "On va créer un petit jeu, tu verrais ça comment ?");
  assert.equal(decision.intent, "ideation");
  assert.equal(decision.permissions, "read-only");
  assert.equal(decision.expectedResult, "text-response");
});

test("construit une decision manuelle sans routage Luna", () => {
  const decision = createManualDecision({ intent: "implementation", modelName: "sol", reasoning: "high", workflow: "single-agent" }, "Ajoute une page profil");
  assert.equal(decision.source, "user");
  assert.equal(decision.model, "gpt-5.6-sol");
  assert.equal(decision.reasoning, "high");
  assert.equal(decision.permissions, "workspace-write");
});
