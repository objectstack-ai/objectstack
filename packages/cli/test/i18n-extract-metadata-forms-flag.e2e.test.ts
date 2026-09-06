// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--no-metadata-forms` is honoured whatever `--objects-only` is set to, and
 * the Studio baseline lands in exactly one module either way (#14894).
 *
 * ## Why this drives the real CLI instead of mirroring the rule
 *
 * The sibling pin `i18n-extract-emitted-files.test.ts` re-implements the emit
 * rule in the test and checks the FILE NAMES it produces. That shape is what
 * let this defect through: the file set was right in every combination — the
 * two flags picked the right two files — while the CONTENT of one of them was
 * wrong, and a mirror of the rule cannot see the content because it never
 * renders anything. So this file spawns `bin/run-dev.js` and reads the bytes
 * the command actually wrote.
 *
 * ## What was wrong
 *
 * `--metadata-forms` gated only `<locale>.metadata-forms.generated.ts`, while
 * the renderer's `kind: 'full'` (now `'stack'`) folded the same `metadataForms`
 * sub-tree into `<locale>.objects.generated.ts` whenever `--no-objects-only`
 * was passed. Measured on the fixture below before the fix:
 *
 *   • `--no-metadata-forms --no-objects-only` → one file, 776 leaves, of which
 *     773 were the metadata-form baseline the flag had just switched off. The
 *     stack's own surface was 3 leaves (one object label, one field label, one
 *     app label).
 *   • `--no-objects-only` alone → the same 773 keys in BOTH modules.
 *
 * The fixture's `defaultLocale` is `zh-CN` on purpose: the default locale is
 * filled from the source labels, and the metadata-form registry authors those
 * in English, so this is the shape from the report — a zh-CN bundle carrying
 * the platform's English Studio strings.
 *
 * ## What is asserted, and what is deliberately not
 *
 * The assertions are a GROUP CENSUS of each emitted module (which top-level
 * groups, and how many leaves), not a substring search. A duplicate group is
 * invisible to `toContain`, and a duplicate is half of what this closes.
 *
 * ⛔ Not asserted: the exact baseline key count. It is registry-driven and
 * moves with every `*.form.ts` in `packages/spec`; pinning it here would make
 * this file fail for reasons that have nothing to do with the flags. What is
 * pinned is the INVARIANT — the baseline is in the companion or nowhere, and
 * never in two places at once.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/**
 * The fixture lives under `packages/cli` rather than in `tmpdir` because
 * `bundle-require` resolves the config's own `@objectstack/spec` import from
 * the config file's directory — from outside the workspace there is no
 * `node_modules` to find it in.
 */
const FIXTURE_DIR = join(HERE, '.tmp-i18n-14894');
const CONFIG = join(FIXTURE_DIR, 'stack.config.ts');

const CONFIG_SOURCE = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },",
  "  objects: [{ name: 'kpi_metric', label: 'Metric', fields: { name: { type: 'text', label: 'Name' } } }],",
  "  apps: [{ name: 'kpi', label: 'KPI Console' }],",
  '});',
  '',
].join('\n');

let outRoot: string;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(CONFIG, CONFIG_SOURCE, 'utf8');
  outRoot = mkdtempSync(join(tmpdir(), 'os-i18n-14894-'));
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  rmSync(outRoot, { recursive: true, force: true });
});

/** Run the real command; returns stdout and the files it left in `--out`. */
function extract(name: string, flags: string[]): { stdout: string; files: string[]; dir: string } {
  const dir = join(outRoot, name);
  const stdout = execFileSync(TSX, [CLI, 'i18n', 'extract', CONFIG, '--locales=zh-CN', ...flags, `--out=${dir}`], {
    encoding: 'utf8',
    env: childEnv(),
    timeout: 180_000,
  });
  return { stdout, files: readdirSync(dir).sort(), dir };
}

/** Top-level groups of a generated module's exported const, in emit order. */
function groups(dir: string, file: string): string[] {
  const src = readFileSync(join(dir, file), 'utf8');
  const body = src.slice(src.indexOf(' = {'));
  return [...body.matchAll(/^ {2}("[^"]+"|[A-Za-z_$][\w$]*):/gm)].map((m) => m[1].replace(/"/g, ''));
}

/** Leaf strings in a generated module — every `key: "value"` the emitter wrote. */
function leaves(dir: string, file: string): number {
  return (readFileSync(join(dir, file), 'utf8').match(/: "/g) ?? []).length;
}

describe('os i18n extract — the metadata-form baseline has exactly one home (#14894)', () => {
  it('honours --no-metadata-forms under --no-objects-only (the reported defect)', () => {
    const run = extract('no-mf-no-oo', ['--no-metadata-forms', '--no-objects-only']);

    expect(run.files).toEqual(['zh-CN.objects.generated.ts']);
    // The stack's own surface, and nothing else. Before the fix this module
    // also carried a `metadataForms` group of 773 English leaves.
    expect(groups(run.dir, 'zh-CN.objects.generated.ts')).toEqual(['objects', 'apps']);
    expect(leaves(run.dir, 'zh-CN.objects.generated.ts')).toBe(3);
  });

  it('keeps the baseline out of the stack module even with --metadata-forms ON', () => {
    const run = extract('mf-no-oo', ['--no-objects-only']);

    expect(run.files).toEqual(['zh-CN.metadata-forms.generated.ts', 'zh-CN.objects.generated.ts']);
    expect(groups(run.dir, 'zh-CN.objects.generated.ts')).toEqual(['objects', 'apps']);
    expect(leaves(run.dir, 'zh-CN.objects.generated.ts')).toBe(3);
    // The baseline is emitted — in its own module, once. Before the fix these
    // same keys were in both files.
    expect(leaves(run.dir, 'zh-CN.metadata-forms.generated.ts')).toBeGreaterThan(100);
  });

  it('is unchanged under the default --objects-only, in both flag positions', () => {
    const off = extract('no-mf-oo', ['--no-metadata-forms']);
    expect(off.files).toEqual(['zh-CN.objects.generated.ts']);
    expect(groups(off.dir, 'zh-CN.objects.generated.ts')).toEqual(['kpi_metric']);

    const on = extract('mf-oo', []);
    expect(on.files).toEqual(['zh-CN.metadata-forms.generated.ts', 'zh-CN.objects.generated.ts']);
    expect(groups(on.dir, 'zh-CN.objects.generated.ts')).toEqual(['kpi_metric']);
  });

  it('--json carries the same payload the files would have carried', () => {
    // `--json` is documented as "output JSON instead of writing files", so the
    // sub-tree the emitter refuses to write must not arrive here either.
    const stdout = execFileSync(
      TSX,
      [CLI, 'i18n', 'extract', CONFIG, '--locales=zh-CN', '--json', '--no-objects-only', '--no-metadata-forms'],
      { encoding: 'utf8', env: childEnv(), timeout: 180_000 },
    );
    const payload = JSON.parse(stdout) as {
      bundles: Record<string, Record<string, unknown>>;
      metadataFormsCounts: Record<string, number>;
    };

    expect(Object.keys(payload.bundles['zh-CN']).sort()).toEqual(['apps', 'objects']);
    // Suppressed from the payload, still reported as a count — the operator can
    // still see how big the baseline they opted out of is.
    expect(payload.metadataFormsCounts['zh-CN']).toBeGreaterThan(100);
  });
  // Each case spawns the CLI through `tsx`; measured at ~6 s per run on a
  // shared box, well over vitest's 5 s default. Same instrument and same
  // generous ceiling as the sibling CLI-spawning pins in this directory.
}, 900_000);
