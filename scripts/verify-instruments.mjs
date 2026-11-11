import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createProject } from "../src/model.ts";
import { addPluginTrack } from "../src/plugins.ts";
import { nativeProject } from "../src/audio/native-project.ts";
import { resizePattern } from "../src/music-tools.ts";
const { NativeAudio } = createRequire(import.meta.url)(
  "../electron/native.cjs",
);
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-instruments-"));
const audio = new NativeAudio(
  { isPackaged: false, getPath: () => profile },
  () => {},
);
function pcm(bytes) {
  const b = Buffer.from(bytes);
  for (let at = 12; at + 8 <= b.length; ) {
    const size = b.readUInt32LE(at + 4);
    if (b.toString("ascii", at, at + 4) === "data") {
      const data = b.subarray(at + 8, at + 8 + size);
      return Float64Array.from(
        { length: data.length / 4 },
        (_, i) => data.readInt16LE(i * 4) / 32768,
      );
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("Missing PCM data");
}
const rms = (a) => Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) / a.length);
function fundamental(data, low, high) {
  let best = 0,
    hz = 0;
  const from = Math.floor(0.12 * 44100),
    length = 8192;
  for (let f = low; f <= high; f += 0.5) {
    const coeff = 2 * Math.cos((2 * Math.PI * f) / 44100);
    let a = 0,
      b = 0;
    for (let i = 0; i < length; i++) {
      const x =
        data[from + i] *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1)));
      const s = x + coeff * a - b;
      b = a;
      a = s;
    }
    const power = a * a + b * b - coeff * a * b;
    if (power > best) {
      best = power;
      hz = f;
    }
  }
  return hz;
}
try {
  const checks = [];
  for (const name of ["Piano", "Kick", "Triple", "FM", "Pluck"]) {
    const exe = path.resolve(
      `native/build/StudioWav${name}Check_artefacts/Release/StudioWav${name}Check.exe`,
    );
    const result = spawnSync(exe, [], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    checks.push(JSON.parse(result.stdout));
  }
  await audio.request("init");
  const library = await audio.request("bundledPlugins");
  assert.equal(library.length, 5);
  const results = [];
  for (const plugin of library) {
    let p = createProject(false);
    p = resizePattern(p, p.patterns[0].id, 16);
    p.bpm = 120;
    p.swing = 0;
    p.master = 0.65;
    const track = addPluginTrack(p, plugin);
    track.gain = 0.8;
    track.cutoff = 20000;
    p.tracks = [track];
    const slot = track.plugins[0],
      pattern = p.patterns[0];
    const render = async (pitch = 60, velocity = 0.8) => {
      pattern.channels[track.id].notes = [
        { id: "test", pitch, velocity, start: 0.5, length: 4 },
      ];
      await audio.request("project", nativeProject(p, "pattern", pattern.id));
      return pcm(
        (await audio.request("render", { sampleRate: 44100, bitDepth: 16 }))
          .audio,
      );
    };
    const original = await render();
    const onset = original.findIndex((x) => Math.abs(x) > 3 / 32768);
    assert.ok(onset >= 2756 && onset < 2856, `${plugin.name}: ${onset}`);
    const originalRms = rms(original);
    assert.ok(originalRms > 0.005, `${plugin.name} RMS ${originalRms} is too low`);
    const soft = await render(60, 0.3);
    assert.ok(
      originalRms > rms(soft) * 1.8,
      "Velocity not reflected in exported audio",
    );
    const args = { trackId: track.id, pluginId: slot.id };
    const params = await audio.request("parameters", args);
    const state = (await audio.request("states"))[slot.id];
    assert.ok(state?.length > 20);
    await audio.request("parameter", { ...args, index: 0, value: 0 });
    const muted = await render();
    assert.equal(rms(muted), 0, "Level parameter is disconnected");
    slot.state = state;
    await audio.request("project", {
      ...nativeProject(p, "pattern", pattern.id),
      restoreStates: true,
    });
    const restored = await render();
    assert.ok(
      Math.abs(rms(restored) - originalRms) < 0.00001,
      "VST3 state did not restore audio",
    );
    slot.bypassed = true;
    assert.equal(
      rms(await render()),
      0,
      "Bypassing a generator activated the built-in fallback",
    );
    slot.bypassed = false;
    await render();
    const program = params.find((parameter) => parameter.name === "Program");
    assert.ok(program, "VST3 presets are not exposed");
    await audio.request("parameter", {
      ...args,
      index: program.index,
      value: 1,
    });
    await render();
    const selectedProgram = (await audio.request("parameters", args)).find(
      (parameter) => parameter.name === "Program",
    );
    assert.equal(selectedProgram.text, plugin.presetNames.at(-1));
    await audio.request("project", {
      ...nativeProject(p, "pattern", pattern.id),
      restoreStates: true,
    });
    await render();
    let frequencies;
    if (plugin.bundledId === "piano") {
      const c4 = fundamental(original, 240, 285);
      const c5 = fundamental(await render(72), 500, 550);
      assert.ok(Math.abs(c4 - 261.63) < 2 && Math.abs(c5 / c4 - 2) < 0.02);
      frequencies = { c4, c5 };
    } else if (plugin.bundledId === "kick") {
      const decayIndex = params.find((x) => x.name === "Decay ms").index;
      await audio.request("parameter", {
        ...args,
        index: decayIndex,
        value: 1,
      });
      const long = await render();
      const start = Math.floor(0.65 * 44100),
        end = Math.floor(0.9 * 44100);
      assert.ok(
        rms(long.slice(start, end)) > rms(original.slice(start, end)) * 5,
        "Kick decay does not affect its tail",
      );
    } else {
      const toneParameter = params.find(
        (p) =>
          p.name ===
          (plugin.bundledId === "triple"
            ? "Osc 1: sine/saw/pulse/triangle"
            : plugin.bundledId === "fm"
              ? "Modulator 1 index"
              : "String brightness"),
      );
      assert.ok(toneParameter, "Missing synthesis control");
      await audio.request("parameter", {
        ...args,
        index: toneParameter.index,
        value: 0,
      });
      const changed = await render();
      const difference = Math.sqrt(
        changed.reduce(
          (sum, sample, i) => sum + (sample - original[i]) ** 2,
          0,
        ) / changed.length,
      );
      assert.ok(
        difference > 0.0001,
        `${plugin.name}: synthesis control has no effect`,
      );
    }
    results.push({
      name: plugin.name,
      instrument: plugin.instrument,
      stableReference: slot.description.includes("studiowav-bundled:"),
      onset,
      rms: originalRms,
      parameters: params
        .map((p) => p.name)
        .filter((name) => !name.startsWith("MIDI CC ")),
      stateRestored: true,
      bypassProducesSilence: true,
      hostPresetChange: true,
      presets: plugin.presetNames,
      velocity: true,
      frequencies,
    });
    console.log(
      `${plugin.name}: real VST3 MIDI, export, parameters and state passed.`,
    );
  }
  await mkdir("test-results", { recursive: true });
  const demo = JSON.parse(
    await readFile("examples/Piano y kicks.studiowav", "utf8"),
  );
  await audio.request(
    "project",
    nativeProject(demo, "song", demo.patterns[0].id),
  );
  const demoAudio = (
    await audio.request("render", { sampleRate: 44100, bitDepth: 16 })
  ).audio;
  const demoRms = rms(pcm(demoAudio));
  assert.ok(demoRms > 0.01, "The bundled example is silent");
  await writeFile("test-results/piano-y-kicks.wav", Buffer.from(demoAudio));
  const report = {
    passed: true,
    checks,
    vst3: results,
    demo: {
      file: "examples/Piano y kicks.studiowav",
      rms: demoRms,
      rendered: true,
    },
    method:
      "Actual compiled plugin tests and StudioWav native host offline WAV rendering",
  };
  await writeFile(
    "test-results/instruments.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  audio.close();
  assert.ok(
    path
      .resolve(profile)
      .startsWith(path.join(os.tmpdir(), "studiowav-instruments-")),
  );
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
