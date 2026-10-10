// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * [#22579] `os migrate plan` / `apply` plan every object against the database
 * it lives in — a lifecycle-classed one in the `telemetry` sibling a serving
 * boot keeps it in (ADR-0057 §3.6), never in the primary.
 *
 * ## The defect, measured on `main` `d8830c2805`
 *
 * A development `os serve` boot of an app declaring `requires: ['auth',
 * 'automation']` keeps nine objects in `boot.telemetry.db`: `sys_activity`,
 * `sys_audit_log`, `sys_automation_run`, `sys_flow_dispatch`,
 * `sys_http_delivery`, `sys_job_run`, `sys_metadata_audit`, `sys_notification`
 * and `sys_notification_delivery`. The one-shot migration boot never
 * provisioned that sibling, so every one of them resolved to the primary:
 * `plan` listed all nine as `create_table`, and `apply --yes` created all nine
 * in `boot.db` — empty orphans beside the tables the served boot uses.
 *
 * ## What is pinned
 *
 *  - after a development boot, the plan names the sibling, lists no
 *    lifecycle-classed object for the primary, and examines both databases'
 *    objects; `apply` creates nothing, and neither database moves;
 *  - [#22580] its unmanaged-tables sweep reads the sibling's catalog too: a
 *    retired lifecycle-classed object strands its table there, and a sweep of
 *    the primary alone answered `read` without ever looking;
 *  - the CONTROL: a deployment with no sibling (`OS_TELEMETRY_DB=0`) plans as
 *    it always did — no sibling named, nothing pending;
 *  - a plan with the sibling on over a deployment that has none yet plans the
 *    lifecycle-classed objects into it, and brings no file into existence (the
 *    read-only probe, #6743, holds for the sibling as for the primary).
 *
 * Each step runs through the public door — `serve`'s provision-and-exit
 * (`OS_MIGRATE_AND_EXIT=1`), then the commands — from the source entry, which
 * pins `NODE_ENV=development`: a development boot on both sides, as `os dev`
 * followed by `os migrate plan` in that environment is.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const RUN_DEV = resolve(CLI_ROOT, 'bin', 'run-dev.js');
const TSX = resolve(CLI_ROOT, '..', '..', 'node_modules', '.bin', 'tsx');
const CASE_TIMEOUT_MS = 300_000;

/** The one table outside the object set (`PackageServicePlugin.start()`'s raw DDL; see the boot-parity pin). */
const NOT_AN_OBJECT = ['sys_packages'];

const CONFIG = [
  'export default {',
  "  manifest: { id: 'com.example.os22579sibling', name: 'sibling', version: '0.0.0', type: 'app' },",
  "  requires: ['auth', 'automation'],",
  "  objects: [{ name: 'os22579_sibling_app', fields: { title: { type: 'text' } } }],",
  '};',
  '',
].join('\n');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

interface Fixture {
  dir: string;
  primary: string;
  sibling: string;
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'os-22579-sibling-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);
  // `resolveTelemetryDbPath`'s dev default: `<primary>.telemetry.<ext>`.
  return { dir, primary: join(dir, 'boot.db'), sibling: join(dir, 'boot.telemetry.db') };
}

/** The child's environment: the fixture's database, nothing inherited that retargets it or the sibling. */
function childEnv(f: Fixture, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
    'OS_TELEMETRY_DB', 'AUTH_SECRET', 'BETTER_AUTH_SECRET',
  ]) {
    delete env[key];
  }
  return {
    ...env,
    OS_DATABASE_URL: `file:${f.primary}`,
    OS_ARTIFACT_PATH: join(f.dir, 'dist', 'objectstack.json'),
    OS_CLOUD_URL: 'off',
    OS_TELEMETRY_DISABLED: '1',
    OS_AUTH_SECRET: 'os22579-sibling-secret-at-least-32-characters',
    OS_LOG_LEVEL: 'warn',
    ...extra,
  };
}

/** `os serve`'s own provision-and-exit: the full composition schema-synced into the fixture's database(s). */
function serveBoot(f: Fixture, extra: NodeJS.ProcessEnv = {}): void {
  const boot = spawnSync(TSX, [RUN_DEV, 'serve', '--no-server', '--no-ui', '--no-console', '--port', '0'], {
    cwd: f.dir, env: childEnv(f, { ...extra, OS_MIGRATE_AND_EXIT: '1' }), encoding: 'utf8', timeout: 240_000,
  });
  expect(boot.status, `the serving boot did not provision the database:\n${`${boot.stdout}\n${boot.stderr}`.slice(-800)}`)
    .toBe(0);
}

function command(f: Fixture, argv: string[], extra: NodeJS.ProcessEnv = {}): { exit: number | null; payload: any } {
  const run = spawnSync(TSX, [RUN_DEV, 'migrate', ...argv], { cwd: f.dir, env: childEnv(f, extra), encoding: 'utf8', timeout: 240_000 });
  let payload: any;
  try { payload = JSON.parse(run.stdout); } catch { payload = { unparsed: `${run.stdout}\n${run.stderr}`.slice(-800) }; }
  return { exit: run.status, payload };
}

/** A database's tables, a rotation shard read as its object. */
function tables(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
      .map((t) => t.name.replace(/__r\d{6,8}$/, ''));
    return [...new Set(names)].sort();
  } finally {
    db.close();
  }
}

/** The schema and every row of every table — what "the database did not move" is read against. */
function state(file: string): unknown {
  const db = new Database(file, { readonly: true });
  try {
    const schema = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all() as Array<{ type: string; name: string }>;
    const rows: Record<string, unknown> = {};
    for (const entry of schema) {
      if (entry.type !== 'table' || entry.name.startsWith('sqlite_')) continue;
      rows[entry.name] = db.prepare(`SELECT * FROM "${entry.name}" ORDER BY rowid`).all();
    }
    return { schema, rows };
  } finally {
    db.close();
  }
}

const pendingTables = (payload: any): string[] => (payload.pending ?? []).map((p: any) => `${p.kind}:${p.table}`).sort();

describe('os migrate plan / apply plan each object against the database it lives in (#22579)', () => {
  it('after a development boot: the sibling is named and planned, nothing lifecycle-classed is planned for the primary, apply creates nothing', () => {
    const f = fixture();
    serveBoot(f);

    // The serving boot's layout — the thing the plan must describe.
    expect(existsSync(f.sibling), 'the development boot provisioned no telemetry sibling: nothing to plan against').toBe(true);
    const primaryTables = tables(f.primary);
    const siblingTables = tables(f.sibling);
    expect(siblingTables).toEqual(expect.arrayContaining(['sys_audit_log', 'sys_metadata_audit']));
    expect(primaryTables.filter((t) => siblingTables.includes(t)), 'one table in both databases').toEqual([]);
    // [#22580] What a retired lifecycle-classed object leaves behind: its table,
    // in the sibling, declared by nothing.
    const retired = 'sys_os22580_retired_event';
    const db = new Database(f.sibling);
    try { db.exec(`CREATE TABLE ${retired} (id TEXT PRIMARY KEY)`); } finally { db.close(); }
    const before = { primary: state(f.primary), sibling: state(f.sibling) };

    const plan = command(f, ['plan', '--json']);
    expect(plan.exit, JSON.stringify(plan.payload).slice(0, 800)).toBe(0);
    // Nothing to create anywhere — above all no lifecycle-classed object for the primary.
    expect(pendingTables(plan.payload)).toEqual([]);
    expect(plan.payload.changes).toEqual([]);
    expect(plan.payload.telemetryDatabase).toBe(f.sibling);
    expect(plan.payload.composition?.coverage?.unexaminedObjects).toBe(0);
    // Both databases' objects examined: their tables, less the raw-DDL one.
    expect(plan.payload.managedTables).toBe(primaryTables.length - NOT_AN_OBJECT.length + siblingTables.length);
    // [#22580] Both databases' catalogs swept: the sibling's stranded table is
    // reported beside the primary's raw-DDL one.
    expect(plan.payload.unmanagedTables?.status, JSON.stringify(plan.payload.unmanagedTables)).toBe('read');
    expect(plan.payload.unmanagedTables.tables.map((t: any) => t.table)).toEqual([...NOT_AN_OBJECT, retired].sort());
    // A plan writes nothing, to either database.
    expect({ primary: state(f.primary), sibling: state(f.sibling) }).toEqual(before);

    const apply = command(f, ['apply', '--yes', '--json']);
    expect(apply.exit, JSON.stringify(apply.payload).slice(0, 800)).toBe(0);
    expect(apply.payload.created).toEqual([]);
    expect(apply.payload.applied).toEqual([]);
    expect(apply.payload.telemetryDatabase).toBe(f.sibling);
    // No orphan in the primary, and nothing moved in either database.
    expect(tables(f.primary)).toEqual(primaryTables);
    expect({ primary: state(f.primary), sibling: state(f.sibling) }).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('the control — a deployment with no sibling plans as it did; with the sibling on, an absent one is planned and not created', () => {
    const f = fixture();
    serveBoot(f, { OS_TELEMETRY_DB: '0' });
    expect(existsSync(f.sibling)).toBe(false);
    const primaryTables = tables(f.primary);
    expect(primaryTables).toEqual(expect.arrayContaining(['sys_audit_log', 'sys_metadata_audit']));

    // No sibling: no sibling named, nothing pending, every object on the primary.
    const control = command(f, ['plan', '--json'], { OS_TELEMETRY_DB: '0' });
    expect(control.exit, JSON.stringify(control.payload).slice(0, 800)).toBe(0);
    expect('telemetryDatabase' in control.payload).toBe(false);
    expect(pendingTables(control.payload)).toEqual([]);
    expect(control.payload.changes).toEqual([]);
    expect(control.payload.managedTables).toBe(primaryTables.length - NOT_AN_OBJECT.length);

    // The sibling on, over this deployment: the serving boot would now keep
    // the lifecycle-classed objects in a sibling that does not exist yet, so
    // the plan creates them there — and, being a dry run, creates no file.
    const before = state(f.primary);
    const plan = command(f, ['plan', '--json']);
    expect(plan.exit, JSON.stringify(plan.payload).slice(0, 800)).toBe(0);
    const pending = pendingTables(plan.payload);
    expect(pending).toEqual(expect.arrayContaining(['create_table:sys_audit_log', 'create_table:sys_metadata_audit']));
    expect(pending.every((p) => p.startsWith('create_table:')), pending.join(', ')).toBe(true);
    expect(plan.payload.telemetryDatabase).toBe(f.sibling);
    expect(existsSync(f.sibling), 'a dry run brought the telemetry sibling into existence').toBe(false);
    expect(state(f.primary)).toEqual(before);
  }, CASE_TIMEOUT_MS);
});
