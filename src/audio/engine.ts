import {
  clamp,
  eventTime,
  eventsAtStep,
  audibleTracks,
  mixerPlan,
  automationValue,
} from "../model.ts";
import type { Mode, Project, Track } from "../model.ts";
import { encodeWav } from "./wav.ts";
import { defaultChannelEffects } from "../channel-effects.ts";
import compressorWorkletUrl from "./compressor-worklet.js?url&no-inline";

type Source = AudioScheduledSourceNode;
type Bus = {
  effectsIn: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  compressor: AudioWorkletNode;
  reduction: { value: number };
  source: GainNode;
  input: BiquadFilterNode;
  gain: GainNode;
  gate: GainNode;
  pan: StereoPannerNode;
  send: GainNode;
  meter: AnalyserNode;
};
type Graph = {
  master: GainNode;
  meter: AnalyserNode;
  delay: DelayNode;
  buses: Map<string, Bus>;
  signature: string;
  routes: Map<string, GainNode>;
  dispose: () => void;
};
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(
    1,
    context.sampleRate,
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let state = 123456789;
  for (let i = 0; i < data.length; i++) {
    state = (1664525 * state + 1013904223) >>> 0;
    data[i] = state / 2147483648 - 1;
  }
  return buffer;
}

const workletModules = new WeakMap<BaseAudioContext, Promise<void>>();
async function makeGraph(
  context: BaseAudioContext,
  project: Project,
): Promise<Graph> {
  let module = workletModules.get(context);
  if (!module) {
    module = context.audioWorklet.addModule(compressorWorkletUrl);
    module.catch(() => workletModules.delete(context));
    workletModules.set(context, module);
  }
  await module;
  const plan = mixerPlan(project, context.sampleRate);
  const extra: AudioNode[] = [];
  const routes = new Map<string, GainNode>();
  const master = context.createGain();
  master.gain.value = project.master;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 2;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  const meter = context.createAnalyser();
  meter.fftSize = 256;
  master.connect(limiter);
  limiter.connect(meter);
  meter.connect(context.destination);
  const delay = context.createDelay(2);
  delay.delayTime.value = 60 / project.bpm / 2;
  const feedback = context.createGain();
  feedback.gain.value = 0.26;
  const returnGain = context.createGain();
  returnGain.gain.value = 0.32;
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(returnGain);
  returnGain.connect(master);
  const buses = new Map<string, Bus>();
  const audible = audibleTracks(project);
  project.tracks.forEach((track) => {
    const input = context.createBiquadFilter();
    const effectsIn = context.createGain();
    const low = context.createBiquadFilter(),
      mid = context.createBiquadFilter(),
      high = context.createBiquadFilter();
    low.type = "lowshelf";
    mid.type = "peaking";
    high.type = "highshelf";
    low.frequency.value = 120;
    high.frequency.value = Math.min(8000, context.sampleRate * 0.45);
    mid.Q.value = 0.7;
    const compressor = new AudioWorkletNode(context, "studiowav-compressor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    const reduction = { value: 0 };
    compressor.port.onmessage = (e) => {
      if (Number.isFinite(e.data)) reduction.value = Math.max(0, e.data);
    };
    effectsIn.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(compressor);
    compressor.connect(input);
    const source = context.createGain();
    const local = context.createDelay(8);
    local.delayTime.value = plan.arrival[track.id] / context.sampleRate;
    source.connect(local);
    local.connect(effectsIn);
    extra.push(local);
    const manual = context.createDelay(8);
    manual.delayTime.value = (track.delaySamples ?? 0) / context.sampleRate;
    extra.push(manual);
    input.type = "lowpass";
    input.frequency.value = track.cutoff;
    const gain = context.createGain();
    gain.gain.value = automationValue(track.automation?.gain, 0, track.gain);
    const gate = context.createGain();
    gate.gain.value = audible.has(track.id) ? 1 : 0;
    const pan = context.createStereoPanner();
    pan.pan.value = track.pan;
    const send = context.createGain();
    send.gain.value = track.send;
    const meter = context.createAnalyser();
    meter.fftSize = 256;
    input.connect(manual);
    manual.connect(gain);
    gain.connect(gate);
    gate.connect(pan);
    pan.connect(meter);
    pan.connect(send);
    send.connect(delay);
    const bus = {
      source,
      input,
      gain,
      gate,
      pan,
      send,
      meter,
      effectsIn,
      low,
      mid,
      high,
      compressor,
      reduction,
    };
    syncEffects(bus, track, 0, true);
    buses.set(track.id, bus);
  });
  for (const edge of plan.edges) {
    const source = buses.get(edge.from)!;
    const destination =
      edge.to === "master" ? master : buses.get(edge.to)!.effectsIn;
    const compensation = context.createDelay(8);
    compensation.delayTime.value = edge.compensation / context.sampleRate;
    const gain = context.createGain();
    gain.gain.value = edge.gain;
    source.meter.connect(compensation);
    compensation.connect(gain);
    gain.connect(destination);
    extra.push(compensation, gain);
    routes.set(`${edge.from}:${edge.to}:${edge.send}`, gain);
  }
  const dispose = () => {
    [master, limiter, meter, delay, feedback, returnGain].forEach((node) =>
      node.disconnect(),
    );
    buses.forEach((bus) => {
      bus.compressor.port.close();
      Object.values(bus).forEach((node) => {
        if ("disconnect" in node) node.disconnect();
      });
    });
    extra.forEach((node) => node.disconnect());
  };
  return {
    master,
    meter,
    buses,
    delay,
    dispose,
    routes,
    signature: routingSignature(project),
  };
}
const routingSignature = (project: Project) =>
  JSON.stringify(
    project.tracks.map((t) => ({
      id: t.id,
      output: t.outputId,
      sends: t.sends?.map((s) => s.trackId),
      delay: t.delaySamples,
    })),
  );
function syncEffects(bus: Bus, track: Track, at: number, instant = false) {
  const { eq, compressor: comp } = track.effects ?? defaultChannelEffects();
  const set = (parameter: AudioParam, value: number) => {
    if (instant) parameter.value = value;
    else parameter.setTargetAtTime(value, at, 0.01);
  };
  set(bus.low.gain, eq.enabled ? eq.low : 0);
  set(bus.mid.gain, eq.enabled ? eq.mid : 0);
  set(bus.mid.frequency, Math.min(eq.midHz, bus.mid.context.sampleRate * 0.45));
  set(bus.high.gain, eq.enabled ? eq.high : 0);
  // Toggle bypass at block boundaries; continuous parameters have a short ramp.
  bus.compressor.parameters
    .get("enabled")!
    .setValueAtTime(comp.enabled ? 1 : 0, at);
  for (const name of [
    "threshold",
    "ratio",
    "attack",
    "release",
    "makeup",
  ] as const)
    set(bus.compressor.parameters.get(name)!, comp[name]);
}
function automate(
  graph: Graph,
  project: Project,
  step: number,
  time: number,
  duration: number,
) {
  for (const track of project.tracks) {
    const bus = graph.buses.get(track.id);
    if (!bus) continue;
    const params = {
      gain: bus.gain.gain,
      pan: bus.pan.pan,
      cutoff: bus.input.frequency,
      send: bus.send.gain,
    };
    for (const target of ["gain", "pan", "cutoff", "send"] as const)
      if (track.automation?.[target]?.length) {
        const parameter = params[target];
        parameter.setValueAtTime(
          automationValue(track.automation[target], step, track[target]),
          time,
        );
        parameter.linearRampToValueAtTime(
          automationValue(track.automation[target], step + 1, track[target]),
          time + duration,
        );
      }
  }
}

function voice(
  context: BaseAudioContext,
  track: Track,
  pitch: number,
  velocity: number,
  start: number,
  duration: number,
  destination: AudioNode,
  noise: AudioBuffer,
  sample?: AudioBuffer,
  register?: (source: Source) => void,
) {
  const amplitude = context.createGain();
  amplitude.connect(destination);
  const level = clamp(velocity, 0.01, 1);
  const source = (node: Source, end: number) => {
    register?.(node);
    node.start(start);
    node.stop(end);
  };
  const decay = (peak: number, length: number) => {
    amplitude.gain.setValueAtTime(0.0001, start);
    amplitude.gain.linearRampToValueAtTime(peak * level, start + 0.003);
    amplitude.gain.exponentialRampToValueAtTime(0.0001, start + length);
  };
  if (track.instrument === "sample") {
    if (!sample) return;
    const buffer = context.createBufferSource();
    buffer.buffer = sample;
    buffer.playbackRate.value = 2 ** ((pitch - 60) / 12);
    const end =
      start + Math.min(sample.duration / buffer.playbackRate.value, duration);
    amplitude.gain.setValueAtTime(level * 0.8, start);
    amplitude.gain.setValueAtTime(level * 0.8, Math.max(start, end - 0.015));
    amplitude.gain.linearRampToValueAtTime(0, end);
    buffer.connect(amplitude);
    source(buffer, end);
    return;
  }
  if (track.instrument === "kick") {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(155, start);
    oscillator.frequency.exponentialRampToValueAtTime(45, start + 0.15);
    decay(0.95, 0.36);
    oscillator.connect(amplitude);
    source(oscillator, start + 0.38);
    return;
  }
  if (["snare", "clap", "hat", "openhat"].includes(track.instrument)) {
    const buffer = context.createBufferSource();
    buffer.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    const hat = track.instrument === "hat" || track.instrument === "openhat";
    filter.frequency.value = hat
      ? 6900
      : track.instrument === "clap"
        ? 1150
        : 1400;
    buffer.connect(filter);
    filter.connect(amplitude);
    const length =
      track.instrument === "hat"
        ? 0.065
        : track.instrument === "openhat"
          ? 0.25
          : 0.18;
    decay(hat ? 0.24 : 0.55, length);
    if (track.instrument === "clap")
      for (const offset of [0.014, 0.028, 0.042]) {
        amplitude.gain.setValueAtTime(0.02, start + offset);
        amplitude.gain.linearRampToValueAtTime(
          0.4 * level,
          start + offset + 0.002,
        );
        amplitude.gain.exponentialRampToValueAtTime(0.0001, start + length);
      }
    source(buffer, start + length + 0.01);
    if (track.instrument === "snare") {
      const tone = context.createOscillator();
      tone.type = "triangle";
      tone.frequency.setValueAtTime(185, start);
      tone.frequency.exponentialRampToValueAtTime(110, start + 0.1);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.25 * level, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      tone.connect(gain);
      gain.connect(destination);
      source(tone, start + 0.14);
    }
    return;
  }
  const bass = track.instrument === "bass";
  const pad = track.instrument === "pad";
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = bass ? 1.6 : 0.6;
  filter.frequency.setValueAtTime(bass ? 1200 : pad ? 2200 : 5000, start);
  filter.frequency.exponentialRampToValueAtTime(
    bass ? 280 : pad ? 1200 : 1800,
    start + Math.max(0.03, duration),
  );
  filter.connect(amplitude);
  const attack = pad ? Math.min(0.08, duration * 0.4) : 0.007;
  const release = pad ? 0.38 : 0.1;
  const peak = level * (bass ? 0.27 : pad ? 0.09 : 0.2);
  amplitude.gain.setValueAtTime(0.0001, start);
  amplitude.gain.linearRampToValueAtTime(peak, start + attack);
  amplitude.gain.linearRampToValueAtTime(
    peak * 0.65,
    start + Math.max(attack, duration * 0.8),
  );
  amplitude.gain.setValueAtTime(peak * 0.65, start + duration);
  amplitude.gain.exponentialRampToValueAtTime(
    0.0001,
    start + duration + release,
  );
  for (let index = 0; index < 2; index++) {
    const oscillator = context.createOscillator();
    oscillator.type = bass
      ? index
        ? "sine"
        : "sawtooth"
      : pad
        ? "sawtooth"
        : "triangle";
    oscillator.frequency.value =
      frequency(pitch) * (bass && index ? 0.5 : !bass && !pad && index ? 2 : 1);
    oscillator.detune.value = pad ? (index ? 7 : -7) : 0;
    oscillator.connect(filter);
    source(oscillator, start + duration + release + 0.01);
  }
}

export class AudioEngine {
  context: AudioContext | null = null;
  private graph: Graph | null = null;
  private noise: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private sampleData = new Map<string, string>();
  private sources = new Set<Source>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private callbacks = new Set<ReturnType<typeof setTimeout>>();
  private step = 0;
  private nextTime = 0;
  private position = 0;
  private run = 0;
  private preparation: Promise<void> = Promise.resolve();
  private getProject: (() => Project) | null = null;
  private getMode: (() => Mode) | null = null;
  private getPattern: (() => string) | null = null;
  onStep: (step: number) => void = () => {};
  onError: (error: unknown) => void = () => {};

  prepare(project: Project): Promise<void> {
    const result = this.preparation.then(() => this.prepareGraph(project));
    this.preparation = result.catch(() => {});
    return result;
  }

  private async prepareGraph(project: Project) {
    const retained = new Set(project.samples.map((sample) => sample.id));
    for (const key of this.buffers.keys())
      if (!retained.has(key)) {
        this.buffers.delete(key);
        this.sampleData.delete(key);
      }
    if (project.tracks.some((t) => t.plugins?.some((p) => !p.bypassed)))
      throw new Error(
        "Este proyecto usa VST3. Ábrelo en StudioWav para Windows.",
      );
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.noise = noiseBuffer(this.context);
    }
    if (this.context.state !== "running") await this.context.resume();
    await Promise.all(
      project.samples.map(async (sample) => {
        if (this.sampleData.get(sample.id) === sample.data) return;
        const bytes = Uint8Array.from(atob(sample.data.split(",")[1]), (c) =>
          c.charCodeAt(0),
        );
        const decoded = await this.context!.decodeAudioData(bytes.buffer);
        this.buffers.set(sample.id, decoded);
        this.sampleData.set(sample.id, sample.data);
      }),
    );
    if (
      !this.graph ||
      this.graph.signature !== routingSignature(project) ||
      project.tracks.length !== this.graph.buses.size ||
      project.tracks.some((track) => !this.graph!.buses.has(track.id))
    ) {
      this.graph?.dispose();
      this.graph = await makeGraph(this.context, project);
    }
    this.sync(project);
  }

  private sync(project: Project) {
    if (!this.graph || !this.context) return;
    const at = this.context.currentTime;
    this.graph.master.gain.setTargetAtTime(project.master, at, 0.015);
    this.graph.delay.delayTime.setTargetAtTime(60 / project.bpm / 2, at, 0.03);
    const audible = audibleTracks(project);
    for (const track of project.tracks) {
      const bus = this.graph.buses.get(track.id);
      if (!bus) continue;
      syncEffects(bus, track, at);
      bus.gate.gain.setTargetAtTime(audible.has(track.id) ? 1 : 0, at, 0.008);
      const params = {
        gain: bus.gain.gain,
        pan: bus.pan.pan,
        cutoff: bus.input.frequency,
        send: bus.send.gain,
      };
      for (const name of ["gain", "pan", "cutoff", "send"] as const)
        if (!track.automation?.[name]?.length) {
          params[name].cancelScheduledValues(at);
          params[name].setTargetAtTime(track[name], at, 0.015);
        }
      for (const send of track.sends ?? [])
        this.graph.routes
          .get(`${track.id}:${send.trackId}:true`)
          ?.gain.setTargetAtTime(send.gain, at, 0.015);
    }
  }

  async start(
    getProject: () => Project,
    getMode: () => Mode,
    getPattern: () => string,
    startStep = 0,
  ) {
    const token = ++this.run;
    await this.prepare(getProject());
    if (token !== this.run) return;
    this.stop(false);
    this.getProject = getProject;
    this.getMode = getMode;
    this.getPattern = getPattern;
    this.step = startStep;
    this.position = startStep;
    this.nextTime = this.context!.currentTime + 0.06;
    this.timer = setInterval(() => {
      try {
        this.schedule();
      } catch (error) {
        this.stop();
        this.onError(error);
      }
    }, 25);
    this.schedule();
  }

  private schedule() {
    const context = this.context!;
    const project = this.getProject!();
    this.sync(project);
    const selected =
      project.patterns.find((pattern) => pattern.id === this.getPattern!()) ??
      project.patterns[0];
    const length =
      this.getMode!() === "pattern" ? selected.length : project.bars * 16;
    if (this.nextTime < context.currentTime - 0.2)
      this.nextTime = context.currentTime + 0.02;
    let scheduled = 0;
    while (this.nextTime < context.currentTime + 0.12 && scheduled++ < 8) {
      this.step %= length;
      const duration = 60 / project.bpm / 4;
      const time =
        this.nextTime + (this.step % 2 ? project.swing * duration * 0.5 : 0);
      automate(this.graph!, project, this.step, this.nextTime, duration);
      for (const event of eventsAtStep(
        project,
        this.step,
        this.getMode!(),
        selected.id,
      )) {
        const bus = this.graph!.buses.get(event.track.id);
        if (!bus) continue;
        voice(
          context,
          event.track,
          event.pitch,
          event.velocity,
          this.nextTime +
            (event.step - this.step) * duration +
            (Math.floor(event.step) % 2 ? project.swing * duration * 0.5 : 0),
          event.length * duration,
          bus.source,
          this.noise!,
          this.buffers.get(event.track.sampleId ?? ""),
          (source) => {
            this.sources.add(source);
            source.onended = () => this.sources.delete(source);
          },
        );
      }
      const current = this.step;
      const callback = setTimeout(
        () => {
          this.callbacks.delete(callback);
          this.position = current;
          this.onStep(current);
        },
        Math.max(0, (time - context.currentTime) * 1000),
      );
      this.callbacks.add(callback);
      this.step++;
      this.nextTime += duration;
    }
  }

  stop(invalidate = true) {
    if (invalidate) this.run++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.callbacks.forEach(clearTimeout);
    this.callbacks.clear();
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    });
    this.sources.clear();
    this.graph?.buses.forEach((bus) => {
      bus.compressor.port.postMessage("reset");
      bus.reduction.value = 0;
    });
    this.position = 0;
    this.onStep(0);
  }

  pause() {
    const position = this.position;
    this.stop();
    this.position = position;
    this.onStep(position);
    return position;
  }

  async preview(project: Project, track: Track, pitch = 60) {
    await this.prepare(project);
    voice(
      this.context!,
      track,
      pitch,
      0.8,
      this.context!.currentTime + 0.005,
      track.instrument === "sample"
        ? (this.buffers.get(track.sampleId ?? "")?.duration ?? 0.3) /
            2 ** ((pitch - 60) / 12)
        : 0.3,
      this.graph!.buses.get(track.id)!.source,
      this.noise!,
      this.buffers.get(track.sampleId ?? ""),
      (source) => {
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
      },
    );
  }

  getPosition() {
    return this.position;
  }
  compressionReduction(trackId: string) {
    const bus = this.graph?.buses.get(trackId);
    return bus?.reduction.value ?? 0;
  }
  levels(): Record<string, number> {
    if (!this.graph) return {};
    const read = (analyser: AnalyserNode) => {
      const values = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      return Math.min(
        1,
        Math.sqrt(
          values.reduce((sum, value) => sum + value * value, 0) / values.length,
        ) * 2.8,
      );
    };
    return {
      master: read(this.graph.meter),
      ...Object.fromEntries(
        [...this.graph.buses].map(([id, bus]) => [id, read(bus.meter)]),
      ),
    };
  }

  async export(project: Project, mode: Mode, patternId: string): Promise<Blob> {
    await this.prepare(project);
    const length =
      mode === "pattern"
        ? (
            project.patterns.find((pattern) => pattern.id === patternId) ??
            project.patterns[0]
          ).length
        : project.bars * 16;
    const seconds = (length * 60) / project.bpm / 4 + 1.5;
    const compensation = mixerPlan(project, 44100).masterLatency;
    const context = new OfflineAudioContext(
      2,
      Math.ceil(seconds * 44100) + compensation,
      44100,
    );
    const graph = await makeGraph(context, project);
    const noise = noiseBuffer(context);
    for (let step = 0; step < length; step++) {
      automate(
        graph,
        project,
        step,
        (step * 60) / project.bpm / 4,
        60 / project.bpm / 4,
      );
      for (const event of eventsAtStep(project, step, mode, patternId)) {
        voice(
          context,
          event.track,
          event.pitch,
          event.velocity,
          eventTime(event.step, project.bpm, project.swing),
          (event.length * 60) / project.bpm / 4,
          graph.buses.get(event.track.id)!.source,
          noise,
          this.buffers.get(event.track.sampleId ?? ""),
        );
      }
    }
    const result = await context.startRendering();
    graph.dispose();
    return new Blob(
      [
        encodeWav(
          [
            result.getChannelData(0).subarray(compensation),
            result.getChannelData(1).subarray(compensation),
          ],
          result.sampleRate,
        ),
      ],
      { type: "audio/wav" },
    );
  }
}
