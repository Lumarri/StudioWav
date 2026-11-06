import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createProject } from "../src/model.ts";
import { addPluginTrack, insertPlugin } from "../src/plugins.ts";
import { nativeProject } from "../src/audio/native-project.ts";
const { NativeAudio } = createRequire(import.meta.url)(
  "../electron/native.cjs",
);
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-external-"));
const audio = new NativeAudio(
  { isPackaged: false, getPath: () => profile },
  () => {},
);
try {
  const catalog = JSON.parse(
    await readFile(
      path.join(process.env.APPDATA, "StudioWav/plugin-catalog.json"),
      "utf8",
    ),
  );
  const instrument = catalog.find((p) => p.name === "TyrellN6" && p.instrument);
  const effect = catalog.find(
    (p) => p.name === "ValhallaFreqEcho" && !p.instrument,
  );
  assert.ok(instrument && effect, "Expected installed plugins are missing");
  await audio.request("init");
  const p = createProject(false);
  const track = addPluginTrack(p, instrument);
  insertPlugin(track, effect);
  p.tracks = [track];
  p.bpm = 120;
  p.swing = 0;
  p.patterns[0].channels[track.id].notes = [60, 64, 67].map((pitch, i) => ({
    id: `note${i}`,
    pitch,
    start: i * 4,
    length: 3,
    velocity: 0.8,
  }));
  await audio.request("project", nativeProject(p, "pattern", p.patterns[0].id));
  const rendered = Buffer.from(
    (await audio.request("render", { sampleRate: 44100, bitDepth: 16 })).audio,
  );
  let peak = 0;
  for (let at = 12; at + 8 <= rendered.length; ) {
    const size = rendered.readUInt32LE(at + 4);
    if (rendered.toString("ascii", at, at + 4) === "data") {
      for (let i = at + 8; i < at + 8 + size; i += 2)
        peak = Math.max(peak, Math.abs(rendered.readInt16LE(i) / 32768));
      break;
    }
    at += 8 + size + (size % 2);
  }
  assert.ok(peak > 0.005, `External VST3 chain is silent: ${peak}`);
  const states = await audio.request("states");
  assert.ok(track.plugins.every((p) => states[p.id]?.length > 0));
  const file = "test-results/installed-plugins.json";
  const report = JSON.parse(await readFile(file, "utf8"));
  report.hostedExample = {
    instrument: instrument.name,
    effect: effect.name,
    renderPeak: peak,
    stateCaptured: true,
  };
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.hostedExample));
} finally {
  audio.close();
  if (
    !path
      .resolve(profile)
      .startsWith(path.join(os.tmpdir(), "studiowav-external-"))
  )
    throw new Error("Unexpected profile");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
