// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply`, the form-withdrawal carry onto
 * a view a READ-ONLY package ships (ADR-0146 D1, D2, D3).
 *
 * The read-only base itself takes no customization: the metadata door refuses
 * a save naming it where its `.custom` pair can take the write (the named-base
 * close). So the carry ensures the pair through the ensure door and saves the
 * withdrawal into it, declaring `overrides: { package: <base>, basedOn }`.
 *
 * ## The fixture
 *
 * A project whose config is a booted code package (read-only: its manifest is
 * registered at boot) shipping an object and a public form view, over a
 * database a served boot of this tree left behind, shaped like v17:
 * `sys_metadata` carries `organization_id`, and an organization's row of the
 * form view withdraws it (`sharing.enabled: false`).
 *
 * ## What each case measures
 *
 * The real command, in process through oclif (plan, then `--apply`): the step
 * carries the withdrawal into the pair, the pair is in `sys_packages`, its row
 * declares the override at the base's version, and the env-wide view list the
 * anonymous doors judge by serves the form withdrawn. A second `--apply` over
 * the same database finds the step checkpointed and writes nothing. (A re-run
 * of the carry itself, with no checkpoint, is pinned in
 * `organization-ownership-apply.test.ts`.)
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anonymousFormIntakeCandidates, anonymousFormIntakeWithdrawnIn } from '@objectstack/metadata-core';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import MigrateOrganizationOwnership from './organization-ownership.js';

// [#10126] Pay the first load of what the command reaches through dynamic
// `import()`s at MODULE LOAD, outside the clocked case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/metadata-protocol';
import { PackageServicePlugin } from '@objectstack/service-package';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;

const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'OS_MULTI_ORG_ENABLED',
] as const;

const BASE = 'com.example.wdpair';
const PAIR = `${BASE}.custom`;
const VERSION = '1.4.0';
const VIEW = 'wdp_lead.intake';
const SLUG = 'wdp-intake';
const DATA = { provider: 'object', object: 'wdp_lead' };
const FORM = {
  type: 'simple',
  data: DATA,
  sections: [{ name: 'main', label: 'Main', columns: 1, fields: [{ field: 'name' }] }],
  sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
};
const CONFIG = {
  manifest: { id: BASE, name: 'Withdrawal Pair', version: VERSION, type: 'app', namespace: 'wdp' },
  objects: [{ name: 'wdp_lead', label: 'Lead', fields: { name: { type: 'text', label: 'Name' } } }],
  views: [{ list: { label: 'Leads', type: 'grid', data: DATA, columns: [{ field: 'name' }] }, formViews: { intake: FORM } }],
};
/** The organization's 17.x row of the form view: the served body, the form withdrawn. */
const WITHDRAWN = {
  name: VIEW,
  object: 'wdp_lead',
  viewKind: 'form',
  label: 'Intake',
  config: { ...FORM, sharing: { ...FORM.sharing, enabled: false } },
};

let dir: string;
let projectDir: string;
let templateDb: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** The real command over `dbFile`: the plan run first (its file is the reviewed plan), then `--apply`. */
async function applyOver(dbFile: string, tag: string): Promise<{ report: any; exitCode: number }> {
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
  process.chdir(projectDir);
  let exitCode: number | undefined;
  try {
    const planFile = join(projectDir, `plan-${tag}.json`);
    await MigrateOrganizationOwnership.run(['--out', planFile, '--database-url', `file:${dbFile}`, '--json'], { root: CLI_ROOT });
    stdout.mockClear();
    try {
      await MigrateOrganizationOwnership.run(
        [
          '--apply', '--backup-taken', '--plan-file', planFile,
          '--out', join(projectDir, `apply-${tag}.json`), '--database-url', `file:${dbFile}`, '--json',
        ],
        { root: CLI_ROOT },
      );
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const payload = JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    return { report: payload.report, exitCode: exitCode ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const promotion = (report: any): { status: string; summary: Record<string, number>; blockers: string[] } =>
  report.steps.find((s: { step: string }) => s.step === 'metadata-promotion');

/** The stored `view` rows of the form, `package/state`, with the declaration each body carries. */
function storedForm(dbFile: string): Array<{ pkg: string; enabled: unknown; overrides: unknown }> {
  const db = new Database(dbFile, { readonly: true });
  try {
    return (db.prepare(`SELECT package_id, metadata FROM sys_metadata WHERE type = 'view' AND name = ? ORDER BY package_id`)
      .all(VIEW) as Array<{ package_id: string | null; metadata: string }>)
      .map((row) => {
        const body = JSON.parse(row.metadata) as { config?: { sharing?: { enabled?: unknown } }; overrides?: unknown };
        return { pkg: row.package_id ?? '-', enabled: body.config?.sharing?.enabled, overrides: body.overrides };
      });
  } finally {
    db.close();
  }
}

/** On a fresh boot of `dbFile`: the base's served form, and the views the anonymous doors serve the slug from. */
async function served(dbFile: string): Promise<{ base: unknown; open: string[] }> {
  process.chdir(projectDir);
  const stack = await bootSchemaStack({
    jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: projectDir, composeHostStack: true,
    // The package registry `os serve` composes, so the pair installs from `sys_packages` as it does there.
    extraPlugins: [new PackageServicePlugin()],
  });
  try {
    const protocol = stack.kernel.getService('protocol') as any;
    const base = (await protocol.getMetaItem({ type: 'view', name: VIEW, packageId: BASE }))?.item;
    const listed = await protocol.getMetaItems({ type: 'view' });
    const list = ((Array.isArray(listed) ? listed : listed?.items) ?? []) as Array<Record<string, unknown>>;
    const open = list
      .filter((v) => anonymousFormIntakeCandidates(v).some((c) => c.slug === SLUG && !anonymousFormIntakeWithdrawnIn(list, v, c)))
      .map((v) => `${String(v.name)}|${String(v._packageId ?? '')}`);
    return { base: (base as { config?: { sharing?: unknown } } | undefined)?.config?.sharing, open };
  } finally {
    await stack.shutdown();
    process.chdir(savedCwd);
  }
}

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV', 'OS_SECRET_KEY'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  process.env.NODE_ENV = 'production';
  process.env.OS_SECRET_KEY = randomBytes(32).toString('hex');

  dir = mkdtempSync(join(tmpdir(), 'os-ceremony-withdrawal-pair-'));
  projectDir = join(dir, 'project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'objectstack.config.mjs'), `export default ${JSON.stringify(CONFIG, null, 2)};\n`);

  // A served boot of this tree provisions the tables; then the v17 shape.
  templateDb = join(dir, 'template.db');
  process.chdir(projectDir);
  try {
    const seed = await bootSchemaStack({
      jsonOutput: false, databaseUrl: `file:${templateDb}`, projectRoot: projectDir, composeHostStack: true,
      extraPlugins: [new PackageServicePlugin()],
    });
    await seed.shutdown();
  } finally {
    process.chdir(savedCwd);
  }
  const db = new Database(templateDb);
  try {
    db.exec(`ALTER TABLE "sys_metadata" ADD COLUMN "organization_id" varchar(255)`);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sys_metadata (id, organization_id, type, name, package_id, state, version, created_at, updated_at, metadata) ` +
        `VALUES ('md_org', 'org_x', 'view', ?, NULL, 'active', 1, ?, ?, ?)`,
    ).run(VIEW, now, now, JSON.stringify(WITHDRAWN));
  } finally {
    db.close();
  }
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('organization-ownership --apply: a withdrawal onto a read-only package\'s view goes into its .custom pair', () => {
  it('⭐ carried into the pair, declared as the override of the base; the served form is withdrawn; a re-run carries nothing', async () => {
    const dbFile = join(dir, 'case.db');
    copyFileSync(templateDb, dbFile);
    expect((await served(dbFile)).open, 'PRECONDITION: the shipped form is served open').toEqual([`${VIEW}|${BASE}`]);

    const { report } = await applyOver(dbFile, 'first');
    const step = promotion(report);
    expect(step.blockers.filter((b) => b.includes(VIEW))).toEqual([]);
    expect(step.summary.withdrawalsCarried).toBe(1);
    expect(storedForm(dbFile).filter((r) => r.pkg === PAIR)).toEqual([
      { pkg: PAIR, enabled: false, overrides: { package: BASE, basedOn: VERSION } },
    ]);
    // ⛔ Nothing bound to the read-only base itself.
    expect(storedForm(dbFile).filter((r) => r.pkg === BASE)).toEqual([]);

    const after = await served(dbFile);
    expect(after.base).toMatchObject({ enabled: false });
    expect(after.open).toEqual([]);

    // A re-run finds the step checkpointed and writes nothing more.
    const rows = storedForm(dbFile);
    const again = await applyOver(dbFile, 'again');
    expect(promotion(again.report).status).toBe('checkpointed');
    expect(storedForm(dbFile)).toEqual(rows);
  }, CASE_TIMEOUT_MS);
});
