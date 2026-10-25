import { mkdirSync } from 'node:fs';
import { createMockErp } from './mockErp.js';
import { createStore, runSync } from './sync.js';
import { fileCheckpoint } from './checkpoint.js';

const T0 = Date.parse('2026-10-01T00:00:00Z');
const records = Array.from({ length: 23 }, (_, i) => ({
  id: `INV-${String(i + 1).padStart(4, '0')}`,
  name: `Invoice ${i + 1}`,
  amount: 100 + i * 7,
  lastModified: T0 + i * 60_000,
}));

mkdirSync('.demo-state', { recursive: true });
const checkpoint = fileCheckpoint('.demo-state/erp.checkpoint.json');
checkpoint.save(null); // fresh start for the demo
const erp = createMockErp({ records, pageSize: 5, throttleEvery: 3, retryAfterMs: 50 });
const store = createStore();
const log = (label, r) =>
  console.log(`${label}: pages=${r.pages} inserted=${r.inserted} updated=${r.updated} skipped=${r.skipped} throttled(429)=${r.throttled} completed=${r.completed} store=${store.rows.size}`);

// Run 1: "crashes" (hits a time budget) after 2 pages.
log('run 1 (interrupted after 2 pages)', await runSync({ erp, store, checkpoint, maxPages: 2, sleep: async () => {} }));

// Meanwhile, someone edits a record and creates a new one in the ERP.
erp.upsert({ ...records[3], amount: 9999, lastModified: T0 + 24 * 60_000 });
erp.upsert({ id: 'INV-0024', name: 'Invoice 24', amount: 500, lastModified: T0 + 25 * 60_000 });

// Run 2: resumes from the checkpoint and finishes, picking up the late edits.
log('run 2 (resumed)', await runSync({ erp, store, checkpoint, sleep: async () => {} }));

// Run 3: nothing new -> idempotent no-op.
log('run 3 (nothing new)', await runSync({ erp, store, checkpoint, sleep: async () => {} }));

console.log('INV-0004 amount in local store:', store.rows.get('INV-0004').amount, '(was updated in the ERP mid-sync)');
