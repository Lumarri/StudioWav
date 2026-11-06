import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createProject, createTrack } from "../src/model.ts";
import { nativeProject } from "../src/audio/native-project.ts";
import { encodeWav } from "../src/audio/wav.ts";

const directory = path.resolve("test-results/native");
await mkdir(directory, { recursive: true });
const exe = path.resolve("native/bin/StudioWavAudio.exe");
const core = spawnSync(exe, ["--self-test", directory], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 20000,
});
assert.equal(core.status, 0, core.stderr || core.stdout);
console.log("DSP impulse, cycle rejection and MIDI observation passed.");
const child = spawn(exe, [], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const pending = new Map();
let nextId = 1;
const statuses = [];
let stderr = "";
child.stderr.on("data", (b) => (stderr += b));
createInterface({ input: child.stdout }).on("line", (line) => {
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    return;
  }
  if (data.event === "status") {
    statuses.push(data.data);
    return;
  }
  const entry = pending.get(data.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(data.id);
  if (data.error) entry.reject(new Error(data.error));
  else entry.resolve(data.result);
});
function call(command, args = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(
      () => reject(new Error(`${command} timed out. ${stderr}`)),
      45000,
    );
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, command, args }) + "\n");
  });
}
function pcm(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  let format, data;
  for (let at = 12; at + 8 <= buffer.length; ) {
    const name = buffer.toString("ascii", at, at + 4),
      size = buffer.readUInt32LE(at + 4);
    if (name === "fmt ")
      format = {
        channels: buffer.readUInt16LE(at + 10),
        rate: buffer.readUInt32LE(at + 12),
        bits: buffer.readUInt16LE(at + 22),
      };
    if (name === "data") {
      data = buffer.subarray(at + 8, at + 8 + size);
      break;
    }
    at += 8 + size + (size % 2);
  }
  assert.ok(format && data);
  let sum = 0,
    peak = 0;
  const bytes = format.bits / 8;
  for (let i = 0; i < data.length; i += bytes) {
    const v = data.readIntLE(i, bytes) / 2 ** (format.bits - 1);
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  return {
    ...format,
    peak,
    rms: Math.sqrt(sum / (data.length / bytes)),
    frames: data.length / bytes / format.channels,
  };
}
let renders = 0;
async function render(project) {
  await call(
    "project",
    nativeProject(project, "pattern", project.patterns[0].id),
  );
  const file = path.join(directory, `render-${++renders}.wav`);
  await rm(file, { force: true });
  await call("render", { path: file, sampleRate: 44100, bitDepth: 16 });
  return pcm(await readFile(file));
}
const report = { core: JSON.parse(core.stdout.trim()), checks: [],
  binarySha256: createHash("sha256").update(await readFile(exe)).digest("hex") };
try {
  const demo = createProject();
  const demoAudio = await render(demo);
  assert.equal(demoAudio.channels, 2);
  assert.equal(demoAudio.rate, 44100);
  assert.equal(demoAudio.bits, 16);
  assert.ok(demoAudio.peak > 0.05);
  report.checks.push({ name: "demo WAV", ...demoAudio });
  const muted = structuredClone(demo);
  muted.tracks.forEach((t) => (t.muted = true));
  const silence = await render(muted);
  assert.equal(silence.peak, 0);
  report.checks.push({ name: "all tracks muted", peak: silence.peak });
  const tone = createProject(false);
  const t = tone.tracks[6];
  tone.tracks = [t];
  tone.master = 0.8;
  t.gain = 0.8;
  t.send = 0;
  t.cutoff = 20000;
  tone.patterns[0].channels[t.id].notes = [
    { id: "tone", pitch: 60, start: 0, length: 8, velocity: 0.8 },
  ];
  const clean = await render(tone);
  assert.ok(clean.rms > 0.005);
  const fixture = path.resolve(
    "native/build/StudioWavTestGain_artefacts/Release/VST3/StudioWav Test Gain.vst3",
  );
  const found = await call("scan", { file: fixture });
  assert.equal(found.length, 1);
  const withPlugin = structuredClone(tone);
  withPlugin.tracks[0].plugins = [
    {
      id: "gain-fixture",
      name: found[0].name,
      description: found[0].description,
      bypassed: false,
    },
  ];
  const effected = await render(withPlugin);
  const ratio = effected.rms / clean.rms;
  assert.ok(Math.abs(ratio - 0.5) < 0.015, `VST3 gain ratio ${ratio}`);
  const state = await call("states");
  assert.ok(state["gain-fixture"]?.length > 0);
  const pluginStatus = await call("status");
  assert.equal(pluginStatus.pdcSamples, 64);
  report.checks.push({
    name: "VST3 fixture, state and reported latency",
    rmsRatio: ratio,
    pdcSamples: pluginStatus.pdcSamples,
  });
  await call("parameter", {
    trackId: t.id,
    pluginId: "gain-fixture",
    index: 0,
    value: 0.25,
  });
  const quarterState = await call("states");
  withPlugin.tracks[0].plugins[0].state = quarterState["gain-fixture"];
  await call("parameter", {
    trackId: t.id,
    pluginId: "gain-fixture",
    index: 0,
    value: 0.75,
  });
  await call("project", {
    ...nativeProject(withPlugin, "pattern", withPlugin.patterns[0].id),
    restoreStates: true,
  });
  const restored = await render(withPlugin);
  assert.ok(Math.abs(restored.rms / clean.rms - 0.25) < 0.015);
  report.checks.push({
    name: "edited VST3 parameter restored from project state",
    rmsRatio: restored.rms / clean.rms,
  });
  withPlugin.tracks[0].plugins[0].bypassed = true;
  const bypassed = await render(withPlugin);
  assert.ok(Math.abs(bypassed.rms / clean.rms - 1) < 0.015);
  report.checks.push({
    name: "VST3 bypass",
    rmsRatio: bypassed.rms / clean.rms,
  });
  const routed = structuredClone(tone),
    bus = createTrack("keys");
  bus.kind = "bus";
  bus.name = "Bus";
  bus.gain = 0.5;
  bus.send = 0;
  bus.cutoff = 20000;
  routed.tracks[0].outputId = bus.id;
  routed.tracks.push(bus);
  routed.patterns.forEach(
    (p) => (p.channels[bus.id] = { steps: Array(32).fill(0), notes: [] }),
  );
  const busAudio = await render(routed);
  assert.ok(Math.abs(busAudio.rms / clean.rms - 0.5) < 0.03);
  report.checks.push({
    name: "bus routing",
    rmsRatio: busAudio.rms / clean.rms,
  });
  const automated = structuredClone(tone);
  automated.tracks[0].automation = { gain: [{ step: 0, value: 0 }] };
  const automatedAudio = await render(automated);
  assert.equal(automatedAudio.peak, 0);
  report.checks.push({ name: "gain automation", peak: automatedAudio.peak });
  await call("init");
  const audition = createProject(false),
    auditionTrack = createTrack("sample", "Leading silence");
  auditionTrack.sampleId = "audition";
  auditionTrack.send = 0;
  audition.tracks = [auditionTrack];
  for (const pattern of audition.patterns)
    pattern.channels[auditionTrack.id] = {
      steps: Array(32).fill(0),
      notes: [],
    };
  const waveform = new Float32Array(35280);
  for (let i = 17640; i < waveform.length; i++)
    waveform[i] = Math.sin((2 * Math.PI * i * 440) / 44100) * 0.3;
  audition.samples = [
    {
      id: "audition",
      name: "Leading silence.wav",
      data:
        "data:audio/wav;base64," +
        Buffer.from(encodeWav([waveform], 44100)).toString("base64"),
      duration: 0.8,
    },
  ];
  await call(
    "project",
    nativeProject(audition, "pattern", audition.patterns[0].id),
  );
  await call("preview", { trackId: auditionTrack.id, pitch: 60 });
  await sleep(550);
  const auditionStatus = await call("status");
  assert.ok(auditionStatus.levels[auditionTrack.id] > 0.02);
  report.checks.push({
    name: "sample audition continues past 300 ms and initial silence",
    peak: auditionStatus.levels[auditionTrack.id],
  });
  await call("stop");
  const rejected = structuredClone(withPlugin);
  const slot = rejected.tracks[0].plugins[0];
  slot.bypassed = false;
  const missingDescription = slot.description.replace(
    /file="[^"]*"/,
    'file="D:/StudioWav-test-missing-plugin.vst3"',
  );
  assert.notEqual(missingDescription, slot.description);
  slot.description = missingDescription;
  await assert.rejects(
    call(
      "project",
      nativeProject(rejected, "pattern", rejected.patterns[0].id),
    ),
  );
  audition.tracks[0].delaySamples = 1;
  await call(
    "project",
    nativeProject(audition, "pattern", audition.patterns[0].id, false),
  );
  await call("preview", { trackId: auditionTrack.id, pitch: 60 });
  await sleep(550);
  const recovered = await call("status");
  assert.ok(recovered.levels[auditionTrack.id] > 0.02);
  report.checks.push({
    name: "failed plugin load preserves the previous sample cache",
    peak: recovered.levels[auditionTrack.id],
  });
  await call("stop");
  const devices = await call("devices");
  assert.ok(devices.types.length > 0);
  report.devices = devices;
  await call("project", nativeProject(demo, "pattern", demo.patterns[0].id));
  const recording = path.join(directory, "master-recording.wav");
  await rm(recording, { force: true });
  await call("recordStart", { source: "master", path: recording });
  await call("play", { step: 0 });
  await sleep(900);
  await call("pause");
  await call("recordStop");
  const recorded = pcm(await readFile(recording));
  assert.ok(recorded.frames > 10000 && recorded.peak > 0.05);
  report.checks.push({
    name: "live callback and master recording",
    ...recorded,
  });
  report.liveStatus = await call("status");
  report.passed = true;
  if (
    devices.types
      .find((type) => type.name === "ASIO")
      ?.outputs.includes("FL Studio ASIO")
  ) {
    await call("configure", {
      type: "ASIO",
      output: "FL Studio ASIO",
      input: "",
      sampleRate: 48000,
      bufferSize: 512,
    });
    await call("project", nativeProject(demo, "pattern", demo.patterns[0].id));
    await call("play");
    await sleep(600);
    const asio = await call("status");
    assert.equal(asio.driver, "ASIO");
    assert.ok(statuses.slice(-10).some((s) => s.levels.master > 0.03));
    report.asioStatus = asio;
    report.checks.push({
      name: "FL Studio ASIO live callback",
      sampleRate: asio.sampleRate,
      bufferSize: asio.bufferSize,
    });
    await call("pause");
    await call("configure", {
      type: devices.type,
      output: devices.output,
      input: devices.input,
      sampleRate: devices.sampleRate,
      bufferSize: devices.bufferSize,
    });
  }
  await writeFile(
    path.join(directory, "integration.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        checks: report.checks.length,
        core: report.core,
        asio: report.asioStatus
          ? {
              driver: report.asioStatus.driver,
              sampleRate: report.asioStatus.sampleRate,
              bufferSize: report.asioStatus.bufferSize,
            }
          : null,
        evidence: path.join(directory, "integration.json"),
      },
      null,
      2,
    ),
  );
} finally {
  child.stdin.end(JSON.stringify({ command: "quit" }) + "\n");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000).then(() => child.kill()),
  ]);
  for (const entry of pending.values()) clearTimeout(entry.timer);
}
