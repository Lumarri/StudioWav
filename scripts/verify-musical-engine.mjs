import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createProject, validateProject } from "../src/model.ts";
import { nativeProject } from "../src/audio/native-project.ts";
import {
  resizePattern,
  transformNotes,
  defaultToolOptions,
} from "../src/music-tools.ts";
const { NativeAudio } = createRequire(import.meta.url)(
  "../electron/native.cjs",
);
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-musical-"));
const audio = new NativeAudio(
  { isPackaged: false, getPath: () => profile },
  () => {},
);
function pcm(bytes) {
  const b = Buffer.from(bytes);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  let at = 12;
  while (at + 8 <= b.length) {
    const size = b.readUInt32LE(at + 4);
    if (b.toString("ascii", at, at + 4) === "data")
      return b.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw new Error("Missing WAV data");
}
function firstSignal(data) {
  for (let i = 0; i < data.length; i += 4)
    if (Math.abs(data.readInt16LE(i)) > 2) return i / 4;
  return -1;
}
function rms(data, seconds) {
  let sum = 0;
  const from = Math.floor(seconds * 44100) * 4;
  for (let i = from; i < Math.min(from + 4410 * 4, data.length); i += 4)
    sum += (data.readInt16LE(i) / 32768) ** 2;
  return Math.sqrt(sum / 4410);
}
try {
  await audio.request("init");
  let p = createProject(false);
  p = resizePattern(p, p.patterns[0].id, 16);
  p.bpm = 120;
  p.swing = 0;
  p.master = 0.6;
  const a = p.tracks[6],
    b = p.tracks[5],
    pat = p.patterns[0];
  p.tracks = [a, b];
  for (const t of p.tracks) {
    t.send = 0;
    t.gain = 0.7;
    t.cutoff = 20000;
  }
  pat.channels[a.id].notes = [
    { id: "a", pitch: 60, start: 0.5, length: 1, velocity: 0.8 },
  ];
  pat.channels[b.id].notes = [
    { id: "b", pitch: 36, start: 8.25, length: 1, velocity: 0.8 },
  ];
  p.lanes = [
    {
      id: "arrangement-lane",
      name: "Patrones",
      color: "#8bb6df",
      muted: false,
    },
    { id: "other-lane", name: "Otra pista", color: "#8bb6df", muted: false },
  ];
  p.clips = [
    {
      id: "pattern",
      trackId: a.id,
      laneId: p.lanes[0].id,
      scope: "pattern",
      loop: true,
      patternId: pat.id,
      startBar: 0,
      lengthBars: 2,
    },
  ];
  const render = async () => {
    validateProject(p);
    await audio.request("project", nativeProject(p, "song", pat.id));
    return pcm(
      (await audio.request("render", { sampleRate: 44100, bitDepth: 16 }))
        .audio,
    );
  };
  const music = await render(),
    first = firstSignal(music);
  assert.ok(first >= 2756 && first < 2856, `Fractional onset at ${first}`);
  const windows = [0.08, 1.05, 2.08, 3.05].map((s) => rms(music, s));
  assert.ok(
    windows.every((r) => r > 0.001),
    JSON.stringify(windows),
  );
  p.clips[0].laneId = p.lanes[1].id;
  const moved = await render();
  assert.ok(Math.abs(rms(moved, 0.08) - windows[0]) < 0.0001);
  p.lanes[1].muted = true;
  const muted = await render();
  assert.equal(firstSignal(muted), -1);
  p.lanes[1].muted = false;
  pat.channels[a.id].notes = transformNotes(
    pat.channels[a.id].notes,
    new Set(),
    "quantize",
    { ...defaultToolOptions, strength: 0.5 },
    16,
  );
  const quantized = await render(),
    after = firstSignal(quantized);
  assert.ok(
    Math.abs(after - first - 1378) < 35,
    `Onset delta ${after - first}`,
  );
  const result = {
    passed: true,
    backend: "native C++ renderer",
    channels: 2,
    patternSteps: 16,
    clipRepetitions: 2,
    laneMovePreservesAudio: true,
    laneMuteProducesSilence: true,
    fractionalOnsetSample: first,
    halfStrengthQuantizedOnsetSample: after,
    rmsAtFourNoteWindows: windows,
    sampleRate: 44100,
  };
  await writeFile(
    "test-results/musical-engine.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  audio.close();
  if (
    !path
      .resolve(profile)
      .startsWith(path.resolve(os.tmpdir()) + path.sep + "studiowav-musical-")
  )
    throw new Error("Unexpected test directory");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
}
