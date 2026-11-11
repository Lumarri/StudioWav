import { AudioEngine as WebAudioEngine } from "./engine.ts";
import { nativeProject } from "./native-project.ts";
import type { Mode, Project, Track } from "../model.ts";
export type NativeStatus = {
  ready: boolean;
  backend: string;
  playing: boolean;
  step: number;
  sampleRate: number;
  bufferSize: number;
  driver: string;
  device: string;
  inputLatency: number;
  outputLatency: number;
  pdcSamples: number;
  trackLatencies: Record<string, number>;
  gainReduction: Record<string, number>;
  cpu: number;
  overruns: number;
  inputLevel: number;
  recording: boolean;
  recordedSeconds: number;
  recordDrops: number;
  levels: Record<string, number>;
  midi: { note: number; velocity: number; on: boolean; step: number }[];
  error?: string;
  warning?: string;
};
export type DeviceList = {
  types: { name: string; outputs: string[]; inputs: string[] }[];
  midiInputs: { id: string; name: string }[];
  sampleRates: number[];
  bufferSizes: number[];
  type: string;
  output: string;
  input: string;
  sampleRate: number;
  bufferSize: number;
  midiDevice: string;
};
export type FoundPlugin = {
  bundledId?: "piano" | "kick";
  name: string;
  manufacturer: string;
  instrument: boolean;
  description: string;
  path: string;
};
declare global {
  interface Window {
    studioNative?: {
      request(command: string, args?: unknown): Promise<any>;
      pickPluginFolder(): Promise<string | null>;
      openRecordings(): Promise<void>;
      onStatus(callback: (status: NativeStatus) => void): () => void;
    };
  }
}
export class AudioEngine extends WebAudioEngine {
  readonly native = Boolean(window.studioNative);
  status: Partial<NativeStatus> = {
    ready: false,
    backend: this.native ? "native" : "web",
    levels: {},
  };
  onMidi: (event: NativeStatus["midi"][number]) => void = () => {};
  onTransport: (playing: boolean) => void = () => {};
  private knownSamples = new Map<string, string>();
  private lastKey = "";
  private serial = Promise.resolve();
  private nativeRun = 0;
  private currentMode: Mode = "song";
  private currentPattern = "";
  private nativePosition = 0;
  constructor() {
    super();
    window.studioNative?.onStatus((status) => {
      this.status = status;
      if (status.error) {
        this.lastKey = "";
        this.knownSamples.clear();
        this.onError(new Error(status.error));
      }
      this.nativePosition = Math.floor(status.step ?? 0);
      this.onStep(this.nativePosition);
      this.onTransport(Boolean(status.playing));
      status.midi?.forEach((event) => this.onMidi(event));
    });
  }
  request<T = any>(command: string, args: unknown = {}): Promise<T> {
    if (!window.studioNative)
      return Promise.reject(
        new Error("Esta función requiere la aplicación de Windows."),
      );
    return window.studioNative.request(command, args);
  }
  async update(
    project: Project,
    mode: Mode = this.currentMode,
    patternId = this.currentPattern || project.patterns[0].id,
    restoreStates = false,
  ) {
    if (!this.native) return;
    this.currentMode = mode;
    this.currentPattern = patternId;
    const work = async () => {
      const payload = nativeProject(project, mode, patternId, false);
      const key = JSON.stringify(payload);
      const changed = project.samples.filter(
        (s) => this.knownSamples.get(s.id) !== s.data,
      );
      if (key === this.lastKey && !changed.length && !restoreStates) return;
      await this.request("project", {
        ...payload,
        samples: changed,
        restoreStates,
      });
      this.lastKey = key;
      for (const sample of changed)
        this.knownSamples.set(sample.id, sample.data);
      const retained = new Set(project.samples.map((sample) => sample.id));
      for (const key of this.knownSamples.keys())
        if (!retained.has(key)) this.knownSamples.delete(key);
    };
    const result = this.serial.then(work);
    this.serial = result.catch(() => {});
    return result;
  }
  override async prepare(project: Project) {
    if (!this.native) return super.prepare(project);
    await this.update(project);
  }
  override async start(
    getProject: () => Project,
    getMode: () => Mode,
    getPattern: () => string,
    startStep = 0,
  ) {
    if (!this.native)
      return super.start(getProject, getMode, getPattern, startStep);
    const run = ++this.nativeRun;
    await this.request("init");
    await this.update(getProject(), getMode(), getPattern());
    if (run === this.nativeRun) await this.request("play", { step: startStep });
  }
  override stop(invalidate = true) {
    if (!this.native) return super.stop(invalidate);
    if (invalidate) this.nativeRun++;
    this.nativePosition = 0;
    this.onStep(0);
    void this.request("stop").catch((error) => this.onError(error));
  }
  override pause() {
    if (!this.native) return super.pause();
    this.nativeRun++;
    const step = this.nativePosition;
    void this.request("pause").catch((error) => this.onError(error));
    return step;
  }
  override getPosition() {
    return this.native ? this.nativePosition : super.getPosition();
  }
  override async preview(project: Project, track: Track, pitch = 60) {
    if (!this.native) return super.preview(project, track, pitch);
    await this.update(project);
    await this.request("preview", { trackId: track.id, pitch });
  }
  override levels(): Record<string, number> {
    if (!this.native) return super.levels();
    return Object.fromEntries(
      Object.entries(this.status.levels ?? {}).map(([id, v]) => [
        id,
        Math.min(1, v * 1.7),
      ]),
    );
  }
  override compressionReduction(trackId: string) {
    return this.native
      ? (this.status.gainReduction?.[trackId] ?? 0)
      : super.compressionReduction(trackId);
  }
  override async export(
    project: Project,
    mode: Mode,
    patternId: string,
  ): Promise<Blob> {
    if (!this.native) return super.export(project, mode, patternId);
    await this.update(project, mode, patternId);
    const result = await this.request<{ audio: Uint8Array }>("render", {
      sampleRate: 44100,
      bitDepth: 16,
    });
    return new Blob([new Uint8Array(result.audio)], { type: "audio/wav" });
  }
  async capture(project: Project): Promise<Project> {
    if (!this.native) return structuredClone(project);
    const states = await this.request<Record<string, string>>("states");
    return {
      ...project,
      tracks: project.tracks.map((t) => ({
        ...t,
        plugins: t.plugins?.map((p) => ({
          ...p,
          state: states[p.id] ?? p.state,
        })),
      })),
    };
  }
}
