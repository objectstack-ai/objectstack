// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor`'s unset-`NODE_ENV` row (#5673).
 *
 * ── What #5673 was ───────────────────────────────────────────────────────
 *
 * One fact — "the operator never set `NODE_ENV`" — had two opposite readings in
 * this repo. `os start` forced `production` (`start.ts:248`), `os serve` and
 * `doctorNodeEnv()` derived `NODE_ENV || 'production'`, and the `/discovery`
 * `environment` field advertised `development`. The maintainer's 2026-08-06
 * ruling unified them on `production` — the conservative answer, because a
 * client reads `environment` to decide whether it is talking to production and
 * the dangerous direction of error is claiming `development` on a real one.
 *
 * Unifying the readings makes the default SAFE. It does not make it VISIBLE:
 * afterwards an oversight and a deliberate production deployment produce
 * byte-identical reports. The second half of the ruling — this file's subject —
 * asked doctor to say the default out loud instead of leaving it documented.
 *
 * ── What this file pins, and what it deliberately does not ───────────────
 *
 * It pins the ROW: that it exists exactly when the variable is unset, that it
 * says both halves of the sentence ("treated as production" + "set it
 * explicitly"), and that it is a `warning` rather than an `error`. The severity
 * is load-bearing and not cosmetic: doctor's display loop derives `hasErrors`
 * from this field and `hasErrors` is what calls `process.exit(1)`. An unset
 * `NODE_ENV` must not fail anyone's health check.
 *
 * It does NOT re-pin `doctorNodeEnv()`'s own derivation — that is
 * `doctor-env-provenance.test.ts`'s subject and was already correct before
 * #5673 (it is the alignment TARGET, not a thing this issue changed). What is
 * pinned here instead is the CORRESPONDENCE: the row appears exactly when
 * `doctorNodeEnv()` fell back to its default, so the row cannot start claiming
 * a default that was not taken.
 *
 * The `/discovery` half of the same ruling lives in
 * `packages/runtime/src/discovery-schema-conformance.test.ts`.
 *
 * ── #22163: one posture where the row reads as development ──────────────
 *
 * The maintainer's direction on #22163: beside an `objectstack.config.ts` with
 * no artifact from elsewhere — the source checkout `os dev` serves — an unset
 * `NODE_ENV` reads as development; everywhere else #5673's row stands. So the
 * cases below that pin the `warning` are the cases OUTSIDE that posture (an
 * empty temp directory, or an explicit `sourcePosture: false`), and the
 * `#22163` blocks pin the posture itself and the row it selects. The new row's
 * wording is pinned only by the subjects it names (`os dev`, `os start`) and by
 * the production sentence being absent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor, { nodeEnvCheck, nodeEnvSourcePosture, doctorNodeEnv } from './doctor.js';

/** `packages/cli` — the oclif root the real command is loaded against below. */
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `chalk` may or may not emit SGR codes depending on TTY detection.
 *
 * The escape is written as `\x1b`, never as the byte itself: one raw control
 * character makes grep treat the whole file as binary, and a test file no
 * `git grep` can find stops being maintained (#4890 / #5157).
 */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

describe('[#5673] nodeEnvCheck — the row, and when it exists', () => {
  it('produces a finding when NODE_ENV is unset', () => {
    const finding = nodeEnvCheck({} as NodeJS.ProcessEnv);
    expect(finding).toBeDefined();
    expect(finding!.name).toBe('NODE_ENV');
  });

  it('produces NOTHING for every environment that set the variable', () => {
    for (const value of ['production', 'development', 'test', 'staging', 'sandbox', 'qa']) {
      expect(nodeEnvCheck({ NODE_ENV: value } as NodeJS.ProcessEnv), value).toBeUndefined();
    }
  });

  it("treats `NODE_ENV=` as unset — the same collapse doctorNodeEnv() makes", () => {
    // `doctorNodeEnv({ NODE_ENV: '' })` is already `production` (pinned in
    // doctor-env-provenance.test.ts). If this check disagreed, doctor would
    // resolve the cascade for a default it then refused to mention.
    expect(nodeEnvCheck({ NODE_ENV: '' } as NodeJS.ProcessEnv)).toBeDefined();
  });

  it('appears exactly when doctorNodeEnv() fell back to its default', () => {
    // The correspondence, not a restatement of either function. The row claims
    // "a default was taken"; this is the assertion that the claim is true for
    // every input, including the ones where NODE_ENV is set to the default's own
    // value (`production` — set explicitly, so no default was taken, so no row).
    const cases: Array<NodeJS.ProcessEnv> = [
      {},
      { NODE_ENV: '' },
      { NODE_ENV: 'production' },
      { NODE_ENV: 'development' },
      { NODE_ENV: 'test' },
    ] as NodeJS.ProcessEnv[];

    for (const env of cases) {
      const defaulted = !env.NODE_ENV;
      expect(nodeEnvCheck(env) !== undefined, JSON.stringify(env)).toBe(defaulted);
      // …and when it was taken, the value taken really is `production`.
      if (defaulted) expect(doctorNodeEnv(env)).toBe('production');
    }
  });

  it('is a WARNING — the severity that leaves doctor exiting 0', () => {
    // `status` is what doctor's display loop turns into `hasErrors` /
    // `hasWarnings`, and `hasErrors` is the only path to `process.exit(1)`.
    // Nothing here is broken: the environment starts, in the mode the row names.
    expect(nodeEnvCheck({} as NodeJS.ProcessEnv)!.status).toBe('warning');
  });

  it('says BOTH halves: what is happening now, and what to do about it', () => {
    const finding = nodeEnvCheck({} as NodeJS.ProcessEnv)!;
    const text = plain(`${finding.message}\n${finding.fix ?? ''}`);

    // Half one — the fact. Without this the row is a nag with no content.
    expect(finding.message).toContain('production');
    expect(text).toMatch(/not set/i);

    // Half two — the way out, spelled as the two commands an operator can type.
    expect(text).toContain('NODE_ENV=production');
    expect(text).toContain('NODE_ENV=development');

    // …and the one thing a reader would otherwise get wrong: this variable
    // cannot be supplied by a `.env*` file, because it selects which of them
    // load. Doctor's whole environment block is about `.env*` provenance, so
    // omitting this invites exactly the wrong fix.
    expect(text).toContain('.env*');
  });
});

describe('[#22163] nodeEnvCheck — which row the posture selects', () => {
  it('in the source posture: `ok`, naming `os dev` and `os start`, with no fix', () => {
    const finding = nodeEnvCheck({} as NodeJS.ProcessEnv, { sourcePosture: true })!;

    expect(finding.name).toBe('NODE_ENV');
    // `ok` renders `✓` and can never reach `hasWarnings` / `hasErrors`.
    expect(finding.status).toBe('ok');
    expect(finding.message).toContain('os dev');
    expect(finding.message).toContain('os start');
    expect(finding.message).not.toContain('treated as production');
    // Nothing to fix, so nothing for `--verbose` to expand.
    expect(finding.fix).toBeUndefined();
  });

  it("outside it: the #5673 warning and its fix, exactly what every existing caller gets", () => {
    // The default IS "outside": a caller that never asked about the posture —
    // every caller before #22163 — keeps the conservative row. The describe
    // block above pins that row's halves; this pins that the explicit `false`
    // is the same object, field for field.
    const explicit = nodeEnvCheck({} as NodeJS.ProcessEnv, { sourcePosture: false });
    expect(explicit).toEqual(nodeEnvCheck({} as NodeJS.ProcessEnv));
    expect(explicit!.status).toBe('warning');
    expect(explicit!.fix).toBeDefined();
  });

  it('a SET NODE_ENV prints no row in either posture', () => {
    for (const sourcePosture of [true, false]) {
      for (const value of ['production', 'development']) {
        expect(nodeEnvCheck({ NODE_ENV: value } as NodeJS.ProcessEnv, { sourcePosture }), `${value}/${sourcePosture}`)
          .toBeUndefined();
      }
    }
  });
});

describe('[#22163] nodeEnvSourcePosture — the source checkout `os dev` serves', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-22163-posture-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  const NO_ENV = {} as NodeJS.ProcessEnv;
  const CONFIG = 'export default {};\n';

  it('a config alone is the source posture', () => {
    write('objectstack.config.ts', CONFIG);
    expect(nodeEnvSourcePosture(dir, NO_ENV)).toBe(true);
  });

  it('…and stays so beside its OWN compiled `dist/objectstack.json` — the file the first `os dev` writes', () => {
    write('objectstack.config.ts', CONFIG);
    write('dist/objectstack.json', '{}\n');
    expect(nodeEnvSourcePosture(dir, NO_ENV)).toBe(true);
  });

  it('a config beside a NAMED artifact is not: OS_ARTIFACT_PATH elsewhere, or OS_ARTIFACT_URL', () => {
    write('objectstack.config.ts', CONFIG);
    const elsewhere = path.join(dir, 'release', 'objectstack.json');
    expect(nodeEnvSourcePosture(dir, { OS_ARTIFACT_PATH: elsewhere } as NodeJS.ProcessEnv)).toBe(false);
    expect(nodeEnvSourcePosture(dir, { OS_ARTIFACT_URL: 'https://example.invalid/a.json' } as NodeJS.ProcessEnv))
      .toBe(false);
  });

  it('an artifact with no config, and a directory with neither, are not', () => {
    expect(nodeEnvSourcePosture(dir, NO_ENV)).toBe(false);
    write('dist/objectstack.json', '{}\n');
    expect(nodeEnvSourcePosture(dir, NO_ENV)).toBe(false);
  });

  it('reads the artifact variables where `os dev` does: over the node_env=development `.env*` cascade', () => {
    // `os dev` loads `.env*` for development BEFORE it resolves the rungs, so a
    // reference committed to `.env.development` drives its boot — and is a named
    // artifact here too.
    write('objectstack.config.ts', CONFIG);
    write('.env.development', 'OS_ARTIFACT_URL=https://example.invalid/a.json\n');
    expect(nodeEnvSourcePosture(dir, NO_ENV)).toBe(false);
  });

  it('…and not over the production one, which `os dev` never loads', () => {
    write('objectstack.config.ts', CONFIG);
    write('.env.production', 'OS_ARTIFACT_URL=https://example.invalid/a.json\n');
    expect(nodeEnvSourcePosture(dir, NO_ENV)).toBe(true);
  });
});

describe('[#5673] os doctor, end to end — the row reaches the report', () => {
  /**
   * `node_modules/` exists in the temp cwd on purpose — without it doctor's
   * `Dependencies` check is itself an `error` and exits 1 on its own, which
   * would make these assertions pass (or fail) for a reason having nothing to
   * do with this change. Same trap PR #5390 wrote down.
   */
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5673-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

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

  // A real `Doctor.run()` takes seconds (it shells out to `git --version`,
  // walks the workspace and loads config), so every case here carries an
  // explicit timeout instead of racing vitest's 5s default.
  const E2E_TIMEOUT = 60_000;

  it('prints the row when NODE_ENV is unset, and stays exit 0', async () => {
    delete process.env.NODE_ENV;

    const run = await runDoctor();

    expect(run.out).toContain('NODE_ENV');
    expect(run.out).toContain('treated as production');
    // A warning, so the run still calls the environment functional and never
    // reaches `process.exit(1)`.
    expect(run.exitCode).toBeUndefined();
    expect(run.out).toContain('Environment is functional');
  }, E2E_TIMEOUT);

  // Both directions, because "no row" has to hold for the environment that
  // agrees with the default as well as for the one that contradicts it: the row
  // reports that a DEFAULT was taken, not that the mode is production.
  it.each(['development', 'production'])(
    'says nothing about NODE_ENV once the operator set it (NODE_ENV=%s)',
    async (value) => {
      process.env.NODE_ENV = value;

      const run = await runDoctor();

      // The whole sentence is absent, not merely softened: a configured
      // environment's report is what it was before #5673.
      expect(run.out).not.toContain('treated as production');
      expect(run.exitCode).toBeUndefined();
    },
    E2E_TIMEOUT,
  );

  it('routes through the shared renderer — `fix` detail appears only under --verbose', async () => {
    delete process.env.NODE_ENV;

    // #5403's rule: a warning's detail is optional reading, an error's is not.
    // This row is a warning, so its `fix` must be hidden until asked for — the
    // proof that it went through `renderHealthCheckResult` rather than growing
    // a second, flagless format of its own.
    const quiet = await runDoctor();
    expect(quiet.out).not.toContain('NODE_ENV=development');

    const verbose = await runDoctor(['--verbose']);
    expect(verbose.out).toContain('NODE_ENV=development');
    expect(verbose.out).toContain('NODE_ENV=production');
  }, E2E_TIMEOUT);

  // ── #22163 — the posture decides which row, in the real report ──────────
  //
  // The case above IS the "empty directory" leg: its temp cwd holds only
  // `node_modules/`, so it is outside the source posture and keeps the
  // `warning`. The legs below add a config to the same cwd.
  describe('[#22163] the source checkout `os dev` serves reads as development', () => {
    const ARTIFACT_VARS = ['OS_ARTIFACT_URL', 'OS_ARTIFACT_PATH'] as const;
    let savedArtifactVars: Record<string, string | undefined> = {};

    beforeEach(() => {
      savedArtifactVars = Object.fromEntries(ARTIFACT_VARS.map((k) => [k, process.env[k]]));
      for (const k of ARTIFACT_VARS) delete process.env[k];
      // The scaffold's own first line. Nothing under this temp cwd can resolve
      // it (its `node_modules/` is empty), so the config LOAD fails — on
      // purpose: the posture is read from the file's presence, never from a
      // load, and these legs prove it by passing beside a failed one.
      fs.writeFileSync(
        path.join(tmp, 'objectstack.config.ts'),
        "import { defineStack } from '@objectstack/spec';\nexport default defineStack({});\n",
      );
    });

    afterEach(() => {
      for (const k of ARTIFACT_VARS) {
        if (savedArtifactVars[k] === undefined) delete process.env[k];
        else process.env[k] = savedArtifactVars[k];
      }
    });

    /** The report rows whose name column is `NODE_ENV`. */
    const nodeEnvRows = (out: string) => out.split('\n').filter((line) => /^\s*\S+\s+NODE_ENV {2,}/.test(line));

    it('(a) a config alone: the development row, beside a config that did not load', async () => {
      delete process.env.NODE_ENV;

      const run = await runDoctor();

      const rows = nodeEnvRows(run.out);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('✓');
      expect(rows[0]).toContain('os dev');
      expect(rows[0]).toContain('os start');
      expect(run.out).not.toContain('treated as production');
      // The load really failed, so the row above was not decided by it.
      expect(run.out).toContain('Could not load config for analysis');
      expect(run.exitCode).toBeUndefined();
    }, E2E_TIMEOUT);

    it('(b) …and still after the first `os dev` compiled it to `dist/objectstack.json`', async () => {
      delete process.env.NODE_ENV;
      fs.mkdirSync(path.join(tmp, 'dist'));
      fs.writeFileSync(path.join(tmp, 'dist', 'objectstack.json'), '{}\n');

      const run = await runDoctor();

      const rows = nodeEnvRows(run.out);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('os dev');
      expect(run.out).not.toContain('treated as production');
      expect(run.exitCode).toBeUndefined();
    }, E2E_TIMEOUT);

    it('(c) a config beside an OS_ARTIFACT_PATH naming another artifact: the #5673 warning', async () => {
      delete process.env.NODE_ENV;
      process.env.OS_ARTIFACT_PATH = path.join(tmp, 'release', 'objectstack.json');

      const run = await runDoctor();

      const rows = nodeEnvRows(run.out);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('⚠');
      expect(rows[0]).toContain('treated as production');
      expect(run.exitCode).toBeUndefined();
    }, E2E_TIMEOUT);

    it('(e) NODE_ENV set in the source posture: no row at all', async () => {
      for (const value of ['development', 'production']) {
        process.env.NODE_ENV = value;

        const run = await runDoctor();

        expect(nodeEnvRows(run.out), value).toHaveLength(0);
        expect(run.exitCode).toBeUndefined();
      }
    }, E2E_TIMEOUT * 2);
  });
});
