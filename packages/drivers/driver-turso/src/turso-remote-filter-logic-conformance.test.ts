// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for TursoDriver's REMOTE transport
 * (#3774, #5590) — the shared `@objectstack/spec/data` cases, on rows.
 *
 * The local twin of this suite passes largely by INHERITANCE: `TursoDriver
 * extends SqlDriver`, so `applyFilterCondition` compiles the combinators.
 * Remote mode inherits none of it. `RemoteTransport.buildWhereSQL`
 * (`src/remote-transport.ts`) is an independent filter compiler — its own
 * `$and` / `$or` / `$not` nesting, its own operator vocabulary, its own
 * comparand refusal, its own identity elements for the empty combinators. It
 * is the "independent Nth backend" #3774 wrote this table for, and the seam
 * has demonstrably diverged before: six semantic fixes landed in this one
 * function while the package lived in `objectstack-ai/cloud` (#1071, #1074,
 * #1078, #1080, #1116, #1117), every one of them a case where remote answered
 * a filter differently from local.
 *
 * That history is also why the boolean-identity rows matter here more than
 * anywhere else. `$and: []` is TRUE, `$or: []` is FALSE, a `{}` disjunct
 * absorbs its `$or`, and `$not: {}` is FALSE (the #5322 ruling) — this
 * transport reaches each of those through a *hand-written* branch rather than
 * through knex, and "compiled to no clause" is the same string for TRUE and
 * for "something was silently dropped". A dropped predicate leaves valid SQL,
 * just wider, so it is invisible to a SQL-string assertion; only the row set
 * tells them apart, which is what this file compares.
 *
 * ## Why a SQLite-backed client stub
 *
 * Same reason as the remote temporal suite next door: libsql IS SQLite, so
 * `makeLibsqlSqliteStub` gives the transport real value and ordering semantics
 * with no network and no credentials. The network itself stays the concern of
 * the suites that mock `execute` and assert on the SQL string.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const CONFORMANCE_OBJECT = {
  name: 'conformance',
  fields: {
    a: { type: 'string' },
    b: { type: 'string' },
    c: { type: 'string' },
    // [#5298] The NULL-bearing column; rows 3-4 seed it as `null`.
    d: { type: 'string' },
    owner: { type: 'string' },
    status: { type: 'string' },
    parent_object: { type: 'string' },
    parent_id: { type: 'string' },
  },
};

const ids = (rows: Array<Record<string, unknown>>): string[] =>
  rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));

describe('TursoDriver remote — filter logic conformance', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://conformance.turso.io', client: stub as never });
    await driver.connect();
    // The mode this suite is about — the one that inherits nothing.
    expect(driver.transportMode).toBe('remote');
    // `syncSchema` is what creates the table and registers the field metadata
    // in remote mode (`registerRemoteFieldMetadata`); there is no `initObjects`
    // DDL path here.
    await driver.syncSchema(CONFORMANCE_OBJECT.name, CONFORMANCE_OBJECT);
    for (const row of FILTER_LOGIC_ROWS) {
      await driver.create('conformance', { ...row });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  /**
   * The fixture as a whole, first — and read below the transport, so a case
   * that returns nothing because the seed never landed cannot read as a case
   * that correctly excluded everything.
   */
  it('the fixture really is all four rows, as stored', () => {
    const rows = stub.raw.prepare('select id, a, b, c from conformance order by id').all() as Array<{
      id: string;
      a: string;
      b: string;
      c: string;
    }>;
    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3', '4']);
    for (const row of rows) {
      const seeded = FILTER_LOGIC_ROWS.find((r) => r.id === row.id)!;
      expect([row.a, row.b, row.c], row.id).toEqual([seeded.a, seeded.b, seeded.c]);
    }
  });

  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, async () => {
      const rows = await driver.find('conformance', { where: c.filter });
      expect(ids(rows), c.note).toEqual([...c.expected]);
    });
  }

  /**
   * `count()` compiles its WHERE through the same `buildWhereSQL` but a
   * different statement builder, so a combinator that is right for `find` can
   * still be wrong for `count` — which is how a list view shows a page of rows
   * under a total that disagrees with it. One assertion over the whole table
   * rather than a second copy of it.
   */
  it('count() answers the same row set find() does, case for case', async () => {
    for (const c of FILTER_LOGIC_CASES) {
      expect(await driver.count('conformance', { where: c.filter }), c.name).toBe(c.expected.length);
    }
  });
});
