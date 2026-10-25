// A tiny in-memory stand-in for an ERP REST API (think NetSuite saved-search /
// SuiteQL style). No real credentials or network involved.
//
// Records look like { id, name, amount, lastModified }.
// Listing uses KEYSET pagination on (lastModified, id) rather than offsets, so
// rows that change mid-sync never cause skipped or duplicated pages.

export class RateLimitError extends Error {
  constructor(retryAfterMs) {
    super('CONCURRENCY_LIMIT_EXCEEDED');
    this.status = 429;
    this.retryAfterMs = retryAfterMs;
  }
}

const cmp = (a, b) => a.lastModified - b.lastModified || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createMockErp({ records, pageSize = 5, throttleEvery = 0, retryAfterMs = 200 } = {}) {
  const rows = new Map(records.map((r) => [r.id, { ...r }]));
  let calls = 0;
  return {
    stats: () => ({ calls }),
    // Simulates someone editing the ERP while our sync is running.
    upsert(record) {
      rows.set(record.id, { ...record });
    },
    /** @param after {lastModified:number,id:string} exclusive lower bound */
    async list({ after = { lastModified: -Infinity, id: '' } } = {}) {
      calls++;
      if (throttleEvery && calls % throttleEvery === 0) throw new RateLimitError(retryAfterMs);
      const sorted = [...rows.values()].sort(cmp);
      const items = sorted.filter((r) => cmp(r, after) > 0).slice(0, pageSize);
      const last = items[items.length - 1];
      return {
        items: items.map((r) => ({ ...r })),
        nextCursor: last ? { lastModified: last.lastModified, id: last.id } : null,
        done: items.length < pageSize,
      };
    },
  };
}
