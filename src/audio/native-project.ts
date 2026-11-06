import { eventTime, eventsAtStep, validateMixer } from "../model.ts";
import type { Mode, Project } from "../model.ts";

export function nativeProject(
  project: Project,
  mode: Mode,
  patternId: string,
  includeSamples = true,
) {
  validateMixer(project);
  const length =
    mode === "song"
      ? project.bars * 16
      : (
          project.patterns.find((p) => p.id === patternId) ??
          project.patterns[0]
        ).length;
  // Mute/solo are applied by the mixer so changing a switch does not kill a bus's inputs.
  const source = {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, muted: false, solo: false })),
  };
  const events = [];
  for (let step = 0; step < length; step++)
    for (const event of eventsAtStep(source, step, mode, patternId)) {
      if (event.track.kind === "bus") continue;
      events.push({
        trackId: event.track.id,
        time: eventTime(event.step, project.bpm, project.swing),
        duration: (event.length * 60) / project.bpm / 4,
        pitch: event.pitch,
        velocity: event.velocity,
      });
    }
  return {
    bpm: project.bpm,
    master: project.master,
    length,
    mode,
    patternId,
    duration: (length * 60) / project.bpm / 4,
    tracks: project.tracks,
    sampleIds: project.samples.map((sample) => sample.id),
    events,
    ...(includeSamples ? { samples: project.samples } : {}),
  };
}
