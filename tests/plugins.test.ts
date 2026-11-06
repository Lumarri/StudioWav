import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, createTrack, validateProject } from "../src/model.ts";
import { addPluginTrack, insertPlugin } from "../src/plugins.ts";
import type { FoundPlugin } from "../src/audio/desktop-engine.ts";
const piano: FoundPlugin = {
  name: "Piano",
  manufacturer: "StudioWav",
  instrument: true,
  description: '<PLUGIN file="studiowav-bundled:piano" isInstrument="1"/>',
  path: "piano",
  bundledId: "piano",
};
test("a VST3 instrument gets its own channel in every pattern without inserting arrangement clips", () => {
  const p = createProject(false),
    clips = structuredClone(p.clips);
  p.patterns.push({
    ...structuredClone(p.patterns[0]),
    id: "long",
    length: 64,
    channels: Object.fromEntries(
      p.tracks.map((t) => [t.id, { notes: [], steps: Array(64).fill(0) }]),
    ),
  });
  const track = addPluginTrack(p, piano);
  assert.equal(track.plugins?.[0].instrument, true);
  assert.equal(p.patterns.at(-1)!.channels[track.id].steps.length, 64);
  assert.deepEqual(p.patterns[0].channels[track.id].notes, []);
  assert.deepEqual(p.clips, clips);
  validateProject(p);
});
test("replacing a generator preserves its effect chain and rejects a bus or ninth effect", () => {
  const track = createTrack("keys");
  insertPlugin(track, piano);
  const effect = {
    ...piano,
    name: "Gain",
    instrument: false,
    description: '<PLUGIN isInstrument="0"/>',
  };
  for (let i = 0; i < 7; i++) insertPlugin(track, effect);
  const ids = track.plugins!.slice(1).map((s) => s.id);
  insertPlugin(track, { ...piano, name: "Other piano" });
  assert.equal(track.plugins?.length, 8);
  assert.equal(track.plugins![0].name, "Other piano");
  assert.deepEqual(
    track.plugins!.slice(1).map((s) => s.id),
    ids,
  );
  assert.throws(() => insertPlugin(track, effect), /ocho/);
  track.kind = "bus";
  assert.throws(() => insertPlugin(track, piano), /rack/);
});
