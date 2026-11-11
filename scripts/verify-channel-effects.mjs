import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { signalProject } from "../tests/fixtures/effects.ts";
import { defaultChannelEffects } from "../src/channel-effects.ts";
import { createTrack, validateProject } from "../src/model.ts";
import { nativeProject } from "../src/audio/native-project.ts";
const { NativeAudio } = createRequire(import.meta.url)(
  "../electron/native.cjs",
);
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-channel-fx-"));
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
  throw new Error("Missing PCM");
}
function rms(data, from = 1, length = 0.1, channel = 0) {
  let sum = 0;
  const first = Math.round(from * 44100),
    count = Math.round(length * 44100);
  for (let i = first; i < first + count; ++i)
    sum += (data.readInt16LE(i * 4 + channel * 2) / 32768) ** 2;
  return Math.sqrt(sum / count);
}
async function render(p, rate = 44100) {
  validateProject(p);
  await audio.request("project", nativeProject(p, "song", p.patterns[0].id));
  return pcm(
    (await audio.request("render", { sampleRate: rate, bitDepth: 16 })).audio,
  );
}
try {
  await audio.request("init");
  const ratios = {};
  for (const [band, frequency, gain] of [
    ["low", 40, 12],
    ["mid", 1500, -12],
    ["high", 12000, -12],
  ]) {
    const p = signalProject(frequency),
      dry = await render(p);
    p.tracks[0].effects = defaultChannelEffects();
    const fx = p.tracks[0].effects;
    fx.eq.enabled = true;
    fx.eq[band] = gain;
    fx.eq.midHz = 1500;
    const wet = await render(p),
      ratio = rms(wet) / rms(dry);
    assert.ok(
      band === "low" ? ratio > 3.5 && ratio < 4.1 : ratio > 0.2 && ratio < 0.36,
      `${band}: ${ratio}`,
    );
    fx.eq.enabled = false;
    const bypass = await render(p);
    assert.deepEqual(bypass, dry, `${band}: bypass must restore original PCM`);
    ratios[band] = ratio;
  }
  const p = signalProject(0, 0.5),
    dry = await render(p);
  p.tracks[0].effects = defaultChannelEffects();
  const comp = p.tracks[0].effects.compressor;
  Object.assign(comp, {
    enabled: true,
    threshold: -24,
    ratio: 4,
    attack: 10,
    release: 150,
  });
  const compressed = await render(p),
    reductionRatio = rms(compressed) / rms(dry);
  // Sample playback scales the test's 0.5 amplitude by 0.8 before the compressor.
  // At -7.9588 dBFS with threshold -24 and ratio 4:1, gain reduction is 12.0309 dB.
  assert.ok(
    Math.abs(reductionRatio - 0.2503) < 0.005,
    `Static compression: ${reductionRatio}`,
  );
  const stereoRatio = rms(compressed, 1, 0.1, 1) / rms(compressed);
  assert.ok(Math.abs(stereoRatio - 0.2) < 0.002, `Stereo link: ${stereoRatio}`);
  comp.makeup = 6;
  const makeup = await render(p),
    makeupRatio = rms(makeup) / rms(compressed);
  assert.ok(Math.abs(makeupRatio - 10 ** (6 / 20)) < 0.005);
  comp.enabled = false;
  assert.deepEqual(await render(p), dry);
  // Compressing the sum on a bus must produce the same signal as on its source.
  comp.enabled = true;
  comp.makeup = 0;
  const settings = structuredClone(p.tracks[0].effects);
  delete p.tracks[0].effects;
  const bus = createTrack("keys", "Effects bus");
  bus.kind = "bus";
  bus.gain = 1;
  bus.pan = 0;
  bus.send = 0;
  bus.effects = settings;
  p.tracks[0].outputId = bus.id;
  p.tracks.push(bus);
  p.patterns[0].channels[bus.id] = { steps: Array(32).fill(0), notes: [] };
  const busAudio = await render(p);
  assert.ok(Math.abs(rms(busAudio) / rms(compressed) - 1) < 0.005);
  const payload = nativeProject(p, "song", p.patterns[0].id);
  payload.tracks[1].effects.compressor.attack = -1;
  await assert.rejects(audio.request("project", payload), /efectos/);
  p.tracks[1].effects.compressor.attack = 10;
  // Preview and the status meter exercise the realtime path, independently of offline render.
  await audio.request("project", nativeProject(p, "song", p.patterns[0].id));
  await audio.request("play", { step: 0 });
  let liveReduction = 0;
  for (let i = 0; i < 60 && liveReduction < 1; ++i) {
    await sleep(25);
    liveReduction = (await audio.request("status")).gainReduction[bus.id];
  }
  assert.ok(liveReduction > 1, `Live reduction meter: ${liveReduction}`);
  await audio.request("stop");
  const transient = signalProject(0, 0.5, (seconds) =>
    seconds < 0.25 || seconds >= 0.75 ? 0.1 : 1,
  );
  transient.tracks[0].effects = defaultChannelEffects();
  const timing = transient.tracks[0].effects.compressor;
  Object.assign(timing, {
    enabled: true,
    threshold: -24,
    ratio: 4,
    attack: 1,
    release: 10,
  });
  const fast = await render(transient);
  timing.attack = 200;
  const slowAttack = await render(transient);
  const attackRatio = rms(fast, 0.26, 0.02) / rms(slowAttack, 0.26, 0.02);
  assert.ok(attackRatio < 0.6, `Attack response: ${attackRatio}`);
  timing.attack = 1;
  timing.release = 1000;
  const slowRelease = await render(transient);
  const releaseRatio = rms(slowRelease, 0.85, 0.05) / rms(fast, 0.85, 0.05);
  assert.ok(releaseRatio < 0.6, `Release response: ${releaseRatio}`);
  const result = {
    passed: true,
    eqAmplitudeRatios: ratios,
    bypassPcmIdentical: true,
    compressionAmplitudeRatio: reductionRatio,
    stereoRatio,
    makeupRatio,
    busProcessing: true,
    attackResponseRatio: attackRatio,
    releaseResponseRatio: releaseRatio,
    liveGainReductionDb: liveReduction,
    invalidSettingsRejected: true,
  };
  await writeFile(
    "test-results/channel-effects-native.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  audio.close();
  if (
    !path
      .resolve(profile)
      .startsWith(path.join(os.tmpdir(), "studiowav-channel-fx-"))
  )
    throw new Error("Unexpected profile");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
