// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ownership ceremony's catalog is the one `os migrate organization-ownership
 * --apply` boots: the deployment's served composition, every platform provider
 * in it composed for its declarations only (`init()` runs; `start()` and every
 * hook do not). `authored-conversion` and the rewrite gate resolve the position
 * bindings an older release wrote against THAT catalog, so it must hold the
 * built-in positions and the `everyone` baseline a started kernel serves.
 *
 * ## The fixture
 *
 * The catalog: the apply command's boot (`bootSchemaStack` with its four
 * composition flags) over a compiled artifact, with an auth secret set so the
 * security plugin is composed, read through core's security catalog reader as
 * the command reads it. The artifact declares two positions in code:
 * `zz_in_code` naming `member_default`, and `zz_shipped` naming no set. The
 * database: the 17.x catalog rows every environment database holds — the
 * seeded `everyone` position, the seeded `member_default` set and the seeded
 * binding between them — plus the control: a seeded binding that names a
 * position no catalog declares.
 *
 * ## What each case measures
 *
 * The catalog holds the six built-ins and `everyone`'s baseline. Under
 * `single`, `authored-conversion` blocks on the control and on nothing else;
 * under a wall it reports, and the rewrite gate blocks on the control and on
 * nothing else, naming the act the wall allows: declare the position with its
 * sets, through the deployment's code or the metadata door. With the
 * declarations made from `start()` and `kernel:ready`, which this boot never
 * runs, both block on `everyone` as well.
 *
 * [#23542] Under a wall, the metadata door's own lock verdict — read as the
 * command reads it — tells the gate which definitions no door edits: a binding
 * the artifact's declaration already names clears the gate (the code door), and
 * one that adds a set to `zz_shipped`, a definition a package ships, gets the
 * fact and no act (ADR-0131 D6).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecurityCatalogReader } from '@objectstack/core';
import { AUDIENCE_ANCHOR_POSITIONS, BUILTIN_IDENTITY_NAMES } from '@objectstack/spec';
import { bootSchemaStack, type SchemaStack } from './schema-migrate.js';
import {
  applyOrganizationOwnership,
  type CatalogPort,
  type CeremonyCheckpoint,
  type OrganizationOwnershipApplyReport,
  type StepReport,
} from './organization-ownership-apply.js';
import { inventoryDigest } from './organization-ownership-plan.js';

// [#10126] Pay the first load of what the boot reaches through dynamic
// `import()`s at MODULE LOAD, outside the clocked hook.
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-security';

const CASE_TIMEOUT_MS = 180_000;
const PACKAGE_ID = 'com.example.ownership-catalog';
const ENV_KEYS = ['OS_ARTIFACT_PATH', 'OS_DATABASE_URL', 'DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'NODE_ENV',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ENVIRONMENT_ID', 'OS_MULTI_ORG_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};

let dir: string;
let stack: SchemaStack;
let catalog: CatalogPort;

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = 'production';
  process.env.OS_AUTH_SECRET = 'organization-ownership-catalog-'.padEnd(40, 'x');
  dir = mkdtempSync(join(tmpdir(), 'os-ownership-catalog-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  process.env.OS_HOME = join(dir, 'home');
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify({
    manifest: { id: PACKAGE_ID, name: 'ownership-catalog', version: '1.0.0', type: 'app' },
    positions: [
      { name: 'zz_in_code', label: 'In code', permissionSets: ['member_default'] },
      { name: 'zz_shipped', label: 'Shipped' },
    ],
  }));
  // The apply command's boot, flag for flag.
  stack = await bootSchemaStack({
    jsonOutput: false,
    databaseUrl: `file:${join(dir, 'boot.db')}`,
    projectRoot: dir,
    deferSchemaDdl: true,
    composeHostStack: true,
    composeServedPlatform: true,
    composeAuthGatedSecurity: true,
  });
  const kernel = stack.kernel as { getService(name: string): unknown };
  const engine = kernel.getService('objectql') as { registry: never };
  catalog = createSecurityCatalogReader({ registry: engine.registry, metadata: kernel.getService('metadata') as never });
}, CASE_TIMEOUT_MS);

afterAll(async () => {
  await stack?.shutdown();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** The 17.x catalog rows, and the control binding to a position no catalog declares. */
function v17Database(name: string): Database.Database {
  const db = new Database(join(dir, `${name}.db`));
  db.exec(`
    CREATE TABLE sys_position (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, label TEXT, managed_by TEXT,
      delegatable INTEGER, active INTEGER);
    INSERT INTO sys_position VALUES
      ('pos_everyone', NULL, 'everyone', 'Everyone', 'platform', 0, 1),
      ('pos_gone', NULL, 'zz_undeclared', 'Undeclared', 'platform', 0, 1);
    CREATE TABLE sys_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, label TEXT, managed_by TEXT,
      active INTEGER, object_permissions TEXT, system_permissions TEXT);
    INSERT INTO sys_permission_set VALUES ('ps_member_default', NULL, 'member_default', 'Member', 'platform', 1, '{}', '[]');
    CREATE TABLE sys_position_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, position_id TEXT,
      permission_set_id TEXT);
    INSERT INTO sys_position_permission_set VALUES
      ('bind_everyone', NULL, 'pos_everyone', 'ps_member_default'),
      ('bind_gone', NULL, 'pos_gone', 'ps_member_default');
  `);
  return db;
}

async function ceremony(posture: string, db: Database.Database): Promise<OrganizationOwnershipApplyReport> {
  let checkpoint: CeremonyCheckpoint | null = null;
  return applyOrganizationOwnership({
    executor: {
      dialect: 'sqlite',
      client: 'better-sqlite3',
      query: async (sql, params = []) => db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[],
      execute: async (sql, params = []) => { db.prepare(sql).run(...(params as unknown[])); },
    },
    posture,
    database: 'v17',
    // The plan the operator reviewed: the one this run computes.
    reviewedPlan: { file: 'plan.json', generatedAt: '2026-10-14T00:00:00Z', database: 'v17', inventoryDigest: inventoryDigest(), posture },
    catalog,
    // What the command hands it: the boot's own answer for the security plugin.
    securityPlugin: stack.composition.securityPlugin,
    // No view is served here: the form-withdrawal carry has nothing to judge.
    views: { list: async () => [] },
    // The save door's own verdict, as the command reads it: the item read's `editable`.
    lock: {
      verdict: async (type, name, packageId) => {
        const protocol = (stack.kernel as { getService(name: string): unknown }).getService('protocol') as {
          getMetaItem(request: { type: string; name: string; packageId?: string }): Promise<{ editable?: unknown; lock?: unknown } | null>;
        };
        const read = await protocol.getMetaItem({ type, name, ...(packageId ? { packageId } : {}) });
        return { editable: read?.editable !== false, ...(typeof read?.lock === 'string' ? { lock: read.lock } : {}) };
      },
    },
    door: { save: async (type, name) => { throw new Error(`the door was asked to save ${type} ${name}`); } },
    templates: { find: async () => undefined },
    columnDrops: { drop: async (columns) => columns.map((c) => ({ table: c.table, column: c.column, outcome: 'not-proposed' as const })) },
    ledger: { read: async () => checkpoint, write: async (cp) => { checkpoint = cp; } },
  });
}

const step = (report: OrganizationOwnershipApplyReport, name: StepReport['step']): StepReport =>
  report.steps.find((s) => s.step === name)!;

describe('the ownership ceremony resolves bindings against what a started kernel serves', () => {
  it('the apply boot\'s catalog holds the six built-in positions, and everyone names member_default', async () => {
    for (const name of [...BUILTIN_IDENTITY_NAMES, ...AUDIENCE_ANCHOR_POSITIONS]) {
      expect((await catalog.resolve('position', name))?.definition.name, name).toBe(name);
    }
    expect((await catalog.resolve('position', 'everyone'))?.definition.permissionSets).toContain('member_default');
  });

  it('single: authored-conversion blocks on the undeclared position, and not on everyone', async () => {
    const report = await ceremony('single', v17Database('single'));
    const conversion = step(report, 'authored-conversion');
    expect(conversion.status).toBe('blocked');
    expect(conversion.blockers).toHaveLength(1);
    expect(conversion.blockers[0]).toContain('position zz_undeclared');
    expect(conversion.blockers.join('\n')).not.toContain('everyone');
  }, CASE_TIMEOUT_MS);

  it('control: the boot composed the plugin, and the rewrite verifies grants of two shipped sets, 2 of 2', async () => {
    expect(stack.composition.securityPlugin).toEqual({ composed: true });
    const db = new Database(join(dir, 'shipped.db'));
    db.exec(`
      CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
      INSERT INTO sys_organization VALUES ('org_default', 'default');
      CREATE TABLE sys_user_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, permission_set TEXT);
      INSERT INTO sys_user_permission_set VALUES
        ('grant_admin', 'org_default', 'usr_admin', 'admin_full_access'),
        ('grant_nobypass', 'org_default', 'usr_admin', 'organization_admin_no_bypass');
    `);
    const rewrite = step(await ceremony('single', db), 'rewrite');
    expect(rewrite.blockers).toEqual([]);
    expect(rewrite).toMatchObject({ status: 'done', summary: { grants: 2, verified: 2 } });
  }, CASE_TIMEOUT_MS);

  it('walled: the rewrite gate blocks on the undeclared position, and not on everyone, naming the act the wall allows', async () => {
    const report = await ceremony('isolated', v17Database('walled'));
    expect(step(report, 'authored-conversion').status).toBe('done');
    const rewrite = step(report, 'rewrite');
    expect(rewrite.status).toBe('blocked');
    expect(rewrite.blockers).toHaveLength(1);
    expect(rewrite.blockers[0]).toContain('position zz_undeclared');
    expect(rewrite.blockers.join('\n')).not.toContain('everyone');
    // Not the step that reported done: the declaration, through either of its two doors.
    expect(rewrite.blockers[0]).not.toMatch(/resolve its blocker/);
    expect(rewrite.blockers[0]).toContain('deployment\'s code');
    expect(rewrite.blockers[0]).toContain('PUT /api/v1/meta/position/zz_undeclared');
  }, CASE_TIMEOUT_MS);

  it('walled: a binding the code declaration names clears the gate; one a sealed package definition lacks gets the fact, and no act', async () => {
    const db = v17Database('walled-declared');
    db.exec(`
      INSERT INTO sys_position VALUES
        ('pos_in_code', NULL, 'zz_in_code', 'In code', 'platform', 0, 1),
        ('pos_shipped', NULL, 'zz_shipped', 'Shipped', 'platform', 0, 1);
      INSERT INTO sys_position_permission_set VALUES
        ('bind_in_code', NULL, 'pos_in_code', 'ps_member_default'),
        ('bind_shipped', NULL, 'pos_shipped', 'ps_member_default');
    `);
    const rewrite = step(await ceremony('isolated', db), 'rewrite');
    expect(rewrite.status).toBe('blocked');
    expect(rewrite.blockers.join('\n')).not.toContain('zz_in_code');
    const sealed = rewrite.blockers.filter((b) => b.includes('position zz_shipped '));
    expect(sealed).toHaveLength(1);
    expect(sealed[0]).toContain(PACKAGE_ID);
    expect(sealed[0]).toContain('ADR-0131 D6');
    expect(sealed[0]).not.toMatch(/\b(Declare|Add|remove|resolve)\b|PUT |re-run/);
  }, CASE_TIMEOUT_MS);
});
