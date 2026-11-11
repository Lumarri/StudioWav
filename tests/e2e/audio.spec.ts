import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encodeWav } from "../../src/audio/wav.ts";

test("sample audition plays beyond initial silence", async ({ page }) => {
  await page.goto("/");
  const samples = new Float32Array(35280);
  for (let i = 17640; i < samples.length; i++)
    samples[i] = Math.sin((2 * Math.PI * i * 440) / 44100) * 0.3;
  await page.locator('input[type=file][accept^="audio"]').setInputFiles({
    name: "Audition.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(encodeWav([samples], 44100)),
  });
  await expect(page.locator(".playlist-row")).toHaveCount(9);
  // Preserve the peak of this short audition, even if tracing delays a poll.
  await page.locator(".mini-master > span").evaluate((node: HTMLElement) => {
    node.dataset.auditionPeak = "0";
    new MutationObserver(() => {
      node.dataset.auditionPeak = String(
        Math.max(
          Number(node.dataset.auditionPeak),
          Number.parseFloat(node.style.width),
        ),
      );
    }).observe(node, { attributes: true, attributeFilter: ["style"] });
  });
  await Promise.all([
    page.getByRole("button", { name: "Escuchar sonido", exact: true }).click(),
    expect
      .poll(
        async () =>
          Number.parseFloat(
            (await page
              .locator(".mini-master > span")
              .getAttribute("data-audition-peak")) ?? "0",
          ),
        { intervals: [50], timeout: 3000 },
      )
      .toBeGreaterThan(2),
  ]);
});

test("buses and sends survive saving", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await page.getByRole("tab", { name: "Rutas y buses" }).click();
  await page.getByRole("button", { name: "Añadir bus", exact: true }).click();
  await page
    .getByLabel("Salida del canal", { exact: true })
    .selectOption({ label: "Bus 1 · Bus" });
  const send = page.getByLabel("Nuevo envío", { exact: true });
  const options = await send.locator("option").all();
  const value = await options[1].getAttribute("value");
  await send.selectOption(value!);
  await expect(page.getByLabel("Nivel del envío 1")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  await expect(page.locator(".playlist-row")).toHaveCount(8);
  const saved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Guardar proyecto", exact: true })
    .click();
  const p = JSON.parse(
    (await readFile((await (await saved).path())!)).toString(),
  );
  const bus = p.tracks.find((t: any) => t.kind === "bus");
  expect(bus.name).toBe("Bus 1");
  expect(p.tracks[0].outputId).toBe(bus.id);
  expect(p.tracks[0].sends).toHaveLength(1);
});

test("automation points edit the curve and restore from a saved project", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await page.getByRole("tab", { name: "Automatización", exact: true }).click();
  await page.getByLabel("Valor de automatización", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Guardar punto", exact: true })
    .click();
  await page.getByLabel("Paso de automatización", { exact: true }).fill("17");
  await page.getByLabel("Valor de automatización", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Guardar punto", exact: true })
    .click();
  await expect(page.locator(".automation-curve circle")).toHaveCount(2);
  await page.screenshot({ path: "test-results/studiowav-automation.png" });
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  const saved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Guardar proyecto", exact: true })
    .click();
  const bytes = await readFile((await (await saved).path())!);
  const p = JSON.parse(bytes.toString());
  expect(p.tracks[0].automation.gain).toEqual([
    { step: 0, value: 0 },
    { step: 16, value: 1 },
  ]);
  await page
    .locator('input[type=file][accept=".studiowav,.json"]')
    .setInputFiles({
      name: "automation.studiowav",
      mimeType: "application/json",
      buffer: bytes,
    });
  await expect(page.getByRole("status")).toContainText("Proyecto abierto");
});

test("sample trimming and normalization produce new audio and can be undone", async ({
  page,
}) => {
  await page.goto("/");
  const data = new Float32Array(44100);
  for (let i = 0; i < data.length; i++)
    data[i] = Math.sin((2 * Math.PI * i * 440) / 44100) * 0.2;
  await page.locator('input[type=file][accept^="audio"]').setInputFiles({
    name: "Editable.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(encodeWav([data], 44100)),
  });
  await expect(page.locator(".playlist-row")).toHaveCount(9);
  await page
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await page.getByRole("tab", { name: "Muestras", exact: true }).click();
  await expect(
    page.getByLabel("Final del recorte", { exact: true }),
  ).toHaveValue("1");
  await page.getByLabel("Inicio del recorte", { exact: true }).fill("0.25");
  await page.getByLabel("Final del recorte", { exact: true }).fill("0.75");
  await page.getByLabel("Invertir audio", { exact: true }).check();
  await page
    .getByLabel("Normalizar pico a −0,18 dBFS", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Aplicar edición a la muestra", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Muestra editada");
  await expect(
    page.getByLabel("Final del recorte", { exact: true }),
  ).toHaveValue("0.5");
  await page.screenshot({ path: "test-results/studiowav-sample-editor.png" });
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  const saved = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Guardar proyecto", exact: true })
    .click();
  const p = JSON.parse(
    (await readFile((await (await saved).path())!)).toString(),
  );
  expect(p.samples).toHaveLength(1);
  expect(p.samples[0].duration).toBe(0.5);
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await page
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await page.getByRole("tab", { name: "Muestras", exact: true }).click();
  await expect(
    page.getByLabel("Final del recorte", { exact: true }),
  ).toHaveValue("1");
});
