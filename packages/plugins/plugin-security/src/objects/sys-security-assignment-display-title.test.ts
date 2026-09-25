// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record title of the three permission-assignment tables, which declared a
 * `titleFormat` and no title pointer (#20044): `sys_position_permission_set`,
 * `sys_user_permission_set` and `sys_user_position`.
 *
 * ADR-0079 resolves a record's title as `nameField ?? displayNameField ??
 * derivation`, and an explicit `nameField` takes precedence over the
 * render-only `titleFormat`. With no pointer declared, the registry's
 * designate-only pass (`provisionPrimary(…, { synthesize: false })`) stamped
 * `nameField: 'id'` — the first title-eligible field — onto each registered
 * body, and a `/meta` read serves that stamp as if the author had written it.
 * A renderer honouring the order therefore drew the raw id as the record
 * page's H1.
 *
 * Each object now points at `display_title`, a text formula over the columns
 * its `titleFormat` names. Through the real engine this file asserts, per
 * object:
 *
 *  1. the body the registry holds after registration names `display_title`;
 *  2. a seeded row's H1 is the `titleFormat` text, not the id, and the
 *     server-side accessor (`resolveRecordTitle`) agrees;
 *  3. a row missing a title column is refused by the write path, so the
 *     formula never sees a NULL part;
 *  4. the formula adds no stored column.
 *
 * And, because these are permission-assignment tables, the property the new
 * field must not break: the formula reads exactly the columns `titleFormat`
 * names, on this row only — a foreign key, never a field of the record it
 * points at — and none of them is hidden, guarded by `requiredPermissions` or
 * masked. So the title carries nothing the object's declared read path
 * withholds from a reader of the row. No row scope, permission set or
 * `apiMethods` entry changes; the formula is a read-only computed field.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, resolveRecordTitle } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveDisplayField } from '@objectstack/spec/data';
import { SysPositionPermissionSet } from './sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './sys-user-permission-set.object.js';
import { SysUserPosition } from './sys-user-position.object.js';

const SYS = { context: { isSystem: true } } as any;

interface Case {
  schema: any;
  row: Record<string, string>;
  title: string;
}

const CASES: Case[] = [
  {
    schema: SysPositionPermissionSet,
    row: { position_id: 'pos_sales', permission_set_id: 'ps_crm_edit' },
    title: 'pos_sales → ps_crm_edit',
  },
  {
    schema: SysUserPermissionSet,
    row: { user_id: 'usr_alice', permission_set_id: 'ps_crm_edit' },
    title: 'usr_alice → ps_crm_edit',
  },
  {
    schema: SysUserPosition,
    row: { user_id: 'usr_alice', position: 'sales_manager' },
    title: 'usr_alice → sales_manager',
  },
];

/** The `titleFormat` source: the parsed schema carries it as an envelope. */
function titleFormatSource(schema: unknown): string {
  const tf = (schema as { titleFormat?: unknown }).titleFormat;
  const source = typeof tf === 'string' ? tf : (tf as { source?: unknown })?.source;
  if (typeof source !== 'string') throw new Error(`titleFormat carries no template source: ${JSON.stringify(tf)}`);
  return source;
}

/**
 * The H1 a `titleFormat`-first renderer draws: each `{field}` placeholder
 * substituted with the row's value. It is the reference the formula has to
 * reproduce, not a second title resolver.
 */
function renderTitleFormat(schema: unknown, row: Record<string, unknown>): string {
  return titleFormatSource(schema).replace(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g, (_m, key: string) => String(row[key] ?? ''));
}

/** The columns `titleFormat` names. */
function titleFormatColumns(schema: unknown): string[] {
  return [...titleFormatSource(schema).matchAll(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g)].map((m) => m[1]).sort();
}

/** Every `record.<path>` the `display_title` expression reads, as written. */
function formulaReads(schema: { fields: Record<string, any> }): string[] {
  const source = schema.fields.display_title?.expression?.source;
  if (typeof source !== 'string') throw new Error('display_title carries no expression source');
  return [...source.matchAll(/record\.([A-Za-z_][A-Za-z0-9_.]*)/g)].map((m) => m[1]).sort();
}

/** The stored row as a hook body holds it: no formula value on it. */
function storedOnly(row: Record<string, unknown>): Record<string, unknown> {
  const { display_title: _omit, ...rest } = row;
  return rest;
}

describe('[#20044] permission-assignment tables resolve a real record title under ADR-0079 order', () => {
  let engine: ObjectQL;
  let driver: SqlDriver;

  beforeAll(async () => {
    engine = new ObjectQL();
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    for (const { schema } of CASES) {
      engine.registry.registerObject(schema, 'com.objectstack.test.20044');
    }
    await engine.syncSchemas();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  for (const { schema, row: data, title } of CASES) {
    const object: string = schema.name;

    it(`${object}: the registered body points at display_title, a text formula — not the id the designation pass stamped`, () => {
      const registered = engine.registry.getObject(object) as any;
      expect(registered.nameField).toBe('display_title');
      expect(registered.displayNameField).toBe('display_title');
      expect(resolveDisplayField(registered)).toBe('display_title');
      expect(registered.fields.display_title?.type).toBe('formula');
      expect(registered.fields.display_title?.returnType).toBe('text');
    });

    it(`${object}: the H1 is "${titleFormatSource(schema)}", not the id`, async () => {
      const registered = engine.registry.getObject(object) as any;
      const created = await engine.insert(object, data, SYS);
      expect(created.display_title).toBe(title);
      const row = await engine.findOne(object, { where: { id: created.id } }, SYS);
      expect(row).not.toBeNull();

      const h1 = row![resolveDisplayField(registered)!];
      expect(h1).toBe(title);
      expect(h1).not.toBe(row!.id);
      expect(h1).toBe(renderTitleFormat(schema, row!));
      expect(resolveRecordTitle(registered, storedOnly(row!))).toBe(title);
    });

    it(`${object}: a row missing a title column is refused, so the formula never sees a NULL part`, async () => {
      for (const omit of Object.keys(data)) {
        const partial: Record<string, string> = { ...data };
        delete partial[omit];
        await expect(engine.insert(object, partial, SYS)).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
          fields: expect.arrayContaining([expect.objectContaining({ field: omit, code: 'required' })]),
        });
      }
    });

    it(`${object}: the formula reads exactly the titleFormat columns, on this row, each required and none withheld`, () => {
      const fields = schema.fields as Record<string, any>;
      const reads = formulaReads(schema);
      // One level deep: a dotted path would read a looked-up record's field,
      // which a reader of this row may not be allowed to see.
      expect(reads).toEqual(titleFormatColumns(schema));
      for (const column of reads) {
        expect(fields[column], column).toBeDefined();
        expect(fields[column].required, column).toBe(true);
        expect(fields[column].hidden ?? false, column).toBe(false);
        expect(fields[column].requiredPermissions ?? [], column).toEqual([]);
        expect(fields[column].maskingRule, column).toBeUndefined();
      }
    });

    it(`${object}: adds no stored column — the formula is computed on read, and no search companion appears`, async () => {
      const columns = Object.keys(await driver.getKnex()(object).columnInfo());
      expect(columns).toContain(Object.keys(data)[0]);
      expect(columns).not.toContain('display_title');
      expect(columns).not.toContain('__search');
    });
  }
});
