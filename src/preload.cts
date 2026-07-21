import { contextBridge, ipcRenderer } from "electron";
import type { DesktopRequest, DesktopRunResponse, SmartCodexDesktopApi, UiRoutingDecision } from "./electron-api.js";

const api: SmartCodexDesktopApi = {
  selectProject: () => ipcRenderer.invoke("project:select") as Promise<string | null>,
  decide: (request: DesktopRequest) =>
    ipcRenderer.invoke("router:decide", request) as Promise<UiRoutingDecision>,
  run: (request: DesktopRequest) =>
    ipcRenderer.invoke("codex:run", request) as Promise<DesktopRunResponse>,
};

contextBridge.exposeInMainWorld("smartCodex", api);

