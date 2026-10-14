// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --fate-supplement FILE` — the host's
 * declared fates reach the ceremony through this flag and nowhere else (ADR-0131
 * D10, the inventory's C10 stage). Both modes read it: the plan plans its rows
 * against a real SQLite database, and `--apply` hands the merged inventory to
 * the apply step. A file that cannot be used is refused before the database is
 * opened, inside the `--json` envelope, naming the file and the row.
 *
 * The boot is replaced by a stack over a fixture database; the apply step is
 * replaced by a recorder (its own suite pins what it does with an inventory).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const boot = vi.hoisted(() => vi.fn());
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));

const apply = vi.hoisted(() => vi.fn());
vi.mock('../../utils/organization-ownership-apply.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/organization-ownership-apply.js')>()),
  applyOrganizationOwnership: apply,
}));

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

// The command's module graph is large, and oclif reads the package's config on
// the first run: both are paid outside the 5 s default (CASE_TIMEOUT_MS).
beforeAll(async () => {
  ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;
const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CITE = 'fixture: a host-declared fate (test data, not any host\'s declaration)';

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-fate-supplement-cmd-'));
  db = new Database(join(dir, 'fixture.db'));
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default');
    CREATE TABLE sys_domain (id TEXT PRIMARY KEY, organization_id TEXT, hostname TEXT);
    INSERT INTO sys_domain VALUES ('dom_1', 'org_default', 'a.example.com'), ('dom_2', NULL, 'b.example.com');
  `);
  boot.mockImplementation(async () => ({
    driver: {
      config: { client: 'better-sqlite3' },
      execute: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params),
    },
    dbLabel: 'fixture.db',
    kernel: {
      getService: (name: string) =>
        name === 'objectql'
          ? { registry: { getItem: () => undefined, listItems: () => [], isPackageDisabled: () => false } }
          : name === 'metadata'
            ? { get: async () => undefined, list: async () => [] }
            : undefined,
    },
    tableAbsent: () => false,
    shutdown: async () => {},
  }));
  apply.mockImplementation(async () => ({
    kind: 'organization-ownership-apply',
    generatedAt: '2026-10-13T00:00:00.000Z',
    steps: [],
    tables: [],
    complete: true,
    blocking: 0,
    advisory: 0,
  }));
});

afterEach(() => {
  boot.mockReset();
  apply.mockReset();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function writeSupplement(rows: unknown): string {
  const file = join(dir, 'host-fates.json');
  writeFileSync(file, JSON.stringify(rows));
  return file;
}

async function runJson(argv: string[]): Promise<{ payload: Record<string, unknown>; exitCode: unknown }> {
  const chunks: string[] = [];
  const savedExit = process.exitCode;
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  try {
    await MigrateOrganizationOwnership.run(argv, { root: CLI_ROOT });
  } catch (error) {
    if ((error as { oclif?: unknown }).oclif === undefined) throw error;
  }
  const exitCode = process.exitCode;
  process.exitCode = savedExit;
  vi.restoreAllMocks();
  return { payload: JSON.parse(chunks.join('').trim()) as Record<string, unknown>, exitCode };
}

const out = (name: string): string[] => ['--out', join(dir, name), '--json'];

describe('the plan reads the host fate supplement through --fate-supplement', () => {
  it('without it, a host table carrying the column is refused by name, and the refusal names the flag', async () => {
    const { payload, exitCode } = await runJson(out('plan.json'));
    expect(payload).toMatchObject({ error: 'plan_refused', reason: 'uninventoried-platform-table', table: 'sys_domain' });
    expect(String(payload.detail)).toContain('--fate-supplement FILE');
    expect(exitCode).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('with it, the host-declared fate is planned like a platform row', async () => {
    const file = writeSupplement([{ object: 'sys_domain', fate: 'report', citation: CITE }]);
    const { payload } = await runJson(['--fate-supplement', file, ...out('plan.json')]);
    const plan = payload.plan as { tables: Array<Record<string, unknown>> };
    expect(plan.tables.find((t) => t.object === 'sys_domain')).toMatchObject({
      source: 'inventory',
      census: ['host-supplement'],
      fate: 'report',
      citation: CITE,
      physical: 'present',
      rows: { total: 2, organizationNull: 1, stamped: 1 },
      unattributable: [{ id: 'dom_2', reason: 'fate 4: reported, never guessed' }],
    });
  }, CASE_TIMEOUT_MS);
});

describe('--apply hands the merged inventory to the apply step', () => {
  it('with --fate-supplement, the apply step receives the host row', async () => {
    const file = writeSupplement([{ object: 'sys_domain', fate: 'report', citation: CITE }]);
    const { payload } = await runJson(['--apply', '--backup-taken', '--fate-supplement', file, ...out('apply.json')]);
    expect(payload).toMatchObject({ report: { kind: 'organization-ownership-apply' } });
    expect(apply).toHaveBeenCalledTimes(1);
    const inventory = (apply.mock.calls[0]![0] as { inventory?: Array<Record<string, unknown>> }).inventory;
    expect(inventory?.find((e) => e.object === 'sys_domain')).toMatchObject({ census: ['host-supplement'], fate: 'report' });
  }, CASE_TIMEOUT_MS);

  it('control: without it, the apply step is handed no inventory and reads the platform\'s', async () => {
    await runJson(['--apply', '--backup-taken', ...out('apply.json')]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).not.toHaveProperty('inventory');
  }, CASE_TIMEOUT_MS);
});

describe('a supplement it cannot use is refused before the database is opened, inside the --json envelope', () => {
  it('a missing file (plan)', async () => {
    const file = join(dir, 'absent.json');
    const { payload, exitCode } = await runJson(['--fate-supplement', file, ...out('plan.json')]);
    expect(payload).toMatchObject({ error: 'plan_refused', reason: 'fate-supplement-unreadable', file });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('a row naming a platform object (--apply)', async () => {
    const file = writeSupplement([{ object: 'sys_file', fate: 'report', citation: CITE }]);
    const { payload, exitCode } = await runJson(['--apply', '--backup-taken', '--fate-supplement', file, ...out('apply.json')]);
    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'fate-supplement-platform-object', file, row: 0, object: 'sys_file' });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('a row the schema refuses (plan)', async () => {
    const file = writeSupplement([{ object: 'sys_domain', fate: 'attribution', citation: CITE }]);
    const { payload } = await runJson(['--fate-supplement', file, ...out('plan.json')]);
    expect(payload).toMatchObject({ error: 'plan_refused', reason: 'fate-supplement-invalid', file, row: 0, object: 'sys_domain' });
    expect(boot).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);
});
