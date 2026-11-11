import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readMidi,
  writeMidi,
  importMidi,
  MIDI_MAX_BYTES,
} from "../src/midi.ts";
import {
  createProject,
  createTrack,
  validateProject,
} from "../src/model.ts";
import { nativeProject } from "../src/audio/native-project.ts";
import type { MidiSong } from "../src/midi.ts";

import { fixture, melodyFixture } from "./fixtures/midi.ts";
const all = (song: MidiSong, replace = true) => ({
  parts: song.parts.map((p) => p.id),
  replace,
  useTempo: true,
  startBar: 0,
});

test("type 0 running status, velocity-zero offs, PPQ and names decode into fractional editable notes", () => {
  const song = readMidi(melodyFixture());
  assert.equal(song.format, 0);
  assert.equal(song.bpm, 120);
  assert.equal(song.ppq, 480);
  assert.equal(song.parts[0].name, "Piano");
  assert.deepEqual(
    song.parts[0].notes.map((n) => [n.pitch, n.start, n.length]),
    [
      [60, 0.5, 1.5],
      [64, 1, 1],
    ],
  );
  assert.equal(song.parts[0].notes[0].velocity, 100 / 127);
  const original = createProject();
  const loaded = importMidi(original, song, all(song), "Test");
  validateProject(loaded.project);
  const events = nativeProject(loaded.project, "song", loaded.patternId).events;
  assert.equal(events[0].time, 0.0625);
  assert.equal(events[0].duration, 0.1875);
  assert.equal(original.tracks.length, 8);
});

test("controllers in another type 1 track sustain the same port/channel and drum voices are separated", () => {
  const song = readMidi(
    fixture([
      [0, 176, 64, 127, 0x83, 96, 176, 64, 0, 0, 255, 47, 0],
      [0, 144, 60, 100, 120, 128, 60, 0, 0, 255, 47, 0],
      [
        0, 153, 36, 100, 0, 153, 42, 60, 120, 137, 36, 0, 0, 137, 42, 0, 0, 255,
        47, 0,
      ],
    ]),
  );
  const piano = song.parts.find((p) => p.channel === 0)!;
  assert.equal(piano.notes[0].length, 4);
  assert.deepEqual(
    song.parts.filter((p) => p.channel === 9).map((p) => p.drumNote),
    [36, 42],
  );
  const loaded = importMidi(createProject(false), song, all(song), "Kit");
  assert.deepEqual(
    loaded.project.tracks.map((t) => t.instrument),
    ["keys", "kick", "hat"],
  );
  assert.equal(
    loaded.project.patterns[0].channels[loaded.project.tracks[1].id].notes[0]
      .pitch,
    60,
  );
  const roundTrip = readMidi(
    writeMidi(loaded.project, "song", loaded.patternId).bytes,
  );
  assert.deepEqual(
    roundTrip.parts.filter((p) => p.channel === 9).map((p) => p.drumNote),
    [36, 42],
  );
});

test("all-sound-off stops existing voices without resetting a still-held sustain pedal", () => {
  const song = readMidi(
    fixture([
      [
        0, 176, 64, 127, 0, 144, 60, 100, 60, 128, 60, 0, 60, 176, 120, 0, 0,
        144, 64, 100, 60, 128, 64, 0, 0x82, 0x2c, 176, 64, 0, 0, 255, 47, 0,
      ],
    ]),
  );
  assert.deepEqual(
    song.parts[0].notes.map((n) => [n.pitch, n.start, n.length]),
    [
      [60, 0, 1],
      [64, 1, 3],
    ],
  );
});

test("tempo changes and non-4/4 grids are reported, SysEx is bounded and unclosed notes are released", () => {
  const song = readMidi(
    fixture([
      [
        0, 255, 88, 4, 3, 2, 24, 8, 0, 240, 2, 1, 247, 0, 144, 60, 100, 120,
        255, 81, 3, 6, 26, 128, 0, 255, 47, 0,
      ],
    ]),
  );
  assert.equal(song.bpm, 120);
  assert.equal(song.parts[0].notes[0].length, 1);
  assert.equal(song.warnings.length, 4);
});

test("malformed files, excessive timing, SMPTE, type 2, bad data and oversized files fail before project changes", () => {
  const bad = [
    new Uint8Array(),
    melodyFixture().slice(0, -1),
    fixture([[0, 60, 1, 0, 255, 47, 0]]),
    fixture([[128, 128, 128, 128, 0, 144, 60, 100]]),
    fixture([[0, 144, 200, 2, 0, 255, 47, 0]]),
    fixture([[0, 255, 47, 1, 0]]),
    fixture([[0, 255, 47, 0]], 2),
    fixture([[0, 255, 47, 0]], 0, 0xe728),
    new Uint8Array(MIDI_MAX_BYTES + 1),
  ];
  for (const bytes of bad) assert.throws(() => readMidi(bytes));
  assert.throws(
    () => readMidi(fixture([[0x88, 0x80, 0, 144, 60, 100, 0, 255, 47, 0]])),
    /64 compases/,
  );
});

test("append is transactional, preserves plugin metadata, supports part selection and validates capacities", () => {
  const song = readMidi(melodyFixture()),
    p = createProject();
  p.tracks[0].plugins = [
    {
      id: "fx",
      name: "Example",
      description: "XML",
      state: "saved",
      bypassed: false,
    },
  ];
  const copy = structuredClone(p);
  const imported = importMidi(
    p,
    song,
    { ...all(song, false), useTempo: false, startBar: 4 },
    "Append",
  );
  assert.deepEqual(p, copy);
  assert.equal(imported.project.clips.at(-1)!.startBar, 4);
  assert.deepEqual(imported.project.tracks[0].plugins, p.tracks[0].plugins);
  assert.equal(imported.project.bpm, p.bpm);
  assert.throws(
    () => importMidi(p, song, { ...all(song), parts: ["missing"] }, "X"),
    /partes/,
  );
  assert.throws(
    () =>
      importMidi(
        p,
        song,
        { ...all(song), parts: [song.parts[0].id, song.parts[0].id] },
        "X",
      ),
    /partes/,
  );
  assert.throws(
    () => importMidi(p, { ...song, bpm: 300 }, all(song), "X"),
    /tempo/,
  );
  for (let i = p.tracks.length; i < 32; i++) p.tracks.push(createTrack("keys"));
  assert.throws(() => importMidi(p, song, all(song, false), "X"), /32 canales/);
});

test("long imported phrases fill the arrangement and explicitly report rearticulated boundary notes", () => {
  const song = readMidi(melodyFixture());
  song.length = 132;
  song.parts[0].notes = [
    { pitch: 60, start: 127, length: 3, velocity: 0.8 },
    { pitch: 64, start: 131, length: 1, velocity: 0.6 },
  ];
  const loaded = importMidi(createProject(false), song, all(song), "Long");
  assert.deepEqual(
    loaded.project.patterns.map((p) => p.length),
    [128, 16],
  );
  assert.deepEqual(
    loaded.project.clips.map((c) => c.startBar),
    [0, 8],
  );
  assert.equal(loaded.project.bars, 9);
  assert.ok(loaded.warnings.some((w) => w.includes("rearticulan")));
  const notes = loaded.project.patterns.map(
    (p) => p.channels[loaded.trackId].notes,
  );
  assert.equal(notes[0][0].length, 1);
  assert.equal(notes[1][0].length, 2);
  validateProject(loaded.project);
});

test("export follows audible arrangement sources, mutes, fractional timing and swing; samples cannot masquerade as MIDI", () => {
  const p = createProject(false),
    track = p.tracks[6],
    pat = p.patterns[0];
  p.swing = 0.4;
  pat.channels[track.id].notes = [
    { id: "n", pitch: 65, start: 1.5, length: 2, velocity: 0.7 },
  ];
  p.clips = [
    {
      id: "c",
      trackId: track.id,
      patternId: pat.id,
      laneId: p.lanes![0].id,
      scope: "pattern",
      startBar: 2,
    },
  ];
  const decoded = readMidi(writeMidi(p, "song", pat.id).bytes);
  assert.equal(decoded.parts.length, 1);
  assert.equal(decoded.parts[0].notes[0].start, 33.7);
  p.lanes![0].muted = true;
  assert.throws(() => writeMidi(p, "song", pat.id), /No hay notas/);
  assert.equal(
    readMidi(writeMidi(p, "pattern", pat.id).bytes).parts[0].notes[0].start,
    1.7,
  );
});

test("32 melodic streams use distinct MIDI ports and preserve programs and names", () => {
  const p = createProject(false);
  p.tracks = Array.from({ length: 32 }, (_, i) => ({
    ...createTrack("keys", `Track ${i}`),
    midiProgram: i,
  }));
  p.patterns = p.patterns.slice(0, 1);
  const pat = p.patterns[0];
  pat.channels = Object.fromEntries(
    p.tracks.map((t, i) => [
      t.id,
      {
        steps: Array(32).fill(0),
        notes: [
          { id: `n${i}`, pitch: 40 + i, start: 0, length: 2, velocity: 0.8 },
        ],
      },
    ]),
  );
  const song = readMidi(writeMidi(p, "pattern", pat.id).bytes);
  assert.equal(song.parts.length, 32);
  assert.equal(
    new Set(song.parts.map((p) => `${p.port}:${p.channel}`)).size,
    32,
  );
  assert.deepEqual(
    song.parts.map((p) => p.program),
    Array.from({ length: 32 }, (_, i) => i),
  );
  assert.equal(song.parts[0].name, "Track 0");
});
