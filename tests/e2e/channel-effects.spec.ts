import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { signalProject } from "../fixtures/effects.ts";

async function slider(page: Page, name: string, value: number) {
  const input = page.getByRole("slider", { name, exact: true });
  await input.evaluate((node: HTMLInputElement, v) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, String(v));
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await expect(input).toHaveValue(String(value));
}
async function effects(page: Page) {
  await page
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await page.getByRole("tab", { name: "EQ y compresor", exact: true }).click();
}
async function save(page: Page) {
  const saved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Guardar proyecto", exact: true })
    .click();
  return readFile((await (await saved).path())!);
}
async function wav(page: Page) {
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar WAV", exact: true }).click();
  return readFile((await (await exported).path())!);
}
function rms(data: Buffer) {
  let sum = 0;
  for (let i = 44100; i < 48510; ++i)
    sum += (data.readInt16LE(44 + i * 4) / 32768) ** 2;
  return Math.sqrt(sum / 4410);
}
async function load(page: Page, buffer: Buffer) {
  await page
    .locator('input[accept=".studiowav,.json"]')
    .setInputFiles({
      name: "Effects.studiowav",
      mimeType: "application/json",
      buffer,
    });
  await expect(page.getByRole("status")).toContainText("Proyecto abierto");
}

test("EQ and compressor presets, edits and bypass persist through saving and undo", async ({
  page,
}) => {
  await page.goto("/");
  await effects(page);
  await expect(
    page.getByRole("button", { name: "Activar ecualizador", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page
    .getByLabel("Preset de efectos", { exact: true })
    .selectOption("drums");
  await slider(page, "Medios", -6);
  await page
    .getByRole("button", { name: "Activar compresor", exact: true })
    .click();
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  const bytes = await save(page),
    saved = JSON.parse(bytes.toString());
  expect(saved.tracks[0].effects.eq).toEqual({
    enabled: true,
    low: 2,
    mid: -6,
    high: 2,
    midHz: 500,
  });
  expect(saved.tracks[0].effects.compressor.enabled).toBe(false);
  expect(saved.tracks[0].effects.compressor.threshold).toBe(-18);
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await effects(page);
  await expect(
    page.getByRole("button", { name: "Activar compresor", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  await load(page, bytes);
  await page.keyboard.press("F9");
  await page
    .getByRole("button", { name: "Editar EQ y compresor", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Medios", exact: true }),
  ).toHaveValue("-6");
  await expect(
    page.getByRole("button", { name: "Activar compresor", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: "test-results/studiowav-channel-effects.png" });
});

test("EQ changes exported audio and bypass restores the original signal", async ({
  page,
}) => {
  await page.goto("/");
  await load(page, Buffer.from(JSON.stringify(signalProject(1500))));
  const dry = await wav(page);
  await effects(page);
  await page
    .getByRole("button", { name: "Activar ecualizador", exact: true })
    .click();
  await slider(page, "Medios", -12);
  await slider(page, "Frecuencia de medios", 1500);
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  const wet = await wav(page);
  expect(rms(wet) / rms(dry)).toBeGreaterThan(0.23);
  expect(rms(wet) / rms(dry)).toBeLessThan(0.28);
  await effects(page);
  await page
    .getByRole("button", { name: "Activar ecualizador", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Medios", exact: true }),
  ).toHaveValue("-12");
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  const bypass = await wav(page);
  expect(Math.abs(rms(bypass) / rms(dry) - 1)).toBeLessThan(0.001);
});

test("worklet compressor reduces exported peaks and bypass recovers the dry level", async ({
  page,
}) => {
  await page.goto("/");
  await load(page, Buffer.from(JSON.stringify(signalProject(500, 0.3))));
  const dry = await wav(page);
  await effects(page);
  await page
    .getByRole("button", { name: "Activar compresor", exact: true })
    .click();
  await slider(page, "Umbral", -30);
  await slider(page, "Ataque", 1);
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  const wet = await wav(page);
  expect(rms(wet) / rms(dry)).toBeLessThan(0.6);
  expect(rms(wet) / rms(dry)).toBeGreaterThan(0.05);
  await effects(page);
  await page
    .getByRole("button", { name: "Activar compresor", exact: true })
    .click();
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  expect(Math.abs(rms(await wav(page)) / rms(dry) - 1)).toBeLessThan(0.001);
});
