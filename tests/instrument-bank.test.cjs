const { test } = require("node:test");
const assert = require("node:assert/strict");
const bank = require("../electron/instruments.json");

test("factory banks contain forty original programs and retain the legacy Piano/Kick program mapping", () => {
  assert.deepEqual(Object.keys(bank), [
    "piano",
    "kick",
    "triple",
    "fm",
    "pluck",
  ]);
  assert.equal(new Set(Object.values(bank).map((p) => p.code)).size, 5);
  assert.deepEqual([bank.piano.code, bank.kick.code], ["SwPn", "SwKk"]);
  assert.deepEqual(
    bank.piano.presets.slice(0, 4).map((p) => p.name),
    ["Studio grand", "Soft felt", "Bright stage", "Long strings"],
  );
  assert.deepEqual(
    bank.kick.presets.slice(0, 4).map((p) => p.name),
    ["Round kick", "Deep 808", "Short punch", "Hard drive"],
  );
  assert.deepEqual(bank.piano.presets[0].values, {
    level: 0.75,
    tone: 0.48,
    decay: 4.2,
    release: 180,
    hammer: 0.22,
    width: 0.65,
  });
  assert.deepEqual(bank.kick.presets[0].values, {
    level: 0.75,
    tune: 48,
    sweep: 125,
    pitchDecay: 38,
    decay: 440,
    click: 0.18,
    drive: 0.12,
  });
  const names = new Set();
  for (const instrument of Object.values(bank)) {
    assert.equal(instrument.presets.length, 8);
    const parameters = Object.keys(instrument.presets[0].values).sort();
    for (const preset of instrument.presets) {
      assert.ok(!names.has(preset.name));
      names.add(preset.name);
      assert.deepEqual(Object.keys(preset.values).sort(), parameters);
      assert.ok(Object.values(preset.values).every(Number.isFinite));
      assert.ok(preset.values.level > 0 && preset.values.level <= 1);
    }
  }
  assert.equal(names.size, 40);
});
