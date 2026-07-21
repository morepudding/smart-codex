import { spawn } from "node:child_process";
import path from "node:path";
import electron from "electron";

const root = process.cwd();
const child = spawn(electron, [root], {
  cwd: root,
  env: { ...process.env, SMART_CODEX_SMOKE_TEST: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

const timeout = setTimeout(() => {
  child.kill();
  console.error(output);
  console.error("Electron smoke test timed out.");
  process.exitCode = 1;
}, 30_000);

child.on("exit", (code) => {
  clearTimeout(timeout);
  if (code === 0 && output.includes("SMART_CODEX_RENDERER_READY") && output.includes("SMART_CODEX_MARKDOWN_READY")) {
    console.log("Electron renderer and secure GFM Markdown loaded successfully.");
    return;
  }
  console.error(output);
  console.error(`Electron smoke test failed with code ${code ?? 1}.`);
  process.exitCode = code ?? 1;
});
