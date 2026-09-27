// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A url the classifier did not recognise no longer runs on a silent `:memory:`
 * engine. An uppercase remote scheme is classified the way `@libsql/client`
 * routes it, and whatever is still unrecognised is refused at construction in
 * a local or replica mode.
 *
 * # What was measured (the reading this change stands on)
 *
 * `TursoDriver.detectMode` matched `file:` and the five remote schemes
 * case-sensitively and answered `'local'` for anything else with no `mode`;
 * `toKnexConfig`'s last arm then handed the local engine `:memory:`. On `main`
 * @ `a7581b326`, `initObjects`, `create`, `find`, then a fresh driver on the
 * same config:
 *
 * ```
 * LIBSQL://… (no mode)            -> local, 1 row, 0 after restart
 * FILE:<tmp>/upper.db (no mode)   -> local, 1 row, 0 after restart, file never created
 * ./<dir>/app.db (no mode)        -> local, 1 row, 0 after restart, file never created
 * <tmp>/bare.db (no mode)         -> local, 1 row, 0 after restart, file never created
 * ./<dir>/app.db + mode: 'local'  -> local, 1 row, 0 after restart, file never created
 * file:<tmp>/ctl.db (CONTROL)     -> local, 1 row, 1 after restart, file created
 * ```
 *
 * `@libsql/core@0.17.4` routes on `uri.scheme.toLowerCase()`
 * (`lib-esm/config.js`), so the client reads `LIBSQL://` as `https` and
 * `FILE:` as `file`. The host's own url sniffers select this driver
 * case-insensitively too (`/^libsql:\/\//i` in the CLI's
 * `inferDriverTypeFromUrl` and the runtime's `detectDriverFromUrl`), so an
 * uppercase `OS_DATABASE_URL` reached this constructor. And the client refuses
 * everything that is still left over: `createClient` answers `URL_INVALID` for
 * `./data/app.db`, `data/app.db`, `/abs/app.db`, `:MEMORY:`, `''` and
 * `libsql:host` (no `//`), and `URL_SCHEME_NOT_SUPPORTED` for `sqlite:`,
 * `memory://` and `C:\…`.
 *
 * # What this file pins
 *
 * - Uppercase (and mixed-case) schemes are classified by the client's reading:
 *   a remote one is remote, `FILE:` is a durable local file. Beside `syncUrl`
 *   or under a forced local/replica mode, an uppercase remote url meets the
 *   same refusal its lowercase spelling already met.
 * - Every other url in a local or replica mode (auto-detected, with or without
 *   `syncUrl`, or forced) is refused as the ADR-0112 envelope, naming the
 *   `file:` spelling, never echoing the url.
 * - SCOPE: a forced `mode: 'remote'` has no local engine and is not this
 *   refusal's; the client refuses a bare path there itself, at `connect()`.
 * - PRESERVATION, beside this file's neighbours: `file:` local and replica,
 *   `:memory:` local, a lowercase remote url, `mode: 'remote'`.
 * - The one WIDENED cell: an uppercase `FILE:` url naming a file under a
 *   forced `mode: 'replica'`, with or without `syncUrl`. At `a7581b326` the
 *   constructor refused it (a forced replica had to start with a lowercase
 *   `file:`); it is now a `file:` url, so the replica runs on that file and
 *   keeps its rows across a restart.
 *
 * # Reverse verification: direction predicted before it was run
 *
 * With `turso-driver.ts` restored to its `a7581b326` content, every refusal
 * case and every uppercase-classification case goes RED (the constructor
 * returns a `'local'` driver on `:memory:`, with no envelope to read, and the
 * `FILE:` rows do not survive the restart) and every preservation and scope
 * case stays GREEN, except the WIDENED cell's cases, which go RED the other
 * way: there the constructor refuses. Measured; see the PR.
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

/** The first sentence of the unrecognised-url refusal: what identifies it. */
const UNRECOGNISED = '`TursoDriverConfig.url` is not a url this driver recognises';

const PRIMARY = 'libsql://primary.example.turso.io';
const HOST = 'db.example.turso.io';
const NOTE = { name: 'note', fields: { title: { type: 'string' } } };
const files = replicaFiles();
afterAll(() => files.removeAll());

/** `file:<path>` → `FILE:<path>`, the same database spelled with an uppercase scheme. */
const upperFile = (fileUrl: string) => `FILE:${fileUrl.slice('file:'.length)}`;

describe('an uppercase scheme is classified the way @libsql/client routes it', () => {
  it.each([`LIBSQL://${HOST}`, `Libsql://${HOST}`, `HTTPS://${HOST}`, 'Http://127.0.0.1:8080', `WSS://${HOST}`, 'Ws://127.0.0.1:8080'])(
    '%s with no `mode` is remote, not a local database on :memory:',
    (url) => {
      const driver = new TursoDriver({ url, authToken: 'token' });

      expect(driver.transportMode).toBe('remote');
      expect(driver.isRemote).toBe(true);
      expect(driver.getRemoteTransport()).not.toBeNull();
      // Only the comparison folds: the client is handed the url as authored.
      expect(driver.getTursoConfig().url).toBe(url);
      expect(TursoDriver.detectMode({ url })).toBe('remote');
    },
  );

  it('an uppercase remote url beside `syncUrl` meets the refusal its lowercase spelling meets, naming the scheme as typed', () => {
    const refusal = refusalOf(() => new TursoDriver({ url: `LIBSQL://${HOST}`, syncUrl: PRIMARY }));

    expectEnvelope(refusal);
    expect(refusal.message).toContain('is a remote `LIBSQL://` url');
    expect(refusal.message).toContain('`syncUrl`');
    expect(refusal.message).not.toContain(UNRECOGNISED);
  });

  it.each<[string, TursoDriverConfig]>([
    ["LIBSQL:// + mode 'local'", { url: `LIBSQL://${HOST}`, mode: 'local' }],
    ["HTTPS:// + mode 'local'", { url: `HTTPS://${HOST}`, mode: 'local' }],
    ["LIBSQL:// + mode 'replica'", { url: `LIBSQL://${HOST}`, mode: 'replica' }],
  ])('%s is refused as a remote url in a local-engine mode', (_label, config) => {
    const refusal = refusalOf(() => new TursoDriver(config));

    expectEnvelope(refusal);
    expect(refusal.message).toContain(`\`mode: '${config.mode}'\``);
    expect(refusal.message).toContain("mode: 'remote'");
  });

  it('an uppercase `WSS://` with a `timeout` and no `mode` is now remote, so the WebSocket window refusal reaches it', () => {
    const refusal = refusalOf(() => new TursoDriver({ url: `WSS://${HOST}`, timeout: 30_000 }));

    expectEnvelope(refusal);
    expect(refusal.message).toContain('TursoDriverConfig.timeout');
    expect(refusal.message).toContain('`WSS://`');
  });

  it('an uppercase `FILE:` url is a durable local file: the rows survive a restart', async () => {
    const url = upperFile(files.next());
    const make = () => new TursoDriver({ url });

    const first = make();
    expect(first.transportMode).toBe('local');
    await first.connect();
    await first.initObjects([NOTE as never]);
    await first.create('note', { id: 'n1', title: 'kept' });
    await first.disconnect();

    const second = make();
    await second.connect();
    await second.initObjects([NOTE as never]);
    expect((await second.find('note', {})).map((r: { title?: unknown }) => r.title)).toEqual(['kept']);
    await second.disconnect();
  });

  it('an uppercase `FILE:` url beside `syncUrl` is an embedded replica on that file', async () => {
    const url = upperFile(files.next());
    const stub = makeLibsqlSqliteStub();
    const make = () => new TursoDriver({ url, syncUrl: PRIMARY, client: stub as never, sync: { onConnect: false } });

    const first = make();
    expect(first.transportMode).toBe('replica');
    await first.connect();
    await first.initObjects([NOTE as never]);
    await first.create('note', { id: 'n1', title: 'kept' });
    await first.disconnect();

    const second = make();
    await second.connect();
    await second.initObjects([NOTE as never]);
    expect(await second.find('note', {})).toHaveLength(1);
    await second.disconnect();
    stub.close();
  });

  it('an uppercase `FILE::memory:` replica is refused as in-memory, exactly as the lowercase spelling is', () => {
    const refusal = refusalOf(() => new TursoDriver({ url: 'FILE::memory:', syncUrl: PRIMARY }));

    expectEnvelope(refusal);
    expect(refusal.message).toContain('names an in-memory database');
    expect(refusal.message).toContain('embedded replica');
  });
});

describe('a url that is none of file:, :memory: or a remote url: refused in a local or replica mode', () => {
  it.each<[string, TursoDriverConfig]>([
    ['a relative bare path, no mode', { url: './data/app.db' }],
    ['a bare path with no leading dot', { url: 'data/app.db' }],
    ['an absolute bare path', { url: '/var/lib/objectstack/app.db' }],
    ['a Windows path', { url: 'C:\\data\\app.db' }],
    ['a sqlite: url', { url: 'sqlite:./data/app.db' }],
    ['a memory:// url', { url: 'memory://scratch' }],
    ['an uppercase :MEMORY:', { url: ':MEMORY:' }],
    ['a remote scheme with no //', { url: 'libsql:db.example.turso.io' }],
    ['a file: url behind leading whitespace', { url: ' file:./data/app.db' }],
    ['an empty url', { url: '' }],
  ])('%s', (_label, config) => {
    const refusal = refusalOf(() => new TursoDriver(config));

    expectEnvelope(refusal);
    expect(refusal.message).toContain(UNRECOGNISED);
    expect(refusal.message).toContain('a local database');
    // The way out, by the spelling that would have been right.
    expect(refusal.message).toContain("url: 'file:./data/app.db'");
  });

  it("a bare path under a forced mode 'local' is refused, and the remote way out names the key to drop", () => {
    const refusal = refusalOf(() => new TursoDriver({ url: './data/app.db', mode: 'local' }));

    expectEnvelope(refusal);
    expect(refusal.message).toContain(UNRECOGNISED);
    expect(refusal.message).toContain("`mode: 'local'` makes this datasource a local database");
    expect(refusal.message).toContain("drop `mode: 'local'`");
    expect(refusal.message).toContain("url: 'file:./data/app.db'");
  });

  it('a bare path beside `syncUrl` is refused as the embedded replica it asks for, never a local :memory: engine', () => {
    const stub = makeLibsqlSqliteStub();
    const tablesInStub = () =>
      stub.raw.prepare(`select count(*) as c from sqlite_master where type='table'`).all()[0].c;

    const refusal = refusalOf(
      () =>
        new TursoDriver({
          url: './data/replica.db',
          syncUrl: PRIMARY,
          client: stub as never,
          sync: { onConnect: false },
        }),
    );

    expectEnvelope(refusal);
    expect(refusal.message).toContain(UNRECOGNISED);
    expect(refusal.message).toContain('`syncUrl` makes this datasource an embedded replica');
    expect(refusal.message).toContain("url: 'file:./data/replica.db'");
    expect(refusal.message).toContain('drop `syncUrl` (and `sync`)');
    // Refused before any client work: the stub is untouched.
    expect(tablesInStub()).toBe(0);
    stub.close();
  });

  it("a bare path under a forced mode 'replica' is refused naming the file: spelling for the replica", () => {
    const refusal = refusalOf(() => new TursoDriver({ url: './data/replica.db', mode: 'replica' }));

    expectEnvelope(refusal);
    expect(refusal.message).toContain(UNRECOGNISED);
    expect(refusal.message).toContain("`mode: 'replica'` makes this datasource an embedded replica");
    expect(refusal.message).toContain('name the remote in `syncUrl`');
    expect(refusal.message).toContain("url: 'file:./data/replica.db'");
  });

  it('detectMode classifies it by what the declaration asks for; the refusal is in the constructor', () => {
    expect(TursoDriver.detectMode({ url: './data/app.db' })).toBe('local');
    expect(TursoDriver.detectMode({ url: './data/app.db', syncUrl: PRIMARY })).toBe('replica');
  });

  it('the factory door meets the same refusal: createTursoDriver is not a way around it', () => {
    const refusal = refusalOf(() => createTursoDriver({ url: './data/app.db' }));

    expectEnvelope(refusal);
    expect(refusal.message).toContain(UNRECOGNISED);
  });

  it('never echoes the url: a token or a path in it stays out of the boot log', () => {
    const refusal = refusalOf(() => new TursoDriver({ url: './private-dir/app.db?authToken=SECRET-TOKEN-VALUE' }));

    expectEnvelope(refusal);
    expect(refusal.message).not.toContain('SECRET-TOKEN-VALUE');
    expect(refusal.message).not.toContain('private-dir');
  });
});

describe('SCOPE: a forced remote mode has no local engine, so this refusal does not judge its url', () => {
  it("a bare path under mode 'remote' constructs, and @libsql/client refuses it at connect() as URL_INVALID", async () => {
    const driver = new TursoDriver({ url: './data/app.db', mode: 'remote' });
    expect(driver.transportMode).toBe('remote');

    await expect(driver.connect()).rejects.toMatchObject({ code: 'URL_INVALID' });
  });
});

describe('PRESERVATION: the recognised spellings construct, and the one cell this change widens', () => {
  it.each<[string, TursoDriverConfig, string]>([
    ['file: local', { url: 'file:./data/app.db' }, 'local'],
    [':memory: local (ephemeral by declaration)', { url: ':memory:' }, 'local'],
    ['file:./… + syncUrl replica', { url: 'file:./data/replica.db', syncUrl: PRIMARY }, 'replica'],
    ["file: + mode 'local'", { url: 'file:./data/app.db', mode: 'local' }, 'local'],
    [":memory: + mode 'local'", { url: ':memory:', mode: 'local' }, 'local'],
    ['lowercase libsql:// remote', { url: `libsql://${HOST}`, authToken: 't' }, 'remote'],
    ['lowercase https:// remote', { url: `https://${HOST}`, authToken: 't' }, 'remote'],
    ["libsql:// + mode 'remote'", { url: `libsql://${HOST}`, mode: 'remote' }, 'remote'],
    ["file: + mode 'remote'", { url: 'file:./data/app.db', mode: 'remote' }, 'remote'],
    // WIDENED: refused at a7581b326, where a forced replica had to start with a
    // lowercase `file:`. An uppercase `FILE:` url is a `file:` url now.
    ["WIDENED: FILE: + mode 'replica', no syncUrl", { url: 'FILE:./data/replica.db', mode: 'replica' }, 'replica'],
    ["WIDENED: FILE: + mode 'replica' + syncUrl", { url: 'FILE:./data/replica.db', syncUrl: PRIMARY, mode: 'replica' }, 'replica'],
  ])('%s', (_label, config, mode) => {
    // Knex opens its connection lazily, so constructing never touches the file.
    expect(new TursoDriver(config).transportMode).toBe(mode);
  });

  it.each<[string, boolean]>([
    ['no syncUrl', false],
    ['with syncUrl', true],
  ])("WIDENED: FILE: + mode 'replica', %s, runs on the named file and keeps its rows across a restart", async (_label, withSync) => {
    const url = upperFile(files.next());
    const stub = makeLibsqlSqliteStub();
    const make = () =>
      new TursoDriver({
        url,
        mode: 'replica',
        ...(withSync ? { syncUrl: PRIMARY, client: stub as never, sync: { onConnect: false } } : {}),
      });

    const first = make();
    expect(first.transportMode).toBe('replica');
    await first.connect();
    await first.initObjects([NOTE as never]);
    await first.create('note', { id: 'n1', title: 'kept' });
    await first.disconnect();

    const second = make();
    await second.connect();
    await second.initObjects([NOTE as never]);
    expect((await second.find('note', {})).map((r: { title?: unknown }) => r.title)).toEqual(['kept']);
    await second.disconnect();
    stub.close();
  });
});
