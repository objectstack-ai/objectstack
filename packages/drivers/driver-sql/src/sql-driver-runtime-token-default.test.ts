// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defaultValue` runtime tokens must never become a literal column DEFAULT
 * (#4560).
 *
 * `Field.user({ defaultValue: 'current_user' })` is resolved by the ENGINE, at
 * insert time, from the request's `ExecutionContext` — and when there is no
 * authenticated user (system / anonymous writes: seed replay, package install,
 * boot provisioning) the engine deliberately leaves the field UNSET rather than
 * stamp a bogus owner.
 *
 * The DDL used to pass any non-object `defaultValue` straight through to
 * `col.defaultTo(dv)`, so SQL emitted `DEFAULT 'current_user'` and the DATABASE
 * overrode that decision: every omitted insert landed the literal string
 * `current_user` in a `lookup('sys_user')` column — a value that is not any
 * user's id, discovered by #4551's dangling-reference audit on its first real
 * run.
 *
 * `'NOW()'` sat in the adjacent branch, translated to a driver-native default
 * for exactly this reason. These tests pin the whole family: `NOW()` keeps its
 * native default, every other token emits NONE, and a database created before
 * the fix has its wrong DEFAULT dropped by the schema-evolution path — WITHOUT
 * rewriting the rows that already hold the bogus value (#4551's standing rule:
 * report, never rewrite).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  DEFAULT_VALUE_TOKENS,
  DEFAULT_VALUE_TOKEN_CURRENT_USER,
  isNowDefaultToken,
} from '@objectstack/spec/data';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('SqlDriver — defaultValue runtime tokens never become a column DEFAULT (#4560)', () => {
  let knexInstance: any;

  const makeDriver = (opts: any = {}) => {
    const d = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      ...opts,
    });
    knexInstance = (d as any).knex;
    (d as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return d;
  };

  /** The raw `CREATE TABLE` SQLite stored — the only unambiguous view of a DEFAULT. */
  const tableSql = async (table: string): Promise<string> => {
    const row = await knexInstance.raw(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    return String(row?.[0]?.sql ?? row?.sql ?? '');
  };

  afterEach(async () => {
    await knexInstance?.destroy();
  });

  const fieldZoo = [
    {
      name: 'field_zoo',
      fields: {
        title: { type: 'string' },
        // The #4560 repro, verbatim from examples/app-showcase.
        f_owner: { type: 'user', reference: 'sys_user', defaultValue: DEFAULT_VALUE_TOKEN_CURRENT_USER },
        // The token that DOES have a database counterpart — its behaviour must
        // not move, or the fix has traded one silent default for another.
        f_seen_at: { type: 'datetime', defaultValue: 'NOW()' },
        // An ordinary literal default — still emitted, unchanged.
        f_status: { type: 'string', defaultValue: 'open' },
      },
    },
  ];

  // ── (a) the column is created with NO database default ──────────────────────

  it('creates a `current_user`-defaulted column with NO database default', async () => {
    const driver = makeDriver();
    await driver.initObjects(fieldZoo as any);

    const info = await knexInstance('field_zoo').columnInfo();
    expect(info.f_owner.defaultValue ?? null).toBeNull();

    const sql = await tableSql('field_zoo');
    // The token's own spelling must appear nowhere in the DDL.
    expect(sql).not.toContain('current_user');
  });

  it('still emits an ordinary literal default (the fix excludes tokens, not defaults)', async () => {
    const driver = makeDriver();
    await driver.initObjects(fieldZoo as any);
    const info = await knexInstance('field_zoo').columnInfo();
    expect(String(info.f_status.defaultValue)).toContain('open');
  });

  // ── (b) an insert with no user context leaves the column NULL ───────────────

  it('an insert that omits the field leaves it NULL — not the literal token', async () => {
    const driver = makeDriver();
    await driver.initObjects(fieldZoo as any);

    // A system/anonymous write: exactly the seed-replay shape that produced the
    // two dangling `sys_user:current_user` references #4551's audit reported.
    await driver.create('field_zoo', { id: 'z1', title: 'specimen' }, { bypassTenantAudit: true });

    const row = await knexInstance('field_zoo').where('id', 'z1').first();
    expect(row.f_owner).toBeNull();
    expect(row.f_owner).not.toBe('current_user');
  });

  it('an explicitly supplied user id is still stored (the column is a normal lookup)', async () => {
    const driver = makeDriver();
    await driver.initObjects(fieldZoo as any);
    await driver.create('field_zoo', { id: 'z2', title: 't', f_owner: 'usr_42' }, { bypassTenantAudit: true });
    const row = await knexInstance('field_zoo').where('id', 'z2').first();
    expect(row.f_owner).toBe('usr_42');
  });

  // ── (c) 'NOW()' behaviour is unchanged ─────────────────────────────────────

  it("REGRESSION: 'NOW()' still gets its driver-native default and stores a canonical instant", async () => {
    const driver = makeDriver();
    await driver.initObjects(fieldZoo as any);
    await driver.create('field_zoo', { id: 'z3', title: 't' }, { bypassTenantAudit: true });
    const row = await knexInstance('field_zoo').where('id', 'z3').first();
    expect(row.f_seen_at).toMatch(ISO_Z);
    expect(String(row.f_seen_at)).not.toContain('NOW()');
  });

  // ── (e) revert-proof: the DDL consults the SPEC's token set, not a name ─────

  it('REVERT-PROOF: no token in DEFAULT_VALUE_TOKENS reaches the DDL as a literal', async () => {
    // Looping the spec's own list is what makes this survive the next token:
    // an open-coded `dv === 'current_user'` in the DDL passes today and fails
    // the moment DEFAULT_VALUE_TOKENS grows. Dropping the exclusion branch
    // altogether fails it immediately — the literal reappears in the DDL.
    const driver = makeDriver();
    const fields: Record<string, any> = { title: { type: 'string' } };
    DEFAULT_VALUE_TOKENS.forEach((token, i) => {
      fields[`tok_${i}`] = { type: 'string', defaultValue: token };
    });
    await driver.initObjects([{ name: 'token_zoo', fields }] as any);

    const info = await knexInstance('token_zoo').columnInfo();
    DEFAULT_VALUE_TOKENS.forEach((token, i) => {
      const physical = info[`tok_${i}`].defaultValue;
      if (isNowDefaultToken(token)) {
        // Translated, never literal.
        expect(physical).not.toBeNull();
        expect(String(physical)).not.toContain('NOW()');
      } else {
        // Owned by the application layer — no column default at all.
        expect(physical ?? null).toBeNull();
      }
    });
  });

  // ── (d) the schema-evolution path corrects a pre-existing wrong DEFAULT ─────

  /**
   * A database created by a pre-fix build: `f_owner` carries the literal token
   * as its DEFAULT and two rows already ate it. `f_seen_at` carries a legitimate
   * `NOW()`-family default that must survive the repair untouched.
   */
  const seedPreFixTable = async () => {
    await knexInstance.raw(`
      CREATE TABLE field_zoo (
        id varchar(255) not null primary key,
        created_at datetime,
        updated_at datetime,
        title varchar(255),
        f_owner varchar(255) default 'current_user',
        f_seen_at datetime default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        f_status varchar(255) default 'open'
      )
    `);
    await knexInstance('field_zoo').insert([
      { id: 'IFMh0g', title: 'A', f_owner: 'current_user' },
      { id: 'TP2KMq', title: 'B', f_owner: 'current_user' },
    ]);
  };

  it('detectManagedDrift reports the stale token DEFAULT as safe, reconcilable drift', async () => {
    const driver = makeDriver();
    await seedPreFixTable();
    await driver.initObjects(fieldZoo as any);

    const drift = await driver.detectManagedDrift(fieldZoo as any);
    const entry = drift.find((d) => d.column === 'f_owner');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('default_mismatch');
    expect(entry!.category).toBe('safe');
    expect(entry!.op.type).toBe('drop_column_default');
    expect(entry!.message).toContain('current_user');

    // Only the token column drifts — a correct `NOW()` default is not drift.
    expect(drift.some((d) => d.column === 'f_seen_at')).toBe(false);
    expect(drift.some((d) => d.column === 'f_status')).toBe(false);
  });

  it('a boot with autoMigrate=safe drops the wrong DEFAULT, so the NEXT omitted insert is NULL', async () => {
    const driver = makeDriver({ autoMigrate: 'safe', schemaMode: 'managed' });
    await seedPreFixTable();

    // This is the boot: `initObjects` detects the drift and auto-reconciles the
    // `safe` subset, exactly as it does for a relaxed NOT NULL.
    await driver.initObjects(fieldZoo as any);

    const info = await knexInstance('field_zoo').columnInfo();
    expect(info.f_owner.defaultValue ?? null).toBeNull();
    expect(await driver.detectManagedDrift(fieldZoo as any)).toEqual([]);

    await driver.create('field_zoo', { id: 'after', title: 'C' }, { bypassTenantAudit: true });
    const row = await knexInstance('field_zoo').where('id', 'after').first();
    expect(row.f_owner).toBeNull();
  });

  it('the repair does NOT rewrite rows that already hold the bogus value (#4551: report, never rewrite)', async () => {
    const driver = makeDriver({ autoMigrate: 'safe', schemaMode: 'managed' });
    await seedPreFixTable();
    await driver.initObjects(fieldZoo as any);

    const rows = await knexInstance('field_zoo').whereIn('id', ['IFMh0g', 'TP2KMq']).orderBy('id');
    expect(rows.map((r: any) => r.f_owner)).toEqual(['current_user', 'current_user']);
    // …and nothing else about them moved either.
    expect(rows.map((r: any) => r.title)).toEqual(['A', 'B']);
  });

  it('the SQLite rebuild keeps every OTHER declared default (a NOW() sibling is not collateral)', async () => {
    const driver = makeDriver({ autoMigrate: 'safe', schemaMode: 'managed' });
    await seedPreFixTable();
    await driver.initObjects(fieldZoo as any);

    // The rebuild re-materializes defaults from METADATA, so the sibling
    // columns come back with exactly the defaults `createColumn` would emit.
    const info = await knexInstance('field_zoo').columnInfo();
    expect(String(info.f_seen_at.defaultValue ?? '')).toContain('strftime');
    expect(String(info.f_status.defaultValue ?? '')).toContain('open');

    await driver.create('field_zoo', { id: 'post', title: 'D' }, { bypassTenantAudit: true });
    const row = await knexInstance('field_zoo').where('id', 'post').first();
    expect(row.f_seen_at).toMatch(ISO_Z);
    expect(row.f_status).toBe('open');
  });

  it('a column whose DEFAULT is a real literal is never mistaken for a token default', async () => {
    // Guard against an over-eager repair: only the token's own spelling is the
    // fingerprint of a default the platform itself emitted from a token.
    const driver = makeDriver();
    await knexInstance.raw(`
      CREATE TABLE picky (
        id varchar(255) not null primary key,
        created_at datetime,
        updated_at datetime,
        owner varchar(255) default 'usr_house_account'
      )
    `);
    const meta = [
      { name: 'picky', fields: { owner: { type: 'user', reference: 'sys_user', defaultValue: DEFAULT_VALUE_TOKEN_CURRENT_USER } } },
    ];
    await driver.initObjects(meta as any);
    expect(await driver.detectManagedDrift(meta as any)).toEqual([]);
  });
});
