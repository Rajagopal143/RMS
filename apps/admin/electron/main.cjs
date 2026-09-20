// Electron main process: hosts the admin UI and talks to printers the browser can't reach.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");

const DEV_URL = process.env.ELECTRON_START_URL || "http://localhost:5173";
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "RMS Admin",
    backgroundColor: "#F3F4F1",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (app.isPackaged) mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  else mainWindow.loadURL(DEV_URL);
}

// ---- Transports ----

function printNetwork(address, bytes) {
  const [host, portText] = address.split(":");
  const port = Number(portText) || 9100;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(7000, () => {
      socket.destroy();
      reject(new Error(`No answer from printer at ${host}:${port}`));
    });
    socket.on("connect", () => socket.end(Buffer.from(bytes)));
    socket.on("close", (hadError) => !hadError && resolve());
    socket.on("error", (err) => reject(new Error(`Can't reach printer at ${host}:${port} (${err.code || err.message})`)));
  });
}

/** Bluetooth SPP printers show up as serial ports: /dev/tty.* (macOS), /dev/rfcomm* (Linux), COMn (Windows). */
function isSerialPath(address) {
  return /^(\/dev\/|COM\d+$|\\\\\.\\COM\d+$)/i.test(address);
}

function printSerial(address, bytes) {
  const target = /^COM\d+$/i.test(address) ? `\\\\.\\${address}` : address;
  return fs.promises.writeFile(target, Buffer.from(bytes)).catch((err) => {
    throw new Error(`Can't write to ${address} (${err.code || err.message}). Is the printer paired and on?`);
  });
}

/** OS-installed printers (USB, or Bluetooth paired as a system printer) via the print driver. */
async function printSystem(deviceName, html) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve, reject) => {
      win.webContents.print(
        { silent: true, deviceName: deviceName || undefined, printBackground: false, margins: { marginType: "none" } },
        (success, reason) => (success ? resolve() : reject(new Error(`Printer "${deviceName || "default"}" failed: ${reason}`))),
      );
    });
  } finally {
    win.destroy();
  }
}

// ---- IPC ----

ipcMain.handle("printers:system", async () => {
  const list = await mainWindow.webContents.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
});

ipcMain.handle("printers:serial", async () => {
  if (process.platform === "win32") return [];
  try {
    const entries = await fs.promises.readdir("/dev");
    return entries
      .filter((n) => /^(cu\.|tty\.|rfcomm|ttyUSB|ttyACM)/.test(n) && !/Bluetooth-Incoming-Port|debug-console/.test(n))
      .map((n) => `/dev/${n}`);
  } catch {
    return [];
  }
});

ipcMain.handle("printers:print", async (_event, job) => {
  const { printer, bytes, html } = job;
  try {
    if (printer.connection === "network") {
      if (!printer.address) throw new Error("Add the printer's IP address first");
      await printNetwork(printer.address, bytes);
    } else if (printer.connection === "bluetooth" && isSerialPath(printer.address)) {
      await printSerial(printer.address, bytes);
    } else {
      await printSystem(printer.address, html);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
