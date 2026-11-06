import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  { stdio: "inherit", windowsHide: true },
);
let desktop;
function cleanup() {
  desktop?.kill();
  vite.kill();
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
vite.on("exit", (code) => {
  if (!desktop && code) process.exitCode = code;
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (vite.exitCode !== null)
      throw new Error("El servidor de desarrollo no pudo arrancar.");
    try {
      ready = (await fetch("http://127.0.0.1:5173")).ok;
    } catch {
      /* Vite is starting. */
    }
    if (ready) break;
    await sleep(200);
  }
  if (!ready) throw new Error("Vite no respondió en el tiempo esperado.");
  const env = { ...process.env, STUDIOWAV_DEV_URL: "http://127.0.0.1:5173" };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = spawn(require("electron"), ["."], {
    stdio: "inherit",
    env,
    windowsHide: true,
  });
  desktop.on("exit", () => {
    vite.kill();
  });
  desktop.on("error", (error) => {
    console.error(error);
    cleanup();
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error);
  cleanup();
  process.exitCode = 1;
}
