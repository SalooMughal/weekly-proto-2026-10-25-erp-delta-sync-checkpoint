# erp-delta-sync-checkpoint

A small demo of a **resumable, checkpointed delta sync** from an ERP-style REST API (modelled loosely on NetSuite saved-search / SuiteQL pulls) into a local store.

> **Note:** This is a standalone prototype built to explore the pattern. It talks to an in-memory mock ERP only — no real NetSuite (or any other) credentials, APIs, or production usage are involved.

## Why it's interesting

ERP integrations fail in boring, expensive ways: a job times out halfway, the API throttles you, or records change while you're paginating. This demo shows a few small techniques that handle those cases:

- **Keyset pagination** on `(lastModified, id)` instead of offsets, so mid-sync edits never cause skipped or duplicated rows, and many rows sharing one timestamp are not lost at page boundaries.
- **Checkpoint after apply**: the high-water mark is saved only after a page is written to the store, so a crash can re-read a page but never skip one.
- **Idempotent upserts**: a record is applied only if it is newer than what's stored, so re-reads are harmless.
- **Governance/429 handling**: retries honor the server's `retryAfterMs` (like a concurrency-limit response), falling back to exponential backoff, and give up after a bounded number of attempts.
- **Optional overlap window**: re-read a little history at start to tolerate late-committing writes on the source side, without ever moving the checkpoint backwards.
- **Atomic checkpoint file**: write-temp-then-rename so a crash can't leave a corrupt checkpoint.

## Run it

Requires Node 20+ (no dependencies).

```bash
npm run demo   # interrupted run -> resume -> no-op run, with simulated 429s
npm test       # 8 node:test tests
```

Example demo output:

```
run 1 (interrupted after 2 pages): pages=2 inserted=10 ... completed=false store=10
run 2 (resumed): pages=4 inserted=14 updated=1 ... throttled(429)=2 completed=true store=24
run 3 (nothing new): pages=1 inserted=0 updated=0 ... completed=true store=24
```

## Layout

- `src/mockErp.js` – mock ERP with keyset-paginated `list()`, optional throttling, and `upsert()` to simulate live edits
- `src/sync.js` – `runSync()` engine and an idempotent in-memory store
- `src/checkpoint.js` – in-memory and atomic file-backed checkpoints
- `test/sync.test.js` – resume, idempotency, mid-sync edits, 429 retry, tie-handling, overlap window

## What it demonstrates

Designing integrations for failure: at-least-once reads made safe by idempotent writes, durable progress tracking, and polite behavior under API rate limits.

## Known limits

Deletions (tombstones), schema mapping, concurrency across multiple sync workers, and persistent storage are intentionally out of scope for this small demo.

## License

MIT
