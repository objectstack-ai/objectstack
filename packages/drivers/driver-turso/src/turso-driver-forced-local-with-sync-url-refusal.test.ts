// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20586] A forced `mode: 'local'` beside a `syncUrl` is refused at
 * construction: a datasource declared local that the driver would sync with a
 * remote anyway. The constructor half of one paired change;
 * `@objectstack/spec`'s `TursoConfigSchema` refuses the same config at
 * authoring, on `mode`, in the same words. #20437's forced-replica refusal is
 * the same defect the other way round.
 *
 * # What was measured (the reading this refusal stands on)
 *
 * On this package's source before the change (base `f4ce10c89`), with a client
 * that counts `sync()` calls and `sync: { intervalSeconds: 1 }`:
 *
 * ```
 * file: + mode 'local' + syncUrl   -> transportMode 'local', 1 sync on connect,
 *                                     isSyncEnabled() true, interval started, 2 syncs after 1.3 s
 * file: + syncUrl (no mode)        -> transportMode 'replica', the same four readings
 * file: + mode 'local' (no syncUrl) -> transportMode 'local', 0 syncs, isSyncEnabled() false, no interval
 * ```
 *
 * `connect()` builds the sync client whenever `syncUrl` is set in a non-remote
 * mode, so a forced local mode beside `syncUrl` ran as an embedded replica and
 * only the `transportMode` label said `local`. Both schema copies accepted it
 * (the parity row "file: + syncUrl under a forced mode: 'local'"), and this
 * package's tests pinned it as accepted.
 *
 * # What this file pins
 *
 * - The refusal as the ADR-0112 envelope (`code` + `status`) plus its first
 *   sentence and both ways out, on a `file:` url in any letter case, on an
 *   in-memory url, beside `sync`, `timeout` and `encryptionKey`, and beside a
 *   supplied client (refused before any client work: the client is never
 *   synced). The full message is the spec contract's issue text byte for byte;
 *   that equality is pinned in `spec/turso-config-constructor-parity.test.ts`,
 *   not here.
 * - ORDER: a config another refusal already takes keeps that refusal's message
 *   — a remote url or a bare path (the local-engine refusals), `sync` with no
 *   `syncUrl`, and #20437's forced replica with no `syncUrl`.
 * - WIDTH, by controls that must stay accepted: the unforced `file:` +
 *   `syncUrl` replica (it still syncs), and a forced local mode with no
 *   `syncUrl` or an empty one (it still syncs nothing).
 *
 * # Reverse verification: direction predicted before it was run
 *
 * Remove the refusal from the constructor and every refusal case here goes RED
 * (the constructor returns a `'local'` driver, so there is no envelope to
 * read); the ORDER cases and the CONTROLS stay GREEN. Measured; see the PR.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createTursoDriver } from './index.js';
import { TursoDriver, type TursoDriverConfig } from './turso-driver.js';
import { makeLibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { replicaFiles } from './replica-file.testkit.js';

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

function expectEnvelope(refusal: Refusal | null): asserts refusal is Refusal {
  expect(refusal, 'expected the constructor to refuse, and it returned a driver').not.toBeNull();
  expect(refusal!.code).toBe('VALIDATION_ERROR');
  expect(refusal!.status).toBe(400);
}

/** The first sentence of the refusal: what identifies it. */
const LOCAL_FIRST_SENTENCE =
  "`mode: 'local'` makes this datasource a plain local database, but `syncUrl` names a remote to " +
  'replicate from: the database would still be synced with that remote as an embedded replica, ' +
  'so the declared local mode would be ignored — the turso driver refuses this configuration ' +
  'when it starts.';

/** #20437's first sentence, which a forced replica with no `syncUrl` keeps. */
const REPLICA_FIRST_SENTENCE =
  "`mode: 'replica'` makes this datasource an embedded replica, a local file kept in sync with " +
  'the remote named in `syncUrl`, but no `syncUrl` is set:';

const PRIMARY = 'libsql://primary.example.turso.io';
const files = replicaFiles();
afterAll(() => files.removeAll());

/** `file:<path>` → `FILE:<path>`, the same database spelled with an uppercase scheme. */
const upperFile = (fileUrl: string) => `FILE:${fileUrl.slice('file:'.length)}`;

/** A libSQL client that only counts the syncs the driver asks it for. */
function syncCountingClient() {
  const client = {
    syncs: 0,
    async sync() {
      client.syncs += 1;
    },
    close() {},
  };
  return client;
}

describe("a forced `mode: 'local'` beside a `syncUrl` — refused at construction", () => {
  it.each<[string, () => TursoDriverConfig]>([
    ['a file: url', () => ({ url: files.next(), mode: 'local', syncUrl: PRIMARY })],
    ['an uppercase FILE: url', () => ({ url: upperFile(files.next()), mode: 'local', syncUrl: PRIMARY })],
    [':memory:', () => ({ url: ':memory:', mode: 'local', syncUrl: PRIMARY })],
    ['file::memory:', () => ({ url: 'file::memory:', mode: 'local', syncUrl: PRIMARY })],
    ['beside sync', () => ({ url: files.next(), mode: 'local', syncUrl: PRIMARY, sync: { intervalSeconds: 60, onConnect: true } })],
    ['beside a timeout', () => ({ url: files.next(), mode: 'local', syncUrl: PRIMARY, timeout: 5000 })],
    ['beside an encryptionKey', () => ({ url: files.next(), mode: 'local', syncUrl: PRIMARY, encryptionKey: 'aes-256-key' })],
  ])("%s: VALIDATION_ERROR / 400, in the spec contract's words", (_name, config) => {
    const refusal = refusalOf(() => new TursoDriver(config()));

    expectEnvelope(refusal);
    expect(refusal.message.startsWith(LOCAL_FIRST_SENTENCE)).toBe(true);
    // The two ways out, each by its spelling.
    expect(refusal.message).toContain(
      "For an embedded replica, drop `mode` and keep `syncUrl` beside the local file: `url: 'file:./data/replica.db'`.",
    );
    expect(refusal.message).toContain('For a plain local database, drop `syncUrl` (and `sync`).');
  });

  it('beside a supplied client: refused before any client work, the client never synced or written', () => {
    const stub = makeLibsqlSqliteStub();
    const tablesInStub = () =>
      stub.raw.prepare(`select count(*) as c from sqlite_master where type='table'`).all()[0].c;

    const refusal = refusalOf(
      () => new TursoDriver({ url: files.next(), mode: 'local', syncUrl: PRIMARY, client: stub as never }),
    );

    expectEnvelope(refusal);
    expect(refusal.message.startsWith(LOCAL_FIRST_SENTENCE)).toBe(true);
    expect(tablesInStub()).toBe(0);
    stub.close();
  });

  it('createTursoDriver() is the same constructor, and refuses the same config', () => {
    const refusal = refusalOf(() => createTursoDriver({ url: files.next(), mode: 'local', syncUrl: PRIMARY }));

    expectEnvelope(refusal);
    expect(refusal.message.startsWith(LOCAL_FIRST_SENTENCE)).toBe(true);
  });

  it('never echoes either url: a path or a token in them stays out of the boot log', () => {
    const refusal = refusalOf(
      () =>
        new TursoDriver({
          url: 'file:./private-dir/app.db?authToken=SECRET-FILE-TOKEN',
          mode: 'local',
          syncUrl: 'libsql://private-host.turso.io?authToken=SECRET-SYNC-TOKEN',
        }),
    );

    expectEnvelope(refusal);
    for (const secret of ['SECRET-FILE-TOKEN', 'private-dir', 'SECRET-SYNC-TOKEN', 'private-host']) {
      expect(refusal.message).not.toContain(secret);
    }
  });
});

describe('ORDER — a config another refusal already takes keeps that refusal', () => {
  it.each<[string, TursoDriverConfig, string]>([
    ['a remote url + syncUrl', { url: 'libsql://db.example.turso.io', mode: 'local', syncUrl: PRIMARY }, 'is a remote `libsql://` url'],
    ['a bare path + syncUrl', { url: './data/app.db', mode: 'local', syncUrl: PRIMARY }, 'is not a url this driver recognises'],
    [
      '`sync` with no syncUrl',
      { url: 'file:./data/app.db', mode: 'local', sync: { intervalSeconds: 60 } },
      '`sync` configures embedded-replica syncing',
    ],
    ["a forced mode 'replica' with no syncUrl", { url: 'file:./data/replica.db', mode: 'replica' }, REPLICA_FIRST_SENTENCE],
  ])('%s: the earlier refusal, not this one', (_name, config, names) => {
    const refusal = refusalOf(() => new TursoDriver(config));

    expectEnvelope(refusal);
    expect(refusal.message).toContain(names);
    expect(refusal.message.startsWith(LOCAL_FIRST_SENTENCE)).toBe(false);
  });
});

describe('CONTROLS — what the refusal must leave accepted', () => {
  it('the unforced file: + syncUrl replica still constructs, connects and syncs', async () => {
    const client = syncCountingClient();
    const driver = new TursoDriver({ url: files.next(), syncUrl: PRIMARY, client: client as never });

    expect(driver.transportMode).toBe('replica');
    await driver.connect();
    expect(driver.isSyncEnabled()).toBe(true);
    expect(client.syncs).toBe(1);
    await driver.disconnect();
  });

  it.each<[string, () => TursoDriverConfig]>([
    ["a file: url under a forced mode 'local', no syncUrl", () => ({ url: files.next(), mode: 'local' })],
    ["a file: url under a forced mode 'local', an empty syncUrl (unset)", () => ({ url: files.next(), mode: 'local', syncUrl: '' })],
  ])('%s is a local database that syncs nothing', async (_name, config) => {
    const client = syncCountingClient();
    const driver = new TursoDriver({ ...config(), client: client as never });

    expect(driver.transportMode).toBe('local');
    await driver.connect();
    expect(driver.isSyncEnabled()).toBe(false);
    expect(client.syncs).toBe(0);
    await driver.disconnect();
  });

  it.each<[string, TursoDriverConfig, string]>([
    ["a forced mode 'replica' beside syncUrl", { url: 'file:./data/replica.db', mode: 'replica', syncUrl: PRIMARY, sync: { onConnect: false } }, 'replica'],
    [":memory: under a forced mode 'local', no syncUrl", { url: ':memory:', mode: 'local' }, 'local'],
  ])('%s constructs', (_name, config, mode) => {
    // Knex opens its connection lazily, so constructing never touches the file.
    expect(new TursoDriver(config).transportMode).toBe(mode);
  });

  it('detectMode still classifies a forced local mode as local; the refusal is in the constructor', () => {
    expect(TursoDriver.detectMode({ url: 'file:./data/app.db', mode: 'local', syncUrl: PRIMARY })).toBe('local');
  });
});
