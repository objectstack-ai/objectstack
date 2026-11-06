// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30636 — `os migrate plan` previews a `_id`-keyed table as `os migrate apply`
 * treats it, and one refused table no longer stops `apply`.
 *
 * An existing table keyed by `_id` with no `id` column is the one shape the
 * schema sync does not adopt by adding columns: it rebuilds it while it is
 * empty and (#30562) refuses it while it holds rows. Measured on `origin/main`
 * through this CLI with the fixture below: `plan` listed both such tables as
 * `add_columns`, and `apply --yes` stopped at the refusal with exit 1, having
 * created none of the 80 tables and extended none of the columns it had just
 * listed — the refusal took the whole batch, and the performed list, with it.
 *
 * The fixture is the defect's own shape: a `_id` table holding rows, an empty
 * `_id` table, an `id`-keyed table missing a declared column (the CONTROL that
 * still plans `add_columns`), and a table that does not exist yet.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { CLI, childEnv } from './helpers/serve-process.js';

const RUN_BUDGET_MS = 120_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // A signalled child has no numeric code: never read as 0.
          code: err
            ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1)
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

const CONFIG = [
  'export default {',
  "  name: 'refused_30636',",
  "  label: 'Refused 30636',",
  '  objects: [',
  "    { name: 'legacy_full', label: 'Legacy Full', fields: { title: { type: 'text', label: 'Title' } } },",
  "    { name: 'legacy_empty', label: 'Legacy Empty', fields: { title: { type: 'text', label: 'Title' } } },",
  "    { name: 'plain_ok', label: 'Plain', fields: { title: { type: 'text', label: 'Title' }, note: { type: 'text', label: 'Note' } } },",
  "    { name: 'zz_fresh', label: 'Fresh', fields: { title: { type: 'text', label: 'Title' } } },",
  '  ],',
  '};',
  '',
].join('\n');

/** The tables this file reads back, by name. */
const TABLES = ['legacy_full', 'legacy_empty', 'plain_ok', 'zz_fresh'] as const;

type KnexLike = {
  (table: string): {
    insert: (rows: object[]) => Promise<unknown>;
    count: (spec: object) => Promise<Array<{ rows: number | string }>>;
    columnInfo: () => Promise<Record<string, unknown>>;
  };
  schema: {
    createTable: (name: string, build: (t: any) => void) => Promise<unknown>;
    hasTable: (name: string) => Promise<boolean>;
  };
};

function openDb(projectDir: string): { driver: SqlDriver; knex: KnexLike } {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(projectDir, '.objectstack', 'data', 'objectstack.db') },
    useNullAsDefault: true,
  });
  return { driver, knex: (driver as unknown as { knex: KnexLike }).knex };
}

async function seed(projectDir: string): Promise<void> {
  mkdirSync(join(projectDir, '.objectstack', 'data'), { recursive: true });
  const { driver, knex } = openDb(projectDir);
  try {
    await knex.schema.createTable('legacy_full', (t) => { t.string('_id').primary(); t.string('title'); });
    await knex('legacy_full').insert([{ _id: 'a', title: 'one' }, { _id: 'b', title: 'two' }, { _id: 'c', title: 'three' }]);
    await knex.schema.createTable('legacy_empty', (t) => { t.string('_id').primary(); t.string('title'); });
    await knex.schema.createTable('plain_ok', (t) => { t.string('id').primary(); t.string('title'); });
  } finally {
    await driver.disconnect();
  }
}

/** Each table's columns (sorted) and row count; `null` for a table that does not exist. */
async function readBack(projectDir: string): Promise<Record<string, { columns: string[]; rows: number } | null>> {
  const { driver, knex } = openDb(projectDir);
  try {
    const out: Record<string, { columns: string[]; rows: number } | null> = {};
    for (const t of TABLES) {
      if (!(await knex.schema.hasTable(t))) { out[t] = null; continue; }
      const [{ rows }] = await knex(t).count({ rows: '*' });
      out[t] = { columns: Object.keys(await knex(t).columnInfo()).sort(), rows: Number(rows) };
    }
    return out;
  } finally {
    await driver.disconnect();
  }
}

interface WorkEntry { table: string; kind: string; columns: string[]; rows?: number; refusal?: string }

const dirs: string[] = [];
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-30636-e2e-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);
  return dir;
}

describe('os migrate plan / apply on a `_id`-keyed table (#30636)', () => {
  let plan: Run;
  let apply: Run;
  let after: Awaited<ReturnType<typeof readBack>>;

  beforeAll(async () => {
    const dir = project();
    await seed(dir);
    // Sequential on purpose: each run boots a kernel.
    plan = await runCli(['migrate', 'plan', '--json'], dir);
    apply = await runCli(['migrate', 'apply', '--yes', '--allow-destructive', '--json'], dir);
    after = await readBack(dir);
  }, RUN_BUDGET_MS * 2);

  afterAll(() => {
    while (dirs.length > 0) {
      try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  const pendingOf = (table: string) =>
    (JSON.parse(plan.stdout) as { pending: WorkEntry[] }).pending.filter((p) => p.table === table);

  it('plans the `_id` table holding rows as a refusal naming the table, `_id` and the row count, with the refusal text', () => {
    expect(plan.code).toBe(0);
    const [entry, ...rest] = pendingOf('legacy_full');
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ table: 'legacy_full', kind: 'refuse_table', columns: ['_id'], rows: 3 });
    expect(entry!.refusal).toContain("existing table 'legacy_full'");
    expect(entry!.refusal).toContain("'_id' column");
    expect(entry!.refusal).toContain('holds 3 rows');
  });

  it('plans the empty `_id` table as a rebuild, never `add_columns`', () => {
    expect(pendingOf('legacy_empty').map((p) => p.kind)).toEqual(['rebuild_table']);
  });

  it('CONTROL: still plans `add_columns` for an `id`-keyed table missing a declared column', () => {
    const [entry] = pendingOf('plain_ok');
    expect(entry).toMatchObject({ kind: 'add_columns' });
    expect(entry!.columns).toContain('note');
  });

  it('apply ends PARTIAL with exit 1 and names the refused table, beside the work it performed', () => {
    expect(apply.code).toBe(1);
    const payload = JSON.parse(apply.stdout) as { message?: string; refused?: WorkEntry[]; created?: WorkEntry[] };
    expect(payload.message).toBe('partial');
    expect(payload.refused?.map((p) => [p.table, p.kind, p.rows])).toEqual([['legacy_full', 'refuse_table', 3]]);
    // The performed list survives the refusal, and a refusal is never in it.
    const created = new Map((payload.created ?? []).map((p) => [p.table, p.kind]));
    expect(created.get('legacy_empty')).toBe('rebuild_table');
    expect(created.get('plain_ok')).toBe('add_columns');
    expect(created.get('zz_fresh')).toBe('create_table');
    expect(created.has('legacy_full')).toBe(false);
  });

  it('every other table got its DDL; the refused one is exactly as it was, `_id` kept despite --allow-destructive', () => {
    expect(after.legacy_full).toEqual({ columns: ['_id', 'title'], rows: 3 });
    expect(after.legacy_empty?.columns).toContain('id');
    expect(after.legacy_empty?.columns).not.toContain('_id');
    expect(after.plain_ok?.columns).toContain('note');
    expect(after.zz_fresh).not.toBeNull();
  });
});
