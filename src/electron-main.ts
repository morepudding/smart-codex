import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodex } from "./codex-runner.js";
import { loadProjectContext } from "./project-context.js";
import { routeRequest } from "./router.js";
import type { DesktopRequest, DesktopRunResponse, UiRoutingDecision } from "./electron-api.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let running = false;

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Source IPC non autorisee.");
  }
}

function validateRequest(value: unknown): DesktopRequest {
  if (!value || typeof value !== "object") throw new Error("Requete invalide.");
  const candidate = value as Partial<DesktopRequest>;
  if (typeof candidate.request !== "string" || candidate.request.trim().length === 0) {
    throw new Error("Ecris une demande avant de lancer Codex.");
  }
  if (candidate.request.length > 50_000) throw new Error("La demande est trop longue.");
  if (typeof candidate.projectPath !== "string" || !path.isAbsolute(candidate.projectPath)) {
    throw new Error("Choisis un dossier projet valide.");
  }
  return { request: candidate.request.trim(), projectPath: candidate.projectPath };
}

function toUiDecision(
  decision: ReturnType<typeof routeRequest>,
  projectPath: string,
): UiRoutingDecision {
  return {
    route: decision.route,
    model: decision.model,
    reasoning: decision.reasoning,
    agentCount: decision.agentCount,
    sandbox: decision.sandbox,
    reasons: decision.reasons,
    projectPath,
  };
}

async function decide(value: unknown): Promise<UiRoutingDecision> {
  const request = validateRequest(value);
  const context = await loadProjectContext(request.projectPath);
  return toUiDecision(routeRequest(request.request, context), context.root);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 760,
    minHeight: 640,
    backgroundColor: "#111511",
    show: false,
    title: "Smart Codex",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.once("did-finish-load", async () => {
    if (process.env.SMART_CODEX_SMOKE_TEST === "1") {
      const bridgeReady = await mainWindow?.webContents.executeJavaScript(
        "Boolean(window.smartCodex && typeof window.smartCodex.selectProject === 'function' && typeof window.smartCodex.decide === 'function' && typeof window.smartCodex.run === 'function')",
      );
      if (!bridgeReady) {
        console.error("SMART_CODEX_BRIDGE_MISSING");
        app.exit(1);
        return;
      }
      const smokePayload = JSON.stringify({
        request: "Ajoute une page profil",
        projectPath: path.dirname(currentDir),
      });
      const smokeDecision = await mainWindow?.webContents.executeJavaScript(
        `window.smartCodex.decide(${smokePayload})`,
      );
      if (smokeDecision?.model !== "gpt-5.6-terra") {
        console.error("SMART_CODEX_ROUTER_IPC_FAILED");
        app.exit(1);
        return;
      }
      console.log("SMART_CODEX_RENDERER_READY");
      setTimeout(() => app.quit(), 100);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadFile(path.join(currentDir, "ui", "index.html"));
}

app.whenReady().then(async () => {
  ipcMain.handle("project:select", async (event) => {
    assertTrustedSender(event);
    const options = {
      title: "Choisir le projet",
      buttonLabel: "Choisir ce dossier",
      properties: ["openDirectory"] as Array<"openDirectory">,
    };
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const selectedPaths = owner
      ? dialog.showOpenDialogSync(owner, options)
      : dialog.showOpenDialogSync(options);
    return selectedPaths?.[0] ?? null;
  });

  ipcMain.handle("router:decide", async (event, value: unknown) => {
    assertTrustedSender(event);
    return decide(value);
  });

  ipcMain.handle("codex:run", async (event, value: unknown): Promise<DesktopRunResponse> => {
    assertTrustedSender(event);
    if (running) throw new Error("Une execution Codex est deja en cours.");
    running = true;
    try {
      const request = validateRequest(value);
      const context = await loadProjectContext(request.projectPath);
      const decision = routeRequest(request.request, context);
      const result = await runCodex(request.request, context, decision);
      return { decision: toUiDecision(decision, context.root), result };
    } finally {
      running = false;
    }
  });

  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

