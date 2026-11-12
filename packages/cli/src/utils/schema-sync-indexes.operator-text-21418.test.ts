// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21418] `collectSchemaSyncIndexes` writes a refused read into a step's
 * `detail` through `operatorFacingErrorText`, and a value bound into a raw
 * statement reaches neither that `detail` nor the line `os migrate plan`
 * prints from it (`renderSchemaSyncIndexes`).
 *
 * ## The two call sites, and what each case drives
 *
 *  - the guard's catalog read ("does the index stand?") refused by the driver's
 *    raw seam: the preflight's own reads answer (so the step is not decided
 *    there), then the presence statement raises the raw-path envelope;
 *  - the `objectql` engine accessor raising the same envelope before any seam
 *    is resolved.
 *
 * The raw seam declares its own fault (a composed `DATABASE_ERROR` with the
 * dialect error whole under a non-enumerable `cause`); knex prints the cause on
 * SQLite as `<statement, values inlined> - <diagnostic>`. The helper answers
 * through the one driver-fault cut (ruling A on #21385), so the module cuts
 * nothing of its own. The envelope's shape is pinned against the real producer
 * by `driver-sql`'s `sql-driver-16657-operator-facing-cause-text.test.ts`; here
 * it is a double, so the case needs no SQLite engine and stays in the `unit`
 * tier.
 */

import { describe, it, expect } from 'vitest';
import chalk from 'chalk';
// [#10126] Pay the dist-resolved dependency's first transform at module load:
// the module under test reaches it through a dynamic `import()`.
import '@objectstack/metadata-protocol';
import { collectSchemaSyncIndexes, renderSchemaSyncIndexes, type SchemaSyncIndexStep } from './schema-sync-indexes.js';

/** Synthetic, and asserted ABSENT from every carrier the module writes. */
const SENTINEL = 'SENTINEL-21418-BOUND-VALUE';

/** `rawStatementFaultError`'s composed message, verbatim (`sql-driver.ts`). */
const COMPOSED =
  'The database refused to run a raw statement. The driver could not attribute the failure ' +
  'to any part of the request, so no verdict about the statement is claimed here. The ' +
  "backend's own diagnostic was written to the server log for an operator to read, with " +
  'the statement and its bound values cut.';

/** knex 3.3.0 + better-sqlite3: `<statement, values inlined> - <engine diagnostic>`. */
const BOUND_DIALECT_TEXT =
  `select 1 from "sqlite_master" where "name" = '${SENTINEL}' - database is locked`;

/** The envelope the raw terminal composes, cause carrier and all. */
function rawStatementFault(): Error {
  const err = Object.assign(new Error(COMPOSED), { code: 'DATABASE_ERROR', status: 500 });
  Object.defineProperty(err, 'cause', {
    value: Object.assign(new Error(BOUND_DIALECT_TEXT), { code: 'SQLITE_BUSY' }),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return err;
}

/**
 * A driver whose raw seam answers every preflight read with no rows and
 * refuses the guard's catalog statement (the one naming `type = 'index'`).
 */
function driverRefusingThePresenceRead() {
  const statements: string[] = [];
  return {
    statements,
    driver: {
      config: { client: 'better-sqlite3' },
      async execute(sql: string) {
        statements.push(sql);
        if (sql.includes("type = 'index'")) throw rawStatementFault();
        return [];
      },
    },
  };
}

function plain(steps: SchemaSyncIndexStep[]): string {
  const level = chalk.level;
  chalk.level = 0;
  try {
    return renderSchemaSyncIndexes(steps).join('\n');
  } finally {
    chalk.level = level;
  }
}

const deferredWithWork = { schemaSync: 'deferred' as const, applyPerformsWork: true, pending: [] };

describe('[#21418] the runtime-owned index listing prints no bound value', () => {
  it('[the fixture] the raw path really carries the sentinel on the cause the helper reads', () => {
    const thrown = rawStatementFault();
    expect((thrown as { cause?: Error }).cause?.message).toContain(SENTINEL);
    expect(thrown.message).not.toContain(SENTINEL);
  });

  it('a refused catalog read: the step is unreadable, its detail and its line carry the diagnostic and no sentinel', async () => {
    const { driver, statements } = driverRefusingThePresenceRead();
    const steps = await collectSchemaSyncIndexes({ ...deferredWithWork, engine: () => ({ getDriverForObject: () => driver }) });

    // The refusal came from the guard's own catalog statement, after the preflight answered.
    expect(statements.at(-1)).toContain("type = 'index'");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe('unreadable');
    expect(steps[0]!.detail).toContain('database is locked');
    expect(steps[0]!.detail).not.toContain(SENTINEL);
    expect(steps[0]!.detail).not.toContain('refused to run a raw statement');

    const line = plain(steps);
    expect(line).toContain('database is locked');
    expect(line).not.toContain(SENTINEL);
  });

  it('a refused engine read: the step is unreadable, its detail and its line carry no sentinel', async () => {
    const steps = await collectSchemaSyncIndexes({ ...deferredWithWork, engine: () => { throw rawStatementFault(); } });

    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe('unreadable');
    expect(steps[0]!.detail).toContain('database is locked');
    expect(steps[0]!.detail).not.toContain(SENTINEL);
    expect(plain(steps)).not.toContain(SENTINEL);
  });
});
