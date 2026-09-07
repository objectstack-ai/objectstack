// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A failed stderr write must not kill the PUBLISHED CLI. #14858 for the class,
 * #15564 for the measurement that reached it on this entry point.
 *
 * ## What #15564 asked, and what the answer turned out to be
 *
 * `bin/run-dev.js` has carried a no-op `error` listener on `process.stderr`
 * since #14858; `bin/run.js` — the file `bin.objectstack` / `bin.os` point at,
 * and the only thing under `bin/` npm packs (#14874) — did not. The card was
 * filed **NOT REPRODUCED** on purpose and fenced the cheap conclusion: two
 * probes against the published entry with the read end destroyed had answered
 * exit 2 with no `uncaughtException`, so "the sibling has one" was explicitly
 * not evidence.
 *
 * Both were re-run before anything was written here, and both still read clean
 * — 3 of 3 each, `definitely-not-a-command` (57 bytes) and `OBJECTSTACK_DEBUG=1`
 * over an unbuilt `@objectstack/spec` (35528 bytes). ⭐ They were not a guard.
 * They were the wrong LIFECYCLE, and the difference is measurable:
 *
 *     leg (bin/run.js, read end destroyed)     stderr writes    exit
 *     --------------------------------------   --------------   -----------------
 *     `definitely-not-a-command`               1 @ 3231 ms       2, no crash
 *     OBJECTSTACK_DEBUG=1 + unbuilt spec      60 @ 932-960 ms    2, no crash
 *     `serve objectstack.config.ts`           21 @ 3180 ms on    1, `write EPIPE`
 *                                                                   3/3
 *
 *     uncaughtException  code=EPIPE  msg=write EPIPE
 *           at afterWriteDispatched (node:internal/stream_base_commons:159:15)
 *     exit  code=1
 *
 * — the same frame and status #14858 traced on the dev shim, at 3049-3433 ms,
 * on `examples/app-todo`. The same child read by a DRAINING parent boots and
 * serves, exit 0 at a 20 s SIGTERM after 7926 bytes over 16.6 s. So the crash
 * costs the run at its first diagnostic line and 20 of its 21 stderr writes.
 *
 * Two conditions separate that row, and a probe needs BOTH:
 *
 *   • an event-loop TURN between the failing write and `process.exit` — a
 *     failing write reports through libuv's completion callback, so a
 *     synchronous exit on top of it is never told. Both clean legs are that
 *     shape: everything they write lands after `run()` has settled, and
 *     `handle()` exits on top of its own report;
 *   • a RAW `process.stderr.write`. `console.error` carries `ignoreErrors`,
 *     which parks a temporary `error` listener across the write, so oclif's
 *     warning blocks cannot crash this process at any size (1 MiB through
 *     `console.error`: 0 of 3; one line through `process.stderr.write`: 3 of 3).
 *
 * ## What this file pins, and what it deliberately leaves out
 *
 * It pins the entry point's own obligation — **a failed stderr write in this
 * process is not fatal** — with the hazard manufactured inside the published
 * binary's process (the pattern its neighbour
 * `published-entry-stderr-nonblocking.e2e.test.ts` already uses, and for the
 * same reason: a real `os serve` leg needs a fixture app, a database and a
 * bound port to assert something narrower that does not move).
 *
 * ⛔ It does NOT assert that `bin/run.js` and `bin/run-dev.js` agree. Symmetry
 * between the two entries is what #15564 refused to accept as evidence, and a
 * case asserting it would smuggle that reading back in.
 *
 * The reachability half is not left unheld either — case 3 keeps the premise
 * the measurement rests on: `serve` still writes to stderr RAW.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { childEnv, requireBuiltCli } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `packages/cli` — this package's own root, never another package's. */
const PACKAGE_ROOT = resolve(HERE, '..');
const RUN_JS = join(PACKAGE_ROOT, 'bin', 'run.js');
const SERVE_COMMAND = join(PACKAGE_ROOT, 'src', 'commands', 'serve.ts');
const PROBE = join(HERE, 'fixtures', 'published-entry-stderr-error-probe.mjs');

/**
 * Why a `bin/run.js` child needs `packages/cli/dist`, in this file's own terms.
 *
 * ⚠️ The mechanism is the caller's to supply and must be TRUE OF THIS CALLER —
 * a borrowed sentence is a false explanation attached to a true refusal.
 */
const PUBLISHED_ENTRY_NEEDS_DIST =
  'This file drives bin/run.js with NODE_ENV unset, so oclif resolves the command from dist/ and the ' +
  'entry point reaches its own prologue; on an unbuilt tree the child answers "command not found" before ' +
  'the probe can read anything, and every assertion below would be about a run that never happened.';

/**
 * The one ceiling, a CONSTANT for the reason both neighbouring files record: a
 * ceiling derived from a calibration is a prediction about contention that a
 * shared runner will not honour. It detects what any finite ceiling detects —
 * a process that will never end — and sits far above what a healthy run needs
 * (the probe fires within ~20 ms of the entry's prologue and waits 250 ms).
 */
const HARD_CAP_MS = 90_000;

interface Arm {
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  marks: string;
}

let dir: string;
let guarded: Arm;
let unguarded: Arm;

/**
 * Run the published entry point under the probe, with the read end DESTROYED,
 * and report only how it ended plus what the marker file caught.
 *
 * `--version` is the argv because it is the cheapest real invocation there is:
 * the subject is the process, not the command, and every command goes through
 * the same `bin/run.js` prologue.
 */
function runPublishedEntry(arm: 'guarded' | 'unguarded'): Promise<Arm> {
  const marks = join(dir, `${arm}.marks`);
  writeFileSync(marks, '');
  const readMarks = (): string => {
    try {
      return readFileSync(marks, 'utf8');
    } catch {
      return '';
    }
  };
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(PROBE).href, RUN_JS, '--version'], {
      env: childEnv({
        NO_COLOR: '1',
        OS_PUBLISHED_ENTRY_ERROR_PROBE_MARKS: marks,
        OS_PUBLISHED_ENTRY_ERROR_PROBE_ARM: arm,
      }),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // ⭐ The condition under test. `pause()` would only stop READING — the
    // kernel's buffer and node's own would absorb the write and nothing would
    // fail. Destroying the read end is what makes the write fail.
    child.stderr?.destroy();

    const started = Date.now();
    const cap = setTimeout(() => child.kill('SIGKILL'), HARD_CAP_MS);
    child.once('exit', (code, signal) => {
      clearTimeout(cap);
      resolvePromise({ code, signal, elapsedMs: Date.now() - started, marks: readMarks() });
    });
  });
}

beforeAll(async () => {
  requireBuiltCli(PUBLISHED_ENTRY_NEEDS_DIST);
  dir = mkdtempSync(join(tmpdir(), 'os-published-entry-stderr-error-'));
  guarded = await runPublishedEntry('guarded');
  unguarded = await runPublishedEntry('unguarded');
}, HARD_CAP_MS * 3);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the published entry point survives a failed stderr write', () => {
  it('attaches the listener before anything of its own can write', () => {
    // The probe reports what it SAW rather than being assumed to have found it:
    // `LISTENER ABSENT` is the reading when `bin/run.js` stops attaching one,
    // and it is a different sentence from "the probe never ran".
    expect(
      guarded.marks,
      `the probe never reached the listener check, so it measured NOTHING — a zero reading, not a pass. Markers:\n${guarded.marks}`,
    ).toMatch(/LISTENER (ATTACHED|ABSENT)/);
    expect(
      guarded.marks,
      `bin/run.js no longer attaches an \`error\` listener to process.stderr — a failed stderr write is an ` +
        `uncaught exception again on the entry point a customer's install runs (#14858, #15564). Markers:\n${guarded.marks}`,
    ).toContain('LISTENER ATTACHED');
  });

  it('outlives a failed write and ends with its own status, not a crash', () => {
    const evidence = `ceiling ${HARD_CAP_MS} ms (constant, load-independent by design); this child ran ${guarded.elapsedMs} ms. Markers:\n${guarded.marks}`;
    expect(guarded.marks, `the probe never made its write. ${evidence}`).toContain('WROTE');
    expect(
      guarded.marks,
      `the child died of an uncaught exception on a stderr write — see the ablation in the header. ${evidence}`,
    ).not.toContain('UNCAUGHT');
    expect(guarded.marks, `the child did not outlive its own failed write. ${evidence}`).toContain('SURVIVED');
    expect(guarded.signal, `the harness SIGKILLed the child — it was still alive at the ceiling. ${evidence}`).toBeNull();
    expect(guarded.code, `the child did not exit with the probe's own status. ${evidence}`).toBe(7);
  });

  it('still crashes with the listener taken away — the live positive control', () => {
    // ⛔ Without this the case above is not evidence. A probe whose write had
    // silently stopped FAILING — a `pause()` that never destroys, a
    // `console.error` that swallows its own errors, a node that stopped
    // reporting EPIPE here — would be green on the guarded arm forever. This
    // arm removes the listener IN THE CHILD's process (nothing on disk), so the
    // hazard is re-armed against the same tree in the same run.
    const evidence = `this child ran ${unguarded.elapsedMs} ms. Markers:\n${unguarded.marks}`;
    expect(unguarded.marks, `the unguarded arm never made its write. ${evidence}`).toContain('WROTE');
    expect(
      unguarded.marks,
      `the write did not fail with the listener removed, so the GUARDED arm above proves nothing — this ` +
        `instrument has stopped discriminating and the case it controls is vacuous. ${evidence}`,
    ).toContain('UNCAUGHT code=EPIPE');
    expect(unguarded.marks, `the unguarded arm survived, so nothing was being guarded against. ${evidence}`).not.toContain('SURVIVED');
    expect(unguarded.code, `the unguarded arm did not die of its uncaught exception. ${evidence}`).toBe(1);
  });
});

describe('the premise the measurement rests on', () => {
  it('keeps a RAW stderr write on a long-lived published command', () => {
    // ⚠️ The reachability half, held rather than assumed. `serve` is what
    // #15564 reproduced on, and only because two things are true of it at once:
    // it writes to stderr WITHOUT `console.error`'s `ignoreErrors` guard, and
    // it stays alive across the write. If every raw write here were ever routed
    // through `console.error`, the measurement in this file's header would no
    // longer describe the tree — re-measure before reading the pins above as
    // covering a live hazard.
    //
    // Comments are masked so the docblocks that DISCUSS `process.stderr.write`
    // — including the one at the call site — cannot answer for the call itself.
    const code = maskComments(readFileSync(SERVE_COMMAND, 'utf8'));
    expect(
      code,
      `${SERVE_COMMAND} no longer writes to stderr directly. That is not automatically a defect, but it ` +
        `removes the reproduction #15564 measured, so the header above needs re-measuring rather than trusting.`,
    ).toContain('process.stderr.write(');
  });
});
