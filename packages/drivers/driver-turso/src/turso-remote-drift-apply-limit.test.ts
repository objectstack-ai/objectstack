// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23925 — the REMOTE face declares, in one place, which drift ops its apply
 * door performs, and `driftApplyLimit` (what `os migrate plan` reads) answers
 * from the same declaration the apply door dispatches by.
 *
 * ## Why
 *
 * On a Turso REMOTE primary, `os migrate plan` listed a `tighten_not_null`
 * with the remedy `os migrate apply --allow-destructive`, and that apply then
 * named it as not applied and exited 1: this transport runs no SQLite table
 * rebuild. The plan cannot know that from the dialect (`sqlite`, the same as
 * the local face that does rebuild), so the driver declares it:
 * `REMOTE_DRIFT_OP_ANSWERS`, read by `applyMigrationEntries` and by
 * `driftApplyLimit`.
 *
 * ## What is pinned
 *
 * 1. Over a real remote face (a `@libsql/client` `file:` client) and its own
 *    drift report, every entry the apply door applies is one `driftApplyLimit`
 *    answers `null` for, and every entry it answers a limit for is skipped,
 *    with nothing on disk moved by it. The drop and the index land; the
 *    tightening and the relax do not.
 * 2. A report-only op (`unbuildable_index`) answers `null` (no face applies
 *    it, so it is no limit of this transport) and is still skipped.
 * 3. The local and embedded-replica faces declare no limit for any op: their
 *    apply door is the SQL driver's.
 * 4. A unique index its rows already violate is a limit of THAT entry, not of
 *    its op type: on the local and the remote face alike the shared duplicate
 *    pre-flight declares it on the entry (`applyLimit`, naming the conflicting
 *    group), `driftApplyLimit('create_index')` still answers `null`, and the
 *    apply door skips the entry.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { REMOTE_DRIFT_OP_ANSWERS, TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { replicaFiles } from './replica-file.testkit.js';

const scratch = mkdtempSync(join(tmpdir(), 'turso-remote-apply-limit-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let seq = 0;
const nextFile = () => join(scratch, `db-${++seq}.db`);

const open: Array<{ driver: TursoDriver; client: Client | null }> = [];
afterEach(async () => {
  while (open.length) {
    const { driver, client } = open.pop()!;
    await driver.disconnect().catch(() => {});
    client?.close();
  }
});

type Entry = Awaited<ReturnType<TursoDriver['detectManagedDrift']>>[number];
type OpType = keyof typeof REMOTE_DRIFT_OP_ANSWERS;
const OP_TYPES = Object.keys(REMOTE_DRIFT_OP_ANSWERS) as OpType[];

const LIMIT = 'it needs the SQLite table rebuild, which the Turso REMOTE transport does not run';

/**
 * `code` declares the NOT NULL its column lacks, `memo` has a NOT NULL nobody
 * declared, `legacy` is declared by nothing, `title` declares an index the
 * table lacks, and `nope` names an index key no field materializes.
 */
const NOTE = {
  name: 'note',
  fields: { title: { type: 'text' }, code: { type: 'text', storage: { notNull: true } }, memo: { type: 'text' } },
  indexes: [{ fields: ['title'] }, { fields: ['nope'] }],
};

async function remoteOver(file: string): Promise<TursoDriver> {
  const client = createClient({ url: `file:${file}` });
  const driver = new TursoDriver({ url: 'libsql://apply-limit.example.turso.io', client });
  open.push({ driver, client });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return driver;
}

/** Read the file through a connection of its own. */
async function secondConnection(file: string, sql: string): Promise<Array<Record<string, unknown>>> {
  const c = createClient({ url: `file:${file}` });
  try {
    return (await c.execute(sql)).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    c.close();
  }
}

const op = (entries: Entry[], type: string) => entries.filter((d) => d.op.type === type);

describe('the REMOTE face: driftApplyLimit and the apply door read one declaration', () => {
  it('every entry it applies answers no limit; every entry it answers a limit for is skipped and left as it was', async () => {
    const file = nextFile();
    const setup = createClient({ url: `file:${file}` });
    await setup.execute('CREATE TABLE "note" ("id" TEXT PRIMARY KEY, "title" TEXT, "code" TEXT, "memo" TEXT NOT NULL, "legacy" TEXT)');
    await setup.execute(`INSERT INTO "note" ("id", "title", "code", "memo", "legacy") VALUES ('n1', 'a', 'c1', 'm1', 'x')`);
    setup.close();
    const remote = await remoteOver(file);

    const report = await remote.detectManagedDrift([NOTE]);
    // Non-vacuous: each kind this pin is about is in the report.
    for (const type of ['drop_column', 'create_index', 'tighten_not_null', 'relax_not_null', 'unbuildable_index']) {
      expect(op(report, type), `${type} in ${JSON.stringify(report.map((d) => d.op.type))}`).toHaveLength(1);
    }

    const limits = new Map(report.map((d) => [d, remote.driftApplyLimit(d.op.type)] as const));
    expect(limits.get(op(report, 'tighten_not_null')[0]!)).toBe(LIMIT);
    expect(limits.get(op(report, 'relax_not_null')[0]!)).toBe(LIMIT);
    expect(limits.get(op(report, 'drop_column')[0]!)).toBeNull();
    expect(limits.get(op(report, 'create_index')[0]!)).toBeNull();
    expect(limits.get(op(report, 'unbuildable_index')[0]!)).toBeNull();

    const { applied, skipped } = await remote.applyMigrationEntries(report, { allowDestructive: true });
    for (const d of report) {
      const answer = REMOTE_DRIFT_OP_ANSWERS[d.op.type];
      expect(applied.includes(d), `${d.op.type}: applied ⇔ declared 'applied'`).toBe(answer === 'applied');
      expect(skipped.includes(d), `${d.op.type}: skipped ⇔ not declared 'applied'`).toBe(answer !== 'applied');
      expect(limits.get(d) !== null, `${d.op.type}: a limit ⇔ declared 'needs-table-rebuild'`).toBe(answer === 'needs-table-rebuild');
    }

    const columns = Object.fromEntries(
      (await secondConnection(file, `SELECT name, "notnull" AS nn FROM pragma_table_info('note')`))
        .map((r) => [String(r.name), Number(r.nn) === 1]),
    );
    expect(columns).not.toHaveProperty('legacy');
    expect(columns).toMatchObject({ code: false, memo: true });
    const indexes = (await secondConnection(file, `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'note'`))
      .map((r) => String(r.name));
    expect(indexes).toContain((op(report, 'create_index')[0]!.op as { indexName: string }).indexName);
    expect(await secondConnection(file, 'SELECT id, code, memo FROM "note"')).toEqual([{ id: 'n1', code: 'c1', memo: 'm1' }]);
  });

  it('declares a limit for exactly the ops that need the table rebuild', async () => {
    const remote = await remoteOver(nextFile());
    for (const type of OP_TYPES) {
      expect(remote.driftApplyLimit(type), type).toBe(REMOTE_DRIFT_OP_ANSWERS[type] === 'needs-table-rebuild' ? LIMIT : null);
    }
  });
});

describe('the local and embedded-replica faces declare no limit: their apply door is the SQL driver\'s', () => {
  const replicas = replicaFiles();
  afterAll(() => replicas.removeAll());

  it('local', async () => {
    const driver = new TursoDriver({ url: `file:${nextFile()}` });
    open.push({ driver, client: null });
    await driver.connect();
    expect(driver.transportMode).toBe('local');
    for (const type of OP_TYPES) expect(driver.driftApplyLimit(type), type).toBeNull();
  });

  it('embedded replica', async () => {
    const stub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({
      url: replicas.next(),
      syncUrl: 'libsql://apply-limit.example.turso.io',
      client: stub as never,
      sync: { onConnect: false },
    });
    open.push({ driver, client: null });
    await driver.connect();
    expect(driver.transportMode).toBe('replica');
    for (const type of OP_TYPES) expect(driver.driftApplyLimit(type), type).toBeNull();
    stub.close();
  });
});

describe('a unique index its rows violate: a limit of the entry, declared on both faces', () => {
  /** `code` is declared unique; two rows already share a value. */
  const QUOTE = { name: 'quote', tenancy: { enabled: false }, fields: { code: { type: 'text', unique: true } } };

  async function seedDuplicates(file: string): Promise<void> {
    const setup = createClient({ url: `file:${file}` });
    await setup.execute('CREATE TABLE "quote" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "code" TEXT)');
    await setup.execute(`INSERT INTO "quote" ("id", "code") VALUES ('q1', 'Q-1'), ('q2', 'Q-1')`);
    setup.close();
  }

  for (const face of ['local', 'remote'] as const) {
    it(face, async () => {
      const file = nextFile();
      await seedDuplicates(file);
      const driver = face === 'local' ? new TursoDriver({ url: `file:${file}` }) : await remoteOver(file);
      if (face === 'local') {
        open.push({ driver, client: null });
        await driver.connect();
      }
      expect(driver.transportMode).toBe(face);

      const [entry, ...rest] = op(await driver.detectManagedDrift([QUOTE]), 'create_index');
      expect(rest).toEqual([]);
      expect(entry!.category).toBe('destructive');
      expect(entry!.applyLimit).toContain('code="Q-1"');
      expect(driver.driftApplyLimit('create_index')).toBeNull();

      const { applied, skipped } = await driver.applyMigrationEntries([entry!], { allowDestructive: true });
      expect(applied).toEqual([]);
      expect(skipped).toEqual([entry]);
    });
  }
});
