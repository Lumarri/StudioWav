import { readFile, writeFile } from "node:fs/promises";
import { effectPresets } from "../src/channel-effects.ts";
import { validateProject } from "../src/model.ts";
const project = JSON.parse(
  await readFile("examples/Piano y kicks.studiowav", "utf8"),
);
project.name = "Piano y kicks · Mezcla con efectos";
for (const track of project.tracks) {
  if (track.name.includes("Kick"))
    track.effects = structuredClone(effectPresets.drums.settings);
  if (track.name.includes("Piano"))
    track.effects = structuredClone(effectPresets.gentle.settings);
}
validateProject(project);
await writeFile(
  "examples/Mezcla con efectos.studiowav",
  JSON.stringify(project, null, 2) + "\n",
);
console.log("Created original effects example.");
