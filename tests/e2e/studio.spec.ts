import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encodeWav } from "../../src/audio/wav.ts";

test("the desktop workspace edits a beat, undoes it, and plays real audio", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Arreglo", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".playlist-row")).toHaveCount(8);
  const beat = page.getByRole("button", {
    name: "Deep kick, paso 2",
    exact: true,
  });
  await expect(beat).toHaveAttribute("aria-pressed", "false");
  await beat.click();
  await expect(beat).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(beat).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pausar", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Number.parseFloat(
        await page
          .locator(".mini-master > span")
          .evaluate((node) => (node as HTMLElement).style.width),
      ),
    )
    .toBeGreaterThan(2);
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  const pausedPosition = await page.locator(".time-box").innerText();
  await page.waitForTimeout(250);
  expect(await page.locator(".time-box").innerText()).toBe(pausedPosition);
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  await page.screenshot({ path: "test-results/studiowav-arrangement.png" });
  await page.getByRole("button", { name: "Detener", exact: true }).click();
  expect(errors).toEqual([]);
});

test("notes can be created, moved, resized, deleted and restored", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Piano roll" }).click();
  const before = await page.locator(".piano-note").count();
  await page
    .locator('.piano-lane[data-pitch="40"]')
    .click({ position: { x: 98, y: 9 } });
  const note = page.getByRole("button", {
    name: "Nota E2, paso 4",
    exact: true,
  });
  await expect(note).toBeVisible();
  await expect(page.locator(".piano-note")).toHaveCount(before + 1);
  const box = await note.boundingBox();
  await page.mouse.move(box!.x + 9, box!.y + 6);
  await page.mouse.down();
  await page.mouse.move(box!.x + 65, box!.y - 12, { steps: 5 });
  await page.mouse.up();
  const moved = page.getByRole("button", {
    name: "Nota F2, paso 6",
    exact: true,
  });
  await expect(moved).toBeVisible();
  const oldWidth = (await moved.boundingBox())!.width;
  const resize = await moved.locator("[data-resize]").boundingBox();
  await page.mouse.move(resize!.x + 2, resize!.y + 5);
  await page.mouse.down();
  await page.mouse.move(resize!.x + 58, resize!.y + 5, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await moved.boundingBox())!.width)
    .toBeGreaterThan(oldWidth + 40);
  await page.screenshot({ path: "test-results/studiowav-piano.png" });
  await moved.click({ button: "right" });
  await expect(page.locator(".piano-note")).toHaveCount(before);
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.locator(".piano-note")).toHaveCount(before + 1);
});

test("arrangement clips can be placed, moved and removed", async ({ page }) => {
  await page.goto("/");
  const lane = page.locator(".playlist-row").nth(6).locator(".clip-lane");
  const count = await lane.locator(".pattern-clip").count();
  await lane.click({ position: { x: 28, y: 24 } });
  await expect(lane.locator(".pattern-clip")).toHaveCount(count + 1);
  const clip = page.getByRole("button", {
    name: "Velvet keys, Midnight groove, compás 1",
    exact: true,
  });
  await clip.dragTo(lane, { targetPosition: { x: 140, y: 24 } });
  const moved = page.getByRole("button", {
    name: "Velvet keys, Midnight groove, compás 3",
    exact: true,
  });
  await expect(moved).toBeVisible();
  await moved.click({ button: "right" });
  await expect(lane.locator(".pattern-clip")).toHaveCount(count);
});

test("WAV export contains stereo PCM music and respects muted tracks", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PATRÓN", exact: true }).click();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar WAV", exact: true }).click();
  const file = await exported;
  const bytes = await readFile((await file.path())!);
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.readUInt16LE(22)).toBe(2);
  expect(bytes.readUInt32LE(24)).toBe(44100);
  expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  expect(bytes.length).toBeGreaterThan(600000);
  let peak = 0;
  for (let i = 44; i < bytes.length; i += 2)
    peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
  expect(peak).toBeGreaterThan(1000);
  await page.keyboard.press("F9");
  for (const button of await page
    .locator('.mixer-switches button[aria-label^="Mute "]')
    .all())
    await button.click();
  const silence = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar WAV", exact: true }).click();
  const muted = await readFile((await (await silence).path())!);
  expect(muted.subarray(44).some((value) => value !== 0)).toBe(false);
});

test("imported audio is decoded, saved inside the project and restored on reload", async ({
  page,
}) => {
  await page.goto("/");
  const samples = new Float32Array(4410);
  for (let i = 0; i < samples.length; i++)
    samples[i] = Math.sin((i / 44100) * Math.PI * 2 * 440) * 0.3;
  await page.locator('input[type=file][accept^="audio"]').setInputFiles({
    name: "Test tone.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(encodeWav([samples], 44100)),
  });
  await expect(page.locator(".playlist-row")).toHaveCount(9);
  await expect(
    page.getByLabel("Nombre de la pista", { exact: true }),
  ).toHaveValue("Test tone");
  const saved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Guardar proyecto", exact: true })
    .click();
  const file = await saved;
  const bytes = await readFile((await file.path())!);
  const project = JSON.parse(bytes.toString("utf8"));
  expect(project.samples).toHaveLength(1);
  expect(project.samples[0].data).toMatch(/^data:audio\/wav;base64,/);
  await page
    .locator('input[type=file][accept=".studiowav,.json"]')
    .setInputFiles({
      name: "Round trip.studiowav",
      mimeType: "application/json",
      buffer: bytes,
    });
  await expect(page.getByRole("status")).toContainText("Proyecto abierto");
  await expect(page.locator(".playlist-row")).toHaveCount(9);
  await page.getByRole("tab", { name: "Mezclador" }).click();
  await expect(page.locator(".mixer-strip")).toHaveCount(10);
  await page.screenshot({ path: "test-results/studiowav-mixer.png" });
});

test("invalid projects show an error while leaving the current song intact", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type=file][accept=".studiowav,.json"]')
    .setInputFiles({
      name: "Broken.studiowav",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":1,"bpm":0}'),
    });
  await expect(page.getByRole("status")).toContainText("no compatible");
  await expect(page.locator(".playlist-row")).toHaveCount(8);
});

test("keyboard save works in a text field and modal focus stays inside the dialog", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Nombre del proyecto", { exact: true })
    .fill("Keyboard session");
  const downloaded = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  expect((await downloaded).suggestedFilename()).toBe(
    "Keyboard session.studiowav",
  );
  await page.getByRole("button", { name: "Ayuda", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
