// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6/D7] The `sys_metadata` family declares no `organization_id`,
 * and the real engine shapes every read to the declared columns. On a
 * database the organization-ownership ceremony has not migrated the column is
 * still on disk, and the `os migrate` boots (unlike `os serve`, which refuses
 * such a database) reach it. Two paths are pinned here on a REAL engine over a
 * v17-shape SQLite file — the physical column added raw, outside the declared
 * object, and the legacy rows written into it the way a 17.x runtime stored
 * them:
 *
 * 1. `os migrate meta --stored` still tells a legacy organization's row apart
 *    (off the physical column) and reports it `skipped`, never re-saving it,
 *    while the environment's row beside it is rewritten.
 * 2. The ceremony's template promotion saves through `protocol.saveMetaItem`
 *    (`organization-ownership.ts`, the `door.save` port). MEASURED before the
 *    fix: with a legacy organization's `email_template` row and no environment
 *    row, the repository's single-row read resolved the organization's row and
 *    the save rewrote it IN PLACE — the organization's body gone, the row still
 *    the organization's. Now the write resolves the environment's row only:
 *    with none, it creates one, and the re-keyed unique index (no organization
 *    in the key) refuses it beside the organization's row — nothing written,
 *    the organization's row untouched, and the ceremony reports the refusal.
 *    Once the ceremony's promotion has made that row the environment's (S1,
 *    an in-place `organization_id = NULL`), the same save updates it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import MigrateMeta from './meta.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the command reaches them through dynamic `import()`s inside
// clocked hooks (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/plugin';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 180_000;

const ARTIFACT = { manifest: { id: 'com.example.m23429', name: 'm23429', version: '1.0.0', type: 'app' } };

/** A pre-17 flow: `delete_record` carrying `config.filters`, which the stored pass renames to `filter`. */
const legacyFlow = (name: string) => ({
  name,
  label: name,
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'n0', type: 'start', label: 'Start' },
    { id: 'n1', type: 'delete_record', label: 'Purge', config: { objectName: 'sys_user', filters: { name: 'stale' } } },
  ],
  edges: [{ id: 'e1', source: 'n0', target: 'n1' }],
});

const TEMPLATE = 'm23429_welcome';
const template = (subject: string) => ({ name: TEMPLATE, label: 'Welcome', locale: 'en-US', subject, bodyHtml: `<p>${subject}</p>` });

interface SeedRow { id: string; type: string; name: string; organization_id: string | null; body: unknown }
const SEED: SeedRow[] = [
  { id: 'env_flow', type: 'flow', name: 'm23429_env_purge', organization_id: null, body: legacyFlow('m23429_env_purge') },
  { id: 'org_flow', type: 'flow', name: 'm23429_org_purge', organization_id: 'org_a', body: legacyFlow('m23429_org_purge') },
  { id: 'org_template', type: 'email_template', name: TEMPLATE, organization_id: 'org_a', body: template('Org A welcome') },
];

let dir: string;
let templateDb: string;
const savedCwd = process.cwd();
const ENV_KEYS = ['OS_ARTIFACT_PATH', 'OS_DATABASE_URL', 'DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'NODE_ENV'] as const;
const savedEnv: Record<string, string | undefined> = {};

let caseSeq = 0;
function caseDb(): string {
  caseSeq += 1;
  const file = join(dir, 'cases', `${caseSeq}.db`);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(templateDb, file);
  return file;
}

/** Every `sys_metadata` row as stored, the physical organization column included. */
async function rawRows(dbFile: string): Promise<Array<{ id: string; type: string; name: string; organization_id: string | null; state: string; metadata: any }>> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    const rows = await (driver as any).knex('sys_metadata').select('id', 'type', 'name', 'organization_id', 'state', 'metadata');
    return rows.map((r: any) => ({ ...r, metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata }));
  } finally {
    await driver.disconnect();
  }
}

async function runJson(argv: string[]): Promise<{ payload: any; exitCode: number }> {
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
      await MigrateMeta.run([...argv, '--json'], { root: CLI_ROOT });
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

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = 'production';
  dir = mkdtempSync(join(tmpdir(), 'os-23429-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  process.env.OS_HOME = join(dir, 'home');
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(ARTIFACT));

  // The tables as this release provisions them, on a boot that hydrates nothing.
  templateDb = join(dir, 'template.db');
  const seed = await bootSchemaStack({
    jsonOutput: false, databaseUrl: `file:${templateDb}`, projectRoot: dir, hydrateMetadata: false,
  });
  await seed.shutdown();
  // The v17 shape, at the driver: the physical column a 17.x runtime created,
  // outside the declared object, and the rows written into it.
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: templateDb }, useNullAsDefault: true });
  try {
    const k = (driver as any).knex;
    await k.raw('ALTER TABLE sys_metadata ADD COLUMN organization_id TEXT');
    const now = new Date().toISOString();
    for (const row of SEED) {
      await k('sys_metadata').insert({
        id: row.id, type: row.type, name: row.name, organization_id: row.organization_id, package_id: null,
        state: 'active', version: 1, checksum: `sha256:seed_${row.id}`, created_at: now, updated_at: now,
        metadata: JSON.stringify(row.body),
      });
    }
  } finally {
    await driver.disconnect();
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

beforeEach(() => { process.chdir(dir); });
afterEach(() => { process.chdir(savedCwd); });

describe('os migrate meta --stored on a v17-shape database — the legacy organization row is told apart by its physical column', () => {
  it('preview: the environment row is pending, the organization row is skipped with its organization', async () => {
    const db = caseDb();
    const before = await rawRows(db);
    const { payload } = await runJson(['--stored', '--database-url', `file:${db}`]);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    const byName = new Map((payload.rows ?? []).map((r: any) => [r.name, r]));
    expect(byName.get('m23429_env_purge')).toMatchObject({ outcome: 'pending', organizationId: null });
    expect(byName.get('m23429_org_purge')).toMatchObject({ outcome: 'skipped', organizationId: 'org_a' });
    expect((byName.get('m23429_org_purge') as any).reason).toContain('promotion ceremony (ADR-0131 C7)');
    expect(await rawRows(db)).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('--apply: the environment row is rewritten, the organization row is left byte-for-byte as stored', async () => {
    const db = caseDb();
    const { payload } = await runJson(['--stored', '--apply', '--yes', '--database-url', `file:${db}`]);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    const byName = new Map((payload.rows ?? []).map((r: any) => [r.name, r]));
    expect(byName.get('m23429_env_purge')).toMatchObject({ outcome: 'rewritten' });
    expect(byName.get('m23429_org_purge')).toMatchObject({ outcome: 'skipped', organizationId: 'org_a' });

    const after = await rawRows(db);
    const env = after.filter((r) => r.name === 'm23429_env_purge');
    expect(env).toHaveLength(1);
    expect(env[0]!.metadata.nodes[1].config).toMatchObject({ filter: { name: 'stale' } });
    const org = after.find((r) => r.id === 'org_flow')!;
    expect(org.organization_id).toBe('org_a');
    expect(org.metadata).toEqual(legacyFlow('m23429_org_purge'));
  }, CASE_TIMEOUT_MS);
});

/** The ceremony's `--apply` boot (`organization-ownership.ts`), and its `door.save`. */
async function saveTemplateOnCeremonyBoot(db: string, subject: string): Promise<unknown> {
  const stack = await bootSchemaStack({
    jsonOutput: false,
    databaseUrl: `file:${db}`,
    projectRoot: dir,
    deferSchemaDdl: true,
    composeHostStack: true,
    composeServedPlatform: true,
    composeAuthGatedSecurity: true,
  });
  try {
    const protocol = (stack.kernel as { getService(name: string): any }).getService('protocol');
    await protocol.saveMetaItem({ type: 'email_template', name: TEMPLATE, item: template(subject), actor: 'os migrate organization-ownership' });
    return null;
  } catch (error) {
    return error;
  } finally {
    await stack.shutdown();
  }
}

describe('the ceremony\'s template-promotion save on a v17-shape database', () => {
  it('a legacy organization template and no environment row: the save never rewrites the organization\'s row — it is refused, nothing written', async () => {
    const db = caseDb();
    const before = (await rawRows(db)).filter((r) => r.type === 'email_template');
    const error = await saveTemplateOnCeremonyBoot(db, 'Environment welcome');
    expect(String((error as Error | null)?.message ?? error)).toMatch(/Duplicate record refused on 'sys_metadata'/);
    expect((await rawRows(db)).filter((r) => r.type === 'email_template')).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('once the promotion has made that row the environment\'s (in place), the same save updates it', async () => {
    const db = caseDb();
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: db }, useNullAsDefault: true });
    try {
      await (driver as any).knex('sys_metadata').where({ id: 'org_template' }).update({ organization_id: null });
    } finally {
      await driver.disconnect();
    }
    expect(await saveTemplateOnCeremonyBoot(db, 'Environment welcome')).toBeNull();
    const rows = (await rawRows(db)).filter((r) => r.type === 'email_template' && r.name === TEMPLATE && r.state === 'active');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'org_template', organization_id: null });
    expect(rows[0]!.metadata).toMatchObject({ subject: 'Environment welcome' });
  }, CASE_TIMEOUT_MS);
});
