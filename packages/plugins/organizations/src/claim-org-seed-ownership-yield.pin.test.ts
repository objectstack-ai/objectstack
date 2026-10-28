// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26825] The organization seed ownership claim yields to the event loop
 * between bounded batches — measured on a REAL `ObjectQL` over a real
 * `SqliteWasmDriver`, a synchronous driver: every `await` of a claim write
 * resolves as a microtask there, so one chunk's write used to run its whole
 * per-row fan-out (code hooks, an audit row per row) as one unbroken chain.
 * Its single-tenant twin was measured stalling the event loop 2.7 s on a
 * 1 500-row seed (`claim-seed-ownership-yield.pin.test.ts`, plugin-security).
 *
 *  1. **the yield** — at most one batch of rows is re-owned between two
 *     macrotask turns, and a read issued meanwhile completes before the claim;
 *  2. **the result** — every seeded row of the organization is owned by its
 *     owner, with one audit row per claimed row, and no other row is touched;
 *  3. **a batch refused** — the other batches stay claimed, one warning names
 *     the rows left owner-less and the first refusal, and the next run claims
 *     them;
 *  4. **every batch refused** — nothing is claimed, and the one warning is the
 *     one a refused chunk always gave.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { claimOrgSeedOwnership } from './claim-org-seed-ownership.js';

const SYS = { context: { isSystem: true } } as const;
const ORG = 'org_alpha';
const OTHER_ORG = 'org_north';
const OWNER = 'usr_org_owner';
const OBJECT = 'probe_deal';
const AUDIT = 'probe_audit';
/** The claim's hand-over batch (`CLAIM_HANDOVER_ROWS`, module-private). */
const HANDOVER_ROWS = 50;
/** Seeded rows: six batches, and one partial batch at the end. */
const N = 6 * HANDOVER_ROWS + 20;

const OBJECTS = [
  {
    name: OBJECT,
    label: 'Probe Deal',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      owner_id: { name: 'owner_id', type: 'text' },
      organization_id: { name: 'organization_id', type: 'text' },
    },
  },
  {
    name: AUDIT,
    label: 'Probe Audit',
    fields: {
      record_id: { name: 'record_id', type: 'text' },
      organization_id: { name: 'organization_id', type: 'text' },
    },
  },
];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** The organization's seed replay reported landing on these rows. */
const seededAre = (ids: string[]) => (object: string): readonly string[] => (object === OBJECT ? ids : []);

/**
 * A booted engine with `N` owner-less seeded deals in `ORG`, one owner-less
 * deal in another organization, and a code-registered `afterUpdate` hook
 * writing one audit row per updated deal. `refuse` names the deals a
 * code-registered `beforeUpdate` hook refuses (`*` refuses every one).
 */
async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' } as never) as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.org-claim-yield-26825',
    name: 'Organization claim yield',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const ids = Array.from({ length: N }, (_, i) => `d${String(i).padStart(4, '0')}`);
  const driver = (engine as any).getDriverForObject(OBJECT);
  await driver.bulkCreate(OBJECT, [
    ...ids.map((id) => ({ id, name: `Deal ${id}`, owner_id: null, organization_id: ORG })),
    { id: 'foreign', name: 'Foreign', owner_id: null, organization_id: OTHER_ORG },
  ]);

  const refuse = new Set<string>();
  let claimedRows = 0;
  engine.registerHook('beforeUpdate', async (ctx: any) => {
    const id = String(ctx?.input?.id ?? '');
    if (refuse.has(id) || refuse.has('*')) throw new Error(`probe refused ${id}`);
  }, { object: OBJECT, packageId: 'probe.refuse' });
  engine.registerHook('afterUpdate', async (ctx: any) => {
    claimedRows += 1;
    await (engine as any).insert(AUDIT, { record_id: String(ctx?.input?.id ?? ''), organization_id: ORG }, SYS);
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

describe('[#26825] the organization seed ownership claim yields between bounded batches (real engine, sqlite-wasm)', () => {
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

    const result = await claimOrgSeedOwnership(engine as never, ORG, OWNER, { seededRecordIds: seededAre(ids) });
    done = true;
    await sampler;

    expect(result).toEqual([{ object: OBJECT, count: N }]);
    expect(turns, 'no macrotask turn ran while the claim ran').toBeGreaterThan(N / HANDOVER_ROWS);
    expect(maxPerTurn).toBeLessThanOrEqual(HANDOVER_ROWS);
  }, 60_000);

  it('serves a read issued during the claim before the claim ends', async () => {
    const { engine, ids, claimed } = await boot();
    const order: string[] = [];
    let claimedAtRead: number | undefined;
    const claim = claimOrgSeedOwnership(engine as never, ORG, OWNER, { seededRecordIds: seededAre(ids) })
      .then(() => { order.push('claim'); });
    const read = nextTurn()
      .then(() => (engine as any).find(OBJECT, { where: { id: 'foreign' } }, SYS))
      .then((rows: any[]) => {
        expect(rows).toHaveLength(1);
        claimedAtRead = claimed();
        order.push('read');
      });
    await Promise.all([claim, read]);

    expect(order).toEqual(['read', 'claim']);
    expect(claimedAtRead).toBeLessThan(N);
  }, 60_000);

  it('hands every seeded row to the owner with one audit row per claimed row, and no other row', async () => {
    const { engine, ids } = await boot();

    const result = await claimOrgSeedOwnership(engine as never, ORG, OWNER, { seededRecordIds: seededAre(ids) });

    expect(result).toEqual([{ object: OBJECT, count: N }]);
    const owners = await ownersOf(engine);
    for (const id of ids) expect(owners.get(id)).toBe(OWNER);
    expect(owners.get('foreign')).toBeNull();
    expect(await auditRows(engine)).toEqual(ids);
  }, 60_000);

  it('a refused batch leaves only its rows owner-less, says which, and the next run claims them', async () => {
    const { engine, ids, refuse } = await boot();
    const refusedBatch = ids.slice(2 * HANDOVER_ROWS, 3 * HANDOVER_ROWS);
    refuse.add(refusedBatch[7]!);
    const warn = vi.fn();

    const first = await claimOrgSeedOwnership(engine as never, ORG, OWNER, {
      seededRecordIds: seededAre(ids),
      logger: { info: vi.fn(), warn },
    });

    expect(first).toEqual([{ object: OBJECT, count: N - HANDOVER_ROWS }]);
    const owners = await ownersOf(engine);
    for (const id of ids) expect(owners.get(id)).toBe(refusedBatch.includes(id) ? null : OWNER);
    expect(await auditRows(engine)).toEqual(ids.filter((id) => !refusedBatch.includes(id)));
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0]!;
    expect(message).toBe(
      `[org-scoping] claimOrgSeedOwnership failed for ${OBJECT} in org ${ORG}: ` +
        `${HANDOVER_ROWS} of the ${N} seeded row(s) of this chunk stay owner-less`,
    );
    expect(meta).toMatchObject({ object: OBJECT, organizationId: ORG, ids: N, refused: HANDOVER_ROWS, refusedIds: refusedBatch.slice(0, 20) });
    expect(meta.error).toContain(`probe refused ${refusedBatch[7]}`);

    refuse.clear();
    const second = await claimOrgSeedOwnership(engine as never, ORG, OWNER, { seededRecordIds: seededAre(ids) });

    expect(second).toEqual([{ object: OBJECT, count: HANDOVER_ROWS }]);
    for (const id of ids) expect((await ownersOf(engine)).get(id)).toBe(OWNER);
    expect(await auditRows(engine)).toEqual(ids);
  }, 60_000);

  it('every batch refused: nothing claimed, and the one warning a refused chunk always gave', async () => {
    const { engine, ids, refuse } = await boot();
    refuse.add('*');
    const warn = vi.fn();

    const result = await claimOrgSeedOwnership(engine as never, ORG, OWNER, {
      seededRecordIds: seededAre(ids),
      logger: { info: vi.fn(), warn },
    });

    expect(result).toEqual([]);
    for (const owner of (await ownersOf(engine)).values()) expect(owner).toBeNull();
    expect(await auditRows(engine)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0]!;
    expect(message).toBe(
      `[org-scoping] claimOrgSeedOwnership failed for ${OBJECT} in org ${ORG}: ` +
        `the ${N} seeded row(s) of this write stay owner-less`,
    );
    expect(meta).toEqual({ object: OBJECT, organizationId: ORG, ids: N, error: expect.stringContaining('probe refused') });
  }, 60_000);
});
