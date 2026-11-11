import { createProject, createTrack } from "../../src/model.ts";
import { encodeWav } from "../../src/audio/wav.ts";

/** Original stereo signal with no synth envelope, for measurable DSP tests. */
export function signalProject(
  frequency: number,
  amplitude = 0.1,
  envelope: (seconds: number) => number = () => 1,
) {
  const p = createProject(false),
    track = createTrack("sample", "Señal de prueba");
  p.name = "Prueba de efectos";
  p.bpm = 120;
  p.swing = 0;
  p.master = 0.5;
  p.bars = 2;
  track.sampleId = "signal";
  track.gain = 1;
  track.pan = 0;
  track.send = 0;
  const samples = new Float32Array(3 * 44100);
  for (let i = 0; i < samples.length; ++i)
    samples[i] =
      amplitude *
      envelope(i / 44100) *
      (frequency > 0 ? Math.sin((2 * Math.PI * frequency * i) / 44100) : 1);
  p.samples = [
    {
      id: "signal",
      name: "Original signal",
      duration: 3,
      data:
        "data:audio/wav;base64," +
        Buffer.from(
          encodeWav(
            [samples, Float32Array.from(samples, (n) => n * 0.2)],
            44100,
          ),
        ).toString("base64"),
    },
  ];
  p.tracks = [track];
  p.patterns = p.patterns.slice(0, 1);
  const pat = p.patterns[0];
  pat.length = 32;
  pat.channels = {
    [track.id]: {
      steps: Array(32).fill(0),
      notes: [{ id: "tone", pitch: 60, start: 0, length: 20, velocity: 1 }],
    },
  };
  p.lanes = [{ id: "lane", name: "Audio", color: track.color, muted: false }];
  p.clips = [
    {
      id: "clip",
      trackId: track.id,
      patternId: pat.id,
      laneId: "lane",
      scope: "pattern",
      startBar: 0,
      lengthBars: 2,
    },
  ];
  return p;
}
