// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor` loads `objectstack.config.ts` under the `.env*` cascade `os serve`
 * loads it under (#5397).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * #5387 taught doctor to READ serve's `.env*` cascade, but applied the overlay
 * around one reader only: the env-derived checks (the tenancy posture, and the
 * ADR-0120 D5e advisory gated on it). `loadConfig()` was left outside it. So the
 * two commands still bundled the user's config file under two different
 * environments:
 *
 *     # .env
 *     OS_DATABASE_URL=postgres://…
 *
 *     # objectstack.config.ts — reading env at top level is the ordinary shape
 *     const url = process.env.OS_DATABASE_URL;
 *     if (!url) throw new Error('OS_DATABASE_URL is required');
 *
 *     $ os serve    # dotenvFlow.config() (serve.ts:520) THEN bundleRequire → boots
 *     $ os doctor   # bundleRequire with no overlay  → throws → caught by the
 *                   # wide config-analysis `try` → "⚠ Could not load config for
 *                   # analysis (config checks skipped)", warning, exit 0
 *
 * Two distinct harms, and the quiet one is the worse one:
 *
 *   1. LOUD — the sentence above blames the config file, which is fine, on a
 *      run where `os serve` boots the identical directory. It is the same
 *      misattribution #5382 was opened over, surviving in the one code path
 *      #5387 deliberately left alone.
 *   2. QUIET — a config that merely *branches* on an environment value declares
 *      a different shape for doctor than for the server, so every check below
 *      (circular deps, unused objects, orphan views, dashboard integrity, spec
 *      version) judged a config the server never runs. Nothing is printed. This
 *      is the half no warning would ever have surfaced.
 *
 * ── What is pinned here ──────────────────────────────────────────────────
 *
 *   • the config load sees the cascade (both harms, differentially);
 *   • a genuinely broken config STILL warns — the fix must not be a silencer;
 *   • the overlay is bounded: applied, awaited ACROSS the async load, reverted,
 *     including when the load throws (#5387's revert-on-throw pin, one call
 *     shape along);
 *   • the report still names sources and never values, with the config load's
 *     use of the cascade stated in the one place that reports it.
 *
 * The synchronous `withDotenvOverlay` half stays in
 * `doctor-env-provenance.test.ts` (#5387), whose machinery this extends.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor, {
  readDotenvFiles,
  withDotenvOverlay,
  withDotenvOverlayAsync,
  environmentSourcesCheck,
} from './doctor.js';

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

/** Every variable these cases touch, restored between them. */
const TOUCHED = ['OS_5397_PROBE', 'OS_5397_DB_URL', 'OS_5397_FEATURE'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('withDotenvOverlayAsync — the overlay survives the await, then leaves', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5397-unit-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);

  it('still exposes the file value AFTER an await — the reason this variant exists', async () => {
    write('.env', 'OS_5397_PROBE=from-file\n');
    const reading = readDotenvFiles(dir, 'production');

    const seen = await withDotenvOverlayAsync(reading, async () => {
      // The read a config file performs happens inside `bundleRequire`'s dynamic
      // `import()`, i.e. at least one microtask after `loadConfig()` was called.
      // This `await` stands in for that gap.
      await Promise.resolve();
      return process.env.OS_5397_PROBE;
    });

    expect(seen).toBe('from-file');
    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_5397_PROBE')).toBe(false);
  });

  it('the SYNCHRONOUS wrapper does not — pinning why the call site is not "simplified" back', async () => {
    write('.env', 'OS_5397_PROBE=from-file\n');
    const reading = readDotenvFiles(dir, 'production');

    let seenAfterAwait: string | undefined = 'sentinel';
    const pending = withDotenvOverlay(reading, async () => {
      await Promise.resolve();
      seenAfterAwait = process.env.OS_5397_PROBE;
    });

    // `withDotenvOverlay` returned the instant its callback handed back a
    // pending promise, and its `finally` has already run — so by the time the
    // callback resumes, the overlay it was given is gone. Swapping the async
    // wrapper for the sync one at the config call site therefore does not fail
    // loudly; it silently applies an overlay nothing ever reads, which is the
    // bug this change fixes, restored. That is worth a test rather than a
    // comment.
    await pending;
    expect(seenAfterAwait).toBeUndefined();
  });

  it('never overwrites a value the shell already set', async () => {
    write('.env', 'OS_5397_PROBE=from-file\n');
    process.env.OS_5397_PROBE = 'from-shell';
    const reading = readDotenvFiles(dir, 'production');

    // dotenv-flow's precedence, unchanged: `os serve` would not overwrite it
    // either, so the config file really does see the shell's value there.
    const seen = await withDotenvOverlayAsync(reading, async () => process.env.OS_5397_PROBE);
    expect(seen).toBe('from-shell');
    expect(process.env.OS_5397_PROBE).toBe('from-shell');
  });

  it('reverts when the awaited callback REJECTS — the config-throws path is the normal one', async () => {
    write('.env', 'OS_5397_PROBE=from-file\n');
    const reading = readDotenvFiles(dir, 'production');

    // A config that throws on a missing value is precisely the case #5397 was
    // opened about, so the rejecting path is the one this feature exists for,
    // not an edge. A `finally` that only ran on success would leak the overlay
    // into the rest of the run on exactly the runs that report a problem —
    // #5387 pinned the same thing for the synchronous wrapper.
    await expect(
      withDotenvOverlayAsync(reading, async () => {
        await Promise.resolve();
        throw new Error('config boom');
      }),
    ).rejects.toThrow('config boom');

    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_5397_PROBE')).toBe(false);
  });

  it('leaves a variable the callback deliberately changed alone', async () => {
    write('.env', 'OS_5397_PROBE=from-file\n');
    const reading = readDotenvFiles(dir, 'production');

    await withDotenvOverlayAsync(reading, async () => {
      process.env.OS_5397_PROBE = 'rewritten';
    });
    // dotenv-flow's own `unload()` test, shared with the synchronous wrapper
    // rather than restated: delete only what still holds the value written.
    expect(process.env.OS_5397_PROBE).toBe('rewritten');
  });
});

describe('environmentSourcesCheck — the config load is reported, not silent', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5397-report-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('says the same files are applied while the config is loaded', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'OS_5397_DB_URL=postgres://secret-host/db\n');
    const check = environmentSourcesCheck(readDotenvFiles(dir, 'production'), {} as NodeJS.ProcessEnv);
    const text = plain(`${check.message}\n${check.fix ?? ''}`);

    // A config file reads whatever variables its author chose, so the KEYS
    // cannot be enumerated the way `DOCTOR_ENV_INPUTS` are. The files can, and
    // saying which files reach the config load is what keeps a wider overlay a
    // reported fact instead of the silent merge #5387 refused.
    expect(text).toContain('objectstack.config.ts');
    expect(text).toContain('.env');
  });

  it('still reports SOURCES and never VALUES, now that the whole cascade reaches a reader', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'OS_5397_DB_URL=postgres://secret-host/db\n');
    const check = environmentSourcesCheck(readDotenvFiles(dir, 'production'), {} as NodeJS.ProcessEnv);
    const text = plain(`${check.message}\n${check.fix ?? ''}`);

    // The provenance discipline is load-bearing in a way it was not before: the
    // overlay now carries variables doctor never declared, and a `.env` is the
    // usual home for credentials. Doctor prints neither their names nor their
    // values — only the files.
    expect(text).not.toContain('postgres://secret-host/db');
    expect(text).not.toContain('secret-host');
    expect(text).not.toContain('OS_5397_DB_URL');
  });
});

describe('os doctor, end to end, against a config that reads .env at top level', () => {
  /**
   * `node_modules/` exists in the temp cwd on purpose — without it doctor's
   * `Dependencies` check is itself an `error` and exits 1 on its own, which
   * would make an assertion pass for a reason having nothing to do with this
   * change (the trap PR #5390 wrote down and #5398 inherited).
   */
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5397-e2e-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const writeFile = (name: string, body: string) => fs.writeFileSync(path.join(tmp, name), body);

  async function runDoctor(): Promise<{ out: string; exitCode: number | undefined }> {
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
      await Doctor.run([], { root: CLI_ROOT });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__PROCESS_EXIT__')) throw err;
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
    return { out: plain(logs.join('\n')), exitCode };
  }

  it('loads a config that THROWS without its .env value — the misattributed warning is gone', async () => {
    writeFile('.env', 'OS_5397_DB_URL=postgres://from-dotenv/db\n');
    writeFile(
      'objectstack.config.ts',
      [
        "const url = process.env.OS_5397_DB_URL;",
        "if (!url) throw new Error('OS_5397_DB_URL is required');",
        'export default {',
        "  manifest: { name: 'os5397', label: 'Env Overlay', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );

    const run = await runDoctor();

    // Before this change: the bundle threw, the wide `try` swallowed it, and
    // doctor printed a warning about the config — while `os serve`, which loads
    // `.env` before bundling, boots this exact directory.
    expect(run.out).not.toContain('Could not load config for analysis');
    // The config checks did not merely stop failing — they RAN.
    // Both strings below are ROW LABELS used as liveness evidence, not verdicts:
    // the row is printed on either branch, so its presence proves the check
    // executed whatever it concluded. That is why they must track `doctor.ts`'s
    // labels through a rename rather than be relaxed — `Platform spec` became
    // `Platform protocol` when the advisory moved onto `engines.protocol`
    // (#13860), and this assertion is the one consumer that lived outside the
    // suites that rename touched.
    expect(run.out).toContain('Platform protocol');
    expect(run.out).toContain('No circular references detected');
    expect(run.exitCode).toBeUndefined();

    // The overlay must not outlive the load: the next command in the same
    // process would otherwise inherit a value from a file it never read.
    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_5397_DB_URL')).toBe(false);
  }, 60_000);

  it('sees the SHAPE serve sees when the config branches on an env value', async () => {
    // The quiet harm, and the one no warning would ever have surfaced: the
    // config loads fine either way, it just declares something different.
    writeFile(
      'objectstack.config.ts',
      [
        "const beta = process.env.OS_5397_FEATURE === 'on';",
        'export default {',
        "  manifest: { name: 'os5397b', label: 'Branching', version: '1.0.0' },",
        '  objects: [',
        "    { name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] },",
        "    ...(beta ? [{ name: 'beta_widget', label: 'Beta Widget', fields: [{ name: 'name', type: 'text', label: 'Name' }] }] : []),",
        '  ],',
        '};',
        '',
      ].join('\n'),
    );

    // ── Control: the feature is off, and nothing declares `beta_widget` ────
    writeFile('.env', 'OS_5397_FEATURE=off\n');
    const off = await runDoctor();
    expect(off.out).toContain('Object "account" is defined but not referenced');
    expect(off.out).not.toContain('beta_widget');

    // ── The case: one word changed, inside the file doctor used to ignore ──
    writeFile('.env', 'OS_5397_FEATURE=on\n');
    const on = await runDoctor();

    // `os serve` declares `beta_widget` here. Before this change doctor's
    // unused-object pass never saw it, so the diagnostic was reporting on a
    // config the server does not run — silently, with no warning to hint that
    // the two disagreed.
    expect(on.out).toContain('Object "beta_widget" is defined but not referenced');

    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_5397_FEATURE')).toBe(false);
  }, 60_000);

  it('still warns when the config is genuinely broken — the fix is not a silencer', async () => {
    writeFile('.env', 'OS_5397_DB_URL=postgres://from-dotenv/db\n');
    writeFile('objectstack.config.ts', "throw new Error('this config is genuinely broken');\n");

    const run = await runDoctor();

    // With the cascade applied, a config that STILL cannot be loaded is one
    // `os serve` cannot load either — so the warning is now attributed
    // correctly rather than removed. Over-silencing here would have traded a
    // misattributed warning for no warning at all, which is the failure mode
    // the narrow reading of #5397 invites.
    expect(run.out).toContain('Could not load config for analysis (config checks skipped)');
    expect(run.out).toContain('Environment is functional but has some warnings');
  }, 60_000);
});
