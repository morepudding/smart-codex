import { contextBridge, ipcRenderer } from "electron";
import type { DesktopContinueRequest, DesktopRoutingRequest, DesktopRunRequest, DesktopRunResponse, MissionSession, SmartCodexDesktopApi, UiMissionEvent, UiRoutingProposal } from "./electron-api.js";

const api: SmartCodexDesktopApi = {
  selectProject: () => ipcRenderer.invoke("project:select") as Promise<string | null>,
  selectContextFiles: (projectPath: string) => ipcRenderer.invoke("context:select-files", projectPath) as Promise<string[]>,
  decide: (request: DesktopRoutingRequest) => ipcRenderer.invoke("router:decide", request) as Promise<UiRoutingProposal>,
  run: (request: DesktopRunRequest) => ipcRenderer.invoke("codex:run", request) as Promise<DesktopRunResponse>,
  continueSession: (request: DesktopContinueRequest) => ipcRenderer.invoke("codex:continue", request) as Promise<DesktopRunResponse>,
  stop: (sessionId: string) => ipcRenderer.invoke("codex:stop", sessionId) as Promise<void>,
  listSessions: () => ipcRenderer.invoke("history:list") as Promise<MissionSession[]>,
  getSession: (id: string) => ipcRenderer.invoke("history:get", id) as Promise<MissionSession | null>,
  deleteSession: (id: string) => ipcRenderer.invoke("history:delete", id) as Promise<void>,
  onMissionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: UiMissionEvent) => listener(value);
    ipcRenderer.on("codex:mission-event", handler);
    return () => ipcRenderer.removeListener("codex:mission-event", handler);
  },
};
contextBridge.exposeInMainWorld("smartCodex", api);
