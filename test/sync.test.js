import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockErp } from '../src/mockErp.js';
import { createStore, runSync } from '../src/sync.js';
import { memoryCheckpoint } from '../src/checkpoint.js';

const mk = (n, step = 1000) =>
  Array.from({ length: n }, (_, i) => ({ id: `R${String(i).padStart(3, '0')}`, amount: i, lastModified: 1_000_000 + i * step }));
const noSleep = async () => {};

test('full sync pulls every record across pages', async () => {
  const erp = createMockErp({ records: mk(12), pageSize: 5 });
  const store = createStore();
  const r = await runSync({ erp, store, checkpoint: memoryCheckpoint(), sleep: noSleep });
  assert.equal(store.rows.size, 12);
  assert.equal(r.inserted, 12);
  assert.ok(r.completed);
});

test('interrupted sync resumes from checkpoint without re-fetching earlier pages', async () => {
  const erp = createMockErp({ records: mk(12), pageSize: 5 });
  const store = createStore();
  const cp = memoryCheckpoint();
  const r1 = await runSync({ erp, store, checkpoint: cp, maxPages: 1, sleep: noSleep });
  assert.equal(r1.inserted, 5);
  assert.equal(r1.completed, false);
  const r2 = await runSync({ erp, store, checkpoint: cp, sleep: noSleep });
  assert.equal(r2.inserted, 7);
  assert.equal(r2.skipped, 0);
  assert.equal(store.rows.size, 12);
});

test('re-running with nothing new is a no-op', async () => {
  const erp = createMockErp({ records: mk(7), pageSize: 5 });
  const store = createStore();
  const cp = memoryCheckpoint();
  await runSync({ erp, store, checkpoint: cp, sleep: noSleep });
  const r = await runSync({ erp, store, checkpoint: cp, sleep: noSleep });
  assert.equal(r.inserted + r.updated, 0);
});

test('edits made mid-sync are picked up on the next run', async () => {
  const recs = mk(8);
  const erp = createMockErp({ records: recs, pageSize: 5 });
  const store = createStore();
  const cp = memoryCheckpoint();
  await runSync({ erp, store, checkpoint: cp, maxPages: 1, sleep: noSleep });
  erp.upsert({ ...recs[1], amount: 777, lastModified: 5_000_000 }); // already-synced row edited
  const r = await runSync({ erp, store, checkpoint: cp, sleep: noSleep });
  assert.equal(store.rows.get('R001').amount, 777);
  assert.equal(r.updated, 1);
});

test('429s are retried, honoring retryAfter', async () => {
  const erp = createMockErp({ records: mk(10), pageSize: 5, throttleEvery: 2, retryAfterMs: 321 });
  const waits = [];
  const store = createStore();
  const r = await runSync({ erp, store, checkpoint: memoryCheckpoint(), sleep: async (ms) => waits.push(ms) });
  assert.equal(store.rows.size, 10);
  assert.ok(r.throttled >= 1);
  assert.ok(waits.every((w) => w === 321));
});

test('gives up after maxRetries and keeps the checkpoint from completed pages', async () => {
  let n = 0;
  const base = createMockErp({ records: mk(10), pageSize: 5 });
  const erp = { list: async (a) => (++n === 1 ? base.list(a) : Promise.reject(Object.assign(new Error('x'), { status: 429 }))) };
  const cp = memoryCheckpoint();
  await assert.rejects(runSync({ erp, store: createStore(), checkpoint: cp, maxRetries: 2, sleep: noSleep }));
  assert.equal(cp.load().id, 'R004');
});

test('rows sharing the same lastModified are not lost at page boundaries', async () => {
  const recs = Array.from({ length: 11 }, (_, i) => ({ id: `S${String(i).padStart(2, '0')}`, amount: i, lastModified: 42 }));
  const erp = createMockErp({ records: recs, pageSize: 4 });
  const store = createStore();
  await runSync({ erp, store, checkpoint: memoryCheckpoint(), sleep: noSleep });
  assert.equal(store.rows.size, 11);
});

test('overlap window re-reads history but upserts stay idempotent and checkpoint never regresses', async () => {
  const erp = createMockErp({ records: mk(6), pageSize: 3 });
  const store = createStore();
  const cp = memoryCheckpoint();
  await runSync({ erp, store, checkpoint: cp, sleep: noSleep });
  const before = cp.load();
  const r = await runSync({ erp, store, checkpoint: cp, overlapMs: 10_000, sleep: noSleep });
  assert.ok(r.skipped > 0);
  assert.equal(r.inserted + r.updated, 0);
  assert.deepEqual(cp.load(), before);
});
