const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("worklyOverlay", {
  action: (action) => ipcRenderer.invoke("workly:overlay:action", action),
  onSnapshot: (listener) => {
    const callback = (_, value) => listener(value);
    ipcRenderer.on("workly:overlay-snapshot", callback);
    return () =>
      ipcRenderer.removeListener("workly:overlay-snapshot", callback);
  },
});
