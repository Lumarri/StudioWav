const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const { PluginLibrary } = require("./plugin-library.cjs");

class NativeAudio {
  constructor(app, broadcast, spawnProcess = spawn) {
    this.app = app;
    this.broadcast = broadcast;
    this.pending = new Map();
    this.nextId = 1;
    this.child = null;
    this.recordingFile = null;
    this.initialization = null;
    this.settingsWrite = Promise.resolve();
    this.closing = false;
    this.spawnProcess = spawnProcess;
    this.library = new PluginLibrary(app, (args) => this.call("scan", args));
  }
  start() {
    if (this.child) return;
    const executable = this.app.isPackaged
      ? path.join(process.resourcesPath, "audio/StudioWavAudio.exe")
      : path.join(__dirname, "../native/bin/StudioWavAudio.exe");
    if (this.closing) throw new Error("El motor de audio se está cerrando.");
    const child = this.spawnProcess(executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stderr.on("data", () => {});
    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.event === "status") {
        this.broadcast(message.data);
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    });
    const failed = (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.initialization = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      this.broadcast({
        ready: false,
        playing: false,
        backend: "native",
        error: error.message,
        levels: {},
      });
    };
    child.stdin.on("error", failed);
    child.on("error", () =>
      failed(
        new Error(
          "No se pudo iniciar el backend nativo. Compílalo con npm run native:build.",
        ),
      ),
    );
    child.on("exit", (code) =>
      failed(new Error(`El proceso de audio terminó (${code ?? "señal"}).`)),
    );
  }
  call(command, args = {}) {
    if (this.closing)
      return Promise.reject(new Error("El motor de audio se está cerrando."));
    this.start();
    const child = this.child;
    if (!child || child.stdin.destroyed || child.stdin.writableEnded)
      return Promise.reject(new Error("El canal de audio está cerrado."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(
            new Error("La operación de audio superó el tiempo disponible."),
          );
        },
        ["scan", "project", "render"].includes(command) ? 300000 : 30000,
      );
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ id, command, args }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  async request(command, args = {}) {
    if (this.closing) throw new Error("El motor de audio se está cerrando.");
    if (command === "bundledPlugins") return this.library.bundled();
    if (command === "pluginCatalog") return this.library.catalog();
    const allowed = new Set([
      "init",
      "status",
      "devices",
      "configure",
      "project",
      "play",
      "stop",
      "pause",
      "preview",
      "focus",
      "midi",
      "scan",
      "states",
      "parameters",
      "parameter",
      "editor",
      "controlPanel",
      "recordStart",
      "recordStop",
      "render",
      "resetStats",
    ]);
    if (!allowed.has(command)) throw new Error("Operación no disponible.");
    if (command === "project")
      return this.call(command, this.library.resolveProject(args));
    if (command === "scan") {
      const found = await this.call(command, args);
      await this.library.remember(found);
      return found;
    }
    if (command === "init") {
      if (!this.initialization)
        this.initialization = (async () => {
          await this.call("init");
          try {
            const saved = JSON.parse(
              await fs.readFile(
                path.join(this.app.getPath("userData"), "audio-settings.json"),
                "utf8",
              ),
            );
            if (saved.type && saved.output) await this.call("configure", saved);
            if (saved.midiDevice)
              await this.call("midi", { deviceId: saved.midiDevice });
          } catch {
            /* A disconnected device falls back to the current system output. */
          }
          return this.call("status");
        })().catch((error) => {
          this.initialization = null;
          throw error;
        });
      return this.initialization;
    }
    if (command === "configure" || command === "midi") {
      const result = await this.call(command, args);
      const actual =
        command === "configure" ? result : await this.call("devices");
      const saved = {
        type: actual.type,
        output: actual.output,
        input: actual.input,
        sampleRate: actual.sampleRate,
        bufferSize: actual.bufferSize,
        midiDevice: actual.midiDevice,
      };
      this.settingsWrite = this.settingsWrite
        .catch(() => {})
        .then(async () => {
          const file = path.join(
            this.app.getPath("userData"),
            "audio-settings.json",
          );
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file + ".tmp", JSON.stringify(saved, null, 2));
          await fs.rename(file + ".tmp", file);
        });
      await this.settingsWrite;
      return result;
    }
    const temp = path.join(this.app.getPath("temp"), "StudioWav-audio");
    if (command === "render") {
      await fs.mkdir(temp, { recursive: true });
      const file = path.join(temp, `${randomUUID()}.wav`);
      try {
        const result = await this.call(command, { ...args, path: file });
        const audio = await fs.readFile(file);
        return { ...result, path: undefined, audio: new Uint8Array(audio) };
      } finally {
        await fs.rm(file, { force: true }).catch(() => {});
      }
    }
    if (command === "recordStart") {
      const recordings = path.join(this.app.getPath("userData"), "Recordings");
      await fs.mkdir(recordings, { recursive: true });
      const file = path.join(
        recordings,
        `Toma-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.wav`,
      );
      const result = await this.call(command, { ...args, path: file });
      this.recordingFile = file;
      return result;
    }
    if (command === "recordStop") {
      const result = await this.call(command, args);
      const file = this.recordingFile;
      if (!file || result.path !== file)
        throw new Error("La ruta de la grabación no coincide con la sesión.");
      const info = await fs.stat(file);
      this.recordingFile = null;
      if (info.size > 100000000)
        return {
          ...result,
          data: null,
          warning:
            "La toma supera 100 MB y se conserva en la carpeta de grabaciones.",
        };
      const audio = await fs.readFile(file);
      return {
        ...result,
        data: `data:audio/wav;base64,${audio.toString("base64")}`,
      };
    }
    return this.call(command, args);
  }
  close() {
    if (this.closing) return;
    this.closing = true;
    const child = this.child;
    this.child = null;
    this.initialization = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("El motor de audio se está cerrando."));
    }
    this.pending.clear();
    if (!child || child.stdin.destroyed || child.stdin.writableEnded) return;
    child.stdin.end(JSON.stringify({ command: "quit" }) + "\n");
    const timer = setTimeout(() => child.kill(), 3000);
    timer.unref();
  }
}
module.exports = { NativeAudio };
