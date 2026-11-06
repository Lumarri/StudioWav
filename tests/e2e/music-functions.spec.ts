import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createProject } from "../../src/model.ts";
async function setup(page: any, chord = false) {
  await page.goto("/");
  const p = createProject(false),
    pat = p.patterns[0],
    bass = p.tracks[5];
  p.swing = 0;
  pat.channels[bass.id].notes = (chord ? [36, 40, 43] : [36]).map(
    (pitch, i) => ({
      id: `note-${i}`,
      pitch,
      start: 0,
      length: 8,
      velocity: 0.7,
    }),
  );
  pat.channels[p.tracks[6].id].notes = [
    { id: "keys", pitch: 60, start: 4, length: 4, velocity: 0.6 },
  ];
  await page
    .locator('input[type=file][accept=".studiowav,.json"]')
    .setInputFiles({
      name: "functional.studiowav",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
  await expect(page.getByRole("status")).toContainText("Proyecto abierto");
  return p;
}
async function save(page: any) {
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  return JSON.parse(
    (await readFile((await (await download).path())!)).toString(),
  );
}

test("pattern clips keep all channels, can be made unique, looped and moved to independent Playlist lanes", async ({
  page,
}) => {
  const p = await setup(page);
  await page.keyboard.press("F5");
  const lane = page.locator(".playlist-row").first().locator(".clip-lane");
  await lane.click({ position: { x: 28, y: 23 } });
  const clip = lane.locator(".pattern-clip");
  await clip.click();
  await page
    .getByRole("button", { name: "Duplicar clip", exact: true })
    .click();
  await expect(lane.locator(".pattern-clip")).toHaveCount(2);
  await page.getByRole("button", { name: "Hacer único", exact: true }).click();
  await expect(page.locator(".browser-patterns > button")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Extender bucle", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Añadir pista de Playlist", exact: true })
    .click();
  await expect(page.locator(".playlist-row")).toHaveCount(9);
  const other = page.locator(".playlist-row").last().locator(".clip-lane");
  await lane
    .locator(".pattern-clip")
    .first()
    .dragTo(other, { targetPosition: { x: 28, y: 23 } });
  const result = await save(page);
  expect(result.tracks).toHaveLength(8);
  expect(result.lanes).toHaveLength(9);
  const moved = result.clips.find((c: any) => c.laneId === result.lanes[8].id);
  expect(moved.scope).toBe("pattern");
  expect(moved.loop).toBe(true);
  expect(moved.lengthBars).toBe(4);
  expect(moved.patternId).not.toBe(p.patterns[0].id);
  const pat = result.patterns.find((v: any) => v.id === moved.patternId);
  expect(pat.channels[p.tracks[5].id].notes).toHaveLength(1);
  expect(pat.channels[p.tracks[6].id].notes).toHaveLength(1);
  expect(
    result.clips.find((c: any) => c.patternId === p.patterns[0].id),
  ).toBeTruthy();
});

test("arpeggiator previews actual notes and audio, cancel preserves the source and accept is undoable", async ({
  page,
}) => {
  await setup(page, true);
  await page.keyboard.press("F7");
  await expect(page.locator(".piano-note")).toHaveCount(3);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Alt+a");
  const dialog = page.getByRole("dialog", { name: "Arpegiador", exact: true });
  await expect(dialog).toBeVisible();
  await page
    .getByLabel("Rejilla de herramienta", { exact: true })
    .selectOption("2");
  await page.getByLabel("Octavas del arpegio", { exact: true }).fill("2");
  await expect(page.locator(".note-tool-preview rect")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Escuchar resultado", exact: true })
    .click();
  await expect
    .poll(async () =>
      parseFloat(
        await page
          .locator(".mini-master > span")
          .evaluate((node) => (node as HTMLElement).style.width),
      ),
    )
    .toBeGreaterThan(2);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.locator(".piano-note")).toHaveCount(3);
  await page.keyboard.press("Alt+a");
  await expect(page.locator(".note-tool-preview rect")).toHaveCount(8);
  await page
    .getByRole("button", { name: "Aceptar herramienta", exact: true })
    .click();
  await expect(page.locator(".piano-note")).toHaveCount(8);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".piano-note")).toHaveCount(3);
});

test("multi-note selection, duplication, long patterns and fractional quantization are saved as musical data", async ({
  page,
}) => {
  const p = await setup(page, true);
  await page.keyboard.press("F7");
  await page.locator(".piano-note").nth(0).click();
  await page
    .locator(".piano-note")
    .nth(1)
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".piano-note.selected")).toHaveCount(2);
  await page.keyboard.press("Control+b");
  await expect(page.locator(".piano-note")).toHaveCount(5);
  await page
    .getByLabel("Longitud del patrón piano", { exact: true })
    .selectOption("64");
  await expect(page.locator(".piano-grid")).toHaveCSS("width", "1792px");
  await page.keyboard.press("F6");
  await expect(
    page.locator(".rack-row").first().locator(".step-button"),
  ).toHaveCount(64);
  await page.getByRole("menuitem", { name: "PATRONES", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Separar por canales", exact: true })
    .click();
  const result = await save(page);
  expect(result.patterns[0].length).toBe(64);
  expect(result.patterns[0].channels[p.tracks[5].id].notes).toHaveLength(5);
  expect(result.patterns.length).toBe(4);
  expect(
    result.patterns
      .slice(2)
      .every(
        (v: any) =>
          Object.values(v.channels).filter(
            (c: any) => c.notes.length || c.steps.some(Boolean),
          ).length === 1,
      ),
  ).toBe(true);
});
