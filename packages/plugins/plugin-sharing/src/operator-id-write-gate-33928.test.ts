// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sharing write gate judges BY ID exactly the writes the engine runs by
 * id, and every other write meets the bulk write scope.
 *
 * The rule, as pinned here:
 *
 *  - the by-id / bulk branch is the engine's own dispatch decision for the
 *    options bag the write carries, over every option shape the gate is
 *    handed (unit table below, against the middleware itself);
 *  - a scalar id the engine writes by id is judged by id, as before;
 *  - a write the engine runs as a predicate (`$in`, `$eq` on `id`) gets the
 *    answer every bulk write has (`buildWriteFilter`, ADR-0111 D3): the rows
 *    the caller may write are written, the others are left as they were, no
 *    error;
 *  - a cascade delete gives the answer the by-id delete of a refused child
 *    gives, the same refusal envelope, and deletes nothing, whatever shape the
 *    engine deletes a parent's children in.
 *
 * Real stack for the door answers: an `ObjectKernel` with `ObjectQLPlugin` over
 * better-sqlite3 and `SharingServicePlugin`, so every answer is the middleware
 * the engine runs.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingServicePlugin, buildSharingMiddleware } from './sharing-plugin.js';

const ORG = 'org_opid';
const ME = 'usr_opid_me';
const OTHER = 'usr_opid_other';

/** The parent of a cascade: open to every member, so its own delete is never the refusal. */
const ORDER = 'qa_opid_order';
/** Owner-scoped (`private` OWD with an `owner_id`): record sharing enforces on it. */
const LINE = 'qa_opid_line';
/** Owner-scoped like LINE, holding only the rows of the `$eq` pin. */
const TAG = 'qa_opid_tag';

const SYSTEM = { isSystem: true, tenantId: ORG } as const;
const SYS = { context: SYSTEM } as never;
const asCaller = () => ({ userId: ME, tenantId: ORG, positions: [] });

type Outcome =
  | { kind: 'landed'; result: unknown }
  | { kind: 'refused'; code?: string; status?: number; details?: unknown };
const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    (result) => ({ kind: 'landed' as const, result }),
    (e: { code?: unknown; status?: unknown; details?: unknown } | null) => ({
      kind: 'refused' as const,
      code: e?.code == null ? undefined : String(e.code),
      status: e?.status == null ? undefined : Number(e.status),
      details: e?.details,
    }),
  );

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

function objectsPlugin(): Plugin {
  return {
    name: 'test.objects',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.operator-id-write-gate',
        namespace: 'qa_opid',
        version: '1.0.0',
        type: 'plugin',
        name: 'Operator id write gate',
        objects: [
          { name: ORDER, label: 'Order', sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } },
          {
            name: TAG,
            label: 'Tag',
            sharingModel: 'private',
            fields: { name: { type: 'text', label: 'Name' }, owner_id: { type: 'text', label: 'Owner' } },
          },
          {
            name: LINE,
            label: 'Line',
            sharingModel: 'private',
            fields: {
              name: { type: 'text', label: 'Name' },
              stage: { type: 'text', label: 'Stage' },
              owner_id: { type: 'text', label: 'Owner' },
              order: { type: 'lookup', reference: ORDER, deleteBehavior: 'cascade', label: 'Order' },
            },
          },
        ],
      });
    },
  };
}

describe('sharing write gate: a write the engine runs as a predicate meets the bulk write scope (real stack)', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as never);
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(new SharingServicePlugin({ registerShareLinkRoutes: false }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  /** The line ids stored under `prefix`, as a system read sees them. */
  const storedLines = async (prefix: string) => {
    const rows = (await ql.find(LINE, { context: SYSTEM } as never)) as Array<{ id: string }>;
    return rows.map((r) => String(r.id)).filter((id) => id.startsWith(prefix)).sort();
  };
  /** Two lines the caller owns and one it does not, under `prefix`. */
  const seedLines = async (prefix: string, order?: string) => {
    await ql.insert(LINE, [
      { id: `${prefix}_mine1`, owner_id: ME, stage: prefix, ...(order ? { order } : {}) },
      { id: `${prefix}_theirs`, owner_id: OTHER, stage: prefix, ...(order ? { order } : {}) },
      { id: `${prefix}_mine2`, owner_id: ME, stage: prefix, ...(order ? { order } : {}) },
    ], SYS);
    return { mine: [`${prefix}_mine1`, `${prefix}_mine2`], theirs: `${prefix}_theirs` };
  };
  const shareToMe = (recordId: string, accessLevel: 'read' | 'edit') =>
    ql.insert('sys_record_share', {
      object_name: LINE, record_id: recordId, recipient_type: 'user', recipient_id: ME,
      access_level: accessLevel, source: 'manual',
    }, SYS);

  describe('by id: unchanged', () => {
    it('a scalar id the caller owns deletes; one it does not is refused 403 FORBIDDEN naming that row, and stays', async () => {
      const { mine, theirs } = await seedLines('b1');

      expect(await outcomeOf(ql.delete(LINE, { where: { id: mine[0] }, context: asCaller() } as never)))
        .toMatchObject({ kind: 'landed' });
      expect(await outcomeOf(ql.delete(LINE, { where: { id: theirs }, context: asCaller() } as never))).toEqual({
        kind: 'refused', code: 'FORBIDDEN', status: 403,
        details: { operation: 'delete', object: LINE, recordId: theirs },
      });
      expect(await storedLines('b1')).toEqual([mine[1], theirs].sort());
    });
  });

  describe("a user's bulk `$in` write keeps the bulk answer (buildWriteFilter): fewer rows, no error", () => {
    it('an `$in` delete naming only rows the caller owns deletes every one of them', async () => {
      const { mine, theirs } = await seedLines('i1');

      const got = await outcomeOf(ql.delete(LINE, { where: { id: { $in: mine } }, multi: true, context: asCaller() } as never));

      expect(got).toMatchObject({ kind: 'landed' });
      expect(await storedLines('i1')).toEqual([theirs]);
    });

    it('an `$in` delete naming owned and not-owned rows deletes the owned ones, answers no error, and leaves the other', async () => {
      const { mine, theirs } = await seedLines('i2');

      const got = await outcomeOf(
        ql.delete(LINE, { where: { id: { $in: [...mine, theirs] } }, multi: true, context: asCaller() } as never),
      );

      expect(got).toMatchObject({ kind: 'landed' });
      expect(await storedLines('i2')).toEqual([theirs]);
    });

    it('an `$in` update over owned, edit-shared and not-shared rows writes the rows the caller may edit, and only those', async () => {
      const { mine, theirs } = await seedLines('i3');
      await ql.insert(LINE, { id: 'i3_shared', owner_id: OTHER, stage: 'i3' }, SYS);
      await shareToMe('i3_shared', 'edit');

      const got = await outcomeOf(ql.update(
        LINE, { stage: 'won' },
        { where: { id: { $in: [...mine, theirs, 'i3_shared'] } }, multi: true, context: asCaller() } as never,
      ));

      expect(got).toMatchObject({ kind: 'landed' });
      const rows = (await ql.find(LINE, { context: SYSTEM } as never)) as Array<{ id: string; stage: string }>;
      const stages = Object.fromEntries(rows.filter((r) => r.id.startsWith('i3')).map((r) => [r.id, r.stage]));
      expect(stages).toEqual({ [mine[0]]: 'won', [mine[1]]: 'won', i3_shared: 'won', [theirs]: 'i3' });
    });
  });

  describe('another predicate on id is scoped per matched row by the same bulk scope', () => {
    it('an `$eq` delete of an owned row deletes it; of a not-owned row answers no error and leaves it', async () => {
      // `$eq` reaches the gate as `where.id` itself; `$nin` / `$ne` do not (the engine lowers them to a
      // null-aware `$and` first), so `$eq` is the other operator shape the gate used to judge by id.
      await ql.insert(TAG, [{ id: 'e1_mine', owner_id: ME }, { id: 'e1_theirs', owner_id: OTHER }], SYS);

      const mine = await outcomeOf(ql.delete(TAG, { where: { id: { $eq: 'e1_mine' } }, multi: true, context: asCaller() } as never));
      const theirs = await outcomeOf(ql.delete(TAG, { where: { id: { $eq: 'e1_theirs' } }, multi: true, context: asCaller() } as never));

      expect(mine).toMatchObject({ kind: 'landed' });
      expect(theirs).toMatchObject({ kind: 'landed' });
      const rows = (await ql.find(TAG, { context: SYSTEM } as never)) as Array<{ id: string }>;
      expect(rows.map((r) => String(r.id)).sort()).toEqual(['e1_theirs']);
    });
  });

  describe('every write the engine runs as a predicate meets the bulk scope at the door', () => {
    const delMany = (where: Record<string, unknown>, context: unknown = asCaller()) =>
      outcomeOf(ql.delete(LINE, { where, multi: true, context } as never));
    const updMany = (where: Record<string, unknown>, data: Record<string, unknown>, context: unknown = asCaller()) =>
      outcomeOf(ql.update(LINE, data, { where, multi: true, context } as never));
    const stageOf = async (id: string) =>
      ((await ql.find(LINE, { where: { id }, context: SYSTEM } as never)) as Array<{ stage?: string }>)[0]?.stage;

    it('a scalar id beside another predicate key writes the row only when the caller may write it', async () => {
      const { mine, theirs } = await seedLines('p1');

      expect(await delMany({ id: theirs, stage: 'p1' })).toMatchObject({ kind: 'landed' });
      expect(await delMany({ id: mine[0], stage: 'p1' })).toMatchObject({ kind: 'landed' });
      expect(await updMany({ id: theirs, stage: 'p1' }, { name: 'written' })).toMatchObject({ kind: 'landed' });
      expect(await updMany({ id: mine[1], stage: 'p1' }, { stage: 'p1_written' })).toMatchObject({ kind: 'landed' });

      expect(await storedLines('p1')).toEqual([mine[1], theirs].sort());
      expect(await stageOf(mine[1])).toBe('p1_written');
      const other = ((await ql.find(LINE, { where: { id: theirs }, context: SYSTEM } as never)) as Array<{ name?: string }>)[0];
      expect(other?.name ?? null).not.toBe('written');
    });

    it('a falsy id: the answer is no error (it names no row, so nothing is written)', async () => {
      const { mine, theirs } = await seedLines('p2');

      expect(await delMany({ id: '' })).toMatchObject({ kind: 'landed' });
      expect(await delMany({ id: 0 })).toMatchObject({ kind: 'landed' });
      expect(await updMany({ id: '' }, { stage: 'p2_written' })).toMatchObject({ kind: 'landed' });
      expect(await updMany({ id: 0 }, { stage: 'p2_written' })).toMatchObject({ kind: 'landed' });
      expect(await updMany({ stage: 'p2_none' }, { id: '', stage: 'p2_written' })).toMatchObject({ kind: 'landed' });

      expect(await storedLines('p2')).toEqual([...mine, theirs].sort());
      for (const id of [...mine, theirs]) expect(await stageOf(id)).toBe('p2');
    });

    it('an empty `$in`: the answer is no error (it matches no row, so nothing is written)', async () => {
      const { mine, theirs } = await seedLines('p3');

      expect(await delMany({ id: { $in: [] } })).toMatchObject({ kind: 'landed' });
      expect(await updMany({ id: { $in: [] } }, { stage: 'p3_written' })).toMatchObject({ kind: 'landed' });

      expect(await storedLines('p3')).toEqual([...mine, theirs].sort());
      for (const id of [...mine, theirs]) expect(await stageOf(id)).toBe('p3');
    });

    it('a read share admits no write: an `$eq` or `$in` update of a read-shared row writes nothing', async () => {
      await ql.insert(LINE, { id: 'p4_read', owner_id: OTHER, stage: 'p4' }, SYS);
      await shareToMe('p4_read', 'read');
      expect(await ql.findOne(LINE, { where: { id: 'p4_read' }, context: asCaller() } as never)).toMatchObject({ id: 'p4_read' });

      expect(await updMany({ id: { $eq: 'p4_read' } }, { stage: 'p4_written' })).toMatchObject({ kind: 'landed' });
      expect(await updMany({ id: { $in: ['p4_read'] } }, { stage: 'p4_written' })).toMatchObject({ kind: 'landed' });

      expect(await stageOf('p4_read')).toBe('p4');
    });

    it('control: an `$eq` update of a row the caller owns writes it', async () => {
      const { mine, theirs } = await seedLines('p7');

      expect(await updMany({ id: { $eq: mine[0] } }, { stage: 'p7_written' })).toMatchObject({ kind: 'landed' });

      expect(await stageOf(mine[0])).toBe('p7_written');
      expect(await stageOf(mine[1])).toBe('p7');
      expect(await stageOf(theirs)).toBe('p7');
    });

    it('a call the engine refuses at dispatch meets the engine refusal the system context gets, not a sharing refusal, and nothing is written', async () => {
      const { mine, theirs } = await seedLines('p6');
      const refusalOf = (p: Promise<unknown>) =>
        p.then(
          () => ({ kind: 'landed' as const }),
          (e: { code?: unknown; status?: unknown; message?: unknown } | null) => ({
            kind: 'refused' as const,
            code: e?.code == null ? undefined : String(e.code),
            status: e?.status == null ? undefined : Number(e.status),
            message: String(e?.message),
          }),
        );
      // A scalar id beside another where key, without `multi`.
      const del = (context: unknown) => refusalOf(ql.delete(LINE, { where: { id: theirs, stage: 'p6' }, context } as never));
      const upd = (context: unknown) =>
        refusalOf(ql.update(LINE, { stage: 'p6_written' }, { where: { id: theirs, stage: 'p6' }, context } as never));
      // A payload id beside a where predicate.
      const updPayload = (context: unknown) =>
        refusalOf(ql.update(LINE, { id: theirs, stage: 'p6_written' }, { where: { stage: 'p6' }, context } as never));

      for (const call of [del, upd, updPayload]) {
        const asSystem = await call(SYSTEM);
        const asMember = await call(asCaller());
        expect(asSystem).toMatchObject({ kind: 'refused' });
        expect(asMember).toEqual(asSystem);
        expect(asMember).not.toMatchObject({ code: 'FORBIDDEN' });
        expect(asMember).not.toMatchObject({ status: 403 });
      }

      expect(await storedLines('p6')).toEqual([...mine, theirs].sort());
      for (const id of [...mine, theirs]) expect(await stageOf(id)).toBe('p6');
    });

    it('control: the system context writes every row the predicate matches', async () => {
      const { mine, theirs } = await seedLines('p5');

      expect(await updMany({ id: { $in: [...mine, theirs] } }, { stage: 'p5_written' }, SYSTEM)).toMatchObject({ kind: 'landed' });
      for (const id of [...mine, theirs]) expect(await stageOf(id)).toBe('p5_written');
      expect(await delMany({ id: theirs, stage: 'p5_written' }, SYSTEM)).toMatchObject({ kind: 'landed' });
      expect(await delMany({ id: { $in: mine } }, SYSTEM)).toMatchObject({ kind: 'landed' });

      expect(await storedLines('p5')).toEqual([]);
    });
  });

  describe('a cascade delete gives the answer the by-id delete of the refused child gives', () => {
    it('a child the caller reads and may edit but not delete: the same refusal envelope, and nothing is deleted', async () => {
      await ql.insert(ORDER, { id: 'c1', name: 'c1' }, SYS);
      const { mine, theirs } = await seedLines('c1', 'c1');
      await shareToMe(theirs, 'edit');
      // The child is on the caller's read door, so the refusal is the delete gate's.
      expect(await ql.findOne(LINE, { where: { id: theirs }, context: asCaller() } as never)).toMatchObject({ id: theirs });
      const own = await outcomeOf(ql.delete(LINE, { where: { id: theirs }, context: asCaller() } as never));
      expect(own).toMatchObject({ kind: 'refused', code: 'FORBIDDEN', status: 403 });

      const got = await outcomeOf(ql.delete(ORDER, { where: { id: 'c1' }, context: asCaller() } as never));

      expect(got).toEqual(own);
      expect(await storedLines('c1')).toEqual([...mine, theirs].sort());
      expect(await ql.find(ORDER, { where: { id: 'c1' }, context: SYSTEM } as never)).toHaveLength(1);
    });

    it('a cascade over children the caller owns deletes the parent and every child', async () => {
      await ql.insert(ORDER, { id: 'c2', name: 'c2' }, SYS);
      await ql.insert(LINE, [
        { id: 'c2_a', owner_id: ME, order: 'c2' },
        { id: 'c2_b', owner_id: ME, order: 'c2' },
      ], SYS);

      expect(await outcomeOf(ql.delete(ORDER, { where: { id: 'c2' }, context: asCaller() } as never)))
        .toMatchObject({ kind: 'landed' });
      expect(await storedLines('c2')).toEqual([]);
    });
  });
});

/**
 * The branch, over every option shape the gate is handed. Each row is the
 * options bag (and payload) of one write and the branch the ENGINE dispatches
 * it to (`by-id` with the row it binds, or `bulk`), written out here rather
 * than computed, so the table is a statement of the rule and not a copy of
 * the code under test.
 */
describe('sharing write gate: the by-id branch is exactly the engine dispatch decision', () => {
  const CALLER = { userId: 'u_member', tenantId: 'org_1' };
  type Branch = { kind: 'by-id'; id: string } | { kind: 'bulk' };
  type Row = readonly [verb: 'update' | 'delete', data: Record<string, unknown> | undefined, options: Record<string, unknown>, branch: Branch];
  const BY = (id: string): Branch => ({ kind: 'by-id', id });
  const BULK: Branch = { kind: 'bulk' };
  const IN = { $in: ['r_1', 'r_2'] };

  const ROWS: readonly Row[] = [
    // where.id scalar: by id, with or without multi.
    ['delete', undefined, { where: { id: 'r_1' } }, BY('r_1')],
    ['delete', undefined, { where: { id: 'r_1' }, multi: true }, BY('r_1')],
    ['update', { stage: 'x' }, { where: { id: 'r_1' } }, BY('r_1')],
    ['update', { stage: 'x' }, { where: { id: 'r_1' }, multi: true }, BY('r_1')],
    // where.id a predicate: bulk, with or without multi.
    ['delete', undefined, { where: { id: IN } }, BULK],
    ['delete', undefined, { where: { id: IN }, multi: true }, BULK],
    ['update', { stage: 'x' }, { where: { id: IN } }, BULK],
    ['update', { stage: 'x' }, { where: { id: IN }, multi: true }, BULK],
    // data.id: the payload id the engine binds for an update.
    ['update', { id: 'r_1', stage: 'x' }, {}, BY('r_1')],
    ['update', { id: 'r_1', stage: 'x' }, { multi: true }, BY('r_1')],
    ['update', { id: IN, stage: 'x' }, { where: { stage: 'open' }, multi: true }, BULK],
    // options.id: no engine dispatch routes on it.
    ['delete', undefined, { id: 'r_1' }, BULK],
    ['delete', undefined, { id: 'r_1', where: { stage: 'open' }, multi: true }, BULK],
    ['update', { stage: 'x' }, { id: 'r_1' }, BULK],
    ['update', { stage: 'x' }, { id: 'r_1', where: { stage: 'open' }, multi: true }, BULK],
    // options.filter.id: no engine dispatch routes on it.
    ['delete', undefined, { filter: { id: 'r_1' } }, BULK],
    ['delete', undefined, { filter: { id: 'r_1' }, where: { stage: 'open' }, multi: true }, BULK],
    ['delete', undefined, { filter: { id: 'r_1' }, where: { id: IN }, multi: true }, BULK],
    ['update', { stage: 'x' }, { filter: { id: 'r_1' }, where: { stage: 'open' }, multi: true }, BULK],
    ['update', { stage: 'x' }, { filter: { id: 'r_1' }, where: { id: IN }, multi: true }, BULK],
    // where.id scalar beside another predicate key under multi: the engine runs a predicate.
    ['delete', undefined, { where: { id: 'r_1', stage: 'open' }, multi: true }, BULK],
    ['update', { stage: 'x' }, { where: { id: 'r_1', stage: 'open' }, multi: true }, BULK],
    // A falsy scalar id names no row for the engine.
    ['delete', undefined, { where: { id: '' }, multi: true }, BULK],
    ['delete', undefined, { where: { id: 0 }, multi: true }, BULK],
    ['update', { stage: 'x' }, { where: { id: '' }, multi: true }, BULK],
    ['update', { id: '', stage: 'x' }, { where: { stage: 'open' }, multi: true }, BULK],
    // Calls the engine refuses at dispatch: no row is written by id.
    ['delete', undefined, { where: { id: 'r_1', stage: 'open' } }, BULK],
    ['update', { stage: 'x' }, { where: { id: 'r_1', stage: 'open' } }, BULK],
    ['update', { id: 'r_1', stage: 'x' }, { where: { stage: 'open' } }, BULK],
    ['update', { id: 'r_1', stage: 'x' }, { where: { stage: 'open' }, multi: true }, BULK],
  ];

  function service() {
    return {
      admitsByIdWrite: vi.fn(async () => true),
      buildWriteFilter: vi.fn(async () => ({ owner_id: 'u_member' })),
    };
  }

  it.each(ROWS)('%s: the gate takes the branch the engine dispatches the write to (row %#)', async (verb, data, options, branch) => {
    const svc = service();
    const mw = buildSharingMiddleware(svc as never, { warn: () => {} } as never) as unknown as (
      ctx: Record<string, unknown>, next: () => Promise<void>,
    ) => Promise<void>;
    const bag = { ...options, context: CALLER };
    const ctx: Record<string, unknown> = { object: 'deal', operation: verb, options: bag, context: CALLER, ...(data ? { data } : {}) };
    let reached = false;

    await mw(ctx, async () => { reached = true; });

    expect(reached).toBe(true);
    if (branch.kind === 'by-id') {
      expect(svc.admitsByIdWrite).toHaveBeenCalledWith('deal', branch.id, verb, CALLER);
      expect(svc.buildWriteFilter).not.toHaveBeenCalled();
    } else {
      expect(svc.admitsByIdWrite).not.toHaveBeenCalled();
      expect(svc.buildWriteFilter).toHaveBeenCalledWith('deal', CALLER, verb);
      expect(JSON.stringify((ctx.ast as { where?: unknown } | undefined)?.where)).toContain('"owner_id":"u_member"');
    }
  });
});
