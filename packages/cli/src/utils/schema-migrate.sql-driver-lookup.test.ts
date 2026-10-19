// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23648] The schema boot's SQL-driver lookup finds `SqliteWasmDriver`, and
 * still finds nothing that is not a SQL driver it lists.
 *
 * `SQL_DRIVER_SERVICES` is read by `findSqlDriverForKernel` and by
 * `bootSchemaStack`'s own lookup, the one every `os migrate` command's
 * `stack.driver` comes from. The wasm driver's key is the one a
 * `wasm-sqlite://` boot was measured to register:
 * `driver.com.objectstack.driver.sqlite-wasm` (`DefaultDatasourcePlugin`
 * publishes the default driver as `driver.<driver.name>`). The real boot,
 * through the commands, is pinned in
 * `src/commands/migrate/sqlite-wasm.integration.test.ts`.
 *
 * The controls hold both halves of "not a catch-all `driver.*` match":
 *  - a driver with the schema-migration seam, under a key nobody listed, stays
 *    unfound — the telemetry sibling's key among them, which has its own lookup;
 *  - a driver without that seam stays unfound under any key, the wasm key
 *    included.
 * And at the command: `os migrate organization-ownership`, handed the stack
 * driver this lookup answers, refuses `driver-unsupported` in both arms on an
 * unlisted or non-SQL driver, and proceeds on the wasm driver.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const boot = vi.hoisted(() => vi.fn());
vi.mock('./schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./schema-migrate.js')>()),
  bootSchemaStack: boot,
}));
// No case passes --database-url, so the real probe would read whatever database
// the package's own directory resolves to.
vi.mock('./migrate-occupancy-gate.js', () => ({
  OCCUPANCY_STOP_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'free' })),
}));
const apply = vi.hoisted(() => vi.fn());
vi.mock('./organization-ownership-apply.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./organization-ownership-apply.js')>()),
  applyOrganizationOwnership: apply,
}));

import { findSqlDriverForKernel } from './schema-migrate.js';

// [#10126] Pay the first transform of what the command reaches through dynamic
// `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/system';

type Command = (typeof import('../commands/migrate/organization-ownership.js'))['OrganizationOwnershipCeremony'];
let MigrateOrganizationOwnership: Command;

// The command's module graph is large, and oclif reads the package's config on
// the first run: both are paid outside the case timeout.
beforeAll(async () => {
  ({ OrganizationOwnershipCeremony: MigrateOrganizationOwnership } = await import('../commands/migrate/organization-ownership.js'));
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;
const CLI_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const WASM_KEY = 'driver.com.objectstack.driver.sqlite-wasm';

/** knex's bring-your-own-dialect hatch: `SqliteWasmDriver` hands knex a client CLASS. */
class Client_WasmSqlite {}

/** Every statement a driver was handed, in order. */
let statements: string[];

/** A driver with the schema-migration seam and a raw-SQL seam, as `SqlDriver` and its subclasses have. */
function sqlDriver(shape: { name: string; dialectName: string; client: unknown }) {
  return {
    name: shape.name,
    dialectName: shape.dialectName,
    config: { client: shape.client },
    detectManagedDrift: async () => [],
    applyMigrationEntries: async () => ({ applied: [], skipped: [] }),
    execute: async (sql: string) => {
      statements.push(sql);
      return [];
    },
  };
}

const wasmDriver = () =>
  sqlDriver({ name: 'com.objectstack.driver.sqlite-wasm', dialectName: 'sqlite', client: Client_WasmSqlite });

/** A driver with no schema-migration seam: the in-memory and MongoDB drivers' shape. */
function nonSqlDriver(name: string) {
  return {
    name,
    find: async () => [],
    create: async () => ({}),
    execute: async (sql: string) => {
      statements.push(sql);
      return [];
    },
  };
}

/** A kernel that publishes exactly these services. */
function kernelWith(services: Record<string, unknown>) {
  return {
    getService: (name: string) => {
      if (name in services) return services[name];
      throw new Error(`Service '${name}' not found`);
    },
  };
}

describe('findSqlDriverForKernel', () => {
  beforeEach(() => {
    statements = [];
  });

  it('finds SqliteWasmDriver under the key a wasm-sqlite:// boot registers', () => {
    const driver = wasmDriver();
    expect(findSqlDriverForKernel(kernelWith({ [WASM_KEY]: driver }))).toBe(driver);
  });

  it('still finds every SQL driver it found before', () => {
    for (const key of ['driver.com.objectstack.driver.sql', 'driver.com.objectstack.driver.turso', 'driver.sql']) {
      const driver = sqlDriver({ name: key.slice('driver.'.length), dialectName: 'sqlite', client: 'better-sqlite3' });
      expect(findSqlDriverForKernel(kernelWith({ [key]: driver })), key).toBe(driver);
    }
  });

  it('control: a SQL driver under a key it does not list stays unfound', () => {
    for (const key of ['driver.com.example.driver.sql-compatible', 'driver.telemetry', 'driver.default']) {
      const driver = sqlDriver({ name: key.slice('driver.'.length), dialectName: 'sqlite', client: 'better-sqlite3' });
      expect(findSqlDriverForKernel(kernelWith({ [key]: driver })), key).toBeNull();
    }
  });

  it('control: a driver without the schema-migration seam stays unfound, under the wasm key too', () => {
    for (const key of ['driver.com.objectstack.driver.memory', 'driver.com.objectstack.driver.mongodb', WASM_KEY]) {
      expect(findSqlDriverForKernel(kernelWith({ [key]: nonSqlDriver(key.slice('driver.'.length)) })), key).toBeNull();
    }
  });
});

describe('os migrate organization-ownership, on the driver the lookup answers', () => {
  let dir: string;

  /** A stack whose driver is whatever the real lookup finds in `services`. */
  function stackOver(services: Record<string, unknown>) {
    const kernel = kernelWith(services);
    return {
      driver: findSqlDriverForKernel(kernel),
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

  const out = (name: string): string[] => ['--out', join(dir, name), '--json'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-23648-lookup-'));
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

  const REFUSED: Array<[string, Record<string, unknown>]> = [
    ['a SQL driver under a key the lookup does not list', {
      'driver.com.example.driver.sql-compatible':
        sqlDriver({ name: 'com.example.driver.sql-compatible', dialectName: 'sqlite', client: 'better-sqlite3' }),
    }],
    ['a non-SQL driver under its own key', { 'driver.com.objectstack.driver.mongodb': nonSqlDriver('com.objectstack.driver.mongodb') }],
    ['a non-SQL driver under the wasm key', { [WASM_KEY]: nonSqlDriver('com.objectstack.driver.sqlite-wasm') }],
  ];

  for (const [label, services] of REFUSED) {
    it(`control: the plan refuses driver-unsupported on ${label}, before any statement`, async () => {
      boot.mockImplementation(async () => stackOver(services));
      const { payload, exitCode } = await runJson(out('plan.json'));
      expect(payload).toMatchObject({ error: 'plan_refused', reason: 'driver-unsupported' });
      expect(exitCode).toBe(1);
      expect(statements).toEqual([]);
      expect(existsSync(join(dir, 'plan.json'))).toBe(false);
    }, CASE_TIMEOUT_MS);

    it(`control: --apply refuses driver-unsupported on ${label}, and the apply step is never called`, async () => {
      boot.mockImplementation(async () => stackOver(services));
      const { payload, exitCode } = await runJson(['--apply', '--backup-taken', '--plan-file', writePlan(), ...out('apply.json')]);
      expect(payload).toMatchObject({ error: 'apply_refused', reason: 'driver-unsupported' });
      expect(exitCode).toBe(1);
      expect(statements).toEqual([]);
      expect(apply).not.toHaveBeenCalled();
    }, CASE_TIMEOUT_MS);
  }

  it('the plan proceeds on SqliteWasmDriver, its first statement the SQLite catalog read', async () => {
    boot.mockImplementation(async () => stackOver({ [WASM_KEY]: wasmDriver() }));
    const { payload } = await runJson(out('plan.json'));
    // The fake answers no tables, so the plan stops at its catalog read: past
    // the driver and the dialect, which the statement it issued names. The
    // whole plan, on a real wasm-sqlite:// database, is the integration pin's.
    expect(payload).toMatchObject({ error: 'plan_refused', reason: 'not-an-objectstack-database' });
    expect(statements[0]).toMatch(/FROM sqlite_master/);
  }, CASE_TIMEOUT_MS);

  it('--apply proceeds on SqliteWasmDriver and hands the apply step the sqlite dialect', async () => {
    boot.mockImplementation(async () => stackOver({ [WASM_KEY]: wasmDriver() }));
    const { payload } = await runJson(['--apply', '--backup-taken', '--plan-file', writePlan(), ...out('apply.json')]);
    expect(payload.error).toBeUndefined();
    expect(payload).toMatchObject({ report: { kind: 'organization-ownership-apply' } });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toMatchObject({ executor: { dialect: 'sqlite' } });
  }, CASE_TIMEOUT_MS);
});
