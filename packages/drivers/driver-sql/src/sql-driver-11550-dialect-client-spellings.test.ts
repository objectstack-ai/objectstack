// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11550 — `client: 'postgres'` is knex's own CANONICAL name for the Postgres
 * dialect, and `SqlDriver` did not recognise it.
 *
 * ## The defect this suite pins
 *
 * `SqlDriverConfig` is `Knex.Config & {…}`, so the DECLARED surface is every
 * client name knex accepts. The three identity getters enforced two literals
 * each, and `postgres` was in neither pair — so `isPostgres` answered **false**
 * on a config knex considers valid, and every Postgres branch in the driver
 * silently stopped applying.
 *
 * The branch worth pinning is {@link SqlDriver.nowColumnDefault}, not the getter:
 * a `getter === true` assertion still passes for a refactor that breaks what the
 * getter feeds. With `client: 'postgres'` the method fell through to
 * `knex.fn.now()` — a bare `CURRENT_TIMESTAMP` default on a `DATE` column, which
 * resolves the calendar day in the SERVER's timezone. That is *the exact defect*
 * the Postgres branch was added to remove ("measured: a UTC-12 server records
 * YESTERDAY", per the method's own docblock). Nothing threw; the column was just
 * created wrong.
 *
 * ## Why the sweep reads knex's tables instead of copying them
 *
 * "Which spellings mean one dialect" is knex's fact, not ours. The sweep below
 * loads `CLIENT_ALIASES` / `SUPPORTED_CLIENTS` out of the INSTALLED knex and
 * asserts an alias-CLOSURE property: if the driver recognises any spelling of a
 * dialect, it must recognise every spelling knex resolves to the same canon. A
 * hand-copied list would keep passing after a knex upgrade changed the answer.
 *
 * ## What this suite deliberately does NOT decide
 *
 * Whether `redshift` and `cockroachdb` — separate knex dialects that speak the
 * pg WIRE protocol — should be treated as Postgres for SQL EMISSION is a
 * support-scope question, open as **#11756**. The cases under "emission is not
 * wire" pin the current, deliberate asymmetry so that a convergence refactor
 * cannot answer #11756 as a side effect. When #11756 is decided, those cases are
 * the ones that must be consciously rewritten — that is their job.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { SqlDriver } from './sql-driver.js';

// ── knex's own vocabulary, read from the pinned install ──────────────────────

const req = createRequire(import.meta.url);
/**
 * `knex/lib/constants.js` is not a declared subpath export, so it is loaded by
 * absolute path off the resolved package entry. Reading the REAL table is the
 * whole point: it is what makes the closure assertion below fail loudly on a
 * knex upgrade that changes which spellings alias which dialect.
 */
const KNEX_CONSTANTS: {
  CLIENT_ALIASES: Record<string, string>;
  SUPPORTED_CLIENTS: readonly string[];
} = req(path.join(path.dirname(req.resolve('knex')), 'lib', 'constants.js'));

const { CLIENT_ALIASES, SUPPORTED_CLIENTS } = KNEX_CONSTANTS;

/** knex's canonical dialect name for one client spelling. */
const canon = (spelling: string): string => CLIENT_ALIASES[spelling] ?? spelling;

// ── Probes ───────────────────────────────────────────────────────────────────

/** Exposes the protected dialect surface without opening a connection. */
class ProbeDriver extends SqlDriver {
  get flags(): { sqlite: boolean; postgres: boolean; mysql: boolean } {
    return { sqlite: this.isSqlite, postgres: this.isPostgres, mysql: this.isMysql };
  }
  get dialect(): string {
    return this.dialectName;
  }
  nowDefaultSql(type: string): string {
    return this.nowColumnDefault(type).toString();
  }
  /**
   * Re-spell the DECLARED client after construction.
   *
   * Needed because this workspace installs `pg`, `mysql2` and `better-sqlite3`
   * only — knex resolves a dialect's npm driver eagerly in its constructor, so
   * `client: 'sqlite3'`, `'sqlite'`, `'mysql'` and `'mariadb'` cannot be
   * instantiated here at all (asserted below, so this stand-in stays justified
   * rather than merely convenient). The getters read `this.config.client` on
   * every call, so this exercises exactly the decision a host with those
   * packages installed would get. Every case that CAN construct the real thing
   * — `postgres` above all — does so instead.
   */
  respell(client: string): this {
    (this.config as { client?: unknown }).client = client;
    return this;
  }
}

const opened: SqlDriver[] = [];
function make(client: string): ProbeDriver {
  const d = new ProbeDriver(
    client === 'better-sqlite3'
      ? ({ client, connection: { filename: ':memory:' }, useNullAsDefault: true } as any)
      : ({ client, connection: { host: '127.0.0.1', port: 1, user: 'u', database: 'd' } } as any),
  );
  opened.push(d);
  return d;
}
/** A driver whose knex is a real (unconnected) SQLite one, re-spelled for the probe. */
const respelled = (client: string): ProbeDriver => make('better-sqlite3').respell(client);

afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.disconnect().catch(() => {})));
});

describe("#11550 — knex's alias table is the vocabulary, not a pair of literals", () => {
  it('the premise: knex accepts `postgres`/`sqlite` and aliases the rest onto them', () => {
    // If any of this stops holding, the fix below is aimed at the wrong target
    // and the whole suite must be re-read rather than quietly kept green.
    expect(SUPPORTED_CLIENTS).toContain('postgres');
    expect(SUPPORTED_CLIENTS).toContain('sqlite');
    expect(CLIENT_ALIASES).toMatchObject({ pg: 'postgres', postgresql: 'postgres', sqlite: 'sqlite3' });
  });

  it('knex resolves pg/postgres/postgresql to ONE dialect and ONE driver', () => {
    // knex's own answer to "are these the same database", asserted from a live
    // client rather than from its docs.
    for (const spelling of ['pg', 'postgres', 'postgresql']) {
      const client = (make(spelling) as any).knex.client;
      expect(client.dialect, spelling).toBe('postgresql');
      expect(client.driverName, spelling).toBe('pg');
    }
  });

  it('the stand-in is necessary: this workspace cannot instantiate sqlite3/mysql/mariadb', () => {
    // Justifies `respell()`. `sqlite3`, `mysql` and `mariadb` are real knex
    // clients whose npm drivers this repo does not install, so knex throws in
    // its own constructor before any driver code runs.
    for (const spelling of ['sqlite3', 'sqlite', 'mysql', 'mariadb']) {
      expect(() => make(spelling), spelling).toThrow(/Cannot find module|Knex: run/);
    }
  });
});

describe('#11550 — the branch the defect was measured in', () => {
  // The card's own reproduction, on a driver constructed exactly as a host
  // would: `client: 'postgres'`, no re-spelling anywhere in this block.
  it("`client: 'postgres'` selects nowColumnDefault's Postgres DATE branch", () => {
    const sql = make('postgres').nowDefaultSql('date');
    expect(sql).toContain("timezone('utc', now())::date");
    // The fall-through this card is about: a bare CURRENT_TIMESTAMP default on
    // a DATE column resolves the calendar day in the SERVER's timezone.
    expect(sql.toUpperCase()).not.toContain('CURRENT_TIMESTAMP');
  });

  it("`client: 'postgres'` selects nowColumnDefault's Postgres TIME branch", () => {
    const sql = make('postgres').nowDefaultSql('time');
    expect(sql).toContain("timezone('utc', now())::time(3)");
    expect(sql.toUpperCase()).not.toContain('CURRENT_TIMESTAMP');
  });

  it('an alias and the canon emit byte-identical DDL defaults', () => {
    // The point of the fix stated as an equality: three spellings, one dialect,
    // one emitted default. Covers `datetime` too, where both correctly keep
    // knex.fn.now() — so this case also proves the sweep is not just asserting
    // "everything is a Postgres expression".
    for (const type of ['date', 'time', 'datetime']) {
      const viaCanon = make('postgres').nowDefaultSql(type);
      expect(make('pg').nowDefaultSql(type), `pg/${type}`).toBe(viaCanon);
      expect(make('postgresql').nowDefaultSql(type), `postgresql/${type}`).toBe(viaCanon);
    }
    expect(make('postgres').nowDefaultSql('datetime').toUpperCase()).toContain('CURRENT_TIMESTAMP');
  });

  it("`client: 'sqlite'` selects the SQLite strftime branch", () => {
    const d = respelled('sqlite');
    expect(d.flags).toMatchObject({ sqlite: true, postgres: false, mysql: false });
    expect(d.dialect).toBe('sqlite');
    expect(d.nowDefaultSql('date')).toContain("strftime('%Y-%m-%d'");
  });

  it("`client: 'postgres'` reaches the drift differ as 'postgres', not 'unknown'", () => {
    // `dialectName` feeds schema-drift; 'unknown' there disables every
    // dialect-aware comparison, which is the same silent degradation one layer up.
    expect(make('postgres').dialect).toBe('postgres');
  });
});

describe('#11550 — identity across every spelling knex supports', () => {
  /** What the driver answers for each of knex's supported client spellings. */
  const recognised = (family: 'sqlite' | 'postgres' | 'mysql'): string[] =>
    SUPPORTED_CLIENTS.filter((c) => respelled(c).flags[family]).sort();

  it('recognition is closed under knex aliasing', () => {
    // The invariant the two-literal getters violated: recognising `pg` while
    // rejecting `postgres` means recognising an alias of a dialect whose own
    // canonical name is unrecognised.
    for (const family of ['sqlite', 'postgres', 'mysql'] as const) {
      const set = new Set(recognised(family));
      for (const spelling of set) {
        for (const other of SUPPORTED_CLIENTS) {
          if (canon(other) !== canon(spelling)) continue;
          expect(set, `${family}: ${spelling} recognised but ${other} is not`).toContain(other);
        }
      }
    }
  });

  it('resolves the exact expected spelling table', () => {
    // Names every answer, so a widening cannot slip in unannounced — and so the
    // spellings that already worked are pinned as UNCHANGED. Sibling cards this
    // round select behaviour through these getters with `pg` / `mysql2`.
    expect(recognised('postgres')).toEqual(['pg', 'postgres', 'postgresql']);
    expect(recognised('sqlite')).toEqual(['better-sqlite3', 'sqlite', 'sqlite3']);
    expect(recognised('mysql')).toEqual(['mysql', 'mysql2']);
  });

  it('no spelling is claimed by two families, and unknown clients stay unknown', () => {
    for (const spelling of SUPPORTED_CLIENTS) {
      const f = respelled(spelling).flags;
      expect(Number(f.sqlite) + Number(f.postgres) + Number(f.mysql), spelling).toBeLessThanOrEqual(1);
    }
    // A bring-your-own Client CONSTRUCTOR names no spelling in any table.
    const byConstructor = make('better-sqlite3');
    (byConstructor as any).config.client = class {};
    expect(byConstructor.flags).toEqual({ sqlite: false, postgres: false, mysql: false });
    expect(byConstructor.dialect).toBe('unknown');
  });
});

describe('#11550 — emission identity is not wire identity (#11756 stays open)', () => {
  const emit = (name: string): ReadonlySet<string> => (SqlDriver as any)[name];

  it('redshift and cockroachdb parse pg wire but do NOT emit Postgres DDL', () => {
    // ⚠️ These two cases are the deliberate, currently-undecided asymmetry.
    // Rewriting them is how #11756 gets answered — not by a refactor quietly
    // merging the tables.
    for (const spelling of ['redshift', 'cockroachdb']) {
      const d = respelled(spelling);
      expect(d.flags, spelling).toEqual({ sqlite: false, postgres: false, mysql: false });
      expect(d.dialect, spelling).toBe('unknown');
      // The consequence, spelled out: they keep the CURRENT_TIMESTAMP default.
      expect(d.nowDefaultSql('date').toUpperCase(), spelling).toContain('CURRENT_TIMESTAMP');
      // …while still getting the #11389 calendar-day wire hook.
      expect(emit('POSTGRES_WIRE_CLIENTS'), spelling).toContain(spelling);
    }
  });

  it('the wire set EXTENDS the emission set, never the reverse', () => {
    const wire = emit('POSTGRES_WIRE_CLIENTS');
    for (const spelling of emit('POSTGRES_EMIT_CLIENTS')) expect(wire).toContain(spelling);
    expect([...wire].sort()).toEqual(
      ['cockroachdb', 'pg', 'postgres', 'postgresql', 'redshift'],
    );
  });

  it('mariadb is a separate knex dialect and is not MySQL for emission', () => {
    expect(SUPPORTED_CLIENTS).toContain('mariadb');
    expect(respelled('mariadb').flags.mysql).toBe(false);
  });
});

describe('#11550 — the client-keyed tables now derive from one source', () => {
  const table = (): Record<string, { key: string; urlKey: string }> =>
    (SqlDriver as any).DIALECT_CONNECT_TIMEOUT;

  it('the connect-timeout table covers every emission spelling of pg and mysql', () => {
    // The drift the card measured, expressed as an invariant: a spelling the
    // getters accept can no longer be one the timeout table has never heard of.
    for (const spelling of (SqlDriver as any).POSTGRES_EMIT_CLIENTS as Set<string>) {
      expect(table()[spelling], spelling).toEqual({
        key: 'connectionTimeoutMillis', urlKey: 'connectionString',
      });
    }
    for (const spelling of (SqlDriver as any).MYSQL_EMIT_CLIENTS as Set<string>) {
      expect(table()[spelling], spelling).toEqual({ key: 'connectTimeout', urlKey: 'uri' });
    }
  });

  it('deriving the table changed no membership', () => {
    // The refactor half must be a no-op. `redshift`'s ABSENCE is load-bearing —
    // `withConnectBound`'s comment cites it as the reason its early return may
    // not skip the session pins.
    expect(Object.keys(table()).sort()).toEqual(
      ['cockroachdb', 'mysql', 'mysql2', 'pg', 'postgres', 'postgresql'],
    );
  });

  it('the UTC session pin still fires for MySQL only', () => {
    // `withUtcSession` used to carry its own `mysql`/`mysql2` pair; it now reads
    // the shared set. Behaviour must be unchanged in both directions.
    //
    // Measured while writing this: BOTH families end up with a `pool.afterCreate`
    // — `postgres` gets the #11389 calendar-day WIRE hook — so the presence of
    // that function proves nothing about which pin was applied. The hooks are
    // therefore driven with a recording connection, which is the only thing that
    // tells them apart.
    const bound = (client: string): any =>
      (SqlDriver as any).withConnectBound({ client, connection: { host: 'h' } });
    /** Run a config's afterCreate against a stand-in that records what it is asked. */
    const drive = (cfg: any) => {
      const queries: string[] = [];
      const parsers: number[] = [];
      const connection = {
        query: (sql: string, cb: (e?: unknown) => void) => { queries.push(sql); cb(); },
        getTypeParser: () => (t: string) => t,
        setTypeParser: (oid: number) => { parsers.push(oid); },
      };
      cfg.pool.afterCreate(connection, () => {});
      return { queries, parsers };
    };

    // MySQL: the session pin, on both layers.
    expect(bound('mysql2').connection.timezone).toBe('Z');
    expect(drive(bound('mysql2')).queries).toEqual(["SET time_zone = '+00:00'"]);

    // Postgres, canonically spelled: no MySQL pin on either layer…
    expect(bound('postgres').connection.timezone).toBeUndefined();
    expect(drive(bound('postgres')).queries).toEqual([]);
    // …the wire hook it is entitled to…
    expect(drive(bound('postgres')).parsers).toContain(1082);
    // …and the pg connect bound, which the derived table must still supply.
    expect(bound('postgres').connection.connectionTimeoutMillis).toBe(10_000);
  });
});
