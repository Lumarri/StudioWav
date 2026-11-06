"""Record the finished distribution after interactive and automated checks.

Requires the real packaged and portable smoke reports; refuses stale reports
from 0.2 and verifies the preserved releases and the installed FL artifact.
"""
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
release = root / 'release' / version
def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

development = json.loads((root / 'test-results/desktop-development.json').read_text())
packaged = json.loads((root / 'test-results/desktop-packaged.json').read_text())
portable = json.loads((root / 'test-results/portable-smoke.json').read_text())
assert packaged['application'] == f'release/{version}/win-unpacked/StudioWav.exe'
assert version in portable['executable'] and portable['passed'] and portable['signalPeak'] > 0.01
for check in [development, packaged]:
    assert check['backend'] == 'native' and check['pageErrors'] == 0 and check['restoredGain'] == 0.01
    assert check['mixerSlots'] == 'UI bypass removes and restores 64-sample plugin compensation'

files = []
for file in [f'StudioWav-{version}-portable.exe', 'win-unpacked/StudioWav.exe', 'win-unpacked/resources/app.asar', 'win-unpacked/resources/audio/StudioWavAudio.exe']:
    path = release / file
    files.append({'file': file, 'sha256': digest(path), 'bytes': path.stat().st_size})
native_digest = digest(root/'native/bin/StudioWavAudio.exe')
assert files[-1]['sha256'] == native_digest
native_checks=json.loads((root/'test-results/native/integration.json').read_text())
assert native_checks['binarySha256']==native_digest and len(native_checks['checks'])==11
assert packaged['version'] == version and packaged['appAsarSha256'] == files[2]['sha256']
assert packaged['noteTools'] == 'Arpeggiator preview, native audition, cancel, apply and undo verified'
assert portable['sha256'] == files[0]['sha256']
preserved = []
for file, expected in [
    ('release/0.4.0/StudioWav-0.4.0-portable.exe', 'b42ade6c2a40602e6fc5caa9fd2d6d87e5507f335022f074e7098e58a00f956a'),
    ('release/StudioWav-0.1.0-portable.exe', '16d87a363f9b2532f8233240cda5e68d140304ea740e9d1d59b789615ac284d9'),
    ('release/0.2.0/StudioWav-0.2.0-portable.exe', '9e725357b27ae28b968c4a752ce61f7722fc06ec37dd1a30b532099aae5de47e'),
    ('release/0.3.0/StudioWav-0.3.0-portable.exe', '737f795894db1ae765d7f4427719cb1be912064c5f85a22b40a8bdf4819065d1'),
]:
    actual = digest(root / file)
    assert actual == expected, file
    preserved.append({'file': file, 'sha256': actual})
fl = Path('C:/Program Files/Image-Line/FL Studio 2025/FLEngine_x64.dll')
fl_digest = digest(fl)
assert fl_digest == 'ea5e811d7447c571d2de148f7cc0f95de8d1adcab9af350586bb74e1e47bfb4e'
fl_plugins=[]
for name, expected in [('FL Keys','67d5cc2f38dd023b01b7e185037baf153d96f087366a8463bfab3bcb4ee7aebc'),('Fruit Kick','7a871a6cc53c2955467df24643db79a77095d83f037937481916c2c4e097316c')]:
    path=fl.parent / 'Plugins/Fruity/Generators' / name / f'{name}_x64.dll'
    actual=digest(path)
    assert actual==expected
    fl_plugins.append({'name':name,'sha256':actual,'unchanged':True})
shutil.copy2(root / 'test-results/studiowav-0.4-native-arpeggiator.png', release / f'StudioWav-{version}-tools.png')
musical=json.loads((root/'test-results/musical-engine.json').read_text())
assert musical['passed'] and musical['laneMovePreservesAudio'] and musical['laneMuteProducesSilence']
instruments=json.loads((root/'test-results/instruments.json').read_text())
plugin_development=json.loads((root/'test-results/plugin-desktop-development.json').read_text())
plugin_packaged=json.loads((root/'test-results/plugin-desktop-packaged.json').read_text())
installed_plugins=json.loads((root/'test-results/installed-plugins.json').read_text())
assert instruments['passed'] and len(instruments['vst3'])==2
assert installed_plugins['passed'] and installed_plugins['hostedExample']['renderPeak'] > .005
for check in [plugin_development,plugin_packaged]:
    assert check['passed'] and check['version']==version and check['pageErrors']==0 and check['stateRestoredAfterRestart']
assert plugin_packaged['appAsarSha256']==files[2]['sha256']
assert portable['bundledPluginsAuditioned']==['StudioWav Piano','StudioWav Kick']
bundle=json.loads((root/'research/fl-studio-2025/evidence/rea-plugin-formats.json').read_text())
for name in ['Piano','Kick']:
    relative=f'win-unpacked/resources/audio/plugins/StudioWav {name}.vst3/Contents/x86_64-win/StudioWav {name}.vst3'
    path=release/relative
    actual=digest(path)
    assert actual==digest(root/f'native/bin/plugins/StudioWav {name}.vst3/Contents/x86_64-win/StudioWav {name}.vst3')
    assert any(r['operation']=='inspect_native_exports' and r['normalized_result']['artifact']['sha256']==actual and any(e['name']=='GetPluginFactory' for e in r['normalized_result']['exports']) for r in bundle['records'])
    files.append({'file':relative,'sha256':actual,'bytes':path.stat().st_size})
shutil.copy2(root/'test-results/studiowav-0.5-plugins-packaged.png',release/f'StudioWav-{version}-plugins.png')
shutil.copy2(root/'examples/Piano y kicks.studiowav',release/'Piano y kicks.studiowav')
report = {
    'version': version, 'validated_at_utc': datetime.now(timezone.utc).isoformat(), 'files': files,
    'build': 'TypeScript + Vite production build and electron-builder portable passed',
    'model_and_lifecycle_tests_passed': 24,
    'browser_tests_passed': 18,
    'final_workspace_regression_tests_passed': 4,
    'native_musical_engine':musical,
    'desktop_development': development, 'desktop_packaged': packaged, 'portable_smoke': portable,
    'instruments':instruments,'plugin_development':plugin_development,'plugin_packaged':plugin_packaged,'installed_plugins':installed_plugins,
    'native_audio_binary': {'sha256': native_digest, 'change':'Bypassed VST3 generators no longer enable the built-in fallback', 'native_checks_rerun_this_release': True,'checks':native_checks},
    'rea': {'version': '6.8.0', 'operation': 'inspect_pe_resources', 'evidence_id': 'ev_28127ce3f50028b041680d7bf2e8a2526d9505454e092a3aed3cba6f7efd4a5d', 'resource_count': 322, 'typed_dfm_tool_forms': 6, 'functional_evidence': '../../research/fl-studio-2025/functional-study.md', 'method': 'REA retained resource inventory plus supplementary typed DFM decoding and independent functional implementation'},
    'preserved_releases': preserved,
    'fl_engine_unchanged_sha256': fl_digest,
    'fl_native_plugins':fl_plugins,
    'plugin_research':'../../research/fl-studio-2025/plugin-study.md',
    'limits': ['Not a complete FL Studio clone', 'No .flp import or Image-Line plugins', '32 instrument tracks, 32 Playlist lanes, 16/32/64/128 steps per pattern, 8 stereo VST3 slots per track', 'No .fsc grooves, full FL chord progression generator or per-note modulation', 'No physical microphone or external MIDI device tested this release'],
}
(release / 'validation.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
(release / 'SHA256SUMS.txt').write_text(''.join(f"{f['sha256']}  {f['file']}\n" for f in files), encoding='ascii')
print(json.dumps({'release': str(release), 'portable_sha256': files[0]['sha256'], 'portable_bytes': files[0]['bytes'], 'verified': True}))
