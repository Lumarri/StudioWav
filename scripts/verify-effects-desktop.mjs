import { _electron as electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { signalProject } from "../tests/fixtures/effects.ts";
const require = createRequire(import.meta.url),
  packaged = process.argv[2];
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-effects-ui-"));
const env = { ...process.env, STUDIOWAV_PROFILE_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STUDIOWAV_DEV_URL;
let app;
const errors = [];
const launch = () =>
  electron.launch({
    executablePath: packaged || require("electron"),
    args: packaged ? [] : ["."],
    env,
    timeout: 40000,
  });
async function open(page) {
  await page
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await page.getByRole("tab", { name: "EQ y compresor", exact: true }).click();
}
try {
  console.log("Launching isolated effects verification.");
  app = await launch();
  let page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Arreglo", exact: true }),
  ).toBeVisible();
  await page.locator('input[accept=".studiowav,.json"]').setInputFiles({
    name: "Effects.studiowav",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(signalProject(0, 0.5))),
  });
  await expect(page.getByRole("status")).toContainText("Proyecto abierto");
  await open(page);
  await page
    .getByRole("button", { name: "Activar compresor", exact: true })
    .click();
  const threshold = page.getByRole("slider", { name: "Umbral", exact: true });
  await threshold.evaluate((node) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(node, "-24");
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(threshold).toHaveValue("-24");
  console.log("Native compressor enabled through the UI.");
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  await open(page);
  const meter = page.getByRole("meter", {
    name: "Reducción del compresor",
    exact: true,
  });
  await expect
    .poll(async () => Number(await meter.getAttribute("aria-valuenow")), {
      timeout: 10000,
    })
    .toBeGreaterThan(10);
  const reduction = Number(await meter.getAttribute("aria-valuenow"));
  console.log("Native gain reduction verified.");
  await page.screenshot({
    path: `test-results/studiowav-effects-${packaged ? "packaged" : "development"}.png`,
  });
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  await page.getByRole("button", { name: "Detener", exact: true }).click();
  const wav = path.join(profile, "effects.wav");
  await app.evaluate(
    ({ session }, file) =>
      session.defaultSession.on("will-download", (_e, item) =>
        item.setSavePath(file),
      ),
    wav,
  );
  await page.getByRole("button", { name: "Exportar WAV", exact: true }).click();
  let output;
  await expect
    .poll(
      async () => {
        try {
          output = await readFile(wav);
          return output.length;
        } catch {
          return 0;
        }
      },
      { timeout: 20000 },
    )
    .toBeGreaterThan(100000);
  let offset = 12;
  while (output.toString("ascii", offset, offset + 4) !== "data")
    offset +=
      8 +
      output.readUInt32LE(offset + 4) +
      (output.readUInt32LE(offset + 4) % 2);
  let sum = 0;
  for (let i = 44100; i < 48510; ++i)
    sum += (output.readInt16LE(offset + 8 + i * 4) / 32768) ** 2;
  const amplitude = Math.sqrt(sum / 4410);
  expect(amplitude).toBeGreaterThan(0.049);
  expect(amplitude).toBeLessThan(0.051);
  console.log("Exported PCM amplitude verified; reopening isolated profile.");
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Arreglo", exact: true }),
  ).toBeVisible();
  await open(page);
  await expect(
    page.getByRole("slider", { name: "Umbral", exact: true }),
  ).toHaveValue("-24");
  await expect(
    page.getByRole("button", { name: "Activar compresor", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
  const result = {
    passed: true,
    application: packaged || "Electron development shell",
    version: await app.evaluate(({ app }) => app.getVersion()),
    appAsarSha256: packaged
      ? createHash("sha256")
          .update(
            await readFile(await app.evaluate(({ app }) => app.getAppPath())),
          )
          .digest("hex")
      : undefined,
    nativeReductionDb: reduction,
    exportedAmplitude: amplitude,
    restoredAfterRestart: true,
    pageErrors: 0,
  };
  await writeFile(
    `test-results/effects-desktop-${packaged ? "packaged" : "development"}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app?.close();
  if (
    !path
      .resolve(profile)
      .startsWith(path.join(os.tmpdir(), "studiowav-effects-ui-"))
  )
    throw new Error("Unexpected profile");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
