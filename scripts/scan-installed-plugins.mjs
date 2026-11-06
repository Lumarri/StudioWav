import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const { NativeAudio } = createRequire(import.meta.url)(
  "../electron/native.cjs",
);
const register = process.argv.includes("--register");
const profile = register
  ? path.join(process.env.APPDATA, "StudioWav")
  : await mkdtemp(path.join(os.tmpdir(), "studiowav-scan-"));
const audio = new NativeAudio(
  { isPackaged: false, getPath: () => profile },
  () => {},
);
try {
  const plugins = await audio.request("scan");
  const summary = plugins.map(({ name, manufacturer, instrument, path }) => ({
    name,
    manufacturer,
    instrument,
    path,
  }));
  const result = {
    passed: true,
    registeredInUserCatalog: register,
    plugins: summary,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/installed-plugins.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  audio.close();
  if (!register) {
    if (
      !path
        .resolve(profile)
        .startsWith(path.join(os.tmpdir(), "studiowav-scan-"))
    )
      throw new Error("Unexpected scan profile");
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
}
