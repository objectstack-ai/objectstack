// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16206] `AnalyticsServiceConfig.sqlDialect` — a PUBLIC host hook that was
 * typed as free `string` while only three spellings ever did anything.
 *
 * ## The defect
 *
 * `normalizeSqlDialect` accepts `'sqlite'` / `'postgres'` / `'mysql'` and reads
 * everything else as `'unknown'`. That set is `driver-sql`'s `SqlDialectName`
 * vocabulary and is the right one when the answer comes from
 * `SqlDriver.dialectName` — but the reader is `sqlDialectFor`, and its channel
 * is a HOST-supplied hook. A host that owns a SQLite datasource and answers the
 * spelling its own stack uses — knex's canonical `'sqlite3'`, which
 * `driver-sql` itself lists in `SQLITE_EMIT_CLIENTS` alongside
 * `'better-sqlite3'` — landed on the residue arm.
 *
 * ⭐ And nothing told it. `sqlDialectFor` is tiered "cannot answer, do not
 * block" by design, so **a wrong answer and no answer were the same answer**.
 * These pins exist to break exactly that identity, and no more than that.
 *
 * ## What was ruled, and what is therefore pinned here
 *
 * Option A: the declared return vocabulary is the three canonical names or
 * `undefined`, stated on the type and in the docblock; a NON-EMPTY answer
 * outside them is diagnosed once; `undefined` stays silent and legal. ⛔ The
 * accept set was NOT widened to knex's aliases (that was refused by name — a
 * second copy of `driver-sql`'s table is the drift this repo keeps paying for,
 * and #11756 shows an unrecognised spelling is sometimes deliberate), and ⛔ the
 * diagnostic was not skipped (leaving the host uninformed is the silent-
 * tolerance shape).
 *
 * ⇒ Both halves of the ruling's named pin are below, and the second is the
 * CONTROL that keeps the first honest: a suite that only asserted "a warning
 * appeared" would pass just as well for an implementation that shouts at every
 * host who wired nothing, which is the failure mode the tiering exists to
 * prevent.
 *
 * ## The `unknown` arm's rows, EXECUTED — not inherited
 *
 * The last block drives the case-EXACT family (`$contains` and its three
 * siblings) through a host answering `'sqlite3'`, on sql.js, and prints the row
 * ids it gets. The card carried that consequence as NOT MEASURED, read off
 * #15684's own measurement of the same arm rather than re-driven for this
 * population. It is measured here, with the canonical-spelling host as the
 * discriminating control — the two hosts differ in ONE character of one string
 * and in nothing else.
 *
 * ⚠️ Those assertions pin a WRONG row set on purpose. They are the finding, not
 * the contract: #15684's fold is live on this arm, and the day it is fixed
 * there this block must go red and be re-read, exactly as
 * `text-operator-case-exactness.test.ts` intends for its own "the defect, still
 * reachable" pin. ⛔ Do not "repair" them by loosening the expectation.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';

import { AnalyticsService, type AnalyticsServiceConfig } from '../analytics-service.js';
import {
  ACCEPTED_SQL_DIALECTS,
  isUnrecognisedSqlDialectAnswer,
  normalizeSqlDialect,
  type AcceptedSqlDialect,
} from '../text-match-sql.js';

/** The four operators #4706 Q2 = A rules case-SENSITIVE. */
const CASE_EXACT_OPS = new Set(['$contains', '$notContains', '$startsWith', '$endsWith']);

/**
 * The shared table's rows that aim a case-EXACT operator at the TEXT column —
 * selected from `FILTER_TEXT_CASES` rather than restated, so this file drives
 * the same family the five drivers answer.
 */
const NAME_CASE_EXACT = FILTER_TEXT_CASES.filter(
  (c): c is Extract<typeof c, { expected: readonly string[] }> => {
    if (c.expectRejection === true) return false;
    const entries = Object.entries(c.filter as Record<string, unknown>);
    if (entries.length !== 1) return false;
    const [field, predicate] = entries[0];
    if (field !== 'name' || typeof predicate !== 'object' || predicate === null) return false;
    const op = Object.keys(predicate as Record<string, unknown>)[0];
    return CASE_EXACT_OPS.has(op);
  },
);

const CUBE: Cube = {
  name: 'texts',
  title: 'Texts',
  sql: 'rows',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
  },
  public: false,
} as unknown as Cube;

/**
 * A second cube over a DIFFERENT object, so "one answer, many objects" is
 * drivable. ⚠️ The hook is asked about the OBJECT the cube reads (`sql`), not
 * about the cube — which is why the line below names `rows`, and why this
 * twin has to point somewhere else to be a second object at all.
 */
const OTHER_CUBE: Cube = {
  ...(CUBE as unknown as Record<string, unknown>),
  name: 'other_texts',
  sql: 'other_rows',
} as unknown as Cube;

const query = (where: unknown, cube = 'texts'): AnalyticsQuery =>
  ({ cube, measures: ['total'], dimensions: ['id'], timezone: 'UTC', where }) as AnalyticsQuery;

const makeLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

type TestLogger = ReturnType<typeof makeLogger>;

/**
 * A service composed the way a direct embedder composes one — the population
 * this card is about. `answer` is deliberately typed `string | undefined`, not
 * {@link AcceptedSqlDialect}: the declaration says what a host is ASKED for, and
 * every interesting case here is a host answering something else.
 */
const serviceAnswering = (
  answer: string | undefined | (() => string | undefined),
): { service: AnalyticsService; logger: TestLogger } => {
  const logger = makeLogger();
  const hook = typeof answer === 'function' ? answer : () => answer;
  const config = {
    logger: logger as unknown as AnalyticsServiceConfig['logger'],
    cubes: [CUBE, OTHER_CUBE],
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    // `NativeSQLStrategy.canHandle` requires a raw-SQL door to exist. Nothing
    // below EXECUTES through it — the SQL is minted by `generateSql` and run on
    // sql.js directly — so it only has to be present and typed.
    executeRawSql: async () => [] as Record<string, unknown>[],
    sqlDialect: hook as unknown as AnalyticsServiceConfig['sqlDialect'],
  } satisfies AnalyticsServiceConfig;
  return { service: new AnalyticsService(config), logger };
};

/** A service that wired NO hook at all — the legal, silent composition. */
const serviceAnsweringNothing = (): { service: AnalyticsService; logger: TestLogger } => {
  const logger = makeLogger();
  return {
    service: new AnalyticsService({
      logger: logger as unknown as AnalyticsServiceConfig['logger'],
      cubes: [CUBE, OTHER_CUBE],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async () => [] as Record<string, unknown>[],
    }),
    logger,
  };
};

/** Only the dialect diagnostic — the constructor's own `info` is not it. */
const dialectWarnings = (logger: TestLogger): string[] =>
  logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('sqlDialect hook answered'));

describe('[#16206] the declared vocabulary', () => {
  it('is the three canonical names, and the type and the runtime set are ONE source', () => {
    expect([...ACCEPTED_SQL_DIALECTS]).toEqual(['sqlite', 'postgres', 'mysql']);
    // Every declared name is accepted at runtime…
    for (const d of ACCEPTED_SQL_DIALECTS) expect(normalizeSqlDialect(d), d).toBe(d);
    // …and the type is the same list, checked by the compiler rather than by eye.
    const declared: readonly AcceptedSqlDialect[] = ACCEPTED_SQL_DIALECTS;
    expect(declared.length).toBe(3);
    // ⛔ `'unknown'` is the residue arm, never something a host may answer.
    expect((ACCEPTED_SQL_DIALECTS as readonly string[]).includes('unknown')).toBe(false);
    expect(normalizeSqlDialect('unknown')).toBe('unknown');
  });

  it('⛔ was NOT widened to driver-sql\'s knex aliases — option B, refused by name', () => {
    // These are exactly the spellings `SqlDriver.SQLITE_EMIT_CLIENTS`,
    // `POSTGRES_EMIT_CLIENTS` and `MYSQL_EMIT_CLIENTS` recognise and this file
    // deliberately does not. A widening here is the refused option, not a fix.
    for (const alias of ['sqlite3', 'better-sqlite3', 'pg', 'postgresql', 'pgnative', 'mysql2', 'mariadb']) {
      expect(normalizeSqlDialect(alias), alias).toBe('unknown');
    }
  });

  it('separates a non-answer from a wrong answer — the identity the defect rested on', () => {
    // A wrong answer: something was said, and it is outside the accept set.
    for (const wrong of ['sqlite3', 'better-sqlite3', 'SQLite', 'mssql', ' sqlite']) {
      expect(isUnrecognisedSqlDialectAnswer(wrong), wrong).toBe(true);
    }
    // ⛔ A non-answer is NOT a wrong answer. The hook is optional.
    for (const silent of [undefined, null, '']) {
      expect(isUnrecognisedSqlDialectAnswer(silent), String(silent)).toBe(false);
    }
    // …and neither is a name that IS accepted.
    for (const ok of ACCEPTED_SQL_DIALECTS) expect(isUnrecognisedSqlDialectAnswer(ok), ok).toBe(false);
  });
});

describe('[#16206] the ruling\'s named pin — both halves', () => {
  it('a host answering knex\'s `sqlite3` is read as `unknown` AND is told so, once', async () => {
    const { service, logger } = serviceAnswering('sqlite3');
    const out = await service.generateSql(query({ name: { $contains: 'acme' } }));

    // Half one, the behaviour: still the residue arm. ⛔ The answer is NOT
    // accepted — the diagnostic informs, it does not widen.
    expect(out.sql).toContain('LIKE');
    expect(out.sql).not.toMatch(/GLOB/);

    // Half one, the diagnostic: exactly one line, naming all three things the
    // ruling requires — the object, the answer, and the accepted set.
    const warnings = dialectWarnings(logger);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"sqlite3"');
    // The OBJECT the hook was asked about — `texts` reads the object `rows`.
    expect(warnings[0]).toContain('"rows"');
    for (const accepted of ACCEPTED_SQL_DIALECTS) expect(warnings[0], accepted).toContain(accepted);
  });

  it('⛔ `undefined` says nothing — the optional hook stays optional', async () => {
    // The control that keeps the pin above honest. An implementation that made
    // "no answer" loud would pass the first test and fail this one.
    const { service: wired, logger: wiredLog } = serviceAnswering(undefined);
    await wired.generateSql(query({ name: { $contains: 'acme' } }));
    expect(dialectWarnings(wiredLog)).toEqual([]);

    // …and so does a host that wired no hook at all.
    const { service: bare, logger: bareLog } = serviceAnsweringNothing();
    await bare.generateSql(query({ name: { $contains: 'acme' } }));
    expect(dialectWarnings(bareLog)).toEqual([]);

    // An empty string is a non-answer too: "non-empty" is the ruled trigger.
    const { service: empty, logger: emptyLog } = serviceAnswering('');
    await empty.generateSql(query({ name: { $contains: 'acme' } }));
    expect(dialectWarnings(emptyLog)).toEqual([]);
  });

  it('says nothing to a host that answers correctly', async () => {
    for (const accepted of ACCEPTED_SQL_DIALECTS) {
      const { service, logger } = serviceAnswering(accepted);
      await service.generateSql(query({ name: { $contains: 'acme' } }));
      expect(dialectWarnings(logger), accepted).toEqual([]);
    }
  });
});

describe('[#16206] "once" is keyed on the failure\'s identity, and is bounded', () => {
  it('one misspelling reaching many objects and many queries is ONE line', async () => {
    const { service, logger } = serviceAnswering('sqlite3');
    for (let i = 0; i < 25; i++) {
      await service.generateSql(query({ name: { $contains: 'acme' } }, 'texts'));
      await service.generateSql(query({ name: { $startsWith: 'ACME' } }, 'other_texts'));
    }
    const warnings = dialectWarnings(logger);
    expect(warnings).toHaveLength(1);
    // The FIRST object to elicit it is the one named — a concrete place to look,
    // not a count that grows with the object registry. Two DIFFERENT objects
    // were asked about (`rows` and `other_rows`); one line came out.
    expect(warnings[0]).toContain('"rows"');
    expect(warnings[0]).not.toContain('"other_rows"');
  });

  it('a SECOND, DIFFERENT wrong answer is a second failure and gets its own line', async () => {
    let answer = 'sqlite3';
    const { service, logger } = serviceAnswering(() => answer);
    await service.generateSql(query({ name: { $contains: 'acme' } }));
    answer = 'better-sqlite3';
    await service.generateSql(query({ name: { $contains: 'acme' } }));
    answer = 'sqlite3';
    await service.generateSql(query({ name: { $contains: 'acme' } }));

    const warnings = dialectWarnings(logger);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"sqlite3"');
    expect(warnings[1]).toContain('"better-sqlite3"');
  });

  it('the line count does not move with TRAFFIC — 4x the queries, the same one line', async () => {
    const drive = async (laps: number): Promise<number> => {
      const { service, logger } = serviceAnswering('sqlite3');
      for (let i = 0; i < laps; i++) {
        await service.generateSql(query({ name: { $contains: 'acme' } }, 'texts'));
        await service.generateSql(query({ name: { $notContains: 'acme' } }, 'other_texts'));
      }
      return dialectWarnings(logger).length;
    };
    const oneX = await drive(50);
    const fourX = await drive(200);
    expect(oneX).toBe(1);
    expect(fourX).toBe(oneX);
  });

  it('each service instance carries its OWN key set — no module-global residue', async () => {
    // A process-wide key would make the second host's identical
    // misconfiguration invisible, which is the shape #15166 was filed against.
    const first = serviceAnswering('sqlite3');
    await first.service.generateSql(query({ name: { $contains: 'acme' } }));
    const second = serviceAnswering('sqlite3');
    await second.service.generateSql(query({ name: { $contains: 'acme' } }));
    expect(dialectWarnings(first.logger)).toHaveLength(1);
    expect(dialectWarnings(second.logger)).toHaveLength(1);
  });
});

/**
 * ⚠️ The measurement the ruling made a precondition of landing: the case-EXACT
 * family, EXECUTED on SQLite, through a host answering `'sqlite3'`.
 */
describe('[#16206] the `unknown` arm\'s ROWS for a `sqlite3`-answering host, on a real SQLite engine', () => {
  let db: any;
  let sqlite3Host: AnalyticsService;
  let sqliteHost: AnalyticsService;

  /** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
  const locateWasm = async (): Promise<((file: string) => string) | undefined> => {
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const pkgJsonPath = require.resolve('sql.js/package.json');
      const { dirname, join } = await import('node:path');
      return (file: string) => join(dirname(pkgJsonPath), 'dist', file);
    } catch {
      return undefined;
    }
  };

  const run = (sql: string, params: unknown[]): string[] => {
    const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
    stmt.bind(params as any[]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
  };

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    db = new SQL.Database();
    db.run(`CREATE TABLE "rows" ("id" TEXT PRIMARY KEY, "name" TEXT);`);
    const insert = db.prepare(`INSERT INTO "rows" ("id","name") VALUES (?,?)`);
    for (const r of FILTER_TEXT_ROWS) insert.run([r.id, r.name]);
    insert.free();

    // The two hosts differ in ONE character of ONE string. Everything else —
    // cubes, capabilities, engine, fixture — is identical, which is what makes
    // the row difference below attributable to the spelling.
    sqlite3Host = serviceAnswering('sqlite3').service;
    sqliteHost = serviceAnswering('sqlite').service;
  });

  afterAll(() => {
    db?.close();
  });

  const executedIds = async (where: unknown, service: AnalyticsService): Promise<string[]> => {
    const { sql, params } = await service.generateSql(query(where));
    return run(sql, params);
  };

  it('the rig discriminates: the canonical-spelling CONTROL answers the shared table exactly', async () => {
    // Same query, same engine, same rows — the only host that is heard.
    expect(run('SELECT "id" FROM "rows"', [])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(NAME_CASE_EXACT.length).toBeGreaterThan(0);
    for (const c of NAME_CASE_EXACT) {
      expect(await executedIds(c.filter, sqliteHost), `control · ${c.name}`).toEqual([...c.expected]);
    }
  });

  it('⭐ the `sqlite3`-answering host gets WRONG ROWS — not merely slower ones', async () => {
    // ⚠️ This is the finding, not the contract. #15684's ASCII fold is live on
    // the `unknown` arm, and this host reaches that arm.
    const wrong: { case: string; expected: string[]; measured: string[] }[] = [];
    for (const c of NAME_CASE_EXACT) {
      const measured = await executedIds(c.filter, sqlite3Host);
      if (JSON.stringify(measured) !== JSON.stringify([...c.expected])) {
        wrong.push({ case: c.name, expected: [...c.expected], measured });
      }
    }
    // FIVE of the shared table's SIX case-exact cases come back wrong — every
    // one that discriminates on ASCII case. The sixth (`$contains 'a_b'`) is
    // the LIKE-metacharacter row, which carries no cased letter to fold, and is
    // the reason this is a count and not "all of them".
    expect(wrong.map((w) => w.case)).toEqual([
      '$contains is case-SENSITIVE — a lower-case comparand misses the upper-case row',
      '$contains is case-SENSITIVE — an upper-case comparand misses the lower-case row',
      '$startsWith is case-SENSITIVE',
      '$endsWith is case-SENSITIVE',
      '$notContains is case-SENSITIVE, and negation does not widen it',
    ]);

    // Named, so the record reads the rows rather than a count.
    expect(await executedIds({ name: { $contains: 'acme' } }, sqlite3Host)).toEqual(['1', '2']);
    expect(await executedIds({ name: { $contains: 'acme' } }, sqliteHost)).toEqual(['2']);
    expect(await executedIds({ name: { $contains: 'ACME' } }, sqlite3Host)).toEqual(['1', '2']);
    expect(await executedIds({ name: { $contains: 'ACME' } }, sqliteHost)).toEqual(['1']);
    expect(await executedIds({ name: { $startsWith: 'ACME' } }, sqlite3Host)).toEqual(['1', '2']);
    expect(await executedIds({ name: { $startsWith: 'ACME' } }, sqliteHost)).toEqual(['1']);
    expect(await executedIds({ name: { $endsWith: 'corp' } }, sqlite3Host)).toEqual(['1', '2']);
    expect(await executedIds({ name: { $endsWith: 'corp' } }, sqliteHost)).toEqual(['2']);
    // ⭐ Negation turns the over-match into an UNDER-match: row 1 is DROPPED
    // from a result set that should contain it. On a read scope that direction
    // hides rows; on the query's own `where` it is a wrong chart.
    expect(await executedIds({ name: { $notContains: 'acme' } }, sqlite3Host))
      .toEqual(['3', '4', '5', '6', '7', '8', '9']);
    expect(await executedIds({ name: { $notContains: 'acme' } }, sqliteHost))
      .toEqual(['1', '3', '4', '5', '6', '7', '8', '9']);

    // The construct that causes it, so the finding names a mechanism: the
    // residue arm's plain `LIKE`, which SQLite folds ASCII case on.
    const viaSqlite3 = await sqlite3Host.generateSql(query({ name: { $contains: 'acme' } }));
    const viaSqlite = await sqliteHost.generateSql(query({ name: { $contains: 'acme' } }));
    expect(viaSqlite3.sql).toContain('LIKE');
    expect(viaSqlite.sql).toContain('GLOB');
  });
});
