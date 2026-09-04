// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The PUBLISHED CLI must not be able to freeze in the kernel on its own stderr.
 *
 * ## The defect, measured on the shipped binary
 *
 * Node puts fd 2 on the non-blocking path when it opens the pipe; libuv clears
 * that flag again in the pre-exec of any child spawned with inherited stdio, on
 * the SHARED open file description, so the spawner loses it too. `os dev` is
 * the headline case and the measurement is not hypothetical — `node bin/run.js
 * dev --verbose` with its output piped to a reader that stopped draining:
 *
 * ```
 *  2829 ms  fd2 O_NONBLOCK=false   `os dev` spawns `os serve --dev`, stdio inherit
 *  2930 ms  fd2 O_NONBLOCK=true    that child materialised ITS OWN stdio again
 *  5244 ms  fd2 O_NONBLOCK=false   the esbuild service, a GRANDCHILD, inherits stderr
 *
 * PARK DETECTED syscall=1(write) fd=2 O_NONBLOCK=false wchan=sock_alloc_send_pskb
 *     cmd: node …/packages/cli/bin/run.js serve --dev --verbose   (MAIN thread)
 * ```
 *
 * 3.1 s after the reader stopped, 4 of 4 runs; parked 28.9 s; SIGINT IGNORED
 * while parked; released only when the consumer resumed. Alive, idle,
 * unresponsive, empty log.
 *
 * ⭐ The clearing that persisted came from a GRANDCHILD — so no change to this
 * CLI's own spawn sites would have prevented it, and the repair has to sit on
 * the write path. That is what `keepStderrNonBlocking()` does, and this file is
 * about whether the PUBLISHED entry point has it.
 *
 * ## Why this file exists next to `run-dev-stderr-nonblocking.e2e.test.ts`
 *
 * ⭐ Because the guard existed, was correct, was pinned — and did not ship. It
 * lived at `bin/stderr-nonblocking.mjs`, and `files` names only `dist`,
 * `README.md` and `CHANGELOG.md`. npm packs a `bin` TARGET regardless of
 * `files`, which is why `bin/run.js` reached every published install and the
 * module beside it reached none: `npm pack --dry-run` listed `bin/run.js` as
 * the only packed file under `bin/`. A pin that reads the source tree cannot
 * see that difference, and the neighbouring suite — whose whole subject is the
 * UNBUILT tree — is the wrong place to look for it.
 *
 * So this file asserts the two things that were separately false: the published
 * entry point INSTALLS the guard (executed, in the real process, on the
 * compiled copy), and the module it installs is one the package actually SHIPS.
 *
 * ⛔ It deliberately does not re-assert anything the sibling file owns. That
 * file owns the guard's behaviour and the source shim's wiring; this one owns
 * the published entry point and the packaging.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { childEnv, requireBuiltCli } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `packages/cli` — this package's own root, never another package's. */
const PACKAGE_ROOT = resolve(HERE, '..');
const RUN_JS = join(PACKAGE_ROOT, 'bin', 'run.js');
const PROBE = join(HERE, 'fixtures', 'published-entry-stderr-probe.mjs');

/**
 * Why a `bin/run.js` child needs `packages/cli/dist`, in this file's own terms.
 *
 * ⚠️ The mechanism is the caller's to supply and must be TRUE OF THIS CALLER —
 * a borrowed sentence is a false explanation attached to a true refusal.
 */
const PUBLISHED_GUARD_LIVES_IN_DIST =
  'This file drives bin/run.js, whose stderr guard is imported from ../dist/ — the compiled copy is ' +
  'the whole subject here, because a guard that only exists in src/ is exactly the defect this pins.';

/**
 * The one ceiling, a CONSTANT by the same reasoning the sibling file records:
 * a ceiling derived from a calibration is a prediction about contention that a
 * shared runner will not honour. This one detects what any finite ceiling
 * detects — a process that will never end — and sits far above anything a
 * healthy run needs (the writes return in about a millisecond when they are not
 * blocked; the CLI boot ahead of them was measured at ~2.9 s).
 */
const HARD_CAP_MS = 90_000;

/**
 * How long the child is given AFTER it announces it is about to write.
 *
 * ⚠️ Not an oracle over the fix — it only decides when to stop waiting for a
 * process expected to be frozen, and it counts from the child's own `WRITING`
 * marker rather than from spawn, so a slow boot cannot shorten it. Too short
 * and it would kill a healthy child; that shows up as a RED here (the exit-code
 * and `WRITES RETURNED` assertions both fail), never as a quiet green.
 */
const FREEZE_GRACE_MS = 5_000;

interface Probe {
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  marks: string;
}

let dir: string;
let probe: Probe;

/**
 * Run the published entry point under the probe, with stderr as a pipe nobody
 * reads, and report only how it ended plus what the marker file caught.
 *
 * `--version` is the argv because it is the cheapest real invocation there is:
 * the probe's subject is the process, not the command, and every command goes
 * through the same `bin/run.js` prologue.
 */
function runPublishedEntry(): Promise<Probe> {
  const marks = join(dir, 'published-entry.marks');
  writeFileSync(marks, '');
  const readMarks = (): string => {
    try {
      return readFileSync(marks, 'utf8');
    } catch {
      return '';
    }
  };
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      ['--import', pathToFileURL(PROBE).href, RUN_JS, '--version'],
      {
        env: childEnv({ NO_COLOR: '1', OS_PUBLISHED_ENTRY_PROBE_MARKS: marks }),
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    // Nothing ever reads it, which is the condition under test.
    child.stderr?.pause();

    const started = Date.now();
    const cap = setTimeout(() => child.kill('SIGKILL'), HARD_CAP_MS);
    let grace: NodeJS.Timeout | undefined;
    const poll = setInterval(() => {
      if (!grace && readMarks().includes('WRITING')) {
        grace = setTimeout(() => child.kill('SIGKILL'), FREEZE_GRACE_MS);
      }
    }, 50);

    child.once('exit', (code, signal) => {
      clearTimeout(cap);
      if (grace) clearTimeout(grace);
      clearInterval(poll);
      resolvePromise({ code, signal, elapsedMs: Date.now() - started, marks: readMarks() });
    });
  });
}

beforeAll(async () => {
  requireBuiltCli(PUBLISHED_GUARD_LIVES_IN_DIST);
  dir = mkdtempSync(join(tmpdir(), 'os-published-entry-stderr-'));
  probe = await runPublishedEntry();
}, HARD_CAP_MS * 2);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the published entry point keeps its own stderr off the blocking path', () => {
  it('installs the guard before anything of its own can write', () => {
    // The probe reports what it SAW rather than being assumed to have found it:
    // `GUARD ABSENT` is the reading when `bin/run.js` no longer installs it, and
    // it is a different sentence from "the probe never ran".
    expect(
      probe.marks,
      `the probe never reached the guard check, so it measured NOTHING — a zero reading, not a pass. Markers:\n${probe.marks}`,
    ).toMatch(/GUARD (INSTALLED|ABSENT)/);
    expect(
      probe.marks,
      `bin/run.js did not install keepStderrNonBlocking() — the published binary is back on the blocking path. Markers:\n${probe.marks}`,
    ).toContain('GUARD INSTALLED');
  });

  it('survives an inherited-stdio spawn and a 2 MiB burst at a reader that is gone', () => {
    const evidence = `ceiling ${HARD_CAP_MS} ms (constant, load-independent by design); this child ran ${probe.elapsedMs} ms. Markers:\n${probe.marks}`;
    // ⚠️ Without this the whole case is vacuous: if the spawn did not clear the
    // flag, the writes were never in danger and their returning proves nothing.
    // `unreadable` (not Linux) is tolerated — only a confirmed `true` is refused.
    expect(probe.marks, `the hazard was not armed: fd 2 still had O_NONBLOCK after a spawn with inherited stdio. ${evidence}`).not.toContain(
      'HAZARD O_NONBLOCK=true',
    );
    expect(probe.marks, `the child never got past the blocking write. ${evidence}`).toContain('WRITES RETURNED');
    expect(probe.signal, `the child had to be killed — it was still alive at the ceiling. ${evidence}`).toBeNull();
    expect(probe.code, `the child did not exit with the probe's own status. ${evidence}`).toBe(7);
  });

  it('holds the bytes rather than throwing them away to buy the exit', () => {
    // ⚠️ The cheap way to make a blocking write stop blocking is to stop caring
    // about the bytes — destroy the stream, or swap in a sink — and that would
    // pass everything above while deleting what the CLI's own output is for.
    const written = Number(/bytesWritten=(\d+)/.exec(probe.marks)?.[1]);
    expect(written, `no bytesWritten in the markers, so this reads nothing:\n${probe.marks}`).not.toBeNaN();
    expect(written, `the guard did not accept the writes. Markers:\n${probe.marks}`).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    expect(probe.marks, `the exit was bought by destroying stderr. Markers:\n${probe.marks}`).toContain('destroyed=false');
  });
});

describe('the guard the published entry point installs is one the package SHIPS', () => {
  /** `bin/run.js`, comments masked — its own prose names the guard twice. */
  const entry = (): string => maskComments(readFileSync(RUN_JS, 'utf8'));

  /** The specifier `bin/run.js` imports the guard from, as written. */
  function guardSpecifier(): string {
    const found = /import\(\s*'([^']*stderr-nonblocking[^']*)'\s*\)/.exec(entry())?.[1];
    expect(found, `bin/run.js imports no stderr-nonblocking module at all:\n${entry()}`).toBeTruthy();
    return found as string;
  }

  it('calls the guard BEFORE run(), which is the whole of why it works', () => {
    const source = entry();
    const installed = source.indexOf('keepStderrNonBlocking(');
    const started = source.indexOf('run(process.argv.slice(2)');
    expect(installed, 'bin/run.js no longer calls keepStderrNonBlocking()').toBeGreaterThan(-1);
    expect(started, 'bin/run.js no longer calls run() — this case is reading the wrong file').toBeGreaterThan(-1);
    // Everything oclif writes to stderr it writes inside `Config.load()`, i.e.
    // inside `run()`. A guard installed after it is a guard installed after the
    // freeze.
    expect(
      installed,
      'the guard is installed AFTER run(), so the CLI writes on the unguarded path and the hang comes back',
    ).toBeLessThan(started);
  });

  it('imports it from a path the `files` whitelist admits', () => {
    // ⭐ THE INVARIANT THAT WAS FALSE. The old guard sat at
    // `bin/stderr-nonblocking.mjs`: correct, pinned, imported — and unpacked,
    // because `files` never names `bin/` and npm packs only the `bin` TARGET
    // from it. Reading the whitelist rather than hard-coding `dist` is what
    // makes this a check on the manifest instead of a restatement of today's
    // path.
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      files?: string[];
      bin?: Record<string, string>;
    };
    const files = manifest.files ?? [];
    expect(files.length, 'packages/cli declares no `files` whitelist, so this reads nothing').toBeGreaterThan(0);

    const admits = (repoRelative: string): boolean =>
      files.some((entryPath) => repoRelative === entryPath || repoRelative.startsWith(`${entryPath}/`));

    const guardPath = relative(PACKAGE_ROOT, resolve(PACKAGE_ROOT, 'bin', guardSpecifier()));
    expect(
      admits(guardPath),
      `bin/run.js imports the guard from ${guardPath}, which \`files\` (${files.join(', ')}) does not ship — ` +
        'a published install would silently run without it, which is the defect this file exists for',
    ).toBe(true);

    // ⚠️ The control, and it is not decoration: without it the assertion above
    // passes for a whitelist that admits everything. `bin/run.js` itself is the
    // asymmetry that caused the defect — it ships as the `bin` target while the
    // whitelist says nothing about it.
    expect(
      admits('bin/run.js'),
      'the `files` whitelist now admits bin/, so the check above can no longer say no',
    ).toBe(false);
    expect(Object.values(manifest.bin ?? {}), 'bin/run.js is no longer the published entry point').toContain(
      './bin/run.js',
    );
  });
});
