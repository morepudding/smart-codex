import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MissionSession, UiRoutingDecision } from "./electron-api.js";
import { classifyIntent, createPresetDecision } from "./router.js";
import type { MissionStatus, RouteName } from "./types.js";

const MAX_SESSIONS = 80;
const FAILURE_TRACE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function legacyDecision(value: unknown, projectPath: string, request: string): UiRoutingDecision {
  const candidate = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const routes: RouteName[] = ["luna-low", "terra-medium", "sol-high", "sol-xhigh-review"];
  const route = typeof candidate.route === "string" && routes.includes(candidate.route as RouteName) ? candidate.route as RouteName : "terra-medium";
  const sandbox = candidate.sandbox === "read-only" ? "read-only" : "workspace-write";
  const intent = classifyIntent(request, sandbox === "read-only" ? "analysis" : "implementation");
  return {
    ...createPresetDecision(route, sandbox, {
      intent,
      requiresConfirmation: candidate.requiresConfirmation === true,
      reason: typeof candidate.reason === "string" ? candidate.reason : "Session historique migrée.",
      unknowns: Array.isArray(candidate.unknowns) ? candidate.unknowns.filter((item): item is string => typeof item === "string") : [],
      source: "preset",
    }),
    projectPath,
  };
}

function migrateSession(value: unknown): MissionSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.request !== "string" || typeof candidate.projectPath !== "string") return undefined;
  if (candidate.initialDecision && candidate.executedDecision) {
    const session = candidate as unknown as MissionSession;
    const messages = Array.isArray(candidate.messages) ? candidate.messages : [];
    if (messages.length) return { ...session, events: Array.isArray(candidate.events) ? candidate.events as MissionSession["events"] : [], messages: messages as NonNullable<MissionSession["messages"]> };
    return { ...session, events: Array.isArray(candidate.events) ? candidate.events as MissionSession["events"] : [] };
  }

  const decision = legacyDecision(candidate.decision, candidate.projectPath, candidate.request);
  const result = (candidate.result && typeof candidate.result === "object" ? candidate.result : {}) as Record<string, unknown>;
  const existingMessages = Array.isArray(candidate.messages) ? candidate.messages : [];
  const changes = Array.isArray(result.changes) ? result.changes.length : 0;
  const status = (typeof candidate.status === "string" ? candidate.status : "interrupted") as MissionStatus;
  const durationMs = typeof candidate.durationMs === "number" ? candidate.durationMs : 0;
  return {
    id: candidate.id,
    title: typeof candidate.title === "string" ? candidate.title : candidate.request.slice(0, 72),
    request: candidate.request,
    projectPath: candidate.projectPath,
    status,
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
    events: [],
    initialDecision: decision,
    executedDecision: decision,
    outcome: { status, durationMs, validations: { tests: { run: 0, failed: 0 }, build: { run: 0, failed: 0 } }, filesModified: changes, linesAdded: 0, linesDeleted: 0 },
    ...(typeof candidate.threadId === "string" ? { threadId: candidate.threadId } : {}),
    ...(typeof result.finalResponse === "string" ? { summary: { finalResponse: result.finalResponse } } : {}),
    ...(existingMessages.length
      ? { messages: existingMessages as NonNullable<MissionSession["messages"]> }
      : typeof result.finalResponse === "string"
        ? { messages: [{ role: "user", content: candidate.request, at: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now() }, { role: "assistant", content: result.finalResponse, at: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now() }] }
        : {}),
    ...(typeof candidate.error === "string" ? { error: candidate.error } : {}),
    ...(candidate.experimentalRouting && typeof candidate.experimentalRouting === "object" ? { experimentalRouting: candidate.experimentalRouting as NonNullable<MissionSession["experimentalRouting"]> } : {}),
  };
}

function compactSession(session: MissionSession): MissionSession {
  const compact = clone(session);
  if (compact.status === "completed") {
    delete compact.liveEvents;
    delete compact.error;
    delete compact.result;
    delete compact.technicalTrace;
    compact.events = [];
  } else if (compact.status !== "running") {
    delete compact.liveEvents;
    delete compact.result;
    compact.events = [];
  }
  if (compact.technicalTrace && compact.technicalTrace.expiresAt <= Date.now()) delete compact.technicalTrace;
  return compact;
}

export class SessionStore {
  private sessions: MissionSession[] = [];
  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let changed = false;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        this.sessions = parsed.map(migrateSession).filter((session): session is MissionSession => Boolean(session)).map(compactSession);
        changed = true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    this.sessions = this.sessions.map((session) => {
      if (session.status !== "running") return session;
      changed = true;
      const { liveEvents: _liveEvents, ...rest } = session;
      return {
        ...rest,
        status: "interrupted",
        updatedAt: Date.now(),
        error: "L'application a ete fermee pendant cette mission.",
        technicalTrace: { expiresAt: Date.now() + FAILURE_TRACE_RETENTION_MS, error: "Mission interrompue par la fermeture de l'application.", events: session.liveEvents ?? [], commands: [] },
      };
    });
    if (changed) await this.persist();
  }

  list(): MissionSession[] { return clone([...this.sessions].sort((left, right) => right.updatedAt - left.updatedAt)); }
  get(id: string): MissionSession | undefined { const session = this.sessions.find((candidate) => candidate.id === id); return session ? clone(session) : undefined; }
  failureTraceExpiry(): number { return Date.now() + FAILURE_TRACE_RETENTION_MS; }

  async create(session: MissionSession): Promise<MissionSession> {
    this.sessions = [compactSession(session), ...this.sessions].slice(0, MAX_SESSIONS);
    await this.persist();
    return clone(session);
  }

  async update(id: string, patch: Partial<Omit<MissionSession, "id" | "createdAt">>): Promise<MissionSession> {
    const index = this.sessions.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw new Error("Session introuvable.");
    const current = this.sessions[index]!;
    const updated = compactSession({ ...current, ...clone(patch), updatedAt: Date.now() });
    this.sessions[index] = updated;
    await this.persist();
    return clone(updated);
  }

  async delete(id: string): Promise<void> {
    const index = this.sessions.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw new Error("Conversation introuvable.");
    this.sessions.splice(index, 1);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.sessions.map(compactSession)), "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
