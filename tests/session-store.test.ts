import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/session-store.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("SessionStore", () => {
  it("persists sessions and marks unfinished work as interrupted after restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "smart-codex-session-"));
    directories.push(directory);
    const filePath = path.join(directory, "history.json");
    const first = new SessionStore(filePath);
    await first.initialize();
    await first.create({ id: "mission-1234", title: "Corriger un bug", request: "Corriger un bug", projectPath: "C:\\Projet", status: "running", createdAt: 10, updatedAt: 10, events: [] });
    const restarted = new SessionStore(filePath);
    await restarted.initialize();
    expect(restarted.list()).toMatchObject([{ id: "mission-1234", status: "interrupted" }]);
  });
});
