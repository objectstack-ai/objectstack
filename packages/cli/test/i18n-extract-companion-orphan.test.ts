// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The provenance companion accompanies the bundle modules beside it, and its
 * section list is read off their payloads (#16242).
 *
 * ## What was wrong
 *
 * `os i18n extract --source-hashes` narrowed the provenance table to "the
 * sections this run commits", and built that list from two LITERALS:
 *
 *     if (emittedModules(locale).some((m) => m.kind !== 'metadataForms')) committed.push('objects');
 *     if (emittedModules(locale).some((m) => m.kind === 'metadataForms')) committed.push('metadataForms');
 *
 * The "which modules were emitted" half already read the emitted set; what it
 * PUSHED was a hand-copied name. Two consequences, one cause:
 *
 *  1. under `kind: 'stack'` the module holds every group the stack authors
 *     (`objects`, `apps`, `dashboards`, ...) while the caller named one of
 *     them — a list that is correct only for as long as no other section can
 *     appear in the table;
 *  2. with NO module emitted the list is empty, `narrowToCommittedSections`
 *     returns `{}`, and `{}` is truthy at the emit site — so the run wrote a
 *     zero-record companion with no bundle module beside it for it to be
 *     about, and `--check` compares the companion by bytes like any other
 *     emitted file, so that orphan once committed is a file the gate demands
 *     forever.
 *
 * ## Why these cases drive the real CLI
 *
 * The defect is about WHICH FILES EXIST, decided apart from the modules they
 * accompany. A mirror of the emit rule — the shape
 * `i18n-extract-emitted-files.test.ts` uses deliberately — cannot see it: it
 * re-implements the rule, so it agrees with the rule by construction and would
 * have written the orphan too. Every case here therefore reads the real
 * directory the real command wrote.
 *
 * ⚠️ Symptom 1 as the card diagnosed it — an `apps.*` provenance record being
 * FILTERED OUT — does not occur, and the third case below is the measurement
 * that says so rather than a pin of a repair. The provenance table is built by
 * `collectFilledFromHashes`, which walks `GENERATED_SECTIONS`
 * (`['objects', 'metadataForms']`) in `@objectstack/platform-objects`, so an
 * `apps.*` record never enters the table to be dropped. What the derived list
 * buys is that the caller's statement stops being true by coincidence.
 *
 * ## Tier, and why the name carries no `.e2e`
 *
 * This file spawns the real CLI, so the behavioural predicate in
 * `../vitest-tiers.ts` puts it in the `integration` PROJECT. The `.e2e` NAME
 * would additionally move it into the `OS_TEST_TIERS=nightly` POPULATION —
 * the two cuts are independent, and the name is the one that decides the RUN.
 * A `--check` semantics guard belongs in the queue's run, so it is named like
 * its siblings `i18n-extract-check-json.test.ts` and
 * `i18n-extract-check-dry-run.test.ts`, which spawn the CLI under the same
 * cut, and unlike `i18n-extract-key-count.e2e.test.ts`, which is nightly.
 *
 * ## Fixture placement
 *
 * As in `i18n-extract-key-count.e2e.test.ts`: the stack config goes under this
 * package's git-ignored `tmp/` so that `bundle-require`'s bundled module
 * resolves the bare `@objectstack/spec` specifier out of this package's real
 * `node_modules`, and the `--out` root goes in the system temp dir. `afterAll`
 * removes only this suite's own `mkdtemp` directories — several suites share
 * that root and run concurrently.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const CLI_PACKAGE_ROOT = resolve(HERE, '..');

/** One object (2 leaves) + one app (1 leaf); the registry baseline rides along. */
const STACK_CONFIG = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },",
  "  objects: [{ name: 'kpi_metric', label: 'Metric', fields: { name: { type: 'text', label: 'Name' } } }],",
  "  apps: [{ name: 'kpi', label: 'KPI Console' }],",
  '});',
  '',
].join('\n');

/**
 * No `objects` at all. Under the default `--objects-only` the stack module's
 * sub-tree is empty, so no module is written — the input class that produced
 * the orphan.
 */
const APPS_ONLY_CONFIG = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },",
  "  apps: [{ name: 'kpi', label: 'KPI Console' }],",
  '});',
  '',
].join('\n');

let fixtureRoot: string;
let outRoot: string;
let CONFIG: string;
let APPS_ONLY: string;

beforeAll(() => {
  const sharedRoot = join(CLI_PACKAGE_ROOT, 'tmp');
  mkdirSync(sharedRoot, { recursive: true });
  fixtureRoot = mkdtempSync(join(sharedRoot, 'os-i18n-16242-fixture-'));
  CONFIG = join(fixtureRoot, 'stack.config.ts');
  APPS_ONLY = join(fixtureRoot, 'apps-only.config.ts');
  writeFileSync(CONFIG, STACK_CONFIG, 'utf8');
  writeFileSync(APPS_ONLY, APPS_ONLY_CONFIG, 'utf8');
  outRoot = mkdtempSync(join(tmpdir(), 'os-i18n-16242-'));
}, 300_000);

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(outRoot, { recursive: true, force: true });
});

/** stdout with SGR sequences removed — chalk is off through a pipe, belt and braces. */
function plain(text: string): string {
  // The escape byte is SPELLED, never embedded: a raw control byte in a source
  // file renders as nothing and is findable by neither spelling.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function runExtract(
  name: string,
  config: string,
  flags: readonly string[],
): { stdout: string; dir: string; files: string[] } {
  const dir = join(outRoot, name);
  const stdout = execFileSync(
    TSX,
    [CLI, 'i18n', 'extract', config, '--locales=ja-JP', '--source-hashes', '--fill=default', ...flags, `--out=${dir}`],
    { encoding: 'utf8', env: childEnv(), timeout: 180_000 },
  );
  return { stdout: plain(stdout), dir, files: existsSync(dir) ? readdirSync(dir).sort() : [] };
}

/** The dotted keys of a rendered `<locale>.source-hashes.generated.ts`. */
function companionKeys(dir: string, locale = 'ja-JP'): string[] {
  const src = readFileSync(join(dir, `${locale}.source-hashes.generated.ts`), 'utf8');
  return [...src.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]).sort();
}

/** Leaves of an emitted bundle module, counted off its bytes. */
function leavesOnDisk(dir: string, file: string): number {
  const src = readFileSync(join(dir, file), 'utf8');
  return [...src.matchAll(/^[ \t]+(?:"[^"]*"|[A-Za-z_$][\w$]*): "/gm)].length;
}

describe('os i18n extract — the provenance companion accompanies a module (#16242)', () => {
  /**
   * Symptom 2. Falsifier: restoring the literal list makes this run write
   * exactly one file, `ja-JP.source-hashes.generated.ts`, holding an empty
   * table — measured on `41cbc54fc5` before the repair.
   */
  it('writes no companion at all when the run commits no bundle module', () => {
    const run = runExtract('orphan', APPS_ONLY, ['--no-metadata-forms']);

    expect(run.files).toEqual([]);
    expect(run.stdout).toContain('Generated 0 file(s)');
    // Specifically not the zero-record file: a companion with no module beside
    // it describes nothing that exists.
    expect(run.stdout).not.toContain('source-hashes.generated.ts');
  });

  /**
   * The settled `--check` semantics for a repository that already committed one
   * of those orphans (#16242 acceptance item 4). `compareCommitted` iterates the
   * EMITTED list and reports `missing` / `stale` over it; a file on disk that
   * this run does not write is in neither category, so the leftover is
   * tolerated, not demanded and not deleted. Pinned because it is a decision,
   * not an accident — and because the alternative reading (delete it, or fail on
   * it) would be a silently breaking change for those repositories.
   *
   * ⭐ The seeded bytes are deliberately a STUB rather than a faithful copy of
   * what the old command rendered. The property being measured is that this
   * file is not in the compared set AT ALL — a case seeded with bytes the run
   * would itself produce could not tell "not compared" apart from "compared and
   * equal". Ablating the emit gate reddens this case for that reason: the old
   * command writes a companion, compares it against the stub, and reports it
   * out of date.
   */
  it('tolerates an already-committed empty companion — neither demanded nor deleted', () => {
    const dir = join(outRoot, 'legacy-orphan');
    mkdirSync(dir, { recursive: true });
    const legacy = join(dir, 'ja-JP.source-hashes.generated.ts');
    writeFileSync(
      legacy,
      "export const jaJPGeneratedSourceHashes: Readonly<Record<string, string>> = {\n};\n",
      'utf8',
    );

    const stdout = plain(
      execFileSync(
        TSX,
        [
          CLI, 'i18n', 'extract', APPS_ONLY, '--locales=ja-JP', '--source-hashes',
          '--fill=default', '--no-metadata-forms', '--check', `--out=${dir}`,
        ],
        { encoding: 'utf8', env: childEnv(), timeout: 180_000 },
      ),
    );

    // Exit 0 — `execFileSync` would have thrown on the drift exit.
    expect(stdout).toContain('in sync with the schema');
    expect(existsSync(legacy)).toBe(true);
  });

  /**
   * The live path, and the case that catches the WRONG derivation. Reading the
   * section list off the payload's own top-level keys would commit
   * `['kpi_metric']` here — the object's name, not the section — and narrow
   * every `objects.*` record away, leaving a zero-record companion beside a
   * 2-leaf module. That is the one path this repository's single
   * `--source-hashes` config is on.
   */
  it('keeps its objects records under the default --objects-only', () => {
    const run = runExtract('objects-only', CONFIG, ['--no-metadata-forms']);

    expect(run.files).toEqual(['ja-JP.objects.generated.ts', 'ja-JP.source-hashes.generated.ts', 'zh-CN.objects.generated.ts']);
    expect(companionKeys(run.dir)).toEqual([
      'objects.kpi_metric.fields.name.label',
      'objects.kpi_metric.label',
    ]);
  });

  /**
   * The same table survives the multi-section stack module, where the caller now
   * commits `objects` AND `apps` instead of naming one literal.
   *
   * ⚠️ Two records, not three. `apps.kpi.label` IS a leaf of the emitted module
   * and it has no provenance record — but it is not narrowed away, it is never
   * recorded: `collectFilledFromHashes` walks `GENERATED_SECTIONS`, and `apps`
   * is a HAND_AUTHORED section judged by a different predicate against a
   * different, hand-maintained file. So this case pins the measurement, not a
   * repair, and its number would not move if the section list were reverted.
   */
  it('keeps every objects record when the stack module commits several sections', () => {
    const run = runExtract('stack', CONFIG, ['--no-objects-only', '--no-metadata-forms']);

    expect(leavesOnDisk(run.dir, 'ja-JP.objects.generated.ts')).toBe(3);
    expect(companionKeys(run.dir)).toEqual([
      'objects.kpi_metric.fields.name.label',
      'objects.kpi_metric.label',
    ]);
  });
}, 900_000);
