import { _electron as electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const env = { ...process.env };
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-test-"));
env.STUDIOWAV_PROFILE_DIR = profile;
delete env.ELECTRON_RUN_AS_NODE;
delete env.STUDIOWAV_DEV_URL;
const packaged = process.argv[2];
const errors = [];
let app;
try {
  app = await electron.launch({
    executablePath: packaged || require("electron"),
    args: packaged ? [] : ["."],
    env,
    timeout: 40000,
  });
  const window = await app.firstWindow();
  window.on("pageerror", (error) => errors.push(error.message));
  await window.waitForLoadState("domcontentloaded");
  await expect(
    window.getByRole("heading", { name: "Arreglo", exact: true }),
  ).toBeVisible();
  await expect(window.locator(".playlist-row")).toHaveCount(8);
  await window.getByRole("button", { name: "Reproducir", exact: true }).click();
  await expect
    .poll(
      async () =>
        Number.parseFloat(
          await window
            .locator(".mini-master > span")
            .evaluate((node) => node.style.width),
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(2);
  await window.getByRole("button", { name: "Detener", exact: true }).click();
  const native = await window.evaluate(() =>
    window.studioNative.request("status"),
  );
  console.log("Native playback verified.");
  expect(native.backend).toBe("native");
  expect(native.sampleRate).toBeGreaterThan(0);
  await window.keyboard.press("F7");
  const originalNotes = await window.locator(".piano-note").count();
  await window.keyboard.press("Alt+a");
  await expect(
    window.getByRole("dialog", { name: "Arpegiador", exact: true }),
  ).toBeVisible();
  const arpeggiatedNotes = await window
    .locator(".note-tool-preview rect")
    .count();
  expect(arpeggiatedNotes).toBeGreaterThan(originalNotes);
  await window
    .getByRole("button", { name: "Escuchar resultado", exact: true })
    .click();
  await expect
    .poll(async () => {
      const status = await window.evaluate(() =>
        window.studioNative.request("status"),
      );
      return status.levels.master ?? 0;
    })
    .toBeGreaterThan(0.01);
  await window.screenshot({
    path: "test-results/studiowav-0.4-native-arpeggiator.png",
  });
  await window.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(window.locator(".piano-note")).toHaveCount(originalNotes);
  await window.keyboard.press("Alt+a");
  await window
    .getByRole("button", { name: "Aceptar herramienta", exact: true })
    .click();
  await expect(window.locator(".piano-note")).toHaveCount(arpeggiatedNotes);
  await window.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(window.locator(".piano-note")).toHaveCount(originalNotes);
  await window.keyboard.press("F5");
  console.log(
    "Piano tool preview, native audition, cancel, apply and undo verified.",
  );
  await window
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await expect(window.getByText("NATIVO", { exact: true })).toBeVisible();
  await window
    .getByLabel("Fuente de grabación", { exact: true })
    .selectOption("master");
  await window.getByRole("button", { name: "Grabar", exact: true }).click();
  await expect(
    window.getByRole("button", { name: "Finalizar toma", exact: true }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  await window.getByRole("button", { name: "Reproducir", exact: true }).click();
  await window.waitForTimeout(500);
  await window
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await window
    .getByRole("button", { name: "Finalizar toma", exact: true })
    .click();
  await expect(window.locator(".playlist-row")).toHaveCount(9);
  await expect(window.getByRole("status")).toContainText("Toma grabada");
  console.log("Master recording imported.");
  const recordedTrackId = Object.keys(
    (await window.evaluate(() => window.studioNative.request("status")))
      .trackLatencies,
  ).at(-1);
  await window.getByRole("tab", { name: "Muestras", exact: true }).click();
  await window.getByLabel("Final del recorte", { exact: true }).fill("0.1");
  await window
    .getByRole("button", { name: "Aplicar edición a la muestra", exact: true })
    .click();
  await expect(window.getByRole("status")).toContainText("Muestra editada");
  await window.waitForTimeout(350);
  await window.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  await window.getByRole("button", { name: "Deshacer", exact: true }).click();
  await window
    .getByRole("button", { name: "Escuchar sonido", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const s = await window.evaluate(() =>
          window.studioNative.request("status"),
        );
        return s.levels[recordedTrackId] ?? 0;
      },
      { timeout: 10000, intervals: [50, 100] },
    )
    .toBeGreaterThan(0.01);
  await window
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await window.screenshot({ path: "test-results/studiowav-native-audio.png" });
  const fixture = path.resolve(
    "native/build/StudioWavTestGain_artefacts/Release/VST3",
  );
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, fixture);
  await window.getByRole("tab", { name: "Efectos VST3", exact: true }).click();
  await window
    .getByRole("button", { name: "Elegir carpeta", exact: true })
    .click();
  await expect(window.locator(".plugin-results button")).toHaveCount(1, {
    timeout: 20000,
  });
  await window.locator(".plugin-results button").click();
  await expect(window.locator(".plugin-slot")).toHaveCount(1);
  await window
    .getByLabel("Plugin para ajustar parámetros", { exact: true })
    .selectOption({ label: "StudioWav Test Gain" });
  await expect(
    window.getByLabel("Parámetro Gain", { exact: true }),
  ).toBeVisible();
  const pluginId = await window
    .getByLabel("Plugin para ajustar parámetros", { exact: true })
    .inputValue();
  const gainControl = window.getByLabel("Parámetro Gain", { exact: true });
  await gainControl.press("Home");
  // This fixture quantizes gain to 0.01; choose a representable value.
  for (let i = 0; i < 10; i++) await gainControl.press("ArrowRight");
  await expect
    .poll(async () => {
      const values = await window.evaluate(
        (args) => window.studioNative.request("parameters", args),
        { trackId: recordedTrackId, pluginId },
      );
      return values[0].value;
    })
    .toBeCloseTo(0.01, 4);
  await window.getByRole("button", { name: "Abrir", exact: true }).click();
  await window.screenshot({ path: "test-results/studiowav-native-vst3.png" });
  console.log("VST3 loaded, parameter and editor verified.");
  await window.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  const savedFile = path.resolve(
    "test-results/native-desktop-project.studiowav",
  );
  await window.keyboard.press("F9");
  await expect(window.locator(".mixer-effect-slot.loaded")).toHaveCount(1);
  const effectToggle = window.getByRole("button", {
    name: "Activar efecto 1",
    exact: true,
  });
  await effectToggle.click();
  await expect(effectToggle).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async () => {
      const status = await window.evaluate(() =>
        window.studioNative.request("status"),
      );
      return status.trackLatencies[recordedTrackId];
    })
    .toBe(0);
  await effectToggle.click();
  await expect
    .poll(async () => {
      const status = await window.evaluate(() =>
        window.studioNative.request("status"),
      );
      return status.trackLatencies[recordedTrackId];
    })
    .toBe(64);
  await window.screenshot({
    path: packaged
      ? "test-results/studiowav-0.3-native-mixer-packaged.png"
      : "test-results/studiowav-0.3-native-mixer.png",
  });
  await app.evaluate(({ session }, file) => {
    session.defaultSession.on("will-download", (_event, item) =>
      item.setSavePath(file),
    );
  }, savedFile);
  await window
    .getByRole("button", { name: "Guardar proyecto", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await readFile(savedFile, "utf8")).tracks.some(
            (t) => t.plugins?.some((p) => p.state?.length > 0),
          );
        } catch {
          return false;
        }
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await mkdir("test-results", { recursive: true });
  await window.screenshot({
    path: packaged
      ? "test-results/studiowav-windows-packaged.png"
      : "test-results/studiowav-windows.png",
  });
  expect(errors).toEqual([]);
  console.log("Closing and reopening the isolated profile.");
  await app.close();
  app = undefined;
  app = await electron.launch({
    executablePath: packaged || require("electron"),
    args: packaged ? [] : ["."],
    env,
    timeout: 40000,
  });
  const reopened = await app.firstWindow();
  await expect(reopened.locator(".playlist-row")).toHaveCount(9);
  await expect
    .poll(
      async () =>
        Object.keys(
          await reopened.evaluate(() => window.studioNative.request("states")),
        ).length,
      { timeout: 15000 },
    )
    .toBe(1);
  await expect
    .poll(
      async () => {
        try {
          const values = await reopened.evaluate(
            (args) => window.studioNative.request("parameters", args),
            { trackId: recordedTrackId, pluginId },
          );
          return values[0].value;
        } catch {
          return -1;
        }
      },
      { timeout: 15000 },
    )
    .toBeCloseTo(0.01, 4);
  const result = {
    application: packaged || "Electron development shell",
    version: await app.evaluate(({ app }) => app.getVersion()),
    appAsarSha256: packaged
      ? createHash("sha256")
          .update(
            await readFile(await app.evaluate(({ app }) => app.getAppPath())),
          )
          .digest("hex")
      : undefined,
    title: await reopened.title(),
    tracks: 9,
    playback: "audible signal verified",
    backend: "native",
    recording: "master take imported",
    plugins: "VST3 fixture loaded and state saved",
    mixerSlots: "UI bypass removes and restores 64-sample plugin compensation",
    noteTools:
      "Arpeggiator preview, native audition, cancel, apply and undo verified",
    reopened: "project audio and VST3 state restored",
    restoredGain: 0.01,
    pageErrors: errors.length,
  };
  await writeFile(
    `test-results/desktop-${packaged ? "packaged" : "development"}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (app) await app.close();
  const resolved = path.resolve(profile),
    expected = path.resolve(os.tmpdir()) + path.sep + "studiowav-test-";
  if (!resolved.startsWith(expected))
    throw new Error("Unexpected test profile location.");
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
