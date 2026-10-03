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

  it('`mongo` and `mongodb` both select the renamed canonical id on both hosts', () => {
    const url = URL_FOR.mongodb!;
    for (const spelling of ['mongo', 'mongodb']) {
      expect(cliVerdict(spelling, url)).toEqual({ accepted: true, driverId: 'mongodb' });
      expect(standaloneVerdict(spelling, url)).toEqual({ accepted: true, driverId: 'mongodb' });
    }
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
