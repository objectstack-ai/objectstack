// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Under an explicit `sqlite` or `sqlite-wasm` selection, the standalone host
// refuses a database URL that is not a file path. The refusal names the
// selected kind and the URL's scheme, never the URL, and the boot stops before
// it makes a directory.
//
// ## The defect, measured on `origin/main` 34b740f2d1
//
// An explicit selection (`databaseDriver`, `OS_DATABASE_DRIVER`) skips the URL
// classification, so the only check a value meets is `sqliteFilenameFromUrl`.
// That rule refused only a `SCHEME://` URL, and only for the `sqlite` kind:
//
//   - `OS_DATABASE_DRIVER=sqlite OS_DATABASE_URL=jdbc:postgresql://127.0.0.1:5999/db
//     os serve --dev` booted ready on a SQLite file and created the directories
//     `./jdbc:postgresql:/127.0.0.1:5999/`;
//   - `OS_DATABASE_DRIVER=sqlite-wasm` beside a `postgres://USER:SECRET@…` URL
//     created `./postgres:/USER:SECRET@127.0.0.1:5999/`, the credentials in a
//     directory name.
//
// ## What is asserted
//
//   1. Both kinds, through both selection doors: an OPAQUE scheme (two or more
//      characters and a `:` with no `//`), an unrecognised `SCHEME://` and a
//      server URL are refused with one sentence that names the kind and the
//      scheme, and no own property of the error carries a credential.
//   2. The boot (`createStandaloneStack`) is refused before it makes anything.
//   3. CONTROL: every file value resolves to the file it named before.
//   4. The one file name that changes answer: `backup:2026.db` reads as the
//      scheme `backup:` and is refused, as it is on the classification path;
//      `./backup:2026.db` and `file:backup:2026.db` still name that file.
//   5. The boundary: the declared-datasource and `TURSO_DATABASE_URL` rungs hand
//      the rule their URL without `normalizeDatabaseUrl`, so there a `sqlite:`
//      alias is refused as a scheme rather than opened as a file of that name.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandaloneStack, resolveStandaloneDatabase, sqliteFilenameFromUrl } from './standalone-stack.js';

// Pay the first transform of what `createStandaloneStack` imports lazily at
// MODULE LOAD, never inside a clocked `it()` body: clocked windows measure
// behaviour, never loading (`scripts/check-test-source-alias.mjs`).
import '@objectstack/service-datasource';
import '@objectstack/objectql';
import '@objectstack/metadata';
import './default-datasource-plugin.js';
import './app-plugin.js';

// Placeholders only: nothing here is, or looks like, a real secret.
const USER = 'PLACEHOLDER-USER';
const SECRET = 'PLACEHOLDER-SECRET';
const TOKEN = 'PLACEHOLDER-TOKEN';
/** A userinfo with a password, a host, a path and a token query. */
const CREDENTIALED_TAIL = `${USER}:${SECRET}@127.0.0.1:5999/db?authToken=${TOKEN}`;

const KINDS = ['sqlite', 'sqlite-wasm'] as const;
type SqliteKind = (typeof KINDS)[number];

/** Env keys these tests write or that could answer first; restored after every case. */
const ENV_KEYS = [
  'OS_DATABASE_URL',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'OS_DATABASE_DRIVER',
  'OS_HOME',
  'OS_ARTIFACT_PATH',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
);

let root: string;
beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  root = mkdtempSync(join(tmpdir(), 'os-explicit-sqlite-non-file-'));
  // Every rung that could answer before the one under test points at this
  // empty directory, so no developer state leaks into a case.
  process.env.OS_HOME = root;
});
afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

/** The two selection doors, each with the URL from its own door. */
const DOORS = {
  'the databaseDriver and databaseUrl options': (kind: SqliteKind, url: string) =>
    resolveStandaloneDatabase({ databaseDriver: kind, databaseUrl: url, artifactPath: join(root, 'none.json') }),
  'OS_DATABASE_DRIVER and OS_DATABASE_URL': (kind: SqliteKind, url: string) => {
    process.env.OS_DATABASE_DRIVER = kind;
    process.env.OS_DATABASE_URL = url;
    return resolveStandaloneDatabase({ artifactPath: join(root, 'none.json') });
  },
} as const;

/** The error `run` throws; fails the case when it throws nothing. */
function refusalOf(run: () => unknown): Error {
  try {
    run();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal, but the URL resolved');
}

/** The rule's refusal: a plain `Error` naming the kind and the scheme, and no credential anywhere on it. */
function expectSchemeRefusal(err: Error, kind: SqliteKind, scheme: string): void {
  expect(err.constructor).toBe(Error);
  expect(err.message).toContain(`[StandaloneStack] ${kind} driver was selected but the URL does not look like a file path`);
  expect(err.message).toContain(`its scheme is "${scheme}"`);
  const everything = JSON.stringify(err, Object.getOwnPropertyNames(err));
  // Positive control: the serialisation really holds the message, so the
  // negative reads below read something.
  expect(everything).toContain(JSON.stringify(err.message));
  for (const placeholder of [USER, SECRET, TOKEN]) {
    expect(everything, `the refusal carries ${placeholder}`).not.toContain(placeholder);
  }
}

/** A compiled artifact whose declared default datasource carries `url` under a server driver. */
function artifactDeclaring(url: string): string {
  const artifactPath = join(root, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify({
    datasources: [{ name: 'primary', driver: 'postgres', config: { url } }],
    datasourceMapping: [{ default: true, datasource: 'primary' }],
  }));
  return artifactPath;
}

/** Every value the rule refuses under both kinds, with the scheme the refusal names. */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['jdbc:postgresql://127.0.0.1:5999/db', 'jdbc:'],
  [`jdbc:postgresql://${CREDENTIALED_TAIL}`, 'jdbc:'],
  ['redis:h', 'redis:'],
  [`redis:${CREDENTIALED_TAIL}`, 'redis:'],
  ['redis://h/x.db', 'redis://'],
  [`postgres://${CREDENTIALED_TAIL}`, 'postgres://'],
  [`postgres://${USER}:${SECRET}@127.0.0.1:5999/db`, 'postgres://'],
];

describe('an explicit sqlite / sqlite-wasm selection refuses a URL that is not a file path', () => {
  for (const [door, run] of Object.entries(DOORS)) {
    describe(`via ${door}`, () => {
      it.each(KINDS.flatMap((kind) => REFUSED.map(([url, scheme]) => [kind, url, scheme] as const)))(
        '%s refuses %s, naming the scheme %s only',
        (kind, url, scheme) => {
          expectSchemeRefusal(refusalOf(() => run(kind, url)), kind, scheme);
        },
      );
    });
  }

  it.each(KINDS)('the exported rule itself refuses the same values for %s', (kind) => {
    for (const [url, scheme] of REFUSED) {
      expectSchemeRefusal(refusalOf(() => sqliteFilenameFromUrl(url, kind)), kind, scheme);
    }
  });
});

describe('the boot is refused before it makes a directory', () => {
  // The two door values the defect was measured with, each under its kind. The
  // URL is relative, so the bogus directory would land in the cwd: the case
  // runs in an empty one and reads it back.
  it.each([
    ['sqlite', 'jdbc:postgresql://127.0.0.1:5999/db', 'jdbc:'],
    ['sqlite-wasm', `postgres://${USER}:${SECRET}@127.0.0.1:5999/db`, 'postgres://'],
  ] as const)('%s over %s', async (kind, url, scheme) => {
    const cwd = process.cwd();
    const work = mkdtempSync(join(tmpdir(), 'os-explicit-sqlite-boot-'));
    process.chdir(work);
    try {
      let err: unknown;
      try {
        await createStandaloneStack({ databaseDriver: kind, databaseUrl: url, artifactPath: join(work, 'none.json') });
      } catch (e) {
        err = e;
      }
      expect(err, 'the boot accepted a URL that is not a file path').toBeInstanceOf(Error);
      expectSchemeRefusal(err as Error, kind, scheme);
      expect(readdirSync(work)).toEqual([]);
    } finally {
      process.chdir(cwd);
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('CONTROL: a file value names the file it named before', () => {
  // `null` is resolveStandaloneDatabase's answer for an in-memory database.
  const FILES: ReadonlyArray<readonly [string, string | null]> = [
    ['file:./x.db', './x.db'],
    ['./x.db', './x.db'],
    ['C:\\data\\x.db', 'C:\\data\\x.db'],
    ['C:/data/x.db', 'C:/data/x.db'],
    [':memory:', null],
    // A `file:` prefix the rule strips leaves a file name, colons and all.
    ['file:backup:2026.db', 'backup:2026.db'],
    ['./backup:2026.db', './backup:2026.db'],
    // Normalized by these doors (`sqlite:` is an alias of `file:`).
    ['sqlite:./x.db', './x.db'],
    ['sqlite:///var/lib/objectstack/x.db', '/var/lib/objectstack/x.db'],
  ];

  for (const [door, run] of Object.entries(DOORS)) {
    it.each(KINDS.flatMap((kind) => FILES.map(([url, file]) => [kind, url, file] as const)))(
      `via ${door}: %s opens %s as %s`,
      (kind, url, file) => {
        const resolved = run(kind, url);
        expect(resolved.driver).toBe(kind);
        expect(resolved.sqliteFile).toBe(file);
      },
    );
  }

  it('via the databaseUrl option: sqlite-wasm opens wasm-sqlite:///tmp/x.db as /tmp/x.db', () => {
    const resolved = DOORS['the databaseDriver and databaseUrl options']('sqlite-wasm', 'wasm-sqlite:///tmp/x.db');
    expect(resolved.sqliteFile).toBe('/tmp/x.db');
  });

  it.each([
    ['', ':memory:'],
    ['wasm-sqlite://', ':memory:'],
    [':memory:', ':memory:'],
  ])('the exported rule: sqlite-wasm reads %j as %s', (url, file) => {
    expect(sqliteFilenameFromUrl(url, 'sqlite-wasm')).toBe(file);
  });
});

describe('the one file name that changes answer: a first segment holding a colon', () => {
  it.each(KINDS)('%s refuses backup:2026.db as the scheme "backup:", and names the file when written ./ or file:', (kind) => {
    for (const run of Object.values(DOORS)) {
      expectSchemeRefusal(refusalOf(() => run(kind, 'backup:2026.db')), kind, 'backup:');
      expect(run(kind, './backup:2026.db').sqliteFile).toBe('./backup:2026.db');
      expect(run(kind, 'file:backup:2026.db').sqliteFile).toBe('backup:2026.db');
    }
  });
});

describe('the boundary: rungs that do not normalize the URL', () => {
  // `resolveProjectDatabaseUrl` applies `normalizeDatabaseUrl` (`sqlite:` and
  // `sqlite://` become `file:`) on the explicit and OS_DATABASE_URL rungs only.
  // A declared datasource's `url` and `TURSO_DATABASE_URL` reach the rule as
  // written, so there the alias is a scheme: refused, where it used to open a
  // file named `sqlite:./x.db` (and, on the WASM kind, `sqlite:///…`).
  it.each(KINDS.flatMap((kind) => [
    [kind, 'sqlite:./x.db', 'sqlite:'],
    [kind, 'sqlite:///var/lib/objectstack/x.db', 'sqlite://'],
  ] as const))('%s refuses the declared datasource url %s as the scheme %s', (kind, url, scheme) => {
    const err = refusalOf(() =>
      resolveStandaloneDatabase({ databaseDriver: kind, projectRoot: root, artifactPath: artifactDeclaring(url) }));
    expectSchemeRefusal(err, kind, scheme);
  });

  it.each(KINDS)('%s refuses TURSO_DATABASE_URL=sqlite:./x.db as the scheme "sqlite:"', (kind) => {
    process.env.TURSO_DATABASE_URL = 'sqlite:./x.db';
    const err = refusalOf(() => resolveStandaloneDatabase({ databaseDriver: kind, artifactPath: join(root, 'none.json') }));
    expectSchemeRefusal(err, kind, 'sqlite:');
  });
});
