// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25050] `encryptionKey` is REMOVED, and `new TursoDriver()` refuses it in
 * every mode, for any value — the ADR-0049 answer to a declared key the
 * runtime honoured nowhere.
 *
 * # What was measured (the reading this retirement stands on)
 *
 * On a local or replica datasource every read and write runs through Knex on
 * better-sqlite3 13.0.3 (SQLite 3.53.4): no codec compile option is set and
 * `PRAGMA key` is a silent no-op. Before #25020 a local datasource with the
 * key constructed, connected, wrote and read back, and its file started
 * `SQLite format 3` and opened in plain better-sqlite3 with no key; #25020
 * refused the key there. On a remote url, `createRemoteClient` builds
 * `createClient({ url, authToken, concurrency, fetch })` and never read the
 * key: `new TursoDriver({ url: 'libsql://…', encryptionKey })` constructed in
 * remote mode and dropped it (#25020's dev report). `@libsql/client`'s own
 * remote client refuses such a key outright (`ENCRYPTION_KEY_NOT_SUPPORTED`).
 *
 * # What this file pins
 *
 * The refusal in every mode as the ADR-0112 envelope (`code` + `status`) plus
 * the message's first sentence; that it fires before any database file is
 * opened, and FIRST, ahead of every other refusal a config also earns; that
 * an empty or non-string value is refused too; that the typed channel is a
 * compile error; and that a datasource with no key still connects, writes and
 * reads back exactly as before. The message equals the spec contract's issue
 * and the mirror's, byte for byte; that equality is pinned in
 * `spec/turso-config-constructor-parity.test.ts`, not here.
 *
 * # Reverse verification: direction predicted before it was run
 *
 * Remove the refusal from the constructor and every remote-url refusal case
 * here goes RED (the constructor returns a remote driver); the local and
 * replica cases go RED too (the driver builds, and connect would write the
 * file). Every control stays GREEN. Measured; see the PR.
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

const DIR = mkdtempSync(join(tmpdir(), 'turso-25050-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

let seq = 0;
/** A fresh database path in its own name; the file does not exist yet. */
const nextPath = () => join(DIR, `db-${++seq}.db`);

const PRIMARY = 'libsql://primary.example.invalid';
/** A test value only — never a real key. */
const KEY = 'test-key-25050';

const FIRST_SENTENCE =
  '`turso config.encryptionKey` was removed in @objectstack/spec 18 and @objectstack/driver-turso 18 ' +
  '(ADR-0049) — it never encrypted anything, in any mode: a local or embedded-replica file is read and ' +
  'written through a SQLite engine that has no encryption codec, and the driver never handed the key to ' +
  'a remote database, whose storage encryption the server configures.';

/**
 * A config carrying the removed key. The slot is typed `never`, so only an
 * untyped value reaches the constructor — a stored datasource row through
 * the loaders — and this is how a test spells one.
 */
const withKey = (config: TursoDriverConfig, value: unknown = KEY): TursoDriverConfig =>
  ({ ...config, encryptionKey: value }) as unknown as TursoDriverConfig;

/** A client that never touches a network: the replica arm takes it instead of building one. */
const offlineClient = () => ({ close() {}, sync: async () => ({}) }) as unknown as TursoDriverConfig['client'];

function expectRetired(refusal: Refusal | null, context: string): void {
  expect(refusal, context).not.toBeNull();
  expect(refusal!.code, context).toBe('VALIDATION_ERROR');
  expect(refusal!.status, context).toBe(400);
  expect(refusal!.message.startsWith(FIRST_SENTENCE), refusal!.message).toBe(true);
}

describe('`encryptionKey` is refused at construction in every mode', () => {
  it.each<[string, TursoDriverConfig]>([
    ['a libsql:// url (remote: the key used to be parsed and dropped)', { url: 'libsql://db.example.invalid' }],
    ['an https:// url', { url: 'https://db.example.invalid' }],
    ['a wss:// url', { url: 'wss://db.example.invalid' }],
    ["a libsql:// url under a forced mode: 'remote'", { url: 'libsql://db.example.invalid', mode: 'remote' }],
    ['a pre-built remote client', { url: 'libsql://db.example.invalid', client: offlineClient() }],
  ])('%s: VALIDATION_ERROR / 400', (_name, config) => {
    expectRetired(refusalOf(() => new TursoDriver(withKey(config))), _name);
  });

  it.each<[string, (path: string) => TursoDriverConfig]>([
    ['a local file: url', (path) => ({ url: `file:${path}` })],
    ['an uppercase FILE: url', (path) => ({ url: `FILE:${path}` })],
    ["a forced mode: 'local'", (path) => ({ url: `file:${path}`, mode: 'local' })],
    ['a replica, the driver building the sync client', (path) => ({ url: `file:${path}`, syncUrl: PRIMARY, sync: { onConnect: false } })],
    ['a replica, a supplied client', (path) => ({ url: `file:${path}`, syncUrl: PRIMARY, client: offlineClient(), sync: { onConnect: false } })],
    ["a file: url under a forced mode: 'remote'", (path) => ({ url: `file:${path}`, mode: 'remote' })],
  ])('%s: VALIDATION_ERROR / 400, and no file is opened', (name, configOf) => {
    const path = nextPath();
    expectRetired(refusalOf(() => new TursoDriver(withKey(configOf(path)))), name);
    expect(existsSync(path)).toBe(false);
  });

  it.each([':memory:', 'file::memory:'])('%s: refused the same way', (url) => {
    expectRetired(refusalOf(() => new TursoDriver(withKey({ url }))), url);
  });

  it.each<[string, unknown]>([
    ['an empty string (no longer "unset")', ''],
    ['a long key', 'a'.repeat(32)],
    ['null', null],
    ['a number', 0],
  ])('any value — %s — is refused', (name, value) => {
    expectRetired(refusalOf(() => new TursoDriver(withKey({ url: 'libsql://db.example.invalid' }, value))), name);
  });

  it('FIRST: a config wrong in another way as well meets the retirement, as the spec contract answers it', () => {
    for (const config of [
      { url: './data/app.db' },
      { url: 'libsql://db.example.invalid', syncUrl: PRIMARY },
      { url: `file:${nextPath()}`, sync: { intervalSeconds: 60 } },
      { url: `file:${nextPath()}`, mode: 'replica' as const },
      { url: 'wss://db.example.invalid', timeout: 5000 },
    ]) {
      expectRetired(refusalOf(() => new TursoDriver(withKey(config))), JSON.stringify(config));
    }
  });

  it('createTursoDriver() is the same constructor, and the message names no url and no key', () => {
    const refusal = refusalOf(
      () => createTursoDriver(withKey({ url: 'libsql://private-host.example.invalid' }, 'private-key-value')),
    );
    expectRetired(refusal, 'createTursoDriver');
    expect(refusal!.message).not.toContain('private-host');
    expect(refusal!.message).not.toContain('private-key-value');
  });

  it('is a tsc error at a typed construction site', () => {
    const refusal = refusalOf(
      // @ts-expect-error — `TursoDriverConfig.encryptionKey` is `never`: no value is assignable.
      () => new TursoDriver({ url: 'libsql://db.example.invalid', encryptionKey: KEY }),
    );
    expectRetired(refusal, 'typed');
  });
});

describe('CONTROLS — a datasource without the key works exactly as before', () => {
  const Database = createRequire(import.meta.url)('better-sqlite3') as new (
    filename: string,
    options?: { readonly?: boolean },
  ) => { prepare(sql: string): { all(): Array<Record<string, unknown>> }; close(): void };
  const OBJECT = { name: 'probe', fields: { v: { type: 'text' } } };

  /** Write one row through the driver and read it back through the driver. */
  async function roundTrip(driver: TursoDriver): Promise<unknown[]> {
    await driver.connect();
    await driver.syncSchema('probe', OBJECT);
    await driver.create('probe', { v: 'row-25050' });
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
    ['a local file: url', (path) => ({ url: `file:${path}` })],
    ['a replica (a supplied client)', (path) => ({
      url: `file:${path}`, syncUrl: PRIMARY, client: offlineClient(), sync: { onConnect: false },
    })],
  ])('%s: constructs, connects, writes and reads back', async (_name, configOf) => {
    const path = nextPath();
    const driver = new TursoDriver(configOf(path));

    expect(await roundTrip(driver)).toEqual(['row-25050']);
    expect(readPlain(path)).toEqual({ header: 'SQLite format 3', rows: ['row-25050'] });
  });

  it.each<[string, TursoDriverConfig]>([
    ['a libsql:// url', { url: 'libsql://db.example.invalid' }],
    ["a file: url under a forced mode: 'remote'", { url: `file:${join(DIR, 'remote-no-key.db')}`, mode: 'remote' }],
    [':memory: under a forced mode: \'remote\'', { url: ':memory:', mode: 'remote' }],
  ])('%s: still constructs in remote mode', (_name, config) => {
    expect(new TursoDriver(config).transportMode).toBe('remote');
  });
});
