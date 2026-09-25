// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record title of `sys_approval_delegation`, which declared a
 * `titleFormat` and no title pointer (#20044).
 *
 * ADR-0079 resolves a record's title as `nameField ?? displayNameField ??
 * derivation`, and an explicit `nameField` takes precedence over the
 * render-only `titleFormat`. With no pointer declared, the registry's
 * designate-only pass (`provisionPrimary(…, { synthesize: false })`) stamped
 * `nameField: 'id'` — the first title-eligible field — onto the registered
 * body, and a `/meta` read serves that stamp as if the author had written it.
 * A renderer honouring the order therefore drew the raw id as the record
 * page's H1.
 *
 * The object now points at `display_title`, a text formula over the columns
 * `titleFormat` names. Through the real engine this file asserts:
 *
 *  1. the body the registry holds after registration names `display_title`;
 *  2. a seeded row's H1 is the `titleFormat` text, not the id, and the
 *     server-side accessor (`resolveRecordTitle`) agrees;
 *  3. a row missing a title column is refused by the write path, so the
 *     formula never sees a NULL part (the sibling of #20015's nullable legs:
 *     here every title column is required);
 *  4. the formula reads exactly the columns `titleFormat` names, on this row
 *     only, each required and none withheld from a reader of the row;
 *  5. the formula adds no stored column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, resolveRecordTitle } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveDisplayField } from '@objectstack/spec/data';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';

const SYS = { context: { isSystem: true } } as any;
const OBJECT = 'sys_approval_delegation';

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

describe('[#20044] sys_approval_delegation resolves a real record title under ADR-0079 order', () => {
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
    engine.registry.registerObject(SysApprovalDelegation as any, 'com.objectstack.test.20044');
    await engine.syncSchemas();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the registered body points at display_title, a text formula — not the id the designation pass stamped', () => {
    const registered = engine.registry.getObject(OBJECT) as any;
    expect(registered.nameField).toBe('display_title');
    expect(registered.displayNameField).toBe('display_title');
    expect(resolveDisplayField(registered)).toBe('display_title');
    expect(registered.fields.display_title?.type).toBe('formula');
    expect(registered.fields.display_title?.returnType).toBe('text');
  });

  it('the H1 is "{delegator_id} → {delegate_id}", not the id', async () => {
    const registered = engine.registry.getObject(OBJECT) as any;
    const created = await engine.insert(OBJECT, { delegator_id: 'usr_alice', delegate_id: 'usr_bob' }, SYS);
    // The write response carries the title too (read-your-write).
    expect(created.display_title).toBe('usr_alice → usr_bob');
    const row = await engine.findOne(OBJECT, { where: { id: created.id } }, SYS);
    expect(row).not.toBeNull();

    const h1 = row![resolveDisplayField(registered)!];
    expect(h1).toBe('usr_alice → usr_bob');
    expect(h1).not.toBe(row!.id);
    expect(h1).toBe(renderTitleFormat(SysApprovalDelegation, row!));
    expect(resolveRecordTitle(registered, storedOnly(row!))).toBe('usr_alice → usr_bob');
  });

  it('a row missing a title column is refused, so the formula never sees a NULL part', async () => {
    for (const [omit, keep] of [['delegator_id', { delegate_id: 'usr_bob' }], ['delegate_id', { delegator_id: 'usr_alice' }]] as const) {
      await expect(engine.insert(OBJECT, keep, SYS)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: expect.arrayContaining([expect.objectContaining({ field: omit, code: 'required' })]),
      });
    }
  });

  it('the formula reads exactly the titleFormat columns, on this row, each required and none withheld', () => {
    const fields = SysApprovalDelegation.fields as Record<string, any>;
    const reads = formulaReads(SysApprovalDelegation as any);
    // One level deep: a dotted path would read a looked-up record's field.
    expect(reads).toEqual(titleFormatColumns(SysApprovalDelegation));
    for (const column of reads) {
      expect(fields[column], column).toBeDefined();
      expect(fields[column].required, column).toBe(true);
      expect(fields[column].hidden ?? false, column).toBe(false);
      expect(fields[column].requiredPermissions ?? [], column).toEqual([]);
      expect(fields[column].maskingRule, column).toBeUndefined();
    }
  });

  it('adds no stored column: the formula is computed on read, and no search companion appears', async () => {
    const columns = Object.keys(await driver.getKnex()(OBJECT).columnInfo());
    expect(columns).toContain('delegator_id');
    expect(columns).not.toContain('display_title');
    expect(columns).not.toContain('__search');
  });
});
