// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11991 — the #11756 ruling, pinned at the behaviour it decided.
 *
 * Maintainer, 2026-08-25, verbatim 「同意」 on 「C，但 pgnative 归入 Postgres
 * 家族」 (#11756, comment 5404884704). Three things follow, and this suite pins
 * each against the acceptance criterion the card wrote them as:
 *
 *   1. a `redshift` / `cockroachdb` configuration that reaches DDL emission
 *      receives ONE named, actionable refusal — code AND message;
 *   2. `pgnative` behaves identically to `pg` for emission, and carries the
 *      #11389 calendar-day wire parser pin;
 *   3. the emission-identity answer has exactly ONE source of truth.
 *
 * ## What was measured first, and why it is quoted here
 *
 * The refusal replaces a path that did NOT fail. Measured on `origin/main`
 * (b307bfd2ae) before the change, one `CREATE TABLE` compiled per client:
 *
 * ```
 * pg          create table "t" ("id" varchar(255), "body" text,
 *                               constraint "t_pkey" primary key ("id"))
 * pgnative    … byte-identical to pg …
 * cockroachdb … byte-identical to pg …
 * redshift    create table "t" ("id" varchar(255) not null, "body" varchar(max));
 *             alter table "t" add constraint "t_pkey" primary key ("id")
 * ```
 *
 * So the pre-ruling behaviour on Redshift was not an error — it was a table of
 * a different shape, built quietly, with the deployment finding out when it
 * wrote data. That is the whole argument for a loud refusal, and it is a
 * measurement rather than a claim about Redshift's documentation.
 *
 * ⚠️ `cockroachdb` compiles the SAME bytes as `pg` today. It is refused anyway,
 * and that is the ruling, not an oversight: byte-equality on ONE probe table is
 * not a measured DDL boundary, and #11756 explicitly declined to claim one
 * without measuring. Its reopening condition (a real customer, then a measured
 * boundary, the two databases judged separately) is recorded on that card.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import {
  DIALECT_EMISSION_UNSUPPORTED_CODE,
  DIALECT_EMISSION_UNSUPPORTED_STATUS,
  UnsupportedDialectEmissionError,
  renderDialectEmissionRefusal,
} from './dialect-emission-refusal.js';

/** The two databases the ruling refused for emission, and nothing else. */
const REFUSED = ['redshift', 'cockroachdb'] as const;

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
  /** Re-spell the DECLARED client after construction (see the #11550 suite). */
  respell(client: string): this {
    (this.config as { client?: unknown }).client = client;
    return this;
  }
  tableExists(name: string): Promise<boolean> {
    return (this as any).knex.schema.hasTable(name);
  }
}

const opened: SqlDriver[] = [];
/** A driver whose knex is a real, connectable in-memory SQLite one. */
function make(client = 'better-sqlite3'): ProbeDriver {
  const d = new ProbeDriver(
    { client, connection: { filename: ':memory:' }, useNullAsDefault: true } as any,
  );
  opened.push(d);
  return d;
}
const respelled = (client: string): ProbeDriver => make().respell(client);

afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.disconnect().catch(() => {})));
});

describe('#11991 — redshift/cockroachdb are refused at DDL emission, by name', () => {
  it('initObjects refuses with ONE coded, actionable error', async () => {
    for (const client of REFUSED) {
      const d = respelled(client);
      // The real entry point a boot uses, not the gate helper: this is the
      // path a deployment actually reaches.
      const err = await d
        .initObjects([{ name: 'thing', fields: { title: { type: 'text' } } }])
        .then(() => null, (e: unknown) => e);

      expect(err, client).toBeInstanceOf(UnsupportedDialectEmissionError);
      const e = err as UnsupportedDialectEmissionError;
      // ADR-0112: the machine-readable half. `code` AND `status`, because a
      // code with no status leaves every HTTP exit answering 500 with the code
      // dropped at the boundary (#7739) — the failure mode that motivated the
      // federation family declaring its own statuses.
      expect(e.code, client).toBe('SQL_DIALECT_EMISSION_UNSUPPORTED');
      expect(e.code, client).toBe(DIALECT_EMISSION_UNSUPPORTED_CODE);
      expect(e.status, client).toBe(501);
      expect(e.status, client).toBe(DIALECT_EMISSION_UNSUPPORTED_STATUS);
      // The structured half a host renders from instead of parsing prose.
      expect(e.client, client).toBe(client);
      expect(e.operation, client).toBe('initObjects');
    }
  });

  it('the message names the client, the supported set and the way out', async () => {
    const d = respelled('redshift');
    const err = (await d.initObjects([{ name: 'thing' }]).then(
      () => null,
      (e: unknown) => e,
    )) as UnsupportedDialectEmissionError;

    // Pinned against the SAME renderer the driver throws through — a message
    // asserted by pasting its text into a test pins the test, not the product.
    expect(err.message).toBe(
      renderDialectEmissionRefusal('redshift', 'initObjects', err.supportedClients),
    );

    // …and the renderer's three obligations, asserted on the rendered string so
    // a future edit that drops one is red here rather than merely different.
    expect(err.message).toContain("knex client 'redshift'");
    expect(err.message).toContain('Supported clients for schema emission');
    expect(err.message).toContain('skipSchemaSync');
    expect(err.message).toContain('OS_SKIP_SCHEMA_SYNC=1');

    // The supported list is DERIVED from the emission sets, never typed out:
    // every spelling the driver emits for appears, and the two refused ones do
    // not. This is what stops the guidance drifting from the behaviour — it is
    // how `pgnative` entered the sentence with no edit to the sentence.
    const emitted = [
      ...((SqlDriver as any).SQLITE_EMIT_CLIENTS as ReadonlySet<string>),
      ...((SqlDriver as any).POSTGRES_EMIT_CLIENTS as ReadonlySet<string>),
      ...((SqlDriver as any).MYSQL_EMIT_CLIENTS as ReadonlySet<string>),
    ].sort();
    expect([...err.supportedClients]).toEqual(emitted);
    expect(err.supportedClients).toContain('pgnative');
    for (const refused of REFUSED) expect(err.supportedClients).not.toContain(refused);
  });

  it('refuses BEFORE any DDL runs — nothing is half-built', async () => {
    // The ruling's phrase is "never a silently mis-built table". A refusal that
    // fired after the first CREATE would leave exactly that, so the ordering is
    // part of the contract and not an implementation detail.
    const d = respelled('cockroachdb');
    await expect(d.initObjects([{ name: 'thing', fields: { title: { type: 'text' } } }]))
      .rejects.toThrow(UnsupportedDialectEmissionError);
    // The underlying knex here is a real in-memory SQLite, so this is a genuine
    // round-trip against the database the driver would have written to.
    d.respell('better-sqlite3');
    expect(await d.tableExists('thing')).toBe(false);
  });

  it('the DDL-free half still works — the escape hatch the message names is real', async () => {
    // `skipSchemaSync` boots call `registerObjectMetadata` and stop (it is the
    // DDL-free sibling, no gate, no round-trip). If the refusal reached that
    // too, the guidance would be a dead end and these deployments would have no
    // supported posture at all — which is not what option C decided.
    const d = respelled('redshift');
    expect(() => d.registerObjectMetadata([{ name: 'thing', fields: { title: { type: 'text' } } }]))
      .not.toThrow();
  });

  it('reads and writes are untouched: the boundary is DDL only', async () => {
    // Wire recognition stays (#11389, deliberate, restated by the ruling). The
    // refusal must not have leaked into the query path — a driver that refused
    // everything would be option B with extra steps.
    const d = respelled('redshift');
    expect(d.flags).toEqual({ sqlite: false, postgres: false, mysql: false });
    expect((SqlDriver as any).POSTGRES_WIRE_CLIENTS).toContain('redshift');
    expect((SqlDriver as any).DIALECT_CONNECT_TIMEOUT['redshift'])
      .toEqual({ key: 'connectionTimeoutMillis', urlKey: 'connectionString' });
  });
});

describe('#11991 — pgnative is the Postgres family, for emission and for the wire', () => {
  it('emits byte-identical column defaults to `pg`, across every type', () => {
    // "Behaves identically to pg for emission" as an equality rather than a
    // description. `datetime` is included on purpose: both keep knex.fn.now()
    // there, so this also proves the assertion is not just "everything is a
    // Postgres expression".
    for (const type of ['date', 'time', 'datetime']) {
      expect(respelled('pgnative').nowDefaultSql(type), type)
        .toBe(respelled('pg').nowDefaultSql(type));
    }
    expect(respelled('pgnative').nowDefaultSql('datetime').toUpperCase())
      .toContain('CURRENT_TIMESTAMP');
    // The defect membership fixed: a DATE default that resolves the calendar
    // day in the SERVER's timezone (#11550's measured case, inherited by
    // pgnative for want of a decision).
    expect(respelled('pgnative').nowDefaultSql('date'))
      .toContain("timezone('utc', now())::date");
  });

  it('answers the same identity and reaches the drift differ as postgres', () => {
    const d = respelled('pgnative');
    expect(d.flags).toEqual({ sqlite: false, postgres: true, mysql: false });
    // 'unknown' at the differ disables every dialect-aware comparison — the
    // same silent degradation one layer up, which is why it is pinned here too.
    expect(d.dialect).toBe('postgres');
  });

  it('carries the #11389 calendar-day parser pin and the connect bound', () => {
    // The membership it was missing from BOTH tables before the ruling. Driven
    // through a recording connection, because `postgres` and `mysql` both end
    // up with a `pool.afterCreate` — its presence proves nothing about which
    // pin was installed.
    const bound = (client: string): any =>
      (SqlDriver as any).withConnectBound({ client, connection: { host: 'h' } });
    const drive = (cfg: any) => {
      const queries: string[] = [];
      const parsers: number[] = [];
      cfg.pool.afterCreate(
        {
          query: (sql: string, cb: (e?: unknown) => void) => { queries.push(sql); cb(); },
          getTypeParser: () => (t: string) => t,
          setTypeParser: (oid: number) => { parsers.push(oid); },
        },
        () => {},
      );
      return { queries, parsers };
    };

    // 1082 = Postgres OID of `date`. Without this the driver materialises a
    // local-midnight JS Date and an east-of-UTC process reads YESTERDAY.
    expect(drive(bound('pgnative')).parsers).toContain(1082);
    expect(drive(bound('pgnative')).parsers).toEqual(drive(bound('pg')).parsers);
    // No MySQL session pin leaked in with it.
    expect(drive(bound('pgnative')).queries).toEqual([]);
    // And the connect bound the derived table must now supply.
    expect(bound('pgnative').connection.connectionTimeoutMillis).toBe(10_000);
  });
});

describe('#11991 — exactly one source of truth for emission identity', () => {
  const set = (name: string): ReadonlySet<string> => (SqlDriver as any)[name];

  it('every client-keyed table is the emission set plus ONE declared extension', () => {
    const emit = set('POSTGRES_EMIT_CLIENTS');
    const wireOnly = set('POSTGRES_WIRE_ONLY_CLIENTS');
    const wire = set('POSTGRES_WIRE_CLIENTS');
    const timeout = (SqlDriver as any).DIALECT_CONNECT_TIMEOUT as Record<string, unknown>;

    // The wire table IS the union, exactly — not a copy that happens to agree.
    expect([...wire].sort()).toEqual([...emit, ...wireOnly].sort());
    // The connect-timeout table's pg arm is the same union, and its mysql arm
    // is the MySQL emission set — no third hand-written list anywhere.
    const pgArm = Object.keys(timeout).filter(
      (c) => (timeout[c] as any).key === 'connectionTimeoutMillis',
    );
    expect(pgArm.sort()).toEqual([...emit, ...wireOnly].sort());
    const mysqlArm = Object.keys(timeout).filter(
      (c) => (timeout[c] as any).key === 'connectTimeout',
    );
    expect(mysqlArm.sort()).toEqual([...set('MYSQL_EMIT_CLIENTS')].sort());
  });

  it('emission and the refusal are complements, never overlapping', async () => {
    // The invariant that makes "one source" checkable rather than merely
    // stated: a spelling cannot be both emitted for and refused, and the
    // refusal reads the same set the tables extend by.
    const emit = set('POSTGRES_EMIT_CLIENTS');
    for (const client of set('POSTGRES_WIRE_ONLY_CLIENTS')) {
      expect(emit.has(client), client).toBe(false);
      expect(respelled(client).flags.postgres, client).toBe(false);
      await expect(respelled(client).initObjects([]), client).rejects.toBeInstanceOf(
        UnsupportedDialectEmissionError,
      );
    }
    for (const client of emit) {
      expect(set('POSTGRES_WIRE_ONLY_CLIENTS').has(client), client).toBe(false);
    }
  });

  it('refusal is keyed on the named set, not on "unrecognised"', () => {
    // A driver that refused every spelling its getters do not know would sweep
    // in `mariadb` (out of the ruling's scope) and knex's bring-your-own Client
    // CONSTRUCTOR hatch. Both must still pass the gate untouched.
    const d = respelled('mariadb');
    expect(d.flags).toEqual({ sqlite: false, postgres: false, mysql: false });
    expect(() => (d as any).assertSchemaMutable('initObjects')).not.toThrow();

    const byConstructor = make();
    (byConstructor as any).config.client = class {};
    expect(byConstructor.dialect).toBe('unknown');
    expect(() => (byConstructor as any).assertSchemaMutable('initObjects')).not.toThrow();
  });
});
