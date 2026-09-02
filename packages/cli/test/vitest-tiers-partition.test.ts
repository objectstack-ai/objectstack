// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two tiers of this package's suite stay a PARTITION, and the integration
 * list stays equal to what the files DO (#13504).
 *
 * `vitest.config.ts` splits the suite into two named projects — `unit` (the
 * local default) and `integration` (spawns the real CLI or boots a real
 * kernel/driver; CI-mandatory, local on demand). Two things can rot under a
 * split like that, and both rot silently, which is why this pin exists:
 *
 *  1. A test file that matches NO project is not run by `vitest run` at all —
 *     not by the fast tier AND not by `pnpm test` in CI, because with
 *     `projects` configured the root run IS the union of the projects. A file
 *     matching BOTH runs twice and reports twice. So the first two cases hold
 *     `unit ⊎ integration = every test file on disk`, read from vitest's own
 *     resolution (`vitest list --filesOnly`, with and without `--project`)
 *     against a filesystem walk — the config's spelling is judged by what
 *     vitest actually collects, never by re-reading the config.
 *
 *  2. `INTEGRATION_FILES` is an explicit list, and the `*.e2e.test.ts` NAME is
 *     not the predicate (the ACCEPT on #13504 measured 18 of 220 files where
 *     name and behaviour disagree). So the third case re-derives the tier of
 *     every file from its comment-masked SOURCE and fails when the list and
 *     the derivation disagree — a new spawner cannot land in the fast tier
 *     unnoticed, and a stale entry cannot linger. The predicate, in code
 *     position (comments masked by `scripts/js-comment-mask.mjs`):
 *
 *       SPAWN   = calls `runServe(` (the helper in `test/helpers/serve-process.ts`
 *                 whose body spawns the source entry), OR value-imports
 *                 `node:child_process` AND (names an entry basename — the
 *                 `run-dev` / `run` scripts under `bin/` — OR imports `CLI` /
 *                 `TSX` from that helper OR names the `tsx` binary under
 *                 `node_modules/.bin`);
 *       KERNEL  = value-imports `bootSchemaStack` from `schema-migrate`, OR
 *                 value-imports `better-sqlite3`, OR value-imports any
 *                 `@objectstack/driver-*` package, OR constructs `new ObjectQL(`.
 *       INTEGRATION = SPAWN ∨ KERNEL.
 *
 *     Value imports only: `import type { … } from '@objectstack/driver-sql'`
 *     loads nothing, a spelling list that SAYS `'better-sqlite3'` opens no
 *     database, and `expect(deps).toContain('better-sqlite3')` boots nothing —
 *     every one of those was a false positive of the text-match census this
 *     predicate replaced. An import statement is one `import … from '<spec>'`
 *     span containing neither `;` nor another `from` (every import in this
 *     package's tests ends in `;`, measured on 00ff228fe0).
 *
 * The fourth case classifies THIS file: it imports `node:child_process` (to
 * ask vitest for its file lists) and must still read as `unit`, which is the
 * predicate's own regression test against matching its own source.
 *
 * Runs in the `unit` tier and needs no built `dist/`: it spawns `vitest list`,
 * which only globs, and reads sources.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { childEnv } from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const THIS_FILE = relative(PKG, fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const VITEST_ENTRY = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

interface ValueImport {
  clause: string;
  spec: string;
}

/** One `import … from '<spec>'` statement; `import type` is skipped. */
const IMPORT_RE = /\bimport\s+(?!type\b)((?:(?!\bfrom\b)[^;])*?)\bfrom\s+['"]([^'"]+)['"]/g;

function valueImports(code: string): ValueImport[] {
  const out: ValueImport[] = [];
  for (const m of code.matchAll(IMPORT_RE)) out.push({ clause: m[1], spec: m[2] });
  return out;
}

/** Inline `type X` specifiers do not make a value import of `X`. */
function importsValue(imports: ValueImport[], spec: RegExp, name?: RegExp): boolean {
  return imports.some((i) => spec.test(i.spec) && (!name || name.test(i.clause.replace(/\btype\s+\w+/g, ''))));
}

export interface TierSignals {
  runServe: boolean;
  childProcess: boolean;
  entryBasename: boolean;
  helperCliOrTsx: boolean;
  tsxBin: boolean;
  bootSchemaStack: boolean;
  betterSqlite3: boolean;
  driverPackage: boolean;
  objectQLCtor: boolean;
}

export function tierSignals(maskedCode: string): TierSignals {
  const imports = valueImports(maskedCode);
  return {
    runServe: /\brunServe\s*[(]/.test(maskedCode),
    childProcess: importsValue(imports, /^(?:node:)?child_process$/),
    entryBasename: /\brun(?:-dev)?[.]js\b/.test(maskedCode),
    helperCliOrTsx: importsValue(imports, /helpers\/serve-process(?:\.js)?$/, /\b(?:CLI|TSX)\b/),
    tsxBin: /[.]bin[/]tsx\b/.test(maskedCode),
    bootSchemaStack: importsValue(imports, /schema-migrate(?:\.js)?$/, /\bbootSchemaStack\b/),
    betterSqlite3: importsValue(imports, /^better-sqlite3$/) || /require[(]\s*['"]better-sqlite3['"]\s*[)]/.test(maskedCode),
    driverPackage: importsValue(imports, /^@objectstack\/driver-/),
    objectQLCtor: /new\s+ObjectQL\s*[(]/.test(maskedCode),
  };
}

export function isIntegration(s: TierSignals): boolean {
  const spawn = s.runServe || (s.childProcess && (s.entryBasename || s.helperCliOrTsx || s.tsxBin));
  const kernel = s.bootSchemaStack || s.betterSqlite3 || s.driverPackage || s.objectQLCtor;
  return spawn || kernel;
}

function firedSignals(s: TierSignals): string {
  return (Object.keys(s) as Array<keyof TierSignals>).filter((k) => s[k]).join(', ') || 'none';
}

// ---------------------------------------------------------------------------
// The two readings: the filesystem, and vitest's own resolution
// ---------------------------------------------------------------------------

const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (TEST_FILE_RE.test(entry.name)) out.push(relative(PKG, abs));
  }
  return out;
}

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

/** The explicit list as `vitest.config.ts` declares it — read as text, not imported. */
function declaredIntegrationFiles(): string[] {
  const masked = maskComments(readFileSync(join(PKG, 'vitest.config.ts'), 'utf8'));
  const block = /INTEGRATION_FILES\s*=\s*\[([^\]]*)\]/.exec(masked);
  if (!block) throw new Error('vitest.config.ts no longer declares `INTEGRATION_FILES = [ … ]`');
  return Array.from(block[1].matchAll(/['"]([^'"]+)['"]/g), (m) => m[1]);
}

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

describe('the two tiers of packages/cli (#13504)', () => {
  const onDisk = sorted(walk(PKG));
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

  it('INTEGRATION_FILES equals the behavioural predicate over every file on disk', () => {
    const declared = declaredIntegrationFiles();
    expect(sorted(new Set(declared)), 'INTEGRATION_FILES carries a duplicate').toEqual(sorted(declared));
    expect(sorted(declared), 'an INTEGRATION_FILES entry names no file vitest can find').toEqual(integration);

    const missing: string[] = [];
    const stale: string[] = [];
    for (const file of onDisk) {
      const signals = tierSignals(maskComments(readFileSync(join(PKG, file), 'utf8')));
      const predicted = isIntegration(signals);
      const listed = integration.includes(file);
      if (predicted && !listed) missing.push(`${file}  [${firedSignals(signals)}]`);
      if (!predicted && listed) stale.push(file);
    }
    expect(
      missing,
      'files that spawn the CLI or boot a kernel/driver but are NOT in INTEGRATION_FILES (add them)',
    ).toEqual([]);
    expect(stale, 'INTEGRATION_FILES entries that neither spawn nor boot (remove them)').toEqual([]);
  });

  it('this pin is itself unit-tier: importing child_process to ask vitest is not spawning the CLI', () => {
    const signals = tierSignals(maskComments(readFileSync(join(PKG, THIS_FILE), 'utf8')));
    expect(signals.childProcess).toBe(true);
    expect(isIntegration(signals), `fired: ${firedSignals(signals)}`).toBe(false);
    expect(unit).toContain(THIS_FILE);
  });
});
