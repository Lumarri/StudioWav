"""Prepare an isolated Windows C++ toolchain from official Microsoft packages.

No elevation, registry changes or global PATH changes. VS payload checksums
come from Microsoft's release catalog. Downloaded sources remain in native/.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1] / 'native'
cache = root / 'toolchain'
cache.mkdir(parents=True, exist_ok=True)
catalog_file = cache / 'catalog.json'
if not catalog_file.exists():
    channel = json.load(urllib.request.urlopen('https://aka.ms/vs/17/release/channel'))
    manifest = next(x for x in channel['channelItems'] if x['id'] == 'Microsoft.VisualStudio.Manifests.VisualStudio')
    urllib.request.urlretrieve(manifest['payloads'][0]['url'], catalog_file)
catalog = json.loads(catalog_file.read_text(encoding='utf-8-sig'))
ids = [f'Microsoft.VC.14.44.17.14.{part}.base' for part in
       ['Tools.HostX64.TargetX64', 'Tools.HostX64.TargetX64.Res', 'CRT.Headers', 'CRT.x64.Desktop', 'CRT.x64.Store']]
downloads = []
for identifier in ids:
    package = next(x for x in catalog['packages'] if x['id'] == identifier and x.get('language', 'en-US') == 'en-US')
    payload = package['payloads'][0]
    downloads.append((payload['url'], cache / payload['fileName'], payload['sha256'], 'msvc'))
sdk_version = '10.0.26100.9457'
for package in ['microsoft.windows.sdk.cpp', 'microsoft.windows.sdk.cpp.x64']:
    name = f'{package}.{sdk_version}.nupkg'
    downloads.append((f'https://api.nuget.org/v3-flatcontainer/{package}/{sdk_version}/{name}', cache / name, None, 'sdk'))
downloads += [
    ('https://github.com/ninja-build/ninja/releases/download/v1.13.1/ninja-win.zip', cache / 'ninja-win-1.13.1.zip', None, 'ninja'),
    ('https://codeload.github.com/juce-framework/JUCE/zip/refs/tags/8.0.12', cache / 'JUCE-8.0.12.zip',
     '91ceb4b54f9cc763884f6285fcfee4372fbe72d33061a339255cee2957e34ad8', 'juce'),
]

def prepare(item):
    url, archive, expected, kind = item
    if not archive.exists():
        temp = archive.with_suffix(archive.suffix + '.download')
        urllib.request.urlretrieve(url, temp)
        temp.replace(archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if expected and digest.lower() != expected.lower():
        raise ValueError(f'Checksum mismatch: {archive.name}')
    target = root / 'vendor' if kind == 'juce' else cache / kind
    marker = cache / (archive.name + '.extracted')
    if not marker.exists():
        with zipfile.ZipFile(archive) as z:
            for member in z.infolist():
                name = member.filename.replace('\\', '/')
                if kind == 'msvc':
                    if not name.startswith('Contents/'): continue
                    name = name[len('Contents/'):]
                dest = target / name
                if not dest.resolve().is_relative_to(target.resolve()):
                    raise ValueError('Invalid archive member')
                if member.is_dir(): continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                with z.open(member) as src, dest.open('wb') as out: shutil.copyfileobj(src, out)
        marker.write_text(digest, encoding='utf-8')
    print(f'Prepared {archive.name}', flush=True)
    return {'url': url, 'sha256': digest, 'kind': kind, 'bytes': archive.stat().st_size}

with ThreadPoolExecutor(max_workers=4) as pool:
    records = list(pool.map(prepare, downloads))
(cache / 'sources.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
print('Isolated native toolchain ready.', flush=True)
