import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createProject, id, validateProject } from "../src/model.ts";
import { addPluginTrack } from "../src/plugins.ts";
const { NativeAudio } = createRequire(import.meta.url)(
  "../electron/native.cjs",
);
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-demo-"));
const audio = new NativeAudio(
  { isPackaged: false, getPath: () => profile },
  () => {},
);
try {
  const library = await audio.request("bundledPlugins");
  const p = createProject(false);
  const bass = p.tracks.find((t) => t.instrument === "bass"),
    hat = p.tracks.find((t) => t.instrument === "hat");
  const piano = addPluginTrack(
    p,
    library.find((p) => p.bundledId === "piano"),
  );
  const kick = addPluginTrack(
    p,
    library.find((p) => p.bundledId === "kick"),
  );
  p.tracks = [piano, kick, bass, hat];
  p.name = "Piano y kicks · StudioWav";
  p.bpm = 112;
  p.swing = 0.05;
  p.bars = 8;
  piano.gain = 0.85;
  piano.send = 0.13;
  kick.gain = 0.65;
  bass.gain = 0.35;
  hat.gain = 0.35;
  p.lanes = [
    { id: id(), name: "Piano + batería", color: piano.color, muted: false },
  ];
  for (let patternIndex = 0; patternIndex < p.patterns.length; patternIndex++) {
    const pattern = p.patterns[patternIndex];
    pattern.name = patternIndex ? "Piano · variación" : "Piano · acordes";
    pattern.channels = Object.fromEntries(
      p.tracks.map((t) => [
        t.id,
        { steps: Array(pattern.length).fill(0), notes: [] },
      ]),
    );
    const add = (t, pitch, start, length, velocity) =>
      pattern.channels[t.id].notes.push({
        id: id(),
        pitch,
        start,
        length,
        velocity,
      });
    [60, 57, 65, 67].forEach((root, chord) => {
      for (const [i, interval] of [0, root === 57 ? 3 : 4, 7].entries())
        add(
          piano,
          root + interval,
          chord * 8 + (patternIndex ? i * 1.5 : 0),
          patternIndex ? 3 : 7,
          0.67 - i * 0.07,
        );
      add(bass, root - 24, chord * 8, 6, 0.7);
    });
    for (let step = 0; step < pattern.length; step += 4)
      pattern.channels[kick.id].steps[step] = step % 8 ? 0.55 : 0.85;
    for (let step = 2; step < pattern.length; step += 2)
      pattern.channels[hat.id].steps[step] = step % 4 ? 0.4 : 0.25;
  }
  p.clips = Array.from({ length: 4 }, (_, i) => ({
    id: id(),
    trackId: piano.id,
    patternId: p.patterns[i % 2].id,
    laneId: p.lanes[0].id,
    scope: "pattern",
    startBar: i * 2,
    lengthBars: 2,
    loop: true,
  }));
  validateProject(p);
  await mkdir("examples", { recursive: true });
  await writeFile(
    "examples/Piano y kicks.studiowav",
    JSON.stringify(p, null, 2),
  );
  console.log(
    "Created examples/Piano y kicks.studiowav with stable bundled instrument references.",
  );
} finally {
  audio.close();
  if (
    !path.resolve(profile).startsWith(path.join(os.tmpdir(), "studiowav-demo-"))
  )
    throw new Error("Unexpected demo profile");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
