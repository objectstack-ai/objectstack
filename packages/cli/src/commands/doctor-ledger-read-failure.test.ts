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
 * ── The second half, one layer down (#5413) ──────────────────────────────
 *
 * This file used to pin a SCOPE BOUNDARY: the issue's stated repro — a
 * truncated JSON entry inside the ledger — did NOT reach that `catch`, because
 * `LocalManifestSource.list()` skipped unparseable files in its own per-file
 * `catch` (`packages/cloud-connection/src/local-manifest-source.ts`) and
 * returned a short list indistinguishable from a complete one. Doctor saw a
 * successful call and printed the same false `✓ Unique scope`, over manifests
 * it had never parsed.
 *
 * #5413 fixed that at the PRODUCER, where it belonged — `list()` now returns
 * `{ entries, skipped }`, so "I read only half the ledger" is a fact in the
 * type rather than an absence — and doctor turns `skipped` into its own row.
 * The boundary case went red exactly as its comment predicted and is now the
 * positive assertion below. The two facts stay separately reported: the
 * directory could not be enumerated at all (#5412) versus it enumerated fine
 * and some files in it would not parse (#5413).
 *
 * ── The third half, one boundary UP (#5644) ──────────────────────────────
 *
 * The `import('@objectstack/cloud-connection')` that reaches all of the above
 * had its own un-bound `catch`, and it merged the same two kinds of thing one
 * level higher: a specifier that does not resolve (the optional package is not
 * installed — silence is correct and stays) and a package that IS installed and
 * will not load (unbuilt or pruned `dist/`, interrupted install, an artefact
 * that throws). The second was answered with the first one's silence, so a
 * ledger declaring an installation-wide `unique` produced `✓ Unique scope` and
 * the finding appeared nowhere — measured, under `--verbose` included.
 *
 * The two are now separated by resolution rather than by the `import()` having
 * thrown (`utils/optional-package.ts`, pinned against the real runtime in
 * `utils/optional-package.test.ts`), and only the absent half is silent.
 *
 * That changes what the last describe of this file can simulate. Absence used
 * to be simulated by making the module's evaluation throw; under the new
 * contract that is precisely the OTHER state, so the case now pins the report
 * it produces, and the absent contract is pinned separately through the loader
 * seam. Both facts are still here — one of them changed how it is spelled,
 * because the fact it used to spell was the defect.
 *
 * ── What #5429 changed under this file ───────────────────────────────────
 *
 * All three rows above lived inside the D5e advisory block, so they only
 * existed under the `isolated` posture — which is why every case here sets
 * `OS_TENANCY_POSTURE=isolated` and why they all still do. #5429 promoted the
 * readability check out from under that gate, and the rows moved with it: their
 * name column is `Installed packages` rather than `Unique scope`, because under
 * `single` and `group` there is no unique-scope check to name. Every other
 * assertion in this file is unchanged, and deliberately so — the isolated-posture
 * report is the one that must NOT drift while the check becomes reachable from
 * the other postures. That the rows now also appear under those postures, and
 * appear only once when both checks are live, is pinned next door in
 * `doctor-ledger-posture-independence.test.ts`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor, {
  installedPackageLedgerFailureCheck,
  installedPackageLedgerReaderFailureCheck,
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

/** The success line that must NOT appear when only half the check ran. */
const CLEAN_BILL = 'No unconfirmed installation-wide uniques';

/** The head of the row that replaces it — the DIRECTORY-level failure (#5412). */
const LEDGER_HEADLINE = 'Could not read the installed-package ledger';

/** The head of its ENTRY-level sibling (#5413). Deliberately distinct text. */
const SKIPPED_HEADLINE = 'installed-package ledger entr';

/**
 * The head of the READER-level row (#5644) — the boundary above both.
 *
 * Deliberately not a superstring of `LEDGER_HEADLINE` ("read" vs "load"), so
 * the `not.toContain(LEDGER_HEADLINE)` assertions below keep meaning what they
 * say when this row is the one on screen.
 */
const READER_HEADLINE = 'Could not load the installed-package ledger reader';

/**
 * The name column all three rows take since #5429.
 *
 * It was `Unique scope` while these rows only existed inside the D5e advisory:
 * the row an operator scans for had to be present rather than missing. Once the
 * check became posture-independent that name stopped being true — `single` and
 * `group` run no unique-scope check at all — so the rows say what they are
 * about instead.
 */
const LEDGER_ROW_NAME = 'Installed packages';

/**
 * ── Why this file needs a preflight (#5612) ──────────────────────────────
 *
 * Every end-to-end case below observes doctor's ledger half, and doctor reaches
 * that half through a dynamic `import('@objectstack/cloud-connection')` whose
 * `catch` is DELIBERATELY silent (`readInstalledPackageEntries()` in
 * `doctor.ts`): `os doctor` must run to completion in a checkout that never had
 * the optional package, so an unresolvable specifier means "nothing installed"
 * and prints nothing. That contract is correct and is itself pinned by the last
 * describe in this file.
 *
 * It also means this file cannot tell "the report face regressed" from "the
 * optional package is simply not built in this worktree" — both arrive as the
 * same total silence. In a worktree where `packages/cloud-connection/dist` is
 * missing, doctor runs every other check, prints `✓ Unique scope`, and the
 * seven cases that expect a ledger row fail with seven assertion diffs that
 * read exactly like #5412/#5413 having been reverted. #5612 was filed on
 * precisely that reading, after three unrelated causes had been eliminated:
 * the only variable was the unbuilt package.
 *
 * The sister file `test/platform-page-i18n-parity.test.ts` imports the same
 * package STATICALLY and therefore fails the honest way — one error that names
 * the package — which is the failure mode this preflight gives back to a file
 * that cannot use a static import (doctor's own load must stay dynamic, and
 * this file's last describe must be able to make it throw).
 *
 * This is a precondition, not a tolerance: nothing below is relaxed, no
 * assertion is weakened, and in a correctly built worktree the guard is a
 * no-op. It only replaces a misleading red with an accurate one.
 */
const PREFLIGHT_HINT = [
  'Preflight failed: the end-to-end ledger cases below cannot observe anything.',
  '',
  "`@objectstack/cloud-connection` is the package doctor reads the ledger through, and it is",
  'either not built or built from a source older than #5413 in this worktree. Doctor swallows',
  'that load failure on purpose, so without this guard the cases below would fail as seven',
  'assertion diffs that look like the #5412/#5413 report face regressed (#5612).',
  '',
  'Build the dependency graph first:',
  "    pnpm --workspace-concurrency=2 --filter '@objectstack/cli^...' build",
].join('\n');

/**
 * Assert that the real ledger reader is loadable AND speaks the post-#5413
 * contract doctor destructures without a fallback (`{ entries, skipped }`).
 *
 * The shape probe is not redundant with the load probe: a `dist/` built before
 * #5413 resolves fine and returns a bare array, which reaches doctor as
 * `skipped === undefined` and derails into the DIRECTORY-level failure row —
 * a third distinct wrong report, and the AGENTS.md §9 stale-artefact trap in
 * the exact place this file is least able to recognise it.
 */
async function assertLedgerReaderIsBuilt(): Promise<void> {
  let mod: Record<string, any>;
  try {
    mod = await import('@objectstack/cloud-connection');
  } catch (err) {
    throw new Error(`${PREFLIGHT_HINT}\n\ncause: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof mod.LocalManifestSource !== 'function') {
    throw new Error(`${PREFLIGHT_HINT}\n\ncause: the module loaded but exports no LocalManifestSource.`);
  }

  // `list()` short-circuits on a non-existent directory, so this probes the
  // return SHAPE without touching the filesystem.
  const listing = new mod.LocalManifestSource(path.join(os.tmpdir(), 'os-5612-preflight-absent')).list();
  if (!Array.isArray(listing?.entries) || !Array.isArray(listing?.skipped)) {
    throw new Error(
      `${PREFLIGHT_HINT}\n\ncause: LocalManifestSource.list() returned ${JSON.stringify(listing)}, ` +
        'not the { entries, skipped } listing #5413 introduced — the built artefact predates it.',
    );
  }
}

describe('installedPackageLedgerFailureCheck — the finding the shared catch used to eat', () => {
  /**
   * The resolved ledger directory the reading carries (#5996), which this row
   * has taken as a required parameter since #6643. Deliberately rooted at
   * `/srv/app` rather than left relative: the old hard-coded literal was
   * `.objectstack/installed-packages/` with no root, so any assertion naming
   * this path is one the literal cannot satisfy.
   */
  const DIR = '/srv/app/.objectstack/installed-packages';

  it('quotes what was thrown, in the row AND in the verbose detail', () => {
    const err = Object.assign(new Error("ENOTDIR: not a directory, scandir '/p/.objectstack'"), {
      code: 'ENOTDIR',
    });
    const check = installedPackageLedgerFailureCheck(err, DIR);

    // Before #5412 this text existed nowhere in any doctor output under any
    // flag — the error object was discarded at the point it was caught.
    expect(check.message).toContain('ENOTDIR');
    expect(check.fix).toContain("scandir '/p/.objectstack'");
  });

  it('takes the `Installed packages` name column, so the row is present rather than missing', () => {
    const check = installedPackageLedgerFailureCheck(new Error('boom'), DIR);

    // Load-bearing, not cosmetic. An operator scans the report by its name
    // column, and this row has to be somewhere findable rather than absent —
    // absence is the silence this issue is about wearing a different hat.
    //
    // #5429 moved WHICH column. It was `Unique scope`, correct while the row
    // could only be produced inside the D5e advisory; now that the check runs
    // under every posture, a row named for a check that does not exist under
    // `single` or `group` would be its own small lie. The `Unique scope` name
    // still exists and still belongs to the unique-scope verdict alone.
    expect(check.name).toBe(LEDGER_ROW_NAME);
  });

  it('stays a warning — the environment runs, doctor’s sight of it is what broke', () => {
    expect(installedPackageLedgerFailureCheck(new Error('boom'), DIR).status).toBe('warning');
  });

  it('says WHICH half did not run, rather than that "something" failed', () => {
    const check = installedPackageLedgerFailureCheck(new Error('boom'), DIR);
    const fix = check.fix ?? '';

    // The harm the issue names is a reader treating a partial check as a whole
    // one. The row has to state its own incompleteness in both channels.
    expect(check.message).toContain('installed packages NOT checked');
    expect(fix).toContain('two halves and only one of them ran');
    // Re-pointed by #6643. This used to assert the bare
    // `.objectstack/installed-packages/` literal the fix restated; the row now
    // names the directory doctor actually read, so the assertion follows it.
    expect(fix).toContain(DIR);
  });

  it('folds a multi-line cause onto the row and keeps it whole in the detail', () => {
    const check = installedPackageLedgerFailureCheck(new Error('line one\nline two: the reason'), DIR);

    expect(check.message).toContain('line two: the reason');
    // One row is one line.
    expect(check.message).not.toContain('\n');
    expect(check.fix).toContain('line two: the reason');
  });

  it('never trails off into nothing for an Error with no message', () => {
    const check = installedPackageLedgerFailureCheck(new TypeError(), DIR);

    expect(check.message.endsWith('— ')).toBe(false);
    expect(check.message).toContain('TypeError');
  });

  it('reports a thrown non-Error rather than swallowing it', () => {
    expect(installedPackageLedgerFailureCheck('boom', DIR).message).toContain('boom');
    expect(installedPackageLedgerFailureCheck(42, DIR).message).toContain('42');
  });

  it('a NON-default directory flows through — the assertion a re-hardcoded literal cannot pass', () => {
    // #6643, the sibling of #5996's identical case on
    // `installedPackageLedgerSkippedEntriesCheck`. The parameter exists so this
    // row tracks the producer's `DEFAULT_INSTALLED_PACKAGES_DIR` instead of
    // restating the consumer's old guess. A directory sharing NO substring with
    // that guess is what separates the two: if the literal ever creeps back,
    // both assertions below go red at once.
    const check = installedPackageLedgerFailureCheck(new Error('boom'), '/var/lib/os-ledger');

    expect(check.fix).toContain('The ledger is `/var/lib/os-ledger`;');
    expect(check.fix).not.toContain('.objectstack/installed-packages');
  });

  it('drops the "under the project root" hedge — the resolved dir already says where it is', () => {
    // The old literal was relative, so the row had to add a sentence locating
    // it. `dir` is `cwd`-joined and absolute, which makes that sentence both
    // redundant and (for a non-default `storageDir`) wrong.
    const check = installedPackageLedgerFailureCheck(new Error('boom'), DIR);

    expect(check.fix).not.toContain('project root');
  });
});

describe('installedPackageLedgerReaderFailureCheck — the finding one boundary up (#5644)', () => {
  it('quotes what was thrown, in the row AND in the verbose detail', () => {
    const check = installedPackageLedgerReaderFailureCheck(
      new Error("Cannot find module '/app/node_modules/@objectstack/cloud-connection/dist/index.js'"),
    );

    expect(check.message).toContain('dist/index.js');
    expect(check.fix).toContain('dist/index.js');
  });

  it('takes the `Installed packages` name column and stays a warning, like its two siblings', () => {
    const check = installedPackageLedgerReaderFailureCheck(new Error('boom'));

    // All three readability rows share one name column, so an operator scanning
    // for the ledger finds it in one place whichever of the three fired
    // (#5429 moved that column off `Unique scope`; see the sibling case above).
    expect(check.name).toBe(LEDGER_ROW_NAME);
    // The environment still runs; what broke is doctor's sight of part of it.
    expect(check.status).toBe('warning');
  });

  it('says the package is PRESENT — the one thing that separates it from silence', () => {
    const check = installedPackageLedgerReaderFailureCheck(new Error('boom'));
    const fix = check.fix ?? '';

    // A checkout that never installed the package prints nothing at all, so
    // the row's whole meaning is "it is here and it is broken". If the text did
    // not say so, the reader's first move would be to install what is already
    // installed.
    expect(fix).toContain('IS installed here');
    expect(check.message).toContain('installed packages NOT checked');
    // And it names the remedy for the state repo developers hit daily.
    expect(fix).toContain('@objectstack/cloud-connection build');
  });

  it('does not claim to know whether a ledger exists', () => {
    // It cannot: `DEFAULT_INSTALLED_PACKAGES_DIR` is an export of the package
    // that would not load. Saying "the ledger is there" (the #5412 row's
    // wording, correct for #5412) would be doctor asserting what it just lost
    // the ability to check.
    const fix = installedPackageLedgerReaderFailureCheck(new Error('boom')).fix ?? '';

    expect(fix).not.toContain('it exists here');
    expect(fix).toContain('cannot even tell you');
  });

  it('never trails off into nothing, and reports a thrown non-Error', () => {
    expect(installedPackageLedgerReaderFailureCheck(new TypeError()).message).toContain('TypeError');
    expect(installedPackageLedgerReaderFailureCheck('boom').message).toContain('boom');
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

  // #5612 — one accurate failure instead of seven misleading ones. See
  // `assertLedgerReaderIsBuilt()`.
  beforeAll(assertLedgerReaderIsBuilt);

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
    expect(run.out).toContain(LEDGER_ROW_NAME);
    // Gauge: warning, the report finishes, exit stays 0.
    expect(run.out).toContain('Environment is functional but has some warnings');
    expect(run.exitCode).toBeUndefined();
  }, 60_000);

  it('the verbose fix names the directory doctor actually read, resolved from the authority (#6643)', async () => {
    writeConfig();
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.writeFileSync(ledgerPath(), 'not a directory\n');

    // The expectation is COMPUTED FROM THE AUTHORITY, never hard-coded: the
    // whole point of #6643 is that this row stops restating a value only
    // `@objectstack/cloud-connection` decides. Writing `.objectstack/
    // installed-packages` here would move the literal into the test and pin
    // the row against the guess a second time — the defect, relocated.
    // Re-imported rather than read off `LEDGER_REL` for the same reason.
    const { DEFAULT_INSTALLED_PACKAGES_DIR } = await import('@objectstack/cloud-connection');
    // `mkdtemp` makes this unique per run, which is what makes "the resolved
    // dir, not the literal" assertable at all: no literal can contain it.
    const resolved = path.join(tmp, DEFAULT_INSTALLED_PACKAGES_DIR);

    const run = await runDoctor(['--verbose']);

    expect(run.out).toContain(LEDGER_HEADLINE);
    expect(run.out).toContain(`The ledger is \`${resolved}\`;`);
    // And the relative literal it replaced is gone from the report entirely.
    expect(run.out).not.toContain('The ledger is `.objectstack/installed-packages/` directory');
    expect(run.out).not.toContain('under the\n      project root');
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

  /**
   * ── Was the ⚠ SCOPE BOUNDARY case, now flipped positive (#5413) ────────
   *
   * This slot used to pin the issue's own stated repro as deliberately NOT
   * FIXED: a truncated entry never reached doctor's `catch` because
   * `LocalManifestSource.list()` skipped unparseable files in its own per-file
   * `catch` and returned a short list indistinguishable from a complete one.
   * Doctor could not have told the difference without re-implementing the
   * producer's parsing rules in the consumer — the lenient-consumer workaround
   * this repo forbids — so the fix went to the producer instead: `list()` now
   * returns `{ entries, skipped }` and doctor reports the second half.
   *
   * The old case asserted `not.toContain('broken')` and went red exactly as its
   * comment predicted. Rewritten as the positive assertion rather than deleted:
   * the repro is the same, only the expected verdict inverted.
   */
  it('reports a CORRUPT ENTRY by name instead of skipping it in silence', async () => {
    writeConfig();
    fs.mkdirSync(ledgerPath(), { recursive: true });
    fs.writeFileSync(path.join(ledgerPath(), 'good.json'), JSON.stringify(globalUniqueEntry('good')));
    // Truncated mid-object — the issue's repro verbatim.
    fs.writeFileSync(
      path.join(ledgerPath(), 'broken.json'),
      '{"manifestId":"broken","manifest":{"objects":[{"name":"acct"',
    );

    const run = await runDoctor();

    // The readable entry is still reported, unchanged.
    expect(run.out).toContain("installed package 'good'");
    // ① The corrupt one is named — the row that did not exist before #5413.
    expect(run.out).toContain(SKIPPED_HEADLINE);
    expect(run.out).toContain('broken.json');
    // ② With the parser's own words, not a summary doctor invented.
    expect(run.out).toMatch(/JSON/i);
    // ③ Under the `Installed packages` name column, like its directory-level
    //    sibling, so the row an operator scans for is present rather than
    //    missing.
    expect(run.out).toContain(LEDGER_ROW_NAME);
    // ④ NOT the directory-level row: the directory read fine. Two distinct
    //    facts, two distinct headlines (#5412 vs #5413).
    expect(run.out).not.toContain(LEDGER_HEADLINE);
    // Gauge: still a warning, report finishes, exit stays 0.
    expect(run.out).toContain('Environment is functional but has some warnings');
    expect(run.exitCode).toBeUndefined();
  }, 60_000);

  it('withholds the clean bill when the ONLY finding is an unparseable entry', async () => {
    // The false-PASS shape this issue is really about. The good entry declares
    // no global unique, so before #5413 the advisory found nothing to say and
    // printed `✓ Unique scope` — over a manifest it had never parsed. An
    // unreadable manifest may declare an installation-wide unique; nobody can
    // say it does not.
    writeConfig();
    fs.mkdirSync(ledgerPath(), { recursive: true });
    fs.writeFileSync(
      path.join(ledgerPath(), 'clean.json'),
      JSON.stringify({ manifestId: 'clean', manifest: { objects: [] } }),
    );
    fs.writeFileSync(path.join(ledgerPath(), 'broken.json'), '{"manifestId":"broken"');

    const run = await runDoctor();

    expect(run.out).not.toContain(CLEAN_BILL);
    expect(run.out).toContain(SKIPPED_HEADLINE);
    expect(run.out).toContain('broken.json');
  }, 60_000);

  it('names EVERY unparseable entry, and expands the causes under --verbose', async () => {
    writeConfig();
    fs.mkdirSync(ledgerPath(), { recursive: true });
    fs.writeFileSync(path.join(ledgerPath(), 'one.json'), '{oops');
    fs.writeFileSync(path.join(ledgerPath(), 'two.json'), 'not json at all');

    const plainRun = await runDoctor();
    const verboseRun = await runDoctor(['--verbose']);

    // One row is one line, so the row quotes the first cause and counts the
    // rest; `fix` carries every file with its own cause.
    expect(plainRun.out).toContain('2 installed-package ledger entries could not be read');
    expect(plainRun.out).toContain('(+1 more)');
    expect(plainRun.out).not.toContain('cause:');

    expect(verboseRun.out).toContain('one.json');
    expect(verboseRun.out).toContain('two.json');
    expect(verboseRun.out).toContain('cause:');
    // The fix is per-file, so it has to say what to do with each one.
    expect(verboseRun.out).toContain('Repair the JSON, or delete the file');
    expect(verboseRun.exitCode).toBeUndefined();
  }, 60_000);
});

/**
 * ── The two states the `import()` boundary used to merge (#5644) ─────────
 *
 * These two describes were ONE before #5644, and it asserted silence for a
 * simulation that produced the wrong state. It made the module's evaluation
 * throw — "the way an unresolvable specifier does", its comment said — and
 * pinned that doctor said nothing. That is exactly the false PASS #5644 is
 * about: an evaluation that throws means the package is HERE and unusable, and
 * silence over it is a clean bill of health for a ledger nobody read.
 *
 * So the simulation keeps its mechanism and swaps its verdict (the "replace the
 * assertion, not the repro" disposition #5413 used one layer down), and the
 * contract it used to stand for — a package that is genuinely NOT INSTALLED is
 * silent — moves to its own describe, spelled the only way that is now honest.
 */
describe('the optional package INSTALLED BUT UNLOADABLE is reported (#5644)', () => {
  /**
   * #5612's preflight still earns its place here, and for its original reason.
   * This case makes the real module's evaluation throw and asserts the row that
   * follows; in a worktree where `cloud-connection` is genuinely unbuilt, the
   * SAME row appears without the mock having done anything — green because the
   * accident reproduced the simulation (PR #5046's empty-verdict trap in
   * reverse). The guard is what keeps the two distinguishable.
   */
  beforeAll(assertLedgerReaderIsBuilt);

  afterEach(() => {
    vi.doUnmock('@objectstack/cloud-connection');
    vi.resetModules();
  });

  it('withholds the clean bill and names the reader, with a ledger it never read', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5644-broken-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.writeFileSync(
      path.join(tmp, 'objectstack.config.ts'),
      [
        'export default {',
        "  manifest: { name: 'os5644', label: 'Broken Reader', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );
    // A ledger that DOES declare an installation-wide unique. Before #5644 this
    // exact tree printed `✓ Unique scope` and `invoice.code` appeared nowhere,
    // under `--verbose` included — the false PASS, measured.
    const ledger = path.join(tmp, '.objectstack/installed-packages');
    fs.mkdirSync(ledger, { recursive: true });
    fs.writeFileSync(
      path.join(ledger, 'billing.json'),
      JSON.stringify({
        manifestId: 'billing',
        manifest: {
          objects: [
            {
              name: 'invoice',
              label: 'Invoice',
              fields: [{ name: 'code', type: 'text', label: 'Code', unique: 'global' }],
            },
          ],
        },
      }),
    );

    const savedPosture = process.env.OS_TENANCY_POSTURE;
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);

    vi.resetModules();
    // The package RESOLVES — it is a workspace dependency of this very package
    // — and its evaluation throws. That is the "installed and broken" state,
    // and the classifier's real `import.meta.resolve()` is what recognises it.
    vi.doMock('@objectstack/cloud-connection', () => {
      throw new Error('simulated corrupt build artefact');
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
      await FreshDoctor.run(['--verbose'], { root: CLI_ROOT });
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

    // ① THE assertion of #5644: no clean bill over a ledger nobody read.
    expect(out).not.toContain(CLEAN_BILL);
    // ② …replaced by a row that names what could not be loaded.
    expect(out).toContain(READER_HEADLINE);
    expect(out).toContain(LEDGER_ROW_NAME);
    // ③ NOT the directory-level row: the directory was never reached, and its
    //    text asserts a ledger exists — which doctor cannot know from here.
    expect(out).not.toContain(LEDGER_HEADLINE);
    expect(out).not.toContain(SKIPPED_HEADLINE);
    // ④ The verbose channel carries the cause, like every other warning row.
    expect(out).toContain('cause:');
    // Gauge: warning, the report finishes, exit stays 0.
    expect(out).toContain('Environment is functional but has some warnings');
  }, 60_000);

  it('quotes the load failure verbatim and keeps the row to one line', async () => {
    // Driven through the loader seam so the cause is a fixed string rather than
    // whatever the mocking machinery wraps a thrown error in. What the previous
    // case proves is that the REAL mechanism reaches this row; what this one
    // proves is what the row says once it does.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5644-cause-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.writeFileSync(
      path.join(tmp, 'objectstack.config.ts'),
      [
        'export default {',
        "  manifest: { name: 'os5644c', label: 'Cause', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );

    const savedPosture = process.env.OS_TENANCY_POSTURE;
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);

    vi.resetModules();
    vi.doMock('../utils/optional-package.js', () => ({
      loadOptionalPackage: async () => ({
        state: 'broken',
        cause: new Error(
          "Cannot find module '/app/node_modules/@objectstack/cloud-connection/dist/index.js'",
        ),
      }),
    }));
    const { default: FreshDoctor } = await import('./doctor.js');

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    let exitCode: number | undefined;
    try {
      await FreshDoctor.run(['--verbose'], { root: CLI_ROOT });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__PROCESS_EXIT__')) throw err;
      exitCode = Number(err.message.split(':')[1]);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
      cwdSpy.mockRestore();
      vi.doUnmock('../utils/optional-package.js');
      vi.resetModules();
      if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = savedPosture;
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    const out = plain(logs.join('\n'));
    const row = out.split('\n').find((l) => l.includes(READER_HEADLINE)) ?? '';

    // The producer's own words, on the row and in the detail.
    expect(row).toContain('dist/index.js');
    expect(out).toContain('IS installed here');
    // One row is one line — the cause is folded, never wrapped into the report.
    expect(row.includes('\n')).toBe(false);
    expect(out).not.toContain(CLEAN_BILL);
    expect(exitCode).toBeUndefined();
  }, 60_000);
});

describe('the optional package being genuinely ABSENT stays completely silent (#5412, unchanged)', () => {
  /**
   * ③, second half — the one branch that is SUPPOSED to swallow, and the
   * constraint #5644 was not allowed to break: `os doctor` must run to
   * completion, and print its clean bill, in a checkout that never had the
   * optional package.
   *
   * Simulated through the loader seam, and it has to be. Absence is now defined
   * by RESOLUTION — `@objectstack/cloud-connection` is a declared dependency of
   * this package, so it resolves here no matter what a module mock does to its
   * evaluation, and a mock that throws now means "installed and broken" (the
   * describe above). The seam is where the two states are decided, so it is the
   * seam this case has to speak through.
   *
   * Which layer proves what, deliberately split:
   *   - that a real unresolvable specifier IS classified absent, against the
   *     real runtime: `utils/optional-package.test.ts`.
   *   - that doctor stays silent when told so: here.
   *
   * No `assertLedgerReaderIsBuilt` preflight, and that is not a rollback of
   * #5612: the preflight exists to stop a case passing because the real package
   * happened to be unloadable. Nothing here reads the real package at all — the
   * seam is mocked — so there is no accident left for it to catch.
   */
  afterEach(() => {
    vi.doUnmock('../utils/optional-package.js');
    vi.resetModules();
  });

  it('prints no ledger row, and still prints the clean bill', async () => {
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
    // A ledger directory EXISTS — so if "not installed" were confused with
    // "installed and broken" in the other direction, this is where the
    // confusion would surface as a spurious warning.
    fs.mkdirSync(path.join(tmp, '.objectstack/installed-packages'), { recursive: true });

    const savedPosture = process.env.OS_TENANCY_POSTURE;
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);

    vi.resetModules();
    vi.doMock('../utils/optional-package.js', () => ({
      loadOptionalPackage: async () => ({ state: 'absent' }),
    }));
    const { default: FreshDoctor } = await import('./doctor.js');

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    try {
      await FreshDoctor.run(['--verbose'], { root: CLI_ROOT });
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
    // Silence about the ledger, in all three of its shapes…
    expect(out).not.toContain(LEDGER_HEADLINE);
    expect(out).not.toContain(SKIPPED_HEADLINE);
    expect(out).not.toContain(READER_HEADLINE);
    // …not even the package's name, under `--verbose`.
    expect(out).not.toContain('cloud-connection');
    // …and the advisory's own half still reports.
    expect(out).toContain(CLEAN_BILL);
  }, 60_000);
});
