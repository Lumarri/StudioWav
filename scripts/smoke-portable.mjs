import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";

const executable = path.resolve(
  process.argv[2] ?? "release/0.5.0/StudioWav-0.5.0-portable.exe",
);
const profile = await mkdtemp(
  path.join(os.tmpdir(), "studiowav-test-portable-"),
);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const env = { ...process.env, STUDIOWAV_PROFILE_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STUDIOWAV_DEV_URL;
const child = spawn(
  executable,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`],
  { cwd: profile, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let errors = "";
child.stderr.on("data", (data) => {
  errors = (errors + data).slice(-12000);
});
child.stdout.resume();
let browser;
try {
  console.log(
    "Starting the standalone portable from an isolated working directory.",
  );
  const endpoint = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      const response = await fetch(endpoint + "/json/version", {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(200);
  }
  if (!ready) throw new Error("Portable did not expose its window: " + errors);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await expect(
    page.getByRole("heading", { name: "Arreglo", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  await expect
    .poll(
      async () => {
        const status = await page.evaluate(() =>
          window.studioNative.request("status"),
        );
        return status.levels.master ?? 0;
      },
      { timeout: 15000, intervals: [100] },
    )
    .toBeGreaterThan(0.03);
  const status = await page.evaluate(() =>
    window.studioNative.request("status"),
  );
  expect(status.backend).toBe("native");
  await page.getByRole("button", { name: "Detener", exact: true }).click();
  const auditioned = [];
  for (const name of ["StudioWav Piano", "StudioWav Kick"]) {
    await page.keyboard.press("F8");
    await page.getByRole("button", { name: `Añadir ${name}`, exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Añadir instrumento", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Secuenciador F6", exact: true }).click();
    await page.getByRole("button", { name: `Escuchar ${name}`, exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.studioNative.request("status"))).levels.master ?? 0,
      { timeout: 10000, intervals: [25] }).toBeGreaterThan(.01);
    auditioned.push(name);
  }
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/studiowav-portable.png" });
  const result = {
    passed: true,
    executable,
    sha256: createHash("sha256")
      .update(await readFile(executable))
      .digest("hex"),
    standaloneWorkingDirectory: true,
    backend: status.backend,
    driver: status.driver,
    sampleRate: status.sampleRate,
    bufferSize: status.bufferSize,
    signalPeak: status.levels.master,
    bundledPluginsAuditioned: auditioned,
  };
  await writeFile(
    "test-results/portable-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await page.evaluate(() => window.close()).catch(() => {});
  await sleep(1000);
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 6000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  const resolved = path.resolve(profile),
    prefix = path.resolve(os.tmpdir()) + path.sep + "studiowav-test-portable-";
  if (!resolved.startsWith(prefix))
    throw new Error("Unexpected portable test profile path.");
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
