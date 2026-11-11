import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  cpSync,
} from "node:fs";
import path from "node:path";
const root = path.resolve("native");
const tools = path.join(root, "toolchain");
const msvcBase = path.join(tools, "msvc/VC/Tools/MSVC");
if (!existsSync(msvcBase))
  throw new Error(
    "Ejecuta python scripts/setup-native-tools.py antes de compilar.",
  );
const vc = path.join(msvcBase, readdirSync(msvcBase).sort().at(-1));
const sdk = path.join(tools, "sdk/c");
const sdkVersion = readdirSync(path.join(sdk, "Include")).sort().at(-1);
const bin = path.join(vc, "bin/Hostx64/x64");
const sdkBin = path.join(sdk, "bin", sdkVersion, "x64");
const env = {
  ...process.env,
  PATH: [bin, sdkBin, path.join(tools, "ninja"), process.env.PATH].join(
    path.delimiter,
  ),
  INCLUDE: [
    path.join(vc, "include"),
    ...["ucrt", "shared", "um", "winrt", "cppwinrt"].map((n) =>
      path.join(sdk, "Include", sdkVersion, n),
    ),
  ].join(";"),
  LIB: [
    path.join(vc, "lib/x64"),
    path.join(sdk, "ucrt/x64"),
    path.join(sdk, "um/x64"),
  ].join(";"),
};
function run(args) {
  const result = spawnSync("cmake", args, {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}
run([
  "-S",
  root,
  "-B",
  path.join(root, "build"),
  "-G",
  "Ninja",
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_TRY_COMPILE_CONFIGURATION=Release",
  "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
  "-DCMAKE_C_COMPILER=cl",
  "-DCMAKE_CXX_COMPILER=cl",
  `-DCMAKE_RC_COMPILER=${path.join(sdkBin, "rc.exe").replaceAll("\\", "/")}`,
  `-DCMAKE_MT=${path.join(sdkBin, "mt.exe").replaceAll("\\", "/")}`,
]);
run([
  "--build",
  path.join(root, "build"),
  "--parallel",
  "2",
  ...process.argv.slice(2),
]);
mkdirSync(path.join(root, "bin"), { recursive: true });
const licenseRoot = path.join(root, "bin/licenses");
function collectLicenses(directory, relative = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(relative, entry.name),
      source = path.join(directory, entry.name);
    if (entry.isDirectory()) collectLicenses(source, name);
    else if (
      entry.isFile() &&
      (/^(?:licen[sc]e|copying)(?:[._-].*)?$/i.test(entry.name) ||
        /licen[sc]e.*\.txt$/i.test(entry.name))
    ) {
      const destination = path.join(licenseRoot, "JUCE", name);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
  }
}
collectLicenses(path.join(root, "vendor/JUCE-8.0.12"));
for (const relative of [
  "modules/juce_core/zip/zlib/README",
  "modules/juce_graphics/image_formats/jpglib/README",
]) {
  const destination = path.join(licenseRoot, "JUCE", relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(path.join(root, "vendor/JUCE-8.0.12", relative), destination);
}
copyFileSync(
  path.resolve("THIRD_PARTY_NOTICES.md"),
  path.join(licenseRoot, "THIRD_PARTY_NOTICES.md"),
);
copyFileSync(
  path.resolve("LICENSE"),
  path.join(licenseRoot, "StudioWav-AGPL-3.0.txt"),
);
copyFileSync(
  path.resolve("licenses/GPL-3.0-only.txt"),
  path.join(licenseRoot, "GPL-3.0-only.txt"),
);
if (!existsSync(path.join(root, "bin/StudioWavAudio.exe")))
  throw new Error("No se generó el backend de audio.");
const catalog = JSON.parse(
  readFileSync(path.resolve("electron/instruments.json"), "utf8"),
);
for (const { target: name } of Object.values(catalog)) {
  const bundle = `StudioWav ${name}.vst3`;
  const source = path.join(
    root,
    `build/StudioWav${name}_artefacts/Release/VST3`,
    bundle,
  );
  // An explicit --target for the host alone may skip the instruments.
  if (existsSync(source)) {
    const destination = path.join(root, "bin/plugins", bundle);
    cpSync(source, destination, { recursive: true });
  } else if (!process.argv.includes("--target")) {
    throw new Error(`No se generó ${bundle}.`);
  }
}
console.log("Backend e instrumentos compilados: native/bin");
