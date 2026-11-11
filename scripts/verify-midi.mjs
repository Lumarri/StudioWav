import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { readMidi, writeMidi, importMidi } from "../src/midi.ts";
import { createProject } from "../src/model.ts";
import { nativeProject } from "../src/audio/native-project.ts";
const { NativeAudio } = createRequire(import.meta.url)(
  "../electron/native.cjs",
);
const directory = await mkdtemp(path.join(os.tmpdir(), "studiowav-midi-"));
const audio = new NativeAudio(
  { isPackaged: false, getPath: () => directory },
  () => {},
);
const verifier = path.resolve(
  "native/build/StudioWavMidiCheck_artefacts/Release/StudioWavMidiCheck.exe",
);
function juce(args) {
  const result = spawnSync(verifier, args, {
    windowsHide: true,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
try {
  const input = path.join(directory, "juce.mid");
  juce(["--fixture", input]);
  const song = readMidi(new Uint8Array(await readFile(input)));
  assert.equal(song.parts[0].notes[0].pitch, 67);
  assert.equal(song.parts[0].notes[0].start, 0.5);
  assert.equal(song.parts[0].notes[0].length, 3.5);
  const imported = importMidi(
    createProject(false),
    song,
    {
      replace: true,
      useTempo: true,
      startBar: 0,
      parts: song.parts.map((p) => p.id),
    },
    "JUCE round trip",
  );
  const midi = writeMidi(imported.project, "song", imported.patternId);
  const output = path.join(directory, "studiowav.mid");
  await writeFile(output, midi.bytes);
  const independent = juce([output]);
  assert.equal(independent.format, 1);
  assert.equal(independent.ppq, 960);
  assert.equal(independent.noteOns, 1);
  assert.equal(independent.noteOffs, 1);
  assert.equal(independent.firstTick, 120);
  assert.deepEqual(independent.pitches, [67]);
  await audio.request("init");
  await audio.request(
    "project",
    nativeProject(imported.project, "song", imported.patternId),
  );
  const wav = Buffer.from(
    (await audio.request("render", { sampleRate: 44100, bitDepth: 16 })).audio,
  );
  let first = -1,
    peak = 0;
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(at + 4);
    if (wav.toString("ascii", at, at + 4) === "data") {
      for (let i = 0; i < size; i += 4) {
        const value = Math.abs(wav.readInt16LE(at + 8 + i) / 32768);
        if (first < 0 && value > 3 / 32768) first = i / 4;
        peak = Math.max(peak, value);
      }
      break;
    }
    at += 8 + size + (size % 2);
  }
  assert.ok(first >= 2756 && first < 2820, `MIDI onset was ${first}`);
  assert.ok(peak > 0.03);
  const demo = JSON.parse(
    await readFile("examples/Piano y kicks.studiowav", "utf8"),
  );
  const demoMidi = writeMidi(demo, "song", demo.patterns[0].id);
  await writeFile("examples/Piano y kicks.mid", demoMidi.bytes);
  const demoRead = juce([path.resolve("examples/Piano y kicks.mid")]);
  assert.equal(demoRead.noteOns, demoMidi.notes);
  assert.equal(demoRead.noteOffs, demoMidi.notes);
  const report = {
    passed: true,
    thirdPartyCodec: "JUCE 8.0.12 MidiFile",
    decodedExternalFixture: true,
    sustainBakedIntoDuration: true,
    exportedReadByJuce: independent,
    nativeRenderer: {
      firstSignalSample: first,
      expectedMusicalOnset: 0.0625,
      peak,
    },
    demo: { notes: demoMidi.notes, tracks: demoMidi.tracks },
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/midi-engine.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  audio.close();
  assert.ok(
    path
      .resolve(directory)
      .startsWith(path.join(os.tmpdir(), "studiowav-midi-")),
  );
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
