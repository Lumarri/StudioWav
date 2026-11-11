import { _electron as electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const catalog = require("../electron/instruments.json");
const packaged = process.argv[2];
const profile = await mkdtemp(path.join(os.tmpdir(), "studiowav-plugins-ui-"));
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
try {
  app = await launch();
  let page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForLoadState("domcontentloaded");
  await expect(
    page.getByRole("heading", { name: "Arreglo", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.studioNative.request("init"));
  const names = [
    "StudioWav Triple",
    "StudioWav FM",
    "StudioWav Pluck",
    "StudioWav Piano",
    "StudioWav Kick",
  ];
  const chosen = Object.fromEntries(
    names.map((name) => [
      name,
      name === "StudioWav FM" ? 2 : name === "StudioWav Pluck" ? 6 : 4,
    ]),
  );
  for (const name of names) {
    await page.keyboard.press("F8");
    const library = page.getByRole("region", { name: "Biblioteca VST3" });
    await expect(library).toBeVisible();
    if (name === names[0])
      await page.screenshot({
        path: `test-results/studiowav-0.8-library-${packaged ? "packaged" : "development"}.png`,
      });
    await page
      .getByLabel(`Preset de ${name}`, { exact: true })
      .selectOption(String(chosen[name]));
    await page
      .getByRole("button", { name: `Añadir ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Añadir instrumento", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("tab", { name: "Secuenciador F6", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Escuchar ${name}`, exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.studioNative.request("status")))
            .levels.master ?? 0,
        { timeout: 8000, intervals: [25] },
      )
      .toBeGreaterThan(0.01);
    console.log(`${name}: added and auditioned through the rack.`);
  }
  await expect(page.locator(".rack-row")).toHaveCount(13);
  await page
    .getByRole("button", { name: "Estudio de audio", exact: true })
    .click();
  await page.getByRole("tab", { name: "Efectos VST3", exact: true }).click();
  await expect(page.locator(".plugin-slot")).toHaveCount(1);
  await page
    .getByLabel("Plugin para ajustar parámetros", { exact: true })
    .selectOption({ label: "StudioWav Kick" });
  const preset = page.getByLabel("Preset del instrumento", { exact: true });
  await expect(preset.locator("option")).toHaveCount(8);
  await preset.selectOption({ label: "Warm tape" });
  chosen["StudioWav Kick"] = 7;
  const level = page.getByLabel("Parámetro Level", { exact: true });
  await expect(level).toHaveValue("0.73");
  await level.press("Home");
  for (let i = 0; i < 3; i++) await level.press("PageUp");
  await expect(level).toHaveValue("0.3");
  await page.getByRole("button", { name: "Abrir", exact: true }).click();
  await expect(page.locator(".audio-panel-body")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: `test-results/studiowav-0.8-plugins-${packaged ? "packaged" : "development"}.png`,
  });
  await page
    .getByRole("button", { name: "Cerrar estudio de audio", exact: true })
    .click();
  const file = path.join(profile, "vst3-project.studiowav");
  await app.evaluate(
    ({ session }, file) =>
      session.defaultSession.on("will-download", (_event, item) =>
        item.setSavePath(file),
      ),
    file,
  );
  await page
    .getByRole("button", { name: "Guardar proyecto", exact: true })
    .click();
  let saved;
  await expect
    .poll(async () => {
      try {
        saved = JSON.parse(await readFile(file, "utf8"));
        return saved.tracks.filter((t) => t.plugins?.some((p) => p.state))
          .length;
      } catch {
        return 0;
      }
    })
    .toBe(5);
  const pluginTrack = saved.tracks.find((t) => t.name === "StudioWav Kick");
  const slot = pluginTrack.plugins[0];
  expect(slot.description).toContain('file="studiowav-bundled:kick"');
  await app.close();
  app = null;
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForLoadState("domcontentloaded");
  await expect
    .poll(
      async () => {
        try {
          return (
            await page.evaluate(
              (args) => window.studioNative.request("parameters", args),
              { trackId: pluginTrack.id, pluginId: slot.id },
            )
          )[0].value;
        } catch {
          return -1;
        }
      },
      { timeout: 15000 },
    )
    .toBeCloseTo(0.3, 3);
  const restoredPresets = {};
  for (const name of names) {
    const t = saved.tracks.find((t) => t.name === name);
    const bank = Object.values(catalog).find((p) => p.name === name);
    const parameters = await page.evaluate(
      (args) => window.studioNative.request("parameters", args),
      { trackId: t.id, pluginId: t.plugins[0].id },
    );
    const text = parameters.find((p) => p.name === "Program").text;
    expect(text).toBe(bank.presets[chosen[name]].name);
    if (bank.kind >= 2) {
      const opened = await page.evaluate(
        (args) => window.studioNative.request("editor", args),
        { trackId: t.id, pluginId: t.plugins[0].id },
      );
      expect(opened.opened).toBe(true);
    }
    restoredPresets[name] = text;
  }
  await page
    .getByRole("button", { name: "Escuchar StudioWav Kick", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studioNative.request("status")))
          .levels.master ?? 0,
      { timeout: 8000, intervals: [25] },
    )
    .toBeGreaterThan(0.01);
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
    instruments: names,
    tracks: 13,
    presetsChosenBeforeAdding: true,
    presetChangedThroughPanel: true,
    restoredPresets,
    rackAudition: true,
    nativeEditorOpened: true,
    newSynthEditorsOpened: true,
    stateRestoredAfterRestart: true,
    restoredLevel: 0.3,
    stableBundledReferences: true,
    pageErrors: errors.length,
  };
  await writeFile(
    `test-results/plugin-desktop-${packaged ? "packaged" : "development"}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app?.close();
  if (
    !path
      .resolve(profile)
      .startsWith(path.join(os.tmpdir(), "studiowav-plugins-ui-"))
  )
    throw new Error("Unexpected profile");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
