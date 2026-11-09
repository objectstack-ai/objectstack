// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D10, child S4] `os migrate stored-references` and its `bind`
 * against a real SQLite database: the report of the stored references the
 * one D3 rule refuses, and the reviewed bind of one row.
 *
 * ## The fixture
 *
 * A compiled artifact of three packages:
 *
 *  - A (`m31693a`) declares an object, the sharing rules `m31693_share` and
 *    `m31693_only_a`, and the picklist `m31693_tone`; its object's `hue` field
 *    names the picklist `m31693_hue`;
 *  - B (`m31693b`, depends on A) declares the sharing rule `m31693_share` and
 *    the picklist `m31693_tone` too;
 *  - C (`m31693c`) declares the picklist `m31693_hue`, which A does not depend on.
 *
 * Over a database an older release left: two managed `sys_sharing_rule` rows
 * naming `m31693_share` (two holders: ambiguous) and `m31693_only_a` (one
 * holder: the CONTROL a boot binds, never reported), and an audience-binding
 * suggestion package A wrote naming `m31693_env_set`, a permission set only the
 * environment holds (D3 (a)). Every package column is null.
 *
 * ## What each case measures
 *
 * The report names every refused row with every candidate, the picklist field
 * the rule refuses (R17) and the sealed clash; two runs print the same bytes
 * and the database does not move. The bind writes exactly the chosen package
 * into exactly one row and leaves a `sys_audit_log` row; the report then drops
 * that row; a second bind writes 0. A refused row (environment-only), a package
 * that is not a candidate, and a candidate set that changed since the report
 * (stale) are refused, writing nothing. CONTROL: a database of one package
 * reports nothing and binds nothing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import MigrateStoredReferences from './stored-references/index.js';
import MigrateStoredReferencesBind from './stored-references/bind.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the commands reach them through dynamic `import()`s inside
// `run()`, which vitest clocks (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-audit';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 180_000;

const A = 'com.example.m31693a';
const B = 'com.example.m31693b';
const C = 'com.example.m31693c';
const ORG = 'org_m31693';
const rule = (name: string) => ({
  type: 'criteria', name, label: name, object: 'm31693a_task', condition: "record.title == 'x'",
  accessLevel: 'read', sharedWith: { type: 'user', value: 'u1' }, active: true,
});
const list = (name: string) => ({ name, label: name, options: [{ label: 'One', value: 'one' }] });
const pkgA = {
  manifest: {
    id: A, name: 'm31693a', version: '1.0.0', type: 'app', namespace: 'm31693a',
    objects: [{
      name: 'm31693a_task', label: 'Task', sharingModel: 'private',
      fields: {
        title: { name: 'title', label: 'Title', type: 'text' },
        hue: { name: 'hue', label: 'Hue', type: 'select', picklist: 'm31693_hue' },
      },
    }],
    sharingRules: [rule('m31693_share'), rule('m31693_only_a')],
    picklists: [list('m31693_tone')],
  },
};
const pkgB = {
  manifest: {
    id: B, name: 'm31693b', version: '1.0.0', type: 'app', namespace: 'm31693b', dependencies: { [A]: '^1.0.0' },
    sharingRules: [rule('m31693_share')],
    picklists: [list('m31693_tone')],
  },
};
const pkgC = { manifest: { id: C, name: 'm31693c', version: '1.0.0', type: 'app', namespace: 'm31693c', picklists: [list('m31693_hue')] } };
const artifact = (...packages: unknown[]) => ({
  manifest: { id: 'com.example.m31693', name: 'm31693', version: '1.0.0', type: 'app' }, packages,
});
const FULL = artifact(pkgA, pkgB, pkgC);
/** CONTROL: package A alone, its field's list declared by itself. */
const CONTROL = artifact({
  manifest: { ...pkgA.manifest, picklists: [list('m31693_tone'), list('m31693_hue')] },
});
/** Stale: B no longer declares `m31693_share`, so A is its one holder. */
const WITHOUT_B_RULE = artifact(pkgA, { manifest: { ...pkgB.manifest, sharingRules: [] } }, pkgC);

let dir: string;
let templateDb: string;
let controlDb: string;
const savedCwd = process.cwd();
const ENV_KEYS = ['OS_ARTIFACT_PATH', 'OS_DATABASE_URL', 'DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'NODE_ENV',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ENVIRONMENT_ID'] as const;
const savedEnv: Record<string, string | undefined> = {};
const writeArtifact = (body: unknown): void => writeFileSync(process.env.OS_ARTIFACT_PATH!, JSON.stringify(body));

let caseSeq = 0;
function caseDb(template = templateDb): string {
  caseSeq += 1;
  const file = join(dir, 'cases', `${caseSeq}.db`);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(template, file);
  return file;
}

/** Rows of `table`, read on a connection of our own. */
async function rowsOf(dbFile: string, table: string): Promise<Array<Record<string, unknown>>> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    return await (driver as any).knex(table).select('*').orderBy('id');
  } finally {
    await driver.disconnect();
  }
}

/** A database the served platform provisioned, with the rows an older release left (module doc). */
async function seedDatabase(file: string): Promise<void> {
  const stack = await bootSchemaStack({
    jsonOutput: true, databaseUrl: `file:${file}`, projectRoot: dir,
    composeHostStack: true, composeServedPlatform: true, composeAuthGatedSecurity: true,
  });
  try {
    const ql = stack.kernel.getService('objectql') as any;
    const ctx = { context: { isSystem: true, tenantId: ORG } };
    for (const name of ['m31693_share', 'm31693_only_a']) {
      await ql.insert('sys_sharing_rule', {
        name, label: name, object_name: 'm31693a_task', criteria_json: '{}', recipient_type: 'user', recipient_id: 'u1',
        access_level: 'read', active: false, managed_by: 'package', organization_id: ORG,
      }, ctx);
    }
    await ql.insert('sys_audience_binding_suggestion', {
      package_id: A, permission_set_name: 'm31693_env_set', anchor: 'everyone', status: 'pending', organization_id: ORG,
    }, ctx);
  } finally {
    await stack.shutdown();
  }
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  try {
    const now = new Date().toISOString();
    await (driver as any).knex('sys_metadata').insert({
      id: 'm31693_env_set_row', type: 'permission', name: 'm31693_env_set', package_id: null, state: 'active', version: 1,
      checksum: null, created_at: now, updated_at: now,
      metadata: JSON.stringify({ name: 'm31693_env_set', label: 'Saved in the environment', objects: {} }),
    });
  } finally {
    await driver.disconnect();
  }
}

interface RunResult { payload: any; raw: string; exitCode: number }

/** Run a command through oclif and capture its one JSON document. */
async function run(command: typeof MigrateStoredReferences | typeof MigrateStoredReferencesBind, argv: string[]): Promise<RunResult> {
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
      await command.run(argv, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const raw = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try { payload = JSON.parse(raw); } catch { payload = { unparsed: raw.slice(-400) }; }
    return { payload, raw, exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const report = (db: string) => run(MigrateStoredReferences, ['--database-url', `file:${db}`, '--json']);
const bind = (db: string, table: string, id: string, pkg: string, yes = true) =>
  run(MigrateStoredReferencesBind, ['--table', table, '--id', id, '--package', pkg, ...(yes ? ['--yes'] : []), '--database-url', `file:${db}`, '--json']);
const shareRow = async (db: string) => (await rowsOf(db, 'sys_sharing_rule')).find((r) => r.name === 'm31693_share')!;
const suggestionRow = async (db: string) => (await rowsOf(db, 'sys_audience_binding_suggestion')).find((r) => r.permission_set_name === 'm31693_env_set')!;

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = 'production';
  process.env.OS_AUTH_SECRET = 'm31693'.repeat(11);
  dir = mkdtempSync(join(tmpdir(), 'os-31693-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  process.env.OS_HOME = join(dir, 'home');
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  process.chdir(dir);
  try {
    writeArtifact(FULL);
    templateDb = join(dir, 'template.db');
    await seedDatabase(templateDb);
    writeArtifact(CONTROL);
    controlDb = join(dir, 'control.db');
    await seedDatabase(controlDb);
  } finally {
    writeArtifact(FULL);
    process.chdir(savedCwd);
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

// The commands take `process.cwd()` as the project root, as a real invocation does.
beforeEach(() => { process.chdir(dir); writeArtifact(FULL); });
afterEach(() => { process.chdir(savedCwd); });

describe('os migrate stored-references (the report)', () => {
  it('names every refused row with every candidate, the refused picklist field and the sealed clash; never the one-holder row', async () => {
    const db = caseDb();
    const { payload, exitCode } = await report(db);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    expect(exitCode).toBe(0);
    const share = await shareRow(db);
    const suggestion = await suggestionRow(db);
    expect(payload.stored).toEqual([
      {
        d8: 'R3', table: 'sys_audience_binding_suggestion', id: suggestion.id, column: 'permission_set_name',
        packageColumn: 'permission_set_package', name: 'm31693_env_set', callerPackageId: A, reason: 'environment-only',
        candidates: [{ holder: 'environment', address: '_env/m31693_env_set' }],
      },
      {
        d8: 'R5', table: 'sys_sharing_rule', id: share.id, column: 'name', packageColumn: 'package_id', name: 'm31693_share',
        reason: 'ambiguous',
        candidates: [
          { holder: 'package', packageId: A, address: 'm31693a/m31693_share' },
          { holder: 'package', packageId: B, address: 'm31693b/m31693_share' },
        ],
      },
    ]);
    expect(payload.picklists).toEqual([{
      d8: 'R17', object: 'm31693a_task', field: 'hue', packageId: A, name: 'm31693_hue', reason: 'outside-closure',
      candidates: [{ holder: 'package', packageId: C, address: 'm31693c/m31693_hue' }],
    }]);
    expect(payload.sealedClashes).toEqual([{ type: 'picklist', name: 'm31693_tone', candidates: [`package "${A}"`, `package "${B}"`] }]);
    // The served platform carries no automation or approvals table here: named, not silently skipped.
    expect(payload.tablesNotCarried).toEqual(expect.arrayContaining(['sys_automation_run', 'sys_flow_credential', 'sys_approval_request']));
  }, CASE_TIMEOUT_MS);

  it('two runs over one database print the same bytes, and the database does not move', async () => {
    const db = caseDb();
    const before = [await rowsOf(db, 'sys_sharing_rule'), await rowsOf(db, 'sys_audience_binding_suggestion')];
    const first = await report(db);
    const second = await report(db);
    expect(first.raw.length).toBeGreaterThan(0);
    expect(second.raw).toBe(first.raw);
    expect([await rowsOf(db, 'sys_sharing_rule'), await rowsOf(db, 'sys_audience_binding_suggestion')]).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('CONTROL: a database of one package reports nothing', async () => {
    writeArtifact(CONTROL);
    const { payload, exitCode } = await report(caseDb(controlDb));
    expect(exitCode).toBe(0);
    expect(payload.stored.filter((f: any) => f.reason !== 'environment-only')).toEqual([]);
    expect(payload.picklists).toEqual([]);
    expect(payload.sealedClashes).toEqual([]);
  }, CASE_TIMEOUT_MS);
});

describe('os migrate stored-references bind', () => {
  it('writes the chosen package into the one row, leaves an audit row, drops it from the report, and a second run writes 0', async () => {
    const db = caseDb();
    const share = await shareRow(db);
    const auditBefore = (await rowsOf(db, 'sys_audit_log')).length;
    const first = await bind(db, 'sys_sharing_rule', String(share.id), B);
    expect(first.payload, JSON.stringify(first.payload).slice(0, 600)).toMatchObject({ outcome: 'bound', written: 1, packageId: B, d8: 'R5' });
    expect(first.exitCode).toBe(0);
    expect((await shareRow(db)).package_id).toBe(B);
    // The one-holder row is not touched by a bind of another row.
    expect((await rowsOf(db, 'sys_sharing_rule')).find((r) => r.name === 'm31693_only_a')!.package_id ?? null).toBeNull();
    const audit = (await rowsOf(db, 'sys_audit_log')).filter((r) => r.object_name === 'sys_sharing_rule' && r.record_id === share.id);
    expect((await rowsOf(db, 'sys_audit_log')).length).toBe(auditBefore + 1);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(String(audit[0].new_value))).toEqual({ package_id: B });

    const after = await report(db);
    expect(after.payload.stored.map((f: any) => f.d8)).toEqual(['R3']);

    const second = await bind(db, 'sys_sharing_rule', String(share.id), B);
    expect(second.payload).toMatchObject({ outcome: 'refused', reason: 'already-bound', written: 0 });
    expect(second.exitCode).toBe(1);
    expect((await rowsOf(db, 'sys_audit_log')).length).toBe(auditBefore + 1);
  }, CASE_TIMEOUT_MS);

  it('a stale report binds nothing: once the candidate set changed, the bind is refused', async () => {
    const db = caseDb();
    const share = await shareRow(db);
    const reviewed = await report(db);
    expect(reviewed.payload.stored.find((f: any) => f.d8 === 'R5').candidates.map((c: any) => c.packageId)).toEqual([A, B]);
    writeArtifact(WITHOUT_B_RULE);
    const { payload, exitCode } = await bind(db, 'sys_sharing_rule', String(share.id), B);
    expect(payload).toMatchObject({ outcome: 'refused', reason: 'resolved', written: 0 });
    expect(exitCode).toBe(1);
    expect((await shareRow(db)).package_id ?? null).toBeNull();
  }, CASE_TIMEOUT_MS);

  it('never binds an environment-only reference, a package that is not a candidate, a report-only table, or without --yes', async () => {
    const db = caseDb();
    const share = await shareRow(db);
    const suggestion = await suggestionRow(db);
    const envOnly = await bind(db, 'sys_audience_binding_suggestion', String(suggestion.id), A);
    expect(envOnly.payload).toMatchObject({ outcome: 'refused', reason: 'environment-only', written: 0 });
    expect(envOnly.exitCode).toBe(1);
    const notCandidate = await bind(db, 'sys_sharing_rule', String(share.id), C);
    expect(notCandidate.payload).toMatchObject({ outcome: 'refused', reason: 'not-a-candidate', written: 0 });
    expect(notCandidate.payload.candidates.map((c: any) => c.packageId)).toEqual([A, B]);
    const reportOnly = await bind(db, 'sys_flow_dispatch', 'schedule:x:2026', A);
    expect(reportOnly.payload).toMatchObject({ outcome: 'refused', reason: 'report-only' });
    const unconfirmed = await bind(db, 'sys_sharing_rule', String(share.id), B, false);
    expect(unconfirmed.payload).toEqual({ error: 'confirmation_required', hint: 'pass --yes' });
    expect(unconfirmed.exitCode).toBe(1);
    expect((await shareRow(db)).package_id ?? null).toBeNull();
    expect((await suggestionRow(db)).permission_set_package ?? null).toBeNull();
  }, CASE_TIMEOUT_MS);

  it('CONTROL: a database of one package has nothing to bind', async () => {
    writeArtifact(CONTROL);
    const db = caseDb(controlDb);
    const share = await shareRow(db);
    const { payload, exitCode } = await bind(db, 'sys_sharing_rule', String(share.id), A);
    expect(payload).toMatchObject({ outcome: 'refused', reason: 'resolved', written: 0 });
    expect(exitCode).toBe(1);
    expect((await shareRow(db)).package_id ?? null).toBeNull();
  }, CASE_TIMEOUT_MS);
});
