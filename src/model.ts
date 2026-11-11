export type Instrument =
  | "kick"
  | "snare"
  | "clap"
  | "hat"
  | "openhat"
  | "bass"
  | "keys"
  | "pad"
  | "sample";
export type Mode = "song" | "pattern";
export type Note = {
  id: string;
  pitch: number;
  start: number;
  length: number;
  velocity: number;
};
export type Channel = { steps: number[]; notes: Note[] };
export type AutomationTarget = "gain" | "pan" | "cutoff" | "send";
export type AutomationPoint = { step: number; value: number };
export type PluginSlot = {
  instrument?: boolean;
  id: string;
  name: string;
  description: string;
  state?: string;
  bypassed: boolean;
};
export type Track = {
  midiProgram?: number;
  midiDrumNote?: number;
  id: string;
  name: string;
  instrument: Instrument;
  color: string;
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  cutoff: number;
  send: number;
  sampleId?: string;
  kind?: "instrument" | "bus";
  outputId?: string;
  sends?: { trackId: string; gain: number }[];
  delaySamples?: number;
  monitorInput?: boolean;
  plugins?: PluginSlot[];
  automation?: Partial<Record<AutomationTarget, AutomationPoint[]>>;
};
export type Pattern = {
  id: string;
  name: string;
  length: number;
  channels: Record<string, Channel>;
};
export type Clip = {
  id: string;
  trackId: string;
  patternId: string;
  startBar: number;
  lengthBars?: number;
  laneId?: string;
  scope?: "channel" | "pattern";
  muted?: boolean;
  loop?: boolean;
};
export type PlaylistLane = {
  id: string;
  name: string;
  color: string;
  muted: boolean;
};
export type Sample = {
  id: string;
  name: string;
  data: string;
  duration?: number;
};
export type Project = {
  version: 1;
  name: string;
  bpm: number;
  swing: number;
  master: number;
  bars: number;
  tracks: Track[];
  patterns: Pattern[];
  clips: Clip[];
  samples: Sample[];
  lanes?: PlaylistLane[];
};
export type Event = {
  track: Track;
  step: number;
  pitch: number;
  length: number;
  velocity: number;
};

export const id = () => crypto.randomUUID();
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export const isMelodic = (instrument: Instrument) =>
  ["bass", "keys", "pad", "sample"].includes(instrument);
export const noteName = (midi: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
    ((midi % 12) + 12) % 12
  ] +
  (Math.floor(midi / 12) - 1);
export const presets: {
  instrument: Instrument;
  name: string;
  description: string;
  color: string;
  tag: string;
}[] = [
  {
    instrument: "kick",
    name: "Deep kick",
    description: "Grave redondo · 808",
    color: "#edaa70",
    tag: "KICK",
  },
  {
    instrument: "snare",
    name: "Dusty snare",
    description: "Caja cálida y con textura",
    color: "#e7899b",
    tag: "SNARE",
  },
  {
    instrument: "clap",
    name: "Analog clap",
    description: "Palmada analógica estéreo",
    color: "#d58fbb",
    tag: "CLAP",
  },
  {
    instrument: "hat",
    name: "Closed hat",
    description: "Hi-hat cerrado y preciso",
    color: "#c9b875",
    tag: "HAT",
  },
  {
    instrument: "openhat",
    name: "Open hat",
    description: "Aire y movimiento",
    color: "#c6cb82",
    tag: "HAT",
  },
  {
    instrument: "bass",
    name: "Sub motion",
    description: "Bajo con filtro resonante",
    color: "#8bd3b6",
    tag: "BASS",
  },
  {
    instrument: "keys",
    name: "Velvet keys",
    description: "Teclas suaves y luminosas",
    color: "#b6a0e4",
    tag: "KEYS",
  },
  {
    instrument: "pad",
    name: "Cloud pad",
    description: "Acordes amplios y ambientales",
    color: "#8bb6df",
    tag: "PAD",
  },
];

export function createTrack(instrument: Instrument, name?: string): Track {
  const preset = presets.find((p) => p.instrument === instrument);
  return {
    id: id(),
    name: name ?? preset?.name ?? "Audio importado",
    instrument,
    color: preset?.color ?? "#85b9c8",
    gain: instrument === "pad" ? 0.48 : 0.72,
    pan: 0,
    muted: false,
    solo: false,
    cutoff: 18000,
    send: instrument === "keys" || instrument === "pad" ? 0.18 : 0,
  };
}

export function emptyPattern(
  tracks: Track[],
  name = "Patrón 01",
  length = 32,
): Pattern {
  return {
    id: id(),
    name,
    length,
    channels: Object.fromEntries(
      tracks.map((t) => [t.id, { steps: Array(length).fill(0), notes: [] }]),
    ),
  };
}

export function createProject(demo = true): Project {
  const tracks = presets.map((p) => createTrack(p.instrument));
  const first = emptyPattern(tracks, "Midnight groove");
  const second = emptyPattern(tracks, "Variación");
  if (demo) {
    const beats = [
      [0, 6, 8, 16, 22, 24, 30],
      [4, 12, 20, 28],
      [12, 28],
      Array.from({ length: 16 }, (_, i) => i * 2),
      [10, 26],
    ];
    beats.forEach((steps, index) =>
      steps.forEach((step, i) => {
        first.channels[tracks[index].id].steps[step] =
          index === 3 ? (i % 2 ? 0.48 : 0.8) : 0.85;
      }),
    );
    const bass = [
      [36, 0, 3],
      [36, 6, 2],
      [43, 8, 3],
      [39, 12, 3],
      [32, 16, 5],
      [32, 22, 2],
      [34, 24, 3],
      [35, 30, 2],
    ];
    first.channels[tracks[5].id].notes = bass.map(([pitch, start, length]) => ({
      id: id(),
      pitch,
      start,
      length,
      velocity: 0.76,
    }));
    first.channels[tracks[6].id].notes = [
      [60, 0],
      [63, 3],
      [67, 6],
      [70, 10],
      [63, 16],
      [67, 19],
      [70, 22],
      [74, 26],
    ].map(([pitch, start]) => ({
      id: id(),
      pitch,
      start,
      length: 2,
      velocity: 0.58,
    }));
    first.channels[tracks[7].id].notes = [
      [48, 0],
      [55, 0],
      [58, 0],
      [44, 16],
      [51, 16],
      [55, 16],
    ].map(([pitch, start]) => ({
      id: id(),
      pitch,
      start,
      length: 15,
      velocity: 0.48,
    }));
    second.channels = structuredClone(first.channels);
    second.channels[tracks[0].id].steps[29] = 0.7;
    second.channels[tracks[1].id].steps[31] = 0.4;
    second.channels[tracks[6].id].notes.forEach((note) => {
      note.pitch += 12;
      note.velocity *= 0.8;
    });
  }
  const clips: Clip[] = [];
  if (demo) {
    for (let bar = 0; bar < 16; bar += 2) {
      clips.push({
        id: id(),
        trackId: tracks[0].id,
        laneId: tracks[0].id,
        scope: "pattern",
        loop: true,
        patternId: bar >= 12 ? second.id : first.id,
        startBar: bar,
      });
    }
  }
  return {
    version: 1,
    name: demo ? "Midnight session" : "Proyecto sin título",
    bpm: 124,
    swing: 0.12,
    master: 0.78,
    bars: 16,
    tracks,
    patterns: [first, second],
    clips,
    samples: [],
    lanes: tracks.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      muted: false,
    })),
  };
}

export function playlistLanes(project: Project): PlaylistLane[] {
  return (
    project.lanes ??
    project.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      muted: false,
    }))
  );
}

export function eventsAtStep(
  project: Project,
  step: number,
  mode: Mode,
  patternId: string,
): Event[] {
  const selected =
    project.patterns.find((pattern) => pattern.id === patternId) ??
    project.patterns[0];
  const audible = audibleTracks(project);
  const events: Event[] = [];
  for (const track of project.tracks) {
    if (track.kind === "bus" || !audible.has(track.id)) continue;
    const sources =
      mode === "pattern"
        ? [{ pattern: selected, local: step % selected.length }]
        : project.clips
            .filter(
              (clip) =>
                !clip.muted &&
                !playlistLanes(project).find(
                  (l) => l.id === (clip.laneId ?? clip.trackId),
                )?.muted &&
                (clip.scope === "pattern" || clip.trackId === track.id),
            )
            .map((clip) => ({
              pattern: project.patterns.find((p) => p.id === clip.patternId)!,
              local: step - clip.startBar * 16,
              clip,
            }))
            .filter(
              ({ pattern, local, clip }) =>
                pattern &&
                local >= 0 &&
                local < (clip.lengthBars ?? pattern.length / 16) * 16 &&
                (clip.loop || local < pattern.length),
            )
            .map(({ pattern, local, clip }) => ({
              pattern,
              local: clip.loop ? local % pattern.length : local,
              remaining: (clip.lengthBars ?? pattern.length / 16) * 16 - local,
            }));
    for (const source of sources) {
      const { pattern, local } = source;
      const channel = pattern.channels[track.id];
      if (!channel) continue;
      if (channel.steps[local] > 0)
        events.push({
          track,
          step,
          pitch: 60,
          length:
            track.instrument === "sample"
              ? Math.max(
                  1,
                  (((project.samples.find((s) => s.id === track.sampleId)
                    ?.duration ?? (32 * 60) / project.bpm / 4) *
                    project.bpm) /
                    60) *
                    4,
                )
              : 1,
          velocity: channel.steps[local],
        });
      for (const note of channel.notes)
        if (Math.floor(note.start) === local)
          events.push({
            track,
            step: step + note.start - local,
            pitch: note.pitch,
            length: Math.min(
              note.length,
              pattern.length - note.start,
              "remaining" in source
                ? source.remaining - (note.start - local)
                : Infinity,
            ),
            velocity: note.velocity,
          });
    }
  }
  return events;
}

export const eventTime = (step: number, bpm: number, swing: number) =>
  ((step + (Math.floor(step) % 2 ? swing * 0.5 : 0)) * 60) / bpm / 4;

export function validateProject(value: unknown): Project {
  if (!value || typeof value !== "object")
    throw new Error("El archivo no contiene un proyecto StudioWav.");
  const p = value as Project;
  const finite = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  if (
    p.version !== 1 ||
    typeof p.name !== "string" ||
    !finite(p.bpm, 40, 240) ||
    !finite(p.swing, 0, 0.6) ||
    !finite(p.master, 0, 1) ||
    !Number.isInteger(p.bars) ||
    p.bars < 2 ||
    p.bars > 64
  )
    throw new Error("Proyecto o tempo no compatible.");
  if (
    !Array.isArray(p.tracks) ||
    !p.tracks.length ||
    p.tracks.length > 32 ||
    !Array.isArray(p.patterns) ||
    !p.patterns.length ||
    p.patterns.length > 64 ||
    !Array.isArray(p.clips) ||
    p.clips.length > 2048 ||
    !Array.isArray(p.samples) ||
    p.samples.length > 32
  )
    throw new Error("La estructura del proyecto no es válida.");
  const unique = (items: { id: string }[]) =>
    items.every(
      (item) =>
        typeof item.id === "string" &&
        item.id.length > 0 &&
        item.id.length < 100,
    ) && new Set(items.map((item) => item.id)).size === items.length;
  if (
    !unique(p.tracks) ||
    !unique(p.patterns) ||
    !unique(p.clips) ||
    !unique(p.samples)
  )
    throw new Error(
      "El proyecto tiene identificadores duplicados o inválidos.",
    );
  const kinds = [...presets.map((preset) => preset.instrument), "sample"];
  for (const t of p.tracks)
    if (
      typeof t.name !== "string" ||
      !kinds.includes(t.instrument) ||
      !/^#[0-9a-f]{6}$/i.test(t.color) ||
      !finite(t.gain, 0, 1) ||
      !finite(t.pan, -1, 1) ||
      !finite(t.cutoff, 80, 20000) ||
      !finite(t.send, 0, 0.6) ||
      typeof t.muted !== "boolean" ||
      typeof t.solo !== "boolean" ||
      (t.midiProgram !== undefined &&
        (!Number.isInteger(t.midiProgram) ||
          t.midiProgram < 0 ||
          t.midiProgram > 127)) ||
      (t.midiDrumNote !== undefined &&
        (!Number.isInteger(t.midiDrumNote) ||
          t.midiDrumNote < 0 ||
          t.midiDrumNote > 127)) ||
      (t.instrument === "sample" &&
        !p.samples.some((sample) => sample.id === t.sampleId))
    )
      throw new Error("Una pista contiene valores inválidos.");
  for (const pattern of p.patterns) {
    if (
      typeof pattern.name !== "string" ||
      !Number.isInteger(pattern.length) ||
      ![16, 32, 64, 128].includes(pattern.length) ||
      !pattern.channels ||
      typeof pattern.channels !== "object"
    )
      throw new Error("Un patrón no es compatible.");
    for (const track of p.tracks) {
      const c = pattern.channels[track.id];
      if (
        !c ||
        !Array.isArray(c.steps) ||
        c.steps.length !== pattern.length ||
        !c.steps.every((s) => finite(s, 0, 1)) ||
        !Array.isArray(c.notes) ||
        c.notes.length > 2048 ||
        !unique(c.notes)
      )
        throw new Error("La secuencia de un canal no es válida.");
      for (const n of c.notes)
        if (
          !Number.isInteger(n.pitch) ||
          !finite(n.pitch, 0, 127) ||
          !finite(n.start, 0, pattern.length - 1 / 64) ||
          !finite(n.length, 1 / 64, pattern.length - n.start) ||
          !finite(n.velocity, 0, 1)
        )
          throw new Error("El piano roll contiene una nota inválida.");
    }
  }
  for (const c of p.clips)
    if (
      !p.tracks.some((t) => t.id === c.trackId) ||
      !p.patterns.some((pattern) => pattern.id === c.patternId) ||
      !Number.isInteger(c.startBar) ||
      c.startBar < 0 ||
      c.startBar +
        (c.lengthBars ??
          p.patterns.find((v) => v.id === c.patternId)!.length / 16) >
        p.bars ||
      (c.scope !== undefined && !["channel", "pattern"].includes(c.scope)) ||
      (c.loop !== undefined && typeof c.loop !== "boolean") ||
      (c.muted !== undefined && typeof c.muted !== "boolean") ||
      (c.laneId !== undefined &&
        !playlistLanes(p).some((l) => l.id === c.laneId)) ||
      (c.lengthBars !== undefined &&
        (!Number.isInteger(c.lengthBars) ||
          c.lengthBars < 1 ||
          c.lengthBars > 64))
    )
      throw new Error("Un clip está fuera del arreglo.");
  if (
    p.lanes !== undefined &&
    (!Array.isArray(p.lanes) ||
      !p.lanes.length ||
      p.lanes.length > 32 ||
      !unique(p.lanes) ||
      p.lanes.some(
        (l) =>
          typeof l.name !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(l.color) ||
          typeof l.muted !== "boolean",
      ))
  )
    throw new Error("Pistas de Playlist inválidas.");
  for (const s of p.samples)
    if (
      typeof s.name !== "string" ||
      typeof s.data !== "string" ||
      !/^data:[^,]*;base64,[a-z0-9+/=]*$/i.test(s.data) ||
      s.data.length > 140_000_000 ||
      (s.duration !== undefined && !finite(s.duration, 0.000001, 600))
    )
      throw new Error(
        "Una muestra de audio no es válida o es demasiado grande.",
      );
  validateMixer(p);
  return structuredClone(p);
}

export function validateMixer(project: Project) {
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ids = new Set(project.tracks.map((t) => t.id));
  const walk = (track: Track) => {
    if (visiting.has(track.id))
      throw new Error("El ruteo contiene un ciclo de realimentación.");
    if (visited.has(track.id)) return;
    visiting.add(track.id);
    const destinations = [
      track.outputId,
      ...(track.sends ?? []).map((s) => s.trackId),
    ];
    for (const destination of destinations) {
      if (!destination || destination === "master") continue;
      if (!ids.has(destination))
        throw new Error("El destino de una pista no existe.");
      walk(project.tracks.find((t) => t.id === destination)!);
    }
    visiting.delete(track.id);
    visited.add(track.id);
    order.unshift(track.id);
  };
  for (const track of project.tracks) {
    if (track.kind !== undefined && !["instrument", "bus"].includes(track.kind))
      throw new Error("Tipo de canal inválido.");
    if (track.outputId !== undefined && typeof track.outputId !== "string")
      throw new Error("Salida inválida.");
    if (
      track.delaySamples !== undefined &&
      (!Number.isInteger(track.delaySamples) ||
        track.delaySamples < 0 ||
        track.delaySamples > 96000)
    )
      throw new Error("Retardo fuera de rango.");
    if (
      track.monitorInput !== undefined &&
      typeof track.monitorInput !== "boolean"
    )
      throw new Error("Monitorización inválida.");
    if (
      track.sends !== undefined &&
      (!Array.isArray(track.sends) ||
        track.sends.length > 32 ||
        track.sends.some(
          (s) =>
            !s ||
            !ids.has(s.trackId) ||
            !Number.isFinite(s.gain) ||
            s.gain < 0 ||
            s.gain > 1,
        ) ||
        new Set(track.sends.map((s) => s.trackId)).size !== track.sends.length)
    )
      throw new Error("Envíos inválidos.");
    if (
      track.plugins !== undefined &&
      (!Array.isArray(track.plugins) ||
        track.plugins.length > 8 ||
        track.plugins.some(
          (s) =>
            !s ||
            typeof s.id !== "string" ||
            typeof s.name !== "string" ||
            typeof s.description !== "string" ||
            s.description.length > 100000 ||
            typeof s.bypassed !== "boolean" ||
            (s.instrument !== undefined && typeof s.instrument !== "boolean") ||
            (s.state !== undefined &&
              (typeof s.state !== "string" || s.state.length > 16000000)),
        ))
    )
      throw new Error("Cadena de plugins inválida.");
    if (track.automation !== undefined) {
      if (!track.automation || typeof track.automation !== "object")
        throw new Error("Automatización inválida.");
      const ranges: Record<string, [number, number]> = {
        gain: [0, 1],
        pan: [-1, 1],
        cutoff: [80, 20000],
        send: [0, 0.6],
      };
      for (const [target, points] of Object.entries(track.automation)) {
        const range = ranges[target];
        if (
          !range ||
          !Array.isArray(points) ||
          points.length > 4096 ||
          points.some(
            (p, i) =>
              !p ||
              !Number.isFinite(p.step) ||
              p.step < 0 ||
              p.step > project.bars * 16 ||
              (i > 0 && p.step <= points[i - 1].step) ||
              !Number.isFinite(p.value) ||
              p.value < range[0] ||
              p.value > range[1],
          )
        )
          throw new Error("Puntos de automatización inválidos o desordenados.");
      }
    }
    walk(track);
  }
  return order;
}

export function automationValue(
  points: AutomationPoint[] | undefined,
  step: number,
  fallback: number,
) {
  if (!points?.length) return fallback;
  if (step <= points[0].step) return points[0].value;
  for (let i = 1; i < points.length; i++)
    if (step <= points[i].step) {
      const a = points[i - 1],
        b = points[i];
      return (
        a.value + ((b.value - a.value) * (step - a.step)) / (b.step - a.step)
      );
    }
  return points.at(-1)!.value;
}

export function audibleTracks(project: Project) {
  const edges = project.tracks.flatMap((t) =>
    [t.outputId, ...(t.sends ?? []).map((s) => s.trackId)]
      .filter((id): id is string => Boolean(id) && id !== "master")
      .map((to) => ({ from: t.id, to })),
  );
  const solo = project.tracks.filter((t) => t.solo);
  const active = new Set(
    solo.length ? solo.map((t) => t.id) : project.tracks.map((t) => t.id),
  );
  if (solo.length) {
    const ancestors = new Set(
      solo.filter((t) => t.kind === "bus").map((t) => t.id),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges)
        if (ancestors.has(e.to) && !ancestors.has(e.from)) {
          ancestors.add(e.from);
          changed = true;
        }
    }
    for (const id of ancestors) active.add(id);
    changed = true;
    while (changed) {
      changed = false;
      for (const e of edges)
        if (active.has(e.from) && !active.has(e.to)) {
          active.add(e.to);
          changed = true;
        }
    }
  }
  for (const t of project.tracks) if (t.muted) active.delete(t.id);
  return active;
}

export function mixerPlan(
  project: Project,
  rate: number,
  pluginLatencies: Record<string, number> = {},
) {
  const order = validateMixer(project);
  const edges = project.tracks.flatMap((t) => [
    {
      from: t.id,
      to: t.outputId && t.outputId !== "master" ? t.outputId : "master",
      gain: 1,
      send: false,
    },
    ...(t.sends ?? []).map((s) => ({
      from: t.id,
      to: s.trackId,
      gain: s.gain,
      send: true,
    })),
  ]);
  const arrival: Record<string, number> = {},
    latency: Record<string, number> = {};
  for (const id of order) {
    const track = project.tracks.find((t) => t.id === id)!;
    arrival[id] = Math.max(
      0,
      ...edges.filter((e) => e.to === id).map((e) => latency[e.from]),
    );
    latency[id] =
      arrival[id] + (track.delaySamples ?? 0) + (pluginLatencies[id] ?? 0);
    if (latency[id] > rate * 8)
      throw new Error("La latencia acumulada supera ocho segundos.");
  }
  const masterLatency = Math.max(
    0,
    ...edges.filter((e) => e.to === "master").map((e) => latency[e.from]),
  );
  return {
    order,
    arrival,
    latency,
    masterLatency,
    edges: edges.map((e) => ({
      ...e,
      compensation:
        (e.to === "master" ? masterLatency : arrival[e.to]) - latency[e.from],
    })),
  };
}
