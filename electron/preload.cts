import { contextBridge, ipcRenderer } from "electron";
import type { ScopeApi } from "./types.js";
const api: ScopeApi = {
  monitors: (page) => ipcRenderer.invoke("scope:monitors", page),
  chooseApplications: () => ipcRenderer.invoke("scope:choose-applications"),
  createMonitor: (name, processNames, mode = "process") =>
    ipcRenderer.invoke("scope:create-monitor", { name, processNames, mode }),
  deleteMonitor: (id) => ipcRenderer.invoke("scope:delete-monitor", id),
  toggleMonitor: (id, enabled) =>
    ipcRenderer.invoke("scope:toggle-monitor", { id, enabled }),
  readAlerts: () => ipcRenderer.invoke("scope:read-alerts"),
  exportCsv: (filters) => ipcRenderer.invoke("scope:export", filters),
  events: (sourceId, requestKey, page) =>
    ipcRenderer.invoke("scope:events", { sourceId, requestKey, page }),
  status: () => ipcRenderer.invoke("scope:status"),
  settings: () => ipcRenderer.invoke("scope:settings"),
  saveSettings: (s) => ipcRenderer.invoke("scope:save-settings", s),
  start: () => ipcRenderer.invoke("scope:start"),
  stop: () => ipcRenderer.invoke("scope:stop"),
  query: (f) => ipcRenderer.invoke("scope:query", f),
};
contextBridge.exposeInMainWorld("scope", api);
