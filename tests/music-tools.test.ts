import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  validateProject,
  eventsAtStep,
  playlistLanes,
} from "../src/model.ts";
import { nativeProject } from "../src/audio/native-project.ts";
import {
  defaultToolOptions,
  makeClipUnique,
  resizePattern,
  splitPatternChannels,
  transformNotes,
} from "../src/music-tools.ts";
import type { Note } from "../src/model.ts";
const note = (
  id: string,
  pitch: number,
  start: number,
  length: number,
): Note => ({ id, pitch, start, length, velocity: 0.8 });

test("one pattern clip plays every source channel and moving it between lanes preserves those sources", () => {
  const p = createProject(false),
    a = p.tracks[0],
    b = p.tracks[5],
    pat = p.patterns[0];
  pat.channels[a.id].steps[0] = 0.8;
  pat.channels[b.id].notes = [note("b", 36, 0, 2)];
  p.clips = [
    {
      id: "clip",
      trackId: a.id,
      laneId: p.tracks[7].id,
      scope: "pattern",
      patternId: pat.id,
      startBar: 2,
    },
  ];
  assert.deepEqual(
    new Set(eventsAtStep(p, 32, "song", pat.id).map((e) => e.track.id)),
    new Set([a.id, b.id]),
  );
  const before = nativeProject(p, "song", pat.id).events;
  p.clips[0].laneId = p.tracks[6].id;
  assert.deepEqual(nativeProject(p, "song", pat.id).events, before);
  p.lanes!.find((l) => l.id === p.clips[0].laneId)!.muted = true;
  assert.equal(eventsAtStep(p, 32, "song", pat.id).length, 0);
  assert.equal(eventsAtStep(p, 0, "pattern", pat.id).length, 2);
  assert.equal(a.muted, false);
  assert.equal(b.muted, false);
});
test("legacy channel clips and old project files retain their previous playback", () => {
  const p = createProject();
  p.clips = [
    {
      id: "old-clip",
      trackId: p.tracks[0].id,
      patternId: p.patterns[0].id,
      startBar: 0,
    },
  ];
  const before = nativeProject(p, "song", p.patterns[0].id).events;
  delete p.lanes;
  assert.deepEqual(
    nativeProject(validateProject(p), "song", p.patterns[0].id).events,
    before,
  );
  assert.equal(playlistLanes(p).length, p.tracks.length);
  assert.ok(before.every((e) => e.trackId === p.tracks[0].id));
});
test("fractional note positions survive validation and compile into native time rather than the containing step", () => {
  const p = createProject(false),
    t = p.tracks[5],
    pat = p.patterns[0];
  p.bpm = 120;
  p.swing = 0;
  pat.channels[t.id].notes = [note("fine", 36, 0.75, 0.5)];
  validateProject(p);
  assert.equal(eventsAtStep(p, 0, "pattern", pat.id)[0].step, 0.75);
  const event = nativeProject(p, "pattern", pat.id).events[0];
  assert.equal(event.time, 0.09375);
  assert.equal(event.duration, 0.0625);
});
test("resized patterns and looped clips schedule exactly the requested repetitions", () => {
  let p = createProject(false);
  const patId = p.patterns[0].id,
    t = p.tracks[0];
  p = resizePattern(p, patId, 64);
  p.patterns[0].channels[t.id].steps[48] = 0.7;
  p.clips = [
    {
      id: "loop",
      trackId: t.id,
      laneId: t.id,
      scope: "pattern",
      loop: true,
      patternId: patId,
      startBar: 0,
      lengthBars: 8,
    },
  ];
  validateProject(p);
  assert.deepEqual(
    nativeProject(p, "song", patId).events.map((e) => e.time),
    [(48 * 60) / p.bpm / 4, (112 * 60) / p.bpm / 4],
  );
  p = resizePattern(p, patId, 16);
  assert.equal(p.patterns[0].channels[t.id].steps.length, 16);
  assert.equal(nativeProject(p, "song", patId).events.length, 0);
});
test("make unique isolates one clip and split-by-channel keeps original pattern references intact", () => {
  const p = createProject(),
    clip = p.clips[0],
    copy = { ...clip, id: "second" };
  p.clips.push(copy);
  const q = makeClipUnique(p, clip.id),
    unique = q.clips.find((c) => c.id === clip.id)!;
  assert.notEqual(unique.patternId, clip.patternId);
  assert.equal(q.clips.at(-1)!.patternId, clip.patternId);
  q.patterns
    .find((v) => v.id === unique.patternId)!
    .channels[p.tracks[0].id].steps.fill(0);
  assert.equal(p.patterns[0].channels[p.tracks[0].id].steps[0], 0.85);
  const split = splitPatternChannels(p, p.patterns[0].id).project;
  assert.equal(split.patterns.length, p.patterns.length + 8);
  for (const part of split.patterns.slice(p.patterns.length))
    assert.equal(
      Object.values(part.channels).filter(
        (c) => c.notes.length || c.steps.some(Boolean),
      ).length,
      1,
    );
  assert.deepEqual(split.clips, p.clips);
});
test("quantize strength and articulation affect only selected notes without mutating the source", () => {
  const notes = [note("a", 60, 0.5, 1), note("b", 64, 4, 1)];
  const ids = new Set(["a"]);
  const q = transformNotes(
    notes,
    ids,
    "quantize",
    { ...defaultToolOptions, strength: 0.5 },
    32,
  );
  assert.equal(q[0].start, 0.75);
  assert.deepEqual(q[1], notes[1]);
  assert.equal(notes[0].start, 0.5);
  const l = transformNotes(
    notes,
    ids,
    "legato",
    { ...defaultToolOptions, gate: 0.5 },
    32,
  );
  assert.equal(l[0].length, 1.75);
  assert.equal(l[1].length, 1);
});
test("arpeggiate converts held chords into timed pitch sequences, gate and octave range", () => {
  const notes = [note("c", 60, 0, 8), note("e", 64, 0, 8), note("g", 67, 0, 8)];
  const arp = transformNotes(
    notes,
    new Set(),
    "arpeggio",
    { ...defaultToolOptions, octaves: 2, gate: 0.5 },
    32,
  );
  assert.deepEqual(
    arp.map((n) => n.pitch),
    [60, 64, 67, 72, 76, 79, 60, 64],
  );
  assert.deepEqual(
    arp.map((n) => n.start),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.ok(arp.every((n) => n.length === 0.5));
  assert.equal(new Set(arp.map((n) => n.id)).size, 8);
});
test("chop and flip preserve bounds and musical content, and chord insertion creates actual notes", () => {
  const notes = [note("a", 60, 0, 4), note("b", 67, 6, 2)];
  const chopped = transformNotes(
    notes,
    new Set(["a"]),
    "chop",
    { ...defaultToolOptions, grid: 0.5 },
    32,
  );
  assert.equal(chopped.length, 9);
  assert.equal(chopped.at(-1)!.id, "b");
  const flip = transformNotes(
    notes,
    new Set(),
    "flip",
    { ...defaultToolOptions, vertical: true },
    32,
  );
  assert.deepEqual(
    flip.map((n) => [n.pitch, n.start, n.length]),
    [
      [60, 0, 2],
      [67, 4, 4],
    ],
  );
  const chord = transformNotes(
    [],
    new Set(),
    "chord",
    { ...defaultToolOptions, chord: "minor7" },
    32,
  );
  assert.deepEqual(
    chord.map((n) => n.pitch),
    [60, 63, 67, 70],
  );
});
