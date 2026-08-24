// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11733] The dry run writes NOTHING — measured against a real database, not
 * asserted about a mock.
 *
 * ## Why this is the pin this command most needs
 *
 * "Shows you what it would run" and "quietly runs it" produce the same
 * successful-looking report. An operator reads the statements, sees no error,
 * and concludes nothing happened — so a dry run that executed would be
 * discovered by its consequences, on a production table, weeks later. A test
 * asserting only that the dry run PRINTED something would pass in exactly that
 * world.
 *
 * So the reading here is the database itself: the column's declared type and
 * every row, snapshotted before and after, required IDENTICAL.
 *
 * ## The positive control is half the evidence
 *
 * An unchanged snapshot proves nothing unless the same instrument can be shown
 * observing a change. Every "nothing changed" case below is paired with an
 * apply run over the same fixture, through the same snapshot function, which
 * must show the column type AND the rows moving. A snapshot that never moves is
 * an instrument, not a result.
 *
 * ## What SQLite is doing in a suite about Postgres and MySQL
 *
 * Two different questions, deliberately split:
 *
 *   - **is the statement right?** — answered where it can be: #11720 EXECUTES
 *     the real remedy against live Postgres 16.13 and MySQL 8.0.46 over four
 *     row states, and `multi-value-columns.remedy-fidelity.test.ts` pins that
 *     this command runs that exact statement.
 *   - **does the executor honour the dry run?** — that is dialect-independent
 *     control flow, and answering it needs a database this suite can actually
 *     open. The statements below are a SQLite-legal stand-in shaped like the
 *     real remedy (rewrite the values, change the column's type); they exist to
 *     make the change VISIBLE, and are never the statements the command builds.
 *
 * The real remedy is covered here too, in the last case: planned from the
 * engine's own finding and dry-run against an `exec` that throws if touched.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver, diffManagedTable, type PhysicalColumn } from '@objectstack/driver-sql';
import {
  runStaleColumnMigration,
  planStaleColumnTargets,
  type RawExec,
  type StaleColumnPlan,
} from './multi-value-columns.js';

const TABLE = 'os11733_task';
const dirs: string[] = [];

let driver: SqlDriver;
let knex: any;

/** Fresh database per case — an apply run is destructive by design. */
async function freshFixture(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'os-11733-dry-'));
  dirs.push(dir);
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'app.db') },
    useNullAsDefault: true,
  });
  knex = (driver as any).knex;
  await knex.raw(`CREATE TABLE ${TABLE} (id text primary key, tags text)`);
  // The four row states a stale column is actually in — the same four #11720
  // runs the live remedy over.
  await knex.raw(`INSERT INTO ${TABLE} (id, tags) VALUES ('legacy', 'a')`);
  await knex.raw(`INSERT INTO ${TABLE} (id, tags) VALUES ('multi', '["x","y"]')`);
  await knex.raw(`INSERT INTO ${TABLE} (id, tags) VALUES ('empty', '')`);
  await knex.raw(`INSERT INTO ${TABLE} (id, tags) VALUES ('nulled', NULL)`);
}

/**
 * The two readings the dry run must leave alone: what the column CALLS ITSELF,
 * and what is stored in it.
 */
async function snapshot(): Promise<{ columnType: string; rows: unknown[] }> {
  const info = await knex.raw(`pragma table_info(${TABLE})`);
  const tags = (info as Array<{ name: string; type: string }>).find((c) => c.name === 'tags');
  return {
    columnType: String(tags?.type ?? '<column missing>'),
    rows: await knex.raw(`SELECT id, tags FROM ${TABLE} ORDER BY id`),
  };
}

/**
 * A SQLite-legal stand-in for the remedy: same shape (values rewritten, then
 * the column's type changed), on a dialect this suite can open. NOT the
 * statement the command builds — see the head note.
 */
function sqliteStandInPlan(): StaleColumnPlan {
  return {
    targets: [
      {
        table: TABLE,
        column: 'tags',
        from: 'text',
        to: 'json',
        // Display only — the executor never branches on it. The statements
        // below are SQLite's, for the reason the head note gives.
        dialect: 'postgres',
        statements: [
          `ALTER TABLE ${TABLE} RENAME COLUMN tags TO tags_legacy`,
          `ALTER TABLE ${TABLE} ADD COLUMN tags json`,
          `UPDATE ${TABLE} SET tags = CASE WHEN tags_legacy IS NULL THEN NULL ` +
            `WHEN tags_legacy = '' THEN NULL WHEN substr(tags_legacy, 1, 1) = '[' THEN tags_legacy ` +
            `ELSE json_array(tags_legacy) END`,
          `ALTER TABLE ${TABLE} DROP COLUMN tags_legacy`,
        ],
      },
    ],
    refusals: [],
  };
}

const liveExec: RawExec = (sql) => knex.raw(sql);

beforeEach(async () => {
  await driver?.disconnect().catch(() => {});
  await freshFixture();
});

afterAll(async () => {
  await driver?.disconnect().catch(() => {});
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('os migrate multi-value-columns — the dry run changes nothing (#11733)', () => {
  it('a dry run leaves the column type and every row byte-identical, and never touches the seam', async () => {
    const before = await snapshot();
    // Non-vacuity: the fixture really is the stale shape this command is about.
    expect(before.columnType.toLowerCase()).toBe('text');
    expect(before.rows).toHaveLength(4);

    let seamCalls = 0;
    const countingExec: RawExec = async (sql) => {
      seamCalls += 1;
      return knex.raw(sql);
    };

    const result = await runStaleColumnMigration({
      plan: sqliteStandInPlan(),
      exec: countingExec,
      apply: false,
    });

    // 1. it reported the work…
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].statements).toHaveLength(4);
    expect(result.outcomes[0].status).toBe('planned');

    // 2. …and ran none of it. Not one statement, not a probe.
    expect(seamCalls).toBe(0);
    expect(result.executedStatements).toEqual([]);
    expect(result.outcomes[0].executed).toEqual([]);

    // 3. the database agrees — this is the reading that matters.
    expect(await snapshot()).toEqual(before);
  });

  it('POSITIVE CONTROL: the same snapshot, the same fixture, --apply — and it moves', async () => {
    // Without this case the assertion above is a claim about an instrument that
    // has never been shown reading a change.
    const before = await snapshot();

    const result = await runStaleColumnMigration({
      plan: sqliteStandInPlan(),
      exec: liveExec,
      apply: true,
    });

    expect(result.outcomes[0].status).toBe('migrated');
    expect(result.outcomes[0].executed).toHaveLength(4);
    expect(result.executedStatements).toHaveLength(4);

    const after = await snapshot();
    expect(after).not.toEqual(before);
    // Both readings the dry-run case pinned as unchanged are shown changing:
    expect(after.columnType.toLowerCase()).toBe('json');
    expect(after.rows).not.toEqual(before.rows);

    // And the values landed in the shape the declaration promises — including
    // the two states that are easy to get wrong.
    const byId = new Map(
      (after.rows as Array<{ id: string; tags: string | null }>).map((r) => [r.id, r.tags]),
    );
    expect(byId.get('legacy')).toBe('["a"]');
    expect(byId.get('multi')).toBe('["x","y"]');
    expect(byId.get('empty')).toBeNull();
    expect(byId.get('nulled')).toBeNull();
  });

  it('a dry run over a plan built from the engine’s REAL finding executes nothing either', async () => {
    // The stand-in above proves the control flow against a database; this
    // proves the same for the statements the command actually builds, using an
    // `exec` that cannot be called without failing the test.
    const stale: PhysicalColumn[] = [{ name: 'tags', type: 'character varying', nullable: true, maxLength: 255 }];
    const entries = diffManagedTable({
      table: TABLE,
      fields: { tags: { type: 'lookup', multiple: true } as any },
      columns: stale,
      dialect: 'postgres',
    });
    const plan = planStaleColumnTargets(entries);
    expect(plan.targets).toHaveLength(1); // the plan is real

    const before = await snapshot();
    const result = await runStaleColumnMigration({
      plan,
      apply: false,
      exec: async () => {
        throw new Error('the dry run executed SQL');
      },
    });

    expect(result.executedStatements).toEqual([]);
    expect(result.outcomes[0].status).toBe('planned');
    expect(await snapshot()).toEqual(before);
  });

  it('a failing statement stops THAT target where it failed, and says so', async () => {
    // MySQL's three statements auto-commit one at a time, so a half-converted
    // table is a real state an operator can land in. The report has to make it
    // visible rather than round it up to "failed, nothing happened".
    const plan = sqliteStandInPlan();
    plan.targets[0].statements = [
      `UPDATE ${TABLE} SET tags = '["a"]' WHERE id = 'legacy'`,
      `ALTER TABLE ${TABLE} MODIFY tags json`, // SQLite has no MODIFY — this throws
      `UPDATE ${TABLE} SET tags = NULL WHERE id = 'empty'`,
    ];

    const result = await runStaleColumnMigration({ plan, exec: liveExec, apply: true });

    expect(result.outcomes[0].status).toBe('failed');
    expect(result.outcomes[0].executed).toEqual([plan.targets[0].statements[0]]);
    expect(result.outcomes[0].error).toBeTruthy();

    // The first statement's write is still there — that IS the half-converted
    // state, and the point is that it is reported rather than hidden.
    const rows = (await snapshot()).rows as Array<{ id: string; tags: string | null }>;
    expect(rows.find((r) => r.id === 'legacy')?.tags).toBe('["a"]');
    expect(rows.find((r) => r.id === 'empty')?.tags).toBe('');
  });
});
