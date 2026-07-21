import assert from "node:assert/strict";
import test from "node:test";
import { routeRequest } from "../dist/router.js";
import { executionPrompt } from "../dist/codex-runner.js";
import { changesSince, parseGitShortStatusZ } from "../dist/git-changes.js";

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

test("détecte les fichiers Git modifiés, ajoutés et renommés", () => {
  const before = parseGitShortStatusZ(" M src/existing.ts\0");
  const after = parseGitShortStatusZ(" M src/existing.ts\0?? src/new file.ts\0R  src/new-name.ts\0src/old-name.ts\0");
  assert.deepEqual(changesSince(before, after), [
    { path: "src/new file.ts", kind: "add" },
    { path: "src/new-name.ts", kind: "update" },
  ]);
});
