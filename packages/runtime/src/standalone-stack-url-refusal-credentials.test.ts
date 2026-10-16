// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The standalone host's URL refusals name the URL's SCHEME, never the URL.
//
// A database URL is where postgres / mysql / mongodb credentials ride
// (`user:password@host`, `?authToken=…`), and each refusal below leaves the
// process as an error message that the CLI prints to the console and a
// deployment's boot log keeps. Every one of them used to interpolate the whole
// URL, so a password in `OS_DATABASE_URL` reached the log whenever the URL was
// refused. The cases drive each refusal with a placeholder-credential URL and
// hold three things:
//
//   1. the refusal still happens where it did, as a plain `Error`, and still
//      tells the operator what to do (the scheme, the supported list or the
//      remedy);
//   2. no own property of the thrown error (message, stack, anything else)
//      carries the username, the password or the query token;
//   3. CONTROL: every scheme the host supports still resolves to the same
//      driver kind, and a credential-bearing URL that RESOLVES keeps its
//      credential in `url`. The redaction belongs to the message, never to
//      the connection.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStandaloneDatabase } from './standalone-stack.js';

// Placeholders only: nothing here is, or looks like, a real secret.
const USER = 'PLACEHOLDER-USER';
const SECRET = 'PLACEHOLDER-SECRET';
const TOKEN = 'PLACEHOLDER-TOKEN';
/** Everything after `<scheme>://`: a userinfo with a password, a host, a path and a token query. */
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
  root = mkdtempSync(join(tmpdir(), 'os-url-refusal-credentials-'));
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

/** Same refusal class as before the change, and no credential anywhere on it. */
function expectRefusedWithoutCredentials(err: Error): void {
  expect(err.constructor).toBe(Error);
  expect(err.cause).toBeUndefined();
  const everything = JSON.stringify(err, Object.getOwnPropertyNames(err));
  // Positive control: the serialisation really holds the message, so the
  // negative reads below read something.
  expect(everything).toContain(JSON.stringify(err.message));
  for (const placeholder of [USER, SECRET, TOKEN]) {
    expect(everything, `the refusal carries ${placeholder}`).not.toContain(placeholder);
  }
}

/** A compiled artifact whose declared default datasource carries `url`. */
function artifactDeclaring(driver: string, url: string): string {
  const artifactPath = join(root, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify({
    datasources: [{ name: 'primary', driver, config: { url } }],
    datasourceMapping: [{ default: true, datasource: 'primary' }],
  }));
  return artifactPath;
}

describe('the unsupported-scheme refusal names the scheme, never the URL', () => {
  const url = `redis://${CREDENTIALED_TAIL}`;

  it.each([
    ['the databaseUrl option (--database)', () => resolveStandaloneDatabase({ databaseUrl: url })],
    ['OS_DATABASE_URL', () => {
      process.env.OS_DATABASE_URL = url;
      return resolveStandaloneDatabase({ projectRoot: root });
    }],
    ['a declared default datasource', () =>
      resolveStandaloneDatabase({ projectRoot: root, artifactPath: artifactDeclaring('redis', url) })],
  ])('via %s', (_door, run) => {
    const err = refusalOf(run);
    expect(err.message).toContain('Unsupported database URL scheme "redis://"');
    // Still actionable: the supported list is intact.
    expect(err.message).toContain('postgres://');
    expect(err.message).toContain('libsql://');
    expectRefusedWithoutCredentials(err);
  });

  it('a plain https:// URL (not a Turso host) is refused the same way', () => {
    const err = refusalOf(() => resolveStandaloneDatabase({ databaseUrl: `https://${CREDENTIALED_TAIL}` }));
    expect(err.message).toContain('Unsupported database URL scheme "https://"');
    expectRefusedWithoutCredentials(err);
  });
});

describe('the retired in-memory engine refusal names the scheme, never the URL', () => {
  it.each([
    ['memory://', 'the databaseUrl option', (u: string) => resolveStandaloneDatabase({ databaseUrl: u }), 'A database URL with the'],
    ['mingo://', 'the databaseUrl option', (u: string) => resolveStandaloneDatabase({ databaseUrl: u }), 'A database URL with the'],
    ['memory://', 'OS_DATABASE_URL', (u: string) => {
      process.env.OS_DATABASE_URL = u;
      return resolveStandaloneDatabase({ projectRoot: root });
    }, 'An OS_DATABASE_URL with the'],
  ])('%s via %s', (scheme, _door, run, opening) => {
    const err = refusalOf(() => run(`${scheme}${CREDENTIALED_TAIL}`));
    expect(err.message).toContain(`${opening} "${scheme}" scheme selects the in-memory (mingo) engine`);
    // Still actionable: the two SQLite replacements.
    expect(err.message).toContain('--fresh');
    expect(err.message).toContain(':memory:');
    expectRefusedWithoutCredentials(err);
  });

  it('via a declared datasource whose url names the engine', () => {
    const err = refusalOf(() => resolveStandaloneDatabase({
      projectRoot: root,
      artifactPath: artifactDeclaring('postgres', `memory://${CREDENTIALED_TAIL}`),
    }));
    expect(err.message).toContain('"primary"');
    expect(err.message).toContain('URL scheme "memory://"');
    expectRefusedWithoutCredentials(err);
  });
});

describe('the sqlite non-path refusal names the scheme, never the URL', () => {
  it.each([
    ['the databaseDriver option', () =>
      resolveStandaloneDatabase({ databaseDriver: 'sqlite', databaseUrl: `postgres://${CREDENTIALED_TAIL}` })],
    ['OS_DATABASE_DRIVER', () => {
      process.env.OS_DATABASE_DRIVER = 'sqlite';
      return resolveStandaloneDatabase({ databaseUrl: `postgres://${CREDENTIALED_TAIL}` });
    }],
  ])('an explicit sqlite selection over a server URL, via %s', (_door, run) => {
    const err = refusalOf(run);
    expect(err.message).toContain('sqlite driver was selected but the URL does not look like a file path');
    expect(err.message).toContain('its scheme is "postgres://"');
    expect(err.message).toContain('file:/path/to/db.sqlite');
    expectRefusedWithoutCredentials(err);
  });

  it('a file: URL that names no file is still refused, saying so', () => {
    const err = refusalOf(() => resolveStandaloneDatabase({ databaseUrl: 'file:' }));
    expect(err.message).toContain('it names no file after "file:"');
    expect(err.constructor).toBe(Error);
  });
});

describe('CONTROL: what resolves is unchanged, credentials included', () => {
  // Every arm of the URL detection, as it classified before the change.
  it.each([
    ['postgres://h/db', 'postgres'],
    ['postgresql://h/db', 'postgres'],
    ['pg://h/db', 'postgres'],
    ['mysql://h/db', 'mysql'],
    ['mysql2://h/db', 'mysql'],
    ['mongodb://h/db', 'mongodb'],
    ['mongodb+srv://h/db', 'mongodb'],
    ['libsql://my-db.turso.io', 'turso'],
    ['https://my-db.turso.io', 'turso'],
    ['wasm-sqlite:///tmp/app.db', 'sqlite-wasm'],
    ['/tmp/app.wasm.db', 'sqlite-wasm'],
    ['file:/tmp/app.db', 'sqlite'],
    ['sqlite:///tmp/app.db', 'sqlite'],
    ['/tmp/app.db', 'sqlite'],
    ['data/app', 'sqlite'],
    [':memory:', 'sqlite'],
  ])('%s → %s', (url, driver) => {
    expect(resolveStandaloneDatabase({ databaseUrl: url }).driver).toBe(driver);
  });

  it.each(['postgres', 'mysql', 'mongodb'])(
    'a credential-bearing %s URL resolves with its credential intact (the driver needs it)',
    (scheme) => {
      const url = `${scheme}://${CREDENTIALED_TAIL}`;
      expect(resolveStandaloneDatabase({ databaseUrl: url }).url).toBe(url);
    },
  );
});
