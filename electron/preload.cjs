const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("studioNative", {
  request: (command, args = {}) =>
    ipcRenderer.invoke("audio:request", command, args),
  pickPluginFolder: () => ipcRenderer.invoke("audio:plugin-folder"),
  openRecordings: () => ipcRenderer.invoke("audio:recordings-folder"),
  onStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("audio:status", handler);
    return () => ipcRenderer.removeListener("audio:status", handler);
  },
});
