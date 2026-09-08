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
 * The reachability half is not left unheld either — the last case below keeps
 * the premise the measurement rests on: `serve`'s `printDiagnostic`, the one
 * writer the reproduction ran through, still writes to stderr RAW.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `packages/cli` — this package's own root, never another package's. */
const PACKAGE_ROOT = resolve(HERE, '..');
const RUN_JS = join(PACKAGE_ROOT, 'bin', 'run.js');
const SERVE_COMMAND = join(PACKAGE_ROOT, 'src', 'commands', 'serve.ts');
const PROBE = join(HERE, 'fixtures', 'published-entry-stderr-error-probe.mjs');

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

// ⛔ NO `requireBuiltCli()` here, and the absence is MEASURED rather than an
// oversight. Everything this file reads lives in source: the listener is
// attached in `bin/run.js` itself — the file npm packs as the `bin` target
// however `files` is written (#14874) — and both `../dist/` imports in that
// entry are wrapped in a `try/catch` that degrades to silence, so an absent
// `dist` costs the child nothing it is measured on here. `--version` is
// answered by oclif's own config and never reaches `dist/commands`.
//
// Measured on this tree with `packages/cli/dist` moved aside: the child printed
// its version, the guarded arm read `LISTENER ATTACHED … WROTE … SURVIVED …
// EXIT code=7` and the unguarded arm `UNCAUGHT code=EPIPE … EXIT code=1` — every
// case below green, and still RED under the listener ablation, with no build in
// the tree at all.
//
// ⚠️ That is exactly where this file differs from its neighbour
// `published-entry-stderr-nonblocking.e2e.test.ts`, whose subject
// (`keepStderrNonBlocking`) IS the compiled `../dist/utils/stderr-nonblocking.js`
// import: that file's gate is true OF THAT FILE, and it keeps both its gate and
// its `.e2e` name. ⛔ Do not borrow it back here. A gate copied without its
// reason is a false explanation attached to a true refusal — the failure class
// the helper's own docblock above `RUN_JS_RESOLVES_FROM_DIST` names.
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-published-entry-stderr-error-'));
  guarded = await runPublishedEntry('guarded');
  unguarded = await runPublishedEntry('unguarded');
}, HARD_CAP_MS * 3);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the published entry point survives a failed stderr write', () => {
  it('has its OWN listener on process.stderr by the time the probe looks', () => {
    // The probe reports what it SAW rather than being assumed to have found it:
    // `LISTENER ABSENT` is the reading when `bin/run.js` stops attaching one,
    // and it is a different sentence from "the probe never ran".
    //
    // ⚠️ It looks for the listener BY NAME, and that is a correction rather
    // than a flourish: node parks an anonymous `once('error', noop)` across
    // every `console.error`, so a count-based version of this case reported
    // `LISTENER ATTACHED after 20 ms` against a tree with the whole block
    // deleted — measured, under the ablation below. The count is carried in
    // the markers as evidence and decides nothing.
    //
    // ⛔ PRESENCE ONLY, and the name says so deliberately. `LISTENER ATTACHED
    // after N ms` is true for every N inside the probe's 15 s wait, so this
    // case cannot tell an attach at the top of `bin/run.js` apart from one
    // moved below `await run(…)`. The ORDER is the next case, read from the
    // entry's source, because no reading this process can take will ever
    // distinguish them.
    expect(
      guarded.marks,
      `the probe never reached the listener check, so it measured NOTHING — a zero reading, not a pass. Markers:\n${guarded.marks}`,
    ).toMatch(/LISTENER (ATTACHED|ABSENT)/);
    expect(
      guarded.marks,
      `bin/run.js no longer attaches its \`error\` listener to process.stderr — a failed stderr write is an ` +
        `uncaught exception again on the entry point a customer's install runs (#14858, #15564). Markers:\n${guarded.marks}`,
    ).toContain('LISTENER ATTACHED');
  });

  it('attaches it ABOVE `await run(…)`, which is the order the entry claims', () => {
    // ⭐ Why this case exists at all. The case above pins PRESENCE; a refactor
    // that moved the attach BELOW `await run(…)` would keep it — and every
    // other runtime case here — green, while the entry's own claim ("⚠️ BEFORE
    // `run()`, and that order is the whole point") had quietly stopped being
    // true. The probe cannot see the difference: it is one process, `--version`
    // settles oclif in a few hundred ms, and by the time the poll can look,
    // both have already happened. So the order is read STRUCTURALLY, from the
    // entry's source, which is the only place it is visible.
    //
    // What the order buys, in the entry's words: everything the CLI writes to
    // stderr is written from inside `run()`, so a listener installed after it
    // has already missed the writes it exists to survive.
    //
    // ⚠️ Both sites are located BY TEXT, never by line number — the docblocks
    // around them move whenever anyone edits them. Comments are masked so the
    // paragraphs that DISCUSS this order, several of which name `run()`, can
    // never answer for the code.
    const entry = maskComments(readFileSync(RUN_JS, 'utf8'));
    const attaches = [...entry.matchAll(/process\.stderr\.on\s*\(\s*['"]error['"]/g)].map((m) => m.index ?? -1);
    expect(
      attaches.length,
      `${RUN_JS} no longer attaches any \`error\` listener to process.stderr — a failed stderr write is an uncaught ` +
        `exception again on the entry point a customer's install runs (#14858, #15564).`,
    ).toBeGreaterThan(0);
    const runCall = entry.search(/\bawait\s+run\s*\(/);
    expect(
      runCall,
      `${RUN_JS} no longer calls \`await run(\`. That is not automatically a defect, but this case can no longer ` +
        `read the order it pins — re-locate both sites by text before trusting it.`,
    ).toBeGreaterThan(-1);
    expect(
      Math.max(...attaches),
      `${RUN_JS} attaches its \`error\` listener at or after \`await run(\` (last attach at offset ` +
        `${Math.max(...attaches)}, \`await run(\` at ${runCall}). Every byte this CLI puts on stderr is written from ` +
        `inside \`run()\`, so a listener installed there has already missed what it exists to survive — and no runtime ` +
        `case in this file can see that, because both have happened by the time the probe looks.`,
    ).toBeLessThan(runCall);
  });

  it("keeps the probe's mirror of the listener name equal to the entry's own", () => {
    // The probe cannot import the name — `bin/run.js` runs the CLI at module
    // top — so it mirrors it, and a mirror with nothing holding it is how a
    // synchronisation point ends up waiting for a spelling that moved. Same
    // discipline as `run-dev-unbuilt-workspace.e2e.test.ts` keeps over the
    // shim's drain bound. ⛔ A renamed listener would not red the cases above:
    // the probe would simply time out and write early, which on a fast box
    // still survives.
    const mirrored = /const LISTENER_NAME = '([A-Za-z0-9_$]+)';/.exec(readFileSync(PROBE, 'utf8'))?.[1];
    expect(mirrored, `no LISTENER_NAME declaration found in ${PROBE}`).toBeDefined();
    const entry = maskComments(readFileSync(RUN_JS, 'utf8'));
    expect(
      entry,
      `${RUN_JS} does not attach a listener named ${mirrored}, which is the name the probe waits for — ` +
        `either the entry renamed it or it stopped attaching one at all.`,
    ).toContain(`function ${mirrored}(`);
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
    // hazard is re-armed against the same tree in the same run. It removes the
    // entry's listener BY NAME rather than clearing the stream: the control has
    // to be "the entry's guard is gone", and a `removeAllListeners('error')`
    // would silently become "nothing is listening at all" the day anything else
    // attaches one — a different experiment from the one this case claims.
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
  it('keeps a RAW stderr write inside `printDiagnostic`, the writer it reproduced on', () => {
    // ⚠️ The reachability half, held rather than assumed. `serve` is what
    // #15564 reproduced on, and only because two things are true of it at once:
    // it writes to stderr WITHOUT `console.error`'s `ignoreErrors` guard, and
    // it stays alive across the write. If that raw write were ever routed
    // through `console.error`, the measurement in this file's header would no
    // longer describe the tree — re-measure before reading the pins above as
    // covering a live hazard.
    //
    // ⛔ ANCHORED ON `printDiagnostic`'S OWN BODY, not on the file. `serve.ts`
    // holds one OTHER `process.stderr.write(` site — the `warn:` adapter it
    // hands `resolveArtifactReference`, for the cache-fallback note an operator
    // must not miss — so a whole-file `toContain` stays green while the ONE
    // writer this reproduction rests on — the boot diagnostic, #7915, the line
    // the crash was measured at — moves to `console.error` and stops being able
    // to crash anything. (Counted on this head: 2 code-position sites, comments
    // masked; the docblocks nearby DISCUSS several more.)
    //
    // ⚠️ Located BY SYMBOL, never by line number. Comments are masked so the
    // docblocks that DISCUSS `process.stderr.write` — including the one
    // directly above this declaration — cannot answer for the call itself.
    const code = maskComments(readFileSync(SERVE_COMMAND, 'utf8'));
    const decl = code.indexOf('const printDiagnostic =');
    expect(
      decl,
      `${SERVE_COMMAND} no longer declares \`const printDiagnostic =\`. That is not automatically a defect, but it ` +
        `is the writer #15564 measured the crash on, so re-locate it by symbol and re-point this case rather than ` +
        `widening it back to the whole file.`,
    ).toBeGreaterThan(-1);
    // Brace-matched over comment-masked source: the body is one statement and
    // carries no braces of its own today, and the length bound below is what
    // keeps a desynchronised match from reporting green against some other
    // writer further down the file.
    const open = code.indexOf('{', decl);
    let depth = 0;
    let end = -1;
    for (let i = open; i >= 0 && i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = end > open ? code.slice(open, end + 1) : '';
    expect(
      body.length,
      `could not read \`printDiagnostic\`'s body out of ${SERVE_COMMAND} — the brace match ran away (${body.length} ` +
        `chars), so this case measured NOTHING. Re-locate the declaration before trusting any verdict from it.`,
    ).toBeGreaterThan(0);
    expect(
      body.length,
      `\`printDiagnostic\`'s body read back as ${body.length} chars, far past the one statement it is — the brace ` +
        `match lost sync, so a hit below would be about some other writer in ${SERVE_COMMAND}.`,
    ).toBeLessThan(1000);
    expect(
      body,
      `\`printDiagnostic\` in ${SERVE_COMMAND} no longer writes to stderr RAW. That is not automatically a defect, ` +
        `but \`console.error\` carries \`ignoreErrors\` and cannot crash this process at any size, so it removes the ` +
        `reproduction #15564 measured — the header above needs re-measuring rather than trusting.`,
    ).toContain('process.stderr.write(');
  });
});
