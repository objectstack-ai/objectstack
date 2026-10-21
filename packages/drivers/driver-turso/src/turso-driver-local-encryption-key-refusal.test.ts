// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25020] A non-empty `encryptionKey` on the local engine is refused at
 * construction, in a local mode and in an embedded-replica mode alike. The
 * ADR-0049 answer to a declared protection the runtime never applied.
 *
 * # What was measured (the reading this refusal stands on)
 *
 * On this package's source before the change, with a test key only:
 *
 * ```
 * local   (file: url + encryptionKey)                   -> constructs, connects, writes and reads back;
 *                                                          the file starts `SQLite format 3`, and plain
 *                                                          better-sqlite3 read-only, with no key, reads the row
 * replica (+ syncUrl, a supplied client)                -> the same: the key reaches nothing
 * replica (+ syncUrl, the driver builds the sync client) -> the Knex base writes the file in plaintext
 *                                                          first; the key reaches only `@libsql/client`
 * ```
 *
 * The engine every read and write goes through is better-sqlite3 13.0.3
 * (SQLite 3.53.4): no codec compile option, and `PRAGMA key` is a silent
 * no-op. Honouring the key would mean replacing that engine, so the key is
 * refused instead (the seat ruling on #25020).
 *
 * # What this file pins
 *
 * The refusal per mode as the ADR-0112 envelope (`code` + `status`) plus the
 * message's first sentence, which names the mode; that the refusal fires
 * before any database file is opened; and that a datasource with no key (or
 * an empty one, which is unset) connects, writes and reads back exactly as
 * before, its file a plain SQLite database. The message equals the spec
 * contract's issue byte for byte; that equality is pinned in
 * `spec/turso-config-constructor-parity.test.ts`, not here.
 *
 * The replica pins need no sync server: the refusal fires at construction,
 * before any client is built. A replica with the key and a REACHABLE sync
 * server was not measured — no libSQL sync server runs in this package's test
 * environment, and the native binding's default sync path speaks the server's
 * replication protocol, which nothing here can stand in for.
 *
 * # Reverse verification: direction predicted before it was run
 *
 * Remove the refusal from the constructor and every refusal case here goes
 * RED (the constructor returns a driver, and the file is created on connect).
 * Every control stays GREEN. Measured; see the PR.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { createTursoDriver } from './index.js';
import { TursoDriver, type TursoDriverConfig } from './turso-driver.js';

type Refusal = Error & { code?: string; status?: number };

/** The error `build` threw, or `null` when it returned. */
function refusalOf(build: () => unknown): Refusal | null {
  try {
    build();
    return null;
  } catch (error) {
    return error as Refusal;
  }
}

const DIR = mkdtempSync(join(tmpdir(), 'turso-25020-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

let seq = 0;
/** A fresh database path in its own name; the file does not exist yet. */
const nextPath = () => join(DIR, `db-${++seq}.db`);

const PRIMARY = 'libsql://primary.example.invalid';
/** A test value only — never a real key. */
const KEY = 'test-key-25020';

const LOCAL_FIRST_SENTENCE =
  "`encryptionKey` asks for this datasource's database file to be encrypted, but this datasource is a local " +
  'database, which runs every read and write through a local SQLite engine that has no encryption codec: ' +
  'nothing would encrypt the file, so it would be written in plaintext that any SQLite reader opens without ' +
  'the key — the turso driver refuses this configuration when it starts.';
const REPLICA_FIRST_SENTENCE =
  "`encryptionKey` asks for this datasource's database file to be encrypted, but this datasource is an " +
  'embedded replica, which runs every read and write through a local SQLite engine that has no encryption ' +
  'codec (the sync client shares that one file, and a file it encrypted could not be opened by that ' +
  'engine): nothing would encrypt the file, so it would be written in plaintext that any SQLite reader ' +
  'opens without the key — the turso driver refuses this configuration when it starts.';

/** A client that never touches a network: the replica arm takes it instead of building one. */
const offlineClient = () => ({ close() {}, sync: async () => ({}) }) as unknown as TursoDriverConfig['client'];

describe('a local database: `encryptionKey` is refused at construction', () => {
  it.each<[string, (path: string) => TursoDriverConfig]>([
    ['a file: url', (path) => ({ url: `file:${path}`, encryptionKey: KEY })],
    ['an uppercase FILE: url', (path) => ({ url: `FILE:${path}`, encryptionKey: KEY })],
    ["a forced mode: 'local'", (path) => ({ url: `file:${path}`, mode: 'local', encryptionKey: KEY })],
  ])('%s: VALIDATION_ERROR / 400, naming a local database, and no file is opened', (_name, configOf) => {
    const path = nextPath();
    const refusal = refusalOf(() => new TursoDriver(configOf(path)));

    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_ERROR');
    expect(refusal!.status).toBe(400);
    expect(refusal!.message.startsWith(LOCAL_FIRST_SENTENCE), refusal!.message).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it(':memory: is refused the same way', () => {
    const refusal = refusalOf(() => new TursoDriver({ url: ':memory:', encryptionKey: KEY }));

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
    expect(refusal!.message.startsWith(LOCAL_FIRST_SENTENCE)).toBe(true);
  });

  it('createTursoDriver() is the same constructor, and refuses the same config', () => {
    const refusal = refusalOf(() => createTursoDriver({ url: `file:${nextPath()}`, encryptionKey: KEY }));

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal?.status).toBe(400);
  });
});

describe('an embedded replica: `encryptionKey` is refused at construction', () => {
  it.each<[string, (path: string) => TursoDriverConfig]>([
    ['file: + syncUrl, the driver building the sync client', (path) => ({
      url: `file:${path}`, syncUrl: PRIMARY, sync: { onConnect: false }, encryptionKey: KEY,
    })],
    ['file: + syncUrl, a supplied client', (path) => ({
      url: `file:${path}`, syncUrl: PRIMARY, client: offlineClient(), sync: { onConnect: false }, encryptionKey: KEY,
    })],
    ["file: + syncUrl under a forced mode: 'replica'", (path) => ({
      url: `file:${path}`, mode: 'replica', syncUrl: PRIMARY, sync: { onConnect: false }, encryptionKey: KEY,
    })],
  ])('%s: VALIDATION_ERROR / 400, naming an embedded replica, and no file is opened', (_name, configOf) => {
    const path = nextPath();
    const refusal = refusalOf(() => new TursoDriver(configOf(path)));

    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_ERROR');
    expect(refusal!.status).toBe(400);
    expect(refusal!.message.startsWith(REPLICA_FIRST_SENTENCE), refusal!.message).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('the message names no url and no key', () => {
    const refusal = refusalOf(
      () => new TursoDriver({ url: `file:${join(DIR, 'private-dir.db')}`, syncUrl: 'libsql://private-host.example.invalid', encryptionKey: 'private-key-value' }),
    );

    expect(refusal?.code).toBe('VALIDATION_ERROR');
    expect(refusal!.message).not.toContain('private-dir');
    expect(refusal!.message).not.toContain('private-host');
    expect(refusal!.message).not.toContain('private-key-value');
  });
});

describe('CONTROLS — a datasource without a key works exactly as before', () => {
  const Database = createRequire(import.meta.url)('better-sqlite3') as new (
    filename: string,
    options?: { readonly?: boolean },
  ) => { prepare(sql: string): { all(): Array<Record<string, unknown>> }; close(): void };
  const OBJECT = { name: 'probe', fields: { v: { type: 'text' } } };

  /** Write one row through the driver and read it back through the driver. */
  async function roundTrip(driver: TursoDriver): Promise<unknown[]> {
    await driver.connect();
    await driver.syncSchema('probe', OBJECT);
    await driver.create('probe', { v: 'row-25020' });
    const rows = (await driver.find('probe', {})) as Array<{ v: unknown }>;
    await driver.disconnect();
    return rows.map((row) => row.v);
  }

  /** The file as any SQLite reader sees it: its header and the row, with no key. */
  function readPlain(path: string) {
    const db = new Database(path, { readonly: true });
    try {
      return {
        header: readFileSync(path).subarray(0, 15).toString('latin1'),
        rows: db.prepare('select v from probe').all().map((row) => row.v),
      };
    } finally {
      db.close();
    }
  }

  it.each<[string, (path: string) => TursoDriverConfig]>([
    ['a local file: url with no key', (path) => ({ url: `file:${path}` })],
    ['a local file: url with an empty key (unset)', (path) => ({ url: `file:${path}`, encryptionKey: '' })],
    ['a replica with no key (a supplied client)', (path) => ({
      url: `file:${path}`, syncUrl: PRIMARY, client: offlineClient(), sync: { onConnect: false },
    })],
  ])('%s: constructs, connects, writes and reads back; the file is a plain SQLite database', async (_name, configOf) => {
    const path = nextPath();
    const driver = new TursoDriver(configOf(path));

    expect(await roundTrip(driver)).toEqual(['row-25020']);
    expect(readPlain(path)).toEqual({ header: 'SQLite format 3', rows: ['row-25020'] });
  });
});
