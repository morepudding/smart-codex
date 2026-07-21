import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "../dist/session-store.js";

test("preserves a resumable conversation across application restarts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "smart-codex-session-"));
  try {
    const filePath = path.join(directory, "history.json");
    const first = new SessionStore(filePath);
    await first.initialize();
    await first.create({
      id: "mission-1234", title: "Corriger un bug", request: "Corriger un bug", projectPath: "C:\\Projet",
      status: "completed", createdAt: 10, updatedAt: 20, events: [], threadId: "thread-1234",
      experimentalRouting: { snapshotVersion: "benchmark-priors-v1", candidates: [], error: "Profil invalide" },
      messages: [{ role: "user", content: "Corriger un bug", at: 10 }, { role: "assistant", content: "C'est fait.", at: 20 }],
    });
    const restarted = new SessionStore(filePath);
    await restarted.initialize();
    assert.deepEqual(restarted.get("mission-1234")?.messages, [
      { role: "user", content: "Corriger un bug", at: 10 },
      { role: "assistant", content: "C'est fait.", at: 20 },
    ]);
    assert.equal(restarted.get("mission-1234")?.threadId, "thread-1234");
    assert.equal(restarted.get("mission-1234")?.experimentalRouting?.snapshotVersion, "benchmark-priors-v1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
