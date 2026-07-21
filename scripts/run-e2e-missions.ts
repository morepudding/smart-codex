import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runCodex } from "../src/codex-runner.js";
import { loadProjectContext } from "../src/project-context.js";
import { routeRequest } from "../src/router.js";
import type { CodexProgressEvent, RouteName } from "../src/types.js";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const fixture = path.join(root, "fixtures", "e2e-node");
const workRoot = path.join(root, ".e2e-work");
const outputRoot = path.join(root, ".smart-codex-runs");

const missions: Array<{ name: string; expectedRoute: RouteName; request: string }> = [
  {
    name: "luna-low",
    expectedRoute: "luna-low",
    request: "Renomme la fonction add en sum dans ce petit projet, adapte les imports et lance les tests.",
  },
  {
    name: "terra-medium",
    expectedRoute: "terra-medium",
    request: "Ajoute une fonction multiply dans le module arithmetic, exporte-la et ajoute ses tests.",
  },
  {
    name: "sol-high",
    expectedRoute: "sol-high",
    request: "Diagnostique la cause racine du test VIP qui échoue entre discount.js et invoice.js, corrige le bug et valide tous les tests.",
  },
  {
    name: "sol-xhigh-review",
    expectedRoute: "sol-xhigh-review",
    request: "Refactorise tout le projet sans regression pour représenter les remises en taux décimal, adapte les fichiers concernés et les tests de bout en bout.",
  },
];
const requestedMission = process.argv.includes("--mission") ? process.argv[process.argv.indexOf("--mission") + 1] : undefined;
const selectedMissions = requestedMission ? missions.filter((mission) => mission.name === requestedMission) : missions;
if (requestedMission && selectedMissions.length === 0) throw new Error(`Mission inconnue: ${requestedMission}`);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}

await mkdir(workRoot, { recursive: true });
await mkdir(outputRoot, { recursive: true });

for (const mission of selectedMissions) {
  const cwd = path.join(workRoot, mission.name);
  await rm(cwd, { recursive: true, force: true });
  await cp(fixture, cwd, { recursive: true });
  if (mission.name === "sol-high") {
    const invoicePath = path.join(cwd, "src", "invoice.js");
    const invoice = await readFile(invoicePath, "utf8");
    await writeFile(invoicePath, invoice.replace(" * discountRate(customer) / 100", " * discountRate(customer)"), "utf8");
  }
  await git(cwd, "init");
  await git(cwd, "config", "user.name", "Smart Codex E2E");
  await git(cwd, "config", "user.email", "smart-codex-e2e@localhost");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "Fixture baseline");

  const context = await loadProjectContext(cwd);
  const decision = routeRequest(mission.request, context);
  if (decision.route !== mission.expectedRoute) {
    throw new Error(`${mission.name}: route ${decision.route}, attendu ${mission.expectedRoute}`);
  }

  const events: CodexProgressEvent[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60_000);
  const started = Date.now();
  let result;
  let error: string | undefined;
  try {
    result = await runCodex(mission.request, context, decision, {
      signal: controller.signal,
      onProgress: (event) => events.push(event),
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - started;
  const diff = await git(cwd, "diff", "--no-ext-diff", "--binary");
  const status = await git(cwd, "status", "--short");
  const gitFilesModified = status.split(/\r?\n/).filter(Boolean).map((line) => {
    const code = line.slice(0, 2);
    const rawPath = line.slice(3);
    const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
    return { path: filePath, kind: code === "??" || code.includes("A") ? "add" : code.includes("D") ? "delete" : "update" };
  });
  const report = {
    mission: mission.name,
    request: mission.request,
    route: decision.route,
    model: decision.model,
    reasoning: decision.reasoning,
    sandbox: decision.sandbox,
    agentCount: decision.agentCount,
    threadIds: result?.threadIds ?? [],
    durationMs,
    events,
    filesModified: gitFilesModified,
    sdkFileChanges: result?.changes ?? [],
    gitStatus: status,
    gitDiff: diff,
    commandsExecuted: result?.commands ?? [],
    finalResponse: result?.finalResponse ?? "",
    reviewResponse: result?.reviewResponse,
    error,
  };
  await writeFile(path.join(outputRoot, `${mission.name}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${mission.name}: ${error ? "FAILED" : "COMPLETED"} (${durationMs} ms)\n`);
}

const reports = await Promise.all(selectedMissions.map(async (mission) => JSON.parse(await readFile(path.join(outputRoot, `${mission.name}.json`), "utf8"))));
await writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(reports, null, 2)}\n`, "utf8");
