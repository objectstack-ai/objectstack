// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The standalone host refuses a SQLite `default` whose directory cannot be
// made — at once, naming the database file, the directory and the operating
// system's code (#23737).
//
// ## The defect, measured on `origin/main` 43567a8fcb
//
// `createStandaloneStack({ databaseUrl: 'file:/proc/os-23737/ctl.db' })` never
// returned. Its `sqlite` arm (and the `sqlite-wasm` arm, reached through
// `wasm-sqlite://` or `OS_DATABASE_DRIVER=sqlite-wasm`) prepared the directory
// with Node's recursive `mkdirSync`, which loops `mkdir("/proc/os-23737") =
// ENOENT`, `mkdir("/proc") = EEXIST`, retry, without end: 19,640 failing calls
// in 10 s under `strace`. At the public door, `os start` with that URL printed
// "Starting server..." and hung until killed. The SQL driver's own bounded
// refusal (#23696) was never reached, because the host looped first.
//
// ## Why the `/proc` cases run in a child process
//
// The loop was SYNCHRONOUS: it holds the event loop, so no timer fires, and a
// vitest test timeout cannot end it either. A regression to it would hang this
// worker rather than fail. So those cases run `createStandaloneStack` from
// source in a `node --import tsx` child, bounded by `spawnSync`'s timeout with
// SIGKILL: a reintroduced loop fails here at the bound, it never hangs the run.
// They need a `/proc` that refuses `mkdir` with ENOENT, so they run where
// `/proc/self` exists (Linux, which CI is).
//
// ## What is asserted
//
//   1. The `/proc` shape, both arms: the child settles inside the bound, and the
//      refusal carries the code `ENOENT` and names the file and the directory.
//   2. A path through a regular file (`ENOTDIR`), and a file holding the
//      directory's own name (`EEXIST`): refused, naming the file. In-process —
//      the operating system answers these at once whatever the walk.
//   3. CONTROL: a creatable path three levels deep is made, in both arms.
//   4. CONTROL: the read-only boot (`sqliteAbsentFile: 'empty-in-memory'`, #6743)
//      over an absent file still makes no directory at all.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStandaloneStack } from './standalone-stack.js';

// Pay the first transform of what `createStandaloneStack` imports lazily at
// MODULE LOAD, never inside a clocked `it()` body: clocked windows measure
// behaviour, never loading (`scripts/check-test-source-alias.mjs`, the
// clocked-window rule).
import '@objectstack/service-datasource';
import '@objectstack/objectql';
import '@objectstack/metadata';
import './default-datasource-plugin.js';
import './app-plugin.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const SUBJECT = pathToFileURL(resolve(HERE, 'standalone-stack.ts')).href;

/**
 * The child's whole budget. Measured: about 5 s for a cold tsx child that runs
 * both arms on this container; the loop it guards against never ends.
 */
const CHILD_BOUND_MS = 30_000;

/** Env keys these tests write or that could pick another arm; restored after every case. */
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
  root = mkdtempSync(join(tmpdir(), 'os-23737-'));
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

interface Refusal {
  name?: string;
  code?: string;
  filename?: string;
  directory?: string;
  message: string;
}

/** The rejection of `pending`; fails the case when it resolves. */
async function refusalOf(pending: Promise<unknown>): Promise<Refusal> {
  try {
    await pending;
  } catch (err) {
    return err as Refusal;
  }
  throw new Error('expected a refusal, but createStandaloneStack returned');
}

/** The refusal names the file and the directory, and carries the OS code. */
function expectNamedRefusal(refusal: Refusal, filename: string, directory: string, code: string): void {
  expect(refusal.code).toBe(code);
  expect(refusal.message).toContain(`'${filename}'`);
  expect(refusal.message).toContain(`'${directory}'`);
}

/**
 * Runs `createStandaloneStack` from source once per URL in one child, and
 * returns each outcome. The child's environment is declared, not inherited.
 */
function runBoundedChild(urls: string[]): Array<{ url: string; outcome: string } & Partial<Refusal>> {
  const script = [
    'const [subject, ...urls] = process.argv.slice(1);',
    'const { createStandaloneStack } = await import(subject);',
    'const out = [];',
    'for (const url of urls) {',
    '  try { await createStandaloneStack({ databaseUrl: url }); out.push({ url, outcome: "returned" }); }',
    '  catch (e) { out.push({ url, outcome: "rejected", name: e?.name, code: e?.code, message: String(e?.message) }); }',
    '}',
    'process.stdout.write("\\nSTACK-OUTCOMES " + JSON.stringify(out) + "\\n");',
  ].join('\n');
  const t0 = Date.now();
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, SUBJECT, ...urls],
    {
      cwd: PKG_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        OS_HOME: root,
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      },
      encoding: 'utf8',
      timeout: CHILD_BOUND_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (child.signal) {
    throw new Error(
      `createStandaloneStack had not settled after ${Date.now() - t0} ms (child killed by ${child.signal}) — ` +
        `the directory prep is looping again. stderr tail: ${String(child.stderr).slice(-2000)}`,
    );
  }
  const line = String(child.stdout).split('\n').find((l) => l.startsWith('STACK-OUTCOMES '));
  if (!line) {
    throw new Error(`child exited ${child.status} without a result. stderr tail: ${String(child.stderr).slice(-2000)}`);
  }
  return JSON.parse(line.slice('STACK-OUTCOMES '.length));
}

describe('createStandaloneStack — a SQLite directory the host cannot make (#23737)', () => {
  it.runIf(existsSync('/proc/self'))(
    'refuses /proc/<missing>/ at once in both SQLite arms — the shape that looped',
    () => {
      const filename = `/proc/os-23737-${process.pid}/a/ctl.db`;
      const directory = `/proc/os-23737-${process.pid}/a`;
      const outcomes = runBoundedChild([`file:${filename}`, `wasm-sqlite://${filename}`]);
      expect(outcomes.map((o) => o.outcome)).toEqual(['rejected', 'rejected']);
      for (const outcome of outcomes) {
        expectNamedRefusal(outcome as Refusal, filename, directory, 'ENOENT');
      }
    },
    CHILD_BOUND_MS + 15_000,
  );

  it('refuses a path through a regular file (ENOTDIR) and a file holding the directory name (EEXIST)', async () => {
    writeFileSync(join(root, 'plain'), '');

    const through = join(root, 'plain', 'sub', 'ctl.db');
    expectNamedRefusal(
      await refusalOf(createStandaloneStack({ databaseUrl: `file:${through}` })),
      through,
      join(root, 'plain', 'sub'),
      'ENOTDIR',
    );

    const at = join(root, 'plain', 'ctl.db');
    expectNamedRefusal(
      await refusalOf(createStandaloneStack({ databaseUrl: `wasm-sqlite://${at}` })),
      at,
      join(root, 'plain'),
      'EEXIST',
    );
  });

  it('CONTROL: a creatable path three levels deep is made, in both arms', async () => {
    const native = join(root, 'n', 'a', 'b', 'ctl.db');
    await createStandaloneStack({ databaseUrl: `file:${native}` });
    expect(statSync(dirname(native)).isDirectory()).toBe(true);

    const wasm = join(root, 'w', 'a', 'b', 'ctl.db');
    await createStandaloneStack({ databaseUrl: `wasm-sqlite://${wasm}` });
    expect(statSync(dirname(wasm)).isDirectory()).toBe(true);
  });

  it('CONTROL: the read-only boot over an absent file still makes no directory (#6743)', async () => {
    const filename = join(root, 'ro', 'a', 'ctl.db');
    await createStandaloneStack({ databaseUrl: `file:${filename}`, sqliteAbsentFile: 'empty-in-memory' });
    expect(existsSync(join(root, 'ro'))).toBe(false);
  });
});
