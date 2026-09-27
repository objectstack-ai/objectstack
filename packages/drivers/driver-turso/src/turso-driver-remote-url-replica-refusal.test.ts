// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A local or replica `TursoDriver` with nothing durable behind its engine is
 * refused at construction. Before this, it silently ran on a private
 * `:memory:` database.
 *
 * # What was measured (the reading this refusal stands on)
 *
 * The local and replica arms run every read and write through the inherited
 * Knex + better-sqlite3 engine, and `TursoDriver.toKnexConfig` could hand that
 * engine only a `file:` path or `:memory:`. Everything else went to its last
 * arm, which was `:memory:`. On `main` @ `2c1011b01b`, `initObjects`, then
 * `create`, then `find`, then a fresh driver on the same config:
 *
 * ```
 * libsql:// + syncUrl + client stub, sync.onConnect false -> replica, knex :memory:,
 *     find 1 row, the client's own database held NO tables, 0 rows after restart
 * libsql:// / https:// / wss:// + syncUrl, real client, onConnect false -> same, 0 after restart
 * libsql:// + syncUrl, real client, default sync -> connect() rejects SYNC_NOT_SUPPORTED
 * libsql:// + mode 'replica' (no syncUrl)           -> 1 row, 0 after restart
 * libsql:// + mode 'local'                          -> 1 row, 0 after restart
 * :memory: + syncUrl, real client, default sync     -> connect() rejects URL_INVALID
 * :memory: + syncUrl + client stub, onConnect false -> 1 row, stub holds no tables, 0 after restart
 * file: + syncUrl + client stub (CONTROL)           -> knex on the file, 1 row, 1 after restart
 * ```
 *
 * `@libsql/client@0.17.4` builds no embedded replica for a remote url:
 * `lib-esm/node.js` routes http/https to its HTTP client and ws/wss to its
 * WebSocket client, `syncUrl` is read only in `lib-esm/sqlite3.js` (a `syncUrl`
 * grep over `http.js` / `ws.js` returns zero, while `authToken` returns six in
 * each), and both remote clients' `sync()` throw `SYNC_NOT_SUPPORTED`. The
 * sqlite3 client refuses an in-memory replica itself: "Embedded replica must use
 * file for local db".
 *
 * # What this file pins
 *
 * - The card's own reproduction (remote url, `syncUrl`, a client stub,
 *   `sync.onConnect: false`) is refused at construction, as the ADR-0112
 *   envelope (`code` + `status`). The stub is never touched. Each remote scheme
 *   the classifier knows is covered.
 * - Each other arm, as measured: a forced `mode: 'replica'` or `mode: 'local'`
 *   beside a remote url, and a replica on `:memory:` / `file::memory:` / a
 *   url that is not `file:`.
 * - The message names the way out and never echoes the url, which may carry a
 *   live `?authToken=`.
 * - PRESERVATION: the `file:` replica still constructs, connects, writes, and
 *   keeps its rows across a restart. So do the local, in-memory and remote
 *   faces. `detectMode` still classifies the refused pair `replica`: the
 *   refusal is in the constructor, not a re-classification.
 *
 * # Reverse verification: direction predicted before it was run
 *
 * With the constructor's `localEngineDefect` call removed, every refusal case
 * goes RED (the constructor returns a driver on `:memory:`, with no envelope to
 * read) and every preservation case stays GREEN. Measured; see the PR.
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

const PRIMARY = 'libsql://primary.example.turso.io';
const NOTE = { name: 'note', fields: { title: { type: 'string' } } };
const files = replicaFiles();
afterAll(() => files.removeAll());

describe('a remote url beside syncUrl: refused, never a replica on :memory:', () => {
  it("the card's reproduction: libsql:// + syncUrl + a client stub + sync.onConnect false", () => {
    const stub = makeLibsqlSqliteStub();
    const tablesInStub = () =>
      stub.raw.prepare(`select count(*) as c from sqlite_master where type='table'`).all()[0].c;

    const refusal = refusalOf(
      () =>
        new TursoDriver({
          url: 'libsql://r.turso.io',
          syncUrl: 'libsql://r.turso.io',
          client: stub as never,
          sync: { onConnect: false },
        }),
    );

    expectEnvelope(refusal);
    // Both ways out, by the subjects they name: the key to drop for a remote
    // database, the url spelling for a replica.
    expect(refusal.message).toContain('`syncUrl`');
    expect(refusal.message).toContain("url: 'file:");
    // Refused before any client work: the stub is untouched.
    expect(tablesInStub()).toBe(0);
    stub.close();
  });

  it.each(['libsql://', 'https://', 'http://', 'wss://', 'ws://'])(
    '%s + syncUrl is refused, naming the scheme it met',
    (scheme) => {
      const refusal = refusalOf(() => new TursoDriver({ url: `${scheme}db.example.turso.io`, syncUrl: PRIMARY }));

      expectEnvelope(refusal);
      expect(refusal.message).toContain(`\`${scheme}\``);
      expect(refusal.message).toContain('`syncUrl`');
    },
  );

  it('the factory door meets the same refusal: createTursoDriver is not a way around it', () => {
    expectEnvelope(refusalOf(() => createTursoDriver({ url: 'libsql://r.turso.io', syncUrl: PRIMARY })));
  });

  it('a `timeout` beside the pair does not change which refusal fires: this one owns the pair', () => {
    const refusal = refusalOf(() => new TursoDriver({ url: 'wss://r.turso.io', syncUrl: PRIMARY, timeout: 30_000 }));

    expectEnvelope(refusal);
    expect(refusal.message).toContain('`syncUrl`');
    expect(refusal.message).not.toContain('TursoDriverConfig.timeout');
  });

  it('never echoes the url: a live `?authToken=` in it stays out of the boot log', () => {
    const refusal = refusalOf(
      () => new TursoDriver({ url: 'libsql://r.turso.io?authToken=SECRET-TOKEN-VALUE', syncUrl: PRIMARY }),
    );

    expectEnvelope(refusal);
    expect(refusal.message).not.toContain('SECRET-TOKEN-VALUE');
    expect(refusal.message).not.toContain('r.turso.io');
  });
});

describe('a forced local or replica mode beside a remote url: refused', () => {
  it.each<[string, TursoDriverConfig]>([
    ["mode 'replica', no syncUrl", { url: 'libsql://r.turso.io', mode: 'replica' }],
    ["mode 'replica' + syncUrl", { url: 'libsql://r.turso.io', syncUrl: PRIMARY, mode: 'replica' }],
    ["mode 'local'", { url: 'libsql://r.turso.io', mode: 'local' }],
    ["mode 'local', https://", { url: 'https://r.turso.io', mode: 'local' }],
  ])('%s', (_label, config) => {
    const refusal = refusalOf(() => new TursoDriver(config));

    expectEnvelope(refusal);
    // The way out for a remote database names the key that forced the mode,
    // and the value that would have been right.
    expect(refusal.message).toContain(`\`mode: '${config.mode}'\``);
    expect(refusal.message).toContain("mode: 'remote'");
  });
});

describe('a replica that is not a local file: refused', () => {
  it.each<[string, TursoDriverConfig]>([
    [':memory: + syncUrl', { url: ':memory:', syncUrl: PRIMARY }],
    [':memory: + syncUrl + a supplied client', { url: ':memory:', syncUrl: PRIMARY, client: {} as never, sync: { onConnect: false } }],
    ['file::memory: + syncUrl', { url: 'file::memory:', syncUrl: PRIMARY }],
    ["file::memory:?cache=shared + mode 'replica'", { url: 'file::memory:?cache=shared', mode: 'replica' }],
    [":memory: + mode 'replica'", { url: ':memory:', mode: 'replica' }],
    ["a bare path + mode 'replica'", { url: './data/replica.db', mode: 'replica' }],
  ])('%s', (_label, config) => {
    const refusal = refusalOf(() => new TursoDriver(config));

    expectEnvelope(refusal);
    expect(refusal.message).toContain('embedded replica');
    expect(refusal.message).toContain("url: 'file:");
  });
});

describe('PRESERVATION: every configuration with a durable (or declared-ephemeral) engine still constructs', () => {
  it('the file: replica constructs, connects, writes, and keeps its rows across a restart', async () => {
    const url = files.next();
    const stub = makeLibsqlSqliteStub();
    const make = () => new TursoDriver({ url, syncUrl: PRIMARY, client: stub as never, sync: { onConnect: false } });

    const first = make();
    expect(first.transportMode).toBe('replica');
    await first.connect();
    await first.initObjects([NOTE as never]);
    await first.create('note', { id: 'n1', title: 'kept' });
    expect(await first.find('note', {})).toHaveLength(1);
    await first.disconnect();

    const second = make();
    await second.connect();
    await second.initObjects([NOTE as never]);
    expect((await second.find('note', {})).map((r: { title?: unknown }) => r.title)).toEqual(['kept']);
    await second.disconnect();
    stub.close();
  });

  it.each<[string, TursoDriverConfig, string]>([
    ['file: local', { url: 'file:./data/app.db' }, 'local'],
    [':memory: local (ephemeral by declaration)', { url: ':memory:' }, 'local'],
    ["file: + mode 'local'", { url: 'file:./data/app.db', mode: 'local' }, 'local'],
    ["file: + mode 'replica' + syncUrl", { url: 'file:./data/replica.db', syncUrl: PRIMARY, mode: 'replica' }, 'replica'],
    ['libsql:// remote', { url: 'libsql://r.turso.io', authToken: 't' }, 'remote'],
    ["libsql:// + mode 'remote'", { url: 'libsql://r.turso.io', mode: 'remote' }, 'remote'],
  ])('%s', (_label, config, mode) => {
    // Knex opens its connection lazily, so constructing never touches the file.
    expect(new TursoDriver(config).transportMode).toBe(mode);
  });

  it('detectMode still classifies the refused pair `replica`: the refusal is in the constructor, not a re-classification', () => {
    expect(TursoDriver.detectMode({ url: 'libsql://r.turso.io', syncUrl: PRIMARY })).toBe('replica');
    expect(TursoDriver.detectMode({ url: ':memory:', syncUrl: PRIMARY })).toBe('replica');
  });
});
