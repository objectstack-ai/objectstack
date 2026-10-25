/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { executeBulkBatch } from '../bulkFastPath';

describe('executeBulkBatch', () => {
  const baseInput = {
    ids: ['1', '2', '3'],
    originalSize: 3,
    offset: 0,
    allowBulk: true,
  };

  it('takes the bulk path when allowed and call succeeds in full', async () => {
    const bulkCall = vi.fn(async () => 3);
    const perRow = vi.fn();
    const out = await executeBulkBatch(baseInput, { bulkCall, perRow });
    expect(bulkCall).toHaveBeenCalledOnce();
    expect(perRow).not.toHaveBeenCalled();
    expect(out).toEqual({ succeeded: 3, failed: 0, errors: [] });
  });

  it('records an aggregate error when bulk returns a partial count', async () => {
    const bulkCall = vi.fn(async () => 1);
    const perRow = vi.fn();
    const out = await executeBulkBatch(
      { ...baseInput, label: 'bulk update' },
      { bulkCall, perRow },
    );
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(2);
    expect(out.errors[0]).toMatchObject({
      id: 'batch_0',
      error: expect.stringContaining('bulk update'),
    });
    // Per-row must NOT run when bulk accepted the request — that would
    // re-mutate the rows the server already processed.
    expect(perRow).not.toHaveBeenCalled();
  });

  it('falls back to per-row when bulk throws', async () => {
    const bulkCall = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const perRow = vi.fn(async (id: string) => {
      if (id === '2') throw new Error('row 2 rejected');
      return undefined;
    });
    const out = await executeBulkBatch(baseInput, { bulkCall, perRow });
    expect(perRow).toHaveBeenCalledTimes(3);
    expect(out.succeeded).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.errors).toEqual([{ id: '2', error: 'row 2 rejected' }]);
  });

  it('skips bulk and goes straight to per-row when allowBulk is false', async () => {
    const bulkCall = vi.fn();
    const perRow = vi.fn(async () => undefined);
    const out = await executeBulkBatch(
      { ...baseInput, allowBulk: false },
      { bulkCall, perRow },
    );
    expect(bulkCall).not.toHaveBeenCalled();
    expect(perRow).toHaveBeenCalledTimes(3);
    expect(out.succeeded).toBe(3);
  });

  it('skips bulk when bulkCall is not provided', async () => {
    const perRow = vi.fn(async () => undefined);
    const out = await executeBulkBatch(baseInput, { perRow });
    expect(perRow).toHaveBeenCalledTimes(3);
    expect(out.succeeded).toBe(3);
  });

  it('clamps over-reported bulk counts to ids.length (defensive)', async () => {
    const bulkCall = vi.fn(async () => 99); // server lies / off-by-one
    const out = await executeBulkBatch(baseInput, { bulkCall, perRow: vi.fn() });
    // Should never report more successes than ids in the batch.
    expect(out.succeeded).toBe(3);
    expect(out.failed).toBe(0);
  });

  it('uses the offset in the aggregate error id', async () => {
    const out = await executeBulkBatch(
      { ...baseInput, offset: 200 },
      { bulkCall: async () => 0, perRow: vi.fn() },
    );
    expect(out.errors[0].id).toBe('batch_200');
  });
});

/**
 * objectui#13442 — a bulk call that names its failed rows (`BulkWriteResult`,
 * what `DataSource.bulkUpdate` / `bulkDelete` may resolve to) keeps each one
 * under its own id and the server's reason. Before, every shortfall became one
 * `batch_${offset}` entry, so Retry and the error CSV had no record to act on.
 */
describe('executeBulkBatch — per-record results from the bulk call (objectui#13442)', () => {
  const five = { ids: ['r1', 'r2', 'r3', 'r4', 'r5'], originalSize: 5, offset: 0, allowBulk: true, label: 'bulk update' };

  it('reports each failure the call named under its own id, with no aggregate entry', async () => {
    const bulkCall = vi.fn(async () => ({
      succeeded: 3,
      errors: [
        { id: 'r2', error: 'Discharge date is required' },
        { id: 'r4', error: 'Record is locked' },
      ],
    }));
    const perRow = vi.fn();
    const out = await executeBulkBatch(five, { bulkCall, perRow });
    expect(out).toEqual({
      succeeded: 3,
      failed: 2,
      errors: [
        { id: 'r2', error: 'Discharge date is required' },
        { id: 'r4', error: 'Record is locked' },
      ],
    });
    // The server already applied the request: no per-row re-run.
    expect(perRow).not.toHaveBeenCalled();
  });

  it('folds only the failures the call did NOT name into the aggregate entry', async () => {
    const out = await executeBulkBatch(five, {
      bulkCall: async () => ({ succeeded: 2, errors: [{ id: 'r5', error: 'Denied by sharing rule' }] }),
      perRow: vi.fn(),
    });
    expect(out.succeeded).toBe(2);
    expect(out.failed).toBe(3);
    expect(out.errors).toEqual([
      { id: 'r5', error: 'Denied by sharing rule' },
      { id: 'batch_0', error: '2 records failed in bulk update' },
    ]);
  });

  it('ignores an entry for an id outside the batch, and a repeated id', async () => {
    const out = await executeBulkBatch(five, {
      bulkCall: async () => ({
        succeeded: 3,
        errors: [
          { id: 'not_in_batch', error: 'x' },
          { id: 'r1', error: 'first' },
          { id: 'r1', error: 'again' },
        ],
      }),
      perRow: vi.fn(),
    });
    expect(out.failed).toBe(2);
    expect(out.errors).toEqual([
      { id: 'r1', error: 'first' },
      { id: 'batch_0', error: '1 record failed in bulk update' },
    ]);
  });

  it('never lists more entries than the reported shortfall', async () => {
    const out = await executeBulkBatch(five, {
      bulkCall: async () => ({
        succeeded: 4,
        errors: [
          { id: 'r2', error: 'a' },
          { id: 'r3', error: 'b' },
        ],
      }),
      perRow: vi.fn(),
    });
    expect(out.failed).toBe(1);
    expect(out.errors).toEqual([{ id: 'r2', error: 'a' }]);
  });

  it('a full success reports no entries, and a plain count still works as before', async () => {
    const full = await executeBulkBatch(five, {
      bulkCall: async () => ({ succeeded: 5, errors: [] }),
      perRow: vi.fn(),
    });
    expect(full).toEqual({ succeeded: 5, failed: 0, errors: [] });

    const count = await executeBulkBatch(five, { bulkCall: async () => 4, perRow: vi.fn() });
    expect(count.errors).toEqual([{ id: 'batch_0', error: '1 record failed in bulk update' }]);
  });
});
