// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import {
  carriesNullSafeTenantKeyPart,
  diffManagedIndexes,
  hashShadowColumnFor,
  normalizeDeclaredIndex,
  uniqueIndexesFromFields,
  type ExpectedIndex,
  type PhysicalIndex,
} from './schema-drift.js';
import { asPre18TenantColumn } from './pre-18-tenant-column.testkit.js';

/**
 * [18.x step 7b-1 + 7b-2] The organization key part of a unique index.
 *
 * 18.0 keyed every organization-scoped unique through ADR-0120 D3's
 * `COALESCE(organization_id, '__global__')`. Since ADR-0131 D1 the tenant
 * column is NOT NULL, so new DDL keys the plain column (7b-2), and the differ
 * reads the old form as the same constraint wherever the tenant column holds
 * no NULL: physically NOT NULL, or a certified database — a birth marker or an
 * organization-ownership ceremony marker of the current shape generation
 * (7b-1). Elsewhere the two forms are different constraints, and that
 * reading stays: the uncertified, nullable legs below are each case's control.
 */

const TABLE = 'eqv_account';
const ORG = 'organization_id';
const NAME = `uniq_${TABLE}_${ORG}_code`;

/** What 18.0 built: the NULL-safe organization key part, attributed by introspection. */
const coalesced: PhysicalIndex = {
  name: NAME,
  columns: [ORG, 'code'],
  unique: true,
  expressions: [`COALESCE("${ORG}", '__global__')`],
  nullSafeColumns: [ORG],
};
/** What HEAD builds: the plain composite. */
const plain: PhysicalIndex = { name: NAME, columns: [ORG, 'code'], unique: true };
const expectedPlain: ExpectedIndex = { name: NAME, columns: [ORG, 'code'], unique: true };
const expectedNullSafe: ExpectedIndex = { ...expectedPlain, nullSafeColumns: [ORG] };

const diff = (expected: ExpectedIndex, physical: PhysicalIndex, tenantKeyCertified?: boolean, tenantField: string | null = ORG) =>
  diffManagedIndexes({ table: TABLE, expected: [expected], legacy: [], physical: [physical], tenantField, tenantKeyCertified });

describe('7b-2 — the generators key the plain organization column', () => {
  it('a field-level organization unique is the plain composite, tenant column first', () => {
    expect(uniqueIndexesFromFields(TABLE, { code: { type: 'text', unique: true } }, ORG)).toEqual([expectedPlain]);
  });

  it("a declared `unique: 'organization'` prepends the plain tenant column", () => {
    expect(normalizeDeclaredIndex(TABLE, { fields: ['code'], unique: 'organization' }, ORG)).toEqual(expectedPlain);
  });

  it('an input already normalized with a NULL-safe part is honoured verbatim (the read vocabulary stays)', () => {
    expect(normalizeDeclaredIndex(TABLE, { name: NAME, fields: [ORG, 'code'], unique: true, nullSafeColumns: [ORG] }, ORG)).toEqual(
      expectedNullSafe,
    );
  });
});

describe('7b-1 — the differ: COALESCE(tenant) ≡ tenant where the tenant column holds no NULL', () => {
  it('an 18.0 COALESCE index against the plain expectation: no drift when certified', () => {
    expect(diff(expectedPlain, coalesced, true)).toEqual([]);
  });

  it('control — the same pair, uncertified: a destructive recreate_index (the two are different constraints)', () => {
    const [entry, ...rest] = diff(expectedPlain, coalesced, false);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ category: 'destructive', op: { type: 'recreate_index', indexName: NAME } });
  });

  it('the other direction: a plain physical index against a NULL-safe expectation, no drift when certified', () => {
    expect(diff(expectedNullSafe, plain, true)).toEqual([]);
    expect(diff(expectedNullSafe, plain, false).map((d) => d.op.type)).toEqual(['recreate_index']);
  });

  it('the equivalence is the TENANT column\'s: with no tenant column named it does not apply', () => {
    expect(diff(expectedPlain, coalesced, true, null).map((d) => d.op.type)).not.toEqual([]);
  });

  it('it changes the form of the key part only — a different column set stays drift, certified or not', () => {
    const other: ExpectedIndex = { name: NAME, columns: [ORG, 'code', 'region'], unique: true };
    expect(diff(other, coalesced, true).map((d) => d.op.type)).toEqual(['recreate_index']);
  });

  it('a MySQL hash shadow carrying the COALESCE key reads as the plain key when certified', () => {
    const carrier: PhysicalIndex = {
      name: NAME,
      columns: [hashShadowColumnFor(NAME)],
      unique: true,
      shadowKey: [
        { column: ORG, nullSafe: true },
        { column: 'code', nullSafe: false },
      ],
    };
    expect(diff(expectedPlain, carrier, true)).toEqual([]);
    expect(diff(expectedPlain, carrier, false).map((d) => d.op.type)).toEqual(['recreate_index']);
  });

  it('carriesNullSafeTenantKeyPart answers for direct and shadow-carried keys, and only for the tenant column', () => {
    expect(carriesNullSafeTenantKeyPart([coalesced], ORG)).toBe(true);
    expect(carriesNullSafeTenantKeyPart([plain], ORG)).toBe(false);
    expect(carriesNullSafeTenantKeyPart([coalesced], null)).toBe(false);
    expect(carriesNullSafeTenantKeyPart([{ ...coalesced, nullSafeColumns: ['package_id'] }], ORG)).toBe(false);
  });
});

describe('the driver, on real SQLite', () => {
  let driver: SqlDriver;
  const object = { name: TABLE, fields: { code: { type: 'text', unique: true }, [ORG]: { type: 'text' } } };

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([object]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const knex = () => (driver as unknown as { knex: { raw(sql: string, b?: unknown[]): Promise<any> } }).knex;
  const indexSql = async (): Promise<string> => {
    const rows: any[] = await knex().raw(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`, [NAME]);
    return String(rows[0]?.sql ?? '');
  };
  /** The table as 18.0 left it: a nullable tenant column and the COALESCE index under the declared name. */
  const as18Point0 = async (): Promise<void> => {
    await asPre18TenantColumn(driver, TABLE);
    await knex().raw(`DROP INDEX "${NAME}"`);
    await knex().raw(`CREATE UNIQUE INDEX "${NAME}" ON "${TABLE}" (COALESCE("${ORG}", '__global__'), "code")`);
  };
  const indexOps = async () => (await driver.detectManagedDrift()).filter((d) => d.op.type.endsWith('_index'));

  it('a fresh table gets the plain composite — no COALESCE — and no index drift', async () => {
    const sql = await indexSql();
    expect(sql).toMatch(/\(\s*[`"]?organization_id[`"]?\s*,\s*[`"]?code[`"]?\s*\)/);
    expect(sql).not.toMatch(/COALESCE/i);
    expect(await indexOps()).toEqual([]);
  });

  it('an 18.0 table on a certified database: no drift, and the certification is asked', async () => {
    await as18Point0();
    let asked = 0;
    driver.setTenantKeyCertifiedResolver(() => {
      asked++;
      return true;
    });
    expect(await indexOps()).toEqual([]);
    expect(asked).toBeGreaterThan(0);
    expect(await indexSql()).toMatch(/COALESCE/);
  });

  it('control — the same table with no certification: the destructive recreate_index the equivalence exists to remove', async () => {
    await as18Point0();
    expect((await indexOps()).map((d) => [d.op.type, d.category])).toEqual([['recreate_index', 'destructive']]);
  });

  it('a resolver that answers no, or throws, is "not certified"', async () => {
    await as18Point0();
    driver.setTenantKeyCertifiedResolver(() => false);
    expect((await indexOps()).map((d) => d.op.type)).toEqual(['recreate_index']);
    driver.setTenantKeyCertifiedResolver(() => {
      throw new Error('ledger unreadable');
    });
    expect((await indexOps()).map((d) => d.op.type)).toEqual(['recreate_index']);
  });

  it('a physically NOT NULL tenant column is its own witness: no drift without any certification', async () => {
    await knex().raw(`DROP INDEX "${NAME}"`);
    await knex().raw(`CREATE UNIQUE INDEX "${NAME}" ON "${TABLE}" (COALESCE("${ORG}", '__global__'), "code")`);
    expect(await indexOps()).toEqual([]);
  });

  it('a table carrying no COALESCE tenant key part never asks the question', async () => {
    let asked = 0;
    driver.setTenantKeyCertifiedResolver(() => {
      asked++;
      return true;
    });
    await asPre18TenantColumn(driver, TABLE);
    expect(await indexOps()).toEqual([]);
    expect(asked).toBe(0);
  });
});
