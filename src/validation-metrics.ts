import type { ValidationMetrics } from "./electron-api.js";

export function validationMetrics(commands: Array<{ command: string; status: "completed" | "failed" }>): ValidationMetrics {
  const smokeRecovered = commands.some((item) => item.command === "host:desktop:smoke" && item.status === "completed");
  const effectiveCommands = commands.filter((item) => !(smokeRecovered && item.status === "failed" && /desktop:smoke\b/i.test(item.command)));
  const tests = effectiveCommands.filter((item) => /(?:^|[\s;])(npm(?:\.cmd)?\s+(?:run\s+)?test|node\s+--test|test|vitest|jest|pytest|unittest|cargo\s+test|go\s+test)\b/i.test(item.command));
  const builds = effectiveCommands.filter((item) => /(^|\s)(build|typecheck|type-check|tsc|lint|check:utf8)\b|\bdesktop:smoke\b/i.test(item.command));
  return {
    tests: { run: tests.length, failed: tests.filter((item) => item.status === "failed").length },
    build: { run: builds.length, failed: builds.filter((item) => item.status === "failed").length },
    commands: [...tests, ...builds].map((item) => ({ command: item.command.slice(0, 500), status: item.status })),
  };
}
