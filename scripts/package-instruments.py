"""Package the original VST3 bundles and their licenses without global installation."""
import hashlib
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
catalog = json.loads((root / "electron/instruments.json").read_text(encoding="utf-8"))
directory = root / "release" / version
directory.mkdir(parents=True, exist_ok=True)
archive_path = directory / f"StudioWav-Instruments-{version}-VST3.zip"
files = []
with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for item in catalog.values():
        bundle = root / "native/bin/plugins" / (item["name"] + ".vst3")
        binary = bundle / "Contents/x86_64-win" / (item["name"] + ".vst3")
        assert binary.is_file(), f"Missing built instrument: {item['name']}"
        for file in sorted(bundle.rglob("*")):
            if file.is_file():
                archive.write(file, "StudioWav-Instruments/" + str(file.relative_to(bundle.parent)).replace("\\", "/"))
        files.append({"name": item["name"], "presets": len(item["presets"]), "sha256": hashlib.sha256(binary.read_bytes()).hexdigest()})
    for file in sorted((root / "native/bin/licenses").rglob("*")):
        if file.is_file():
            archive.write(file, "StudioWav-Instruments/licenses/" + str(file.relative_to(root / "native/bin/licenses")).replace("\\", "/"))
    archive.write(root / "electron/instruments.json", "StudioWav-Instruments/FACTORY_PRESETS.json")
    archive.write(root / "docs/instruments.md", "StudioWav-Instruments/README.md")
    archive.writestr("StudioWav-Instruments/manifest.json", json.dumps({"version": version, "license": "AGPL-3.0-only", "instruments": files}, indent=2))
print(json.dumps({"created": str(archive_path.relative_to(root)), "instruments": files, "bytes": archive_path.stat().st_size}))
