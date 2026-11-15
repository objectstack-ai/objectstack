// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sharing write gate on a write whose `where.id` is an OPERATOR object
 * (`{ $in: [...] }`, `{ $nin: [...] }`), not a row id.
 *
 * The gate used to stringify any `where.id` into the row it judged by id, so
 * `{ $in: ['row_1'] }` was judged as the row "[object Object]", which no caller
 * owns: a member's multi-row delete of rows it owns answered 403 FORBIDDEN and
 * deleted nothing. Only a scalar id names a row now (the engine's own dispatch
 * rule); any other value is a predicate, and takes the bulk branch:
 * `SharingService.buildWriteFilter` ANDed into the predicate.
 *
 * What each door answers, pinned here:
 *
 *  - a user's bulk write over rows it owns and rows it does not keeps the
 *    answer every bulk write has (`buildWriteFilter`, ADR-0111 D3): fewer
 *    rows, no error. The rows it may not write are left as they were;
 *  - a cascade delete gives the answer the by-id delete of the refused child
 *    gives, the same refusal envelope, and deletes nothing. The gate does not
 *    tell a cascade from a user's bulk write: whatever shape the engine deletes
 *    a parent's children in, the child it may not delete refuses as by id;
 *  - another operator shape (`$nin`) is scoped per matched row by the same
 *    filter, never judged as a by-id string;
 *  - a scalar id is judged by id exactly as before.
 *
 * Real stack: an `ObjectKernel` with `ObjectQLPlugin` over better-sqlite3 and
 * `SharingServicePlugin`, so every answer is the middleware the engine runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingServicePlugin } from './sharing-plugin.js';

const ORG = 'org_opid';
const ME = 'usr_opid_me';
const OTHER = 'usr_opid_other';

/** The parent of a cascade: open to every member, so its own delete is never the refusal. */
const ORDER = 'qa_opid_order';
/** Owner-scoped (`private` OWD with an `owner_id`): record sharing enforces on it. */
const LINE = 'qa_opid_line';
/** Owner-scoped like LINE, holding only the rows of the `$nin` pin, whose predicate names no other key. */
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

describe('sharing write gate: an operator-valued id is a predicate write, never the row "[object Object]"', () => {
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

  describe('another operator shape is scoped per matched row, never judged as a by-id string', () => {
    it('a `$nin` delete deletes only the matched rows the caller owns, and answers no error', async () => {
      // The whole predicate is `where.id`, as in the `$in` pins: the shape the gate used to judge by id.
      await ql.insert(TAG, [
        { id: 'n1_mine1', owner_id: ME },
        { id: 'n1_mine2', owner_id: ME },
        { id: 'n1_theirs', owner_id: OTHER },
        { id: 'n1_kept', owner_id: ME },
      ], SYS);

      const got = await outcomeOf(ql.delete(TAG, { where: { id: { $nin: ['n1_kept'] } }, multi: true, context: asCaller() } as never));

      expect(got).toMatchObject({ kind: 'landed' });
      const rows = (await ql.find(TAG, { context: SYSTEM } as never)) as Array<{ id: string }>;
      expect(rows.map((r) => String(r.id)).sort()).toEqual(['n1_kept', 'n1_theirs']);
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
