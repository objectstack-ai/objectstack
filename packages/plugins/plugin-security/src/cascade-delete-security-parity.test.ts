// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Security parity for a cascade delete, whatever SHAPE the engine deletes a
 * parent's dependents in: one by-id `delete()` per child (the path this suite
 * was written against), or one predicate `delete()` per batch of children
 * (ruling 6893661036, option F1: every child's before-hooks, one set delete,
 * then the after-hooks). The four invariants, from ruling 6893104201 point
 * (2) and the preconditions of ruling 6893661036:
 *
 *  1. **A refused child refuses the whole cascade.** A child the caller may
 *     not delete (one it cannot read, and one it reads and may edit but may
 *     not delete) makes the parent's delete answer the refusal it answers
 *     today, and no row is deleted: not the parent, not a sibling the caller
 *     owns, not a child of another relation.
 *  2. **Never fewer rows.** A cascade either deletes every child it probed or
 *     none: a refused child never shrinks the set to the rows the caller's
 *     scope admits, and a cascade the caller may complete leaves no probed
 *     child behind.
 *  3. **Never more rows.** The cascade deletes the children it probed and
 *     nothing else: a row of the same object under another parent, or under
 *     none, stays, and so does a child written AFTER the probe (here by a
 *     sibling's own `beforeDelete`), which a predicate-shaped scope
 *     (`DELETE ... WHERE fk = ?`) would reach and an id-shaped one does not.
 *  4. **Each child's delete-side work runs once per child.** The audit ledger
 *     records one delete per child, every record share on a child is revoked
 *     (plugin-sharing's cleanup), and an object-less `beforeDelete` /
 *     `afterDelete` pair (the registration shape of service-storage's
 *     file-reference release) sees each child exactly once in each phase,
 *     including a child two relations reach. Counts, never interleaving: under
 *     F1 the before-hooks of a batch all run before its after-hooks.
 *
 * Everything is observed from outside the engine: rows left in the store,
 * ledger rows, share rows, and what a registered hook was handed. No engine
 * internal is named, so the pins hold across a rewrite of the cascade walk.
 *
 * Real stack: an `ObjectKernel` with `ObjectQLPlugin` over better-sqlite3,
 * the real `AuditPlugin`, `SecurityPlugin` and `SharingServicePlugin`. The
 * caller is a member holding one permission set that grants full CRUD on the
 * three objects, so every refusal below is row-level: record sharing's
 * delete gate, never an object permission.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const ORG = 'org_ccp';
const ME = 'usr_ccp_me';
const OTHER = 'usr_ccp_other';

/** The parent: open to every member, so its own delete is never the refusal. */
const ORDER = 'qa_ccp_order';
/** A record-shared child, owner-scoped (`private`), reached by two cascading lookups. */
const LINE = 'qa_ccp_line';
/** A `controlled_by_parent` child (ADR-0055): its write authority is the order's. */
const NOTE = 'qa_ccp_note';
const FIXTURE_OBJECTS: readonly string[] = [ORDER, LINE, NOTE];

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } as const;
const WRITER = PermissionSetSchema.parse({
  name: 'qa_ccp_writer',
  objects: { [ORDER]: CRUD, [LINE]: CRUD, [NOTE]: CRUD },
});

const SYSTEM = { isSystem: true, tenantId: ORG } as const;
const SYS = { context: SYSTEM } as never;
const asCaller = () => ({ userId: ME, tenantId: ORG, positions: [], permissions: [WRITER.name] });

type Outcome = { kind: 'landed' } | { kind: 'refused'; code?: string; status?: number; message: string };
const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    () => ({ kind: 'landed' as const }),
    (e: { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown } | null) => {
      const status = e?.statusCode ?? e?.status;
      return {
        kind: 'refused' as const,
        code: e?.code == null ? undefined : String(e.code),
        status: status == null ? undefined : Number(status),
        message: String(e?.message),
      };
    },
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
        id: 'test.cascade-delete-security-parity',
        namespace: 'qa_ccp',
        version: '1.0.0',
        type: 'plugin',
        name: 'Cascade delete security parity',
        objects: [
          SysUser, SysMember, SysOrganization,
          { name: ORDER, label: 'Order', sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } },
          {
            name: LINE,
            label: 'Line',
            sharingModel: 'private',
            fields: {
              name: { type: 'text', label: 'Name' },
              owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
              order: { type: 'lookup', reference: ORDER, deleteBehavior: 'cascade', label: 'Order' },
              alt_order: { type: 'lookup', reference: ORDER, deleteBehavior: 'cascade', label: 'Alternate order' },
            },
          },
          {
            name: NOTE,
            label: 'Note',
            sharingModel: 'controlled_by_parent',
            fields: {
              name: { type: 'text', label: 'Name' },
              order: { type: 'master_detail', reference: ORDER, required: true, deleteBehavior: 'cascade', label: 'Order' },
            },
          },
        ],
      });
    },
  };
}

interface Seen { phase: 'before' | 'after'; object: string; id: string }
interface HookCtx { object?: string; input?: { id?: unknown }; previous?: { order?: unknown } }

describe('cascade delete: security parity between id-shaped and predicate-shaped child deletes', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  /** Every delete dispatch on a fixture object, as an object-less hook pair sees it. */
  const seen: Seen[] = [];
  /** Armed with a line id: that line's `beforeDelete` writes a new sibling under the same order. */
  let spawnFrom: string | undefined;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as never);
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.use(new SecurityPlugin({
      defaultPermissionSets: [...defaultPermissionSets, WRITER],
      fallbackPermissionSet: 'member_default',
    }));
    await kernel.use(new SharingServicePlugin({ registerShareLinkRoutes: false }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');

    await ql.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme' }, SYS);
    for (const userId of [ME, OTHER]) {
      await ql.insert('sys_user', { id: userId, name: userId, email: `${userId}@acme.test`, email_verified: true }, SYS);
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role: 'member' }, SYS);
    }

    // Object-less, as service-storage registers its file-reference release:
    // dispatched for every object, filtered here to the fixture's.
    const record = (phase: Seen['phase']) => async (hookCtx: HookCtx) => {
      const object = String(hookCtx?.object);
      if (!FIXTURE_OBJECTS.includes(object)) return;
      seen.push({ phase, object, id: String(hookCtx?.input?.id) });
    };
    ql.registerHook('beforeDelete', record('before') as never, { packageId: 'qa.cascade-parity.object-less' } as never);
    ql.registerHook('afterDelete', record('after') as never, { packageId: 'qa.cascade-parity.object-less' } as never);
    // A child written during the cascade, after the walk probed the order's lines.
    const spawn = async (hookCtx: HookCtx) => {
      const id = String(hookCtx?.input?.id);
      if (spawnFrom === undefined || id !== spawnFrom) return;
      spawnFrom = undefined;
      await ql.insert(LINE, { id: `${id}_written_after_probe`, owner_id: ME, order: hookCtx?.previous?.order }, SYS);
    };
    ql.registerHook('beforeDelete', spawn as never, { object: LINE, packageId: 'qa.cascade-parity.spawn' } as never);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  /** The ids stored under `prefix`, per fixture object, as a system read sees them. */
  const stored = async (prefix: string) => {
    const out: Record<string, string[]> = {};
    for (const object of FIXTURE_OBJECTS) {
      const rows = (await ql.find(object, { context: SYSTEM } as never)) as Array<{ id: string }>;
      out[object] = rows.map((r) => String(r.id)).filter((id) => id.startsWith(prefix)).sort();
    }
    return out;
  };
  /**
   * The record ids the audit ledger holds a `delete` row for, under `prefix`,
   * on the fixture objects only. Every fixture id is written by this file; the
   * ledger also holds the `delete` rows of revoked record shares, whose ids are
   * generated (16 characters from an alphabet that has `_`), so a prefix
   * alone would match one of them by chance.
   */
  const auditedDeletes = async (prefix: string) => {
    const rows = (await ql.find('sys_audit_log', { where: { action: 'delete' }, context: SYSTEM } as never)) as
      Array<{ object_name?: string; record_id?: string }>;
    return rows
      .filter((r) => FIXTURE_OBJECTS.includes(String(r.object_name)))
      .map((r) => String(r.record_id))
      .filter((id) => id.startsWith(prefix))
      .sort();
  };
  /** The record ids still carrying a record share, under `prefix`. */
  const sharedRecords = async (prefix: string) => {
    const rows = (await ql.find('sys_record_share', { context: SYSTEM } as never)) as Array<{ record_id?: string }>;
    return rows.map((r) => String(r.record_id)).filter((id) => id.startsWith(prefix)).sort();
  };
  const share = (recordId: string, recipient: string, accessLevel: 'read' | 'edit') =>
    ql.insert('sys_record_share', {
      object_name: LINE, record_id: recordId, recipient_type: 'user', recipient_id: recipient,
      access_level: accessLevel, source: 'manual',
    }, SYS);
  const deleteOrder = (id: string) => outcomeOf(ql.delete(ORDER, { where: { id }, context: asCaller() } as never));

  /**
   * One order with three lines and a note. The middle line is the caller's
   * own unless `refused` names how it is not deletable: owned by someone
   * else and not shared (unreadable), or owned by someone else and shared to
   * the caller at `edit` (read and update, never delete: ADR-0111 D3).
   */
  const seedOrder = async (prefix: string, refused?: 'unreadable' | 'edit-shared') => {
    await ql.insert(ORDER, { id: prefix, name: prefix }, SYS);
    await ql.insert(LINE, [
      { id: `${prefix}_a`, owner_id: ME, order: prefix },
      { id: `${prefix}_b`, owner_id: refused ? OTHER : ME, order: prefix },
      { id: `${prefix}_c`, owner_id: ME, order: prefix },
    ], SYS);
    await ql.insert(NOTE, { id: `${prefix}_n`, order: prefix }, SYS);
    if (refused === 'edit-shared') await share(`${prefix}_b`, ME, 'edit');
    return {
      [ORDER]: [prefix],
      [LINE]: [`${prefix}_a`, `${prefix}_b`, `${prefix}_c`],
      [NOTE]: [`${prefix}_n`],
    } as Record<string, string[]>;
  };

  describe('1. a child the caller may not delete refuses the whole cascade, with today\'s refusal, and deletes nothing', () => {
    it('a child the caller cannot read: 403 FORBIDDEN, and the order, every line and the note stay', async () => {
      const all = await seedOrder('r1', 'unreadable');
      // The precondition, off the read door: the caller does not see it.
      expect(await ql.findOne(LINE, { where: { id: 'r1_b' }, context: asCaller() } as never)).toBeNull();

      const got = await deleteOrder('r1');

      expect(got).toMatchObject({ kind: 'refused', code: 'FORBIDDEN', status: 403 });
      // The refusal names no row the caller was never shown.
      expect(got.kind === 'refused' && got.message).not.toContain('r1_b');
      expect(await stored('r1')).toEqual(all);
      expect(await auditedDeletes('r1'), 'a rolled-back delete leaves no ledger row').toEqual([]);
    });

    it('a child the caller reads and may edit but not delete: the refusal its own delete of that child gets, and nothing is deleted', async () => {
      const all = await seedOrder('r2', 'edit-shared');
      expect(await ql.findOne(LINE, { where: { id: 'r2_b' }, context: asCaller() } as never)).toMatchObject({ id: 'r2_b' });
      // Today's refusal, measured off the caller's own by-id delete of that child.
      const own = await outcomeOf(ql.delete(LINE, { where: { id: 'r2_b' }, context: asCaller() } as never));
      expect(own).toMatchObject({ kind: 'refused', code: 'FORBIDDEN', status: 403 });

      const got = await deleteOrder('r2');

      expect(got).toEqual(own);
      expect(await stored('r2')).toEqual(all);
      expect(await sharedRecords('r2'), 'the share outlives the refused delete').toEqual(['r2_b']);
      expect(await auditedDeletes('r2')).toEqual([]);
    });
  });

  describe('2. never fewer rows: a cascade deletes every child it probed, or none', () => {
    for (const refused of ['unreadable', 'edit-shared'] as const) {
      it(`a refused child (${refused}) never shrinks the cascade to the rows the caller's scope admits`, async () => {
        const prefix = `f_${refused === 'unreadable' ? 'u' : 'e'}`;
        await seedOrder(prefix, refused);
        // The rows a narrowed delete would take: everything the caller may delete.
        const deletable = [`${prefix}_a`, `${prefix}_c`];

        expect(await deleteOrder(prefix)).toMatchObject({ kind: 'refused', status: 403 });

        const left = await stored(prefix);
        expect(left[ORDER]).toEqual([prefix]);
        expect(left[LINE]).toEqual(expect.arrayContaining(deletable));
        expect(left[LINE]).toHaveLength(3);
        expect(left[NOTE]).toEqual([`${prefix}_n`]);
      });
    }

    it('a cascade the caller may complete leaves none of the children its probe found', async () => {
      const prefix = 'f_all';
      await ql.insert(ORDER, { id: prefix }, SYS);
      const lines = Array.from({ length: 12 }, (_, i) => ({ id: `${prefix}_l${String(i).padStart(2, '0')}`, owner_id: ME, order: prefix }));
      await ql.insert(LINE, lines, SYS);
      await ql.insert(NOTE, [{ id: `${prefix}_n1`, order: prefix }, { id: `${prefix}_n2`, order: prefix }], SYS);
      const before = await stored(prefix);
      expect(before[LINE]).toHaveLength(12);

      expect(await deleteOrder(prefix)).toEqual({ kind: 'landed' });

      expect(await stored(prefix)).toEqual({ [ORDER]: [], [LINE]: [], [NOTE]: [] });
      expect(await auditedDeletes(prefix)).toEqual([...before[ORDER], ...before[LINE], ...before[NOTE]].sort());
    });
  });

  describe('3. never more rows: the cascade deletes the children it probed and nothing else', () => {
    it('rows of the child objects under another order, or under none, stay', async () => {
      const prefix = 'm1';
      await ql.insert(ORDER, [{ id: prefix }, { id: `${prefix}_other` }], SYS);
      await ql.insert(LINE, [
        { id: `${prefix}_mine`, owner_id: ME, order: prefix },
        { id: `${prefix}_other_line`, owner_id: ME, order: `${prefix}_other` },
        { id: `${prefix}_orphan_line`, owner_id: ME },
      ], SYS);
      await ql.insert(NOTE, [{ id: `${prefix}_note`, order: prefix }, { id: `${prefix}_other_note`, order: `${prefix}_other` }], SYS);

      expect(await deleteOrder(prefix)).toEqual({ kind: 'landed' });

      expect(await stored(prefix)).toEqual({
        [ORDER]: [`${prefix}_other`],
        [LINE]: [`${prefix}_orphan_line`, `${prefix}_other_line`],
        [NOTE]: [`${prefix}_other_note`],
      });
    });

    it('a child written after the probe (by a sibling\'s beforeDelete) is not deleted by this cascade', async () => {
      const prefix = 'm2';
      await ql.insert(ORDER, { id: prefix }, SYS);
      await ql.insert(LINE, [{ id: `${prefix}_a`, owner_id: ME, order: prefix }, { id: `${prefix}_b`, owner_id: ME, order: prefix }], SYS);
      spawnFrom = `${prefix}_a`;

      try {
        expect(await deleteOrder(prefix)).toEqual({ kind: 'landed' });
      } finally {
        spawnFrom = undefined;
      }

      // The hook ran (its row exists), and the cascade deleted only what it probed.
      expect(await stored(prefix)).toEqual({ [ORDER]: [], [LINE]: [`${prefix}_a_written_after_probe`], [NOTE]: [] });
    });
  });

  describe('4. each child\'s delete-side work runs once per child', () => {
    it('one audit delete row, every share revoked, and each object-less hook phase once, per child, a child two relations reach included', async () => {
      const prefix = 'h1';
      await ql.insert(ORDER, { id: prefix }, SYS);
      await ql.insert(LINE, [
        { id: `${prefix}_by_order`, owner_id: ME, order: prefix },
        { id: `${prefix}_by_both`, owner_id: ME, order: prefix, alt_order: prefix },
        { id: `${prefix}_by_alt`, owner_id: ME, alt_order: prefix },
      ], SYS);
      await ql.insert(NOTE, [{ id: `${prefix}_n1`, order: prefix }, { id: `${prefix}_n2`, order: prefix }], SYS);
      const lines = [`${prefix}_by_alt`, `${prefix}_by_both`, `${prefix}_by_order`];
      const children = [...lines, `${prefix}_n1`, `${prefix}_n2`];
      for (const id of lines) await share(id, OTHER, 'read');
      expect(await sharedRecords(prefix)).toEqual(lines);
      seen.length = 0;

      expect(await deleteOrder(prefix)).toEqual({ kind: 'landed' });

      const count = (phase: Seen['phase']) => {
        const byId: Record<string, number> = {};
        for (const s of seen) if (s.phase === phase && s.id.startsWith(prefix)) byId[s.id] = (byId[s.id] ?? 0) + 1;
        return byId;
      };
      const once = Object.fromEntries([prefix, ...children].map((id) => [id, 1]));
      // One object, so a failure shows every face at once.
      expect({
        objectLessBefore: count('before'),
        objectLessAfter: count('after'),
        auditedDeletes: await auditedDeletes(prefix),
        sharesLeft: await sharedRecords(prefix),
        stored: await stored(prefix),
      }).toEqual({
        objectLessBefore: once,
        objectLessAfter: once,
        auditedDeletes: [prefix, ...children].sort(),
        sharesLeft: [],
        stored: { [ORDER]: [], [LINE]: [], [NOTE]: [] },
      });
    });
  });
});
