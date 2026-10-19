// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os dev` refuses a unified-default database directory it cannot make — at
// once, naming the database file, the directory and the operating system's
// code — instead of looping in Node's recursive mkdir (#23737).
//
// ## The defect, measured on `origin/main` 43567a8fcb
//
// `os dev` prepared `<state dir>/data/` for its unified-default SQLite file with
// `fs.mkdirSync(dir, { recursive: true })`. Under `OS_HOME=/proc/os-23737` that
// call looped `mkdir("/proc/os-23737") = ENOENT`, `mkdir("/proc") = EEXIST`,
// retry, in the `os dev` process itself: 64,440 failing calls in 25 s under
// `strace`, and the command never reached its next line.
//
// ## Why every case runs in ONE bounded child process
//
// The loop was SYNCHRONOUS: it holds the event loop, so no timer fires and a
// vitest timeout cannot end it. A regression to it would hang this worker
// rather than fail, so `prepareDevDatabaseDirectory` (the function `os dev`'s
// boot awaits) runs from source in a `node --import tsx` child bounded by
// `spawnSync`'s timeout with SIGKILL. All cases share that one child because
// importing `dev.ts` costs about 7 s of the child's wall (measured, cold and
// warm tsx cache alike), and this worker never imports it at all.
//
// ## What is asserted
//
//   1. `/proc/<missing>/` (where `/proc/self` exists — Linux, which CI is): the
//      child settles inside the bound and the refusal carries `ENOENT`, naming
//      the file and the directory — the shape that looped.
//   2. A path through a regular file: refused with `ENOTDIR`, naming the file.
//   3. CONTROL: a creatable unified-default path three levels deep is made.
//   4. CONTROL: any other source is left to the serve child — nothing is made.
//   5. A dangling symlink AS the directory (`OS_HOME/data` pointing nowhere):
//      refused at once with `EEXIST`, naming the file and the directory (#24090).
//      The walk used to accept any `EEXIST` on a created level, so the link went
//      through to the serve child, whose boot failed seconds later with a
//      plugin-start error naming neither (measured at `os dev` on `origin/main`
//      b9ac35cbf: exit 1 after 8.3 s, "Plugin com.objectstack.auth failed to
//      start").
//   6. The answers the fold onto `makeDirectorySync` keeps: a directory that
//      already exists, and a live symlink to one, are accepted as they stand; a
//      regular file holding the directory's own name is refused with `EEXIST`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '../..');
const SUBJECT = pathToFileURL(resolve(HERE, 'dev.ts')).href;

/** The child's whole budget; the loop it guards against never ends. */
const CHILD_BOUND_MS = 45_000;

interface Outcome {
  label: string;
  outcome: 'returned' | 'rejected';
  code?: string;
  message?: string;
}

const PROC_DIR = `/proc/os-23737-${process.pid}/data`;
const PROC_FILE = `${PROC_DIR}/objectstack.db`;
const RUNS_PROC = existsSync('/proc/self');

let root: string;
let outcomes: Map<string, Outcome>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-23737-dev-'));
  writeFileSync(join(root, 'plain'), '');
  mkdirSync(join(root, 'dangling'));
  symlinkSync(join(root, 'nowhere'), join(root, 'dangling', 'data'));
  mkdirSync(join(root, 'existing', 'data'), { recursive: true });
  mkdirSync(join(root, 'live', 'target'), { recursive: true });
  symlinkSync(join(root, 'live', 'target'), join(root, 'live', 'data'));
  mkdirSync(join(root, 'held'));
  writeFileSync(join(root, 'held', 'data'), '');
  const cases: Array<{ label: string; url: string; source: string }> = [
    ...(RUNS_PROC ? [{ label: 'proc', url: `file:${PROC_FILE}`, source: 'unified-default' }] : []),
    { label: 'through-file', url: `file:${join(root, 'plain', 'data', 'objectstack.db')}`, source: 'unified-default' },
    { label: 'creatable', url: `file:${join(root, 'home', 'a', 'data', 'objectstack.db')}`, source: 'unified-default' },
    { label: 'other-source', url: `file:${join(root, 'env', 'a', 'data', 'objectstack.db')}`, source: 'env' },
    { label: 'dangling', url: `file:${join(root, 'dangling', 'data', 'objectstack.db')}`, source: 'unified-default' },
    { label: 'existing', url: `file:${join(root, 'existing', 'data', 'objectstack.db')}`, source: 'unified-default' },
    { label: 'live-link', url: `file:${join(root, 'live', 'data', 'objectstack.db')}`, source: 'unified-default' },
    { label: 'held', url: `file:${join(root, 'held', 'data', 'objectstack.db')}`, source: 'unified-default' },
  ];
  const script = [
    'const [subject, json] = process.argv.slice(1);',
    'const { prepareDevDatabaseDirectory } = await import(subject);',
    'const out = [];',
    'for (const { label, url, source } of JSON.parse(json)) {',
    '  try { await prepareDevDatabaseDirectory({ url, source }); out.push({ label, outcome: "returned" }); }',
    '  catch (e) { out.push({ label, outcome: "rejected", code: e?.code, message: String(e?.message) }); }',
    '}',
    'process.stdout.write("\\nDEV-DIR-OUTCOMES " + JSON.stringify(out) + "\\n");',
  ].join('\n');
  const t0 = Date.now();
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, SUBJECT, JSON.stringify(cases)],
    {
      cwd: PKG_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
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
      `prepareDevDatabaseDirectory had not settled after ${Date.now() - t0} ms (child killed by ${child.signal}) — ` +
        `the directory prep is looping again. stderr tail: ${String(child.stderr).slice(-2000)}`,
    );
  }
  const line = String(child.stdout).split('\n').find((l) => l.startsWith('DEV-DIR-OUTCOMES '));
  if (!line) {
    throw new Error(`child exited ${child.status} without a result. stderr tail: ${String(child.stderr).slice(-2000)}`);
  }
  const parsed: Outcome[] = JSON.parse(line.slice('DEV-DIR-OUTCOMES '.length));
  outcomes = new Map(parsed.map((o) => [o.label, o]));
}, CHILD_BOUND_MS + 15_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function outcomeOf(label: string): Outcome {
  const found = outcomes.get(label);
  if (!found) throw new Error(`no outcome recorded for case '${label}'`);
  return found;
}

describe('prepareDevDatabaseDirectory — os dev\'s unified-default directory (#23737)', () => {
  it.runIf(RUNS_PROC)('refuses /proc/<missing>/ at once with ENOENT, naming the file and the directory', () => {
    const o = outcomeOf('proc');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('ENOENT');
    expect(o.message).toContain(`'${PROC_FILE}'`);
    expect(o.message).toContain(`'${PROC_DIR}'`);
  });

  it('refuses a path through a regular file with ENOTDIR, naming the file', () => {
    const o = outcomeOf('through-file');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('ENOTDIR');
    expect(o.message).toContain(`'${join(root, 'plain', 'data', 'objectstack.db')}'`);
  });

  it('CONTROL: a creatable unified-default path three levels deep is made', () => {
    expect(outcomeOf('creatable').outcome).toBe('returned');
    expect(statSync(join(root, 'home', 'a', 'data')).isDirectory()).toBe(true);
  });

  it('CONTROL: any other source is left to the serve child — nothing is made', () => {
    expect(outcomeOf('other-source').outcome).toBe('returned');
    expect(existsSync(join(root, 'env'))).toBe(false);
  });
});

describe('prepareDevDatabaseDirectory — a dangling symlink in the path is refused at once (#24090)', () => {
  it('refuses a dangling symlink as the directory with EEXIST, naming the file and the directory', () => {
    const o = outcomeOf('dangling');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('EEXIST');
    expect(o.message).toContain(`'${join(root, 'dangling', 'data', 'objectstack.db')}'`);
    expect(o.message).toContain(`'${join(root, 'dangling', 'data')}'`);
    expect(lstatSync(join(root, 'dangling', 'data')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(root, 'nowhere'))).toBe(false);
  });

  it('CONTROL: a directory that already exists, and a live symlink to one, are accepted as they stand', () => {
    expect(outcomeOf('existing').outcome).toBe('returned');
    expect(statSync(join(root, 'existing', 'data')).isDirectory()).toBe(true);
    expect(outcomeOf('live-link').outcome).toBe('returned');
    expect(lstatSync(join(root, 'live', 'data')).isSymbolicLink()).toBe(true);
  });

  it('refuses a regular file holding the directory\'s own name with EEXIST, naming the file', () => {
    const o = outcomeOf('held');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('EEXIST');
    expect(o.message).toContain(`'${join(root, 'held', 'data', 'objectstack.db')}'`);
  });
});
