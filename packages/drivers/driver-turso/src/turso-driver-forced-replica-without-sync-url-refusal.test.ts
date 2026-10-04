// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20437] A forced `mode: 'replica'` with no `syncUrl` is refused at
 * construction: a replica with no remote to replicate from. The constructor
 * half of one paired change; `@objectstack/spec`'s `TursoConfigSchema` refuses
 * the same config at authoring, on `mode`, in the same words.
 *
 * # What was measured (the reading this refusal stands on)
 *
 * On the built driver before the change (the dist probe the card cites, at
 * `dbddf02c1` and again at `2242ad513`):
 *
 * ```
 * file: + mode 'replica', no syncUrl          -> constructs, transportMode 'replica',
 *                                                isSyncEnabled() false, no interval,
 *                                                sync() a no-op, reads and writes on the file
 * file: + mode 'replica' + sync, no syncUrl   -> the same (refused since #20200, on `sync`)
 * ```
 *
 * `connect()` builds the sync client only inside its `syncUrl` arm, and `sync()`
 * and `isSyncEnabled()` both test `syncUrl` first, so a forced replica with no
 * `syncUrl` was a plain local database that declared itself a replica. Both
 * schema copies accepted it (the parity row "file: under a forced
 * mode: 'replica'"), and this package's tests pinned it as accepted.
 *
 * # What this file pins
 *
 * - The refusal as the ADR-0112 envelope (`code` + `status`) plus its first
 *   sentence, on a `file:` url in any letter case, beside an empty `syncUrl`
 *   (unset), beside `timeout`, and beside a supplied client (refused before
 *   any client work). The full message is the spec contract's issue text byte
 *   for byte; that equality is pinned in
 *   `spec/turso-config-constructor-parity.test.ts`, not here.
 * - ORDER: a forced replica that another refusal already takes keeps that
 *   refusal's message — a remote url, `:memory:`, a bare path (the local-engine
 *   refusals), and `sync` with no `syncUrl` (the spec contract raises `sync`
 *   first too).
 * - WIDTH, by controls that must stay accepted: a forced replica beside
 *   `syncUrl`, a replica selected by `syncUrl` alone, and a `file:` url with no
 *   `mode` or with `mode: 'local'`, which is the plain local database the
 *   refusal prescribes.
 *
 * # Reverse verification: direction predicted before it was run
 *
 * Remove the refusal from the constructor and every refusal case here goes RED
 * (the constructor returns a `'replica'` driver, so there is no envelope to
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
const REPLICA_FIRST_SENTENCE =
  "`mode: 'replica'` makes this datasource an embedded replica, a local file kept in sync with " +
  'the remote named in `syncUrl`, but no `syncUrl` is set: nothing would ever sync, so it would ' +
  'run as a plain local database that never replicates — the turso driver refuses this ' +
  'configuration when it starts.';

const PRIMARY = 'libsql://primary.example.turso.io';
const files = replicaFiles();
afterAll(() => files.removeAll());

/** `file:<path>` → `FILE:<path>`, the same database spelled with an uppercase scheme. */
const upperFile = (fileUrl: string) => `FILE:${fileUrl.slice('file:'.length)}`;

describe("a forced `mode: 'replica'` with no `syncUrl` — refused at construction", () => {
  it.each<[string, () => TursoDriverConfig]>([
    ['a file: url', () => ({ url: files.next(), mode: 'replica' })],
    ['an uppercase FILE: url', () => ({ url: upperFile(files.next()), mode: 'replica' })],
    ['an empty syncUrl, which is unset', () => ({ url: files.next(), mode: 'replica', syncUrl: '' })],
    ['beside a timeout', () => ({ url: files.next(), mode: 'replica', timeout: 5000 })],
    ['beside an encryptionKey', () => ({ url: files.next(), mode: 'replica', encryptionKey: 'aes-256-key' })],
  ])("%s: VALIDATION_ERROR / 400, in the spec contract's words", (_name, config) => {
    const refusal = refusalOf(() => new TursoDriver(config()));

    expectEnvelope(refusal);
    expect(refusal.message.startsWith(REPLICA_FIRST_SENTENCE)).toBe(true);
    // The two ways out, each by its spelling.
    expect(refusal.message).toContain("`url: 'file:./data/replica.db'` with `syncUrl` set to");
    expect(refusal.message).toContain("For a plain local database, drop `mode: 'replica'`.");
  });

  it('beside a supplied client: refused before any client work, the client untouched', () => {
    const stub = makeLibsqlSqliteStub();
    const tablesInStub = () =>
      stub.raw.prepare(`select count(*) as c from sqlite_master where type='table'`).all()[0].c;

    const refusal = refusalOf(() => new TursoDriver({ url: files.next(), mode: 'replica', client: stub as never }));

    expectEnvelope(refusal);
    expect(refusal.message.startsWith(REPLICA_FIRST_SENTENCE)).toBe(true);
    expect(tablesInStub()).toBe(0);
    stub.close();
  });

  it('createTursoDriver() is the same constructor, and refuses the same config', () => {
    const refusal = refusalOf(() => createTursoDriver({ url: files.next(), mode: 'replica' }));

    expectEnvelope(refusal);
    expect(refusal.message.startsWith(REPLICA_FIRST_SENTENCE)).toBe(true);
  });

  it('never echoes the url: a path or a token in it stays out of the boot log', () => {
    const refusal = refusalOf(
      () => new TursoDriver({ url: 'file:./private-dir/app.db?authToken=SECRET-TOKEN-VALUE', mode: 'replica' }),
    );

    expectEnvelope(refusal);
    expect(refusal.message).not.toContain('SECRET-TOKEN-VALUE');
    expect(refusal.message).not.toContain('private-dir');
  });
});

describe('ORDER — a forced replica another refusal already takes keeps that refusal', () => {
  it.each<[string, TursoDriverConfig, string]>([
    ['a remote url', { url: 'libsql://db.example.turso.io', mode: 'replica' }, 'is a remote `libsql://` url'],
    [':memory:', { url: ':memory:', mode: 'replica' }, 'names an in-memory database'],
    ['file::memory:', { url: 'file::memory:', mode: 'replica' }, 'names an in-memory database'],
    ['a bare path', { url: './data/replica.db', mode: 'replica' }, 'is not a url this driver recognises'],
    [
      '`sync` with no syncUrl',
      { url: 'file:./data/replica.db', mode: 'replica', sync: { intervalSeconds: 60 } },
      '`sync` configures embedded-replica syncing',
    ],
  ])('%s: the earlier refusal, not this one', (_name, config, names) => {
    const refusal = refusalOf(() => new TursoDriver(config));

    expectEnvelope(refusal);
    expect(refusal.message).toContain(names);
    expect(refusal.message.startsWith(REPLICA_FIRST_SENTENCE)).toBe(false);
  });
});

describe('CONTROLS — what the refusal must leave accepted', () => {
  it("a forced mode 'replica' beside syncUrl is a replica, and runs on its file across a restart", async () => {
    const url = files.next();
    const stub = makeLibsqlSqliteStub();
    const note = { name: 'note', fields: { title: { type: 'string' } } };
    const make = () =>
      new TursoDriver({ url, mode: 'replica', syncUrl: PRIMARY, client: stub as never, sync: { onConnect: false } });

    const first = make();
    expect(first.transportMode).toBe('replica');
    await first.connect();
    expect(first.isSyncEnabled()).toBe(true);
    await first.initObjects([note as never]);
    await first.create('note', { id: 'n1', title: 'kept' });
    await first.disconnect();

    const second = make();
    await second.connect();
    await second.initObjects([note as never]);
    expect((await second.find('note', {})).map((r: { title?: unknown }) => r.title)).toEqual(['kept']);
    await second.disconnect();
    stub.close();
  });

  it.each<[string, TursoDriverConfig, string]>([
    ['a replica selected by syncUrl alone', { url: 'file:./data/replica.db', syncUrl: PRIMARY, sync: { onConnect: false } }, 'replica'],
    ['a file: url with no mode: the plain local database the refusal prescribes', { url: 'file:./data/app.db' }, 'local'],
    ["a file: url under a forced mode 'local'", { url: 'file:./data/app.db', mode: 'local' }, 'local'],
    [':memory: with no mode', { url: ':memory:' }, 'local'],
  ])('%s constructs', (_name, config, mode) => {
    // Knex opens its connection lazily, so constructing never touches the file.
    expect(new TursoDriver(config).transportMode).toBe(mode);
  });

  it('detectMode still classifies a forced replica as a replica; the refusal is in the constructor', () => {
    expect(TursoDriver.detectMode({ url: 'file:./data/replica.db', mode: 'replica' })).toBe('replica');
  });
});
