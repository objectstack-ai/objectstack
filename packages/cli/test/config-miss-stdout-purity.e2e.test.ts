// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--json` ⇒ ONE JSON DOCUMENT on stdout when the CONFIG FILE IS MISSING, for
 * the whole `resolveConfigPath` family — and the text face unchanged (#15547).
 *
 * ## The blind spot this exists to close
 *
 * `json-stdout-purity.e2e.test.ts` already pins "stdout is exactly one JSON
 * document" — but it DISCOVERS its family as the commands that call
 * `bootSchemaStack`. The commands here fail at `resolveConfigPath()`, which
 * runs **before** any kernel boots, so that pin structurally cannot see this
 * path and stayed green through the whole defect.
 *
 * What it was green through: `resolveConfigPath()` printed its refusal to
 * stdout and then called `process.exit(1)` directly. Ten published `--json`
 * faces therefore answered a missing config with human text on the machine's
 * channel; and because nothing was thrown, every command's catch-all `--json`
 * error exit — all of which sit downstream of a throw — never ran.
 *
 * ⇒ The instrument was as broken as the code, so the population is widened
 * across a PAIR of files rather than left to one: the discovery lives in
 * `helpers/config-miss-family.ts`, this file drives it, and the sibling pin
 * reconciles against it. See that helper's header for why it is not inlined.
 *
 * ## What changed here when the refusals started throwing
 *
 * This file's first version asserted only that stdout carried nothing a
 * machine could not read — empty passed, one JSON document passed, prose
 * failed — because whether these faces should EMIT anything was still an open
 * question then.
 *
 * That question is now ruled: the refusals throw, the ten catch-alls emit the
 * envelopes they had already declared, and **empty stdout no longer passes**.
 * The assertion is tightened to a bare `JSON.parse` accordingly — a face that
 * regressed to exiting with no payload slipped straight through the old form.
 *
 * ⛔ Still NOT pinned here: the envelope's SHAPE. The thrown error carries no
 * `code` and no `httpStatus`, so `errorCodeFields()` contributes nothing and
 * each face emits its own bare `{ error }`. Whether that is the right shape is
 * **#15549**'s open question; this file asserts that a document arrives and
 * that it names the refusal, never what else is in it, so settling #15549
 * changes the payload without touching this file.
 *
 * ## The text face is pinned by BYTES, not by containment
 *
 * The route ruled out for this card was "make it throw and let the catch-alls
 * render it" — which deletes the helper's hint lines from all ten text faces,
 * because a catch-all can only re-render `error.message`. A `toContain('Hint:')`
 * assertion does not see that loss when one hint line survives and the other
 * does not, so the whole stderr string is compared instead.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import {
  CONFIG_MISS_FAMILY,
  CONFIG_MISS_REFUSAL,
  MISSING_CONFIG,
  discoverConfigMissFamily,
  expectedRefusalStderr,
} from './helpers/config-miss-family.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

interface Run {
  key: string;
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(argv: string[], cwd: string): Promise<Omit<Run, 'key'>> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...argv],
      { cwd, maxBuffer: 32 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err
            ? (typeof (err as { code?: unknown }).code === 'number'
                ? (err as unknown as { code: number }).code
                : 1)
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** `[key, argv]` for every branch of every member — 19 runs across 10 faces. */
function cases(): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const [id, member] of Object.entries(CONFIG_MISS_FAMILY)) {
    const argv = id.split(' ');
    out.push([`${id} (explicit path)`, [...argv, ...member.explicit]]);
    if (member.auto) out.push([`${id} (auto-detect)`, [...argv, ...member.auto]]);
  }
  return out;
}

const branchOf = (key: string): 'explicit' | 'auto' =>
  (key.endsWith('(auto-detect)') ? 'auto' : 'explicit');

let dir: string;
let jsonRuns: Run[];
let textRuns: Run[];

beforeAll(async () => {
  // Deliberately EMPTY — no `objectstack.config.*` here, so the auto-detect
  // branch misses and the explicit branch resolves against a real cwd.
  dir = mkdtempSync(join(tmpdir(), 'os-config-miss-e2e-'));

  // Sequential: nineteen `tsx` starts at once is the kind of load that makes a
  // shared box report timeouts instead of verdicts. BOTH faces are driven —
  // the `--json` half is the contract this card repaired, the text half is the
  // one it had to leave untouched, and only driving the second proves it.
  jsonRuns = [];
  for (const [key, argv] of cases()) {
    const { code, stdout, stderr } = await runCli([...argv, '--json'], dir);
    jsonRuns.push({ key, code, stdout, stderr });
  }
  textRuns = [];
  for (const [key, argv] of cases()) {
    const { code, stdout, stderr } = await runCli(argv, dir);
    textRuns.push({ key, code, stdout, stderr });
  }
}, 900_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('the family this contract has to hold across', () => {
  it('is exactly the set listed here — a new member goes red until it is driven too', () => {
    expect(discoverConfigMissFamily()).toEqual(Object.keys(CONFIG_MISS_FAMILY).sort());
  });

  it('is TEN faces, and names the two a static reading loses', () => {
    // The population is load-bearing rather than incidental: the original card
    // reached nine modules by reading imports, and `os build` declares neither
    // the flag nor the import. A discovery that quietly shrank back to nine
    // would still satisfy the reconciliation above if FAMILY shrank with it,
    // so the count and the two interesting members are asserted directly.
    expect(discoverConfigMissFamily()).toHaveLength(10);
    expect(discoverConfigMissFamily()).toContain('build');
    expect(discoverConfigMissFamily()).toContain('verify');
  });

  it('drives both branches of the helper — 19 runs, not 10', () => {
    expect(cases()).toHaveLength(19);
  });
});

describe.each(cases())('os %s --json, config missing', (key) => {
  const runOf = () => {
    const run = jsonRuns.find((r) => r.key === key);
    if (!run) throw new Error(`no run captured for '${key}'`);
    return run;
  };

  it('emits ONE JSON document on stdout — a bare JSON.parse, no extraction', () => {
    const run = runOf();
    // Under the original defect this was 296 bytes of prose; after #15692 it
    // was ZERO bytes, which `JSON.parse` rejects just as loudly. Both are the
    // failure this asserts against.
    const payload = JSON.parse(run.stdout);
    expect(payload).toBeTypeOf('object');
    expect(payload).not.toBeNull();
  });

  it('names the refusal in the payload, so the machine is told WHY', () => {
    const payload = JSON.parse(runOf().stdout) as { error?: unknown };
    expect(payload.error).toBeTypeOf('string');
    expect(String(payload.error)).toContain(CONFIG_MISS_REFUSAL[branchOf(key)]);
  });

  it('carries no terminal decoration into the payload', () => {
    // The refusal line the operator reads wraps the path in `chalk.white`. The
    // envelope must carry the PLAIN sentence: an escape sequence inside a JSON
    // string is a defect a consumer cannot see coming, and it would appear
    // only in runs that happen to have colour on.
    // eslint-disable-next-line no-control-regex
    expect(runOf().stdout).not.toMatch(/\u001b\[/);
  });

  it('keeps the human refusal off stdout entirely', () => {
    const run = runOf();
    // Asserted separately from the parse so a regression names its cause
    // rather than only `Unexpected token`. The payload's `error` sentence is
    // not this: `Hint:` and the glyph are prose only the text renderer writes.
    expect(run.stdout).not.toContain('Hint:');
    expect(run.stdout).not.toContain('✗');
  });

  it('still shows the operator the refusal — on stderr, byte for byte', () => {
    // Diagnostics are MOVED, never destroyed: the envelope is the machine's
    // copy of this failure and the prose is the human's, and a `--json` run
    // keeps both. A regression toward silencing this path goes red here.
    expect(runOf().stderr).toBe(expectedRefusalStderr(branchOf(key), resolve(dir, MISSING_CONFIG)));
  });

  it('still exits 1', () => {
    expect(runOf().code).toBe(1);
  });
});

describe.each(cases())('os %s (text face), config missing', (key) => {
  const runOf = () => {
    const run = textRuns.find((r) => r.key === key);
    if (!run) throw new Error(`no text run captured for '${key}'`);
    return run;
  };

  it('writes the refusal and every hint line to stderr, byte for byte', () => {
    // Full-string equality, deliberately not `toContain`. The route ruled out
    // for this card kept the first line and dropped the hints; every
    // containment assertion anyone would reach for passes through that loss.
    expect(runOf().stderr).toBe(expectedRefusalStderr(branchOf(key), resolve(dir, MISSING_CONFIG)));
  });

  it('does not print the refusal a SECOND time, on stdout', () => {
    // The helper reports on stderr and throws. A catch-all that then rendered
    // `error.message` through `printError` would put the same sentence on
    // stdout, and the operator would read one failure twice, on two streams.
    const run = runOf();
    expect(run.stdout).not.toContain(CONFIG_MISS_REFUSAL[branchOf(key)]);
    expect(run.stdout).not.toContain('✗');
  });

  it('still exits 1 — not 2', () => {
    // `os compile` (and `os build`, which inherits its catch) ends its text
    // branch in oclif's `this.error()`, which exits 2 and re-renders the
    // sentence as a `›   Error:` block. Measured at 483 stderr bytes and exit
    // 2 while that path was unguarded, against 296 and exit 1 everywhere else.
    expect(runOf().code).toBe(1);
  });
});
