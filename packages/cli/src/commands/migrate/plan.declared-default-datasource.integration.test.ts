// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { defineStackSource, linkSpec } from '../../../test/helpers/define-stack-fixture.js';
import { childEnv, reservePort } from '../../../test/helpers/serve-process.js';

/**
 * [#24120] On a project whose primary store is a DECLARED datasource that
 * `datasourceMapping` routes as the default, `os migrate plan` examines the
 * drift `os dev` reports — the same set, in the same database.
 *
 * ## The defect
 *
 * `datasources: [{ name: 'qa_main', … }]` with
 * `datasourceMapping: [{ default: true, datasource: 'qa_main' }]`. `os dev`
 * connects `qa_main` under its declared name (through the
 * `datasource-connection` service `AppPlugin` connects declared datasources
 * by), so every object — platform objects included — lives there, and its boot
 * prints a `[schema-drift]` line per divergence, each naming `os migrate` as
 * the remedy. `os migrate plan` resolved the same database FILE as its primary
 * ("the project config's default datasource qa_main") but published no such
 * service, so `qa_main` stayed metadata-only, every object routed to it was
 * bound to no driver, and the plan printed `Examined 0 managed table(s)` and a
 * PARTIAL plan with no drift at all.
 *
 * ## What is pinned
 *
 * Two drifts are staged in the declared datasource's database, one per kind of
 * object the default rule routes: a column the app object no longer declares,
 * and a column no platform object declares on `sys_user`. Then:
 *
 *  - the plan's drift set (`table.column` of each `changes` entry) EQUALS the
 *    set of `[schema-drift]` lines `os dev` prints over the same database — and
 *    holds both staged drifts, so the equality is not two empty sets;
 *  - the plan examined every declared object (`unexaminedObjects: 0`) and
 *    names who chose its database (`config-datasource`, `qa_main`);
 *  - its unmanaged-table sweep counts that database's tables once, although
 *    the primary and `qa_main` are two connections to the one file.
 *
 * `os dev` runs as the operator runs it, compiling the config, with
 * `OS_MIGRATE_AND_EXIT=1` (its `serve --dev` child boots, syncs and exits) and
 * `--no-restart` (so the parent exits with it). The datasource's filename is
 * RELATIVE, as an author writes it: the primary resolves it against the project
 * root, the declared connection opens it from the project directory.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const RUN_DEV = resolve(CLI_ROOT, 'bin', 'run-dev.js');
const TSX = resolve(CLI_ROOT, '..', '..', 'node_modules', '.bin', 'tsx');
const CASE_TIMEOUT_MS = 600_000;
const SPAWN_TIMEOUT_MS = 240_000;

const APP_OBJECT = 'fx24120_thing';
const DATABASE = join('data', 'main.db');
/** The `[schema-drift]` line the SQL driver prints at boot: `[schema-drift] TABLE.COLUMN: …`. */
const DRIFT_LINE = /\[schema-drift\] ([a-z0-9_]+\.[a-z0-9_]+):/g;

let dir: string;

function writeConfig(fields: Record<string, unknown>): void {
  writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource({
    manifest: { id: 'com.example.fx24120', name: 'fx24120', version: '0.0.0', type: 'app', engines: { protocol: '^18' } },
    datasources: [{ name: 'qa_main', driver: 'sqlite', config: { filename: `./${DATABASE}` } }],
    datasourceMapping: [{ default: true, datasource: 'qa_main' }],
    objects: [{ name: APP_OBJECT, sharingModel: 'private', fields }],
  }));
}

/** The child's environment: nothing inherited that names a database, a home or a telemetry sibling. */
function env(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return childEnv({
    OS_DATABASE_URL: undefined,
    DATABASE_URL: undefined,
    TURSO_DATABASE_URL: undefined,
    OS_DATABASE_DRIVER: undefined,
    OS_HOME: undefined,
    OS_ARTIFACT_PATH: undefined,
    OS_TELEMETRY_DB: '0',
    OS_CLOUD_URL: 'off',
    OS_TELEMETRY_DISABLED: '1',
    OS_AUTH_SECRET: 'os24120-declared-default-secret-at-least-32-characters',
    NO_COLOR: '1',
    ...extra,
  });
}

/**
 * `os dev`, booted once and exited: its output. `--compile` because a config
 * newer than its artifact is otherwise served STALE (with a warning), and the
 * staged edit below is exactly such a config.
 */
function devBootOnce(): string {
  const r = spawnSync(
    TSX,
    [RUN_DEV, 'dev', '--port', String(reservePort()), '--compile', '--no-watch', '--no-restart', '--no-seed-admin'],
    { cwd: dir, env: env({ OS_MIGRATE_AND_EXIT: '1' }), encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS },
  );
  const output = `${r.stdout}\n${r.stderr}`;
  expect(r.status, `os dev did not boot and exit:\n${output.slice(-1500)}`).toBe(0);
  return output;
}

function planJson(): any {
  const r = spawnSync(TSX, [RUN_DEV, 'migrate', 'plan', '--json'], {
    cwd: dir, env: env(), encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS,
  });
  expect(r.status, `os migrate plan failed:\n${`${r.stdout}\n${r.stderr}`.slice(-1500)}`).toBe(0);
  return JSON.parse(r.stdout);
}

function tableCount(file: string): number {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-24120-declared-default-'));
  linkSpec(dir);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('os migrate plan on a datasourceMapping-default declared datasource (#24120)', () => {
  it('examines the drift os dev reports there — the same set', () => {
    // Provision: the first boot creates every table in the declared datasource.
    writeConfig({ title: { type: 'text' }, extra: { type: 'text' } });
    devBootOnce();

    // Stage: the app object stops declaring `extra`, and `sys_user` (a platform
    // object the same rule routes) gains a column no object declares.
    writeConfig({ title: { type: 'text' } });
    const db = new Database(join(dir, DATABASE));
    try { db.exec('ALTER TABLE sys_user ADD COLUMN fx24120_legacy TEXT'); } finally { db.close(); }

    const reported = new Set([...devBootOnce().matchAll(DRIFT_LINE)].map((m) => m[1]));
    const plan = planJson();
    const planned = new Set((plan.changes as Array<{ table: string; column?: string }>).map((c) => `${c.table}.${c.column}`));

    expect([...reported].sort()).toEqual(expect.arrayContaining([`${APP_OBJECT}.extra`, 'sys_user.fx24120_legacy']));
    expect([...planned].sort()).toEqual([...reported].sort());
    expect(plan.databaseSource).toEqual({ kind: 'config-datasource', datasource: 'qa_main' });
    expect(plan.composition?.coverage?.unexaminedObjects, JSON.stringify(plan.composition?.coverage)).toBe(0);
    expect(plan.managedTables).toBeGreaterThan(0);
    expect(plan.unmanagedTables?.status, JSON.stringify(plan.unmanagedTables)).toBe('read');
    expect(plan.unmanagedTables.physicalTables).toBe(tableCount(join(dir, DATABASE)));
  }, CASE_TIMEOUT_MS);
});
