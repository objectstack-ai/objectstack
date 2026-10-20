// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared SQLite datasource whose file is not a SQLite database is refused
 * at connect, naming the file, in development as in production. On a
 * development boot the operator's file is neither renamed nor replaced, and
 * nothing steps down to wasm SQLite or the in-memory driver (#24960).
 *
 * Before: `SqlDriver.connect()` swallowed the file's `SQLITE_NOTADB` and
 * resolved, the probe's `SELECT 1` then failed as a `DATABASE_ERROR`, and in
 * development `resolveSqliteDriver` stepped down to wasm SQLite. wasm's open
 * moved the file aside to `<file>.corrupt-<timestamp>` and wrote an empty
 * database in its place, under the warning "native better-sqlite3 unavailable
 * (ABI mismatch or not built)", which named the wrong cause; the datasource
 * read `connected`. Measured through `os migrate apply --yes` on the card.
 *
 * Real `better-sqlite3`, real wasm SQLite and real files in a scratch
 * directory, as in `./sqlite-driver-fallback-file-open-failure.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSqliteDriver, type ResolvedSqliteDriver } from '../sqlite-driver-fallback.js';
import { DatasourceConnectionService } from '../datasource-connection-service.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

const PLAIN_TEXT = 'archive notes — this file holds plain text, not a SQLite database\n';

let dir: string;
let filename: string;
let bytes: Buffer;
const opened: ResolvedSqliteDriver[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-24960-'));
  filename = join(dir, 'archive.db');
  writeFileSync(filename, PLAIN_TEXT);
  bytes = readFileSync(filename);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(opened.splice(0).map((r) => r.driver?.disconnect?.().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

/** `promise`'s rejection; a failure naming the engine when it resolves instead. */
async function rejectionOf(promise: Promise<ResolvedSqliteDriver>): Promise<any> {
  let resolved: ResolvedSqliteDriver;
  try {
    resolved = await promise;
  } catch (error) {
    return error;
  }
  opened.push(resolved);
  throw new Error(`resolved to engine '${resolved.engine}' for a file that is not a SQLite database`);
}

/** The driver's refusal of the file: its own error name, SQLite's code, and the file. */
function expectNotADatabaseRefusal(error: any): void {
  expect(error?.name).toBe('SqliteDatabaseFileError');
  expect(error?.code).toBe('SQLITE_NOTADB');
  expect(error?.filename).toBe(filename);
  expect(String(error?.message)).toContain(filename);
}

/** The operator's file is exactly as it was, and nothing was written beside it. */
function expectFileUntouched(): void {
  expect(readFileSync(filename).equals(bytes)).toBe(true);
  expect(readdirSync(dir)).toEqual(['archive.db']);
}

describe('resolveSqliteDriver in development: a file that is not a SQLite database (#24960)', () => {
  it('rejects with the driver\'s refusal, never wasm or memory, and leaves the file as it was', async () => {
    const warn = vi.fn();
    expectNotADatabaseRefusal(await rejectionOf(resolveSqliteDriver({ filename, dev: true, warn })));
    // No step-down notice: the "native better-sqlite3 unavailable" warning
    // named the wrong cause, and no rung was tried.
    expect(warn).not.toHaveBeenCalled();
    expectFileUntouched();
  });
});

describe('resolveSqliteDriver in production: a file that is not a SQLite database (#24960)', () => {
  it('returns native unprobed, and its connect() refuses the file', async () => {
    const warn = vi.fn();
    const resolved = await resolveSqliteDriver({ filename, dev: false, warn });
    opened.push(resolved);
    expect(resolved.engine).toBe('better-sqlite3');
    let refusal: unknown;
    await resolved.driver.connect().catch((e: unknown) => { refusal = e; });
    expectNotADatabaseRefusal(refusal);
    expect(warn).not.toHaveBeenCalled();
    expectFileUntouched();
  });
});

describe('DatasourceConnectionService: a declared SQLite datasource on a file that is not a database (#24960)', () => {
  for (const mode of ['development', 'production'] as const) {
    it(`${mode}: reports a failed connection state naming the file, registers no driver, and leaves the file as it was`, async () => {
      vi.stubEnv('NODE_ENV', mode);
      const registered: string[] = [];
      const engine = {
        registerDriver: (driver: { name?: string }) => { registered.push(String(driver?.name)); },
        getDriverByName: (name: string) => (registered.includes(name) ? {} : undefined),
      };
      const service = new DatasourceConnectionService({
        factory: () => createDefaultDatasourceDriverFactory({ dev: mode === 'development' }),
        engine: () => engine as any,
      });

      await service.connectDeclared({
        datasources: [{ name: 'archive', driver: 'sqlite', config: { filename }, autoConnect: true }],
      });

      const state = service.getConnectionState('archive');
      expect(state?.availability).toBe('failed');
      expect(state?.reason).toContain(filename);
      expect(registered).toEqual([]);
      expectFileUntouched();
    });
  }
});
