// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply` on a v17-shaped database whose
 * packages declare sharing rules, on the release that retired their seeder
 * (ADR-0131 C3 stage 9) — through the command, over a SQLite file.
 *
 * ## The database
 *
 * Built the way an environment's is, in the project directory the command runs
 * in (its `objectstack.config.mjs` declares the package). First a served boot
 * of THIS release (`@objectstack/verify`'s `bootStack`: `os serve`'s
 * composition, plugin starts included) of a package declaring eleven sharing
 * rules, over the file. Then
 * what a 17.x runtime left beside it: the eleven declared rules its seeder
 * wrote organization-less, each with the grant it materialised naming it by
 * row id, an organization's own rule with its grant, a customized declared
 * rule with no organization, and a column-drop table still carrying
 * `organization_id`. That is HotCRM's measured shape: eleven declared rules.
 *
 * ## The cases
 *
 *  1. The served boot writes NO `sys_sharing_rule` row for a declared rule —
 *     what `DECLARED_SHARING_RULE_SEEDER_RUNS` (`false`) states — and the
 *     sharing-rule service still serves every declared rule, read from the
 *     registry (its id is its name).
 *  2. Plan, then `--apply --json`, development boots like the boot that built
 *     the file: the mirror-deletion step renames each mirror's grant to its
 *     rule's name, then deletes exactly the eleven; `blocking 0`, nothing
 *     advisory, nothing remaining; every grant resolves (a kept row's id, or a
 *     declared name); the customized and the organization's rules stay; the
 *     `sys_migration` marker is verified. Then a served boot of the certified
 *     file with the v18 boot guard composed (`os serve`'s refusal) starts —
 *     with a table put back in the v17 shape, so the guard decides on the
 *     marker and not on columns — and serves the declared rules.
 *
 * The same verdict without a boot — the blocking, the checkpointed re-run and
 * the seeding legs, and a host departure of the same id that still blocks — is
 * `utils/organization-ownership-apply.declared-rule-mirrors.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
/** The declared rules, each of which a 17.x seeder left as a mirror row (HotCRM declares eleven). */
const MIRRORS = 11;
const DECLARED = Array.from({ length: MIRRORS }, (_, i) => `share_declared_${i + 1}`);

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
  sharingRules: DECLARED.map((name) => ({
    name,
    type: 'criteria',
    object: 'crm_deal',
    accessLevel: 'read',
    condition: 'record.status == "open"',
    sharedWith: { type: 'position', value: 'sales_rep' },
  })),
});

/** What the sharing-rule service serves, as a system caller lists it: [id, name] per rule. */
async function servedRules(kernel: { getService(name: string): unknown }): Promise<Array<[string, string]>> {
  const service = kernel.getService('sharingRules') as {
    listRules(filter: Record<string, unknown>, context: Record<string, unknown>): Promise<Array<{ id: string; name: string }>>;
  };
  return (await service.listRules({}, { isSystem: true, positions: [], permissions: [] })).map((r) => [r.id, r.name]);
}

let dir: string;
let file: string;
/** What the served boot left in `sys_sharing_rule`, read before the 17.x leftovers join it. */
let seeded: Record<string, unknown>[];
/** What the served boot's sharing-rule service served, read before it stopped. */
let servedAtBoot: Array<[string, string]>;
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
    // The project the command runs in: the ceremony boots ITS composition, so
    // the registry it asks for the declared rules holds this package's.
    writeFileSync(join(dir, 'objectstack.config.mjs'), `export default ${JSON.stringify(stackConfig(), null, 2)};\n`);

    // The served boot of this release, over the file.
    const stack = await bootStack(stackConfig(), { databaseFile: file });
    try {
      servedAtBoot = await servedRules(stack.kernel);
    } finally {
      await stack.stop();
    }
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
    const grant = (id: string, record: string, sourceId: string) =>
      sql(
        'INSERT INTO sys_record_share (id, organization_id, object_name, record_id, recipient_type, recipient_id, ' +
          `access_level, source, source_id, created_at) VALUES (?, ?, 'crm_deal', ?, 'user', 'usr_rep', 'read', 'rule', ?, ?)`,
        id, organization!, record, sourceId, '2026-01-01T00:00:00.000Z',
      );
    DECLARED.forEach((name, i) => {
      rule(`rule_v17_${i + 1}`, name, 'package', 0, null);
      grant(`share_v17_${i + 1}`, `deal_${i + 1}`, `rule_v17_${i + 1}`);
    });
    rule('rule_organization', 'organization_rule', 'admin', 0, organization!);
    grant('share_organization', 'deal_org', 'rule_organization');
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

  it('a served boot of this release writes no row for a declared rule, as DECLARED_SHARING_RULE_SEEDER_RUNS states, and serves every one from the registry', () => {
    expect(
      seeded,
      `DECLARED_SHARING_RULE_SEEDER_RUNS (utils/organization-ownership-inventory.ts) is ${DECLARED_SHARING_RULE_SEEDER_RUNS}, and ` +
        `a served boot of this release wrote ${seeded.length} declared sharing rule row(s): set the constant to what the ` +
        'boot does, in the change that changed the boot',
    ).toEqual(
      DECLARED_SHARING_RULE_SEEDER_RUNS
        ? DECLARED.map((name) => ({ name, managed_by: 'package', customized: 0, organization_id: null })).sort((a, b) => (a.name < b.name ? -1 : 1))
        : [],
    );
    expect(DECLARED_SHARING_RULE_SEEDER_RUNS).toBe(false);
    // Read, not written: each declared rule is served under its name as its id.
    expect(servedAtBoot).toEqual([...DECLARED].sort().map((name) => [name, name]));
  });

  it('--apply renames the grants, deletes exactly the eleven mirrors and certifies; then the served boot with the v18 guard starts', async () => {
    const planFile = join(dir, 'plan.json');
    const plan = await run(['--dev', '--database-url', `file:${file}`, '--json', '--out', planFile]);
    expect(plan.payload.error, JSON.stringify(plan.payload).slice(0, 800)).toBeUndefined();
    expect(plan.exitCode).toBe(0);
    // Nothing is held as advisory any more, so nothing is said of it.
    expect(plan.payload.plan.warnings.filter((w: string) => w.startsWith('sys_sharing_rule holds'))).toEqual([]);

    const apply = await run([
      '--dev', '--apply', '--backup-taken', '--plan-file', planFile, '--database-url', `file:${file}`, '--json',
      '--out', join(dir, 'apply.json'),
    ]);
    expect(apply.payload.error, JSON.stringify(apply.payload).slice(0, 800)).toBeUndefined();
    const { report } = apply.payload;
    const unattributable = report.tables.reduce((n: number, t: { unattributable: unknown[] }) => n + t.unattributable.length, 0);
    const blockers = report.steps.flatMap((s: { blockers: string[] }) => s.blockers);
    expect([apply.exitCode, report.complete, report.blocking, report.advisory], blockers.join('\n')).toEqual([0, true, 0, unattributable]);
    // Ruling C: a certified database holds no unattributable row a table holds against it.
    expect(report.tables.filter((t: { held?: unknown }) => t.held)).toEqual([]);
    expect(report.tables.find((t: { object: string }) => t.object === 'sys_sharing_rule')).toMatchObject({
      remaining: 0,
      deleted: MIRRORS,
      departures: [],
    });
    expect(report.steps.find((s: { step: string }) => s.step === 'mirror-deletion')).toMatchObject({
      status: 'done',
      summary: { grantsRenamed: MIRRORS },
    });
    expect(
      sql('SELECT verified_at IS NOT NULL AS verified, applied_at IS NOT NULL AS applied, blocking, advisory FROM sys_migration WHERE id = ?', ORGANIZATION_OWNERSHIP_MIGRATION_ID),
    ).toEqual([{ verified: 1, applied: 1, blocking: 0, advisory: unattributable }]);
    // Exactly the eleven went: the organization's rule and the customized one
    // stay, and no row of the table is organization-less any more.
    expect(sql('SELECT id FROM sys_sharing_rule ORDER BY id')).toEqual([{ id: 'rule_customized' }, { id: 'rule_organization' }]);
    expect(sql('SELECT COUNT(*) AS nulls FROM sys_sharing_rule WHERE organization_id IS NULL')).toEqual([{ nulls: 0 }]);
    // Every grant resolves: by name for a declared rule, by row id for the rule that keeps its row.
    expect(sql(`SELECT id, source_id FROM sys_record_share WHERE source = 'rule' ORDER BY id`)).toEqual([
      { id: 'share_organization', source_id: 'rule_organization' },
      ...DECLARED.map((name, i) => ({ id: `share_v17_${i + 1}`, source_id: name })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    ]);

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
      // The declared rules are served, the organization's rule beside them; the boot wrote no row.
      expect((await servedRules(served.kernel)).map(([, name]) => name)).toEqual(
        [...DECLARED, 'customized_rule', 'organization_rule'].sort(),
      );
      expect(sql('SELECT COUNT(*) AS n FROM sys_sharing_rule')).toEqual([{ n: 2 }]);
    } finally {
      await served.stop();
    }
  }, CASE_TIMEOUT_MS);
});
