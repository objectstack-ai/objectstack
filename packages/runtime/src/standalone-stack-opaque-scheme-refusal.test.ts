// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The standalone host refuses an OPAQUE scheme, and a `*.wasm.db` file name no
// longer rescues a scheme nothing recognises (#23765).
//
// The module header's rule is "Unknown URL schemes throw — we never silently
// fall back to sqlite". Two arms of `detectDriverFromUrl` broke it:
//
//   - the scheme-less arm read "no `<scheme>://`" as "a file path", so an
//     opaque scheme — two or more characters and a `:` with no `//`
//     (`jdbc:postgresql://…`, `redis:h`) — opened a SQLite file at a path made
//     of the URL: `OS_DATABASE_URL=jdbc:postgresql://127.0.0.1:5999/db` booted
//     "ready" on `./jdbc:postgresql:/127.0.0.1:5999/db`;
//   - the `.wasm.db` test ran ahead of every scheme check, so
//     `redis://h/x.wasm.db` opened a WASM SQLite file under `./redis:/h/`.
//
// The cases hold three things:
//
//   1. both shapes meet the refusal an unrecognised `<scheme>://` already met,
//      unchanged — same error class, same own properties, same words with only
//      the scheme differing — through every door the URL arrives by, and its
//      first sentence names the scheme;
//   2. the refusal names the scheme only: no own property of the thrown error
//      carries the placeholder username, password or token in the URL;
//   3. CONTROL: a single letter and a `:` is a Windows drive and stays a path,
//      and every file spelling resolves to the kind AND the file it did.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStandaloneDatabase } from './standalone-stack.js';

// Placeholders only: nothing here is, or looks like, a real secret.
const USER = 'PLACEHOLDER-USER';
const SECRET = 'PLACEHOLDER-SECRET';
const TOKEN = 'PLACEHOLDER-TOKEN';
/** A userinfo with a password, a host, a path and a token query. */
const CREDENTIALED_TAIL = `${USER}:${SECRET}@127.0.0.1:6399/0?authToken=${TOKEN}`;

/** Env keys these tests write; restored after every case. */
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
  root = mkdtempSync(join(tmpdir(), 'os-opaque-scheme-refusal-'));
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

/** The error `run` throws; fails the case when it throws nothing. */
function refusalOf(run: () => unknown): Error {
  try {
    run();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal, but the URL resolved');
}

/** A compiled artifact whose declared default datasource carries `url`. */
function artifactDeclaring(url: string): string {
  const artifactPath = join(root, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify({
    datasources: [{ name: 'primary', driver: 'postgres', config: { url } }],
    datasourceMapping: [{ default: true, datasource: 'primary' }],
  }));
  return artifactPath;
}

/** The three doors a database URL reaches this host by. */
const DOORS: ReadonlyArray<readonly [door: string, run: (url: string) => unknown]> = [
  ['the databaseUrl option (--database)', (url) => resolveStandaloneDatabase({ databaseUrl: url })],
  ['OS_DATABASE_URL', (url) => {
    process.env.OS_DATABASE_URL = url;
    return resolveStandaloneDatabase({ projectRoot: root });
  }],
  ['a declared default datasource', (url) =>
    resolveStandaloneDatabase({ projectRoot: root, artifactPath: artifactDeclaring(url) })],
];

/**
 * The refusal an unrecognised `<scheme>://` has always met, as the reference
 * the widened refusal is compared against — so the comparison pins sameness,
 * never the prose.
 */
const REFERENCE_SCHEME = 'wat://';
function referenceRefusal(): Error {
  return refusalOf(() => resolveStandaloneDatabase({ databaseUrl: `${REFERENCE_SCHEME}nope` }));
}

/** The unsupported-scheme refusal, unchanged, naming `scheme` and nothing of the URL. */
function expectUnsupportedSchemeRefusal(err: Error, scheme: string): void {
  const reference = referenceRefusal();
  // 1. The same refusal: class, own properties (a `code`, were one ever
  //    added, included) and words, with only the scheme differing.
  expect(err.constructor).toBe(Error);
  expect(err.constructor).toBe(reference.constructor);
  expect(Object.getOwnPropertyNames(err).sort()).toEqual(Object.getOwnPropertyNames(reference).sort());
  expect((err as { code?: unknown }).code).toBe((reference as { code?: unknown }).code);
  expect(err.cause).toBeUndefined();
  expect(err.message.startsWith(`[StandaloneStack] Unsupported database URL scheme "${scheme}". `),
    `the first sentence does not name "${scheme}": ${err.message}`).toBe(true);
  expect(err.message.replace(`"${scheme}"`, '"SCHEME"'))
    .toBe(reference.message.replace(`"${REFERENCE_SCHEME}"`, '"SCHEME"'));
  // 2. The scheme only. Positive control first: the serialisation really
  //    holds the message, so the negative reads below read something.
  const everything = JSON.stringify(err, Object.getOwnPropertyNames(err));
  expect(everything).toContain(JSON.stringify(err.message));
  for (const placeholder of [USER, SECRET, TOKEN]) {
    expect(everything, `the refusal carries ${placeholder}`).not.toContain(placeholder);
  }
}

describe('an OPAQUE scheme is refused, naming the scheme, never the URL', () => {
  // Two or more characters and a `:` with no `//`. The scheme ends at the
  // FIRST `:`, so it cannot hold a userinfo, a host or a path.
  const OPAQUE: ReadonlyArray<readonly [url: string, scheme: string]> = [
    // The card's reproduction, and the same shape carrying credentials.
    ['jdbc:postgresql://127.0.0.1:5999/db', 'jdbc:'],
    [`jdbc:postgresql://${CREDENTIALED_TAIL}`, 'jdbc:'],
    ['redis:h', 'redis:'],
    [`redis:${CREDENTIALED_TAIL}`, 'redis:'],
    // A scheme this host recognises is opaque too when its `//` is missing:
    // it is not a file path either.
    ['libsql:db.example.turso.io', 'libsql:'],
    // A file name whose FIRST segment holds a colon reads as a scheme, as on
    // the CLI host; `./backup:2026.db` and `file:backup:2026.db` name that
    // file (CONTROL below).
    ['backup:2026.db', 'backup:'],
  ];

  for (const [door, run] of DOORS) {
    it.each(OPAQUE)(`%s via ${door} → refused as %s`, (url, scheme) => {
      expectUnsupportedSchemeRefusal(refusalOf(() => run(url)), scheme);
    });
  }
});

describe('a `*.wasm.db` file name no longer rescues a scheme nothing recognises', () => {
  // It selects the WASM engine for a FILE only: a `file:` URL or a value with
  // no scheme (the CONTROL below).
  const RESCUED: ReadonlyArray<readonly [url: string, scheme: string]> = [
    ['redis://h/x.wasm.db', 'redis://'],
    // The URL must END in `.wasm.db` for the old test to have rescued it, so
    // the token rides in the path here, not in a trailing query.
    [`redis://${USER}:${SECRET}@127.0.0.1:6399/${TOKEN}/x.wasm.db`, 'redis://'],
    ['https://example.com/app.wasm.db', 'https://'],
    ['jdbc:x/app.wasm.db', 'jdbc:'],
  ];

  for (const [door, run] of DOORS) {
    it.each(RESCUED)(`%s via ${door} → refused as %s`, (url, scheme) => {
      expectUnsupportedSchemeRefusal(refusalOf(() => run(url)), scheme);
    });
  }
});

describe('CONTROL: a drive letter, a file: URL and a plain path open the file they did', () => {
  it.each([
    // A single letter and a `:` is a Windows drive, not a scheme.
    ['C:\\data\\x.db', 'sqlite', 'C:\\data\\x.db'],
    ['C:/data/x.db', 'sqlite', 'C:/data/x.db'],
    ['c:\\data\\x.wasm.db', 'sqlite-wasm', 'c:\\data\\x.wasm.db'],
    ['file:./x.db', 'sqlite', './x.db'],
    ['sqlite:./x.db', 'sqlite', './x.db'],
    ['./x.db', 'sqlite', './x.db'],
    ['./x.wasm.db', 'sqlite-wasm', './x.wasm.db'],
    ['file:./x.wasm.db', 'sqlite-wasm', './x.wasm.db'],
    ['wasm-sqlite:///tmp/x.db', 'sqlite-wasm', '/tmp/x.db'],
    ['data/app', 'sqlite', 'data/app'],
    // A `:` past the first path segment is not a scheme either, and `file:`
    // names a file whose own name holds one.
    ['./data/app:v2.db', 'sqlite', './data/app:v2.db'],
    ['./backup:2026.db', 'sqlite', './backup:2026.db'],
    ['file:backup:2026.db', 'sqlite', 'backup:2026.db'],
    [':memory:', 'sqlite', null],
  ])('%s → %s, file %s', (url, driver, file) => {
    const resolved = resolveStandaloneDatabase({ databaseUrl: url });
    expect(resolved.driver).toBe(driver);
    expect(resolved.sqliteFile).toBe(file);
  });

  it.each(['postgres', 'mysql', 'mongodb'])(
    'a credential-bearing %s:// URL still resolves, credential intact',
    (scheme) => {
      const url = `${scheme}://${CREDENTIALED_TAIL}`;
      expect(resolveStandaloneDatabase({ databaseUrl: url }).url).toBe(url);
    },
  );
});
