// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11567] An authored lookup gets NO database `FOREIGN KEY`, and a field that
 * still spells `reference_to` is REFUSED rather than honoured.
 *
 * ## Why this file exists at all
 *
 * Before it, no test anywhere asserted whether a lookup column does or does not
 * get a FOREIGN KEY. Every FK-touching driver test in the repo
 * (`sql-driver-introspection.test.ts`, `sql-driver-11201-*`, `sql-driver-11324-*`,
 * the sqlite-wasm twin) builds its constraints with RAW knex DDL and only
 * introspects them — none goes through `createColumn`, so its emission path had
 * **zero coverage in either direction** (#12252). That blind spot is what let a
 * live-MySQL observation ("a lookup produces a real CONSTRAINT … FOREIGN KEY")
 * stand for three weeks against a doc that said the opposite: both were right
 * about different populations, and nothing pinned either.
 *
 * Retiring the emission without a pin would only MOVE that blind spot, so the
 * pin is written in the RETIRING direction: it fails if someone re-adds FK
 * emission to `createColumn`.
 *
 * ## The measurement is a physical catalog read, with a positive control
 *
 * `PRAGMA foreign_key_list` is SQLite's own account of a table's constraints —
 * not the DDL this driver emitted, and not knex's opinion of it. A null result
 * from a catalog read is worthless unless the read is known to fire, so
 * {@link rawFkTable} builds a REAL FK with raw DDL and the first test asserts
 * the pragma reports it. Same probe, same read: one shape produces a
 * constraint and the authored shapes do not, which makes the zeros
 * measurements rather than vacuous passes.
 *
 * ## What the zeros mean in production
 *
 * They are not a new state of affairs — they are the state of affairs made
 * checkable. Measured across all 44 exported platform objects on live Postgres
 * 16.13 and MySQL 8.0.46 before this change: **0** FK constraints, because
 * `reference_to` has zero non-test assignments repo-wide and the branch was
 * gated on it. Referential integrity belongs to the ENGINE (`deleteBehavior`,
 * the 409 `DELETE_RESTRICTED`), which is what
 * `content/docs/protocol/objectql/types.mdx` has told authors since 2026-07-30.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

let driver: SqlDriver | null = null;

function makeDriver(): SqlDriver {
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  } as any);
  return driver;
}

afterEach(async () => {
  await (driver as any)?.knex?.destroy?.().catch?.(() => {});
  driver = null;
});

/** SQLite's own catalog: one row per FK the table actually carries. */
async function foreignKeys(d: any, table: string): Promise<any[]> {
  const rows = await d.knex.raw(`PRAGMA foreign_key_list('${table}')`);
  return Array.isArray(rows) ? rows : (rows?.rows ?? []);
}

/** A REAL foreign key, built the way every other FK test here builds one. */
async function rawFkTable(d: any, parent: string, child: string): Promise<void> {
  await d.knex.schema.createTable(parent, (t: any) => t.string('id').primary());
  await d.knex.schema.createTable(child, (t: any) => {
    t.string('id').primary();
    t.string('parent_id').references('id').inTable(parent);
  });
}

describe('#11567 — createColumn emits no FOREIGN KEY for an authored relationship', () => {
  it('POSITIVE CONTROL: the pragma reports a foreign key that really is there', async () => {
    const d: any = makeDriver();
    await rawFkTable(d, 'ctl_parent', 'ctl_child');

    const fks = await foreignKeys(d, 'ctl_child');
    expect(fks).toHaveLength(1);
    expect(fks[0].table).toBe('ctl_parent');
    expect(fks[0].from).toBe('parent_id');
    // Without this the zeros below could mean "the read never works here".
  });

  it('a lookup / user / master_detail authored the SPEC way carries no constraint', async () => {
    const d: any = makeDriver();
    await d.initObjects([
      { name: 'fk_parent', fields: { name: { type: 'text' } } },
      {
        name: 'fk_child',
        fields: {
          name: { type: 'text' },
          // The canonical spelling — the only one `FieldSchema` declares.
          parent: { type: 'lookup', reference: 'fk_parent' },
          owner: { type: 'user', reference: 'sys_user' },
          master: { type: 'master_detail', reference: 'fk_parent' },
          many: { type: 'lookup', reference: 'fk_parent', multiple: true },
        },
      },
    ]);

    // The columns exist — so this is a statement about CONSTRAINTS, not about
    // a table the driver failed to build.
    const columns = await d.knex('fk_child').columnInfo();
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(['parent', 'owner', 'master', 'many']),
    );

    expect(await foreignKeys(d, 'fk_child')).toEqual([]);
  });

  it('⛔ REGRESSION GUARD: re-adding FK emission to createColumn fails here', async () => {
    // Stated separately from the case above, and on the narrowest possible
    // object, so the reason a failure appears is unambiguous: one lookup, one
    // parent, nothing else that could contribute a constraint.
    const d: any = makeDriver();
    await d.initObjects([
      { name: 'g_parent', fields: { name: { type: 'text' } } },
      { name: 'g_child', fields: { parent: { type: 'lookup', reference: 'g_parent' } } },
    ]);

    const fks = await foreignKeys(d, 'g_child');
    expect(fks.map((f: any) => `${f.from} -> ${f.table}.${f.to}`)).toEqual([]);
  });
});

describe('#11567 — `reference_to` is refused at the DDL seam, not honoured', () => {
  /** The ADR-0112 envelope plus the wording the spec itself uses. */
  function expectRejectedAlias(err: any): void {
    // `not.toBeNull` rather than `toBeDefined`: `refusalFrom` returns null when
    // NOTHING was thrown, and `expect(null).toBeDefined()` passes — so the
    // no-refusal case would have failed later, as a TypeError on `null.code`,
    // instead of saying what actually went wrong.
    expect(err, 'initObjects did not throw — the refusal never fired').not.toBeNull();
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
    // The wording is the contract here: the driver must give the SAME verdict
    // `FieldSchema` gives, so an author who meets it in either place reads one
    // answer and one fix.
    expect(err.message).toContain('a rejected alias of `reference`');
    expect(err.message).toContain('Did you mean `reference_to` → `reference`?');
  }

  async function refusalFrom(fields: Record<string, any>): Promise<any> {
    const d: any = makeDriver();
    try {
      await d.initObjects([{ name: 'rt_obj', fields }]);
    } catch (e) {
      return e;
    }
    return null;
  }

  it('a lookup carrying `reference_to` throws with the spec’s own verdict', async () => {
    expectRejectedAlias(await refusalFrom({ parent: { type: 'lookup', reference_to: 'rt_parent' } }));
  });

  it('the refusal is not gated on the field TYPE — `FieldSchema` is not either', async () => {
    // `unrecognized_keys` fires for `reference_to` on any field, so a text
    // field carrying it is the same authoring mistake and gets the same answer.
    expectRejectedAlias(await refusalFrom({ note: { type: 'text', reference_to: 'rt_parent' } }));
  });

  it('the refusal is not gated on `multiple` either — the JSON short-circuit used to skip it', async () => {
    // A multi-value lookup returns as a JSON column BEFORE the type switch, so
    // this shape carried the refused key straight past the seam. It is the
    // reason the guard sits ahead of that early return.
    expectRejectedAlias(
      await refusalFrom({ many: { type: 'lookup', reference_to: 'rt_parent', multiple: true } }),
    );
  });

  it('NON-VACUITY: the same objects authored with `reference` build cleanly', async () => {
    // Otherwise every refusal above could be green because `initObjects` throws
    // for some unrelated reason on this fixture shape.
    const d: any = makeDriver();
    await d.initObjects([
      { name: 'rt_parent', fields: { name: { type: 'text' } } },
      {
        name: 'rt_obj',
        fields: {
          parent: { type: 'lookup', reference: 'rt_parent' },
          note: { type: 'text' },
          many: { type: 'lookup', reference: 'rt_parent', multiple: true },
        },
      },
    ]);
    expect(await d.knex.schema.hasTable('rt_obj')).toBe(true);
    expect(await foreignKeys(d, 'rt_obj')).toEqual([]);
  });
});
