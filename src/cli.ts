#!/usr/bin/env node
import process from "node:process";
import { Command, Option } from "commander";
import { runCodex } from "./codex-runner.js";
import { formatDecision } from "./format.js";
import { loadProjectContext } from "./project-context.js";
import { forceRoute, routeRequest } from "./router.js";
import type { RouteName } from "./types.js";

const program = new Command();

program
  .name("smart-codex")
  .description("Route une demande vers le bon profil Codex puis l'execute dans le projet choisi.")
  .argument("<demande...>", "demande a transmettre a Codex")
  .option("-p, --project <dossier>", "dossier racine du projet", process.cwd())
  .option("--dry-run", "affiche la decision sans lancer Codex")
  .option("--json", "sortie JSON exploitable par la future interface Electron")
  .addOption(
    new Option("--route <route>", "force une route")
      .choices(["luna-low", "terra-medium", "sol-high", "sol-xhigh"]),
  )
  .showHelpAfterError();

program.action(async (parts: string[], options: { project: string; dryRun?: boolean; json?: boolean; route?: RouteName }) => {
  const request = parts.join(" ").trim();
  const context = await loadProjectContext(options.project);
  const decision = options.route ? forceRoute(options.route, request) : routeRequest(request, context);

  if (options.json && options.dryRun) {
    console.log(JSON.stringify({ decision, project: { root: context.root, signals: context.signals, docs: context.docs.map((doc) => doc.path) } }, null, 2));
    return;
  }

  console.log(formatDecision(decision, context));
  if (options.dryRun) return;

  console.log("\nExecution Codex en cours...\n");
  const result = await runCodex(request, context, decision);
  if (options.json) {
    console.log(JSON.stringify({ decision, result }, null, 2));
  } else {
    console.log("Resultat Codex\n");
    console.log(result.finalResponse);
  }
});

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smart-codex: ${message}`);
  process.exitCode = 1;
});

