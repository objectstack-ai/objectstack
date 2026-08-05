// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor` does not print `✓ Unique scope` when it could not read the
 * installed-package ledger (#5412).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `readInstalledPackageEntries()` wrapped two unrelated facts in one un-bound
 * `catch` and returned `[]` for both:
 *
 *     try {
 *       const mod = await import('@objectstack/cloud-connection');   // (1)
 *       const dir = path.join(cwd, mod.DEFAULT_INSTALLED_PACKAGES_DIR ?? …);
 *       if (!fs.existsSync(dir)) return [];
 *       return new mod.LocalManifestSource(dir).list();               // (2)
 *     } catch { return []; }
 *
 * (1) is the optional package being absent — silence is correct, `os doctor`
 * must run in a checkout that never had it. (2) is a ledger that EXISTS
 * (`existsSync` already said so) and could not be read. Treated as (1), it
 * reached the ADR-0120 D5e advisory as "no installed packages", the advisory
 * found nothing to report, and the run printed:
 *
 *     ✓ Unique scope          No unconfirmed installation-wide uniques for
 *                             this 'isolated' environment
 *
 * A false PASS, on the one constraint the `isolated` posture makes dangerous.
 *
 * ── Scope boundary this file also pins ───────────────────────────────────
 *
 * The issue's stated repro — a truncated JSON entry inside the ledger — does
 * NOT reach that `catch`, and #5412's fix does not change it.
 * `LocalManifestSource.list()` skips unparseable files in its own per-file
 * `catch` (`packages/cloud-connection/src/local-manifest-source.ts`), so a
 * corrupt entry is dropped inside the PRODUCER and `list()` returns a short
 * list indistinguishable from a complete one. Doctor sees a successful call.
 * That is a real defect of the same family one layer down, it is a
 * cross-package contract change to fix (filed as #5413), and it is pinned here
 * as a boundary (`the corrupt-entry case is NOT covered`) rather than left for
 * the next reader to re-derive — see that test's comment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor, { installedPackageLedgerFailureCheck } from './doctor.js';

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

/** The success line that must NOT appear when only half the check ran. */
const CLEAN_BILL = 'No unconfirmed installation-wide uniques';

/** The head of the row that replaces it. */
const LEDGER_HEADLINE = 'Could not read the installed-package ledger';

describe('installedPackageLedgerFailureCheck — the finding the shared catch used to eat', () => {
  it('quotes what was thrown, in the row AND in the verbose detail', () => {
    const err = Object.assign(new Error("ENOTDIR: not a directory, scandir '/p/.objectstack'"), {
      code: 'ENOTDIR',
    });
    const check = installedPackageLedgerFailureCheck(err);

    // Before #5412 this text existed nowhere in any doctor output under any
    // flag — the error object was discarded at the point it was caught.
    expect(check.message).toContain('ENOTDIR');
    expect(check.fix).toContain("scandir '/p/.objectstack'");
  });

  it('takes the `Unique scope` name column, so the row is present rather than missing', () => {
    const check = installedPackageLedgerFailureCheck(new Error('boom'));

    // Load-bearing, not cosmetic. An operator scans the report by its name
    // column; a separately-named row would leave `Unique scope` simply absent,
    // which is the same silence this issue is about wearing a different hat.
    expect(check.name).toBe('Unique scope');
  });

  it('stays a warning — the environment runs, doctor’s sight of it is what broke', () => {
    expect(installedPackageLedgerFailureCheck(new Error('boom')).status).toBe('warning');
  });

  it('says WHICH half did not run, rather than that "something" failed', () => {
    const check = installedPackageLedgerFailureCheck(new Error('boom'));
    const fix = check.fix ?? '';

    // The harm the issue names is a reader treating a partial check as a whole
    // one. The row has to state its own incompleteness in both channels.
    expect(check.message).toContain('installed packages NOT checked');
    expect(fix).toContain('two halves and only one of them ran');
    expect(fix).toContain('.objectstack/installed-packages/');
  });

  it('folds a multi-line cause onto the row and keeps it whole in the detail', () => {
    const check = installedPackageLedgerFailureCheck(new Error('line one\nline two: the reason'));

    expect(check.message).toContain('line two: the reason');
    // One row is one line.
    expect(check.message).not.toContain('\n');
    expect(check.fix).toContain('line two: the reason');
  });

  it('never trails off into nothing for an Error with no message', () => {
    const check = installedPackageLedgerFailureCheck(new TypeError());

    expect(check.message.endsWith('— ')).toBe(false);
    expect(check.message).toContain('TypeError');
  });

  it('reports a thrown non-Error rather than swallowing it', () => {
    expect(installedPackageLedgerFailureCheck('boom').message).toContain('boom');
    expect(installedPackageLedgerFailureCheck(42).message).toContain('42');
  });
});

describe('os doctor, end to end, against an unreadable installed-package ledger', () => {
  /**
   * `node_modules/` exists in the temp cwd on purpose — without it doctor's
   * `Dependencies` check is itself an `error` and exits 1 on its own, which
   * would make an assertion pass for a reason having nothing to do with this
   * change (the trap PR #5390 wrote down, inherited via #5402 / #5410).
   */
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const savedPosture = process.env.OS_TENANCY_POSTURE;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5412-e2e-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    // D5e's advisory only runs under `isolated` — the posture under which
    // `'global'` stops being unambiguous. Every case below needs it.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = savedPosture;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const LEDGER_REL = '.objectstack/installed-packages';
  const ledgerPath = () => path.join(tmp, LEDGER_REL);

  const writeConfig = () =>
    fs.writeFileSync(
      path.join(tmp, 'objectstack.config.ts'),
      [
        'export default {',
        "  manifest: { name: 'os5412', label: 'Ledger Read', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );

  /** A ledger entry the D5e advisory would have something to say about. */
  const globalUniqueEntry = (manifestId: string) => ({
    manifestId,
    manifest: {
      objects: [
        {
          name: 'invoice',
          label: 'Invoice',
          fields: [{ name: 'code', type: 'text', label: 'Code', unique: 'global' }],
        },
      ],
    },
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

  it('withholds the clean bill of health when the ledger cannot be read', async () => {
    writeConfig();
    // The ledger PATH exists but is not a directory — `fs.existsSync(dir)`
    // passes, `readdirSync` throws ENOTDIR. This is the shape that used to
    // land in the shared `catch` and come back as "nothing installed".
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.writeFileSync(ledgerPath(), 'this is a file, not the ledger directory\n');

    const run = await runDoctor();

    // ① THE assertion of this issue: the false PASS is gone.
    expect(run.out).not.toContain(CLEAN_BILL);
    // ② …replaced by a row that says what was not read, with the cause.
    expect(run.out).toContain(LEDGER_HEADLINE);
    expect(run.out).toContain('ENOTDIR');
    // Rendered through the ONE renderer, so it carries a name column.
    expect(run.out).toContain('Unique scope');
    // Gauge: warning, the report finishes, exit stays 0.
    expect(run.out).toContain('Environment is functional but has some warnings');
    expect(run.exitCode).toBeUndefined();
  }, 60_000);

  it('expands the detail under --verbose, and only under --verbose', async () => {
    writeConfig();
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.writeFileSync(ledgerPath(), 'not a directory\n');

    const plainRun = await runDoctor();
    const verboseRun = await runDoctor(['--verbose']);

    // Warning-tier `fix` follows the same rule every other warning follows —
    // this is what reusing `renderHealthCheckResult()` buys for free.
    expect(plainRun.out).not.toContain('cause:');
    expect(verboseRun.out).toContain('cause:');
    expect(verboseRun.out).toContain('two halves and only one of them ran');
    expect(verboseRun.out).not.toContain(CLEAN_BILL);
    expect(verboseRun.exitCode).toBeUndefined();
  }, 60_000);

  it('still reports this project’s own findings when only the ledger half failed', async () => {
    // The two halves are independent. A ledger failure must not swallow the
    // findings the config half already produced — that would trade one silent
    // omission for another.
    fs.writeFileSync(
      path.join(tmp, 'objectstack.config.ts'),
      [
        'export default {',
        "  manifest: { name: 'os5412u', label: 'Ledger Read', version: '1.0.0' },",
        '  objects: [{',
        "    name: 'account', label: 'Account',",
        "    fields: [{ name: 'taxId', type: 'text', label: 'Tax ID', unique: 'global' }],",
        '  }],',
        '};',
        '',
      ].join('\n'),
    );
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.writeFileSync(ledgerPath(), 'not a directory\n');

    const run = await runDoctor();

    expect(run.out).toContain('account.taxId');
    expect(run.out).toContain(LEDGER_HEADLINE);
    expect(run.out).not.toContain(CLEAN_BILL);
  }, 60_000);

  it('an intact ledger with nothing to report still prints the clean bill — no regression', async () => {
    // ④ The normal D5e path. The new row is a FINDING, not a status line: a
    // readable ledger must leave the report byte-for-byte as it was.
    writeConfig();
    fs.mkdirSync(ledgerPath(), { recursive: true });
    fs.writeFileSync(
      path.join(ledgerPath(), 'clean.json'),
      JSON.stringify({ manifestId: 'clean', manifest: { objects: [] } }),
    );

    const run = await runDoctor(['--verbose']);

    expect(run.out).toContain(CLEAN_BILL);
    expect(run.out).not.toContain(LEDGER_HEADLINE);
  }, 60_000);

  it('an intact ledger WITH a global unique is still reported the way it always was', async () => {
    writeConfig();
    fs.mkdirSync(ledgerPath(), { recursive: true });
    fs.writeFileSync(
      path.join(ledgerPath(), 'billing.json'),
      JSON.stringify(globalUniqueEntry('billing')),
    );

    const run = await runDoctor();

    expect(run.out).toContain('invoice.code');
    expect(run.out).toContain("installed package 'billing'");
    expect(run.out).not.toContain(CLEAN_BILL);
    expect(run.out).not.toContain(LEDGER_HEADLINE);
  }, 60_000);

  it('says nothing about the ledger when there is no ledger at all', async () => {
    // ③, first half. A runtime that never installed anything has no directory,
    // and that is genuinely not a finding. The fix must not turn "never
    // installed" into a warning — that would be the opposite over-correction.
    writeConfig();
    expect(fs.existsSync(ledgerPath())).toBe(false);

    const run = await runDoctor(['--verbose']);

    expect(run.out).toContain(CLEAN_BILL);
    expect(run.out).not.toContain(LEDGER_HEADLINE);
    expect(run.exitCode).toBeUndefined();
  }, 60_000);

  it('⚠ SCOPE BOUNDARY: a CORRUPT ENTRY is still absorbed by the producer', async () => {
    // This pins the issue's own stated repro as NOT FIXED, deliberately, and
    // records why — so the next reader does not re-derive it from scratch or
    // assume #5412 covered it.
    //
    // `LocalManifestSource.list()` skips unparseable files in its own per-file
    // `catch`, so a truncated manifest never reaches doctor's `catch`: the
    // call SUCCEEDS and returns a short list that is indistinguishable from a
    // complete one. Doctor cannot tell the difference without re-implementing
    // the producer's parsing rules in the consumer, which is precisely the
    // lenient-consumer workaround this repo forbids. The fix belongs in
    // `packages/cloud-connection` (a cross-package contract change to
    // `list()`) and is filed as #5413.
    //
    // When #5413 lands, THIS TEST GOES RED — which is the point.
    writeConfig();
    fs.mkdirSync(ledgerPath(), { recursive: true });
    fs.writeFileSync(path.join(ledgerPath(), 'good.json'), JSON.stringify(globalUniqueEntry('good')));
    // Truncated mid-object — the issue's repro verbatim.
    fs.writeFileSync(
      path.join(ledgerPath(), 'broken.json'),
      '{"manifestId":"broken","manifest":{"objects":[{"name":"acct"',
    );

    const run = await runDoctor();

    // The readable entry is reported…
    expect(run.out).toContain("installed package 'good'");
    // …and the corrupt one is silently absent, with no row of any kind naming
    // it. Not a passing behaviour — a pinned boundary.
    expect(run.out).not.toContain('broken');
    expect(run.out).not.toContain(LEDGER_HEADLINE);
  }, 60_000);
});

describe('the optional package being absent stays completely silent (#5412 does not regress it)', () => {
  /**
   * ③, second half — the one branch that is SUPPOSED to swallow.
   *
   * `@objectstack/cloud-connection` resolves inside this monorepo, so absence
   * is simulated by making its module evaluation throw the way an unresolvable
   * specifier does. `vi.doMock` (not the hoisted `vi.mock`) plus a fresh
   * module registry is what keeps this scoped to this one test — every case
   * above needs the real module.
   */
  afterEach(() => {
    vi.doUnmock('@objectstack/cloud-connection');
    vi.resetModules();
  });

  it('prints no ledger row when the optional package cannot be loaded', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5412-nopkg-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.writeFileSync(
      path.join(tmp, 'objectstack.config.ts'),
      [
        'export default {',
        "  manifest: { name: 'os5412np', label: 'No Package', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );
    // A ledger directory EXISTS — so if the `import()` failure were still
    // sharing a `catch` with the read failure, this is where the two would be
    // confused in the other direction and produce a spurious warning.
    fs.mkdirSync(path.join(tmp, '.objectstack/installed-packages'), { recursive: true });

    const savedPosture = process.env.OS_TENANCY_POSTURE;
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);

    vi.resetModules();
    vi.doMock('@objectstack/cloud-connection', () => {
      throw new Error("Cannot find package '@objectstack/cloud-connection'");
    });
    const { default: FreshDoctor } = await import('./doctor.js');

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    try {
      await FreshDoctor.run([], { root: CLI_ROOT });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__PROCESS_EXIT__')) throw err;
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
      cwdSpy.mockRestore();
      if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = savedPosture;
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    const out = plain(logs.join('\n'));
    // Silence about the ledger, and the advisory's own half still reports.
    expect(out).not.toContain(LEDGER_HEADLINE);
    expect(out).not.toContain('cloud-connection');
    expect(out).toContain(CLEAN_BILL);
  }, 60_000);
});
