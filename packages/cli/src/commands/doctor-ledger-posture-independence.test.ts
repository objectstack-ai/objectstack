// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor` reports an unreadable installed-package ledger under EVERY
 * tenancy posture — not only `isolated` (#5429).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Three ledger-readability rows existed before this file — the directory-level
 * one (#5412), the entry-level one (#5413) and the reader-level one (#5644) —
 * and all three were produced inside the ADR-0120 D5e advisory block, whose
 * entry condition is:
 *
 *     if (postureReading.ok && postureGatesGlobalUniques(postureReading.posture)) {
 *
 * with `findUnscopedGlobalUniques()` re-asserting the same gate on its first
 * line. `postureGatesGlobalUniques()` is true for `isolated` (and its legacy
 * alias `multi`) and false for `single` and `group`, so under those two
 * postures `readInstalledPackageEntries()` was never called at all: whether the
 * ledger could be read, and whether any file in it was corrupt, was a question
 * `os doctor` did not ask and said nothing about.
 *
 * The default makes it worse than "two of four postures". `resolveTenancyPosture()`
 * returns `single` when `OS_TENANCY_POSTURE` is unset and `OS_MULTI_ORG_ENABLED`
 * is not truthy (`packages/types/src/env.ts:161`), so the SILENT posture is the
 * out-of-the-box one. A developer who never set the variable got the blind
 * report.
 *
 * ── Why posture is the wrong gate for this fact ──────────────────────────
 *
 * "Is this environment's `unique: 'global'` dangerous?" IS a posture question —
 * `'global'` is unambiguous under `single` (one customer) and `group` (the
 * installation is the customer), and only `isolated` makes it a finding. Gating
 * THAT on the posture is correct and stays.
 *
 * "Is there a file under `.objectstack/installed-packages/` that cannot be
 * read?" is not. It is equally true under every posture and it means the same
 * thing under every posture: that installed app is dropped at boot — not
 * registered with the kernel, absent from the console's installed-apps list.
 * The maintainer's 2026-08-06 ruling on #5429 (option A) promoted it to its own
 * posture-independent check under its own `Installed packages` name, leaving the
 * D5e block with the unique-scope judgment alone.
 *
 * ── The other half of the ruling: no double reporting ────────────────────
 *
 * Under `isolated` both things are live at once, so the same bad ledger could
 * easily be reported twice — once by the standalone check and once by the D5e
 * block. It is not: the ledger is read ONCE per run and the D5e advisory
 * consumes that same reading instead of taking its own. What D5e keeps is the
 * consequence for its own verdict — an incomplete reading still withholds the
 * `✓ Unique scope` clean bill, because that line is a claim about both halves
 * of the advisory and only one of them ran.
 *
 * ── Division of labour with the boot side (deliberate, not redundant) ────
 *
 * `rehydrate()` warns per corrupt entry at boot, posture-independently, and
 * that is a different channel for a different moment: the runtime telling an
 * operator what it just dropped while starting. This file is about the
 * DIAGNOSTIC command — the thing someone runs on purpose, before or after a
 * boot, to ask what is wrong. Both are correct; neither substitutes for the
 * other, and the diagnostic being posture-blind is what #5429 is about.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Doctor from './doctor.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
import '@objectstack/cloud-connection';

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

/** The D5e success line — a claim about BOTH halves of that advisory. */
const CLEAN_BILL = 'No unconfirmed installation-wide uniques';

/** The DIRECTORY-level finding (#5412). */
const LEDGER_HEADLINE = 'Could not read the installed-package ledger';
/** Its ENTRY-level sibling (#5413). */
const SKIPPED_HEADLINE = 'installed-package ledger entr';
/** The name column all ledger-readability rows take since #5429. */
const LEDGER_ROW_NAME = 'Installed packages';

/** The postures that gate the D5e advisory OFF — where doctor used to be blind. */
const BLIND_POSTURES = ['single', 'group'] as const;

/**
 * The same preflight `doctor-ledger-read-failure.test.ts` carries, and for the
 * same reason (#5612): doctor reaches the ledger through a dynamic
 * `import('@objectstack/cloud-connection')` whose absent-package branch is
 * deliberately silent, so in a worktree where that package is unbuilt every
 * case below fails with an assertion diff that reads exactly like this feature
 * having been reverted. Nothing here is relaxed by the guard — in a correctly
 * built worktree it is a no-op; it only replaces a misleading red with an
 * accurate one.
 */
const PREFLIGHT_HINT = [
  'Preflight failed: the ledger cases below cannot observe anything.',
  '',
  '`@objectstack/cloud-connection` is the package doctor reads the ledger through, and it is',
  'either not built or built from a source older than #5413 in this worktree.',
  '',
  'Build the dependency graph first:',
  "    pnpm --workspace-concurrency=2 --filter '@objectstack/cli^...' build",
].join('\n');

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
  const listing = new mod.LocalManifestSource(path.join(os.tmpdir(), 'os-5429-preflight-absent')).list();
  if (!Array.isArray(listing?.entries) || !Array.isArray(listing?.skipped)) {
    throw new Error(
      `${PREFLIGHT_HINT}\n\ncause: LocalManifestSource.list() returned ${JSON.stringify(listing)}, ` +
        'not the { entries, skipped } listing #5413 introduced — the built artefact predates it.',
    );
  }
}

/** Both variables that decide the posture — the second one owns the default. */
const TOUCHED = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED'] as const;

describe('os doctor reports ledger readability under every posture (#5429)', () => {
  beforeAll(assertLedgerReaderIsBuilt);

  /**
   * `node_modules/` exists in the temp cwd on purpose — without it doctor's
   * `Dependencies` check is itself an `error` and exits 1 on its own, which
   * would make an assertion pass for a reason having nothing to do with this
   * change (the trap PR #5390 wrote down).
   */
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const saved: Partial<Record<(typeof TOUCHED)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of TOUCHED) saved[key] = process.env[key];
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5429-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    for (const key of TOUCHED) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ledgerPath = () => path.join(tmp, '.objectstack/installed-packages');

  const writeConfig = () =>
    fs.writeFileSync(
      path.join(tmp, 'objectstack.config.ts'),
      [
        'export default {',
        "  manifest: { name: 'os5429', label: 'Ledger Posture', version: '1.0.0' },",
        "  objects: [{ name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text', label: 'Name' }] }],",
        '};',
        '',
      ].join('\n'),
    );

  /** The ledger PATH exists but is not a directory — `readdirSync` throws ENOTDIR. */
  const writeUnreadableLedgerDirectory = () => {
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.writeFileSync(ledgerPath(), 'this is a file, not the ledger directory\n');
  };

  /** A readable directory holding one truncated entry — #5413's repro verbatim. */
  const writeCorruptLedgerEntry = () => {
    fs.mkdirSync(ledgerPath(), { recursive: true });
    fs.writeFileSync(
      path.join(ledgerPath(), 'broken.json'),
      '{"manifestId":"broken","manifest":{"objects":[{"name":"acct"',
    );
  };

  const setPosture = (posture: string | undefined) => {
    if (posture === undefined) {
      delete process.env.OS_TENANCY_POSTURE;
      // The default is only `single` while multi-org is off, and that default
      // is the whole point of the unset case.
      delete process.env.OS_MULTI_ORG_ENABLED;
    } else {
      process.env.OS_TENANCY_POSTURE = posture;
    }
  };

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

  /** How many times a finding's headline reaches the terminal. */
  const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

  // ① The acceptance criterion: both ledger findings have their own row under
  //    the postures that gate the D5e advisory off.
  describe.each(BLIND_POSTURES)("under the '%s' posture", (posture) => {
    it('reports a ledger DIRECTORY it could not read, with the cause', async () => {
      setPosture(posture);
      writeConfig();
      writeUnreadableLedgerDirectory();

      const run = await runDoctor();

      // Before #5429 this output contained none of the three: the read never
      // happened, because the posture gate returned first.
      expect(run.out).toContain(LEDGER_HEADLINE);
      expect(run.out).toContain('ENOTDIR');
      expect(run.out).toContain(LEDGER_ROW_NAME);
      // The D5e advisory itself stays posture-gated — this posture asks no
      // unique-scope question at all, and none is answered.
      expect(run.out).not.toContain(CLEAN_BILL);
      expect(run.out).not.toContain("Checking unique scopes");
      // Gauge: a warning, the report finishes, exit stays 0.
      expect(run.out).toContain('Environment is functional but has some warnings');
      expect(run.exitCode).toBeUndefined();
    }, 60_000);

    it('names a corrupt ENTRY inside a readable ledger', async () => {
      setPosture(posture);
      writeConfig();
      writeCorruptLedgerEntry();

      const run = await runDoctor();

      expect(run.out).toContain(SKIPPED_HEADLINE);
      expect(run.out).toContain('broken.json');
      expect(run.out).toContain(LEDGER_ROW_NAME);
      // Two distinct facts, two distinct headlines: the directory read fine.
      expect(run.out).not.toContain(LEDGER_HEADLINE);
      expect(run.out).toContain('Environment is functional but has some warnings');
      expect(run.exitCode).toBeUndefined();
    }, 60_000);

    it('expands the per-file cause under --verbose, like every other warning row', async () => {
      setPosture(posture);
      writeConfig();
      writeCorruptLedgerEntry();

      const plainRun = await runDoctor();
      const verboseRun = await runDoctor(['--verbose']);

      expect(plainRun.out).not.toContain('cause:');
      expect(verboseRun.out).toContain('cause:');
      expect(verboseRun.out).toContain('Repair the JSON, or delete the file');
    }, 60_000);
  });

  it('reports with OS_TENANCY_POSTURE UNSET — the default posture is the blind one', async () => {
    // `resolveTenancyPosture()` returns `single` when the variable is unset and
    // multi-org is off, so before #5429 the out-of-the-box configuration was
    // exactly the one that said nothing. This case is the issue's real blast
    // radius: not an exotic posture, the default.
    setPosture(undefined);
    writeConfig();
    writeCorruptLedgerEntry();

    const run = await runDoctor();

    expect(run.out).toContain(SKIPPED_HEADLINE);
    expect(run.out).toContain('broken.json');
    expect(run.exitCode).toBeUndefined();
  }, 60_000);

  it('reports without an objectstack.config.ts — ledger readability is not a config-derived fact', async () => {
    // The ledger half never needed the config: it reads a directory. Leaving
    // the check inside the config-analysis block would have replaced a posture
    // gate with a config gate — the same silence one condition along, which is
    // the widening #5382 made for the posture reader for the same reason.
    setPosture('single');
    expect(fs.existsSync(path.join(tmp, 'objectstack.config.ts'))).toBe(false);
    writeUnreadableLedgerDirectory();

    const run = await runDoctor();

    expect(run.out).toContain(LEDGER_HEADLINE);
    expect(run.out).toContain(LEDGER_ROW_NAME);
  }, 60_000);

  // ② Dedup: `isolated` has both the standalone check and the D5e advisory
  //    live, and one bad ledger must still produce one finding.
  describe("under the 'isolated' posture, where both checks are live", () => {
    it('reports an unreadable DIRECTORY exactly once, and still withholds the ✓', async () => {
      setPosture('isolated');
      writeConfig();
      writeUnreadableLedgerDirectory();

      const run = await runDoctor();

      expect(occurrences(run.out, LEDGER_HEADLINE)).toBe(1);
      // The D5e success line is a claim about both halves of that advisory and
      // only one of them ran — unchanged from #5412.
      expect(run.out).not.toContain(CLEAN_BILL);
      expect(run.exitCode).toBeUndefined();
    }, 60_000);

    it('reports a corrupt ENTRY exactly once, and still withholds the ✓', async () => {
      setPosture('isolated');
      writeConfig();
      writeCorruptLedgerEntry();

      const run = await runDoctor();

      expect(occurrences(run.out, SKIPPED_HEADLINE)).toBe(1);
      expect(occurrences(run.out, 'broken.json')).toBe(1);
      expect(run.out).not.toContain(CLEAN_BILL);
    }, 60_000);

    it('still reports the unique-scope advisory itself — the D5e half is untouched', async () => {
      setPosture('isolated');
      writeConfig();
      fs.mkdirSync(ledgerPath(), { recursive: true });
      fs.writeFileSync(
        path.join(ledgerPath(), 'billing.json'),
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

      const run = await runDoctor();

      // The advisory reads the entries the standalone check already loaded.
      expect(run.out).toContain('invoice.code');
      expect(run.out).toContain("installed package 'billing'");
      expect(run.out).toContain('Unique scope');
      // A readable ledger produces no readability row at all.
      expect(run.out).not.toContain(LEDGER_ROW_NAME);
    }, 60_000);
  });

  // ③ Zero noise. A healthy ledger — and a project that never installed
  //    anything — must leave the report exactly as it was, under every posture.
  describe.each([...BLIND_POSTURES, 'isolated'] as const)("a healthy ledger is silent under '%s'", (posture) => {
    it('says nothing about the ledger when every entry reads clean', async () => {
      setPosture(posture);
      writeConfig();
      fs.mkdirSync(ledgerPath(), { recursive: true });
      fs.writeFileSync(
        path.join(ledgerPath(), 'clean.json'),
        JSON.stringify({ manifestId: 'clean', manifest: { objects: [] } }),
      );

      const run = await runDoctor(['--verbose']);

      expect(run.out).not.toContain(LEDGER_HEADLINE);
      expect(run.out).not.toContain(SKIPPED_HEADLINE);
      expect(run.out).not.toContain(LEDGER_ROW_NAME);
      expect(run.exitCode).toBeUndefined();
    }, 60_000);

    it('says nothing when nothing was ever installed', async () => {
      setPosture(posture);
      writeConfig();
      expect(fs.existsSync(ledgerPath())).toBe(false);

      const run = await runDoctor(['--verbose']);

      expect(run.out).not.toContain(LEDGER_HEADLINE);
      expect(run.out).not.toContain(SKIPPED_HEADLINE);
      expect(run.out).not.toContain(LEDGER_ROW_NAME);
      expect(run.exitCode).toBeUndefined();
    }, 60_000);
  });

  it("keeps the D5e clean bill under 'isolated' when the ledger is healthy", async () => {
    // The success line still belongs to the advisory, not to the new check —
    // the two are separate rows with separate subjects.
    setPosture('isolated');
    writeConfig();
    fs.mkdirSync(ledgerPath(), { recursive: true });
    fs.writeFileSync(
      path.join(ledgerPath(), 'clean.json'),
      JSON.stringify({ manifestId: 'clean', manifest: { objects: [] } }),
    );

    const run = await runDoctor(['--verbose']);

    expect(run.out).toContain(CLEAN_BILL);
  }, 60_000);
});
