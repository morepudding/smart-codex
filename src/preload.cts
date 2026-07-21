import { contextBridge, ipcRenderer } from "electron";
import type { DesktopRequest, DesktopRunRequest, DesktopRunResponse, MissionSession, SmartCodexDesktopApi, UiMissionEvent, UiRoutingProposal } from "./electron-api.js";

const api: SmartCodexDesktopApi = {
  selectProject: () => ipcRenderer.invoke("project:select") as Promise<string | null>,
  decide: (request: DesktopRequest) => ipcRenderer.invoke("router:decide", request) as Promise<UiRoutingProposal>,
  run: (request: DesktopRunRequest) => ipcRenderer.invoke("codex:run", request) as Promise<DesktopRunResponse>,
  stop: () => ipcRenderer.invoke("codex:stop") as Promise<void>,
  listSessions: () => ipcRenderer.invoke("history:list") as Promise<MissionSession[]>,
  getSession: (id: string) => ipcRenderer.invoke("history:get", id) as Promise<MissionSession | null>,
  onMissionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: UiMissionEvent) => listener(value);
    ipcRenderer.on("codex:mission-event", handler);
    return () => ipcRenderer.removeListener("codex:mission-event", handler);
  },
};
contextBridge.exposeInMainWorld("smartCodex", api);
