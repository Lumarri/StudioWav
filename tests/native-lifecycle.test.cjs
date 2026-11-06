const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { NativeAudio } = require("../electron/native.cjs");

function fixture() {
  let spawns = 0;
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  const broadcasts = [];
  const audio = new NativeAudio(
    { isPackaged: false, getPath: () => process.cwd() },
    (s) => broadcasts.push(s),
    () => {
      spawns++;
      return child;
    },
  );
  return { audio, child, broadcasts, spawns: () => spawns };
}

test("shutdown rejects pending and late commands without writing to or restarting an ended pipe", async () => {
  const { audio, child, spawns } = fixture();
  const pending = assert.rejects(audio.call("project", {}), /cerrando/);
  audio.close();
  await pending;
  assert.equal(audio.pending.size, 0);
  assert.equal(child.stdin.writableEnded, true);
  await assert.rejects(audio.request("status"), /cerrando/);
  await assert.rejects(audio.request("init"), /cerrando/);
  audio.close();
  assert.equal(spawns(), 1);
});

test("an asynchronous pipe error rejects outstanding work and permits a fresh child before shutdown", async () => {
  const { audio, child, broadcasts, spawns } = fixture();
  const pending = assert.rejects(audio.call("states"), /broken pipe/);
  child.stdin.emit("error", new Error("broken pipe"));
  await pending;
  assert.equal(audio.child, null);
  assert.equal(broadcasts[0].ready, false);
  const recovered = audio.call("status");
  child.stdout.write(JSON.stringify({ id: 2, result: { ready: true } }) + "\n");
  assert.deepEqual(await recovered, { ready: true });
  assert.equal(spawns(), 2);
  audio.close();
});
