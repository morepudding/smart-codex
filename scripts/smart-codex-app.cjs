#!/usr/bin/env node
const { spawn } = require("node:child_process");
const path = require("node:path");
const electron = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const child = spawn(electron, [projectRoot], {
  cwd: projectRoot,
  detached: false,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});

