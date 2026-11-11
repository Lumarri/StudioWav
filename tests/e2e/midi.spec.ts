import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createProject } from "../../src/model.ts";
import { readMidi } from "../../src/midi.ts";
import { melodyFixture, fixture } from "../fixtures/midi.ts";

async function setup(page: any) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Arreglo", exact: true }),
  ).toBeVisible();
}
async function upload(page: any, bytes = melodyFixture()) {
  await page
    .locator('input[accept=".mid,.midi,audio/midi,audio/x-midi"]')
    .setInputFiles({
      name: "Piano.mid",
      mimeType: "audio/midi",
      buffer: Buffer.from(bytes),
    });
}
async function save(page: any) {
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  return JSON.parse(
    (await readFile((await (await download).path())!)).toString(),
  );
}
test("MIDI import creates actual editable notes and arrangement clips, exports a valid pattern, and is undoable", async ({
  page,
}) => {
  await setup(page);
  await upload(page);
  const dialog = page.getByRole("dialog", {
    name: "Importar archivo MIDI",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "Importar Piano", exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Importar partes seleccionadas", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".playlist-row")).toHaveCount(9);
  await page.keyboard.press("F7");
  await expect(page.locator(".piano-note")).toHaveCount(2);
  const p = await save(page),
    track = p.tracks.at(-1),
    pattern = p.patterns.at(-1);
  expect(p.tracks).toHaveLength(9);
  expect(pattern.channels[track.id].notes[0].start).toBe(0.5);
  expect(p.clips.at(-1).scope).toBe("pattern");
  await page.getByRole("menuitem", { name: "ARCHIVO", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Exportar patrón MIDI…", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mid$/);
  const midi = readMidi(new Uint8Array(await readFile((await file.path())!)));
  expect(midi.parts[0].notes.map((n) => n.pitch)).toEqual([60, 64]);
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  const before = await save(page);
  expect(before.tracks).toHaveLength(8);
  expect(before.patterns).toHaveLength(2);
});
test("cancel and malformed MIDI leave the current project intact, while a new MIDI project can take its tempo", async ({
  page,
}) => {
  await setup(page);
  await upload(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Importar archivo MIDI", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".playlist-row")).toHaveCount(8);
  await upload(page, new Uint8Array([1, 2, 3]));
  await expect(page.getByRole("status")).toContainText(
    /truncado|Standard MIDI/,
  );
  await expect(page.locator(".playlist-row")).toHaveCount(8);
  await upload(page);
  await page
    .getByRole("checkbox", { name: "Crear un proyecto nuevo", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", {
      name: "Usar tempo del MIDI (120 BPM)",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Importar partes seleccionadas", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Tempo BPM", exact: true }),
  ).toHaveValue("120");
  const p = await save(page);
  expect(p.tracks).toHaveLength(1);
  expect(p.swing).toBe(0);
  expect(p.clips).toHaveLength(1);
});
test("GM percussion parts can be selected separately and their notes remain visible in the rack and Piano Roll", async ({
  page,
}) => {
  await setup(page);
  await upload(
    page,
    fixture([
      [
        0, 153, 36, 100, 0, 153, 42, 80, 120, 137, 36, 0, 0, 137, 42, 0, 0, 255,
        47, 0,
      ],
    ]),
  );
  await page
    .getByRole("checkbox", { name: "Importar MIDI 1 · GM 42", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Importar partes seleccionadas", exact: true })
    .click();
  await page.getByRole("tab", { name: "Secuenciador F6", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Editar notas de MIDI 1 · GM 36",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("F7");
  await expect(page.locator(".piano-note")).toHaveCount(1);
  await page
    .locator('.piano-lane[data-pitch="60"]')
    .click({ position: { x: 98, y: 9 } });
  await expect(page.locator(".piano-note")).toHaveCount(2);
  const p = await save(page);
  expect(p.tracks.at(-1).instrument).toBe("kick");
  expect(p.tracks.at(-1).midiDrumNote).toBe(36);
});
