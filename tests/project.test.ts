import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  eventsAtStep,
  eventTime,
  validateProject,
  validateMixer,
  mixerPlan,
  audibleTracks,
  automationValue,
  createTrack,
} from "../src/model.ts";
import { nativeProject } from "../src/audio/native-project.ts";
import { encodeWav } from "../src/audio/wav.ts";

test("the demo survives a self-contained project save and reload", () => {
  const project = createProject();
  assert.deepEqual(
    validateProject(JSON.parse(JSON.stringify(project))),
    project,
  );
  assert.notStrictEqual(validateProject(project), project);
});

test("song events follow clip placement rather than repeating every pattern forever", () => {
  const project = createProject(false);
  const track = project.tracks[0];
  const pattern = project.patterns[0];
  pattern.channels[track.id].steps[0] = 0.8;
  project.clips.push({
    id: "clip",
    trackId: track.id,
    patternId: pattern.id,
    startBar: 2,
  });
  assert.equal(eventsAtStep(project, 0, "song", pattern.id).length, 0);
  assert.equal(eventsAtStep(project, 32, "song", pattern.id).length, 1);
  assert.equal(eventsAtStep(project, 64, "song", pattern.id).length, 0);
  assert.equal(eventsAtStep(project, 64, "pattern", pattern.id).length, 1);
});

test("mute and solo routing removes inactive voices from both render modes", () => {
  const project = createProject();
  const pattern = project.patterns[0];
  project.tracks.forEach((track) => {
    track.solo = false;
    track.muted = false;
  });
  const soloTrack = project.tracks[5];
  soloTrack.solo = true;
  const events = eventsAtStep(project, 0, "pattern", pattern.id);
  assert.ok(events.length > 0);
  assert.ok(events.every((event) => event.track.id === soloTrack.id));
  soloTrack.muted = true;
  assert.equal(eventsAtStep(project, 0, "pattern", pattern.id).length, 0);
});

test("swing delays offbeats without changing whole-bar duration", () => {
  assert.equal(eventTime(16, 120, 0.5), 2);
  assert.equal(eventTime(0, 120, 0.5), 0);
  assert.ok(eventTime(1, 120, 0.5) > eventTime(1, 120, 0));
  for (let step = 1; step < 128; step++)
    assert.ok(eventTime(step, 40, 0.6) > eventTime(step - 1, 40, 0.6));
});

test("invalid file contents cannot schedule unbounded notes, tempo or clips", () => {
  const project = createProject();
  assert.throws(() => validateProject({ ...project, bpm: 0 }));
  assert.throws(() =>
    validateProject({
      ...project,
      clips: [{ ...project.clips[0], startBar: 100 }],
    }),
  );
  const invalid = structuredClone(project);
  invalid.patterns[0].channels[invalid.tracks[5].id].notes[0].length = 1000000;
  assert.throws(() => validateProject(invalid));
});

test("WAV output preserves stereo order, signed PCM endpoints and file lengths", () => {
  const buffer = encodeWav(
    [new Float32Array([-1, 0, 1]), new Float32Array([0.5, -0.5, NaN])],
    44100,
  );
  const bytes = new DataView(buffer);
  assert.equal(buffer.byteLength, 56);
  assert.equal(new TextDecoder().decode(new Uint8Array(buffer, 0, 4)), "RIFF");
  assert.equal(bytes.getUint32(4, true), 48);
  assert.equal(bytes.getUint16(22, true), 2);
  assert.equal(bytes.getUint32(24, true), 44100);
  assert.equal(bytes.getUint32(40, true), 12);
  assert.equal(bytes.getInt16(44, true), -32768);
  assert.equal(bytes.getInt16(46, true), 16384);
  assert.equal(bytes.getInt16(52, true), 32767);
  assert.equal(bytes.getInt16(54, true), 0);
});

test("routing compensates direct and bus paths and rejects a feedback cycle", () => {
  const p = createProject(false),
    a = p.tracks[0],
    b = p.tracks[1],
    bus = createTrack("keys");
  bus.kind = "bus";
  p.tracks = [a, b, bus];
  a.delaySamples = 256;
  b.delaySamples = 64;
  a.outputId = bus.id;
  b.outputId = bus.id;
  const plan = mixerPlan(p, 48000, { [bus.id]: 128 });
  assert.equal(plan.arrival[bus.id], 256);
  assert.equal(plan.masterLatency, 384);
  assert.equal(plan.edges.find((e) => e.from === b.id)!.compensation, 192);
  bus.outputId = a.id;
  assert.throws(() => validateMixer(p), /ciclo/);
});
test("soloing one child of a bus excludes its siblings, while soloing the bus includes them", () => {
  const p = createProject(false),
    a = p.tracks[0],
    b = p.tracks[1],
    bus = createTrack("keys");
  bus.kind = "bus";
  p.tracks = [a, b, bus];
  a.outputId = bus.id;
  b.outputId = bus.id;
  a.solo = true;
  assert.deepEqual(audibleTracks(p), new Set([a.id, bus.id]));
  a.solo = false;
  bus.solo = true;
  assert.deepEqual(audibleTracks(p), new Set([a.id, b.id, bus.id]));
  b.muted = true;
  assert.equal(audibleTracks(p).has(b.id), false);
});
test("automation clamps its ends, interpolates points and rejects unsorted or invalid lanes", () => {
  const points = [
    { step: 4, value: 0.2 },
    { step: 8, value: 1 },
  ];
  assert.equal(automationValue(points, 0, 0.5), 0.2);
  assert.ok(Math.abs(automationValue(points, 6, 0.5) - 0.6) < 1e-6);
  assert.equal(automationValue(points, 99, 0.5), 1);
  const p = createProject();
  p.tracks[0].automation = {
    gain: [
      { step: 8, value: 1 },
      { step: 4, value: 0 },
    ],
  };
  assert.throws(() => validateProject(p), /automatización/);
});
test("native event times preserve swing, audio duration and muted sources for mixer switching", () => {
  const p = createProject(false),
    t = p.tracks[0];
  t.instrument = "sample";
  t.sampleId = "audio";
  t.muted = true;
  p.samples = [
    { id: "audio", name: "take", data: "data:audio/wav;base64,", duration: 12 },
  ];
  p.patterns[0].channels[t.id].steps[1] = 0.7;
  const payload = nativeProject(p, "pattern", p.patterns[0].id);
  assert.equal(payload.events.length, 1);
  assert.ok(Math.abs(payload.events[0].duration - 12) < 1e-9);
  assert.equal(payload.events[0].time, eventTime(1, p.bpm, p.swing));
});
