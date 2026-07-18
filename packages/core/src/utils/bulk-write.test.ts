// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { bulkWrite, defaultIsTransientError, withTransientRetry } from './bulk-write';

const noopSleep = async () => {};

describe('bulkWrite', () => {
  it('writes N rows in ceil(N/batchSize) batch calls, not N single-row calls', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ n: i }));
    const writeBatch = vi.fn(async (batch: { n: number }[]) => batch.map((r) => ({ id: `r${r.n}` })));
    const writeOne = vi.fn(async (row: { n: number }) => ({ id: `r${row.n}` }));

    const results = await bulkWrite(rows, { batchSize: 100, writeBatch, writeOne, sleep: noopSleep });

    expect(writeBatch).toHaveBeenCalledTimes(3); // ceil(250/100)
    expect(writeOne).not.toHaveBeenCalled();
    expect(results).toHaveLength(250);
    expect(results.every((r) => r.ok)).toBe(true);
    // Results stay correlated to original row order across batch boundaries.
    expect(results[0].record).toEqual({ id: 'r0' });
    expect(results[249].record).toEqual({ id: 'r249' });
  });

  it('retries a whole-batch transient failure and does not degrade to per-row on success', async () => {
    let attempts = 0;
    const writeBatch = vi.fn(async (batch: { n: number }[]) => {
      attempts++;
      if (attempts === 1) throw new Error('fetch failed');
      return batch.map((r) => ({ id: `r${r.n}` }));
    });
    const writeOne = vi.fn(async () => ({ id: 'x' }));

    const rows = [{ n: 1 }, { n: 2 }];
    const results = await bulkWrite(rows, { batchSize: 10, writeBatch, writeOne, sleep: noopSleep });

    expect(writeBatch).toHaveBeenCalledTimes(2);
    expect(writeOne).not.toHaveBeenCalled();
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('degrades to per-row on a logical (non-transient) batch error, without failing the other rows', async () => {
    const writeBatch = vi.fn(async () => {
      throw new Error('CHECK constraint failed: score >= 0');
    });
    const writeOne = vi.fn(async (row: { n: number; bad?: boolean }) => {
      if (row.bad) throw new Error('CHECK constraint failed: score >= 0');
      return { id: `r${row.n}` };
    });

    const rows = [{ n: 1 }, { n: 2, bad: true }, { n: 3 }];
    const results = await bulkWrite(rows, { batchSize: 10, writeBatch, writeOne, sleep: noopSleep });

    expect(writeBatch).toHaveBeenCalledTimes(1);
    expect(writeOne).toHaveBeenCalledTimes(3);
    expect(results[0]).toMatchObject({ index: 0, ok: true, record: { id: 'r1' } });
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toBeInstanceOf(Error);
    expect(results[2]).toMatchObject({ index: 2, ok: true, record: { id: 'r3' } });
  });

  it('exhausts batch retries on a persistent transient error, then still degrades to per-row', async () => {
    const writeBatch = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    });
    const writeOne = vi.fn(async (row: { n: number }) => ({ id: `r${row.n}` }));

    const rows = [{ n: 1 }, { n: 2 }];
    const results = await bulkWrite(rows, {
      batchSize: 10, maxRetries: 2, writeBatch, writeOne, sleep: noopSleep,
    });

    expect(writeBatch).toHaveBeenCalledTimes(2); // maxRetries batch attempts
    expect(writeOne).toHaveBeenCalledTimes(2); // then one call per row
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('keeps per-row index correlation intact across multiple batches with a mid-stream failure', async () => {
    const writeBatch = vi.fn(async (batch: { n: number; bad?: boolean }[]) => {
      if (batch.some((r) => r.bad)) throw new Error('validation error');
      return batch.map((r) => ({ id: `r${r.n}` }));
    });
    const writeOne = vi.fn(async (row: { n: number; bad?: boolean }) => {
      if (row.bad) throw new Error('validation error');
      return { id: `r${row.n}` };
    });

    const rows = [{ n: 0 }, { n: 1 }, { n: 2, bad: true }, { n: 3 }, { n: 4 }];
    const results = await bulkWrite(rows, { batchSize: 2, writeBatch, writeOne, sleep: noopSleep });

    expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(results[2].ok).toBe(false);
    expect(results.filter((r) => r.ok)).toHaveLength(4);
  });

  it('never retries a logical error at the row level either', async () => {
    const writeBatch = vi.fn(async () => { throw new Error('logical'); });
    const writeOne = vi.fn(async () => { throw new Error('NOT NULL constraint failed'); });

    const results = await bulkWrite([{ n: 1 }, { n: 2 }], { batchSize: 10, maxRetries: 3, writeBatch, writeOne, sleep: noopSleep });

    expect(writeOne).toHaveBeenCalledTimes(2); // no retry per row — not transient
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('a single-row batch failure is the row result directly, without a redundant writeOne call', async () => {
    const writeBatch = vi.fn(async () => { throw new Error('logical'); });
    const writeOne = vi.fn(async () => ({ id: 'should-not-be-called' }));

    const results = await bulkWrite([{ n: 1 }], { batchSize: 10, writeBatch, writeOne, sleep: noopSleep });

    expect(writeOne).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ index: 0, ok: false });
  });

  it('rejects a short writeBatch return as a failed batch and degrades to per-row (#3151)', async () => {
    // Driver dropped a row from its RETURNING set: 2-row batch, 1 record back.
    const writeBatch = vi.fn(async (batch: { n: number }[]) => batch.slice(1).map((r) => ({ id: `r${r.n}` })));
    const writeOne = vi.fn(async (row: { n: number }) => ({ id: `r${row.n}` }));

    const results = await bulkWrite([{ n: 1 }, { n: 2 }], { batchSize: 10, writeBatch, writeOne, sleep: noopSleep });

    expect(writeBatch).toHaveBeenCalledTimes(1); // mismatch is NOT transient — no batch retry
    expect(writeOne).toHaveBeenCalledTimes(2);   // degraded to per-row instead of phantom success
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.record)).toEqual([{ id: 'r1' }, { id: 'r2' }]);
  });

  it('rejects a non-array writeBatch return and degrades to per-row (#3151)', async () => {
    const writeBatch = vi.fn(async () => undefined as unknown as { id: string }[]);
    const writeOne = vi.fn(async (row: { n: number }) => ({ id: `r${row.n}` }));

    const results = await bulkWrite([{ n: 1 }, { n: 2 }], { batchSize: 10, writeBatch, writeOne, sleep: noopSleep });

    expect(writeOne).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('rejects an over-long writeBatch return and degrades to per-row (#3151)', async () => {
    const writeBatch = vi.fn(async (batch: { n: number }[]) => [...batch, { n: 999 }].map((r) => ({ id: `r${r.n}` })));
    const writeOne = vi.fn(async (row: { n: number }) => ({ id: `r${row.n}` }));

    const results = await bulkWrite([{ n: 1 }, { n: 2 }], { batchSize: 10, writeBatch, writeOne, sleep: noopSleep });

    expect(writeOne).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('surfaces ERR_BULK_RESULT_MISMATCH on a single-row batch with the wrong return count (#3151)', async () => {
    const writeBatch = vi.fn(async () => [] as { id: string }[]); // empty for a 1-row batch
    const writeOne = vi.fn(async () => ({ id: 'unused' }));

    const results = await bulkWrite([{ n: 1 }], { batchSize: 10, writeBatch, writeOne, sleep: noopSleep });

    expect(writeOne).not.toHaveBeenCalled(); // single-row batch failure IS the row's final result
    expect(results[0].ok).toBe(false);
    expect((results[0].error as { code?: string })?.code).toBe('ERR_BULK_RESULT_MISMATCH');
  });
});

describe('withTransientRetry', () => {
  it('retries a transient failure and returns the eventual success', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fetch failed');
      return 'ok';
    });

    const result = await withTransientRetry(fn, { sleep: noopSleep });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a logical error', async () => {
    const fn = vi.fn(async () => { throw new Error('UNIQUE constraint failed'); });

    await expect(withTransientRetry(fn, { sleep: noopSleep })).rejects.toThrow('UNIQUE constraint failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('defaultIsTransientError', () => {
  it('recognizes common transient network signatures', () => {
    expect(defaultIsTransientError(new Error('fetch failed'))).toBe(true);
    expect(defaultIsTransientError(new Error('request timed out after 30000ms'))).toBe(true);
    expect(defaultIsTransientError(new Error('socket hang up'))).toBe(true);
    expect(defaultIsTransientError(Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
    expect(defaultIsTransientError(new Error('Service returned 503'))).toBe(true);
  });

  it('does not classify validation/constraint errors as transient', () => {
    expect(defaultIsTransientError(new Error('NOT NULL constraint failed: task.title'))).toBe(false);
    expect(defaultIsTransientError(new Error('Validation failed: email is required'))).toBe(false);
    expect(defaultIsTransientError(new Error('UNIQUE constraint failed: task.id'))).toBe(false);
  });

  it('classifies a mixed constraint+network message as logical, not transient (#3150)', () => {
    // A logical signature must win even when a transient keyword also appears,
    // so we do not burn retries on a row that will fail identically each time.
    expect(defaultIsTransientError(new Error('CHECK constraint failed: network_zone'))).toBe(false);
    expect(defaultIsTransientError(new Error('column network_id is not allowed'))).toBe(false);
    expect(defaultIsTransientError(new Error('value out of range at row 503'))).toBe(false);
    // Pure transient signatures are unaffected.
    expect(defaultIsTransientError(new Error('fetch failed'))).toBe(true);
  });
});
