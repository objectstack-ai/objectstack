// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26825] The seed ownership hand-over yields to the event loop between
 * bounded batches — measured on a REAL `ObjectQL` over a real `SqlDriver`
 * (better-sqlite3 `:memory:`), the synchronous driver the stall was measured on.
 *
 * On better-sqlite3 every `await` of a claim write resolves as a microtask, so
 * one predicate write ran its whole per-row fan-out (code hooks, an audit row
 * per row) as one unbroken chain: measured on `os serve --dev` with a 1 500-row
 * seed, the NULL arm's one write took 2.6 s and a sign-in issued meanwhile
 * waited for all of it. These pins hold the cure and the four conditions it was
 * accepted on:
 *
 *  1. **the yield** — at most one batch of rows is re-owned between two
 *     macrotask turns, and a read issued while the hand-over runs completes
 *     before the hand-over ends;
 *  2. **the result** — every seeded row is owned by the admin and every claimed
 *     row wrote exactly one audit row, the outcome one unbatched write gave;
 *  3. **a batch refused** — the other batches stay claimed, one warning names
 *     the rows left unowned and the first refusal, and the next run claims them;
 *  4. **every batch refused** — nothing is claimed and the one warning is the
 *     one a refused chunk always gave.
 *
 * The audit row is written by a code-registered `afterUpdate` hook, the shape
 * of plugin-audit's writer: an engine insert inside the claim's write. The
 * booted-app half (the real audit plugin) is the dogfood
 * `seed-ownership-claim-dispatch.dogfood.test.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { claimSeedOwnership } from './claim-seed-ownership.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as const;
const ADMIN = 'usr_admin_human';
const OBJECT = 'probe_deal';
const AUDIT = 'probe_audit';
const READ_OBJECT = 'probe_person';
/** The claim's hand-over batch (`CLAIM_HANDOVER_ROWS`, module-private). */
const HANDOVER_ROWS = 50;
/** Seeded rows: six batches, and one partial batch at the end. */
const N = 6 * HANDOVER_ROWS + 20;

const OBJECTS: any[] = [
  {
    name: OBJECT,
    label: 'Probe Deal',
    fields: {
      id: { type: 'text', label: 'Id', primary: true },
      name: { type: 'text', label: 'Name' },
      owner_id: { type: 'text', label: 'Owner' },
    },
  },
  {
    name: AUDIT,
    label: 'Probe Audit',
    fields: {
      record_id: { type: 'text', label: 'Record' },
      owner_id: { type: 'text', label: 'New owner' },
    },
  },
  {
    name: READ_OBJECT,
    label: 'Probe Person',
    fields: { email: { type: 'text', label: 'Email' } },
  },
];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** The seed's report of the rows it landed on: every probe deal. */
const seededAre = (ids: string[]) => (object: string): readonly string[] => (object === OBJECT ? ids : []);

/**
 * A booted engine with `N` unowned seeded deals, one person to read, and a
 * code-registered `afterUpdate` hook writing one audit row per updated deal.
 * `refuse` names the deals a code-registered `beforeUpdate` hook refuses.
 */
async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.claim-yield-26825',
    name: 'Claim yield',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as any);
  await engine.syncSchemas();
  // The organization-less rows below exist only on a store built before 18.x.
  await relaxTenantColumns(engine, [OBJECT, AUDIT, READ_OBJECT]);
  engines.push(engine);

  const ids = Array.from({ length: N }, (_, i) => `d${String(i).padStart(4, '0')}`);
  const driver = (engine as any).getDriverForObject(OBJECT);
  await driver.bulkCreate(OBJECT, ids.map((id) => ({ id, name: `Deal ${id}`, owner_id: null })));
  await (engine as any).getDriverForObject(READ_OBJECT).bulkCreate(READ_OBJECT, [{ id: 'p1', email: 'a@example.com' }]);

  const refuse = new Set<string>();
  let claimedRows = 0;
  engine.registerHook('beforeUpdate', async (ctx: any) => {
    const id = String(ctx?.input?.id ?? '');
    if (refuse.has(id) || refuse.has('*')) throw new Error(`probe refused ${id}`);
  }, { object: OBJECT, packageId: 'probe.refuse' });
  engine.registerHook('afterUpdate', async (ctx: any) => {
    claimedRows += 1;
    await (engine as any).insert(AUDIT, { record_id: String(ctx?.input?.id ?? ''), owner_id: ADMIN }, SYS);
  }, { object: OBJECT, packageId: 'probe.audit' });

  return { engine, ids, refuse, claimed: () => claimedRows };
}

async function ownersOf(engine: ObjectQL): Promise<Map<string, unknown>> {
  const rows = await (engine as any).find(OBJECT, { fields: ['id', 'owner_id'] }, SYS);
  return new Map(rows.map((r: any) => [r.id, r.owner_id ?? null]));
}

async function auditRows(engine: ObjectQL): Promise<string[]> {
  const rows = await (engine as any).find(AUDIT, { fields: ['record_id'] }, SYS);
  return rows.map((r: any) => String(r.record_id)).sort();
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('[#26825] the seed ownership hand-over yields between bounded batches (real engine, better-sqlite3)', () => {
  it('re-owns at most one batch of rows between two macrotask turns', async () => {
    const { engine, ids, claimed } = await boot();
    let done = false;
    let maxPerTurn = 0;
    let turns = 0;
    const sampler = (async () => {
      let seen = claimed();
      while (!done) {
        await nextTurn();
        turns += 1;
        maxPerTurn = Math.max(maxPerTurn, claimed() - seen);
        seen = claimed();
      }
    })();

    const result = await claimSeedOwnership(engine, ADMIN, { seededRecordIds: seededAre(ids) });
    done = true;
    await sampler;

    expect(result).toEqual([{ object: OBJECT, count: N }]);
    expect(turns, 'no macrotask turn ran while the hand-over ran').toBeGreaterThan(N / HANDOVER_ROWS);
    expect(maxPerTurn).toBeLessThanOrEqual(HANDOVER_ROWS);
  }, 60_000);

  it('serves a read issued during the hand-over before the hand-over ends', async () => {
    const { engine, ids, claimed } = await boot();
    const order: string[] = [];
    let claimedAtRead: number | undefined;
    const claim = claimSeedOwnership(engine, ADMIN, { seededRecordIds: seededAre(ids) })
      .then(() => { order.push('hand-over'); });
    // Issued from a macrotask, as a request arrives: the stand-in for the
    // sign-in's user lookup, on another object of the same engine and driver.
    const read = nextTurn()
      .then(() => (engine as any).find(READ_OBJECT, { where: { email: 'a@example.com' } }, SYS))
      .then((rows: any[]) => {
        expect(rows).toHaveLength(1);
        claimedAtRead = claimed();
        order.push('read');
      });
    await Promise.all([claim, read]);

    expect(order).toEqual(['read', 'hand-over']);
    expect(claimedAtRead).toBeLessThan(N);
  }, 60_000);

  it('hands every seeded row to the admin with one audit row per claimed row', async () => {
    const { engine, ids } = await boot();

    const result = await claimSeedOwnership(engine, ADMIN, { seededRecordIds: seededAre(ids) });

    expect(result).toEqual([{ object: OBJECT, count: N }]);
    const owners = await ownersOf(engine);
    expect([...owners.keys()].sort()).toEqual(ids);
    for (const owner of owners.values()) expect(owner).toBe(ADMIN);
    expect(await auditRows(engine)).toEqual(ids);
  }, 60_000);

  it('a refused batch leaves only its rows unowned, says which, and the next run claims them', async () => {
    const { engine, ids, refuse } = await boot();
    // One row of the third batch: the engine refuses that batch's write whole.
    const refusedBatch = ids.slice(2 * HANDOVER_ROWS, 3 * HANDOVER_ROWS);
    refuse.add(refusedBatch[7]!);
    const warn = vi.fn();

    const first = await claimSeedOwnership(engine, ADMIN, {
      seededRecordIds: seededAre(ids),
      logger: { info: vi.fn(), warn },
    });

    expect(first).toEqual([{ object: OBJECT, count: N - HANDOVER_ROWS }]);
    const owners = await ownersOf(engine);
    for (const id of ids) expect(owners.get(id)).toBe(refusedBatch.includes(id) ? null : ADMIN);
    expect(await auditRows(engine)).toEqual(ids.filter((id) => !refusedBatch.includes(id)));
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0]!;
    expect(message).toContain(`claimSeedOwnership failed for ${OBJECT}; ${HANDOVER_ROWS} of ${N} seeded row(s) stay unowned`);
    expect(meta).toMatchObject({ object: OBJECT, refused: HANDOVER_ROWS, ids: refusedBatch.slice(0, 20) });
    expect(meta.error).toContain(`probe refused ${refusedBatch[7]}`);

    refuse.clear();
    const second = await claimSeedOwnership(engine, ADMIN, { seededRecordIds: seededAre(ids) });

    expect(second).toEqual([{ object: OBJECT, count: HANDOVER_ROWS }]);
    for (const owner of (await ownersOf(engine)).values()) expect(owner).toBe(ADMIN);
    expect(await auditRows(engine)).toEqual(ids);
  }, 60_000);

  it('every batch refused: nothing claimed, and the one warning a refused chunk always gave', async () => {
    const { engine, ids, refuse } = await boot();
    refuse.add('*');
    const warn = vi.fn();

    const result = await claimSeedOwnership(engine, ADMIN, {
      seededRecordIds: seededAre(ids),
      logger: { info: vi.fn(), warn },
    });

    expect(result).toEqual([]);
    for (const owner of (await ownersOf(engine)).values()) expect(owner).toBeNull();
    expect(await auditRows(engine)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0]!;
    expect(message).toBe(
      `[security] claimSeedOwnership failed for ${OBJECT}; those rows stay unowned until the claim next runs — ` +
        'the next seed settle (`app:seeded`, on this boot or a later one) or the next platform-admin promotion',
    );
    expect(meta).toMatchObject({ object: OBJECT, where: { owner_id: null, id: { $in: `${N} id(s)` } } });
    expect(meta.error).toContain('probe refused');
  }, 60_000);
});
