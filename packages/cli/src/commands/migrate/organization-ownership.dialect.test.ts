// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership` reads its SQL dialect off the stack's
 * driver ONCE, before the first statement, through the resolver it shares
 * with `@objectstack/metadata-core` (`ceremonyDialectOf` → `dialectOfDriver`):
 * the driver's `dialectName` first, then a recognised `config.client` string.
 * On anything else both arms refuse, naming the driver, with exit 1 and no
 * statement run; neither arm reads an unresolved dialect as SQLite.
 *
 * The boot is replaced by a stack whose driver records every statement and
 * answers each with no rows; the apply step is replaced by a recorder (its own
 * suite pins what it does with the executor it is handed). The driver shapes
 * are the ones each in-repo driver presents, measured on the drivers
 * themselves: `SqliteWasmDriver`'s knex `client` is a dialect CLASS and its
 * `dialectName` is `'sqlite'`; `SqlDriver` answers `dialectName: 'unknown'`
 * for a client it does not recognise, a client class included.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const boot = vi.hoisted(() => vi.fn());
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
// The siblings' occupancy stub: no case here passes --database-url, so the real
// probe would read whatever database the package's own directory resolves to.
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_STOP_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'free' })),
}));

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

/** knex's bring-your-own-dialect hatch: a Client constructor as `config.client`. */
class Client_PG {}
class Client_WasmSqlite {}

interface DriverShape {
  name?: string;
  dialectName?: string;
  config?: { client?: unknown };
}

/** Refused: no dialect the ceremony can write statements for. */
const REFUSED: Array<[string, DriverShape]> = [
  ['a client class with no dialectName', { name: 'com.example.driver', config: { client: Client_PG } }],
  ['a client class, as SqlDriver answers it (dialectName unknown)', { name: 'com.objectstack.driver.sql', dialectName: 'unknown', config: { client: Client_PG } }],
  ['an unrecognised client string', { name: 'com.objectstack.driver.sql', config: { client: 'oracledb' } }],
  ['dialectName unknown beside a recognised client string', { name: 'com.objectstack.driver.sql', dialectName: 'unknown', config: { client: 'pg' } }],
  ['a driver with neither a dialectName nor a client', { name: 'com.example.driver' }],
];

/** Proceeds: each in-repo driver's measured shape, and the first statement its dialect's catalog read. */
const PROCEEDS: Array<[string, DriverShape, RegExp]> = [
  ['SqlDriver on better-sqlite3', { name: 'com.objectstack.driver.sql', dialectName: 'sqlite', config: { client: 'better-sqlite3' } }, /FROM sqlite_master/],
  ['SqliteWasmDriver (a client class, dialectName sqlite)', { name: 'com.objectstack.driver.sqlite-wasm', dialectName: 'sqlite', config: { client: Client_WasmSqlite } }, /FROM sqlite_master/],
  ['SqlDriver on pg', { name: 'com.objectstack.driver.sql', dialectName: 'postgres', config: { client: 'pg' } }, /current_schemas\(false\)/],
  ['SqlDriver on mysql2', { name: 'com.objectstack.driver.sql', dialectName: 'mysql', config: { client: 'mysql2' } }, /table_schema = DATABASE\(\)/],
  ['TursoDriver', { name: 'com.objectstack.driver.turso', dialectName: 'sqlite', config: { client: 'better-sqlite3' } }, /FROM sqlite_master/],
  ['a driver with no dialectName and a recognised client string', { name: 'com.example.driver', config: { client: 'postgresql' } }, /current_schemas\(false\)/],
];

let dir: string;
/** Every statement the driver was handed, in order. */
let statements: string[];

function stackOver(shape: DriverShape) {
  return {
    driver: {
      ...shape,
      execute: async (sql: string) => {
        statements.push(sql);
        return [];
      },
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
    composition: { securityPlugin: { composed: false, reason: 'no-secret' } },
    shutdown: async () => {},
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-ownership-dialect-'));
  statements = [];
  apply.mockImplementation(async () => ({
    kind: 'organization-ownership-apply',
    generatedAt: '2026-10-15T00:00:00.000Z',
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
  rmSync(dir, { recursive: true, force: true });
});

/** A plan file as a plan run writes it (the fields the apply reads). */
function writePlan(): string {
  const file = join(dir, 'reviewed-plan.json');
  writeFileSync(file, JSON.stringify({
    kind: 'organization-ownership-plan',
    ceremony: 'ADR-0131 D10',
    generatedAt: '2026-10-15T00:00:00.000Z',
    database: 'fixture.db',
    inventoryDigest: 'f'.repeat(64),
    posture: 'single',
  }));
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

describe('an unresolved dialect is refused, naming the driver, before any statement runs', () => {
  for (const [label, shape] of REFUSED) {
    it(`plan: ${label}`, async () => {
      boot.mockImplementation(async () => stackOver(shape));
      const target = join(dir, 'plan.json');
      const { payload, exitCode } = await runJson(['--out', target, '--json']);
      expect(payload).toMatchObject({ error: 'plan_refused', reason: 'driver-unsupported' });
      expect(String(payload.detail)).toContain(shape.name!);
      expect(exitCode).toBe(1);
      expect(statements).toEqual([]);
      expect(existsSync(target)).toBe(false);
    }, CASE_TIMEOUT_MS);

    it(`--apply: ${label}`, async () => {
      boot.mockImplementation(async () => stackOver(shape));
      const { payload, exitCode } = await runJson(['--apply', '--backup-taken', '--plan-file', writePlan(), '--out', join(dir, 'apply.json'), '--json']);
      expect(payload).toMatchObject({ error: 'apply_refused', reason: 'driver-unsupported' });
      expect(String(payload.detail)).toContain(shape.name!);
      expect(exitCode).toBe(1);
      expect(statements).toEqual([]);
      expect(apply).not.toHaveBeenCalled();
    }, CASE_TIMEOUT_MS);
  }

  it('a client class is named, never printed as its source', async () => {
    boot.mockImplementation(async () => stackOver({ name: 'com.example.driver', config: { client: Client_PG } }));
    const { payload } = await runJson(['--out', join(dir, 'plan.json'), '--json']);
    expect(String(payload.detail)).toContain('client class Client_PG');
    expect(String(payload.detail)).not.toContain('class Client_PG {');
  }, CASE_TIMEOUT_MS);
});

describe('a recognised dialect proceeds, in that dialect', () => {
  for (const [label, shape, catalog] of PROCEEDS) {
    it(`plan: ${label}`, async () => {
      boot.mockImplementation(async () => stackOver(shape));
      const { payload } = await runJson(['--out', join(dir, 'plan.json'), '--json']);
      // The driver answers no tables, so the plan stops at its catalog read,
      // past the dialect, which the catalog statement it issued names.
      expect(payload).toMatchObject({ error: 'plan_refused', reason: 'not-an-objectstack-database' });
      expect(statements[0]).toMatch(catalog);
    }, CASE_TIMEOUT_MS);
  }

  it('--apply hands the apply step the dialect it resolved, and the client string only as a record', async () => {
    boot.mockImplementation(async () => stackOver({ name: 'com.objectstack.driver.sqlite-wasm', dialectName: 'sqlite', config: { client: Client_WasmSqlite } }));
    await runJson(['--apply', '--backup-taken', '--plan-file', writePlan(), '--out', join(dir, 'apply.json'), '--json']);
    expect(apply).toHaveBeenCalledTimes(1);
    const { executor } = apply.mock.calls[0]![0] as { executor: Record<string, unknown> };
    expect(executor.dialect).toBe('sqlite');
    expect(executor).not.toHaveProperty('client');
  }, CASE_TIMEOUT_MS);

  it('--apply on pg: the executor speaks postgres', async () => {
    boot.mockImplementation(async () => stackOver({ name: 'com.objectstack.driver.sql', dialectName: 'postgres', config: { client: 'pg' } }));
    await runJson(['--apply', '--backup-taken', '--plan-file', writePlan(), '--out', join(dir, 'apply.json'), '--json']);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toMatchObject({ executor: { dialect: 'postgres', client: 'pg' } });
  }, CASE_TIMEOUT_MS);
});
