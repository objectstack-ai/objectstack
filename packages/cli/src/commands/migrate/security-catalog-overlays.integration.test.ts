// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate security-catalog-overlays` against a real SQLite database: the
 * offline step that lists, and with `--apply` deletes, the environment-wide
 * rows a v18 cold boot refuses (maintainer ruling A′ on #22371, record
 * 6073500921, item 1, as amended by ruling letter B, record 6074838935).
 *
 * ## The fixture
 *
 * A compiled artifact (`dist/objectstack.json`, the shape a deployed app boots
 * from) whose package declares two positions and one permission set, over a
 * database an older release left behind with:
 *
 *  - LISTED: a `permission` row and a `position` row over the package's names,
 *    one bound to no package and one bound to the package itself, and a
 *    legacy-plural `positions` row over the package's other position;
 *  - LISTED ONLY WITH AUTH ON: a legacy-plural `permissions` row over
 *    `member_default`, a set the platform security plugin declares — and that
 *    plugin is composed only behind `os serve`'s auth gate;
 *  - CONTROLS, never listed: an environment-wide row whose name no package
 *    holds, an organization-scoped row and a draft row over a held name.
 *
 * ## What each case measures
 *
 * The command runs in-process through oclif, as the binary runs it. Its list is
 * compared with THE COLD BOOT'S OWN REFUSAL over the same database and
 * configuration: the same composition booted with `sys_metadata` hydration on,
 * which is what the engine's check judges — once with `OS_AUTH_SECRET` set and
 * once without, because the security plugin's names join only behind the gate
 * (measured on #22371: 3 names against 2). After `--apply` the same cold boot
 * comes up, and the step lists nothing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { NAMESPACE_CONFLICT_CODE } from '@objectstack/objectql';
import { SECURITY_PLUGIN_ID } from '@objectstack/plugin-security';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import MigrateSecurityCatalogOverlays from './security-catalog-overlays.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the command reaches them through dynamic `import()`s inside
// `run()`, which vitest clocks (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/plugin';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 180_000;
const SYSTEM = { context: { isSystem: true } } as const;

const PKG = 'com.example.m22371';
const ARTIFACT = {
  manifest: { id: PKG, name: 'm22371', version: '1.0.0', type: 'app' },
  positions: [{ name: 'm22371_lead', label: 'Lead' }, { name: 'm22371_old_lead', label: 'Old lead' }],
  permissions: [{ name: 'm22371_rep', label: 'Rep', objects: {} }],
};

interface SeedRow { type: string; name: string; organization_id: string | null; package_id: string | null; state: string }
const SEED: SeedRow[] = [
  { type: 'permission', name: 'm22371_rep', organization_id: null, package_id: null, state: 'active' },
  { type: 'position', name: 'm22371_lead', organization_id: null, package_id: PKG, state: 'active' },
  { type: 'positions', name: 'm22371_old_lead', organization_id: null, package_id: null, state: 'active' },
  { type: 'permissions', name: 'member_default', organization_id: null, package_id: null, state: 'active' },
  // Controls.
  { type: 'permission', name: 'm22371_free', organization_id: null, package_id: null, state: 'active' },
  { type: 'permission', name: 'm22371_rep', organization_id: 'org_m22371', package_id: null, state: 'active' },
  { type: 'permission', name: 'm22371_rep', organization_id: null, package_id: null, state: 'draft' },
];
const bodyOf = (row: SeedRow) =>
  (row.type.startsWith('permission') ? { name: row.name, label: 'Saved in the environment', objects: {} } : { name: row.name, label: 'Saved in the environment' });

/** The listed rows, as the command reports them: `type/name@binding heldBy`. */
const LISTED_AUTH_OFF = [
  `position/m22371_lead@${PKG} ${PKG}`,
  `positions/m22371_old_lead@- ${PKG}`,
  `permission/m22371_rep@- ${PKG}`,
];
const LISTED_AUTH_ON = [
  ...LISTED_AUTH_OFF,
  `permissions/member_default@- ${SECURITY_PLUGIN_ID}`,
];

const CONTROLS = [
  'permission/m22371_free/env/active',
  'permission/m22371_rep/org_m22371/active',
  'permission/m22371_rep/env/draft',
];

let dir: string;
let templateDb: string;
const savedCwd = process.cwd();
const ENV_KEYS = ['OS_ARTIFACT_PATH', 'OS_DATABASE_URL', 'DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'NODE_ENV',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ENVIRONMENT_ID'] as const;
const savedEnv: Record<string, string | undefined> = {};

function setAuth(on: boolean): void {
  if (on) process.env.OS_AUTH_SECRET = 'm22371-secret-'.padEnd(40, 'x');
  else delete process.env.OS_AUTH_SECRET;
}

/** A fresh copy of the template database for one case. */
let caseSeq = 0;
function caseDb(): string {
  caseSeq += 1;
  const file = join(dir, 'cases', `${caseSeq}.db`);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(templateDb, file);
  return file;
}

/** Every `sys_metadata` row, `type/name/org/state`, read on a connection of our own. */
async function storedRows(dbFile: string): Promise<string[]> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    const rows = await (driver as any).knex('sys_metadata').select('type', 'name', 'organization_id', 'state');
    return rows.map((r: any) => `${r.type}/${r.name}/${r.organization_id ?? 'env'}/${r.state}`).sort();
  } finally {
    await driver.disconnect();
  }
}

/** The history and audit rows the deletions wrote. */
async function trail(dbFile: string): Promise<{ history: string[]; audit: string[] }> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    const k = (driver as any).knex;
    const history = await k('sys_metadata_history').select('type', 'name', 'operation_type', 'recorded_by', 'organization_id');
    const audit = await k('sys_metadata_audit').select('type', 'name', 'operation', 'outcome', 'actor');
    return {
      history: history.filter((r: any) => r.operation_type === 'delete')
        .map((r: any) => `${r.type}/${r.name} ${r.operation_type} by ${r.recorded_by} org=${r.organization_id ?? 'env'}`).sort(),
      audit: audit.filter((r: any) => r.operation === 'delete')
        .map((r: any) => `${r.type}/${r.name} ${r.operation} ${r.outcome} by ${r.actor}`).sort(),
    };
  } finally {
    await driver.disconnect();
  }
}

/**
 * THE COLD BOOT: the step's own composition — `os serve`'s, by the shared rules
 * — booted with hydration ON, which is what the engine's check judges. Answers
 * its refusal's `conflicts[]` as `catalogType/name holder` lines, or `[]` when
 * the boot came up.
 */
async function coldBootConflicts(dbFile: string): Promise<string[]> {
  let stack;
  try {
    stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      projectRoot: dir,
      composeHostStack: true,
      composeAuthGatedSecurity: true,
      deferSchemaDdl: true,
      readOnlyProbe: true,
    });
  } catch (e) {
    const refusal = ((e as { cause?: unknown }).cause ?? e) as { code?: string; status?: number; conflicts?: any[] };
    expect(refusal.code, String(e)).toBe(NAMESPACE_CONFLICT_CODE);
    expect(refusal.status).toBe(422);
    return (refusal.conflicts ?? []).map((c) => `${c.catalogType}/${c.name} ${c.incomingPackageId}`).sort();
  }
  await stack.shutdown();
  return [];
}

interface RunResult { payload: any; exitCode: number }

/** Run the command through oclif and capture its one JSON document. */
async function runJson(argv: string[]): Promise<RunResult> {
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
  let thrownExit: number | undefined;
  try {
    try {
      await MigrateSecurityCatalogOverlays.run(argv, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try { payload = JSON.parse(out); } catch { payload = { unparsed: out.slice(-400) }; }
    return { payload, exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const listedOf = (payload: any): string[] =>
  (payload.rows ?? []).map((r: any) => `${r.type}/${r.name}@${r.packageId ?? '-'} ${r.heldBy.join(',')}`);
const asConflicts = (payload: any): string[] =>
  [...new Set((payload.rows ?? []).flatMap((r: any) => r.heldBy.map((p: string) => `${r.catalogType}/${r.name} ${p}`)))]
    .sort() as string[];

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = 'production';
  dir = mkdtempSync(join(tmpdir(), 'os-22371-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  process.env.OS_HOME = join(dir, 'home');
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(ARTIFACT));

  // The database an older release left: tables provisioned, then the rows
  // written at the driver the way that release stored them. Seeded on a boot
  // that hydrates nothing — a hydrating one is refused over these rows.
  templateDb = join(dir, 'template.db');
  const seed = await bootSchemaStack({
    jsonOutput: false, databaseUrl: `file:${templateDb}`, projectRoot: dir, hydrateMetadata: false,
  });
  try {
    const ql = seed.kernel.getService('objectql') as IObjectQLEngine;
    const now = new Date().toISOString();
    for (const row of SEED) {
      await ql.insert('sys_metadata', {
        ...row, version: 1, checksum: null, created_at: now, updated_at: now, metadata: JSON.stringify(bodyOf(row)),
      }, SYSTEM);
    }
  } finally {
    await seed.shutdown();
  }
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// The command takes `process.cwd()` as the project root, as a real invocation does.
beforeEach(() => { process.chdir(dir); });
afterEach(() => { process.chdir(savedCwd); setAuth(false); });

describe('os migrate security-catalog-overlays — the preview lists exactly what the cold boot refuses', () => {
  it.each([
    { auth: false, listed: LISTED_AUTH_OFF, securityPlugin: { composed: false, reason: 'no-secret' } },
    { auth: true, listed: LISTED_AUTH_ON, securityPlugin: { composed: true } },
  ])('auth $auth: the held rows are listed, the controls are not, and the list is the cold boot\'s conflicts', async ({ auth, listed, securityPlugin }) => {
    setAuth(auth);
    const db = caseDb();
    const before = await storedRows(db);

    // Over the compiled artifact that declares the held names, the cold boot
    // refuses — and the step, which hydrates nothing, runs.
    const refused = await coldBootConflicts(db);
    expect(refused.length, 'the cold boot is refused over these rows').toBeGreaterThan(0);

    const { payload, exitCode } = await runJson(['--database-url', `file:${db}`, '--json']);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    expect(payload.apply).toBe(false);
    expect(payload.securityPlugin).toEqual(securityPlugin);
    expect(listedOf(payload)).toEqual(listed);
    expect(payload.rows.every((r: any) => r.outcome === 'listed')).toBe(true);
    // The consistency the ruling names: the step's list is the refusal's conflicts.
    expect(asConflicts(payload)).toEqual(refused);
    // Rows listed: the boot would be refused, so the preview exits 1.
    expect(exitCode).toBe(1);
    // A preview writes nothing.
    expect(await storedRows(db)).toEqual(before);
    for (const control of CONTROLS) expect(before).toContain(control);
  }, CASE_TIMEOUT_MS);
});

describe('os migrate security-catalog-overlays --apply — deletes exactly the listed rows, and the cold boot then comes up', () => {
  it('auth on: every listed row deleted through the write path, one audit line each; the controls stay', async () => {
    setAuth(true);
    const db = caseDb();
    const before = await storedRows(db);

    const { payload, exitCode } = await runJson(['--apply', '--yes', '--database-url', `file:${db}`, '--json']);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    expect(exitCode).toBe(0);
    expect(listedOf(payload)).toEqual(LISTED_AUTH_ON);
    expect(payload.deleted).toBe(LISTED_AUTH_ON.length);
    expect(payload.failed).toBe(0);
    // One outcome per row, naming the write path it took.
    expect(payload.rows.map((r: any) => `${r.type}/${r.name} ${r.outcome} ${r.door}`)).toEqual([
      'position/m22371_lead deleted protocol.deleteMetaItem',
      'positions/m22371_old_lead deleted sys-metadata-repository',
      'permission/m22371_rep deleted protocol.deleteMetaItem',
      'permissions/member_default deleted sys-metadata-repository',
    ]);

    // Exactly the listed rows are gone; every control is still stored.
    const after = await storedRows(db);
    expect(before.filter((r) => !after.includes(r)).sort()).toEqual([
      'permission/m22371_rep/env/active',
      'permissions/member_default/env/active',
      'position/m22371_lead/env/active',
      'positions/m22371_old_lead/env/active',
    ]);
    for (const control of CONTROLS) expect(after).toContain(control);

    // The engine's trail: a history tombstone per row, and the ADR-0010 audit
    // row for each one the protocol's door deleted.
    const { history, audit } = await trail(db);
    expect(history).toEqual([
      'permission/m22371_rep delete by os migrate security-catalog-overlays org=env',
      'permissions/member_default delete by os migrate security-catalog-overlays org=env',
      'position/m22371_lead delete by os migrate security-catalog-overlays org=env',
      'positions/m22371_old_lead delete by os migrate security-catalog-overlays org=env',
    ]);
    expect(audit).toEqual([
      'permission/m22371_rep delete allowed by os migrate security-catalog-overlays',
      'position/m22371_lead delete allowed by os migrate security-catalog-overlays',
    ]);

    // The cold boot of the same database and configuration that was refused now
    // comes up, and a second preview lists nothing (exit 0).
    expect(await coldBootConflicts(db)).toEqual([]);
    const again = await runJson(['--database-url', `file:${db}`, '--json']);
    expect(again.payload.listed).toBe(0);
    expect(again.exitCode).toBe(0);
  }, CASE_TIMEOUT_MS * 2);

  it('auth off: the security plugin\'s set is left alone — the boot without it never refused that row', async () => {
    const db = caseDb();
    const { payload, exitCode } = await runJson(['--apply', '--yes', '--database-url', `file:${db}`, '--json']);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    expect(exitCode).toBe(0);
    expect(payload.deleted).toBe(LISTED_AUTH_OFF.length);
    expect(await storedRows(db)).toContain('permissions/member_default/env/active');
    expect(await coldBootConflicts(db)).toEqual([]);
  }, CASE_TIMEOUT_MS * 2);
});
