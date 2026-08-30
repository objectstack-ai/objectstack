// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#12981] The boot backfill's REFUSED-WRITE accounting.
//
// The shape under test is the one #12981 was filed about and #12970 repaired in
// `permission-set-drift.ts`: a per-row `catch { }` plus a report gated on
// `updated > 0`. Together they make a pass in which EVERY write was refused
// print exactly the same bytes as a pass with nothing to do — so the assertions
// below are about what the LOGGER heard, not only about the returned counts. A
// test that only checked `refused` would pass against a version that counts the
// refusals and still says nothing.

import { describe, it, expect, vi } from 'vitest';
import { backfillPrimaryBu } from './primary-bu-projection.js';

type Row = Record<string, any>;

function makeEngine(members: Row[], onUpdate: (data: Row) => void) {
  return {
    registerHook: vi.fn(),
    unregisterHooksByPackage: vi.fn(() => 0),
    find: vi.fn(async () => members),
    update: vi.fn(async (_object: string, data: Row) => {
      onUpdate(data);
      return data;
    }),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

const MEMBERS: Row[] = [
  { user_id: 'u1', business_unit_id: 'bu1' },
  { user_id: 'u2', business_unit_id: 'bu2' },
];

describe('backfillPrimaryBu — refused writes are counted and reported', () => {
  it('reports when EVERY row is refused, instead of printing nothing', async () => {
    const logger = makeLogger();
    const engine = makeEngine(MEMBERS, () => {
      throw new Error('sys_user write refused');
    });

    const result = await backfillPrimaryBu(engine, logger);

    // The count is honest...
    expect(result).toEqual({ updated: 0, refused: 2 });
    // ...and, the half that actually matters, the pass is no longer SILENT.
    // Before #12981 this branch was `if (updated > 0)`, so a fully-refused
    // backfill logged nothing at all and read as "no work to do".
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.warn.mock.calls[0];
    expect(message).toContain('REFUSED');
    // The consequence is named in the line itself — AGENTS.md "Degradation log
    // levels" owes the consequence and the remedy, not a bare count.
    expect(message).toContain('primary_business_unit_id');
    expect(meta).toMatchObject({ refused: 2, updated: 0, scanned: 2 });
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('still reports the summary on a partially refused pass', async () => {
    const logger = makeLogger();
    const engine = makeEngine(MEMBERS, (data) => {
      if (data.id === 'u2') throw new Error('sys_user write refused');
    });

    const result = await backfillPrimaryBu(engine, logger);

    expect(result).toEqual({ updated: 1, refused: 1 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      '[primary-bu] backfilled projection',
      { updated: 1, refused: 1 },
    );
  });

  it('says nothing when there was nothing to do — the two must stay distinguishable', async () => {
    const logger = makeLogger();
    const engine = makeEngine([], () => {});

    const result = await backfillPrimaryBu(engine, logger);

    expect(result).toEqual({ updated: 0, refused: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('a clean pass reports only the summary', async () => {
    const logger = makeLogger();
    const engine = makeEngine(MEMBERS, () => {});

    const result = await backfillPrimaryBu(engine, logger);

    expect(result).toEqual({ updated: 2, refused: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[primary-bu] backfilled projection',
      { updated: 2, refused: 0 },
    );
  });

  it('a refused SCAN answers both counters, not a half-built result', async () => {
    const logger = makeLogger();
    const engine = {
      registerHook: vi.fn(),
      unregisterHooksByPackage: vi.fn(() => 0),
      find: vi.fn(async () => {
        throw new Error('scan refused');
      }),
      update: vi.fn(),
    };

    expect(await backfillPrimaryBu(engine, logger)).toEqual({ updated: 0, refused: 0 });
    expect(engine.update).not.toHaveBeenCalled();
  });
});
