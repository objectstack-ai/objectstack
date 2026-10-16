// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply` on a v17-shaped database whose
 * packages declare sharing rules, on a release whose served boot still seeds
 * them — through the command, over a SQLite file.
 *
 * ## The database
 *
 * Built the way an environment's is. First a served boot of THIS release
 * (`@objectstack/verify`'s `bootStack`: `os serve`'s composition, plugin starts
 * included) of a package declaring one sharing rule, over the file. Then what
 * a 17.x runtime left beside it: ten more declared rules its seeder wrote
 * organization-less, an organization's own rule, a customized declared rule
 * with no organization, and a column-drop table still carrying
 * `organization_id`. That is HotCRM's measured shape: eleven declared rules,
 * one of them seeded by the first v18 boot, before any ceremony ran.
 *
 * ## The cases
 *
 *  1. The served boot writes the declared rule as exactly the row the
 *     `declared-rule-mirrors` departure names (`managed_by 'package'`,
 *     uncustomized, no organization), and that is what
 *     `DECLARED_SHARING_RULE_SEEDER_RUNS` states. ⛔ When the seeder retires
 *     this case fails until the constant flips — in the same change.
 *  2. Plan, then `--apply --json`, development boots like the boot that built
 *     the file: `blocking 0`, the eleven rows advisory and named, the
 *     `sys_migration` marker verified with `blocking 0`, every rule row kept.
 *     Then a served boot of the certified file with the v18 boot guard
 *     composed (`os serve`'s refusal) starts — with a table put back in the
 *     v17 shape, so the guard decides on the marker and not on columns — and
 *     `os migrate apply`'s drop gate reads the marker as verified.
 *
 * The same verdict without a boot — the restore once the seeder retires, and a
 * host departure of the same id that still blocks — is
 * `utils/organization-ownership-apply.declared-rule-mirrors.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID } from '@objectstack/spec/system';
import { bootStack } from '@objectstack/verify';
import { findV17ShapeTables, OrganizationOwnershipBootGuardPlugin } from '@objectstack/runtime';
import { isExitSignal } from '../../utils/format.js';
import { readOrganizationOwnershipMarker } from '../../utils/organization-ownership-drop-gate.js';
import { DECLARED_SHARING_RULE_SEEDER_RUNS } from '../../utils/organization-ownership-inventory.js';

// Pay the first transform of the dist-resolved workspace deps the boots reach
// through dynamic `import()`s at MODULE LOAD, not inside a clocked case.
import '@objectstack/objectql';
import '@objectstack/metadata-protocol';

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CASE_TIMEOUT_MS = 120_000;
/** The rows a 17.x seeder left, beside the one this release's served boot writes. */
const V17_MIRRORS = 10;
const MIRRORS = V17_MIRRORS + 1;

/** Env that would point a boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'OS_DATABASE_AUTH_TOKEN',
  'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH', 'OS_TELEMETRY_DB', 'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED', 'OS_SKIP_SCHEMA_SYNC', 'NODE_ENV',
] as const;

/** A package declaring one sharing rule; built anew per boot, as `bootStack` asks. */
const stackConfig = () => ({
  manifest: { id: 'com.test.declared_rule_mirrors', name: 'Declared rule mirrors', type: 'app', version: '1.0.0' },
  objects: [
    {
      name: 'crm_deal',
      label: 'Deal',
      fields: { name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
    },
  ],
  sharingRules: [
    {
      name: 'share_open_deals',
      type: 'criteria',
      object: 'crm_deal',
      accessLevel: 'read',
      condition: 'record.status == "open"',
      sharedWith: { type: 'position', value: 'sales_rep' },
    },
  ],
});

let dir: string;
let file: string;
/** What the served boot left in `sys_sharing_rule`, read before the 17.x leftovers join it. */
let seeded: Record<string, unknown>[];
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** One statement against the file, through a connection of its own. */
function sql(statement: string, ...params: unknown[]): Record<string, unknown>[] {
  const db = new Database(file);
  try {
    const prepared = db.prepare(statement);
    return prepared.reader ? (prepared.all(...params) as Record<string, unknown>[]) : (prepared.run(...params), []);
  } finally {
    db.close();
  }
}

/** The real command, its stdout parsed, and the exit it asked for. */
async function run(args: string[]): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.chdir(dir);
  let exitCode: number | undefined;
  try {
    try {
      await MigrateOrganizationOwnership.run(args, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const payload = JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
    return { payload, exitCode: exitCode ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

describe('os migrate organization-ownership on a database whose packages declare sharing rules', () => {
  beforeAll(async () => {
    for (const key of OVERRIDING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
    dir = mkdtempSync(join(tmpdir(), 'os-ceremony-declared-rules-'));
    file = join(dir, 'fixture.db');

    // The served boot of this release, over the file.
    const stack = await bootStack(stackConfig(), { databaseFile: file });
    await stack.stop();
    seeded = sql('SELECT name, managed_by, customized, organization_id FROM sys_sharing_rule ORDER BY name');

    // What a 17.x runtime left beside it.
    const [{ id: organization }] = sql(`SELECT id FROM sys_organization WHERE slug = 'default'`) as Array<{ id: string }>;
    const rule = (id: string, name: string, managedBy: string, customized: number, organizationId: string | null) =>
      sql(
        'INSERT INTO sys_sharing_rule (id, organization_id, name, label, object_name, criteria_json, recipient_type, ' +
          `recipient_id, access_level, active, managed_by, customized) VALUES (?, ?, ?, ?, 'crm_deal', ?, 'position', ` +
          `'sales_rep', 'read', 1, ?, ?)`,
        id, organizationId, name, name, '{"status":"open"}', managedBy, customized,
      );
    for (let i = 1; i <= V17_MIRRORS; i++) rule(`rule_v17_${i}`, `share_v17_${i}`, 'package', 0, null);
    rule('rule_organization', 'organization_rule', 'admin', 0, organization!);
    rule('rule_customized', 'customized_rule', 'package', 1, null);
    sql('ALTER TABLE sys_job ADD COLUMN organization_id varchar(255)');
    sql(`INSERT INTO sys_job (id, name, organization_id) VALUES ('job_v17', 'nightly', NULL)`);
  }, CASE_TIMEOUT_MS);

  afterAll(() => {
    for (const key of OVERRIDING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('a served boot of this release writes the declared rule as the row the departure names, as DECLARED_SHARING_RULE_SEEDER_RUNS states', () => {
    expect(
      seeded,
      `DECLARED_SHARING_RULE_SEEDER_RUNS (utils/organization-ownership-inventory.ts) is ${DECLARED_SHARING_RULE_SEEDER_RUNS}, and ` +
        `a served boot of this release wrote ${seeded.length} declared sharing rule row(s): set the constant to what the ` +
        'boot does, in the change that changed the boot',
    ).toEqual(
      DECLARED_SHARING_RULE_SEEDER_RUNS
        ? [{ name: 'share_open_deals', managed_by: 'package', customized: 0, organization_id: null }]
        : [],
    );
  });

  it('--apply certifies: blocking 0, the eleven rows advisory, the marker verified; then the served boot with the v18 guard starts', async () => {
    const planFile = join(dir, 'plan.json');
    const plan = await run(['--dev', '--database-url', `file:${file}`, '--json', '--out', planFile]);
    expect(plan.payload.error, JSON.stringify(plan.payload).slice(0, 800)).toBeUndefined();
    expect(plan.exitCode).toBe(0);
    // Said before the first write, and carried by the plan file.
    expect(plan.payload.plan.warnings).toContainEqual(expect.stringMatching(new RegExp(`^sys_sharing_rule holds ${MIRRORS} organization-less row\\(s\\) of `)));

    const apply = await run([
      '--dev', '--apply', '--backup-taken', '--plan-file', planFile, '--database-url', `file:${file}`, '--json',
      '--out', join(dir, 'apply.json'),
    ]);
    expect(apply.payload.error, JSON.stringify(apply.payload).slice(0, 800)).toBeUndefined();
    const { report } = apply.payload;
    const unattributable = report.tables.reduce((n: number, t: { unattributable: unknown[] }) => n + t.unattributable.length, 0);
    expect([apply.exitCode, report.complete, report.blocking, report.advisory]).toEqual([0, true, 0, unattributable + MIRRORS]);
    expect(report.tables.find((t: { object: string }) => t.object === 'sys_sharing_rule')).toMatchObject({
      remaining: 0,
      departures: [{ id: 'declared-rule-mirrors', as: 'mirror-deletion', rows: MIRRORS, advisory: expect.stringMatching(/own boot still writes them/) }],
      notNull: { willReceive: false, reason: expect.stringMatching(new RegExp(`^${MIRRORS} row\\(s\\) stay NULL on this release, reported as advisory: `)) },
    });
    expect(
      sql('SELECT verified_at IS NOT NULL AS verified, applied_at IS NOT NULL AS applied, blocking, advisory FROM sys_migration WHERE id = ?', ORGANIZATION_OWNERSHIP_MIGRATION_ID),
    ).toEqual([{ verified: 1, applied: 1, blocking: 0, advisory: unattributable + MIRRORS }]);
    // Nothing of the table was deleted; the eleven kept their NULL.
    expect(sql('SELECT COUNT(*) AS n, SUM(organization_id IS NULL) AS nulls FROM sys_sharing_rule')).toEqual([{ n: MIRRORS + 2, nulls: MIRRORS }]);

    // A table back in the v17 shape, so the guard decides on the marker.
    sql('ALTER TABLE sys_job ADD COLUMN organization_id varchar(255)');
    const served = await bootStack(stackConfig(), {
      databaseFile: file,
      extraPlugins: [new OrganizationOwnershipBootGuardPlugin({ dev: true })],
    });
    try {
      const engine = served.kernel.getService('objectql') as Parameters<typeof findV17ShapeTables>[0] &
        Parameters<typeof readOrganizationOwnershipMarker>[0];
      expect(await findV17ShapeTables(engine)).toEqual(['sys_job']);
      expect((await readOrganizationOwnershipMarker(engine)).verified).toBe(true);
    } finally {
      await served.stop();
    }
  }, CASE_TIMEOUT_MS);
});
