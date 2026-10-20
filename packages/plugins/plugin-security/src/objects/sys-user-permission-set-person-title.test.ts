// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_permission_set`'s record title names the PERSON a set is granted
 * to, not the raw user id.
 *
 * Setup's list of a user's permission sets, and the assignment's record page,
 * read the title the object declares (`nameField: 'display_title'`). That
 * formula used to compose the stored foreign key, `record.user_id + ' → ' +
 * record.permission_set`, so every row and every H1 read like
 * `ISu3jHPIrdgD45L1rrC2FuE7DIcsk2ap → qa_fls_rep`. It now reads the user's
 * `name` — their `email` where the name is blank — ONE hop through
 * `user_id`, the traversal the formula read path serves (ADR-0079 addendum,
 * 2026-10-18). No column is stored for it.
 *
 * Through the real engine, the real `sys_user` and the real assignment
 * definition, this file asserts:
 *
 *  1. the registered body points at `display_title`, a text formula that reads
 *     `user_id` only through the hop, and only columns `sys_user` declares;
 *  2. the title a read serves names the person — on the write's response, on
 *     `findOne`, on a `find` whose projection names only the title — and the
 *     server's title accessors answer the same text;
 *  3. a user whose stored name is blank is titled by their email, the
 *     declared fallback;
 *  4. this is a permission-assignment table, so the property the hop must not
 *     break: it is read as the READER. A user the reader may not read leaves
 *     the title null, and neither the name nor the email reaches the row;
 *     SYSTEM reads the name. A user that no longer exists leaves it null too;
 *  5. a row missing a title column is refused by the write path;
 *  6. the formula adds no stored column and no search companion column.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ObjectQL,
  SEARCH_COMPANION_FIELD,
  provisionSearchCompanion,
  resolveSearchCompanionSources,
  servedRecordTitle,
} from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser } from '@objectstack/platform-objects';
import { resolveDisplayField, resolveRecordDisplayName } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SysUserPermissionSet } from './sys-user-permission-set.object.js';

const SYS = { context: { isSystem: true } } as any;
const OBJECT = 'sys_user_permission_set';

/** A reader who is not SYSTEM: the shape every request's context has. */
const READER: ExecutionContext = { userId: 'usr_reader', tenantId: 'org_1' };

/** Every `record.<path>` the `display_title` expression reads, as written. */
function formulaReads(): string[] {
  const source = (SysUserPermissionSet as any).fields.display_title?.expression?.source;
  if (typeof source !== 'string') throw new Error('display_title carries no expression source');
  return [...new Set([...source.matchAll(/record\.([A-Za-z_][A-Za-z0-9_.]*)/g)].map((m) => m[1]))].sort();
}

describe('sys_user_permission_set is titled by the person, not the raw user id', () => {
  let engine: ObjectQL;
  let driver: SqlDriver;
  /** Ids of `sys_user` rows a reader that is not SYSTEM may read. */
  const readable = new Set<string>();

  const user = async (name: string, email: string): Promise<string> => {
    const row = await engine.insert('sys_user', { name, email }, SYS);
    return String(row.id);
  };
  const grant = async (userId: string, permissionSet = 'crm_edit') =>
    engine.insert(OBJECT, { user_id: userId, permission_set: permissionSet }, SYS);

  beforeAll(async () => {
    engine = new ObjectQL();
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(SysUser as any, 'com.objectstack.test.person-title');
    engine.registry.registerObject(SysUserPermissionSet as any, 'com.objectstack.test.person-title');
    await engine.syncSchemas();
    // Row-level security on `sys_user` for a reader that is not SYSTEM — the
    // composition the security plugin makes (its own row scope is "own row or
    // an organization member"; here, the ids in `readable`).
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      if (ctx.object === 'sys_user' && ['find', 'findOne'].includes(ctx.operation) && !ctx.context?.isSystem) {
        const scoped = { id: { $in: [...readable] } };
        ctx.ast = { ...(ctx.ast ?? {}), where: ctx.ast?.where ? { $and: [ctx.ast.where, scoped] } : scoped };
      }
      await next();
    });
  });

  beforeEach(() => readable.clear());

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the registered body points at display_title, a text formula reading user_id only through the hop', () => {
    const registered = engine.registry.getObject(OBJECT) as any;
    expect(registered.nameField).toBe('display_title');
    expect(registered.displayNameField).toBe('display_title');
    expect(resolveDisplayField(registered)).toBe('display_title');
    expect(registered.fields.display_title?.type).toBe('formula');
    expect(registered.fields.display_title?.returnType).toBe('text');
    // `user_id` itself is never read bare: a bare read beside a traversal is
    // the `traversal-bare-and-traversed` refusal.
    expect(formulaReads()).toEqual(['permission_set', 'user_id.email', 'user_id.name']);
    const userFields = (engine.registry.getObject('sys_user') as any).fields;
    for (const column of ['name', 'email']) expect(userFields[column], column).toBeDefined();
  });

  it('a read serves the person\'s name — on the write response, findOne and a projected find', async () => {
    const alice = await user('Alice Liddell', 'alice@example.com');
    const created = await grant(alice);
    expect(created.display_title).toBe('Alice Liddell → crm_edit');

    const registered = engine.registry.getObject(OBJECT) as any;
    const row = await engine.findOne(OBJECT, { where: { id: created.id } }, SYS);
    expect(row!.display_title).toBe('Alice Liddell → crm_edit');
    expect(row!.display_title).not.toContain(alice);
    // The row still holds the foreign KEY; only the title reads through it.
    expect(row!.user_id).toBe(alice);
    expect(resolveRecordDisplayName(registered, row)).toBe('Alice Liddell → crm_edit');
    expect(servedRecordTitle(registered, row)).toBe('Alice Liddell → crm_edit');

    // The list's title column: a projection naming only the title.
    const listed = await engine.find(OBJECT, { where: { id: created.id }, fields: ['display_title'] }, SYS);
    expect(listed).toEqual([{ display_title: 'Alice Liddell → crm_edit' }]);
  });

  it('a user whose stored name is blank is titled by their email — the declared fallback', async () => {
    // The write door refuses a blank `name` (it is required), so a nameless
    // user is a row written past it: an import, or a row older than the rule.
    const empty = await user('Placeholder', 'no-name@example.com');
    const spaces = await user('Placeholder', 'spaces@example.com');
    await driver.getKnex()('sys_user').where({ id: empty }).update({ name: '' });
    await driver.getKnex()('sys_user').where({ id: spaces }).update({ name: '   ' });

    const a = await grant(empty);
    const b = await grant(spaces, 'crm_read');
    expect((await engine.findOne(OBJECT, { where: { id: a.id } }, SYS))!.display_title).toBe('no-name@example.com → crm_edit');
    expect((await engine.findOne(OBJECT, { where: { id: b.id } }, SYS))!.display_title).toBe('spaces@example.com → crm_read');
  });

  describe('the hop is read as the reader', () => {
    it('a user the reader may read is named for that reader', async () => {
      const bob = await user('Bob Kinney', 'bob@example.com');
      const g = await grant(bob);
      readable.add(bob);
      const row = await engine.findOne(OBJECT, { where: { id: g.id } }, { context: READER });
      expect(row!.display_title).toBe('Bob Kinney → crm_edit');
    });

    it('a user the reader may not read leaves the title null, and nothing of the user reaches the row', async () => {
      const carol = await user('Carol Hidden', 'carol.hidden@example.com');
      const g = await grant(carol);
      // The reader's own read of that user returns nothing…
      expect(await engine.find('sys_user', { where: { id: carol } }, { context: READER })).toEqual([]);
      // …so the title over it has no value, and neither the name nor the email leaks.
      const row = await engine.findOne(OBJECT, { where: { id: g.id } }, { context: READER });
      expect(row!.display_title).toBeNull();
      expect(JSON.stringify(row)).not.toContain('Carol Hidden');
      expect(JSON.stringify(row)).not.toContain('carol.hidden@example.com');
      // SYSTEM reads the user directly, so it reads the name through the hop.
      expect((await engine.findOne(OBJECT, { where: { id: g.id } }, SYS))!.display_title).toBe('Carol Hidden → crm_edit');
    });

    it('a grant whose user no longer exists has no title — never one computed in its place', async () => {
      const g = await grant('usr_gone');
      const row = await engine.findOne(OBJECT, { where: { id: g.id } }, SYS);
      expect(row!.display_title).toBeNull();
    });
  });

  it('a row missing a title column is refused, so the formula never sees a NULL part', async () => {
    const dan = await user('Dan Ortiz', 'dan@example.com');
    for (const [omit, partial] of [
      ['user_id', { permission_set: 'crm_edit' }],
      ['permission_set', { user_id: dan }],
    ] as const) {
      await expect(engine.insert(OBJECT, partial, SYS)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: expect.arrayContaining([expect.objectContaining({ field: omit, code: 'required' })]),
      });
    }
  });

  it('adds no stored column and no search companion column', async () => {
    const columns = Object.keys(await driver.getKnex()(OBJECT).columnInfo());
    expect(columns).toContain('user_id');
    expect(columns).not.toContain('display_title');
    // The companion (`__search`) is a real column fed by the title field, and
    // a formula title is never a source — not even where pinyin search is on.
    const registered = engine.registry.getObject(OBJECT) as any;
    expect(resolveSearchCompanionSources(registered)).toEqual([]);
    expect(provisionSearchCompanion(registered).fields[SEARCH_COMPANION_FIELD]).toBeUndefined();
  });
});
