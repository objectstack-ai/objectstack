// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5240] The wasm driver refuses `{ field: {} }` too — the fourth backend.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the refusal is inherited and nothing
 * here re-implements it. What this pins is that the inheritance actually
 * DELIVERS it end to end: this driver swaps knex's transport for a custom sql.js
 * dialect, and the refusal has to survive that pipeline with its ADR-0112
 * envelope (`code` / `status`) intact rather than being swallowed, re-wrapped by
 * the wasm error path, or bypassed by an override.
 *
 * "It inherits the compiler, therefore it is fine" is the assumption this
 * driver's temporal / pagination / filter-logic suites exist to disprove (#4405),
 * so the fourth backend is verified rather than assumed — which is also what the
 * ruling on #5240 requires: the SAME error code from all four.
 *
 * [#8197, maintainer ruling 2026-08-15] This refusal now names its field and its
 * position ONLY for a predicate positively marked author-written: on a
 * read-scope-injected subtree both are the administrator's. The positions table
 * below is therefore marked as what it is — the test author's own filter — so it
 * keeps asking its original question (does the inherited refusal still name the
 * position?) instead of quietly weakening into "does it refuse at all?".
 *
 * ⛔ Do not "fix" a failure here by deleting the position assertions: the mark is
 * what this driver must inherit alongside the refusal, and the last case in the
 * file pins that inheritance from the other side — unmarked ⇒ withheld.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from './index.js';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#5240] driver-sqlite-wasm inherits the zero-operator field-constraint refusal', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: 'deal', fields: { stage: { type: 'string' }, owner: { type: 'string' } } },
    ]);
    await driver.create('deal', { id: '1', stage: 'won', owner: 'u1' }, { bypassTenantAudit: true });
    await driver.create('deal', { id: '2', stage: 'lost', owner: 'u2' }, { bypassTenantAudit: true });
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find(
      'deal',
      { object: 'deal', fields: ['id'], where } as any,
      { bypassTenantAudit: true },
    );
    return (rows as any[]).map((r) => String(r.id)).sort();
  };

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await ids(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  const positions: Array<[string, unknown, string]> = [
    ['top level', { stage: {} }, 'filter.stage'],
    ['inside $or', { $or: [{ stage: {} }, { owner: 'u2' }] }, 'filter.$or[0].stage'],
    ['inside $and', { $and: [{ stage: 'won' }, { owner: {} }] }, 'filter.$and[1].owner'],
    ['inside $not', { $not: { stage: {} } }, 'filter.$not.stage'],
  ];

  for (const [name, where, position] of positions) {
    it(`${name} → 400 INVALID_FILTER naming ${position}`, async () => {
      const err = await refusalOf(markFilterSubtreeProvenance(where, 'author'));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(position);
      expect(err.message).toContain('zero operators');
    });
  }

  it('[#8197] the WITHHOLD is inherited too — an unmarked predicate names nothing', async () => {
    // The other half of the inheritance claim, and the half a fresh literal is
    // needed for: the marks above are non-writable and first-mark-wins, so a
    // reused fixture would carry the author verdict into this case and it would
    // pass against a driver that had inherited no withhold at all.
    const err = await refusalOf({ $or: [{ stage: {} }, { owner: 'u2' }] });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('zero operators');
    expect(err.message).not.toContain('filter.$or[0].stage');
    expect(err.message).not.toContain('stage');
  });

  it('ordinary filters still run through the wasm dialect unchanged', async () => {
    expect(await ids({ stage: 'won' })).toEqual(['1']);
    expect(await ids({ $or: [{ stage: 'won' }, { owner: 'u2' }] })).toEqual(['1', '2']);
    expect(await ids({})).toEqual(['1', '2']);
  });
});
