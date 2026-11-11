const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { PluginLibrary } = require("../electron/plugin-library.cjs");
test("bundled projects resolve at the current install path while external plugin paths and the saved project stay intact", async () => {
  let calls = 0;
  const library = new PluginLibrary({ isPackaged: false }, async ({ file }) => {
    calls++;
    return [
      {
        name: "Instrument",
        manufacturer: "StudioWav",
        instrument: true,
        path: file,
        description: `<PLUGIN file="${file}" isInstrument="1"/>`,
      },
    ];
  });
  const [a, b] = await Promise.all([library.bundled(), library.bundled()]);
  assert.deepEqual(a, b);
  assert.equal(calls, 5);
  assert.equal(a.length, 5);
  for (const plugin of a) assert.equal(plugin.presetNames.length, 8);
  const saved = {
    tracks: [
      {
        plugins: [
          { description: a[0].description },
          { description: '<PLUGIN file="D:/External.vst3"/>' },
        ],
      },
    ],
  };
  library.bundlePath = (id) => `E:/New & portable/${id}.vst3`;
  const resolved = library.resolveProject(saved);
  assert.match(
    saved.tracks[0].plugins[0].description,
    /studiowav-bundled:piano/,
  );
  assert.match(
    resolved.tracks[0].plugins[0].description,
    /E:\/New &amp; portable\/piano.vst3/,
  );
  assert.equal(
    resolved.tracks[0].plugins[1].description,
    saved.tracks[0].plugins[1].description,
  );
});
test("the installed catalog survives restart and concurrent scans, and tolerates a corrupt cache", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studiowav-library-"));
  try {
    const app = { getPath: () => dir };
    const library = new PluginLibrary(app);
    const p = (i) => ({
      name: `Plugin${i}`,
      manufacturer: "Example",
      instrument: true,
      path: `C:/Plugin${i}.vst3`,
      description: `<PLUGIN file="C:/Plugin${i}.vst3"/>`,
    });
    await Promise.all([library.remember([p(1)]), library.remember([p(2)])]);
    assert.equal((await new PluginLibrary(app).catalog()).length, 2);
    await library.remember([
      {
        ...p(1),
        description:
          '<PLUGIN file="C:/Plugin1.vst3" infoUpdateTime="changed"/>',
      },
    ]);
    assert.equal((await library.catalog()).length, 2);
    await writeFile(path.join(dir, "plugin-catalog.json"), "{");
    assert.deepEqual(await library.catalog(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
