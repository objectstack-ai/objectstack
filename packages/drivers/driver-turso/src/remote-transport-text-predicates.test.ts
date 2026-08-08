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
import type { DriverQuery } from '@objectstack/spec/contracts';
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
  // [#5702] The stub is wrapped so the STATEMENTS are readable, not only the
  // rows. #5702 needed that because `$icontains`'s fold was invisible in rows
  // on SQLite — `LIKE` already folded ASCII there, so a dropped `LOWER()`
  // changed no answer. [#6518] retires that reason: under `GLOB` the fold IS
  // observable in rows, and the cases below assert it there. The recording
  // stays, now pinning the CONSTRUCT (which operator, with which escapes) —
  // still the only place a silent revert to `LIKE` would show up before its
  // rows did.
  const executed: string[] = [];
  const recording: LibsqlSqliteStub = {
    ...stub,
    async execute(stmt: unknown) {
      executed.push(typeof stmt === 'string' ? stmt : String((stmt as { sql?: unknown }).sql ?? ''));
      return stub.execute(stmt);
    },
  };
  const driver = new TursoDriver({ url: 'libsql://text.turso.io', client: recording as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await driver.syncSchema(schema.name as string, schema);
  for (const row of rows) await driver.create(schema.name as string, row);
  return { driver, stub, executed };
}

const ids = async (driver: TursoDriver, object: string, where: DriverQuery['where']) =>
  ((await driver.find(object, { where })) as any[]).map((r) => r.id).sort();

describe('TursoDriver remote — declared text predicates return rows', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;
  let executed: string[];

  beforeAll(async () => {
    ({ driver, stub, executed } = await makeRemoteDriver(TEXT_OBJECT, ROWS));
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

  /**
   * [#5702] REPLACED. This slot held `$regex compiles as the substring search
   * its only producer means` — `{ name: { $regex: 'lph' } } → ['w1']` — kept in
   * lockstep with `SqlDriver`'s identical fallthrough so a Turso-backed auth
   * store answered like a local one. #5710 flipped that producer to `$contains`
   * and #4706 retired the spelling on all five backends, so the row it pinned
   * no longer exists.
   *
   * What takes its place is the operator that replaces it. `$icontains` is
   * REMOTE-side work in its own right: this transport does not go through knex,
   * it hand-assembles its own `LIKE`, so "local inherits SqlDriver" buys it
   * nothing — the fold has to be written here too, and the only witness that it
   * was is rows.
   */
  it('$icontains folds ASCII case, in both directions', async () => {
    expect(await ids(driver, 'widget', { name: { $icontains: 'alp' } })).toEqual(['w1', 'w2']);
    expect(await ids(driver, 'widget', { name: { $icontains: 'ALP' } })).toEqual(['w1', 'w2']);
    // The fold must run on BOTH operands: folding only the comparand leaves the
    // column raw and quietly matches nothing here, since no row is lower-case.
    expect(await ids(driver, 'widget', { name: { $icontains: 'BETA' } })).toEqual(['w3']);
  });

  /**
   * [#6518] The case #5702 had to write BACKWARDS, now written forwards.
   *
   * #5702 wanted to pin `$contains: 'ALP'` → `[]` beside `$icontains: 'ALP'` →
   * `['w1','w2']`, i.e. the two operators told apart by their ANSWERS. It could
   * not: `$contains` returned `['w1','w2']` too, because SQLite's `LIKE` folds
   * ASCII case by itself, so `col LIKE '%ALP%'` and `LOWER(col) LIKE
   * LOWER('%ALP%')` selected the same rows for EVERY comparand. That file
   * recorded the equality as the honest pin and named the missing half: the
   * #4706 Q2 = A ruling that the `$contains` family is case-SENSITIVE.
   *
   * This is that half. `pushLike` emits `GLOB`, which is case-exact by
   * definition, so the pin #5702 wanted is the one that now holds — and it
   * fails loudly on a revert to `LIKE`, which the equality it replaces could
   * not do.
   */
  it('$contains is case-SENSITIVE, and now answers differently from $icontains', async () => {
    expect(await ids(driver, 'widget', { name: { $contains: 'ALP' } })).toEqual([]);
    expect(await ids(driver, 'widget', { name: { $contains: 'Alp' } })).toEqual(['w1', 'w2']);
    expect(await ids(driver, 'widget', { name: { $icontains: 'ALP' } })).toEqual(['w1', 'w2']);
  });

  it('$startsWith and $endsWith are case-SENSITIVE too', async () => {
    expect(await ids(driver, 'widget', { name: { $startsWith: 'alp' } })).toEqual([]);
    expect(await ids(driver, 'widget', { name: { $startsWith: 'Alp' } })).toEqual(['w1', 'w2']);
    expect(await ids(driver, 'widget', { name: { $endsWith: 'ETA' } })).toEqual([]);
    expect(await ids(driver, 'widget', { name: { $endsWith: 'eta' } })).toEqual(['w3']);
  });

  it('$icontains compiles lower() on BOTH operands, where $contains compiles neither', async () => {
    executed.length = 0;
    await driver.find('widget', { where: { name: { $icontains: 'ALP' } } });
    const icontainsSql = executed.join('\n');
    expect(icontainsSql).toContain('lower("name") GLOB lower(?)');
    // GLOB has no ESCAPE clause in SQLite's grammar — emitting one is a syntax
    // error, so its absence is part of the construct rather than an omission.
    expect(icontainsSql).not.toContain('ESCAPE');

    executed.length = 0;
    await driver.find('widget', { where: { name: { $contains: 'ALP' } } });
    const containsSql = executed.join('\n');
    expect(containsSql).toContain('"name" GLOB ?');
    expect(containsSql).not.toContain('lower');
    expect(containsSql).not.toContain('LIKE');
  });

  it('REFUSES the retired $regex, in the ADR-0112 envelope, naming $icontains', async () => {
    const err = await driver
      .find('widget', { where: { name: { $regex: 'lph' } } })
      .then(() => null, (e: any) => e);
    expect(err).toBeInstanceOf(Error);
    // `code` and `status`, not a bare rejection: this transport's whole family
    // of filter refusals exists to be a 400-class client error rather than an
    // opaque 500, and `rejects.toThrow()` alone cannot tell the two apart.
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('$regex');
    expect(err.message).toContain('$icontains');
  });

  it('REFUSES an $icontains comparand that constrains nothing', async () => {
    for (const comparand of ['', 42]) {
      const err = await driver
        .find('widget', { where: { name: { $icontains: comparand } } })
        .then(() => null, (e: any) => e);
      expect(err, `expected ${JSON.stringify(comparand)} to be refused`).toBeInstanceOf(Error);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$icontains');
    }
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

  /**
   * [#5702] The same three metacharacters, through `$icontains`.
   *
   * Written out per character rather than once, because the escape is the P0
   * here and `$icontains` reaches it through a NEW parameter of `pushLike`
   * (`fold`) that wraps both operands in `LOWER()`. A fold implemented as a
   * second emitter — the obvious shape, and the one this parameter exists to
   * avoid — would have re-derived the pattern without the `%`/`_`/`\` class,
   * and an unescaped `%` matches every row.
   */
  it('$icontains escapes "%" — a "%" comparand must not match every row', async () => {
    expect(await ids(driver, 'meta', { name: { $icontains: '%' } })).toEqual(['m1']);
    expect(await ids(driver, 'meta', { name: { $icontains: '% OFF' } })).toEqual(['m1']);
  });

  it('$icontains escapes "_" — a literal underscore, not any single character', async () => {
    expect(await ids(driver, 'meta', { name: { $icontains: '_' } })).toEqual(['m3']);
    expect(await ids(driver, 'meta', { name: { $icontains: 'A_B' } })).toEqual(['m3']);
  });

  it('$icontains escapes "\\" — a literal backslash, not the escape character', async () => {
    expect(await ids(driver, 'meta', { name: { $icontains: '\\' } })).toEqual(['m4']);
    expect(await ids(driver, 'meta', { name: { $icontains: 'BACK\\SLASH' } })).toEqual(['m4']);
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

describe('RemoteTransport — text predicates bind an ESCAPED pattern, never the raw value', () => {
  /**
   * [#6518] What this case pins survived the operator change; the character
   * class it pins did not.
   *
   * Under `LIKE` the metacharacters were `%` and `_` and the answer was an
   * explicit `ESCAPE '\'` clause, because SQLite honours no default escape
   * character. Under `GLOB` the metacharacters are `*`, `?` and `[`, there is
   * no `ESCAPE` clause in the grammar at all, and the escape mechanism is a
   * self-closing character class. So `%` needs no escape here any more — and
   * `*` needs one it did not need before. Both directions are asserted, because
   * a half-migrated escape rule is precisely the P0 this case exists for.
   */
  const captureOne = async (where: Record<string, unknown>) => {
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
    await t.find('widget', { where });
    return calls[0];
  };

  it('emits GLOB with no ESCAPE clause, and leaves the LIKE metacharacters alone', async () => {
    const { sql, args } = await captureOne({ name: { $startsWith: '50%' } });
    expect(sql).toMatch(/"name"\s+GLOB\s+\?/i);
    expect(sql).not.toMatch(/ESCAPE/i);
    // `%` is an ordinary character to GLOB, so it travels unescaped.
    expect(args).toEqual(['50%*']);
  });

  it('escapes the GLOB metacharacters as self-closing classes', async () => {
    expect((await captureOne({ name: { $contains: '*' } })).args).toEqual(['*[*]*']);
    expect((await captureOne({ name: { $contains: '?' } })).args).toEqual(['*[?]*']);
    expect((await captureOne({ name: { $contains: '[' } })).args).toEqual(['*[[]*']);
    // Unescaped, `*a*b*` is a wildcard pattern rather than a literal — the same
    // filter bypass an unescaped `%` was under LIKE.
    expect((await captureOne({ name: { $contains: 'a*b' } })).args).toEqual(['*a[*]b*']);
  });
});
