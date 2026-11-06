import { createTrack, id } from "./model.ts";
import type { PluginSlot, Project, Track } from "./model.ts";
import type { FoundPlugin } from "./audio/desktop-engine.ts";

export const isPluginInstrument = (slot: PluginSlot) =>
  slot.instrument ?? /\bisInstrument="1"/.test(slot.description);

export function insertPlugin(track: Track, plugin: FoundPlugin) {
  if (track.kind === "bus" && plugin.instrument)
    throw new Error("Añade los instrumentos a un canal del rack.");
  const slots = track.plugins ?? [];
  const effects = plugin.instrument
    ? slots.filter((s) => !isPluginInstrument(s))
    : slots;
  if (effects.length >= 8) throw new Error("El canal ya tiene ocho plugins.");
  const slot = {
    id: id(),
    name: plugin.name,
    description: plugin.description,
    instrument: plugin.instrument,
    bypassed: false,
  };
  // One sound generator before the effect chain; replacing it preserves effects.
  track.plugins = plugin.instrument ? [slot, ...effects] : [...effects, slot];
}

export function addPluginTrack(project: Project, plugin: FoundPlugin): Track {
  if (!plugin.instrument) throw new Error("Selecciona un instrumento VST3.");
  if (project.tracks.length >= 32)
    throw new Error("El proyecto admite hasta 32 pistas.");
  const track = createTrack(
    plugin.bundledId === "kick" ? "kick" : "keys",
    plugin.name,
  );
  track.send = 0;
  insertPlugin(track, plugin);
  project.tracks.push(track);
  for (const pattern of project.patterns)
    pattern.channels[track.id] = {
      steps: Array(pattern.length).fill(0),
      notes: [],
    };
  return track;
}
