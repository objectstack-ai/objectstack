// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor` says WHY the config could not be loaded (#5403).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The config-analysis `catch` took no binding — `catch {` — so the error object
 * was discarded at the point it was caught:
 *
 *     $ cat objectstack.config.ts
 *     throw new Error('this config is genuinely broken');
 *
 *     $ os doctor
 *       → Loading configuration for analysis...
 *       ⚠ Could not load config for analysis (config checks skipped)
 *
 *     ⚠️  Environment is functional but has some warnings.
 *
 * `this config is genuinely broken` appeared nowhere, and no flag could reveal
 * it: the sentence came from a bare `printWarning`, not from a
 * `HealthCheckResult`, so `--verbose` had no `fix` to expand. Meanwhile
 * `os serve`, in that same directory, prints the error in full. The diagnostic
 * command returned STRICTLY LESS than the command it exists to diagnose, at the
 * one moment it is most needed.
 *
 * ── Why this is a separate issue from the three before it ────────────────
 *
 * #5382 → #5387 → #5397 fixed this sentence's ATTRIBUTION: first by lifting the
 * tenancy-posture throw out of this `catch`, then by letting doctor's
 * env-derived checks read serve's `.env*` cascade, then by loading the config
 * itself under that cascade. After all three, a run that reaches this `catch`
 * has a genuinely broken config — `os serve` cannot load it either. #5403 is
 * about what the sentence SAYS once it is finally saying it about the right
 * thing.
 *
 * ── What is pinned here ──────────────────────────────────────────────────
 *
 *   • the cause reaches the terminal, quoted from the thrower, not paraphrased;
 *   • the recognizable sentence SURVIVES verbatim as the head of the row —
 *     sibling tests assert its absence to mean "the config loaded", and two
 *     changesets quote it;
 *   • the verdict stays a `warning`, exit 0, rest of the report still runs
 *     (#5397's "not a silencer" constraint, from the other direction);
 *   • the row goes through the ONE `HealthCheckResult` renderer, so `--verbose`
 *     expands it exactly like `Environment files` / `Tenancy posture`;
 *   • #5397's `.env*` overlay is not regressed: a config that throws only
 *     without its `.env` value must still never reach this path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor, { configLoadFailureCheck } from './doctor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/cli` — the oclif root the real command is loaded against below. */
const CLI_ROOT = path.resolve(HERE, '..', '..');

/**
 * The escape is written as `\x1b`, never as the byte itself: one raw control
 * character makes `grep` treat the whole file as binary, and a test file no
 * `git grep` can find stops being maintained (#4890 / #5157).
 */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

/** The sentence three issues spent their effort making true. It must survive. */
const HEADLINE = 'Could not load config for analysis (config checks skipped)';

/** The issue's own repro anchor. */
const BROKEN = 'this config is genuinely broken';

describe('configLoadFailureCheck — the finding the discarded error used to be', () => {
  it('quotes the thrown message, in the row AND in the verbose detail', () => {
    const check = configLoadFailureCheck(new Error(BROKEN));

    // Before #5403 this string existed only inside a `catch` that named
    // nothing. Both channels carry it now: the row so a plain `os doctor` is
    // actionable, the `fix` so `--verbose` has the untruncated original.
    expect(check.message).toContain(BROKEN);
    expect(check.fix).toContain(BROKEN);
  });

  it('keeps the recognizable sentence intact at the head of the row', () => {
    const check = configLoadFailureCheck(new Error(BROKEN));

    // Load-bearing, not cosmetic: `doctor-config-env-overlay.test.ts` and
    // `doctor-tenancy-posture-report.test.ts` assert this string's ABSENCE to
    // mean "the config loaded fine". Rewording it would leave those assertions
    // passing for the empty reason that nothing matches them any more.
    expect(check.message.startsWith(`${HEADLINE} — `)).toBe(true);
  });

  it('stays a warning, and stays a named row like every other check', () => {
    const check = configLoadFailureCheck(new Error(BROKEN));

    // #5397's constraint, restated from the other side: the point of #5403 is
    // that the warning says more, never that it says it louder. A broken config
    // does not stop doctor from finishing, and does not fail the run.
    expect(check.status).toBe('warning');
    // A `name` is what makes it renderable by the shared renderer at all — the
    // bare `printWarning` it replaces had no such column.
    expect(check.name).toBe('Config load');
  });

  it('points at `os serve` and says the skipped checks were skipped, not passed', () => {
    const fix = configLoadFailureCheck(new Error(BROKEN)).fix ?? '';

    expect(fix).toContain('os serve');
    // The second half of the harm the issue describes: a reader who sees the
    // config-aware sections simply missing from the report can otherwise read
    // their silence as a clean bill of health.
    expect(fix).toContain('SKIPPED, not passed');
  });

  it('folds a multi-line cause onto the row WITHOUT losing the informative line', () => {
    // esbuild's shape, and the reason the row is not simply `cause.split("\n")[0]`:
    // the first line is the least informative thing the failure has to say.
    const esbuild = new Error(
      'Build failed with 1 error:\nobjectstack.config.ts:3:0: ERROR: Expected ";" but found "}"',
    );
    const check = configLoadFailureCheck(esbuild);

    expect(check.message).toContain('Build failed with 1 error:');
    expect(check.message).toContain('objectstack.config.ts:3:0');
    expect(check.message).toContain('Expected ";" but found "}"');
    // One row is one line.
    expect(check.message).not.toContain('\n');
    // The verbose channel keeps the original's own line breaks.
    expect(check.fix).toContain('objectstack.config.ts:3:0: ERROR: Expected ";" but found "}"');
  });

  it('clamps an overlong cause on the row and keeps it whole in the detail', () => {
    const long = `HEAD ${'x'.repeat(4000)} TAIL`;
    const check = configLoadFailureCheck(new Error(long));

    expect(check.message).toContain('HEAD ');
    expect(check.message).toContain('…');
    expect(check.message.length).toBeLessThan(260);
    // Truncation is a property of the ROW, never of the record: `--verbose`
    // hands over every character the thrower wrote.
    expect(check.fix).toContain('TAIL');
    expect(check.fix).toContain('x'.repeat(4000));
  });

  it('never trails off into nothing when the Error carries no message', () => {
    // `throw new Error()` and `throw new TypeError()` are rare but real, and a
    // headline ending in a bare dash is the same "no information" defect this
    // issue is about, reintroduced at the edge.
    const check = configLoadFailureCheck(new TypeError());

    expect(check.message.endsWith('— ')).toBe(false);
    expect(check.message).toContain('TypeError');
  });

  it('reports a thrown non-Error rather than swallowing it', () => {
    // A config is arbitrary user code; `throw 'boom'` is legal.
    expect(configLoadFailureCheck('boom').message).toContain('boom');
    expect(configLoadFailureCheck(42).message).toContain('42');
  });
});

describe('os doctor, end to end, against a config that cannot be loaded', () => {
  /**
   * `node_modules/` exists in the temp cwd on purpose — without it doctor's
   * `Dependencies` check is itself an `error` and exits 1 on its own, which
   * would make an assertion pass for a reason having nothing to do with this
   * change (the trap PR #5390 wrote down and #5398 / #5402 inherited).
   */
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5403-e2e-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const writeFile = (name: string, body: string) => fs.writeFileSync(path.join(tmp, name), body);

  async function runDoctor(argv: string[] = []): Promise<{ out: string; exitCode: number | undefined }> {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    try {
      await Doctor.run(argv, { root: CLI_ROOT });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__PROCESS_EXIT__')) throw err;
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
    return { out: plain(logs.join('\n')), exitCode };
  }

  it('prints the cause on a plain run — the issue’s own repro', async () => {
    writeFile('objectstack.config.ts', `throw new Error('${BROKEN}');\n`);

    const run = await runDoctor();

    // THE assertion of this issue. Before #5403 this string appeared nowhere in
    // any doctor output, under any flag, while `os serve` printed it in full.
    expect(run.out).toContain(BROKEN);
    // …without losing the sentence that says what was skipped.
    expect(run.out).toContain(HEADLINE);
    // Rendered through the shared renderer, so it carries a name column like
    // every other health check rather than being a naked one-liner.
    expect(run.out).toContain('Config load');
    // Gauge unchanged: warning, report finishes, exit 0.
    expect(run.out).toContain('Environment is functional but has some warnings');
    expect(run.exitCode).toBeUndefined();
  }, 60_000);

  it('expands the full detail under --verbose, and only under --verbose', async () => {
    writeFile('objectstack.config.ts', `throw new Error('${BROKEN}');\n`);

    const plainRun = await runDoctor();
    const verboseRun = await runDoctor(['--verbose']);

    // The `fix` channel follows the ONE rule every other warning follows:
    // shown when asked for, or when the finding is an error. This row is a
    // warning, so a default run stops at the (bounded) headline.
    expect(plainRun.out).not.toContain('cause:');
    expect(verboseRun.out).toContain('cause:');
    expect(verboseRun.out).toContain(BROKEN);
    // The verbose block is what tells the reader the skipped checks are not
    // silent passes.
    expect(verboseRun.out).toContain('SKIPPED, not passed');
    expect(verboseRun.exitCode).toBeUndefined();
  }, 60_000);

  it('surfaces a SYNTAX error’s file and reason, not just “build failed”', async () => {
    // The bundle never runs the file here, so the failure comes from esbuild
    // rather than from user code — a different authority, quoted the same way.
    writeFile('objectstack.config.ts', 'export default { manifest: { name: "broken",\n');

    const run = await runDoctor();

    expect(run.out).toContain(HEADLINE);
    expect(run.out).toContain('objectstack.config.ts');
    expect(run.exitCode).toBeUndefined();
  }, 60_000);

  it('does NOT fire for a config that only needed its .env — #5397 is not regressed', async () => {
    // The load-bearing overlay: `loadConfig()` runs inside
    // `withDotenvOverlayAsync`, and the async variant is what survives the
    // dynamic `import()` the bundle performs. If this change broke that, the
    // config below would throw and this row would appear.
    writeFile('.env', 'OS_5403_DB_URL=postgres://from-dotenv/db\n');
    writeFile(
      'objectstack.config.ts',
      [
        'const url = process.env.OS_5403_DB_URL;',
        "if (!url) throw new Error('OS_5403_DB_URL is required');",
        'export default {',
        "  manifest: { name: 'os5403', label: 'Config Load Cause', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );

    const run = await runDoctor(['--verbose']);

    expect(run.out).not.toContain(HEADLINE);
    expect(run.out).not.toContain('Config load ');
    expect(run.out).not.toContain('OS_5403_DB_URL is required');
    // The checks ran rather than merely not failing.
    expect(run.out).toContain('No circular references detected');
    // The overlay left no residue behind it.
    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_5403_DB_URL')).toBe(false);
  }, 60_000);

  it('says nothing at all when the config loads — the row is a finding, not a status line', async () => {
    writeFile(
      'objectstack.config.ts',
      [
        'export default {',
        "  manifest: { name: 'os5403ok', label: 'Healthy', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );

    const run = await runDoctor(['--verbose']);

    expect(run.out).not.toContain('Config load');
    expect(run.out).not.toContain(HEADLINE);
  }, 60_000);
});
