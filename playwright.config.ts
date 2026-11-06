import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const localEdge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browserPath = process.env.STUDIOWAV_BROWSER_PATH ??
  (process.platform === "win32" && existsSync(localEdge) ? localEdge : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/e2e",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1540, height: 1000 },
    launchOptions: {
      executablePath: browserPath,
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
