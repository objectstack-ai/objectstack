// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16319 — the DDL emitter no longer guesses a column family for a field that
 * declares no `type`.
 *
 * MAINTAINER RULING, 2026-09-10 (director seat batch #111 item 2): 「一个没写
 * type(或拼错)的字段 应该禁止加载」, item 3 「下游默认值全部改拒绝:
 * `createColumn` 的 `|| 'string'` … ⛔ 不再猜族;按构造它们应当不可达,拒绝是防御」.
 *
 * What the retired default cost, measured on the card against live PostgreSQL
 * 16.13: `{ maxLength: 100 }` with no `type` became `character varying(100)`
 * here — `field.type || 'string'` heads the STRING family, sized from
 * `declaredVarcharLength(field)` — while BOTH `os generate migration` formats
 * emitted `TEXT` for the same declaration. The platform then refused a
 * 101-character value that both generated tables accepted.
 *
 * ⚠️ SCOPE, stated so a later reader does not read the gap as an oversight: the
 * refusal here asks PRESENCE, not `FieldType` MEMBERSHIP. Membership is refused
 * for the whole object at `SchemaRegistry.registerObject`, which is where the
 * ruling put the single point of closure and what its acceptance list means by
 * 「驱动永远到不了」 — and this package's own corpus declares 388 non-member
 * spellings across ~100 files (`'string'` 361, `'integer'` 17, `'auto_number'`
 * 5, `'varchar'` 4, `'object'` 1) that drive `initObjects` directly, never
 * through the registry. `'string'` is a declared `case` arm of this switch whose
 * column shape differs from every member's, so closing that half is a corpus
 * migration with column consequences, not a spelling fix. The last test below
 * PINS the boundary in both directions so neither half moves silently.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('#16319 — `createColumn` refuses a field that declares no `type`', () => {
  let driver: SqlDriver | undefined;
  afterEach(async () => { await driver?.disconnect(); driver = undefined; });

  const open = () => new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  it('refuses with the ADR-0112 envelope, naming the column and the reason', async () => {
    driver = open();
    let thrown: any;
    try {
      await driver.initObjects([
        { name: 'probe_object', fields: { probe: { maxLength: 100 } } },
      ] as any);
    } catch (e) { thrown = e; }

    // ⛔ Not a bare `toThrow()`: a driver that failed for an unrelated reason
    // would satisfy one. Envelope, or nothing.
    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('VALIDATION_ERROR');
    expect(thrown.status).toBe(400);
    expect(thrown.message).toContain("field 'probe'");
    expect(thrown.message).toContain('declares no `type`');
    expect(thrown.message).toContain('no column is created for it');
    // It names where the real door is, so a reader who meets this knows the
    // object arrived by a path the registry does not front.
    expect(thrown.message).toContain('SchemaRegistry.registerObject');
  });

  it('POSITIVE CONTROL — the same declaration WITH a `FieldType` member builds its column', async () => {
    driver = open();
    await driver.initObjects([
      { name: 'probe_object', fields: { probe: { type: 'email', maxLength: 100 } } },
    ] as any);

    const cols: any[] = await (driver as any).introspectColumns('probe_object');
    expect(cols.map((c) => c.name)).toContain('probe');
  });

  it('the refusal is stated BEFORE any column of the object is created — not half a table', async () => {
    driver = open();
    await expect(driver.initObjects([
      { name: 'probe_object', fields: { good: { type: 'text' }, probe: { maxLength: 100 } } },
    ] as any)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // The object is not left half-built: no table named by it survives. Asked at
    // the KNEX level rather than through `driver.find`, because the question is
    // about the TABLE and the driver's read path would answer it through an
    // options bag this assertion has no use for. ⚠️ Measured: on SQLite
    // `columnInfo()` for a table that does not exist RESOLVES `{}` rather than
    // rejecting, so the assertion is on the key set — and the CONTROL above,
    // which reads a non-empty one from the same call, is what makes this zero a
    // reading rather than an empty walk.
    const info: Record<string, unknown> = await (driver as any).knex('probe_object').columnInfo();
    expect(Object.keys(info)).toEqual([]);
  });

  it('⭐ BOUNDARY PIN — presence is refused here; MEMBERSHIP is not, and is refused at the registry', async () => {
    driver = open();
    // A non-member `type` still reaches this switch's own catch-all arm and
    // still builds `varchar(255)`. ⛔ This is NOT an endorsement of the guess —
    // it is the measured statement of where this card drew the line, so that
    // moving it later is a deliberate edit with a failing test, not a silent
    // drift. `SchemaRegistry.registerObject` refuses this declaration outright,
    // which is why no registry-fronted path can reach it.
    await driver.initObjects([
      { name: 'probe_object', fields: { probe: { type: 'this_is_not_a_field_type', maxLength: 100 } } },
    ] as any);
    const cols: any[] = await (driver as any).introspectColumns('probe_object');
    expect(cols.map((c) => c.name)).toContain('probe');
  });
});
