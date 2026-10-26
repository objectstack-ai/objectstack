// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_business_unit_member`'s record title names the PERSON and the UNIT,
 * not the two stored ids.
 *
 * Setup → Business Unit Members, and a membership's record page, read the
 * title the object declares (`nameField: 'display_title'`). That formula used
 * to compose the stored foreign keys, `record.user_id + ' in ' +
 * record.business_unit_id`, so every row and every H1 read like
 * `ISu3jHPIrdgD45L1rrC2FuE7DIcsk2ap in 7f3c…`. It now reads the user's `name`
 * (their `email` where the name is blank) and the unit's `name`, ONE hop
 * through each lookup, the traversal the formula read path serves (ADR-0079
 * addendum, 2026-10-18). No column is stored for it, so nothing has to be kept
 * up to date: a renamed user or unit is named anew on the next read.
 *
 * Through the real engine, the real `sys_user`, `sys_business_unit` and
 * membership definitions, this file asserts:
 *
 *  1. the registered body points at `display_title`, a text formula that reads
 *     both lookups only through the hop, and only columns their objects declare;
 *  2. the title a read serves names the person and the unit: on the write's
 *     response, on `findOne`, and on a `find` whose projection names only the
 *     title (the list's Title column);
 *  3. the title follows a renamed user or unit, and a membership moved to
 *     another user or unit, with no write to the membership itself;
 *  4. a user whose stored name is blank is titled by their email;
 *  5. both hops are read as the READER: a user or unit the reader may not
 *     read leaves the title null and none of its name reaches the row, and so
 *     does one that no longer exists;
 *  6. the formula adds no stored column.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectQL, servedRecordTitle } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysBusinessUnit, SysBusinessUnitMember, SysUser } from '@objectstack/platform-objects';
import { resolveDisplayField, resolveRecordDisplayName } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true } } as any;
const OBJECT = 'sys_business_unit_member';
const OWNER = 'com.objectstack.test.business-unit-member-title';

/** A reader who is not SYSTEM: the shape every request's context has. */
const READER: ExecutionContext = { userId: 'usr_reader', tenantId: 'org_1' };

/** Every `record.<path>` the `display_title` expression reads, as written. */
function formulaReads(): string[] {
  const source = (SysBusinessUnitMember as any).fields.display_title?.expression?.source;
  if (typeof source !== 'string') throw new Error('display_title carries no expression source');
  return [...new Set([...source.matchAll(/record\.([A-Za-z_][A-Za-z0-9_.]*)/g)].map((m) => m[1]))].sort();
}

describe('sys_business_unit_member is titled by the person and the unit, not their ids', () => {
  let engine: ObjectQL;
  let driver: SqlDriver;
  /** Ids a reader that is not SYSTEM may read, per related object. */
  const readable = { sys_user: new Set<string>(), sys_business_unit: new Set<string>() };

  const user = async (name: string, email: string): Promise<string> =>
    String((await engine.insert('sys_user', { name, email }, SYS)).id);
  const unit = async (name: string): Promise<string> =>
    String((await engine.insert('sys_business_unit', { name }, SYS)).id);
  const member = async (userId: string, unitId: string) =>
    engine.insert(OBJECT, { user_id: userId, business_unit_id: unitId }, SYS);
  const titleOf = async (id: unknown, ctx: any = SYS) =>
    (await engine.findOne(OBJECT, { where: { id } }, ctx))!.display_title;

  beforeAll(async () => {
    engine = new ObjectQL();
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(SysUser as any, OWNER);
    engine.registry.registerObject(SysBusinessUnit as any, OWNER);
    engine.registry.registerObject(SysBusinessUnitMember as any, OWNER);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    // Row-level security on the two related objects for a reader that is not
    // SYSTEM: here, the ids in `readable`.
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      const scope = readable[ctx.object as keyof typeof readable];
      if (scope && ['find', 'findOne'].includes(ctx.operation) && !ctx.context?.isSystem) {
        const scoped = { id: { $in: [...scope] } };
        ctx.ast = { ...(ctx.ast ?? {}), where: ctx.ast?.where ? { $and: [ctx.ast.where, scoped] } : scoped };
      }
      await next();
    });
  });

  beforeEach(() => {
    readable.sys_user.clear();
    readable.sys_business_unit.clear();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the registered body points at display_title, a text formula reading both lookups only through the hop', () => {
    const registered = engine.registry.getObject(OBJECT) as any;
    expect(registered.nameField).toBe('display_title');
    expect(registered.displayNameField).toBe('display_title');
    expect(resolveDisplayField(registered)).toBe('display_title');
    expect(registered.fields.display_title?.type).toBe('formula');
    expect(registered.fields.display_title?.returnType).toBe('text');
    // Neither id is read bare: a bare read beside a traversal is the
    // `traversal-bare-and-traversed` refusal.
    expect(formulaReads()).toEqual(['business_unit_id.name', 'user_id.email', 'user_id.name']);
    for (const [object, columns] of [['sys_user', ['name', 'email']], ['sys_business_unit', ['name']]] as const) {
      const fields = (engine.registry.getObject(object) as any).fields;
      for (const column of columns) expect(fields[column], `${object}.${column}`).toBeDefined();
    }
  });

  it('a read serves the person\'s and the unit\'s names: on the write response, findOne and a projected find', async () => {
    const alice = await user('Alice Liddell', 'alice@example.com');
    const emea = await unit('EMEA Sales');
    const created = await member(alice, emea);
    expect(created.display_title).toBe('Alice Liddell in EMEA Sales');

    const registered = engine.registry.getObject(OBJECT) as any;
    const row = await engine.findOne(OBJECT, { where: { id: created.id } }, SYS);
    expect(row!.display_title).toBe('Alice Liddell in EMEA Sales');
    expect(row!.display_title).not.toContain(alice);
    expect(row!.display_title).not.toContain(emea);
    // The row still holds the foreign KEYS; only the title reads through them.
    expect(row!.user_id).toBe(alice);
    expect(row!.business_unit_id).toBe(emea);
    expect(resolveRecordDisplayName(registered, row)).toBe('Alice Liddell in EMEA Sales');
    expect(servedRecordTitle(registered, row)).toBe('Alice Liddell in EMEA Sales');

    // The list's Title column: a projection naming only the title.
    const listed = await engine.find(OBJECT, { where: { id: created.id }, fields: ['display_title'] }, SYS);
    expect(listed).toEqual([{ display_title: 'Alice Liddell in EMEA Sales' }]);
  });

  it('the title follows a rename of the user or the unit, and a move to another user or unit', async () => {
    const bob = await user('Bob Kinney', 'bob@example.com');
    const ops = await unit('Operations');
    const m = await member(bob, ops);
    expect(await titleOf(m.id)).toBe('Bob Kinney in Operations');

    // Nothing is stored on the membership, so a rename is read on the next read.
    await engine.update('sys_user', { id: bob, name: 'Robert Kinney' }, SYS);
    await engine.update('sys_business_unit', { id: ops, name: 'Global Operations' }, SYS);
    expect(await titleOf(m.id)).toBe('Robert Kinney in Global Operations');

    const dana = await user('Dana Ortiz', 'dana@example.com');
    const apac = await unit('APAC');
    await engine.update(OBJECT, { id: m.id, user_id: dana, business_unit_id: apac }, SYS);
    expect(await titleOf(m.id)).toBe('Dana Ortiz in APAC');
  });

  it('a user whose stored name is blank is titled by their email', async () => {
    // The write door refuses a blank `name` (it is required), so a nameless
    // user is a row written past it: an import, or a row older than the rule.
    const nameless = await user('Placeholder', 'no-name@example.com');
    await driver.getKnex()('sys_user').where({ id: nameless }).update({ name: '  ' });
    const m = await member(nameless, await unit('Finance'));
    expect(await titleOf(m.id)).toBe('no-name@example.com in Finance');
  });

  describe('both hops are read as the reader', () => {
    it('a user and a unit the reader may read are named for that reader', async () => {
      const erin = await user('Erin Shaw', 'erin@example.com');
      const legal = await unit('Legal');
      const m = await member(erin, legal);
      readable.sys_user.add(erin);
      readable.sys_business_unit.add(legal);
      expect(await titleOf(m.id, { context: READER })).toBe('Erin Shaw in Legal');
    });

    it('a user or a unit the reader may not read leaves the title null, and none of its name reaches the row', async () => {
      const carol = await user('Carol Hidden', 'carol.hidden@example.com');
      const secret = await unit('Secret Projects');
      const m = await member(carol, secret);

      // Unit readable, user not.
      readable.sys_business_unit.add(secret);
      let row = await engine.findOne(OBJECT, { where: { id: m.id } }, { context: READER });
      expect(row!.display_title).toBeNull();
      expect(JSON.stringify(row)).not.toContain('Carol Hidden');
      expect(JSON.stringify(row)).not.toContain('carol.hidden@example.com');

      // User readable, unit not.
      readable.sys_business_unit.clear();
      readable.sys_user.add(carol);
      row = await engine.findOne(OBJECT, { where: { id: m.id } }, { context: READER });
      expect(row!.display_title).toBeNull();
      expect(JSON.stringify(row)).not.toContain('Secret Projects');

      // SYSTEM reads both directly, so it reads both names through the hops.
      expect(await titleOf(m.id)).toBe('Carol Hidden in Secret Projects');
    });

    it('a membership whose user or unit no longer exists has no title, never one computed in its place', async () => {
      const frank = await user('Frank Gone', 'frank@example.com');
      const hr = await unit('HR');
      const noUser = await member('usr_gone', hr);
      const noUnit = await member(frank, 'bu_gone');
      expect(await titleOf(noUser.id)).toBeNull();
      expect(await titleOf(noUnit.id)).toBeNull();
    });
  });

  it('adds no stored column', async () => {
    const columns = Object.keys(await driver.getKnex()(OBJECT).columnInfo());
    expect(columns).toEqual(expect.arrayContaining(['user_id', 'business_unit_id']));
    expect(columns).not.toContain('display_title');
  });
});
