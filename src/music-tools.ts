import { clamp, id, emptyPattern } from "./model.ts";
import type { Channel, Note, Pattern, Project } from "./model.ts";

export type NoteTool =
  | "quantize"
  | "arpeggio"
  | "legato"
  | "chop"
  | "flip"
  | "chord";
export type ToolOptions = {
  grid: number;
  strength: number;
  gate: number;
  octaves: number;
  direction: "up" | "down" | "alternate";
  horizontal: boolean;
  vertical: boolean;
  root: number;
  chord: "major" | "minor" | "seventh" | "minor7";
  seed: number;
};
export const defaultToolOptions: ToolOptions = {
  grid: 1,
  strength: 1,
  gate: 1,
  octaves: 1,
  direction: "up",
  horizontal: true,
  vertical: false,
  root: 60,
  chord: "minor",
  seed: 1,
};
const rounded = (value: number) => Math.round(value * 1024) / 1024;
export function transformNotes(
  notes: Note[],
  selected: ReadonlySet<string>,
  tool: NoteTool,
  options: ToolOptions,
  length: number,
): Note[] {
  const original = structuredClone(notes);
  const targets = original.filter((n) => !selected.size || selected.has(n.id));
  const untouched = original.filter(
    (n) => selected.size && !selected.has(n.id),
  );
  if (!targets.length && tool !== "chord") return original;
  const grid = clamp(options.grid, 0.25, 16),
    strength = clamp(options.strength, 0, 1),
    gate = clamp(options.gate, 0.1, 1);
  let result: Note[] = [];
  if (tool === "quantize")
    result = targets.map((n) => {
      const start = rounded(
        clamp(
          n.start + (Math.round(n.start / grid) * grid - n.start) * strength,
          0,
          length - 1 / 64,
        ),
      );
      return { ...n, start, length: Math.min(n.length, length - start) };
    });
  if (tool === "legato")
    result = targets.map((n) => {
      const next =
        original
          .filter((other) => other.start > n.start)
          .sort((a, b) => a.start - b.start)[0]?.start ?? length;
      return {
        ...n,
        length: rounded(Math.max(1 / 64, (next - n.start) * gate)),
      };
    });
  if (tool === "chop")
    for (const n of targets)
      for (
        let start = n.start;
        start < n.start + n.length - 1e-8;
        start += grid
      ) {
        result.push({
          ...n,
          id: id(),
          start: rounded(start),
          length: rounded(
            Math.max(1 / 64, Math.min(grid * gate, n.start + n.length - start)),
          ),
        });
      }
  if (tool === "flip") {
    const minStart = Math.min(...targets.map((n) => n.start)),
      maxEnd = Math.max(...targets.map((n) => n.start + n.length));
    const low = Math.min(...targets.map((n) => n.pitch)),
      high = Math.max(...targets.map((n) => n.pitch));
    result = targets.map((n) => ({
      ...n,
      start: options.horizontal
        ? rounded(minStart + maxEnd - n.start - n.length)
        : n.start,
      pitch: options.vertical ? low + high - n.pitch : n.pitch,
    }));
  }
  if (tool === "arpeggio") {
    // Chord spans are bounded by starts/ends. Each span uses its currently held pitches.
    const start = Math.min(...targets.map((n) => n.start)),
      end = Math.max(...targets.map((n) => n.start + n.length));
    let sequence = 0;
    for (let at = start; at < end - 1e-8; at += grid) {
      const held = targets
        .filter((n) => n.start <= at + 1e-8 && n.start + n.length > at + 1e-8)
        .sort((a, b) => a.pitch - b.pitch);
      if (!held.length) {
        sequence = 0;
        continue;
      }
      const pitches = Array.from(
        { length: Math.round(clamp(options.octaves, 1, 4)) },
        (_, octave) =>
          held.map((n) => ({ ...n, pitch: n.pitch + octave * 12 })),
      )
        .flat()
        .filter((n) => n.pitch <= 127);
      const path =
        options.direction === "down"
          ? [...pitches].reverse()
          : options.direction === "alternate" && pitches.length > 1
            ? [...pitches, ...pitches.slice(1, -1).reverse()]
            : pitches;
      const n = path[sequence++ % path.length];
      result.push({
        ...n,
        id: id(),
        start: rounded(at),
        length: rounded(
          Math.max(
            1 / 64,
            Math.min(grid * gate, end - at, n.start + n.length - at),
          ),
        ),
      });
    }
  }
  if (tool === "chord") {
    const intervals = {
      major: [0, 4, 7],
      minor: [0, 3, 7],
      seventh: [0, 4, 7, 10],
      minor7: [0, 3, 7, 10],
    }[options.chord];
    result = [
      ...targets,
      ...intervals
        .filter((d) => options.root + d <= 127)
        .map((d) => ({
          id: id(),
          pitch: options.root + d,
          start: 0,
          length: Math.min(length, grid * 4),
          velocity: 0.75,
        })),
    ];
  }
  const output = [...untouched, ...result].sort(
    (a, b) => a.start - b.start || a.pitch - b.pitch,
  );
  if (output.length > 2048)
    throw new Error(
      "La herramienta produciría más de 2048 notas. Aumenta la rejilla o reduce la selección.",
    );
  return output;
}

export function resizePattern(
  project: Project,
  patternId: string,
  length: number,
): Project {
  if (![16, 32, 64, 128].includes(length))
    throw new Error("Longitud de patrón no válida.");
  const p = structuredClone(project),
    pattern = p.patterns.find((v) => v.id === patternId)!;
  for (const channel of Object.values(pattern.channels)) {
    channel.steps = Array.from({ length }, (_, i) => channel.steps[i] ?? 0);
    channel.notes = channel.notes
      .filter((n) => n.start < length)
      .map((n) => ({ ...n, length: Math.min(n.length, length - n.start) }));
  }
  pattern.length = length;
  for (const clip of p.clips)
    if (clip.patternId === patternId && clip.lengthBars === undefined)
      clip.lengthBars = Math.min(length / 16, p.bars - clip.startBar);
  return p;
}
export function makeClipUnique(project: Project, clipId: string): Project {
  if (project.patterns.length >= 64)
    throw new Error("El proyecto admite hasta 64 patrones.");
  const p = structuredClone(project),
    clip = p.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Selecciona un clip.");
  const original = p.patterns.find((v) => v.id === clip.patternId)!;
  const pattern = structuredClone(original);
  pattern.id = id();
  pattern.name = `${original.name} · único`;
  for (const channel of Object.values(pattern.channels))
    for (const note of channel.notes) note.id = id();
  p.patterns.push(pattern);
  clip.patternId = pattern.id;
  return p;
}
export function splitPatternChannels(
  project: Project,
  patternId: string,
): { project: Project; patternId: string } {
  const p = structuredClone(project),
    pattern = p.patterns.find((v) => v.id === patternId)!;
  const tracks = p.tracks.filter(
    (t) =>
      t.kind !== "bus" &&
      (pattern.channels[t.id].notes.length ||
        pattern.channels[t.id].steps.some(Boolean)),
  );
  if (!tracks.length) throw new Error("El patrón no tiene notas ni pasos.");
  if (p.patterns.length + tracks.length > 64)
    throw new Error("Separar estos canales superaría los 64 patrones.");
  const parts = tracks.map((t) => {
    const part = emptyPattern(
      p.tracks,
      `${pattern.name} · ${t.name}`,
      pattern.length,
    );
    part.channels[t.id] = structuredClone(pattern.channels[t.id]);
    for (const n of part.channels[t.id].notes) n.id = id();
    return part;
  });
  p.patterns.push(...parts);
  return { project: p, patternId: parts[0].id };
}
export function patternOverview(pattern: Pattern): Channel {
  const channels = Object.values(pattern.channels);
  return {
    steps: Array.from({ length: pattern.length }, (_, i) =>
      Math.max(0, ...channels.map((c) => c.steps[i] ?? 0)),
    ),
    notes: channels.flatMap((c) => c.notes),
  };
}
