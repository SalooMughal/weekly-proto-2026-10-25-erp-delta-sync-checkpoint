// Resumable delta sync: pull changed records from an ERP, upsert them into a
// local store idempotently, and advance a checkpoint only AFTER each page is
// safely applied. Kill it at any point and the next run picks up where it left
// off; re-reading a page is harmless because upserts are idempotent.

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Local store: upsert is a no-op unless the incoming record is newer. */
export function createStore() {
  const rows = new Map();
  return {
    rows,
    upsert(rec) {
      const cur = rows.get(rec.id);
      if (cur && cur.lastModified >= rec.lastModified) return 'skipped';
      rows.set(rec.id, rec);
      return cur ? 'updated' : 'inserted';
    },
  };
}

async function fetchWithGovernance(erp, args, { maxRetries, baseDelayMs, maxDelayMs, sleep }, stats) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await erp.list(args);
    } catch (err) {
      if (err.status !== 429 || attempt >= maxRetries) throw err;
      // Honor the server's Retry-After when present; otherwise exponential backoff.
      const wait = Math.min(err.retryAfterMs ?? baseDelayMs * 2 ** attempt, maxDelayMs);
      stats.throttled++;
      await sleep(wait);
    }
  }
}

/**
 * @param opts.maxPages   stop early after N pages (used to simulate a crash/timeout)
 * @param opts.overlapMs  on start, re-read this much history before the checkpoint
 *                        to tolerate late-committing writes on the source side
 */
export async function runSync({
  erp, store, checkpoint,
  maxPages = Infinity, overlapMs = 0,
  maxRetries = 5, baseDelayMs = 100, maxDelayMs = 5000, sleep = defaultSleep,
}) {
  const stats = { pages: 0, inserted: 0, updated: 0, skipped: 0, throttled: 0, completed: false };
  const saved = checkpoint.load(); // { lastModified, id } high-water mark, or null
  let highWater = saved;
  let after = saved ? (overlapMs ? { lastModified: saved.lastModified - overlapMs, id: '' } : { ...saved }) : undefined;

  while (stats.pages < maxPages) {
    const page = await fetchWithGovernance(erp, { after }, { maxRetries, baseDelayMs, maxDelayMs, sleep }, stats);
    for (const rec of page.items) stats[store.upsert(rec)]++;
    stats.pages++;
    if (page.nextCursor) {
      // Never move the high-water mark backwards (the overlap re-read may return older rows).
      const c = page.nextCursor;
      if (!highWater || c.lastModified > highWater.lastModified ||
          (c.lastModified === highWater.lastModified && c.id > highWater.id)) {
        highWater = c;
        checkpoint.save(highWater); // commit AFTER the page is applied
      }
      after = c;
    }
    if (page.done) { stats.completed = true; break; }
  }
  return { ...stats, checkpoint: highWater };
}
