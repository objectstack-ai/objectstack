// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23022 — `os migrate plan` lists `sys_packages` and `os migrate apply`
 * creates it, with `OS_SKIP_SCHEMA_SYNC=1` in the environment.
 *
 * ## What was broken
 *
 * `sys_packages` is the one table outside the object set:
 * `PackageServicePlugin.start()` creates it with raw DDL (it keys on
 * `(id, version)`, which a declared object cannot carry). A migrate boot runs a
 * provider's `init()` and never its `start()`, and no driver deferral sees a
 * table no object declares, so the plan never listed it and `apply` never
 * created it. A deployment that sets the flag — "skip the implicit `db:sync` on
 * boot. Use after running migrations manually." — therefore had no documented
 * way to get it, and the boot could not honour the flag without stranding the
 * deployment. Measured on `9f4b652e3` through `os migrate plan --json` and
 * `os migrate apply --yes --json`: no `sys_packages` in `pending`, and absent
 * after the apply.
 *
 * ## What this holds, through the REAL funnel
 *
 * The boot is `bootSchemaStack` exactly as the two commands call it, composing
 * the real `PackageServicePlugin` the way `os serve` mounts it (the always-on
 * `package-registry` provider), so the two ends of the `package.storage`
 * declaration — the plugin's `init()` and this CLI's reader — meet here:
 *
 *  1. plan (a never-started project): `create_table sys_packages` is pending,
 *     with the table's seven columns, and no database file is brought into
 *     existence;
 *  2. apply: the boot creates no `sys_packages` before the flush (the table is
 *     still absent while the plan is on screen), the flush creates it and
 *     reports it, and the table is the one the boot's own DDL creates —
 *     `PRIMARY KEY (id, version)`, `TEXT` timestamps, `idx_packages_latest`;
 *  3. a plan over the migrated database lists nothing for it — and [#24059]
 *     still names it among the tables the composition declares outside the
 *     object set (`nonObjectTables`), which is what keeps `os migrate plan`'s
 *     unmanaged-table sweep from reporting the table this apply created.
 *
 * The flag is SET for every boot here: the documented path must not depend on
 * it. That the boot itself creates nothing under the flag is
 * `@objectstack/service-package`'s `managed-path.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
// Module-top side-effect loads, paid during COLLECTION rather than inside a
// clocked test body: `bootSchemaStack` reaches these through dynamic
// `import()`s that resolve through `dist/` (`check:test-source-alias`).
import '@objectstack/runtime';
import '@objectstack/objectql';
import { bootSchemaStack, type SchemaStack } from './schema-migrate.js';

const COLUMNS = ['id', 'version', 'manifest', 'metadata', 'hash', 'created_at', 'updated_at'];

/** The env vars that outrank the unified project default (#6469). */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'];
const SET_ENV: Record<string, string> = {
  OS_SKIP_SCHEMA_SYNC: '1',
  OS_TELEMETRY_DB: '0',
  NODE_ENV: 'production',
};

describe('os migrate plan / apply cover sys_packages, flag set (#23022)', () => {
  let dir: string;
  let dbFile: string;
  let stack: SchemaStack | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  const boot = (mode: 'plan' | 'apply'): Promise<SchemaStack> => bootSchemaStack({
    jsonOutput: false,
    projectRoot: dir,
    databaseUrl: `file:${dbFile}`,
    deferSchemaDdl: true,
    ...(mode === 'plan' ? { readOnlyProbe: true } : {}),
    composeHostStack: true,
    composeServedPlatform: true,
  });

  const packageWork = (s: SchemaStack) => s.pendingSchemaWork.filter((w) => w.table === 'sys_packages');

  /** Read the file with a connection of OUR OWN — never the booted stack's. */
  function readTable() {
    const db = new Database(dbFile, { readonly: true });
    try {
      return {
        present: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sys_packages'").all().length === 1,
        columns: db.prepare("SELECT name, type, \"notnull\" AS not_null FROM pragma_table_info('sys_packages') ORDER BY cid").all(),
        pk: db.prepare("SELECT name FROM pragma_table_info('sys_packages') WHERE pk > 0 ORDER BY pk").all(),
        index: db.prepare("SELECT name FROM pragma_index_info('idx_packages_latest') ORDER BY seqno").all(),
      };
    } finally {
      db.close();
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-23022-'));
    dbFile = join(dir, 'app.db');
    writeFileSync(join(dir, 'objectstack.config.ts'), [
      'export default {',
      "  manifest: { id: 'com.example.os23022', name: 'os23022', version: '0.0.0', type: 'app' },",
      "  objects: [{ name: 'os23022_note', fields: { title: { type: 'text' } } }],",
      '};',
      '',
    ].join('\n'));
    for (const key of [...OVERRIDING_ENV, ...Object.keys(SET_ENV), 'OS_ARTIFACT_PATH']) savedEnv[key] = process.env[key];
    for (const key of OVERRIDING_ENV) delete process.env[key];
    Object.assign(process.env, SET_ENV);
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json'); // deliberately absent
  });

  afterEach(async () => {
    try { await stack?.shutdown(); } catch { /* torn down either way */ }
    stack = null;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('plan lists it, apply creates the boot\'s own table, and a plan after that lists nothing for it', async () => {
    // 1. plan — a never-started project.
    stack = await boot('plan');
    expect(stack.composition.servedBoot).toEqual({ mirrored: true });
    expect(packageWork(stack)).toEqual([{ table: 'sys_packages', kind: 'create_table', columns: COLUMNS }]);
    expect(stack.nonObjectTables).toEqual(['sys_packages']);
    await stack.shutdown();
    stack = null;
    expect(existsSync(dbFile), 'a dry run brought the database into existence').toBe(false);

    // 2. apply — nothing for it before the flush, the boot's table after it.
    stack = await boot('apply');
    expect(packageWork(stack)).toEqual([{ table: 'sys_packages', kind: 'create_table', columns: COLUMNS }]);
    expect(readTable().present, 'the migrate boot created sys_packages before the operator confirmed').toBe(false);
    const created = await stack.flushSchemaDdl();
    expect(created.filter((w) => w.table === 'sys_packages')).toEqual([
      { table: 'sys_packages', kind: 'create_table', columns: COLUMNS },
    ]);
    await stack.shutdown();
    stack = null;
    expect(readTable()).toEqual({
      present: true,
      columns: COLUMNS.map((name) => ({
        name,
        type: 'TEXT',
        not_null: ['created_at', 'updated_at'].includes(name) ? 0 : 1,
      })),
      pk: [{ name: 'id' }, { name: 'version' }],
      index: [{ name: 'id' }, { name: 'created_at' }],
    });

    // 3. plan again — the table is there, so nothing is pending for it…
    stack = await boot('plan');
    expect(packageWork(stack)).toEqual([]);
    // …and [#24059] the declaration still names it, from the same service.
    expect(stack.nonObjectTables).toEqual(['sys_packages']);
  }, 300_000);
});
