// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE pin of commit e2798fab7: both boot hosts answer the SAME question about the
 * SAME `OS_DATABASE_DRIVER` value — and, since the in-memory engine's
 * retirement, the same `OS_DATABASE_URL` scheme — the same way.
 *
 * ## Why this file, and why here
 *
 * The fork survived three separate changes (#3276, #5820, commit cfb549db8) that each fixed
 * one spelling on one side. Every one of them was pinned — by a test that drove
 * exactly one host. `packages/cli/src/utils/storage-driver.test.ts` proved the
 * CLI accepted `pg`; `packages/runtime/src/standalone-stack*.test.ts` proved the
 * standalone stack refused an unknown value loudly. Both were green, both were
 * right, and together they described a platform where `OS_DATABASE_DRIVER=pg`
 * booted under `os start` and was refused by `os migrate`. Measured on `main` at
 * the start of this card: **10 of 21 spellings disagreed**.
 *
 * No amount of per-host testing finds that. The missing assertion is the
 * CROSS-host one, and it can only live in a package that can import both — which
 * `@objectstack/cli` is (it depends on `@objectstack/runtime` and
 * `@objectstack/spec`), and neither of the other two is.
 *
 * ## What it drives
 *
 * The real entry points of the two HOSTS, not the table:
 *  - the CLI host → `resolveDriverType` + `resolveStorageDefinition`, the pair
 *    `commands/serve.ts` calls on its LEGACY path only (`OS_MODE=off|none|legacy`,
 *    `bootMode: 'off'`, or a host config — `shouldBootWithLibrary`);
 *  - the runtime host → `resolveStandaloneDatabase`, the pre-boot resolution of
 *    every ordinary boot: `os dev` / `os start` / `os serve` over a config or an
 *    artifact (both reach `createStandaloneStack`), every `os migrate`
 *    subcommand, and every embedder.
 *
 * The verdict helpers and the case titles still say `os start` and `os migrate`
 * — the two commands the fork was first measured between; read them as "the CLI
 * host" and "the runtime host". Driving the shared spec table instead would pin
 * that the table equals itself.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_DRIVER_IDS,
  DATABASE_DRIVER_SELECTION_ALIASES,
  DATABASE_DRIVER_SELECTION_IDS,
  DRIVER_ID_ALIASES,
  driverHasLocalDefault,
  resolveDatabaseDriverId,
  resolveDriverId,
} from '@objectstack/spec/data';
import { resolveStandaloneDatabase } from '@objectstack/runtime';
import { resolveDriverType, resolveStorageDefinition, UnsupportedDriverError } from './storage-driver.js';

/** A URL whose scheme matches each canonical kind, so only the SPELLING varies. */
const URL_FOR: Readonly<Record<string, string>> = {
  sqlite: 'file:/tmp/os6345-parity.db',
  'sqlite-wasm': 'file:/tmp/os6345-parity.db',
  postgres: 'postgres://u:p@localhost:5432/db',
  mysql: 'mysql://u:p@localhost:3306/db',
  mongodb: 'mongodb://localhost:27017/db',
  turso: 'libsql://my-db.turso.io',
};

/** Spellings NEITHER host accepted before commit e2798fab7, and which must stay refused. */
const CONTRACT_ONLY_SPELLINGS = ['sqlite3', 'better-sqlite3', 'mariadb', 'inmemory'] as const;

/**
 * The in-memory (mingo) engine's selection spellings, which BOTH hosts accepted
 * until the engine was withdrawn as a boot store — written out because a reader
 * of the retirement looks for these three words, and checked below against the
 * table so a fourth withdrawn spelling cannot escape the refuse rows.
 */
const WITHDRAWN_MEMORY_SPELLINGS = ['memory', 'mingo', 'in-memory'] as const;

/** The engine's URL schemes, which both hosts recognise and refuse. */
const WITHDRAWN_MEMORY_URLS = ['memory://', 'memory://named', 'mingo://', 'MINGO://upper'] as const;

/** Run a host's resolution and return the refusal's message, or `null` when it accepted. */
function refusalMessage(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

type Verdict = { accepted: true; driverId: string } | { accepted: false };

/**
 * The `os start` verdict for one spelling — driving serve.ts's own two calls.
 *
 * `isDev` is a PARAMETER, and the refusal cases below run both values, because
 * the two modes did not answer alike: in production an unrecognised selection
 * returned `null` (refused), but in DEV it fell through to the trailing SQLite
 * default and booted in silence. A parity test that only ran `isDev: false`
 * would have been green with the CLI's half of fork 1 reverted — measured, in
 * this PR's own reverse verification, which is why the parameter is here.
 */
function cliVerdict(spelling: string, databaseUrl: string | undefined, isDev = false): Verdict {
  try {
    const kind = resolveDriverType(spelling, databaseUrl);
    const definition = resolveStorageDefinition(kind, { databaseUrl, isDev });
    return definition ? { accepted: true, driverId: definition.driverId } : { accepted: false };
  } catch {
    return { accepted: false };
  }
}

/** The `os migrate` verdict for one spelling — driving the pre-boot resolution. */
function standaloneVerdict(spelling: string, databaseUrl: string | undefined): Verdict {
  process.env.OS_DATABASE_DRIVER = spelling;
  if (databaseUrl) process.env.OS_DATABASE_URL = databaseUrl;
  else delete process.env.OS_DATABASE_URL;
  try {
    const resolved = resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' });
    return { accepted: true, driverId: resolved.driver };
  } catch {
    return { accepted: false };
  }
}

describe('driver vocabulary parity: `os start` and `os migrate` answer alike (#6345)', () => {
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'OS_DATABASE_DRIVER', 'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_HOME',
  ];

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    // Pin the state dir so the unified-default rung resolves under a scratch
    // directory rather than the machine's real `~/.objectstack`.
    process.env.OS_HOME = mkdtempSync(join(tmpdir(), 'os6345-parity-'));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
  });

  // The core assertion. Table-driven over EVERY selection spelling the shared
  // vocabulary publishes, so a spelling added to one host and not the other
  // cannot pass — which is precisely how the fork was able to widen unnoticed.
  it.each([...DATABASE_DRIVER_SELECTION_ALIASES])(
    'both hosts accept `%s` and resolve it to the same canonical driver id',
    (spelling) => {
      const canonical = resolveDatabaseDriverId(spelling)!;
      expect(canonical, `${spelling} must resolve`).toBeDefined();
      const url = URL_FOR[canonical];

      const cli = cliVerdict(spelling, url);
      const standalone = standaloneVerdict(spelling, url);

      expect(cli, `os start refused '${spelling}'`).toEqual({ accepted: true, driverId: canonical });
      expect(standalone, `os migrate refused '${spelling}'`).toEqual({ accepted: true, driverId: canonical });
    },
  );

  // The other half of "the same answer": a spelling one host refuses, the other
  // must refuse too. Before commit e2798fab7 the CLI silently booted SQLite in dev for
  // these while `os migrate` named them in a refusal.
  it.each([...CONTRACT_ONLY_SPELLINGS, 'nonsense', 'com.vendor.snowflake'])(
    'both hosts REFUSE `%s`, in dev AND in prod',
    (spelling) => {
      for (const isDev of [false, true]) {
        expect(
          cliVerdict(spelling, undefined, isDev).accepted,
          `os start (isDev=${isDev}) accepted '${spelling}'`,
        ).toBe(false);
      }
      expect(standaloneVerdict(spelling, undefined).accepted, `os migrate accepted '${spelling}'`).toBe(false);
    },
  );

  // The card's own reproduction, kept verbatim as a named case: it is the line a
  // reader of commit e2798fab7 will look for, and a table row does not read as one.
  it('the card repro: OS_DATABASE_DRIVER=pg is accepted by BOTH (was: start yes, migrate no)', () => {
    const url = 'postgres://u:p@localhost:5432/db';
    expect(cliVerdict('pg', url)).toEqual({ accepted: true, driverId: 'postgres' });
    expect(standaloneVerdict('pg', url)).toEqual({ accepted: true, driverId: 'postgres' });
  });

  // The contract-only aliases must keep resolving a CONFIG CONTRACT even though
  // they are not selectable — the distinction the single flat `Record` could not
  // express. Dropping them would silently un-validate a stored
  // `driver: 'sqlite3'` datasource's config.
  it.each([
    ['sqlite3', 'sqlite'],
    ['better-sqlite3', 'sqlite'],
    ['mariadb', 'mysql'],
    ['inmemory', 'memory'],
  ])('`%s` still resolves the %s config contract while not being selectable', (alias, canonical) => {
    expect(resolveDriverId(alias)).toBe(canonical);
    expect(resolveDatabaseDriverId(alias)).toBeUndefined();
  });

  // ── The in-memory engine's retirement ──────────────────────────────────────
  // Withdrawn at the DECLARATION: the spec table keeps `memory` on its contract
  // face and offers no selection spelling for it. The accept rows above iterate
  // the selection face, so the three spellings simply LEAVE them — these rows
  // are what keeps that from being a silent drop in coverage.
  it('the spec table withdrew exactly these spellings: contract face yes, selection face no', () => {
    const withdrawn = Object.keys(DRIVER_ID_ALIASES)
      .filter((alias) => !DATABASE_DRIVER_SELECTION_IDS.includes(DRIVER_ID_ALIASES[alias]!))
      .sort();
    expect(withdrawn).toEqual([...WITHDRAWN_MEMORY_SPELLINGS, 'inmemory'].sort());
    for (const spelling of withdrawn) {
      expect(resolveDriverId(spelling), spelling).toBe('memory');
      expect(resolveDatabaseDriverId(spelling), spelling).toBeUndefined();
    }
  });

  it.each([...WITHDRAWN_MEMORY_SPELLINGS])(
    'both hosts REFUSE the withdrawn spelling `%s`, in dev AND prod, and both name the SQLite replacements',
    (spelling) => {
      for (const isDev of [false, true]) {
        const cli = refusalMessage(() => resolveStorageDefinition(resolveDriverType(spelling, undefined), { isDev }));
        expect(cli, `os start (isDev=${isDev}) accepted '${spelling}'`).not.toBeNull();
        expect(cli).toContain('--fresh');
        expect(cli).toContain(':memory:');
      }
      process.env.OS_DATABASE_DRIVER = spelling;
      const standalone = refusalMessage(() => resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' }));
      expect(standalone, `os migrate accepted '${spelling}'`).not.toBeNull();
      expect(standalone).toContain('--fresh');
      expect(standalone).toContain(':memory:');
    },
  );

  // The URL door. Before the retirement it was the one door the pin had no row
  // for: the runtime matched `memory://` literally and the CLI matched
  // `(memory|mingo)://`, so `mingo://` booted the engine on the CLI host and was
  // an "unsupported scheme" on the runtime host — a disagreement this file could
  // not see, because every row above names a driver.
  it.each([...WITHDRAWN_MEMORY_URLS])(
    'both hosts REFUSE OS_DATABASE_URL=%s with no driver named, and both name the SQLite replacements',
    (url) => {
      for (const isDev of [false, true]) {
        const cli = refusalMessage(() =>
          resolveStorageDefinition(resolveDriverType(undefined, url), { databaseUrl: url, isDev }),
        );
        expect(cli, `os start (isDev=${isDev}) accepted ${url}`).not.toBeNull();
        expect(cli).toContain('--fresh');
        expect(cli).toContain(':memory:');
      }
      process.env.OS_DATABASE_URL = url;
      const standalone = refusalMessage(() => resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' }));
      expect(standalone, `os migrate accepted ${url}`).not.toBeNull();
      expect(standalone).toContain('--fresh');
      expect(standalone).toContain(':memory:');
    },
  );

  // The control on the URL door: the replacement the refusals name is accepted
  // by both hosts, as SQLite — so the refusal is scoped to the engine, not to
  // the word "memory".
  it('both hosts ACCEPT the replacement OS_DATABASE_URL=:memory: as sqlite', () => {
    expect(cliVerdict('', ':memory:')).toEqual({ accepted: true, driverId: 'sqlite' });
    process.env.OS_DATABASE_URL = ':memory:';
    expect(resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' }).driver).toBe('sqlite');
  });

  // `mongo` was retired as a value at 18 (#23543 F1): it left the selection
  // face, so both hosts refuse it alike, each enumerating `mongodb` among the
  // spellings that work. It stays on the CONTRACT face only, so a stored legacy
  // `datasource.driver: 'mongo'` row keeps its contract and its redaction.
  it('`mongodb` selects the canonical id on both hosts; the retired `mongo` is refused by both, naming `mongodb`', () => {
    const url = URL_FOR.mongodb!;
    expect(cliVerdict('mongodb', url)).toEqual({ accepted: true, driverId: 'mongodb' });
    expect(standaloneVerdict('mongodb', url)).toEqual({ accepted: true, driverId: 'mongodb' });

    expect(cliVerdict('mongo', url)).toEqual({ accepted: false });
    expect(standaloneVerdict('mongo', url)).toEqual({ accepted: false });
    const cli = refusalMessage(() => resolveStorageDefinition(resolveDriverType('mongo', url), { databaseUrl: url, isDev: false }));
    process.env.OS_DATABASE_DRIVER = 'mongo';
    process.env.OS_DATABASE_URL = url;
    const standalone = refusalMessage(() => resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' }));
    for (const [host, message] of [['os start', cli], ['os migrate', standalone]] as const) {
      expect(message, host).toContain('"mongo"');
      expect(message, host).toMatch(/Supported drivers: [^.]*\bmongodb\b/);
      expect(message, host).not.toMatch(/Supported drivers: [^.]*\bmongo\b(?!db)/);
    }

    expect(resolveDatabaseDriverId('mongo')).toBeUndefined();
    expect(resolveDriverId('mongo')).toBe('mongodb');
  });
});

describe('fork 2: no local default + no URL is refused on BOTH sides — all 8 cells (#6345)', () => {
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'OS_DATABASE_DRIVER', 'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_HOME',
  ];

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.OS_HOME = mkdtempSync(join(tmpdir(), 'os6345-fork2-'));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
  });

  const NO_LOCAL_DEFAULT = ['postgres', 'mysql', 'mongodb', 'turso'] as const;

  // The four kinds are derived, not listed twice: if the spec table ever marks a
  // fifth driver `hasLocalDefault: false`, this assertion fails until the matrix
  // below covers it, so the "8 cells" stay 8 only while 8 is the truth.
  it('the no-local-default set is exactly what the shared table says', () => {
    const fromTable = BUILTIN_DRIVER_IDS.filter((id) => !driverHasLocalDefault(id));
    expect([...fromTable].sort()).toEqual([...NO_LOCAL_DEFAULT].sort());
  });

  it.each(NO_LOCAL_DEFAULT)(
    'cell A — `os start` refuses `%s` with no URL instead of guessing one',
    (kind) => {
      expect(() => resolveStorageDefinition(kind, { isDev: false })).toThrow(UnsupportedDriverError);
      // Dev is not an escape hatch: the dev path before commit e2798fab7 was the one that
      // silently produced a definition.
      expect(() => resolveStorageDefinition(kind, { isDev: true })).toThrow(UnsupportedDriverError);
    },
  );

  it.each(NO_LOCAL_DEFAULT)(
    'cell B — `os migrate` refuses `%s` with no URL instead of handing it a file: DSN',
    (kind) => {
      process.env.OS_DATABASE_DRIVER = kind;
      expect(() => resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' }))
        .toThrow(/no database URL was given/);
    },
  );

  // What the refusals must NOT do: swallow a URL the operator actually gave.
  it.each(NO_LOCAL_DEFAULT)('`%s` WITH a URL is still accepted on both sides', (kind) => {
    const url = URL_FOR[kind]!;
    expect(resolveStorageDefinition(kind, { databaseUrl: url, isDev: false })!.driverId).toBe(kind);
    process.env.OS_DATABASE_DRIVER = kind;
    process.env.OS_DATABASE_URL = url;
    expect(resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' }).driver).toBe(kind);
  });

  // Each refusal must name ITS OWN driver and target shape. A shared sentence
  // that pointed every operator at a libSQL endpoint would be worse than terse:
  // it sends a postgres operator looking for a knob that does not exist.
  it.each(NO_LOCAL_DEFAULT)('the `%s` refusal names that driver and a target it could have', (kind) => {
    let message = '';
    try {
      resolveStorageDefinition(kind, { isDev: false });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(`\`${kind}\``);
    expect(message).toContain('OS_DATABASE_URL');
    // The generic fallback clause must not be what an operator actually sees.
    expect(message).not.toContain('the URL of the database this driver connects to');
  });

  // The selectable local engines keep their defaults — the refusal must be
  // scoped to "no local default", not to "no URL". (`memory` was the third local
  // engine; it is no longer selectable, and its refusal is pinned above.)
  it.each(['sqlite', 'sqlite-wasm'] as const)('`%s` with no URL still resolves', (kind) => {
    expect(resolveStorageDefinition(kind, { isDev: false })!.driverId).toBe(kind);
  });
});

/**
 * The URL door: one verdict per `OS_DATABASE_URL`, on both hosts, in dev AND
 * production.
 *
 * The rows above vary the DRIVER spelling. These vary the URL with no driver
 * named, which is the question `inferDriverTypeFromUrl` (CLI host) and
 * `detectDriverFromUrl` (runtime host) both answer. Before this block the CLI
 * answered '' for every URL its regexes missed: `redis://…` booted `serve --dev`
 * on the SQLite `:memory:` default in silence and met the no-storage refusal in
 * production, while the runtime host refused the scheme by name; and `pg://…`
 * and a scheme-less path, which the runtime host accepts, got the same silent
 * `:memory:` from the CLI.
 *
 * An accepted row asserts the definition was built FROM THE URL
 * (`displayUrl === url`), not just that a driver id came back: the dev default
 * is a `sqlite` definition too, so a bare driver-id check would read `:memory:`
 * as an agreement about `./data/app`.
 */
describe('the OS_DATABASE_URL door: both hosts, one verdict per URL, dev and prod', () => {
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'OS_DATABASE_DRIVER', 'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_HOME',
  ];

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.OS_HOME = mkdtempSync(join(tmpdir(), 'os-url-door-parity-'));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
  });

  /** The CLI host's verdict for a URL with no driver named — serve.ts's own two calls. */
  function cliUrlVerdict(url: string, isDev: boolean):
    | { accepted: true; driverId: string; displayUrl: string | undefined }
    | { accepted: false; error: unknown } {
    try {
      const definition = resolveStorageDefinition(resolveDriverType(undefined, url), { databaseUrl: url, isDev });
      return definition
        ? { accepted: true, driverId: definition.driverId, displayUrl: definition.displayUrl }
        : { accepted: false, error: null };
    } catch (error) {
      return { accepted: false, error };
    }
  }

  /** The runtime host's verdict for the same URL, from `OS_DATABASE_URL`. */
  function runtimeUrlVerdict(url: string): { accepted: true; driverId: string } | { accepted: false; message: string } {
    process.env.OS_DATABASE_URL = url;
    try {
      return { accepted: true, driverId: resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' }).driver };
    } catch (err) {
      return { accepted: false, message: (err as Error).message };
    }
  }

  // Every spelling the runtime host's arms accept, each with the kind it means.
  // ⛔ The CLI never refuses one of these.
  it.each([
    ['postgres://u:p@localhost:5432/db', 'postgres'],
    ['postgresql://u:p@localhost:5432/db', 'postgres'],
    ['pg://u:p@localhost:5432/db', 'postgres'],
    ['PG://u:p@localhost:5432/db', 'postgres'],
    ['mysql://u:p@localhost:3306/db', 'mysql'],
    ['mysql2://u:p@localhost:3306/db', 'mysql'],
    ['mongodb://localhost:27017/db', 'mongodb'],
    ['mongodb+srv://cluster.example.net/db', 'mongodb'],
    ['libsql://my-db.turso.io', 'turso'],
    ['https://my-db.turso.io', 'turso'],
    ['wasm-sqlite://data.db', 'sqlite-wasm'],
    ['./local.wasm.db', 'sqlite-wasm'],
    ['file:./data/app.wasm.db', 'sqlite-wasm'],
    ['file:./data/app.db', 'sqlite'],
    ['sqlite:./data/app.db', 'sqlite'],
    [':memory:', 'sqlite'],
    ['./data/app.db', 'sqlite'],
    ['data/app.sqlite3', 'sqlite'],
    ['./data/app', 'sqlite'],
    ['/var/lib/objectstack/app', 'sqlite'],
  ])('both hosts ACCEPT %s as %s, and the CLI builds it from that URL in dev and prod', (url, kind) => {
    expect(runtimeUrlVerdict(url), `the runtime host refused ${url}`).toEqual({ accepted: true, driverId: kind });
    for (const isDev of [false, true]) {
      expect(cliUrlVerdict(url, isDev), `the CLI host (isDev=${isDev}) did not build ${url}`)
        .toEqual({ accepted: true, driverId: kind, displayUrl: url });
    }
  });

  // A `<scheme>://` neither host recognises: refused by both, the CLI's refusal
  // being the typed one serve.ts makes fatal, in dev as in production.
  it.each([
    ['redis://127.0.0.1:6399/0', 'redis://'],
    ['rediss://cache.example.com:6380', 'rediss://'],
    ['https://db.example.com/app', 'https://'],
    ['mssql://h/db', 'mssql://'],
    ['redis://h/app.db', 'redis://'],
  ])('both hosts REFUSE %s, in dev AND in prod', (url, scheme) => {
    const runtime = runtimeUrlVerdict(url);
    expect(runtime.accepted, `the runtime host accepted ${url}`).toBe(false);
    for (const isDev of [false, true]) {
      const cli = cliUrlVerdict(url, isDev);
      expect(cli.accepted, `the CLI host (isDev=${isDev}) accepted ${url}`).toBe(false);
      const error = (cli as { error: unknown }).error;
      expect(error, `the CLI host (isDev=${isDev}) did not refuse ${url} by type`).toBeInstanceOf(UnsupportedDriverError);
      expect((error as UnsupportedDriverError).recognized).toBe(false);
      expect((error as Error).message).toContain(`"${scheme}"`);
      expect((error as Error).message).toContain('OS_DATABASE_URL');
    }
  });

  // An OPAQUE scheme — two or more characters and a `:`, no `//`
  // (`jdbc:postgresql://…`, `redis:h`) — and any scheme a `*.wasm.db` file name
  // used to rescue. The CLI host refuses them, typed, in dev and prod. The
  // runtime host's answer is deliberately NOT pinned here: today it opens these
  // as a SQLite file at a path made of the URL, an implementation gap against
  // its own "unknown schemes throw" rule that is #23765's to close, so asserting
  // either agreement or its current answer would pin that gap.
  it.each([
    ['jdbc:postgresql://localhost:5432/db', 'jdbc:'],
    ['redis:cache', 'redis:'],
    ['redis://h/app.wasm.db', 'redis://'],
    ['jdbc:x/app.wasm.db', 'jdbc:'],
  ])('the CLI host REFUSES %s (scheme %s), in dev AND in prod', (url, scheme) => {
    for (const isDev of [false, true]) {
      const cli = cliUrlVerdict(url, isDev);
      expect(cli.accepted, `the CLI host (isDev=${isDev}) accepted ${url}`).toBe(false);
      const error = (cli as { error: unknown }).error;
      expect(error, `the CLI host (isDev=${isDev}) did not refuse ${url} by type`).toBeInstanceOf(UnsupportedDriverError);
      expect((error as UnsupportedDriverError).recognized).toBe(false);
      expect((error as Error).message).toContain(`"${scheme}"`);
      expect((error as Error).message).toContain('OS_DATABASE_URL');
    }
  });

  // `sqlite:` / `sqlite://` are aliases of `file:` on both hosts, and a `file:`
  // URL becomes a file name by ONE rule — the runtime host's
  // `normalizeDatabaseUrl` and `sqliteFilenameFromUrl`, both of which the CLI
  // host calls. Both hosts must name the same FILE: `sqlite://x.db` and
  // `file://x.db` used to open `//x.db` (the filesystem root) on the CLI host
  // while the runtime host opened `x.db`, and `FILE:./x.db` kept its upper-case
  // prefix as part of the file name on both, making a `FILE:.` directory. The
  // lower-case `file:` and bare-path rows are the CONTROL.
  it.each([
    ['sqlite://x.db', 'x.db', 'sqlite'],
    ['sqlite:x.db', 'x.db', 'sqlite'],
    ['sqlite:///var/lib/objectstack/x.db', '/var/lib/objectstack/x.db', 'sqlite'],
    ['sqlite://x.wasm.db', 'x.wasm.db', 'sqlite-wasm'],
    ['file://x.db', 'x.db', 'sqlite'],
    ['file:///var/lib/objectstack/x.db', '/var/lib/objectstack/x.db', 'sqlite'],
    ['file://x.wasm.db', 'x.wasm.db', 'sqlite-wasm'],
    ['FILE:./x.db', './x.db', 'sqlite'],
    ['File:///var/lib/objectstack/x.db', '/var/lib/objectstack/x.db', 'sqlite'],
    ['FILE:./x.wasm.db', './x.wasm.db', 'sqlite-wasm'],
    ['file:./x.db', './x.db', 'sqlite'],
    ['./x.db', './x.db', 'sqlite'],
  ])('both hosts open %s as the file %s (%s), in dev and prod', (url, file, kind) => {
    process.env.OS_DATABASE_URL = url;
    const runtime = resolveStandaloneDatabase({ artifactPath: '/nonexistent/objectstack.json' });
    expect(runtime.driver).toBe(kind);
    expect(runtime.sqliteFile, `the runtime host's file for ${url}`).toBe(file);
    for (const isDev of [false, true]) {
      const definition = resolveStorageDefinition(resolveDriverType(undefined, url), { databaseUrl: url, isDev });
      expect(definition!.driverId).toBe(kind);
      expect(definition!.config.filename, `the CLI host's file for ${url} (isDev=${isDev})`).toBe(runtime.sqliteFile);
    }
  });

  // What that rule refuses, both hosts refuse, with ONE sentence that names the
  // scheme and never the URL; the CLI host's refusal is typed, the class
  // serve.ts makes fatal (it swallows every other construction error). Two
  // inputs reach it: an explicit sqlite selection over a server URL, which the
  // CLI host used to open as a file at a path made of the URL, credentials
  // included, and a `file:` that names no file.
  it.each([
    ['sqlite', 'postgres://PLACEHOLDER-USER:PLACEHOLDER-SECRET@127.0.0.1:5432/db', 'its scheme is "postgres://"'],
    [undefined, 'file:', 'it names no file after "file:"'],
    [undefined, 'FILE:', 'it names no file after "file:"'],
  ])('both hosts REFUSE driver %s over %s, in dev AND in prod, with one sentence', (driver, url, why) => {
    if (driver) process.env.OS_DATABASE_DRIVER = driver;
    const runtime = runtimeUrlVerdict(url);
    expect(runtime.accepted, `the runtime host accepted ${url}`).toBe(false);
    const sentence = (runtime as { message: string }).message;
    expect(sentence).toContain(why);
    for (const isDev of [false, true]) {
      let error: unknown;
      try {
        resolveStorageDefinition(resolveDriverType(driver, url), { databaseUrl: url, isDev });
      } catch (err) {
        error = err;
      }
      expect(error, `the CLI host (isDev=${isDev}) did not refuse ${url} by type`).toBeInstanceOf(UnsupportedDriverError);
      expect((error as UnsupportedDriverError).recognized).toBe(true);
      expect((error as UnsupportedDriverError).driverType).toBe('sqlite');
      expect((error as Error).message).toBe(sentence);
      expect((error as Error).message).not.toContain('PLACEHOLDER');
    }
  });

  // CLI host only: under an explicit sqlite selection a blank URL is the absent
  // URL, `:memory:`, never a file named by whitespace — blank is absent, as this
  // host's URL inference reads it. The runtime host's absent URL is its default
  // file, a different answer for absence that this pin does not judge.
  it.each(['', '   '])('the CLI host reads the blank URL %j under an explicit sqlite selection as :memory:', (url) => {
    for (const isDev of [false, true]) {
      const definition = resolveStorageDefinition(resolveDriverType('sqlite', url), { databaseUrl: url, isDev });
      expect(definition!.driverId).toBe('sqlite');
      expect(definition!.config.filename).toBe(':memory:');
    }
  });
});
