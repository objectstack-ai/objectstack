// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The runtime's directory preps under `OS_HOME` refuse a directory that can
// never be made at once, with the operating system's code and the path,
// instead of looping in Node's recursive mkdir (#23858).
//
// ## The defect, measured on `origin/main` 0744f94366, at `os serve`
//
// Node's recursive mkdir loops `mkdir("/proc/x") = ENOENT`, `mkdir("/proc") =
// EEXIST`, retry, without end; the synchronous form holds the event loop, so
// no plugin timeout can fire. Each of these was reached with an operator's
// `OS_HOME`:
//
//   - `createDefaultHostConfig`'s empty-boot stub artifact
//     (`OS_HOME=/proc/os-23858-dh OS_BOOT_EMPTY=1 os serve`): 1,107,199 failing
//     `mkdir` calls in 25 s, killed at the bound;
//   - `resolveArtifactReference`'s cache for a fetched `OS_ARTIFACT_URL`
//     (`OS_HOME=/proc/os-23858-ar`, an `http:` reference): 1,103,490;
//   - `setPackageDisabled`'s state file, written by the packages routes'
//     enable / disable / install handlers — read, the same call shape.
//
// ## Why the `/proc` cases run in ONE bounded child process
//
// A regression to the recursive form would hang this vitest worker rather than
// fail it. So those cases run from source in a `node --import tsx` child
// bounded by `spawnSync`'s timeout with SIGKILL: a reintroduced loop fails here
// at the bound. They need a `/proc` that refuses `mkdir` with ENOENT, so they
// run where `/proc/self` exists (Linux, which CI is).
//
// ## What is asserted
//
//   1. `/proc/<missing>/…`, in the child: every subject settles inside the
//      bound and is refused with `ENOENT`, naming the level that cannot be
//      made. The artifact cache refusal stays the resolver's own
//      `OS_ARTIFACT_UNREACHABLE`, now carrying the OS's answer.
//   2. CONTROL, in the same child: under a creatable `OS_HOME` three levels
//      deep, the empty-boot stub artifact is written and the stack is built.
//   3. CONTROL, in-process: the helper makes a creatable path and returns the
//      first directory it created; the state file and the fetched artifact
//      land under a creatable home three levels deep.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeDirectorySync } from './make-directory.js';
import { loadDisabledPackageIds, setPackageDisabled } from './package-state-store.js';
import { resolveArtifactReference } from './artifact-reference.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const SUBJECTS = {
  helper: pathToFileURL(resolve(HERE, 'make-directory.ts')).href,
  defaultHost: pathToFileURL(resolve(HERE, 'default-host.ts')).href,
  packageState: pathToFileURL(resolve(HERE, 'package-state-store.ts')).href,
  artifact: pathToFileURL(resolve(HERE, 'artifact-reference.ts')).href,
};

/** The child's whole budget; the loop it guards against never ends. */
const CHILD_BOUND_MS = 60_000;

const RUNS_PROC = existsSync('/proc/self');
const PROC_TOP = `/proc/os-23858-${process.pid}`;

/** The smallest artifact the resolver accepts — the empty-boot stub's shape. */
const STUB_ARTIFACT = JSON.stringify({
  manifest: { id: 'com.example.os23858', name: 'os23858', version: '0.0.0', type: 'app' },
  objects: [],
});

interface Outcome {
  label: string;
  outcome: 'returned' | 'rejected';
  code?: string;
  message?: string;
}

let outcomes: Map<string, Outcome>;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-23858-runtime-'));
  if (!RUNS_PROC) return;
  const script = [
    'const [subjectsJson, top, scratch, stub] = process.argv.slice(1);',
    'const subjects = JSON.parse(subjectsJson);',
    'const { makeDirectorySync } = await import(subjects.helper);',
    'const { createDefaultHostConfig } = await import(subjects.defaultHost);',
    'const { setPackageDisabled } = await import(subjects.packageState);',
    'const { resolveArtifactReference } = await import(subjects.artifact);',
    // No `<cwd>/dist/objectstack.json` may answer for the empty boot.
    'process.chdir(scratch);',
    'const out = [];',
    'const record = async (label, fn) => {',
    '  try { await fn(); out.push({ label, outcome: "returned" }); }',
    '  catch (e) { out.push({ label, outcome: "rejected", code: e?.code, message: String(e?.message) }); }',
    '};',
    'await record("helper", () => makeDirectorySync(top + "/a/data"));',
    'process.env.OS_HOME = top + "-dh";',
    'await record("default-host", () => createDefaultHostConfig({ requireArtifact: false }));',
    'process.env.OS_HOME = top + "-ps";',
    'await record("package-state", () => setPackageDisabled(undefined, "com.example.os23858", true));',
    'await record("artifact", () => resolveArtifactReference("http://artifact.invalid/objectstack.json", {',
    '  homeDir: top + "-ar",',
    '  fetchImpl: async () => new Response(stub, { status: 200 }),',
    '}));',
    'process.env.OS_HOME = scratch + "/home/a/b";',
    'await record("default-host-control", () => createDefaultHostConfig({ requireArtifact: false }));',
    'process.stdout.write("\\nMKDIR-OUTCOMES " + JSON.stringify(out) + "\\n");',
    // The control built a stack that holds handles; the outcomes are written.
    'process.exit(0);',
  ].join('\n');
  const t0 = Date.now();
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, JSON.stringify(SUBJECTS), PROC_TOP, root, STUB_ARTIFACT],
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
      `the OS_HOME directory preps had not settled after ${Date.now() - t0} ms (child killed by ${child.signal}) — ` +
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

const savedHome = process.env.OS_HOME;
afterEach(() => {
  if (savedHome === undefined) delete process.env.OS_HOME;
  else process.env.OS_HOME = savedHome;
});

function outcomeOf(label: string): Outcome {
  const found = outcomes.get(label);
  if (!found) throw new Error(`no outcome recorded for case '${label}'`);
  return found;
}

describe('OS_HOME directory preps — a directory that can never be made is refused at once (#23858)', () => {
  it.runIf(RUNS_PROC)('the helper refuses /proc/<missing>/… with ENOENT, naming the level', () => {
    const o = outcomeOf('helper');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('ENOENT');
    expect(o.message).toContain(`'${PROC_TOP}'`);
  });

  it.runIf(RUNS_PROC)('createDefaultHostConfig: the empty-boot stub under a /proc OS_HOME is refused with ENOENT', () => {
    const o = outcomeOf('default-host');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('ENOENT');
    expect(o.message).toContain(`'${PROC_TOP}-dh'`);
  });

  it.runIf(RUNS_PROC)('setPackageDisabled: the state file under a /proc OS_HOME is refused with ENOENT', () => {
    const o = outcomeOf('package-state');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('ENOENT');
    expect(o.message).toContain(`'${PROC_TOP}-ps'`);
  });

  it.runIf(RUNS_PROC)('resolveArtifactReference: the cache under a /proc home is OS_ARTIFACT_UNREACHABLE, carrying ENOENT', () => {
    const o = outcomeOf('artifact');
    expect(o.outcome).toBe('rejected');
    expect(o.code).toBe('OS_ARTIFACT_UNREACHABLE');
    expect(o.message).toContain('ENOENT');
    expect(o.message).toContain(`'${PROC_TOP}-ar'`);
  });

  it.runIf(RUNS_PROC)('CONTROL: under a creatable OS_HOME three levels deep the empty-boot stub is written', () => {
    expect(outcomeOf('default-host-control').outcome).toBe('returned');
    expect(statSync(join(root, 'home', 'a', 'b', 'dist', 'objectstack.json')).isFile()).toBe(true);
  });

  it('CONTROL: the helper makes a creatable path and returns the first directory it created', () => {
    const target = join(root, 'made', 'a', 'b');
    expect(makeDirectorySync(target)).toBe(join(root, 'made'));
    expect(statSync(target).isDirectory()).toBe(true);
    expect(makeDirectorySync(target)).toBeUndefined();
  });

  it('CONTROL: the package state file lands under a creatable OS_HOME three levels deep', () => {
    process.env.OS_HOME = join(root, 'ps-home', 'a', 'b');
    setPackageDisabled(undefined, 'com.example.os23858', true);
    expect(loadDisabledPackageIds(undefined).has('com.example.os23858')).toBe(true);
    expect(statSync(join(root, 'ps-home', 'a', 'b', 'package-state')).isDirectory()).toBe(true);
  });

  it('CONTROL: a fetched artifact is cached under a creatable home three levels deep', async () => {
    const homeDir = join(root, 'ar-home', 'a', 'b');
    const resolved = await resolveArtifactReference('http://artifact.invalid/objectstack.json', {
      homeDir,
      fetchImpl: async () => new Response(STUB_ARTIFACT, { status: 200 }),
    });
    expect(resolved.localPath.startsWith(join(homeDir, 'artifacts'))).toBe(true);
    expect(readFileSync(resolved.localPath, 'utf8')).toBe(STUB_ARTIFACT);
  });
});
