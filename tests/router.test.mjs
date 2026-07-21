import assert from "node:assert/strict";
import test from "node:test";
import { classifyIntent, routeRequest } from "../dist/router.js";
import { codexChildEnvironment, commandProgressLabel, executionPrompt, reconcileElectronSmokeResponse } from "../dist/codex-runner.js";
import { changesSince, parseGitShortStatusZ } from "../dist/git-changes.js";
import { validationMetrics } from "../dist/validation-metrics.js";

const context = {
  root: "C:\\project",
  docs: [],
  manifests: ["C:\\project\\package.json"],
  signals: ["node", "git"],
};

test("utilise Luna low pour une demande mécanique courte", () => {
  assert.equal(routeRequest("Corrige cette faute de frappe", context).preset, "luna-low");
});

test("utilise Terra medium pour une implémentation courante", () => {
  assert.equal(routeRequest("Ajoute une page profil", context).preset, "terra-medium");
});

test("reconnait une demande d’implémentation formulée poliment", () => {
  const result = routeRequest("Peux-tu implémenter une page profil ?", context);
  assert.equal(classifyIntent("Peux-tu implémenter une page profil ?"), "implementation");
  assert.equal(result.intent, "implementation");
  assert.equal(result.permissions, "workspace-write");
});

test("utilise Sol high pour un travail d’architecture", () => {
  assert.equal(routeRequest("Analyse cette architecture et propose une migration", context).preset, "sol-high");
});

test("utilise Sol xhigh review pour un travail critique", () => {
  const result = routeRequest("Refactorise tout le projet sans regression", context);
  assert.equal(result.preset, "sol-xhigh-review");
  assert.equal(result.workflow, "development-review");
});

test("conserve les analyses pures en lecture seule", () => {
  assert.equal(routeRequest("Analyse les performances", context).permissions, "read-only");
});

test("garde une demande d’idéation en lecture seule", () => {
  const result = routeRequest("On va créer un petit jeu inspiré de The Tower, tu verrais ça comment ?", context);
  assert.equal(result.intent, "ideation");
  assert.equal(result.permissions, "read-only");
  assert.equal(result.expectedResult, "text-response");
});

test("garde une proposition d’architecture en lecture seule", () => {
  const result = routeRequest("Propose-moi une architecture pour ce projet", context);
  assert.equal(result.intent, "planning");
  assert.equal(result.permissions, "read-only");
  assert.equal(result.expectedResult, "plan");
});

test("active i-have-adhd pour chaque mission", () => {
  const decision = routeRequest("Ajoute une page profil", context);
  assert.match(executionPrompt("Ajoute une page profil", context, decision), /^\$i-have-adhd\n\n/);
});

test("nettoie l’environnement Electron transmis au SDK Codex", () => {
  const environment = codexChildEnvironment({
    Path: "C:\\Windows\\System32",
    USERPROFILE: "C:\\Users\\test",
    ELECTRON_RUN_AS_NODE: "1",
    npm_lifecycle_event: "desktop",
    NODE_OPTIONS: "--inspect",
  });
  assert.deepEqual(environment, { Path: "C:\\Windows\\System32", USERPROFILE: "C:\\Users\\test" });
});

test("résume les commandes techniques sans exposer leur contenu", () => {
  assert.equal(commandProgressLabel("rg -n intent src"), "Recherche dans le code");
  assert.equal(commandProgressLabel("npm.cmd run typecheck"), "Vérification des types");
  assert.equal(commandProgressLabel("npm.cmd run desktop:smoke"), "Validation de l’interface Electron");
});

test("compte les tests npm et neutralise un échec smoke récupéré", () => {
  const metrics = validationMetrics([
    { command: "npm.cmd test", status: "completed" },
    { command: "npm.cmd run desktop:smoke", status: "failed" },
    { command: "host:desktop:smoke", status: "completed" },
  ]);
  assert.deepEqual(metrics.tests, { run: 1, failed: 0 });
  assert.deepEqual(metrics.build, { run: 1, failed: 0 });
});

test("retire une ancienne conclusion smoke contradictoire", () => {
  const response = reconcileElectronSmokeResponse("Les 22 tests passent. Le smoke Electron reste bloqué par spawn EPERM du sandbox Windows.");
  assert.equal(response, "Les 22 tests passent.");
});

test("détecte les fichiers Git modifiés, ajoutés et renommés", () => {
  const before = parseGitShortStatusZ(" M src/existing.ts\0");
  const after = parseGitShortStatusZ(" M src/existing.ts\0?? src/new file.ts\0R  src/new-name.ts\0src/old-name.ts\0");
  assert.deepEqual(changesSince(before, after), [
    { path: "src/new file.ts", kind: "add" },
    { path: "src/new-name.ts", kind: "update" },
  ]);
});
