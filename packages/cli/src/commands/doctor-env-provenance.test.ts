// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor` reads the `.env*` cascade `os serve` reads, and attributes every
 * value it read (#5387).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `serve` / `dev` / `start` load `.env*` through dotenv-flow before reading a
 * single `OS_*` variable (`serve.ts:520`, `dev.ts`, `start.ts`). `doctor` loaded
 * none — `git grep -n dotenv packages/cli/src/commands/doctor.ts` matched only a
 * comment saying so. So the environment the diagnostic judged and the
 * environment the diagnosed command runs in were not the same environment:
 *
 *     # .env, committed to the repo and shared by the team
 *     OS_TENANCY_POSTURE=isolatd
 *
 *     $ os doctor      # never read .env → posture resolves to single → exit 0
 *     $ os serve       # loads .env → FATAL, refuses to boot (PR #5381's gate)
 *
 * Until #5382 doctor had zero env-derived checks, so this produced no
 * observable difference; #5382 added the first one and this became the residual
 * half of "doctor disagrees with serve" (#4801 / cloud#1020's family).
 *
 * ── What is pinned here ──────────────────────────────────────────────────
 *
 * Both halves of the PM ruling on #5387, because either alone is a defect:
 *
 *   1. doctor mirrors serve's READ ORDER — dotenv-flow, `node_env` derived the
 *      way serve derives it, files beating each other in dotenv-flow's own
 *      precedence and the shell beating all of them;
 *   2. every value is REPORTED WITH ITS SOURCE, and the files are NOT merged
 *      into `process.env` for the run. A silent merge would only move the blind
 *      spot: from "doctor never read my `.env`" to "which of my four `.env*`
 *      files did doctor believe?", with the added surprise of every later
 *      reader in the process inheriting a changed environment.
 *
 * The shell-sourced half of the posture finding stays in
 * `doctor-tenancy-posture-report.test.ts` (#5382), whose call sites this change
 * amended.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor, {
  DOCTOR_ENV_INPUTS,
  doctorNodeEnv,
  readDotenvFiles,
  provenanceOf,
  effectiveEnvValue,
  describeProvenance,
  withDotenvOverlay,
  environmentSourcesCheck,
  resolveTenancyPostureOrFinding,
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
const TOUCHED = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_5387_PROBE'] as const;
let saved: Record<string, string | undefined> = {};
let dir: string;

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5387-'));
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);

describe('doctorNodeEnv — the mode the cascade is resolved for', () => {
  it("is serve's derivation with `--dev` out of the picture: NODE_ENV || production", () => {
    // serve.ts:517-519 reads
    //   flags.dev ? 'development' : (NODE_ENV === 'test' ? 'test' : (NODE_ENV || 'production'))
    // and doctor has no `--dev` flag (the PM ruling on #5387 declined to invent
    // one for this first version). With `flags.dev` false the 'test' branch is a
    // no-op, so these two really are the same expression.
    expect(doctorNodeEnv({} as NodeJS.ProcessEnv)).toBe('production');
    expect(doctorNodeEnv({ NODE_ENV: '' } as NodeJS.ProcessEnv)).toBe('production');
    expect(doctorNodeEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('development');
    expect(doctorNodeEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('test');
    expect(doctorNodeEnv({ NODE_ENV: 'staging' } as NodeJS.ProcessEnv)).toBe('staging');
  });
});

describe("readDotenvFiles — serve's file list, with per-key attribution", () => {
  it("lists only files that exist, in dotenv-flow's ascending priority order", () => {
    write('.env', 'A=base\n');
    write('.env.production', 'A=prod\n');

    const reading = readDotenvFiles(dir, 'production');

    expect(reading.files.map((f) => path.basename(f))).toEqual(['.env', '.env.production']);
    expect(reading.nodeEnv).toBe('production');
    // Later file wins — the same merge `dotenvFlow.parse(list)` performs, which
    // is why the list is walked in this order rather than reversed.
    expect(reading.fileValues.get('A')).toBe('prod');
    expect(path.basename(reading.fileOrigin.get('A')!)).toBe('.env.production');
  });

  it("keeps each variable pointing at the file it won in, not at the last file read", () => {
    write('.env', 'SHARED=base\nONLY_BASE=1\n');
    write('.env.production', 'SHARED=prod\n');

    const reading = readDotenvFiles(dir, 'production');

    // The whole deliverable of #5387 in one assertion: two variables, two
    // different source files, one report. A merged parse cannot say this.
    expect(path.basename(reading.fileOrigin.get('SHARED')!)).toBe('.env.production');
    expect(path.basename(reading.fileOrigin.get('ONLY_BASE')!)).toBe('.env');
  });

  it("skips `.env.local` for node_env=test, exactly as dotenv-flow does for serve", () => {
    write('.env', 'A=base\n');
    write('.env.local', 'A=local\n');

    // dotenv-flow deliberately excludes `.env.local` under "test" so a test run
    // is the same for everyone. Doctor inherits that by CALLING dotenv-flow's
    // `listFiles()` rather than reimplementing the naming convention — a
    // hand-rolled list would have to remember this exception, and would drift.
    expect(readDotenvFiles(dir, 'test').files.map((f) => path.basename(f))).toEqual(['.env']);
    expect(readDotenvFiles(dir, 'development').files.map((f) => path.basename(f)))
      .toEqual(['.env', '.env.local']);
  });

  it('reports an unreadable file instead of throwing out of the whole diagnostic', () => {
    // A directory named `.env` is the cheap portable stand-in for "readFileSync
    // fails": `os serve` loads with `silent: true` and boots without those
    // values, so doctor must not be the one that dies here.
    fs.mkdirSync(path.join(dir, '.env'));

    const reading = readDotenvFiles(dir, 'production');
    expect(reading.error).toBeDefined();
    expect(path.basename(reading.error!.file)).toBe('.env');
  });
});

describe("provenanceOf — serve's precedence, reported rather than merged", () => {
  it("gives the shell priority over every file, matching dotenv-flow's `load()`", () => {
    write('.env', 'OS_TENANCY_POSTURE=group\n');
    process.env.OS_TENANCY_POSTURE = 'isolated';

    const reading = readDotenvFiles(dir, 'production');
    expect(provenanceOf(reading, 'OS_TENANCY_POSTURE')).toEqual({
      name: 'OS_TENANCY_POSTURE',
      source: 'shell',
    });
    expect(effectiveEnvValue(reading, 'OS_TENANCY_POSTURE')).toBe('isolated');
  });

  it('treats an explicitly EMPTY shell value as set — `hasOwnProperty`, not truthiness', () => {
    write('.env', 'OS_TENANCY_POSTURE=group\n');
    process.env.OS_TENANCY_POSTURE = '';

    // dotenv-flow's `load()` skips any name `process.env` already HAS, so
    // `OS_TENANCY_POSTURE=` in the shell really does beat a populated `.env`
    // under `os serve`. Testing truthiness here instead would give doctor a
    // second, quieter precedence rule — and it would disagree with the server
    // on exactly the environments people get wrong.
    const reading = readDotenvFiles(dir, 'production');
    expect(provenanceOf(reading, 'OS_TENANCY_POSTURE').source).toBe('shell');
    expect(effectiveEnvValue(reading, 'OS_TENANCY_POSTURE')).toBe('');
  });

  it('names the winning FILE when the shell has nothing, and `unset` when nobody does', () => {
    write('.env', 'OS_TENANCY_POSTURE=group\n');
    write('.env.production', 'OS_TENANCY_POSTURE=isolated\n');

    const reading = readDotenvFiles(dir, 'production');
    const p = provenanceOf(reading, 'OS_TENANCY_POSTURE');
    expect(p.source).toBe('file');
    expect(path.basename(p.file!)).toBe('.env.production');
    expect(effectiveEnvValue(reading, 'OS_TENANCY_POSTURE')).toBe('isolated');

    expect(provenanceOf(reading, 'OS_MULTI_ORG_ENABLED')).toEqual({
      name: 'OS_MULTI_ORG_ENABLED',
      source: 'unset',
    });
  });
});

describe('withDotenvOverlay — bounded, reverted, never a background merge', () => {
  it('exposes file values to the callback and removes them again afterwards', () => {
    write('.env', 'OS_5387_PROBE=from-file\n');
    const reading = readDotenvFiles(dir, 'production');

    expect(process.env.OS_5387_PROBE).toBeUndefined();
    const seen = withDotenvOverlay(reading, () => process.env.OS_5387_PROBE);
    expect(seen).toBe('from-file');

    // The half that separates this from `dotenvFlow.config()`: after the read,
    // the process is exactly as it was. Nothing later in the run — the config
    // bundle, a spawned tool — silently inherits a different environment.
    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_5387_PROBE')).toBe(false);
  });

  it('never overwrites a value the shell already set, and leaves it alone on the way out', () => {
    write('.env', 'OS_5387_PROBE=from-file\n');
    process.env.OS_5387_PROBE = 'from-shell';
    const reading = readDotenvFiles(dir, 'production');

    expect(withDotenvOverlay(reading, () => process.env.OS_5387_PROBE)).toBe('from-shell');
    expect(process.env.OS_5387_PROBE).toBe('from-shell');
  });

  it('reverts even when the callback throws — the posture resolver throws by design', () => {
    write('.env', 'OS_5387_PROBE=from-file\n');
    const reading = readDotenvFiles(dir, 'production');

    expect(() => withDotenvOverlay(reading, () => { throw new Error('boom'); })).toThrow('boom');
    // `resolveTenancyPosture()` refuses an unrecognized value BY THROWING, so
    // the throwing path is the normal path here, not the exotic one. A `finally`
    // that only ran on success would leak the overlay on exactly the runs that
    // report a problem.
    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_5387_PROBE')).toBe(false);
  });

  it('leaves a variable the callback deliberately changed alone', () => {
    write('.env', 'OS_5387_PROBE=from-file\n');
    const reading = readDotenvFiles(dir, 'production');

    withDotenvOverlay(reading, () => { process.env.OS_5387_PROBE = 'rewritten'; });
    // dotenv-flow's own `unload()` test: delete only what still holds the value
    // that was written. Blind deletion would silently undo a caller's write.
    expect(process.env.OS_5387_PROBE).toBe('rewritten');
  });
});

describe('environmentSourcesCheck — the report line that makes the merge non-silent', () => {
  it('names the files it loaded, the mode, and where each declared input came from', () => {
    write('.env', 'OS_MULTI_ORG_ENABLED=true\n');
    write('.env.production', 'OS_TENANCY_POSTURE=isolated\n');
    const reading = readDotenvFiles(dir, 'production');

    const check = environmentSourcesCheck(reading, {} as NodeJS.ProcessEnv);
    expect(check.status).toBe('ok');
    const text = plain(`${check.message}\n${check.fix ?? ''}`);

    expect(text).toContain('.env, .env.production');
    expect(text).toContain('node_env=production');
    expect(text).toContain('OS_TENANCY_POSTURE from .env.production');
    expect(text).toContain('OS_MULTI_ORG_ENABLED from .env');
  });

  it('reports the SOURCE and not the VALUE — so a future input may carry a secret', () => {
    write('.env', 'OS_TENANCY_POSTURE=isolated\n');
    const reading = readDotenvFiles(dir, 'production');

    const check = environmentSourcesCheck(reading, {} as NodeJS.ProcessEnv);
    const text = plain(`${check.message}\n${check.fix ?? ''}`);

    // `DOCTOR_ENV_INPUTS` is meant to grow as doctor gains env-derived checks,
    // and the next variable added may well be a credential. Printing the source
    // and never the contents is what makes growing that list safe by
    // construction rather than by everyone remembering.
    expect(text).toContain('OS_TENANCY_POSTURE from .env');
    expect(text).not.toContain('isolated');
  });

  it('says so plainly when there is nothing to load', () => {
    const check = environmentSourcesCheck(readDotenvFiles(dir, 'production'), {} as NodeJS.ProcessEnv);
    expect(check.status).toBe('ok');
    expect(plain(check.message)).toContain('No .env* files here');
    expect(plain(check.message)).toContain('no environment input set');
  });

  it('warns — without failing the run — when a `.env*` file cannot be read', () => {
    fs.mkdirSync(path.join(dir, '.env'));
    const check = environmentSourcesCheck(readDotenvFiles(dir, 'production'), {} as NodeJS.ProcessEnv);

    // Warning, not error: `os serve` boots without those values (it loads with
    // `silent: true`), so the environment does start. Doctor's contribution is
    // saying out loud what serve swallows.
    expect(check.status).toBe('warning');
    expect(plain(check.message)).toContain('could not be read');
  });

  it('reports every declared input, including the ones nobody set', () => {
    const check = environmentSourcesCheck(readDotenvFiles(dir, 'production'), {} as NodeJS.ProcessEnv);
    for (const name of DOCTOR_ENV_INPUTS) {
      expect(plain(check.fix ?? '')).toContain(`${name} not set`);
    }
  });

  it("describes the three sources in the operator's vocabulary", () => {
    const reading = readDotenvFiles(dir, 'production');
    expect(describeProvenance(reading, { name: 'X', source: 'shell' as const }))
      .toContain("this process's environment");
    expect(describeProvenance(reading, { name: 'X', source: 'unset' as const })).toContain('not set');
    expect(describeProvenance(reading, { name: 'X', source: 'file' as const, file: path.join(dir, '.env') }))
      .toBe('X from .env');
  });
});

describe('DOCTOR_ENV_INPUTS — the declaration a new env-derived check must join', () => {
  it('declares every `OS_*` variable named anywhere in doctor.ts (drift guard)', () => {
    const source = fs.readFileSync(path.join(HERE, 'doctor.ts'), 'utf-8');
    const named = new Set(source.match(/OS_[A-Z0-9_]+/g) ?? []);

    // The failure mode this guards is specific: someone adds an env-derived
    // check, reads the variable, and the value now silently arrives from a
    // `.env` with nothing in the report saying so — #5387 reintroduced one
    // variable at a time. If a name below is only PROSE and doctor reads
    // nothing, add it to a prose allowance here and say why; if doctor reads
    // it, declare it in DOCTOR_ENV_INPUTS so its provenance is reported.
    const PROSE_ONLY = new Set<string>();

    for (const name of named) {
      if (PROSE_ONLY.has(name)) continue;
      expect(DOCTOR_ENV_INPUTS as readonly string[]).toContain(name);
    }
    // Guard the guard: a regex that matched nothing would pass vacuously.
    expect(named.size).toBeGreaterThan(0);
  });
});

describe('the posture finding reads .env and says which file it came from', () => {
  it('finds an invalid posture that lives ONLY in a committed .env — the #5387 repro', () => {
    write('.env', 'OS_TENANCY_POSTURE=isolatd\n');
    const reading = readDotenvFiles(dir, 'production');

    const verdict = resolveTenancyPostureOrFinding(reading);
    if (verdict.ok) throw new Error('expected a finding: the .env value is not a posture');

    const text = plain(`${verdict.result.message}\n${verdict.result.fix ?? ''}`);
    // Before #5387 this was `{ ok: true, posture: 'single' }` — doctor never
    // read the file, so it reported a healthy environment `os serve` refuses to
    // boot.
    expect(verdict.result.status).toBe('error');
    expect(text).toContain('OS_TENANCY_POSTURE="isolatd"');
    // …and the attribution, which is the half a silent `dotenvFlow.config()`
    // would not have given: WHICH of the files it read set this.
    expect(text).toContain('Read from .env');
    expect(text).toContain('node_env=production');

    // Reading it must not leave it behind.
    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_TENANCY_POSTURE')).toBe(false);
  });

  it('attributes to the highest-priority file when several set it', () => {
    write('.env', 'OS_TENANCY_POSTURE=isolated\n');
    write('.env.production', 'OS_TENANCY_POSTURE=isolatd\n');

    const verdict = resolveTenancyPostureOrFinding(readDotenvFiles(dir, 'production'));
    if (verdict.ok) throw new Error('expected a finding');

    const text = plain(`${verdict.result.message}\n${verdict.result.fix ?? ''}`);
    expect(text).toContain('Read from .env.production');
    // Naming `.env` here would send the operator to edit a file whose value
    // never reaches the server.
    expect(text).not.toContain('Read from .env —');
  });

  it('lets the shell override a broken .env, because that is what `os serve` does', () => {
    write('.env', 'OS_TENANCY_POSTURE=isolatd\n');
    process.env.OS_TENANCY_POSTURE = 'group';

    // Not a leniency: `dotenvFlow.config()` does not overwrite a variable the
    // shell defined, so this environment really does boot as `group`. Doctor
    // reporting the `.env` typo as fatal here would be a false alarm about a
    // value nothing reads.
    expect(resolveTenancyPostureOrFinding(readDotenvFiles(dir, 'production')))
      .toEqual({ ok: true, posture: 'group' });
  });

  it('derives from OS_MULTI_ORG_ENABLED in a .env when no posture is set anywhere', () => {
    write('.env', 'OS_MULTI_ORG_ENABLED=true\n');
    // The legacy derivation is env-derived too, so it moved with the posture:
    // before #5387 this read `single` while `os serve` read `isolated`.
    expect(resolveTenancyPostureOrFinding(readDotenvFiles(dir, 'production')))
      .toEqual({ ok: true, posture: 'isolated' });
  });
});

describe('os doctor, end to end, against a posture that only exists in .env', () => {
  /**
   * The differential that would have caught #5387, run against the real command
   * in-process: one temp cwd, one variable, changed only inside `.env`.
   *
   * `node_modules/` exists in the temp cwd on purpose — without it doctor's
   * `Dependencies` check is itself an `error` and exits 1 on its own, which
   * would make the interesting assertion pass for a reason having nothing to do
   * with this change (the same trap PR #5390 wrote down).
   */
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5387-e2e-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

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

  it('names the file, refuses to call the environment functional, and exits 1', async () => {
    // ── Control: the same .env, a posture that parses ─────────────────────
    fs.writeFileSync(path.join(tmp, '.env'), 'OS_TENANCY_POSTURE=isolated\n');
    const healthy = await runDoctor();

    expect(healthy.exitCode).toBeUndefined();
    // #10679 — this used to read `toContain('Environment is functional')`, and
    // it passed for a reason that had nothing to do with #5387: the temp cwd
    // has no `packages/spec`, and doctor warned `@objectstack/spec Not built`
    // about that absent workspace on every run. Removing that phantom warning
    // leaves this cwd with no findings at all, so the summary is now the
    // healthy one. What the control actually claims — doctor reached its
    // summary and did NOT refuse to call this environment usable — is what the
    // matcher says instead, and it still cannot pass for the broken leg below
    // (that one prints `Some critical issues found`).
    expect(healthy.out).toMatch(
      /Environment is (healthy and ready for development|functional but has some warnings)/,
    );
    expect(healthy.out).not.toContain('Tenancy posture');
    // The report says what it read even when everything is fine — that is the
    // "not a silent merge" half, and it is only observable on a healthy run.
    expect(healthy.out).toContain('Environment files');
    expect(healthy.out).toContain('OS_TENANCY_POSTURE from .env');

    // ── The case: one character changed, inside the file ──────────────────
    fs.writeFileSync(path.join(tmp, '.env'), 'OS_TENANCY_POSTURE=isolatd\n');
    const broken = await runDoctor();

    // Every one of these was the other way round before #5387: the value lived
    // in a file doctor never opened, so the run said nothing about it and
    // exited 0 while `os serve` refused to boot the same directory.
    expect(broken.out).toContain('OS_TENANCY_POSTURE="isolatd"');
    expect(broken.out).toContain('is not a recognized tenancy posture');
    expect(broken.out).toContain('Read from .env');
    expect(broken.out).not.toContain('Environment is functional');
    expect(broken.exitCode).toBe(1);

    // And the retired sentence is gone from the REAL output, not just from the
    // unit under test: doctor no longer tells the operator it skipped `.env*`.
    expect(broken.out).not.toContain('does not\n      load `.env*` files');

    // The run must not have left the file's value in this process — the next
    // command in the same process would otherwise inherit it.
    expect(Object.prototype.hasOwnProperty.call(process.env, 'OS_TENANCY_POSTURE')).toBe(false);
    // 60s, not the 5s default: this case runs the REAL doctor command
    // in-process twice, and each run shells out to `pnpm -v`, `tsc -v` and
    // `git --version`. A loaded merge-queue shard blew the 5s default for PR
    // #5381's equivalent case (queue run 30971902650) and took that PR out of
    // the queue.
  }, 60_000);
});
