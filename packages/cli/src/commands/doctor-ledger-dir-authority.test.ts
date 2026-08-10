// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor` does not GUESS the installed-package ledger's directory (#5996).
 *
 * ── What this file pins, honestly ────────────────────────────────────────
 *
 * Not a live defect. `DEFAULT_INSTALLED_PACKAGES_DIR` is an export of
 * `@objectstack/cloud-connection` in every version ever shipped, so the `??`
 * fallback this change deletes had never fired. What is being hardened is a
 * DIAGNOSIS BOUNDARY — the last cell of the edge #5644 carved. That issue
 * split "present but unloadable" out of absence's silence; this one closes
 * "loaded but unrecognizable": the module evaluates fine and does not declare,
 * as a string, the one export that is the single authority on what the ledger
 * directory is called.
 *
 * The old answer to that state was a consumer-side `??` reading a hard-coded
 * `.objectstack/installed-packages` — two lines above the #5413 comment that
 * forbids exactly that accommodation (Prime Directive #12). The runtime keeps
 * reading wherever the package decides, so the guess could put doctor and the
 * runtime on two different directories, both silent: a report over the wrong
 * directory is the same false PASS as this family's other three rows, wearing
 * a plausible path. The new answer is a named row, and NO read — of the
 * guessed directory or any other — while the state holds.
 *
 * ── The second half of the same authority (#5996 part 3) ─────────────────
 *
 * `installedPackageLedgerSkippedEntriesCheck`'s `fix` used to re-hardcode
 * ``Under `.objectstack/installed-packages/`:`` — the same guess in prose. At
 * the moment that row is built doctor HOLDS the directory it actually read
 * (resolved from the real export), so the row now takes it as a required
 * parameter and quotes it. The unit case with a NON-default directory is the
 * one a re-hardcoded literal cannot pass.
 *
 * ── Simulation notes ─────────────────────────────────────────────────────
 *
 * The authority-missing state is simulated through the loader seam
 * (`../utils/optional-package.js`), the same doubling idiom the #5644 cases
 * next door use: the fake module's `LocalManifestSource` RECORDS construction
 * and would hand back a listing a guessed read WOULD have found (a
 * global-unique entry plus a skipped file). Reaching any of that in the
 * report therefore means doctor read a directory nobody authorized — those
 * `not.toContain` assertions, with the constructor-call count, are what carry
 * the reverse direction; restoring the `??` turns them red.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor, {
  installedPackageLedgerDirAuthorityMissingCheck,
  installedPackageLedgerSkippedEntriesCheck,
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

/** The success line that must NOT appear when the ledger half never ran. */
const CLEAN_BILL = 'No unconfirmed installation-wide uniques';

/** The DIRECTORY-level row (#5412) — must not be confused with the new one. */
const LEDGER_HEADLINE = 'Could not read the installed-package ledger';

/** The ENTRY-level row (#5413). */
const SKIPPED_HEADLINE = 'installed-package ledger entr';

/** The READER-level row (#5644) — the neighbouring cell, not this one. */
const READER_HEADLINE = 'Could not load the installed-package ledger reader';

/**
 * The head of the AUTHORITY row (#5996).
 *
 * Deliberately not a superstring of any sibling headline (and vice versa), so
 * every `not.toContain` in this family keeps meaning what it says whichever
 * row is on screen: "read" (#5412) / "entr" (#5413) / "load … reader" (#5644)
 * / "declare … directory" (here) are four different verbs for four facts.
 */
const AUTHORITY_HEADLINE =
  'The installed-package ledger reader does not declare the ledger directory';

/** The name column all four readability rows share since #5429. */
const LEDGER_ROW_NAME = 'Installed packages';

describe('installedPackageLedgerDirAuthorityMissingCheck — loaded but unrecognizable (#5996)', () => {
  it('takes the `Installed packages` name column and stays a warning, like its three siblings', () => {
    const check = installedPackageLedgerDirAuthorityMissingCheck(undefined);

    expect(check.name).toBe(LEDGER_ROW_NAME);
    expect(check.status).toBe('warning');
  });

  it('says WHICH fact this is: the export is not there, and nothing was checked', () => {
    const check = installedPackageLedgerDirAuthorityMissingCheck(undefined);

    expect(check.message).toContain(AUTHORITY_HEADLINE);
    expect(check.message).toContain('installed packages NOT checked');
    expect(check.message).toContain('not among its exports');
    // One row is one line.
    expect(check.message).not.toContain('\n');
  });

  it('names the received value when the export exists but is not a string', () => {
    const check = installedPackageLedgerDirAuthorityMissingCheck(42);

    expect(check.message).toContain('not a string');
    expect(check.message).toContain('got number: 42');
  });

  it('is none of its three siblings — four facts, four headlines', () => {
    const check = installedPackageLedgerDirAuthorityMissingCheck(undefined);

    expect(check.message).not.toContain(LEDGER_HEADLINE);
    expect(check.message).not.toContain(SKIPPED_HEADLINE);
    expect(check.message).not.toContain(READER_HEADLINE);
  });

  it('says the package is present AND loaded — the two things that separate it from its kin', () => {
    const fix = installedPackageLedgerDirAuthorityMissingCheck(undefined).fix ?? '';

    // "IS installed" separates it from absence's silence; "DID load" separates
    // it from the #5644 row one cell over. Without both, the reader's first
    // move would be to rebuild a package that builds and loads fine.
    expect(fix).toContain('IS installed here and it DID load');
    expect(fix).toContain('authority on what the ledger directory is called');
    // And it names the remedy: the two ends of this contract disagree.
    expect(fix).toContain('Align their versions');
  });

  it('claims no directory path, anywhere — naming one is the knowledge this row just lost', () => {
    const check = installedPackageLedgerDirAuthorityMissingCheck(undefined);

    // The one name doctor had for the ledger is the export that came back
    // non-string. A path in the row — the old `??` guess included — would be
    // doctor asserting what it cannot know (#5644's option-B rejection, one
    // cell over).
    expect(check.message).not.toContain('.objectstack');
    expect(check.fix ?? '').not.toContain('.objectstack');
  });
});

describe('installedPackageLedgerSkippedEntriesCheck — names the directory it actually read (#5996)', () => {
  const oneSkipped = [{ file: 'broken.json', cause: new Error('Unexpected end of JSON input') }];

  it('quotes the resolved directory in the fix', () => {
    const check = installedPackageLedgerSkippedEntriesCheck(
      oneSkipped,
      '/srv/app/.objectstack/installed-packages',
    );

    expect(check.fix).toContain('Under `/srv/app/.objectstack/installed-packages`:');
    expect(check.fix).toContain('broken.json');
  });

  it('a NON-default authority value flows through — the assertion a re-hardcoded literal cannot pass', () => {
    // The directory parameter exists precisely so this row tracks the
    // producer's export instead of restating the consumer's old guess. If the
    // literal ever creeps back, this is the case that goes red.
    const check = installedPackageLedgerSkippedEntriesCheck(oneSkipped, '/srv/app/.objectstack/pkgs-v2');

    expect(check.fix).toContain('Under `/srv/app/.objectstack/pkgs-v2`:');
    expect(check.fix).not.toContain('.objectstack/installed-packages');
  });
});

/**
 * ── End to end: the export is missing, and doctor reads NOTHING ──────────
 *
 * Simulated through the loader seam, like the #5644 cause case next door: the
 * mock hands doctor a module that LOADED (`state: 'loaded'`) and carries no
 * `DEFAULT_INSTALLED_PACKAGES_DIR`. No preflight (`assertLedgerReaderIsBuilt`)
 * in this describe, and that is not a rollback of #5612: nothing here reads
 * the real package at all — the seam is mocked — so there is no accident for
 * a preflight to catch.
 */
describe('os doctor, end to end, against a reader that declares no ledger directory (#5996)', () => {
  afterEach(() => {
    vi.doUnmock('../utils/optional-package.js');
    vi.resetModules();
  });

  /** A listing a guessed read WOULD have found — see the header. */
  const guessedListing = () => ({
    entries: [
      {
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
      },
    ],
    skipped: [{ file: 'broken.json', cause: new Error('Unexpected end of JSON input') }],
  });

  async function runAgainstModule(
    fakeModule: Record<string, unknown>,
    argv: string[],
  ): Promise<{ out: string; exitCode: number | undefined }> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5996-e2e-'));
    // Without `node_modules/` doctor's Dependencies check is an `error` on its
    // own and exits 1 — the trap PR #5390 wrote down.
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.writeFileSync(
      path.join(tmp, 'objectstack.config.ts'),
      [
        'export default {',
        "  manifest: { name: 'os5996', label: 'No Authority', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );

    const savedPosture = process.env.OS_TENANCY_POSTURE;
    // D5e's advisory only runs under `isolated`; withholding its clean bill is
    // one of the facts under test.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);

    vi.resetModules();
    vi.doMock('../utils/optional-package.js', () => ({
      loadOptionalPackage: async () => ({ state: 'loaded', module: fakeModule }),
    }));
    const { default: FreshDoctor } = await import('./doctor.js');

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
      await FreshDoctor.run(argv, { root: CLI_ROOT });
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
    return { out: plain(logs.join('\n')), exitCode };
  }

  it('reports the named row and reads NO directory — guessed or otherwise', async () => {
    const ctorCalls: string[] = [];
    const fakeModule = {
      // Deliberately NO `DEFAULT_INSTALLED_PACKAGES_DIR` — the state under test.
      LocalManifestSource: class {
        constructor(dir: string) {
          ctorCalls.push(dir);
        }
        list() {
          return guessedListing();
        }
      },
    };

    const plainRun = await runAgainstModule(fakeModule, []);
    const verboseRun = await runAgainstModule(fakeModule, ['--verbose']);

    // ① THE assertion of #5996: no read happened. The old `??` constructed the
    //    source over a guessed path; the fake records every construction.
    expect(ctorCalls).toHaveLength(0);
    // ② …so nothing a guessed read would have found is in the report: not the
    //    listing's global-unique finding, not its skipped file.
    expect(plainRun.out).not.toContain('invoice.code');
    expect(plainRun.out).not.toContain('broken.json');
    expect(plainRun.out).not.toContain(SKIPPED_HEADLINE);
    // ③ The state is its own named row, under the family's name column…
    expect(plainRun.out).toContain(AUTHORITY_HEADLINE);
    expect(plainRun.out).toContain(LEDGER_ROW_NAME);
    // ④ …and none of its three siblings': the directory was never touched and
    //    the reader loaded fine.
    expect(plainRun.out).not.toContain(LEDGER_HEADLINE);
    expect(plainRun.out).not.toContain(READER_HEADLINE);
    // ⑤ The D5e advisory withholds its clean bill — its ledger half never ran.
    expect(plainRun.out).not.toContain(CLEAN_BILL);
    // ⑥ Warning-tier detail follows the family rule: only under --verbose.
    expect(plainRun.out).not.toContain('saw:');
    expect(verboseRun.out).toContain('saw:');
    expect(verboseRun.out).toContain('IS installed here and it DID load');
    // Gauge: warning, the report finishes, exit stays 0.
    expect(plainRun.out).toContain('Environment is functional but has some warnings');
    expect(plainRun.exitCode).toBeUndefined();
    expect(verboseRun.exitCode).toBeUndefined();
  }, 120_000);

  it('a non-string export is the same fact — never a path.join over it', async () => {
    const ctorCalls: string[] = [];
    const fakeModule = {
      // Present, and not a string: the shape whose `path.join` throw the old
      // code mis-reported through the config `catch` (see the function's
      // header in doctor.ts).
      DEFAULT_INSTALLED_PACKAGES_DIR: 42,
      LocalManifestSource: class {
        constructor(dir: string) {
          ctorCalls.push(dir);
        }
        list() {
          return guessedListing();
        }
      },
    };

    const run = await runAgainstModule(fakeModule, ['--verbose']);

    expect(ctorCalls).toHaveLength(0);
    expect(run.out).toContain(AUTHORITY_HEADLINE);
    expect(run.out).toContain('not a string');
    expect(run.out).toContain('got number: 42');
    expect(run.out).not.toContain(CLEAN_BILL);
    expect(run.out).not.toContain('invoice.code');
    expect(run.exitCode).toBeUndefined();
  }, 120_000);
});

/**
 * ── End to end: the skipped-entries row names the REAL directory ─────────
 *
 * Against the real `@objectstack/cloud-connection`, so this describe needs the
 * #5612 preflight: in a worktree where that package is unbuilt, doctor's
 * deliberate silence would turn the case below into an assertion diff that
 * reads like the report face regressed.
 */
describe('os doctor, end to end, skipped-entries fix quotes the resolved directory (#5996)', () => {
  beforeAll(async () => {
    let mod: Record<string, any>;
    try {
      mod = await import('@objectstack/cloud-connection');
    } catch (err) {
      throw new Error(
        'Preflight failed (#5612): `@objectstack/cloud-connection` did not load, so the case '
        + 'below cannot observe the ledger row at all. Build the dependency graph first:\n'
        + "    pnpm --workspace-concurrency=2 --filter '@objectstack/cli^...' build\n\n"
        + `cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // A dist built before #5413 returns a bare array and derails into the
    // directory-level row — the §9 stale-artefact trap, made loud.
    const listing = new mod.LocalManifestSource(path.join(os.tmpdir(), 'os-5996-preflight-absent')).list();
    if (!Array.isArray(listing?.entries) || !Array.isArray(listing?.skipped)) {
      throw new Error(
        'Preflight failed (#5612): the built `@objectstack/cloud-connection` predates the '
        + '#5413 `{ entries, skipped }` listing. Rebuild it.',
      );
    }
  });

  it('the verbose fix says Under `<resolved dir>`, never the re-hardcoded default', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5996-dir-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.writeFileSync(
      path.join(tmp, 'objectstack.config.ts'),
      [
        'export default {',
        "  manifest: { name: 'os5996d', label: 'Real Dir', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );
    // The directory the REAL export resolves to under this cwd. Unique per
    // run (mkdtemp), which is what makes "the resolved dir, not the literal"
    // assertable at all: the literal can never contain it.
    const ledgerDir = path.join(tmp, '.objectstack/installed-packages');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, 'broken.json'), '{"manifestId":"broken"');

    const savedPosture = process.env.OS_TENANCY_POSTURE;
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    try {
      await Doctor.run(['--verbose'], { root: CLI_ROOT });
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

    // The row itself is unchanged — pinned next door in
    // `doctor-ledger-read-failure.test.ts`. What #5996 changed is WHERE the
    // fix says the files live: the directory doctor actually read.
    expect(out).toContain(SKIPPED_HEADLINE);
    expect(out).toContain('broken.json');
    expect(out).toContain(`Under \`${ledgerDir}\`:`);
    expect(out).not.toContain('Under `.objectstack/installed-packages/`');
  }, 120_000);
});
