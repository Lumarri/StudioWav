import {
  createTrack,
  emptyPattern,
  id,
  validateProject,
  eventsAtStep,
  eventTime,
  playlistLanes,
  isMelodic,
} from "./model.ts";
import type { Project, Track, Mode, Note } from "./model.ts";

export const MIDI_MAX_BYTES = 8 * 1024 * 1024;
const MAX_NOTES = 32768,
  MAX_EVENTS = 200000,
  PPQ = 960;
type MidiNote = Omit<Note, "id">;
export type MidiPart = {
  id: string;
  name: string;
  program: number;
  channel: number;
  port: number;
  drumNote?: number;
  notes: MidiNote[];
};
export type MidiSong = {
  format: number;
  ppq: number;
  bpm: number;
  length: number;
  parts: MidiPart[];
  warnings: string[];
};
export type MidiImportOptions = {
  parts: string[];
  replace: boolean;
  useTempo: boolean;
  startBar: number;
};
type Raw = {
  tick: number;
  order: number;
  track: number;
  port: number;
  status: number;
  a: number;
  b: number;
};
type Pending = {
  part: MidiPart;
  pitch: number;
  tick: number;
  velocity: number;
};
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
class Reader {
  pos = 0;
  readonly bytes: Uint8Array;
  readonly end: number;
  constructor(bytes: Uint8Array, end = bytes.length) {
    this.bytes = bytes;
    this.end = end;
  }
  take(n: number) {
    requireValue(
      Number.isInteger(n) && n >= 0 && this.pos + n <= this.end,
      "Archivo MIDI truncado o longitud inválida.",
    );
    const result = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return result;
  }
  u8() {
    return this.take(1)[0];
  }
  u16() {
    const b = this.take(2);
    return b[0] * 256 + b[1];
  }
  u32() {
    const b = this.take(4);
    return b[0] * 16777216 + b[1] * 65536 + b[2] * 256 + b[3];
  }
  tag() {
    return String.fromCharCode(...this.take(4));
  }
  vlq() {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      n = n * 128 + (b & 127);
      if (!(b & 128)) return n;
    }
    throw new Error("Un tiempo MIDI ocupa más de cuatro bytes.");
  }
  data() {
    const b = this.u8();
    requireValue(b < 128, "Dato MIDI fuera de rango.");
    return b;
  }
}
function text(bytes: Uint8Array) {
  let value = new TextDecoder().decode(bytes);
  if (value.includes("\ufffd"))
    value = new TextDecoder("windows-1252").decode(bytes);
  return value
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 80);
}

/** Bounded Standard MIDI File reader. Timing stays in musical beats. */
export function readMidi(bytes: Uint8Array): MidiSong {
  requireValue(bytes.length <= MIDI_MAX_BYTES, "El archivo MIDI supera 8 MB.");
  const r = new Reader(bytes);
  requireValue(
    r.tag() === "MThd",
    "El archivo no es un Standard MIDI File (.mid).",
  );
  const headerSize = r.u32();
  requireValue(headerSize >= 6, "Cabecera MIDI inválida.");
  const header = new Reader(r.take(headerSize)),
    format = header.u16(),
    trackCount = header.u16(),
    ppq = header.u16();
  requireValue(
    format === 0 || format === 1,
    "Se admiten MIDI tipo 0 y 1; el tipo 2 contiene secuencias independientes.",
  );
  requireValue(
    trackCount >= 1 && trackCount <= 128 && (format !== 0 || trackCount === 1),
    "Cantidad de pistas MIDI no compatible (máximo 128).",
  );
  requireValue(
    ppq > 0 && !(ppq & 0x8000),
    "Se requiere tiempo MIDI por pulsos de negra (PPQ); SMPTE no está soportado.",
  );
  const raw: Raw[] = [],
    names: string[] = [],
    tempos: { tick: number; us: number }[] = [];
  const warnings = new Set<string>();
  let eventCount = 0,
    tracks = 0,
    endTick = 0,
    chunks = 0;
  while (r.pos < r.end) {
    requireValue(++chunks <= 256, "Demasiados bloques MIDI.");
    const tag = r.tag(),
      data = r.take(r.u32());
    if (tag !== "MTrk") continue;
    requireValue(
      tracks < trackCount,
      "El archivo contiene más pistas de las declaradas.",
    );
    const track = tracks++,
      tr = new Reader(data);
    let tick = 0,
      running = 0,
      port = 0,
      ended = false;
    while (tr.pos < tr.end) {
      requireValue(
        ++eventCount <= MAX_EVENTS,
        "El MIDI supera 200 000 eventos.",
      );
      tick += tr.vlq();
      requireValue(
        tick <= ppq * 256,
        "El MIDI supera el límite de 64 compases de StudioWav.",
      );
      let status = tr.bytes[tr.pos];
      requireValue(status !== undefined, "Falta un evento MIDI.");
      if (status < 128) {
        requireValue(
          running !== 0,
          "Running status MIDI sin un estado anterior.",
        );
        status = running;
      } else tr.pos++;
      if (status === 0xff) {
        const type = tr.u8(),
          payload = tr.take(tr.vlq());
        if (type === 0x2f) {
          requireValue(
            payload.length === 0 && tr.pos === tr.end,
            "Final de pista MIDI inválido.",
          );
          ended = true;
          break;
        }
        if (type === 3) names[track] = text(payload);
        if (type === 0x21) {
          requireValue(
            payload.length === 1 && payload[0] < 128,
            "Puerto MIDI inválido.",
          );
          port = payload[0];
        }
        if (type === 0x51) {
          requireValue(payload.length === 3, "Evento de tempo MIDI inválido.");
          const us = payload[0] * 65536 + payload[1] * 256 + payload[2];
          requireValue(us > 0, "El tempo MIDI no puede ser cero.");
          tempos.push({ tick, us });
        }
        if (type === 0x58) {
          requireValue(payload.length === 4, "Compás MIDI inválido.");
          if (payload[0] !== 4 || payload[1] !== 2)
            warnings.add(
              "La rejilla del arreglo usa 4/4; las notas conservan sus posiciones en negras.",
            );
        }
      } else if (status === 0xf0 || status === 0xf7) {
        tr.take(tr.vlq());
        warnings.add("Los mensajes SysEx no se importan.");
      } else {
        requireValue(
          status >= 0x80 && status <= 0xef,
          "Estado de evento MIDI no compatible.",
        );
        running = status;
        const kind = status >> 4,
          a = tr.data(),
          b = kind === 0xc || kind === 0xd ? 0 : tr.data();
        raw.push({ tick, order: eventCount, track, port, status, a, b });
      }
    }
    if (!ended)
      warnings.add(
        "Una pista no tenía marca de final; se usó su último evento.",
      );
    endTick = Math.max(endTick, tick);
  }
  requireValue(
    tracks === trackCount,
    "Faltan pistas declaradas en la cabecera MIDI.",
  );
  raw.sort((a, b) => a.tick - b.tick || a.order - b.order);
  tempos.sort((a, b) => a.tick - b.tick);
  let initialTempo = 500000;
  for (const tempo of tempos) if (tempo.tick === 0) initialTempo = tempo.us;
  if (tempos.some((t) => t.tick > 0 && t.us !== initialTempo))
    warnings.add(
      "El archivo contiene cambios de tempo. StudioWav usa un tempo fijo y conserva el ritmo en negras.",
    );
  const parts = new Map<string, MidiPart>(),
    programs = new Map<number, number>();
  const held = new Map<string, Pending[]>(),
    sustained = new Map<number, Pending[]>(),
    pedal = new Set<number>();
  let noteCount = 0;
  function finish(note: Pending, tick: number) {
    note.part.notes.push({
      pitch: note.part.drumNote === undefined ? note.pitch : 60,
      start: (note.tick * 4) / ppq,
      length: Math.max(1 / 64, ((tick - note.tick) * 4) / ppq),
      velocity: note.velocity / 127,
    });
  }
  function releasePedal(key: number, tick: number, clearPedal = true) {
    for (const note of sustained.get(key) ?? []) finish(note, tick);
    sustained.delete(key);
    if (clearPedal) pedal.delete(key);
  }
  for (const event of raw) {
    const channel = event.status & 15,
      channelKey = event.port * 16 + channel,
      kind = event.status >> 4;
    const key = `${channelKey}:${event.a}`;
    if (kind === 0xc) programs.set(channelKey, event.a);
    else if (kind === 9 && event.b > 0) {
      requireValue(
        ++noteCount <= MAX_NOTES,
        "El archivo MIDI supera 32 768 notas.",
      );
      const program = programs.get(channelKey) ?? 0;
      const partKey = `${event.track}:${event.port}:${channel}:${channel === 9 ? event.a : program}`;
      let part = parts.get(partKey);
      if (!part) {
        requireValue(
          parts.size < 128,
          "El MIDI contiene más de 128 partes o voces de batería.",
        );
        part = {
          id: partKey,
          name: names[event.track] || `MIDI ${event.track + 1}`,
          program,
          channel,
          port: event.port,
          ...(channel === 9 ? { drumNote: event.a } : {}),
          notes: [],
        };
        parts.set(partKey, part);
      }
      const queue = held.get(key) ?? [];
      queue.push({ part, pitch: event.a, tick: event.tick, velocity: event.b });
      held.set(key, queue);
    } else if (kind === 8 || (kind === 9 && event.b === 0)) {
      const queue = held.get(key),
        note = queue?.shift();
      if (queue?.length === 0) held.delete(key);
      if (note) {
        if (pedal.has(channelKey)) {
          const list = sustained.get(channelKey) ?? [];
          list.push(note);
          sustained.set(channelKey, list);
        } else finish(note, event.tick);
      }
    } else if (kind === 0xb) {
      if (event.a === 64) {
        if (event.b >= 64) pedal.add(channelKey);
        else releasePedal(channelKey, event.tick);
      } else if (event.a === 120 || event.a === 123) {
        for (const [key, queue] of held)
          if (key.startsWith(`${channelKey}:`)) {
            for (const note of queue) {
              if (event.a === 123 && pedal.has(channelKey)) {
                const list = sustained.get(channelKey) ?? [];
                list.push(note);
                sustained.set(channelKey, list);
              } else finish(note, event.tick);
            }
            held.delete(key);
          }
        if (event.a === 120) releasePedal(channelKey, event.tick, false);
      } else if (event.a === 121) releasePedal(channelKey, event.tick);
      else
        warnings.add(
          "Se importan notas, programas y pedal sustain; otros controladores y expresiones no se reproducen.",
        );
    } else if (kind !== 0xc)
      warnings.add(
        "Se importan notas, programas y pedal sustain; otros controladores y expresiones no se reproducen.",
      );
  }
  if (held.size)
    warnings.add("Las notas sin Note Off se cerraron al final del archivo.");
  for (const queue of held.values())
    for (const note of queue) finish(note, endTick);
  for (const queue of sustained.values())
    for (const note of queue) finish(note, endTick);
  const result = [...parts.values()].filter((p) => p.notes.length > 0);
  requireValue(result.length > 0, "El MIDI no contiene notas para importar.");
  let length = (endTick * 4) / ppq;
  const nameCounts = new Map<string, number>();
  for (const part of result)
    nameCounts.set(part.name, (nameCounts.get(part.name) ?? 0) + 1);
  for (const part of result) {
    if (nameCounts.get(part.name)! > 1)
      part.name +=
        part.drumNote !== undefined
          ? ` · GM ${part.drumNote}`
          : ` · canal ${part.channel + 1}, programa ${part.program + 1}`;
    part.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    for (const note of part.notes)
      length = Math.max(length, note.start + note.length);
  }
  requireValue(
    length <= 1024 + 1e-8,
    "Las notas del MIDI superan 64 compases.",
  );
  return {
    format,
    ppq,
    bpm: Math.round((60000000 / initialTempo) * 100) / 100,
    length,
    parts: result,
    warnings: [...warnings],
  };
}

const drums: Record<number, Track["instrument"]> = {
  35: "kick",
  36: "kick",
  38: "snare",
  40: "snare",
  39: "clap",
  42: "hat",
  44: "hat",
  46: "openhat",
};
export function midiPartName(part: MidiPart) {
  return part.name;
}
export function importMidi(
  project: Project,
  song: MidiSong,
  options: MidiImportOptions,
  name: string,
) {
  const selected = song.parts.filter((part) => options.parts.includes(part.id));
  requireValue(
    selected.length > 0 &&
      new Set(options.parts).size === options.parts.length &&
      selected.length === options.parts.length,
    "Selecciona partes MIDI válidas.",
  );
  requireValue(
    Number.isInteger(options.startBar) &&
      options.startBar >= 0 &&
      options.startBar < 64,
    "Compás de inicio inválido.",
  );
  const next: Project = options.replace
    ? {
        version: 1,
        name,
        bpm: project.bpm,
        swing: 0,
        master: 0.78,
        bars: 2,
        tracks: [],
        patterns: [],
        clips: [],
        samples: [],
        lanes: [],
      }
    : structuredClone(project);
  requireValue(
    next.tracks.length + selected.length <= 32,
    "El proyecto admite hasta 32 canales; importa menos partes o crea un proyecto nuevo.",
  );
  requireValue(
    playlistLanes(next).length < 32,
    "El proyecto ya tiene 32 pistas de Playlist.",
  );
  const startBar = options.replace ? 0 : options.startBar;
  const span = Math.ceil(song.length / 16);
  requireValue(
    startBar + span <= 64,
    "El MIDI no cabe antes del compás 64. Cambia el compás de inicio.",
  );
  if (options.useTempo) {
    requireValue(
      song.bpm >= 40 && song.bpm <= 240,
      "El tempo del archivo está fuera de 40–240 BPM. Conserva el tempo del proyecto.",
    );
    next.bpm = song.bpm;
  }
  // Fix legacy implicit Playlist lanes before appending new instruments.
  next.lanes = structuredClone(playlistLanes(next));
  const mapped = selected.map((part) => {
    const instrument =
      part.drumNote !== undefined
        ? (drums[part.drumNote] ?? "snare")
        : part.program >= 32 && part.program <= 39
          ? "bass"
          : part.program >= 88 && part.program <= 95
            ? "pad"
            : "keys";
    const track = createTrack(instrument, midiPartName(part));
    track.send = 0;
    if (part.drumNote !== undefined) track.midiDrumNote = part.drumNote;
    else track.midiProgram = part.program;
    next.tracks.push(track);
    for (const pattern of next.patterns)
      pattern.channels[track.id] = {
        steps: Array(pattern.length).fill(0),
        notes: [],
      };
    return { part, track };
  });
  const lane = {
    id: id(),
    name: `MIDI · ${name}`,
    color: "#91c8a5",
    muted: false,
  };
  next.lanes.push(lane);
  const warnings = new Set(song.warnings),
    patterns: string[] = [];
  let split = 0,
    quantized = false;
  for (let offset = 0; offset < song.length; offset += 128) {
    const length =
      [16, 32, 64, 128].find((n) => n >= Math.min(128, song.length - offset)) ??
      128;
    const pattern = emptyPattern(
      next.tracks,
      `${name} · ${offset / 16 + 1}`,
      length,
    );
    let filled = false;
    for (const { part, track } of mapped)
      for (const note of part.notes) {
        const start = Math.min(1024 - 1 / 64, Math.round(note.start * 64) / 64);
        const end = Math.min(
          1024,
          Math.max(
            start + 1 / 64,
            Math.round((note.start + note.length) * 64) / 64,
          ),
        );
        quantized ||=
          Math.abs(start - note.start) > 1e-7 ||
          Math.abs(end - note.start - note.length) > 1e-7;
        if (start >= offset + length || end <= offset) continue;
        const channel = pattern.channels[track.id];
        requireValue(
          channel.notes.length < 2048,
          "Una parte supera 2048 notas por bloque de ocho compases.",
        );
        if (start < offset) split++;
        channel.notes.push({
          id: id(),
          pitch: note.pitch,
          start: Math.max(0, start - offset),
          length: Math.min(offset + length, end) - Math.max(offset, start),
          velocity: note.velocity,
        });
        filled = true;
      }
    if (!filled) continue;
    requireValue(
      next.patterns.length < 64 && next.clips.length < 2048,
      "No quedan patrones o clips disponibles para importar.",
    );
    next.patterns.push(pattern);
    patterns.push(pattern.id);
    next.clips.push({
      id: id(),
      trackId: mapped[0].track.id,
      patternId: pattern.id,
      laneId: lane.id,
      scope: "pattern",
      startBar: startBar + offset / 16,
      lengthBars: length / 16,
      loop: false,
    });
  }
  if (split)
    warnings.add(
      `${split} continuaciones de nota cruzan bloques de ocho compases y se rearticulan en el siguiente bloque.`,
    );
  if (quantized)
    warnings.add(
      "Los tiempos se ajustaron a la resolución mínima de 1/64 de paso de StudioWav.",
    );
  next.bars = Math.max(next.bars, 2, startBar + span);
  validateProject(next);
  return {
    project: next,
    patternId: patterns[0],
    trackId: mapped[0].track.id,
    warnings: [...warnings],
  };
}

type OutputEvent = { tick: number; priority: number; bytes: number[] };
function vlq(n: number) {
  requireValue(
    Number.isInteger(n) && n >= 0 && n <= 0x0fffffff,
    "Tiempo de exportación MIDI fuera de rango.",
  );
  const bytes = [n & 127];
  while ((n = Math.floor(n / 128)) > 0) bytes.unshift((n & 127) | 128);
  return bytes;
}
function u32(n: number) {
  return [
    Math.floor(n / 16777216) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ];
}
function meta(type: number, data: number[]) {
  return [255, type, ...vlq(data.length), ...data];
}
function writeTrack(events: OutputEvent[], endTick: number) {
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  const data: number[] = [];
  let previous = 0;
  for (const event of events) {
    data.push(...vlq(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  data.push(...vlq(Math.max(previous, endTick) - previous), 255, 47, 0);
  return [77, 84, 114, 107, ...u32(data.length), ...data];
}
/** Type 1 SMF: one conductor track and one stream per audible instrument. */
export function writeMidi(project: Project, mode: Mode, patternId: string) {
  validateProject(project);
  const pattern =
    project.patterns.find((p) => p.id === patternId) ?? project.patterns[0];
  const steps = mode === "song" ? project.bars * 16 : pattern.length,
    endTick = Math.round((steps * PPQ) / 4);
  const byTrack = new Map<string, { track: Track; events: OutputEvent[] }>();
  const warnings = new Set<string>();
  let notes = 0,
    melodic = 0;
  const mappings = new Map<string, { channel: number; port: number }>();
  for (const track of project.tracks)
    if (track.kind !== "bus" && track.instrument !== "sample") {
      const percussion =
        track.midiDrumNote !== undefined || !isMelodic(track.instrument);
      const index = melodic % 15;
      mappings.set(
        track.id,
        percussion
          ? { channel: 9, port: 0 }
          : {
              channel: index < 9 ? index : index + 1,
              port: Math.floor(melodic++ / 15),
            },
      );
    }
  const gm: Record<string, number> = {
    kick: 36,
    snare: 38,
    clap: 39,
    hat: 42,
    openhat: 46,
  };
  for (let step = 0; step < steps; step++)
    for (const event of eventsAtStep(project, step, mode, pattern.id)) {
      const track = event.track,
        mapping = mappings.get(track.id);
      if (!mapping) {
        if (track.instrument === "sample")
          warnings.add(
            "Los clips de audio y muestras no se incluyen en MIDI; usa WAV para exportar su sonido.",
          );
        continue;
      }
      if (event.velocity <= 0) continue;
      requireValue(
        ++notes <= MAX_NOTES,
        "La exportación MIDI supera 32 768 notas.",
      );
      const { channel } = mapping;
      const pitch =
        channel === 9
          ? (track.midiDrumNote ?? gm[track.instrument] ?? event.pitch)
          : event.pitch;
      const start = Math.min(
        endTick - 1,
        Math.round(
          ((eventTime(event.step, project.bpm, project.swing) * project.bpm) /
            60) *
            PPQ,
        ),
      );
      const end = Math.min(
        endTick,
        start + Math.max(1, Math.round((event.length * PPQ) / 4)),
      );
      let stream = byTrack.get(track.id);
      if (!stream) {
        stream = { track, events: [] };
        byTrack.set(track.id, stream);
      }
      stream.events.push(
        {
          tick: start,
          priority: 1,
          bytes: [
            0x90 | channel,
            pitch,
            Math.max(1, Math.round(event.velocity * 127)),
          ],
        },
        { tick: end, priority: 0, bytes: [0x80 | channel, pitch, 0] },
      );
    }
  requireValue(
    notes > 0,
    "No hay notas MIDI audibles en esta selección. Los clips de audio se exportan como WAV.",
  );
  const tempo = Math.round(60000000 / project.bpm);
  const conductor = writeTrack(
    [
      {
        tick: 0,
        priority: -3,
        bytes: meta(3, [
          ...new TextEncoder().encode(project.name.slice(0, 80)),
        ]),
      },
      {
        tick: 0,
        priority: -2,
        bytes: meta(0x51, [
          (tempo >>> 16) & 255,
          (tempo >>> 8) & 255,
          tempo & 255,
        ]),
      },
      { tick: 0, priority: -1, bytes: meta(0x58, [4, 2, 24, 8]) },
    ],
    endTick,
  );
  const chunks = [conductor];
  for (const { track, events } of byTrack.values()) {
    const { channel, port } = mappings.get(track.id)!;
    events.push(
      {
        tick: 0,
        priority: -3,
        bytes: meta(3, [...new TextEncoder().encode(track.name.slice(0, 80))]),
      },
      { tick: 0, priority: -2, bytes: meta(0x21, [port]) },
    );
    if (channel !== 9)
      events.push({
        tick: 0,
        priority: -1,
        bytes: [
          0xc0 | channel,
          track.midiProgram ??
            (track.instrument === "bass"
              ? 32
              : track.instrument === "pad"
                ? 88
                : 0),
        ],
      });
    chunks.push(writeTrack(events, endTick));
  }
  const count = chunks.length,
    size = 14 + chunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = new Uint8Array(size);
  bytes.set([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    1,
    count >>> 8,
    count & 255,
    PPQ >>> 8,
    PPQ & 255,
  ]);
  let at = 14;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes, notes, tracks: byTrack.size, warnings: [...warnings] };
}
