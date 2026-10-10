// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * [#22506] THE PIN THAT CLOSES THE FAMILY: per app shape, the set of objects
 * `os migrate plan` examines equals the set a real `os serve` boot registers.
 *
 * ## The family
 *
 * A migration only examines the objects its own boot registers, and that
 * composition has lagged the serving boot three times: #12938 (no host config,
 * no platform floor), #21732 (a `requires`-supplied provider a plugin depended
 * on), #22506 (nothing `serve` mounts around the stack — the auth family behind
 * its auth gate, its capability providers, its REST plugin — so an app with
 * `requires: ['auth']` planned 9 of the 68 tables its boot created, and the
 * retired `sys_account.issuer` was never a drop). Each fix grew one list. This
 * pin makes the next gap fail one test instead of an upgrade.
 *
 * ## How "the boot registers" is read
 *
 * There is no in-process entry to `serve`'s composition — it is the oclif
 * command's own `run()` — and `@objectstack/verify`'s `bootStack` composes the
 * verification harness's set, not `serve`'s. So the boot side is `serve`
 * itself, through its own provision-and-exit door: `OS_MIGRATE_AND_EXIT=1`
 * boots the full composition, schema-syncs every registered object into a
 * FRESH database and exits. Its tables are its registered objects. The plan
 * then runs against that database, and three readings together are equality:
 *
 *  - `pending` is empty — every object the plan examines has the table the
 *    boot created (plan ⊆ boot);
 *  - the boot's tables, a rotation shard read as its object, number exactly
 *    the plan's examined objects plus `sys_packages` (boot ⊆ plan, app tables
 *    included) — with `pending` empty, equal counts are equal sets;
 *  - where the unmanaged-tables sweep runs (a project with a host config), it
 *    names nothing but `sys_packages`.
 *
 * `sys_packages` is the one table outside the object set, by construction:
 * `PackageServicePlugin.start()` creates it with raw DDL (`package-table.ts`),
 * and no object declares it. A new raw-DDL table fails this pin and has to be
 * named here with the same reason.
 *
 * Both sides run with `OS_TELEMETRY_DB=0`, so the pin compares object sets on
 * one database. A development boot's `telemetry` sibling (ADR-0057 §3.6) — a
 * second database both boots provision — is
 * `plan.telemetry-sibling.integration.test.ts`'s (#22579).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const RUN_DEV = resolve(CLI_ROOT, 'bin', 'run-dev.js');
const TSX = resolve(CLI_ROOT, '..', '..', 'node_modules', '.bin', 'tsx');
const CASE_TIMEOUT_MS = 300_000;
const NOT_AN_OBJECT = ['sys_packages'];

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

/** The child's environment: the fixture's database and artifact path, nothing inherited that retargets them. */
function childEnv(dir: string, dbFile: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'AUTH_SECRET', 'BETTER_AUTH_SECRET']) {
    delete env[key];
  }
  return {
    ...env,
    OS_DATABASE_URL: `file:${dbFile}`,
    OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
    OS_TELEMETRY_DB: '0',
    OS_CLOUD_URL: 'off',
    OS_TELEMETRY_DISABLED: '1',
    OS_AUTH_SECRET: 'os22506-parity-secret-at-least-32-characters',
    OS_LOG_LEVEL: 'warn',
  };
}

interface Reading {
  bootExit: number | null;
  bootTail: string;
  plan: any;
  planExit: number | null;
  tables: string[];
}

function bootThenPlan(dir: string): Reading {
  const dbFile = join(dir, 'boot.db');
  const env = childEnv(dir, dbFile);
  const boot = spawnSync(TSX, [RUN_DEV, 'serve', '--no-server', '--no-ui', '--no-console', '--port', '0'], {
    cwd: dir, env: { ...env, OS_MIGRATE_AND_EXIT: '1' }, encoding: 'utf8', timeout: 240_000,
  });
  const plan = spawnSync(TSX, [RUN_DEV, 'migrate', 'plan', '--json'], {
    cwd: dir, env, encoding: 'utf8', timeout: 240_000,
  });
  let payload: any;
  try { payload = JSON.parse(plan.stdout); } catch { payload = { unparsed: `${plan.stdout}\n${plan.stderr}`.slice(-800) }; }
  const db = new Database(dbFile, { readonly: true });
  let tables: string[];
  try {
    tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
      .map((t) => t.name.replace(/__r\d{6,8}$/, ''));
  } finally {
    db.close();
  }
  return {
    bootExit: boot.status,
    bootTail: `${boot.stdout}\n${boot.stderr}`.slice(-800),
    plan: payload,
    planExit: plan.status,
    tables: [...new Set(tables)].sort(),
  };
}

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-22506-parity-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

function expectParity(r: Reading): void {
  expect(r.bootExit, `the boot did not provision the database:\n${r.bootTail}`).toBe(0);
  expect(r.planExit, JSON.stringify(r.plan).slice(0, 800)).toBe(0);
  // plan ⊆ boot
  expect(r.plan.pending).toEqual([]);
  expect(r.plan.changes).toEqual([]);
  expect(r.plan.composition?.coverage?.unexaminedObjects).toBe(0);
  // boot ⊆ plan, every table by count: the boot's tables are the examined
  // objects plus the raw-DDL ones. With `pending` empty above, equal counts
  // are equal sets.
  const rawDdl = r.tables.filter((t) => NOT_AN_OBJECT.includes(t));
  expect(rawDdl).toEqual(NOT_AN_OBJECT);
  expect(r.tables.length).toBe(r.plan.managedTables + rawDdl.length);
  // … and platform tables by name, where the unmanaged sweep runs (it reports
  // itself `unreadable` on a project with no host config).
  if (r.plan.unmanagedTables?.status === 'read') {
    const unmanaged = (r.plan.unmanagedTables.tables ?? []).map((t: any) => (typeof t === 'string' ? t : t.table ?? t.name));
    expect(unmanaged.filter((t: string) => !NOT_AN_OBJECT.includes(t))).toEqual([]);
  }
}

describe('os migrate plan examines exactly what os serve registers, per app shape (#22506)', () => {
  it('an app with requires: [...] — the auth tier and a capability provider', () => {
    const dir = project({
      'objectstack.config.ts': [
        'export default {',
        "  manifest: { id: 'com.example.os22506parityapp', name: 'requires', version: '0.0.0', type: 'app' },",
        "  requires: ['auth', 'automation'],",
        "  objects: [{ name: 'os22506_parity_app', fields: { title: { type: 'text' } } }],",
        '};',
        '',
      ].join('\n'),
    });
    const r = bootThenPlan(dir);
    expectParity(r);
    expect(r.tables).toEqual(expect.arrayContaining(['os22506_parity_app', 'sys_account', 'sys_automation_run']));
  }, CASE_TIMEOUT_MS);

  it('a host config — instances in plugins beside its own metadata, the showcase\'s shape', () => {
    const dir = project({
      'objectstack.config.ts': [
        'class HostPlugin {',
        "  name = 'com.example.os22506.host';",
        '  async init(ctx: any) {',
        "    ctx.getService('manifest').register({",
        "      id: 'com.example.os22506.host', name: 'host', version: '0.0.0', type: 'plugin',",
        "      objects: [{ name: 'os22506_parity_host', fields: { title: { type: 'text' } } }],",
        '    });',
        '  }',
        '}',
        'export default {',
        "  manifest: { id: 'com.example.os22506parityhostapp', name: 'host app', version: '0.0.0', type: 'app' },",
        "  objects: [{ name: 'os22506_parity_hostapp', fields: { title: { type: 'text' } } }],",
        '  plugins: [new HostPlugin()],',
        '};',
        '',
      ].join('\n'),
    });
    const r = bootThenPlan(dir);
    expectParity(r);
    expect(r.tables).toEqual(expect.arrayContaining(['os22506_parity_host', 'os22506_parity_hostapp', 'sys_account']));
  }, CASE_TIMEOUT_MS);

  it('a standalone stack — a compiled artifact and no config', () => {
    const dir = project({});
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify({
      manifest: { id: 'com.example.os22506parityartifact', name: 'artifact', version: '0.0.0', type: 'app' },
      requires: ['auth'],
      objects: [{ name: 'os22506_parity_artifact', fields: { title: { type: 'text' } } }],
    }));
    const r = bootThenPlan(dir);
    expectParity(r);
    expect(r.tables).toEqual(expect.arrayContaining(['os22506_parity_artifact', 'sys_account']));
  }, CASE_TIMEOUT_MS);
});
