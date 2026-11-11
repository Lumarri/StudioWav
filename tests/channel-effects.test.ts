import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, createTrack, validateProject } from "../src/model.ts";
import {
  defaultChannelEffects,
  effectPresets,
  validateChannelEffects,
} from "../src/channel-effects.ts";
import { nativeProject } from "../src/audio/native-project.ts";

test("legacy projects remain dry, effect defaults and presets are independent and valid", () => {
  const p = createProject();
  assert.ok(p.tracks.every((t) => t.effects === undefined));
  validateProject(p);
  const a = defaultChannelEffects(),
    b = defaultChannelEffects();
  a.eq.low = 8;
  assert.equal(b.eq.low, 0);
  assert.equal(b.eq.enabled, false);
  assert.equal(b.compressor.enabled, false);
  for (const preset of Object.values(effectPresets))
    validateChannelEffects(preset.settings);
});

test("effect state survives saving and reaches native sources and buses without changing events or PDC", () => {
  const p = createProject();
  const before = nativeProject(p, "song", p.patterns[0].id);
  p.tracks[0].effects = structuredClone(effectPresets.drums.settings);
  const bus = createTrack("keys", "Drum bus");
  bus.kind = "bus";
  bus.effects = structuredClone(effectPresets.gentle.settings);
  p.tracks.push(bus);
  for (const pat of p.patterns)
    pat.channels[bus.id] = { steps: Array(pat.length).fill(0), notes: [] };
  p.tracks[0].outputId = bus.id;
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  const payload = nativeProject(restored, "song", p.patterns[0].id);
  assert.deepEqual(payload.tracks[0].effects, effectPresets.drums.settings);
  assert.deepEqual(
    payload.tracks.at(-1)!.effects,
    effectPresets.gentle.settings,
  );
  assert.deepEqual(payload.events, before.events);
  assert.equal(payload.tracks[0].delaySamples, before.tracks[0].delaySamples);
  restored.tracks[0].effects!.eq.enabled = false;
  assert.equal(restored.tracks[0].effects!.eq.low, 2);
});

test("invalid and non-finite effect parameters are rejected even when bypassed", () => {
  const p = createProject();
  const bad: unknown[] = [
    null,
    [],
    {},
    { eq: {} },
    {
      ...defaultChannelEffects(),
      eq: { ...defaultChannelEffects().eq, enabled: 1 },
    },
    {
      ...defaultChannelEffects(),
      eq: { ...defaultChannelEffects().eq, low: NaN },
    },
    {
      ...defaultChannelEffects(),
      eq: { ...defaultChannelEffects().eq, midHz: 90000 },
    },
    {
      ...defaultChannelEffects(),
      compressor: { ...defaultChannelEffects().compressor, ratio: 0 },
    },
    {
      ...defaultChannelEffects(),
      compressor: { ...defaultChannelEffects().compressor, attack: -1 },
    },
    {
      ...defaultChannelEffects(),
      compressor: { ...defaultChannelEffects().compressor, makeup: Infinity },
    },
  ];
  for (const value of bad) {
    p.tracks[0].effects = value as any;
    assert.throws(() => validateProject(p), /[Ee]fectos/);
  }
});
