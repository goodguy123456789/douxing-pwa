import assert from "node:assert/strict";
import test from "node:test";
import { ROOM_CLEANUP_INTERVAL_MS, startPeriodicCleanup } from "../src/lib/periodic-cleanup";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("cleanup starts immediately, does not overlap, retries safely and stops", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let runs = 0;
  let errors = 0;
  let finish!: () => void;
  const stop = startPeriodicCleanup(async () => {
    runs += 1;
    if (runs === 1) await new Promise<void>(resolve => { finish = resolve; });
    if (runs === 2) throw new Error("private SQL parameters must not escape");
  }, () => { errors += 1; });
  t.after(stop);
  assert.equal(runs, 1);
  t.mock.timers.tick(ROOM_CLEANUP_INTERVAL_MS * 3);
  assert.equal(runs, 1);
  finish();
  await flush();
  t.mock.timers.tick(ROOM_CLEANUP_INTERVAL_MS);
  await flush();
  assert.equal(runs, 2);
  assert.equal(errors, 1);
  t.mock.timers.tick(ROOM_CLEANUP_INTERVAL_MS);
  await flush();
  assert.equal(runs, 3);
  stop();
  t.mock.timers.tick(ROOM_CLEANUP_INTERVAL_MS * 2);
  assert.equal(runs, 3);
});
