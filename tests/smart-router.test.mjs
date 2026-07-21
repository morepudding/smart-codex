import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { loadBenchmarkSnapshot, rankExperimentalCandidates, suggestExperimentalRouting, validateTaskProfile } from "../dist/smart-router.js";
import { routeRequest } from "../dist/router.js";

const context = { root: path.resolve("fixtures/e2e-node"), docs: [], manifests: ["package.json"], signals: ["git"] };
const profile = {
  intent: "implementation", family: "feature", scope: "multi_file", reasoningDepth: "high", mechanicalVolume: "medium",
  uncertainty: "medium", risk: "medium", terminalIntensity: "medium", documentationQuality: "good", requiresWrite: true,
  availableValidations: ["npm test"], summary: "Ajout multi-fichiers documente.",
};

test("valide le TaskProfile experimental", () => {
  assert.deepEqual(validateTaskProfile(profile), profile);
  assert.throws(() => validateTaskProfile({ ...profile, risk: "inconnu" }), /TaskProfile/);
});

test("charge le snapshot versionne de demonstration", async () => {
  const snapshot = await loadBenchmarkSnapshot();
  assert.equal(snapshot.schemaVersion, "benchmark-priors-v1");
  assert.equal(snapshot.priors[0].source, "demonstration");
});

test("classe de maniere deterministe et elimine les candidats domines", () => {
  const snapshot = { schemaVersion: "benchmark-priors-v1", priors: [
    { source: "test", version: "v1", measuredAt: "2026-01-01", family: "feature", model: "luna", reasoning: "low", score: 70, confidence: "high" },
    { source: "test", version: "v1", measuredAt: "2026-01-01", family: "feature", model: "terra", reasoning: "medium", score: 70, confidence: "high" },
  ] };
  const ranked = rankExperimentalCandidates(profile, snapshot);
  assert.equal(ranked[0].modelName, "luna");
  assert.equal(ranked.some((candidate) => candidate.modelName === "terra" && candidate.reasoning === "medium"), false);
});

test("un echec Luna experimental reste un fallback shadow sans changer le routeur actuel", async () => {
  const before = routeRequest("Ajoute une page profil", context);
  const shadow = await suggestExperimentalRouting("Ajoute une page profil", context, async () => { throw new Error("Luna indisponible"); });
  const after = routeRequest("Ajoute une page profil", context);
  assert.equal(shadow.error, "Luna indisponible");
  assert.equal(after.preset, before.preset);
  assert.equal(after.model, before.model);
});
