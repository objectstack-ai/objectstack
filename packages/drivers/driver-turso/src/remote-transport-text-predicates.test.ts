// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Text predicates over the REMOTE transport (#1004) — the text-axis twin of the
 * temporal seam #937 / #1003 closed.
 *
 * `buildWhereSQL` carried exactly one LIKE arm (`$contains`). Every other text
 * predicate the spec declares — `$startsWith`, `$endsWith`, `$notContains` —
 * fell through `default:` and was compiled to `"col" = ?` against a SUBSTRING,
 * which equals nothing, so each returned the empty set on a table where local
 * mode returned rows. `$exists` fell the same way (`"col" = 1`).
 *
 * The measurement instrument is the same one #937 needed and for the same
 * reason: a mis-compiled predicate leaves the SQL perfectly valid, just wrong,
 * so the mocked-`execute` suites' string assertions sail straight past it. Rows
 * are the only witness — hence `makeLibsqlSqliteStub` (better-sqlite3 wearing
 * the `@libsql/client` interface).
 *
 * Two invariants are under test, and the second is the one that let this family
 * hide for so long:
 *
 * 1. every declared operator compiles to the SAME rows local mode returns;
 * 2. an operator the transport does NOT implement THROWS. Silently degrading to
 *    equality is what turned three missing arms into three empty result sets
 *    instead of three loud errors.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { RemoteTransport } from './remote-transport.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const TEXT_OBJECT = {
  name: 'widget',
  fields: { name: { type: 'string' }, note: { type: 'string' } },
};

/** The fixture from the issue, plus a null-`note` row for `$null` / `$exists`. */
const ROWS = [
  { id: 'w1', name: 'Alpha', note: 'first' },
  { id: 'w2', name: 'Alpine', note: null },
  { id: 'w3', name: 'Beta', note: 'third' },
];

/** LIKE metacharacters must match literally, never as wildcards (P0 bypass). */
const META_ROWS = [
  { id: 'm1', name: '50% off sale' },
  { id: 'm2', name: 'plain title' },
  { id: 'm3', name: 'a_b underscore' },
  { id: 'm4', name: 'back\\slash' },
];

async function makeRemoteDriver(schema: Record<string, unknown>, rows: Record<string, unknown>[]) {
  const stub = makeLibsqlSqliteStub();
  const driver = new TursoDriver({ url: 'libsql://text.turso.io', client: stub as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await driver.syncSchema(schema.name as string, schema);
  for (const row of rows) await driver.create(schema.name as string, row);
  return { driver, stub };
}

const ids = async (driver: TursoDriver, object: string, where: unknown) =>
  ((await driver.find(object, { where })) as any[]).map((r) => r.id).sort();

describe('TursoDriver remote — declared text predicates return rows', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    ({ driver, stub } = await makeRemoteDriver(TEXT_OBJECT, ROWS));
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  it('seeded the fixture (the premise)', () => {
    const seeded = stub.raw.prepare('select id from widget order by id').all();
    expect(seeded).toHaveLength(3);
  });

  // The three rows of the issue's measured table. Each returned [] pre-fix.
  it('$startsWith matches the prefix, not an equality', async () => {
    expect(await ids(driver, 'widget', { name: { $startsWith: 'Alp' } })).toEqual(['w1', 'w2']);
  });

  it('$endsWith matches the suffix, not an equality', async () => {
    expect(await ids(driver, 'widget', { name: { $endsWith: 'ta' } })).toEqual(['w3']);
  });

  it('$notContains excludes the substring holders', async () => {
    expect(await ids(driver, 'widget', { name: { $notContains: 'lp' } })).toEqual(['w3']);
  });

  it('$contains still matches a substring', async () => {
    expect(await ids(driver, 'widget', { name: { $contains: 'lp' } })).toEqual(['w1', 'w2']);
  });

  // Not spec-declared: better-auth's adapter emits `$regex` for a plain
  // substring search, and SqlDriver compiles it as one. Remote must agree or a
  // Turso-backed auth store answers differently from a local one.
  it('$regex compiles as the substring search its only producer means', async () => {
    expect(await ids(driver, 'widget', { name: { $regex: 'lph' } })).toEqual(['w1']);
  });

  it('$null: true / false select the null and non-null rows', async () => {
    expect(await ids(driver, 'widget', { note: { $null: true } })).toEqual(['w2']);
    expect(await ids(driver, 'widget', { note: { $null: false } })).toEqual(['w1', 'w3']);
  });

  it('$exists: true / false are the inverse pair of $null', async () => {
    expect(await ids(driver, 'widget', { note: { $exists: true } })).toEqual(['w1', 'w3']);
    expect(await ids(driver, 'widget', { note: { $exists: false } })).toEqual(['w2']);
  });

  it('text predicates compose under $and / $or', async () => {
    expect(
      await ids(driver, 'widget', {
        $or: [{ name: { $startsWith: 'Alp' } }, { name: { $endsWith: 'ta' } }],
      }),
    ).toEqual(['w1', 'w2', 'w3']);
    expect(
      await ids(driver, 'widget', {
        $and: [{ name: { $startsWith: 'Alp' } }, { name: { $endsWith: 'ne' } }],
      }),
    ).toEqual(['w2']);
  });

  it('count() answers the same predicate find() does', async () => {
    expect(await driver.count('widget', { where: { name: { $startsWith: 'Alp' } } })).toBe(2);
  });
});

describe('TursoDriver remote — LIKE metacharacters match literally', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    ({ driver, stub } = await makeRemoteDriver({ name: 'meta', fields: { name: { type: 'string' } } }, META_ROWS));
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  // Unescaped, `%` expands to `%%%` and matches EVERY row — the filter bypass
  // framework's `sql-driver-like-escape.test.ts` pins on the local driver.
  it('a "%" comparand matches only rows holding a literal %', async () => {
    expect(await ids(driver, 'meta', { name: { $contains: '%' } })).toEqual(['m1']);
    expect(await ids(driver, 'meta', { name: { $startsWith: '50%' } })).toEqual(['m1']);
    expect(await ids(driver, 'meta', { name: { $endsWith: '% off sale' } })).toEqual(['m1']);
  });

  it('a "_" comparand matches a literal _, not any single character', async () => {
    expect(await ids(driver, 'meta', { name: { $contains: '_' } })).toEqual(['m3']);
    expect(await ids(driver, 'meta', { name: { $startsWith: 'a_' } })).toEqual(['m3']);
  });

  it('a backslash comparand matches a literal backslash', async () => {
    expect(await ids(driver, 'meta', { name: { $contains: '\\' } })).toEqual(['m4']);
  });

  it('$notContains escapes too — a "%" must not exclude every row', async () => {
    expect(await ids(driver, 'meta', { name: { $notContains: '%' } })).toEqual(['m2', 'm3', 'm4']);
  });

  it('an ordinary substring is unaffected by the escaping', async () => {
    expect(await ids(driver, 'meta', { name: { $contains: 'sale' } })).toEqual(['m1']);
  });
});

/**
 * The invariant the missing arms cost us: declared = enforced. An operator this
 * transport cannot compile must fail loudly, because the alternative — the old
 * `default:` equality — is indistinguishable from "no rows matched".
 */
describe('RemoteTransport — unknown operators throw instead of degrading', () => {
  function transportWithCapturingClient() {
    const calls: Array<{ sql: string; args: any[] }> = [];
    const client = {
      execute: vi.fn(async (stmt: any) => {
        calls.push({ sql: stmt.sql ?? String(stmt), args: stmt.args ?? [] });
        return { rows: [], columns: [] };
      }),
      close: vi.fn(),
    };
    const t = new RemoteTransport();
    t.setClient(client as any);
    return { t, calls };
  }

  it('rejects an operator it does not implement', async () => {
    const { t, calls } = transportWithCapturingClient();
    await expect(t.find('widget', { where: { name: { $bogus: 'x' } } })).rejects.toThrow(
      /\$bogus.*widget\.name/s,
    );
    expect(calls, 'must refuse before executing anything').toHaveLength(0);
  });

  it('rejects a null-comparand unknown operator too (the IS NULL accident)', async () => {
    // `{ $bogus: null }` used to land on `IS NULL` and look plausible.
    const { t } = transportWithCapturingClient();
    await expect(t.find('widget', { where: { name: { $bogus: null } } })).rejects.toThrow(/\$bogus/);
  });

  it('rejects $between at the transport, naming the driver that must lower it', async () => {
    // TursoDriver lowers `$between` to `$gte`/`$lte` (#1003) so the calendar-day
    // rule is applied once. Reaching the transport means that step was skipped.
    const { t } = transportWithCapturingClient();
    await expect(
      t.find('widget', { where: { at: { $between: ['2026-01-01', '2026-02-01'] } } }),
    ).rejects.toThrow(/\$between.*TursoDriver/s);
  });

  it('rejects an unknown operator nested inside $and / $or', async () => {
    const { t } = transportWithCapturingClient();
    await expect(
      t.find('widget', { where: { $or: [{ name: { $eq: 'a' } }, { name: { $bogus: 'b' } }] } }),
    ).rejects.toThrow(/\$bogus/);
  });

  it('the throw reaches callers through count / updateMany / deleteMany too', async () => {
    const { t } = transportWithCapturingClient();
    const where = { name: { $bogus: 'x' } };
    await expect(t.count('widget', { where })).rejects.toThrow(/\$bogus/);
    await expect(t.updateMany('widget', { where }, { name: 'y' })).rejects.toThrow(/\$bogus/);
    await expect(t.deleteMany('widget', { where })).rejects.toThrow(/\$bogus/);
  });
});

describe('RemoteTransport — text predicates bind an explicit ESCAPE', () => {
  it('emits LIKE … ESCAPE and binds the escaped pattern, not the raw value', async () => {
    const calls: Array<{ sql: string; args: any[] }> = [];
    const client = {
      execute: vi.fn(async (stmt: any) => {
        calls.push({ sql: stmt.sql ?? String(stmt), args: stmt.args ?? [] });
        return { rows: [], columns: [] };
      }),
      close: vi.fn(),
    };
    const t = new RemoteTransport();
    t.setClient(client as any);

    await t.find('widget', { where: { name: { $startsWith: '50%' } } });
    const { sql, args } = calls[0];
    // SQLite honours no default escape character, so the clause must be explicit.
    expect(sql).toMatch(/"name"\s+LIKE\s+\?\s+ESCAPE\s+'\\'/i);
    expect(args).toEqual(['50\\%%']);
  });
});
