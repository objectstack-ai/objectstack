// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `unit` / `integration` tier predicate for this package's suite, and the
 * DERIVATION of the integration population from it (#13504, #14554).
 *
 * `vitest.config.ts` imports `integrationTestFiles()` and hands the result
 * straight to the two projects; `test/vitest-tiers-partition.test.ts` imports
 * the same predicate to pin what the derivation cannot pin about itself. This
 * module is the single source of both, which is the whole point of it existing
 * as a module rather than as a literal array in the config.
 *
 * ## Why the population is derived and not written down (#14554)
 *
 * It used to be a hand-maintained `INTEGRATION_FILES = [ … ]` literal in
 * `vitest.config.ts`, with the pin asserting list == predicate. That equality
 * is a real invariant and the pin was right to hold it — but the list is a
 * COPY of a fact that is already on disk, and the copy goes stale when
 * ANOTHER PR lands a qualifying test file. The pin then fires against a tree
 * whose staleness the failing PR did not create and cannot see:
 *
 *   - the pin runs in the MERGE QUEUE, against a `main` that is by
 *     construction newer than any queued PR's own run;
 *   - GitHub stacks queue entries, so one deterministic red ejects every PR
 *     behind it as well.
 *
 * Measured shape, 2026-09-02: two files entered `main` after one PR's local
 * run — `test/build-multi-package-artifact.e2e.test.ts` (new, spawns the CLI)
 * and `src/utils/schema-migration-plugins.declaration-boot-write-guard.test.ts`
 * (existing, newly constructing `new ObjectQL(`). Both satisfy the predicate,
 * neither was in the frozen list, and the pin ejected FIVE pull requests in a
 * rolling 24 hours — four of which touch no `packages/cli` path at all.
 *
 * Deriving at config load removes the copy, so a qualifying file arriving on
 * `main` is CLASSIFIED instead of REPORTED. Nothing about which tier a file
 * belongs to changes: the predicate below is character-for-character the one
 * the frozen list was maintained against, and re-deriving it over the tree
 * that carried the last hand-maintained list reproduces that list exactly —
 * 72 of 230 files, zero added, zero removed.
 *
 * ⛔ What derivation does NOT buy, and what the pin therefore still owes.
 * The config and the pin now share this predicate, so a predicate that is
 * WRONG is invisible to any assertion that compares one against the other —
 * where the frozen list, being an independent human record, would have
 * disagreed. That independence is replaced in kind, not dropped: the pin
 * exercises `tierSignals` against fixture sources for every signal and every
 * false positive the predicate was tuned against, so a weakened regex reddens
 * on the signal it weakened rather than silently emptying the integration
 * tier. See the pin's header for the full division of labour.
 *
 * ## The predicate (unchanged by #14554)
 *
 * Evaluated in code position, comments masked by `scripts/js-comment-mask.mjs`:
 *
 *   SPAWN   = calls `runServe(` (the helper in `test/helpers/serve-process.ts`
 *             whose body spawns the source entry), OR value-imports
 *             `node:child_process` AND (names an entry basename — the
 *             `run-dev` / `run` scripts under `bin/` — OR imports `CLI` / `TSX`
 *             from that helper OR names the `tsx` binary under
 *             `node_modules/.bin`);
 *   KERNEL  = value-imports `bootSchemaStack` from `schema-migrate`, OR
 *             value-imports `better-sqlite3`, OR value-imports any
 *             `@objectstack/driver-*` package, OR constructs `new ObjectQL(`.
 *   INTEGRATION = SPAWN ∨ KERNEL.
 *
 * ⛔ THE PREDICATE IS WHAT A FILE DOES, NOT WHAT IT IS CALLED — the `.e2e`
 * name and the behaviour disagree on 5 files here, and the ACCEPT on #13504
 * measured 18 of 220 disagreeing under the name-and-text census this replaced.
 *
 * Value imports only: `import type { … } from '@objectstack/driver-sql'` loads
 * nothing, a spelling list that SAYS `'better-sqlite3'` opens no database, and
 * `expect(deps).toContain('better-sqlite3')` boots nothing — every one of
 * those was a false positive of that census. An import statement is one
 * `import … from '<spec>'` span containing neither `;` nor another `from`
 * (every import in this package's tests ends in `;`, measured on 00ff228fe0).
 *
 * ## Cost, measured
 *
 * The derivation reads and masks all 230 test files: ~0.42s cold / ~0.27s warm
 * on the CI-class box this landed on, of which `maskComments` is ~0.38s and
 * the regexes ~0.01s. It is paid once per vitest config load. A raw-text
 * pre-filter would cut most of it (masking only ever REMOVES text, so a file
 * whose raw source names no signal token cannot match after masking) and is
 * deliberately NOT taken: it would add a second, hand-maintained list of
 * tokens that must track the predicate, which is the exact class of copy this
 * change exists to delete. Revisit only with a measurement that says it costs
 * something real.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { maskComments } from '../../scripts/js-comment-mask.mjs';

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

export interface ValueImport {
  clause: string;
  spec: string;
}

/** One `import … from '<spec>'` statement; `import type` is skipped. */
const IMPORT_RE = /\bimport\s+(?!type\b)((?:(?!\bfrom\b)[^;])*?)\bfrom\s+['"]([^'"]+)['"]/g;

export function valueImports(code: string): ValueImport[] {
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
    betterSqlite3:
      importsValue(imports, /^better-sqlite3$/) || /require[(]\s*['"]better-sqlite3['"]\s*[)]/.test(maskedCode),
    driverPackage: importsValue(imports, /^@objectstack\/driver-/),
    objectQLCtor: /new\s+ObjectQL\s*[(]/.test(maskedCode),
  };
}

export function isIntegration(s: TierSignals): boolean {
  const spawn = s.runServe || (s.childProcess && (s.entryBasename || s.helperCliOrTsx || s.tsxBin));
  const kernel = s.bootSchemaStack || s.betterSqlite3 || s.driverPackage || s.objectQLCtor;
  return spawn || kernel;
}

export function firedSignals(s: TierSignals): string {
  return (Object.keys(s) as Array<keyof TierSignals>).filter((k) => s[k]).join(', ') || 'none';
}

/** The tier of one test file, read from its source on disk. */
export function tierOfFile(pkgRoot: string, relPath: string): TierSignals {
  return tierSignals(maskComments(readFileSync(join(pkgRoot, relPath), 'utf8')));
}

// ---------------------------------------------------------------------------
// The population, walked from disk
// ---------------------------------------------------------------------------

const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage']);

/** `pkgRoot`-relative, POSIX-separated paths of every test file on disk, sorted. */
export function testFilesOnDisk(pkgRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (TEST_FILE_RE.test(entry.name)) out.push(relative(pkgRoot, abs).split(sep).join('/'));
    }
  };
  walk(pkgRoot);
  return out.sort();
}

/**
 * The integration tier: every test file on disk the predicate calls integration.
 *
 * This is what `vitest.config.ts` feeds to the `integration` project's
 * `include` and the `unit` project's `exclude`, so the two projects stay a
 * partition of the population by CONSTRUCTION rather than by maintenance.
 */
export function integrationTestFiles(pkgRoot: string): string[] {
  return testFilesOnDisk(pkgRoot).filter((file) => isIntegration(tierOfFile(pkgRoot, file)));
}
