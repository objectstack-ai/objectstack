// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two tiers of this package's suite stay a PARTITION, and the tier of
 * every file stays what the file DOES (#13504, #14554).
 *
 * `vitest.config.ts` splits the suite into two named projects — `unit` (the
 * local default) and `integration` (spawns the real CLI or boots a real
 * kernel/driver; CI-mandatory, local on demand). The membership is DERIVED at
 * config load by `../vitest-tiers.ts`, not written down, and that module's
 * header carries the merge-queue ejections the old frozen list caused.
 *
 * ## What is left for a pin once the list is derived (#14554)
 *
 * A derived list cannot go stale, so the assertion this pin used to lead with
 * — declared list == predicate — is gone with the list. Three jobs remain, and
 * they are the ones that were always doing the real work:
 *
 *  1. **COVERAGE.** A test file that matches NO project is not run by
 *     `vitest run` at all — not by the fast tier AND not by `pnpm test` in CI,
 *     because with `projects` configured the root run IS the union of the
 *     projects. vitest 4.1.10 reports that whole-suite run GREEN while never
 *     executing the file. A file matching BOTH runs twice and reports twice.
 *     So the first two cases hold `unit ⊎ integration = every test file on
 *     disk`, read from vitest's own resolution (`vitest list --filesOnly`,
 *     with and without `--project`) against a filesystem walk — the config's
 *     spelling is judged by what vitest actually COLLECTS, never by re-reading
 *     the config. This is the defect the tier split can cause and the reason
 *     the split can never simply be deleted.
 *
 *  2. **THE DERIVATION REACHES VITEST.** Computing the right set in the config
 *     and having vitest collect it are two different facts: the entries are
 *     handed to `include` / `exclude` as GLOBS, so a path the walk spells one
 *     way and tinyglobby reads another lands in the wrong tier while every
 *     count still looks right. The third case therefore compares the
 *     `integration` population vitest REPORTS against an independent
 *     re-derivation over the tree — the end-to-end reading the old list-vs-
 *     predicate comparison could not make. ⚠️ Unlike that comparison, it
 *     cannot fire merely because a qualifying file arrived on `main`: such a
 *     file is classified by the same config that collects it.
 *
 *  3. **THE PREDICATE ITSELF.** The config and this pin now share one
 *     predicate, so nothing that compares them can see a predicate that is
 *     WRONG — where the frozen list, an independent human record, would have
 *     disagreed with it. `../vitest-tiers.fixtures.ts` replaces that
 *     independence in kind: whole tiny sources whose tier is known by
 *     construction, one per signal and one per false positive the predicate
 *     was tuned against, plus a union check so a newly declared signal without
 *     a fixture is red. A predicate that matched nothing would otherwise empty
 *     the integration tier, serialise the suite back into `unit`, and leave
 *     every population assertion above green.
 *
 * The predicate is stated once, in `../vitest-tiers.ts`, and is NOT restated
 * here: SPAWN or KERNEL, in code position, comments masked. ⛔ #14554 changed
 * how membership is maintained and nothing about what a tier MEANS.
 *
 * The last case classifies THIS file: it imports child_process (to ask vitest
 * for its file lists) and must still read as `unit`, which is the predicate's
 * own regression test against matching its own source.
 *
 * Runs in the `unit` tier and needs no built `dist/`: it spawns `vitest list`,
 * which only globs, and reads sources.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { childEnv } from './helpers/serve-process.js';
import {
  firedSignals,
  integrationTestFiles,
  isIntegration,
  testFilesOnDisk,
  tierOfFile,
  tierSignals,
  type TierSignals,
} from '../vitest-tiers.js';
import { PREDICATE_CASES } from '../vitest-tiers.fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const THIS_FILE = relative(PKG, fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const VITEST_ENTRY = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

/** `vitest list --filesOnly [--project NAME]`, one relative path per line. */
function vitestFiles(project?: string): string[] {
  const args = [VITEST_ENTRY, 'list', '--filesOnly', ...(project ? ['--project', project] : [])];
  const out = execFileSync(process.execPath, args, {
    cwd: PKG,
    env: childEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\[[^\]]+\]\s+/, ''));
}

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

describe('the two tiers of packages/cli (#13504, #14554)', () => {
  const onDisk = testFilesOnDisk(PKG);
  const all = sorted(vitestFiles());
  const unit = sorted(vitestFiles('unit'));
  const integration = sorted(vitestFiles('integration'));

  it('every test file on disk is one vitest collects with no --project (what `pnpm test` runs)', () => {
    expect(onDisk.length).toBeGreaterThan(100);
    expect(all, 'vitest run collects a different population than the filesystem holds').toEqual(onDisk);
  });

  it('unit and integration partition that population — no file in both, none in neither', () => {
    const inBoth = unit.filter((f) => integration.includes(f));
    expect(inBoth, 'files matched by BOTH projects (they would run and report twice)').toEqual([]);
    const union = sorted([...unit, ...integration]);
    expect(union, 'files matched by NEITHER project fall out of every tier, including CI').toEqual(all);
  });

  it('the integration tier vitest collects is the behavioural predicate, re-derived over the tree', () => {
    const predicted = integrationTestFiles(PKG);

    const missing = predicted
      .filter((f) => !integration.includes(f))
      .map((f) => `${f}  [${firedSignals(tierOfFile(PKG, f))}]`);
    expect(
      missing,
      'files the predicate calls integration that vitest did NOT collect into that project — ' +
        'the derivation did not reach vitest (a path spelled one way by the walk and another by the glob)',
    ).toEqual([]);

    const extra = integration.filter((f) => !predicted.includes(f));
    expect(extra, 'files vitest collected as integration that the predicate does not call integration').toEqual([]);
  });

  it('the config DERIVES that population rather than freezing a copy of it', () => {
    const masked = maskComments(readFileSync(join(PKG, 'vitest.config.ts'), 'utf8'));
    expect(
      /integrationTestFiles\s*[(]/.test(masked),
      'vitest.config.ts no longer derives its integration tier from `integrationTestFiles(`',
    ).toBe(true);
    expect(
      /INTEGRATION_FILES\s*=\s*\[/.test(masked),
      'vitest.config.ts froze the integration tier back into a literal list. That list goes stale when ' +
        'ANOTHER PR lands a qualifying test file, and the pin then reds in the merge queue against a tree ' +
        'the failing PR never touched — five ejected PRs in 24 hours, four of them bystanders (#14554).',
    ).toBe(false);
  });

  it('this pin is itself unit-tier: importing child_process to ask vitest is not spawning the CLI', () => {
    const signals = tierOfFile(PKG, THIS_FILE);
    expect(signals.childProcess).toBe(true);
    expect(isIntegration(signals), `fired: ${firedSignals(signals)}`).toBe(false);
    expect(unit).toContain(THIS_FILE);
  });
});

describe('the predicate itself, against sources whose tier is known by construction (#14554)', () => {
  it('every signal the predicate declares is fired by some fixture', () => {
    const declared = sorted(Object.keys(tierSignals('')));
    const covered = sorted(new Set(PREDICATE_CASES.flatMap((c) => c.fires)));
    expect(
      covered,
      'a signal with no fixture is a signal whose regex can be deleted with every assertion still green',
    ).toEqual(declared);
  });

  for (const testCase of PREDICATE_CASES) {
    const tier = testCase.integration ? 'integration' : 'unit';
    it(`${tier}: ${testCase.name}`, () => {
      const signals: TierSignals = tierSignals(maskComments(testCase.source));
      expect(isIntegration(signals), `${testCase.why} — fired: ${firedSignals(signals)}`).toBe(testCase.integration);
      for (const signal of testCase.fires) {
        expect(signals[signal], `${signal} must fire here — fired: ${firedSignals(signals)}`).toBe(true);
      }
      for (const signal of testCase.silent ?? []) {
        expect(signals[signal], `${signal} must NOT fire here — fired: ${firedSignals(signals)}`).toBe(false);
      }
    });
  }
});
