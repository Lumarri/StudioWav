import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createProject,
  emptyPattern,
  id,
  validateProject,
} from "../src/model.ts";
import { addPluginTrack } from "../src/plugins.ts";
import { nativeProject } from "../src/audio/native-project.ts";
const { NativeAudio } = createRequire(import.meta.url)(
  "../electron/native.cjs",
);
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-synth-demo-"));
const audio = new NativeAudio(
  { isPackaged: false, getPath: () => profile },
  () => {},
);
try {
  const library = await audio.request("bundledPlugins");
  const p = createProject(false);
  p.name = "Cinco instrumentos · StudioWav";
  p.tracks = [];
  p.patterns = [];
  p.clips = [];
  p.bpm = 112;
  p.swing = 0;
  p.bars = 8;
  p.master = 0.65;
  const tracks = library.map((plugin) => addPluginTrack(p, plugin));
  tracks.forEach((track, index) => {
    track.gain = [0.7, 0.55, 0.5, 0.38, 0.7][index];
    track.color = ["#a6c7e8", "#edaa70", "#c1a1e0", "#8cccb5", "#e5b8a2"][
      index
    ];
  });
  const lane = {
    id: id(),
    name: "Cinco instrumentos",
    color: tracks[0].color,
    muted: false,
  };
  p.lanes = [lane];
  const fill = (pattern, index) => {
    const channel = pattern.channels[tracks[index].id];
    const note = (pitch, start, length, velocity) =>
      channel.notes.push({ id: id(), pitch, start, length, velocity });
    if (index === 1) {
      for (let i = 0; i < 16; i += 4) channel.steps[i] = 0.8;
    } else if (index === 0) {
      for (const n of [60, 64, 67]) note(n, 0, 7, 0.7);
      for (const n of [57, 60, 64]) note(n, 8, 7, 0.65);
    } else if (index === 2) {
      note(36, 0, 7, 0.75);
      note(33, 8, 7, 0.75);
    } else if (index === 3) {
      [72, 76, 79, 76].forEach((n, i) => note(n, i * 4, 2, 0.7));
    } else {
      [60, 64, 67, 72, 57, 60, 64, 69].forEach((n, i) =>
        note(n, i * 2, 1.5, 0.8),
      );
    }
  };
  for (let i = 0; i < 6; i++) {
    const pattern = emptyPattern(
      tracks,
      i < 5 ? library[i].name : "Todos juntos",
      16,
    );
    if (i < 5) fill(pattern, i);
    else for (let j = 0; j < 5; j++) fill(pattern, j);
    p.patterns.push(pattern);
    p.clips.push({
      id: id(),
      trackId: tracks[0].id,
      patternId: pattern.id,
      laneId: lane.id,
      scope: "pattern",
      startBar: i,
      lengthBars: i === 5 ? 3 : 1,
      loop: i === 5,
    });
  }
  validateProject(p);
  await audio.request("project", nativeProject(p, "song", p.patterns[0].id));
  const programs = [4, 7, 1, 1, 0];
  for (let i = 0; i < tracks.length; i++) {
    const args = { trackId: tracks[i].id, pluginId: tracks[i].plugins[0].id };
    const program = (await audio.request("parameters", args)).find(
      (parameter) => parameter.name === "Program",
    );
    await audio.request("parameter", {
      ...args,
      index: program.index,
      value: programs[i] / 7,
    });
  }
  const states = await audio.request("states");
  for (const track of tracks)
    track.plugins[0].state = states[track.plugins[0].id];
  await writeFile(
    "examples/Cinco instrumentos.studiowav",
    JSON.stringify(p, null, 2) + "\n",
  );
  await audio.request("project", nativeProject(p, "song", p.patterns[0].id));
  const wav = (
    await audio.request("render", { sampleRate: 44100, bitDepth: 16 })
  ).audio;
  await writeFile("test-results/cinco-instrumentos.wav", Buffer.from(wav));
  console.log(
    "Created original five-instrument project and rendered its audio.",
  );
} finally {
  audio.close();
  if (
    !path
      .resolve(profile)
      .startsWith(path.join(os.tmpdir(), "studiowav-synth-demo-"))
  )
    throw new Error("Unexpected profile");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
