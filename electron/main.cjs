const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { NativeAudio } = require("./native.cjs");
if (
  process.env.STUDIOWAV_PROFILE_DIR &&
  path.isAbsolute(process.env.STUDIOWAV_PROFILE_DIR)
)
  app.setPath("userData", process.env.STUDIOWAV_PROFILE_DIR);
let mainWindow;
let shuttingDown = false;
const audio = new NativeAudio(app, (data) => {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("audio:status", data);
});
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (audio.child && mainWindow && !mainWindow.isDestroyed()) {
      await Promise.race([
        (async () => {
          const states = await audio.request("states");
          const store = function (states) {
            window.dispatchEvent(
              new CustomEvent("studiowav:plugin-states", { detail: states }),
            );
            window.dispatchEvent(new Event("beforeunload"));
            const raw = localStorage.getItem("studiowav.project.v1");
            if (!raw) return;
            const project = JSON.parse(raw);
            for (const track of project.tracks)
              for (const plugin of track.plugins ?? [])
                if (states[plugin.id]) plugin.state = states[plugin.id];
            localStorage.setItem(
              "studiowav.project.v1",
              JSON.stringify(project),
            );
          };
          await mainWindow.webContents.executeJavaScript(
            `(${store.toString()})(JSON.parse(${JSON.stringify(JSON.stringify(states))}))`,
          );
        })(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  } catch {
    /* A manual project file remains available if local storage is full. */
  }
  audio.close();
  app.quit();
}

function createWindow() {
  const window = new BrowserWindow({
    title: "StudioWav",
    width: 1540,
    height: 1000,
    minWidth: 1080,
    minHeight: 740,
    backgroundColor: "#121419",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow = window;
  window.on("close", (event) => {
    if (!shuttingDown) {
      event.preventDefault();
      void shutdown();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  if (process.env.STUDIOWAV_DEV_URL === "http://127.0.0.1:5173")
    window.loadURL(process.env.STUDIOWAV_DEV_URL);
  else window.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
ipcMain.handle("audio:request", (event, command, args) => {
  if (event.sender !== mainWindow?.webContents)
    throw new Error("Origen no autorizado.");
  if (shuttingDown) throw new Error("StudioWav se está cerrando.");
  if (typeof command !== "string" || !args || typeof args !== "object")
    throw new Error("Solicitud no válida.");
  return audio.request(command, args);
});
ipcMain.handle("audio:plugin-folder", async (event) => {
  if (event.sender !== mainWindow?.webContents)
    throw new Error("Origen no autorizado.");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Carpeta de plugins VST3",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("audio:recordings-folder", async (event) => {
  if (event.sender !== mainWindow?.webContents)
    throw new Error("Origen no autorizado.");
  const folder = path.join(app.getPath("userData"), "Recordings");
  await fs.mkdir(folder, { recursive: true });
  await shell.openPath(folder);
});
app.on("before-quit", (event) => {
  if (!shuttingDown) {
    event.preventDefault();
    void shutdown();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
