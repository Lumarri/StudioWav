const fs = require("node:fs/promises");
const path = require("node:path");

const instruments = { piano: "StudioWav Piano", kick: "StudioWav Kick" };
function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
class PluginLibrary {
  constructor(app, scan) {
    this.app = app;
    this.scan = scan;
    this.bundledPromise = null;
    this.write = Promise.resolve();
  }
  bundlePath(id) {
    if (!Object.hasOwn(instruments, id))
      throw new Error("Instrumento incluido desconocido.");
    const base = this.app.isPackaged
      ? path.join(process.resourcesPath, "audio/plugins")
      : path.join(__dirname, "../native/bin/plugins");
    return path.join(base, `${instruments[id]}.vst3`);
  }
  async bundled() {
    if (!this.bundledPromise)
      this.bundledPromise = (async () => {
        const plugins = [];
        for (const id of Object.keys(instruments)) {
          const found = await this.scan({ file: this.bundlePath(id) });
          if (found.length !== 1 || !found[0].instrument)
            throw new Error(
              `No se pudo cargar ${instruments[id]}. Recompila los instrumentos.`,
            );
          const plugin = found[0];
          plugins.push({
            ...plugin,
            bundledId: id,
            description: plugin.description.replace(
              /\bfile="[^"]*"/,
              `file="studiowav-bundled:${id}"`,
            ),
            path: this.bundlePath(id),
          });
        }
        return plugins;
      })().catch((error) => {
        this.bundledPromise = null;
        throw error;
      });
    return this.bundledPromise;
  }
  resolveProject(project) {
    // Resolve our own stable IDs each launch, including portable extraction paths.
    return {
      ...project,
      tracks: (project.tracks ?? []).map((track) => ({
        ...track,
        plugins: track.plugins?.map((plugin) => ({
          ...plugin,
          description: plugin.description.replace(
            /\bfile="studiowav-bundled:([a-z]+)"/g,
            (_match, id) => `file="${escapeXml(this.bundlePath(id))}"`,
          ),
        })),
      })),
    };
  }
  async catalog() {
    await this.write;
    try {
      const saved = JSON.parse(
        await fs.readFile(
          path.join(this.app.getPath("userData"), "plugin-catalog.json"),
          "utf8",
        ),
      );
      return Array.isArray(saved) ? saved.filter(valid).slice(0, 512) : [];
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
      throw error;
    }
  }
  async remember(plugins) {
    const work = this.write.then(async () => {
      let existing = [];
      const file = path.join(
        this.app.getPath("userData"),
        "plugin-catalog.json",
      );
      try {
        existing = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {
        /* First scan. */
      }
      const merged = new Map();
      for (const plugin of [
        ...(Array.isArray(existing) ? existing : []),
        ...plugins,
      ])
        if (valid(plugin)) {
          const uid =
            /\buniqueId="([^"]*)"/.exec(plugin.description)?.[1] ?? plugin.name;
          merged.set(`${plugin.path.toLowerCase()}\0${uid}`, plugin);
        }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        file + ".tmp",
        JSON.stringify([...merged.values()].slice(-512), null, 2),
      );
      await fs.rename(file + ".tmp", file);
    });
    this.write = work.catch(() => {});
    await work;
  }
}
function valid(p) {
  return (
    p &&
    typeof p.name === "string" &&
    typeof p.manufacturer === "string" &&
    typeof p.instrument === "boolean" &&
    typeof p.path === "string" &&
    typeof p.description === "string" &&
    p.description.length <= 100000
  );
}
module.exports = { PluginLibrary };
