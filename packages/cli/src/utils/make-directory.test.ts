// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `makeDirectorySync` — this package's bounded stand-in for
// `fs.mkdirSync(dir, { recursive: true })` — refuses a directory that can never
// be made at once, with the operating system's code and the path, and makes
// every directory the recursive form makes (#23858).
//
// ## The defect, measured on `origin/main` 0744f94366
//
// Node's recursive mkdir loops `mkdir("/proc/x") = ENOENT`, `mkdir("/proc") =
// EEXIST`, retry, without end; the synchronous form holds the event loop.
// `OS_HOME=/proc/os-23858-home os start` made 168,465 failing `mkdir` calls in
// 20 s; `os create plugin foo --dir /proc/os-23858-cr/foo` 889,246.
//
// ## Why the `/proc` cases run in ONE bounded child process
//
// A regression to the recursive form would hang this vitest worker rather than
// fail it: no timer fires while the loop holds the event loop. So those cases
// run from source in a `node --import tsx` child bounded by `spawnSync`'s
// timeout with SIGKILL. The async credential writers (`writeAuthConfig`,
// `writeCloudConfig`) are there too: their recursive `mkdir` never SETTLED on
// the same path, which a vitest timeout would end only as an unexplained
// timeout. They need a `/proc` that refuses `mkdir` with ENOENT, so they run
// where `/proc/self` exists (Linux, which CI is).
//
// ## What is asserted
//
//   1. `/proc/<missing>/…`: the child settles inside the bound and every case
//      is refused with `ENOENT`, naming the level that cannot be made — the
//      helper itself, and `os login` / `os cloud login`'s credential writers
//      under a `HOME` there.
//   2. In-process (the operating system answers these at once whatever the
//      walk): a path through a regular file is `ENOTDIR`; a file holding the
//      directory's own name is `EEXIST`; a dangling symlink holding it is
//      refused, never reported made.
//   3. CONTROL: a creatable path three levels deep is made, and the first
//      directory created is returned, as the recursive form returns it.
//   4. CONTROL: an existing directory is accepted and returns `undefined`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeDirectorySync } from './make-directory.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '../..');
const SUBJECTS = {
  helper: pathToFileURL(resolve(HERE, 'make-directory.ts')).href,
  auth: pathToFileURL(resolve(HERE, 'auth-config.ts')).href,
  cloud: pathToFileURL(resolve(HERE, 'cloud-config.ts')).href,
};

/** The child's whole budget; the loop it guards against never ends. */
const CHILD_BOUND_MS = 45_000;

const RUNS_PROC = existsSync('/proc/self');
const PROC_TOP = `/proc/os-23858-${process.pid}`;

interface Outcome {
  label: string;
  outcome: 'returned' | 'rejected';
  code?: string;
  message?: string;
}

let outcomes: Map<string, Outcome>;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-23858-cli-'));
  if (!RUNS_PROC) return;
  const script = [
    'const subjects = JSON.parse(process.argv[1]);',
    'const top = process.argv[2];',
    'const { makeDirectorySync } = await import(subjects.helper);',
    'const { writeAuthConfig } = await import(subjects.auth);',
    'const { writeCloudConfig } = await import(subjects.cloud);',
    'const out = [];',
    'const record = async (label, fn) => {',
    '  try { await fn(); out.push({ label, outcome: "returned" }); }',
    '  catch (e) { out.push({ label, outcome: "rejected", code: e?.code, message: String(e?.message) }); }',
    '};',
    'await record("helper", () => makeDirectorySync(top + "/a/data"));',
    // `homedir()` reads HOME at each call; set here so the child's own
    // start-up never looks under /proc.
    'process.env.HOME = top + "-home";',
    'await record("auth", () => writeAuthConfig({ apiUrl: "http://localhost:1", token: "t" }));',
    'await record("cloud", () => writeCloudConfig({ cloudUrl: "http://localhost:1", apiKey: "k", createdAt: "2026-10-16T00:00:00Z" }));',
    'process.stdout.write("\\nMKDIR-OUTCOMES " + JSON.stringify(out) + "\\n");',
  ].join('\n');
  const t0 = Date.now();
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, JSON.stringify(SUBJECTS), PROC_TOP],
    {
      cwd: PKG_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: root,
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
      `the /proc cases had not settled after ${Date.now() - t0} ms (child killed by ${child.signal}) — ` +
        `a directory prep is looping again. stderr tail: ${String(child.stderr).slice(-2000)}`,
    );
  }
  const line = String(child.stdout).split('\n').find((l) => l.startsWith('MKDIR-OUTCOMES '));
  if (!line) {
    throw new Error(`child exited ${child.status} without a result. stderr tail: ${String(child.stderr).slice(-2000)}`);
  }
  const parsed: Outcome[] = JSON.parse(line.slice('MKDIR-OUTCOMES '.length));
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

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return (e as { code?: unknown }).code;
  }
  return 'returned';
}

describe('makeDirectorySync — a directory that can never be made is refused at once (#23858)', () => {
  it.runIf(RUNS_PROC)('refuses /proc/<missing>/… with ENOENT, naming the level that cannot be made', () => {
    const o = outcomeOf('helper');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('ENOENT');
    expect(o.message).toContain(`'${PROC_TOP}'`);
  });

  it.runIf(RUNS_PROC)('os login / os cloud login: a HOME under /proc is refused with ENOENT, never left pending', () => {
    for (const label of ['auth', 'cloud']) {
      const o = outcomeOf(label);
      expect(o.outcome, label).toBe('rejected');
      expect(o.code, label).toBe('ENOENT');
      expect(o.message, label).toContain(`'${PROC_TOP}-home'`);
    }
  });

  it('refuses a path through a regular file with ENOTDIR, and a file holding the name with EEXIST', () => {
    writeFileSync(join(root, 'plain'), '');
    expect(codeOf(() => makeDirectorySync(join(root, 'plain', 'a', 'b')))).toBe('ENOTDIR');
    expect(codeOf(() => makeDirectorySync(join(root, 'plain')))).toBe('EEXIST');
  });

  it('refuses a dangling symlink holding the name — never reports it made', () => {
    symlinkSync(join(root, 'nowhere'), join(root, 'dangling'));
    expect(codeOf(() => makeDirectorySync(join(root, 'dangling')))).toBe('EEXIST');
    expect(existsSync(join(root, 'nowhere'))).toBe(false);
  });

  it('CONTROL: a creatable path three levels deep is made, and the first directory created is returned', () => {
    const target = join(root, 'made', 'a', 'b');
    expect(makeDirectorySync(target)).toBe(join(root, 'made'));
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it('CONTROL: an existing directory is accepted and returns undefined', () => {
    mkdirSync(join(root, 'there'));
    expect(makeDirectorySync(join(root, 'there'))).toBeUndefined();
  });
});
