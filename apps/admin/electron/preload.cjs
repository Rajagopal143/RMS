const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rmsDesktop", {
  platform: process.platform,
  listSystemPrinters: () => ipcRenderer.invoke("printers:system"),
  listSerialPorts: () => ipcRenderer.invoke("printers:serial"),
  print: (job) => ipcRenderer.invoke("printers:print", job),
});
