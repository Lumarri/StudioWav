import { _electron as electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { melodyFixture } from "../tests/fixtures/midi.ts";
import { readMidi } from "../src/midi.ts";
const require = createRequire(import.meta.url),
  packaged = process.argv[2];
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-midi-ui-"));
const env = { ...process.env, STUDIOWAV_PROFILE_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STUDIOWAV_DEV_URL;
let app;
const errors = [];
try {
  app = await electron.launch({
    executablePath: packaged || require("electron"),
    args: packaged ? [] : ["."],
    env,
    timeout: 40000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Arreglo", exact: true }),
  ).toBeVisible();
  await page
    .locator('input[accept=".mid,.midi,audio/midi,audio/x-midi"]')
    .setInputFiles({
      name: "Piano.mid",
      mimeType: "audio/midi",
      buffer: Buffer.from(melodyFixture()),
    });
  await page
    .getByRole("checkbox", { name: "Crear un proyecto nuevo", exact: true })
    .check();
  await page.screenshot({
    path: `test-results/studiowav-midi-import-${packaged ? "packaged" : "development"}.png`,
  });
  await page
    .getByRole("button", { name: "Importar partes seleccionadas", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Importar archivo MIDI", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".playlist-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() =>
          window.studioNative.request("status"),
        );
        return s.playing ? (s.levels.master ?? 0) : 0;
      },
      { timeout: 10000, intervals: [25] },
    )
    .toBeGreaterThan(0.01);
  await page.getByRole("button", { name: "Detener", exact: true }).click();
  const target = path.join(profile, "export.mid");
  await app.evaluate(
    ({ session }, file) =>
      session.defaultSession.on("will-download", (_event, item) =>
        item.setSavePath(file),
      ),
    target,
  );
  await page.getByRole("menuitem", { name: "ARCHIVO", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Exportar canción MIDI…", exact: true })
    .click();
  let midi;
  await expect
    .poll(async () => {
      try {
        midi = readMidi(new Uint8Array(await readFile(target)));
        return midi.parts[0].notes.length;
      } catch {
        return 0;
      }
    })
    .toBe(2);
  expect(midi.parts[0].notes.map((n) => n.pitch)).toEqual([60, 64]);
  expect(midi.parts[0].notes[0].start).toBe(0.5);
  await page.keyboard.press("F7");
  await expect(page.locator(".piano-note")).toHaveCount(2);
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.locator(".playlist-row")).toHaveCount(8);
  expect(errors).toEqual([]);
  const result = {
    passed: true,
    version: await app.evaluate(({ app }) => app.getVersion()),
    application: packaged || "Electron development shell",
    appAsarSha256: packaged
      ? createHash("sha256")
          .update(
            await readFile(await app.evaluate(({ app }) => app.getAppPath())),
          )
          .digest("hex")
      : undefined,
    nativePlayback: true,
    importedAndExportedNotes: 2,
    editable: true,
    undoRestoredOriginal: true,
    pageErrors: errors.length,
  };
  await writeFile(
    `test-results/midi-desktop-${packaged ? "packaged" : "development"}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app?.close();
  if (
    !path
      .resolve(profile)
      .startsWith(path.join(os.tmpdir(), "studiowav-midi-ui-"))
  )
    throw new Error("Unexpected test profile");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
