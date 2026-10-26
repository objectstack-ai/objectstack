/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ONE discovery of the `createSafeTranslation` defaults tables, shared by every
 * gate that judges their rows — objectui#7884.
 *
 * ## Why this is a shared module and not a second walk
 *
 * Two gates ask different questions of the SAME population:
 *
 *   - `packages/i18n/src/__tests__/fallback-placeholder-spelling-3512.test.ts`
 *     (objectui#3512) — is every placeholder spelled the one way the
 *     provider-less `fallbackT` can resolve?
 *   - `packages/app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx`
 *     (objectui#4401, widened by objectui#7884) — does every row name a key the
 *     `en` pack actually defines?
 *
 * The second one used to read a HAND-WRITTEN list of three imported maps, so it
 * judged 400 of 1056 rows (37.9%) and could not see the five dead
 * `timeline.relative.*` rows at all (retired in #7887). The fix is not a second
 * traversal — two traversals are two definitions of the population that drift
 * apart, which is the disease objectui#7448 / #7528 / #7548 / #7825 and the card
 * behind `fa7d66c45` all record. So the walk objectui#3512 already had moved HERE,
 * unchanged, and both gates now discover the same tables from the same code.
 *
 * ## Why an import-based list can never be completed by hand
 *
 * Not a matter of diligence: of the 32 factory call sites on this tree, **11 are
 * anonymous inline object literals** passed straight to `createSafeTranslation(…)`
 * and exported under no name at all. A gate that reaches its tables by
 * `import { X_DEFAULT_TRANSLATIONS }` is structurally incapable of naming them.
 * Discovery resolves the factory's FIRST ARGUMENT instead, so an inline table is
 * gated the day it is written.
 *
 * ## Why it lives in `@object-ui/test-support`
 *
 * The two callers are in different packages (`@object-ui/i18n` and
 * `@object-ui/app-shell`), and app-shell already depends on i18n — so parking
 * the walk in either one would either invert a dependency or force a deep
 * subpath import into another package's `src/__tests__/`, the shape
 * objectui#4325 ruled out. This package is `private: true`, never published, and
 * exists precisely for modules two suites share.
 *
 * ⚠️ It is reached as a DECLARED subpath — `@object-ui/test-support/defaults-table-scan`
 * — and NOT from the package index, even though that index is otherwise the
 * package's whole surface. A barrel re-export puts this module into the program
 * of every consumer that imports the index for anything at all, and this module
 * only type-checks where Node's ambient types are present. Measured: with it on
 * the index, `data-objectstack` (which imports `{ enumOptions }` from the index
 * in one test) compiled this file and failed the repo-wide type-check with three
 * TS2591s. The index docstring carries the full reasoning.
 *
 * ## `typescript` is loaded lazily, on purpose
 *
 * `require('typescript')` measures 260-375ms on this container, and a barrel that
 * pulled this module in would make ~40 test files wanting a DOM leak judge or a
 * spec reader pay for a compiler they never use. The subpath already keeps them
 * out; this keeps the cost off the two gates' own import phase as well. AGENTS.md
 * §测试纪律 names exactly that shape — an unbounded module load inside a bounded
 * window — as the top cause of flaky tests here (one first `import()` measured
 * at 976ms against RTL's 1000ms default budget). So the compiler is pulled in on
 * the first `scanDefaultsTables()` call and never at import time. The scan
 * itself is memoised per repo root, so the ~1600-file walk happens once per
 * process no matter how many gates ask for it.
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type * as TS from 'typescript';
import handRolledTables from './hand-rolled-tables.json';

const requireFrom = createRequire(import.meta.url);
let compiler: typeof TS | null = null;

/** The TypeScript compiler, loaded on first use. See the docstring above. */
function ts(): typeof TS {
  if (compiler === null) compiler = requireFrom('typescript') as typeof TS;
  return compiler;
}

/** The factory, and plugin-detail's re-export alias for it. */
export const FACTORY_NAMES = new Set(['createSafeTranslation', 'createSafeTranslationHook']);

/**
 * The literal needle a hand-rolled `fallbackT` splits on, as it is spelled in
 * source. objectui#3512's completeness case pins which files carry it, so a
 * fourth hand-rolled copy of the interpolator forces an edit there instead of
 * quietly serving an ungated table.
 *
 * ⚠️ ASSEMBLED FROM FRAGMENTS ON PURPOSE, and it must stay that way. This walk
 * skips `__tests__` directories, which is why objectui#3512 could hold the
 * needle as one literal while living in one. This module does NOT live in a
 * skipped directory, so a verbatim spelling here makes the scanner match its
 * own source and report itself as a fifth interpolator — measured exactly that
 * way during the objectui#7884 move: `packages/test-support/src/defaults-table
 * -scan.ts` appeared as a 5th needle file and turned that completeness case
 * red. The runtime value is unchanged; only the spelling is.
 */
export const NEEDLE_IN_SOURCE = ['.split(', '`{{', '${'].join('');

/** One declared hand-rolled table: where it lives, and the `const` that holds it. */
export interface HandRolledTable {
  readonly file: string;
  readonly name: string;
}

/**
 * The tables whose packages re-implemented `fallbackT`'s literal needle rather
 * than taking the factory. Each file states its own reason for that; none of
 * them changes the grammar the needle accepts, so the rule is the same.
 * `TIMELINE_DEFAULT_TRANSLATIONS` also reaches the factory — listed anyway, so
 * the registry mirrors the needle-file set objectui#3512's completeness case
 * pins. That deliberate double-listing is why a caller must de-duplicate on
 * `where` + `key` before reporting counts: its 21 rows are discovered twice.
 *
 * ## Why the DATA lives in `hand-rolled-tables.json` (`7dcda9cd4`)
 *
 * A second reader arrived that is not TypeScript:
 * `scripts/check-i18n-call-site-keys.mjs` widened its `createSafeTranslation`
 * value-compare over these tables (objectui#7567 Q2's B half). That gate is a
 * bare `node scripts/check-*.mjs`, so it cannot import this module at all —
 * `exports["./defaults-table-scan"]` resolves to TypeScript SOURCE with no build
 * artefact. The shape here is the one the 2026-08-31 ruling (`d3bf4fa6f`) already set for exactly
 * that wall, and `zod-wrapper-keys.json` is its first instance: the DATA moves
 * to build-free JSON with its own `exports` subpath
 * (`@object-ui/test-support/hand-rolled-tables`), `resolveJsonModule` types it
 * for every TypeScript consumer, `node` reads the same bytes through the
 * subpath, and this module keeps the prose JSON cannot carry.
 *
 * ⚠️ ONE declaration, not two pinned copies. The alternative — a second literal
 * list inside the gate, pinned to this one by a test (the objectui#7310 /
 * PR #8028 shape) — was available and is deliberately not what this is: two
 * lists CAN disagree between the moment one is edited and the moment the pin
 * runs, and the whole point of a registry that gates a scan population is that
 * "0 drifted" must never be readable off a list that quietly lost an entry.
 *
 * ## The staleness ratchet lives in objectui#3512's completeness case
 *
 * A declared list rots when a table is added and not declared. What makes this
 * one complete is not diligence, it is
 * `packages/i18n/src/__tests__/fallback-placeholder-spelling-3512.test.ts`'s
 * "covers the three hand-rolled interpolators, and no fourth exists": it asserts
 * `scan.needle` — every runtime file carrying `NEEDLE_IN_SOURCE` — equals a
 * pinned file list, and that every entry here contributes rows. A fourth
 * hand-rolled `fallbackT` turns that case red naming its own file, instead of
 * quietly serving an ungated table. Because the gate now reads THIS list rather
 * than a copy, that one ratchet covers both readers.
 */
export const HAND_ROLLED_TABLES: readonly HandRolledTable[] = handRolledTables;

/** One row of one discovered table, located precisely enough to fix. */
export interface DefaultsRow {
  /** Human label of the owning table, including where it was discovered. */
  readonly table: string;
  /** `path/to/file.ts:LINE` of the row itself. */
  readonly where: string;
  readonly key: string;
  readonly value: string;
}

export interface DefaultsTableScan {
  readonly rows: readonly DefaultsRow[];
  /**
   * Rows whose value is not a static string, and tables that never resolved.
   * NOT an exemption list: a table the scanner cannot read is a table the gate
   * does not cover, and every caller is expected to assert this is empty so the
   * instrument's blind-spot size can never be swallowed.
   */
  readonly unreadable: readonly string[];
  /** One label per discovered table, in discovery order. */
  readonly tables: readonly string[];
  /** Files carrying the literal needle, repo-relative and sorted. */
  readonly needle: readonly string[];
  /** Every runtime source file walked — the non-vacuity floor for the walk. */
  readonly sourceFiles: readonly string[];
}

/** Every runtime `.ts`/`.tsx` under the workspace — tests and tooling excluded. */
function collectSourceFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (
        name === 'node_modules' ||
        name === 'dist' ||
        name === '__tests__' ||
        name === '__mocks__' ||
        name.startsWith('.')
      ) {
        continue;
      }
      const full = path.join(dir, name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec|bench|stories)\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  for (const root of ['packages', 'apps', 'examples']) {
    const full = path.join(repoRoot, root);
    if (existsSync(full) && statSync(full).isDirectory()) walk(full);
  }
  return out.sort();
}

/** Peel the wrappers a table declaration may carry before its object literal. */
function unwrap(node: TS.Expression): TS.Expression {
  const t = ts();
  let e = node;
  for (;;) {
    if (t.isAsExpression(e) || t.isSatisfiesExpression(e) || t.isParenthesizedExpression(e)) {
      e = e.expression;
      continue;
    }
    return e;
  }
}

/**
 * A string a table row is declared with. Handles the `'a' + 'b'` concatenation
 * one row uses (`plugin-form/src/occSave.tsx`); anything else returns
 * `undefined` and is REPORTED rather than skipped — a row the gate cannot read
 * is a hole in it, not an exemption.
 */
function staticString(node: TS.Expression): string | undefined {
  const t = ts();
  const e = unwrap(node);
  if (t.isStringLiteral(e) || t.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (t.isBinaryExpression(e) && e.operatorToken.kind === t.SyntaxKind.PlusToken) {
    const left = staticString(e.left);
    const right = staticString(e.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

interface MutableScan {
  rows: DefaultsRow[];
  unreadable: string[];
}

/**
 * One walk of one repo root. Everything the scan needs is closed over here, so
 * the parse cache and the source-file list cannot leak between roots.
 */
function scan(repoRoot: string): DefaultsTableScan {
  const t = ts();
  const sourceFiles = collectSourceFiles(repoRoot);
  const rel = (abs: string) => path.relative(repoRoot, abs);

  const parsed = new Map<string, TS.SourceFile | null>();
  const sourceFileFor = (abs: string): TS.SourceFile | null => {
    if (parsed.has(abs)) return parsed.get(abs) ?? null;
    const sf = existsSync(abs)
      ? t.createSourceFile(
          abs,
          readFileSync(abs, 'utf8'),
          t.ScriptTarget.Latest,
          true,
          abs.endsWith('.tsx') ? t.ScriptKind.TSX : t.ScriptKind.TS,
        )
      : null;
    parsed.set(abs, sf);
    return sf;
  };

  /** The initializer of a top-level `const <name> = …` in this file. */
  const constInitializer = (sf: TS.SourceFile, name: string): TS.Expression | null => {
    let found: TS.Expression | null = null;
    const visit = (node: TS.Node) => {
      if (found) return;
      if (
        t.isVariableDeclaration(node) &&
        t.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer
      ) {
        found = node.initializer;
        return;
      }
      t.forEachChild(node, visit);
    };
    t.forEachChild(sf, visit);
    return found;
  };

  /** Follow `import { <name> } from './relative'` to the file that declares it. */
  const importedFrom = (sf: TS.SourceFile, name: string): string | null => {
    let spec: string | null = null;
    t.forEachChild(sf, (node) => {
      if (spec !== null) return;
      if (
        t.isImportDeclaration(node) &&
        node.importClause?.namedBindings &&
        t.isNamedImports(node.importClause.namedBindings) &&
        t.isStringLiteral(node.moduleSpecifier)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          if (element.name.text === name) spec = node.moduleSpecifier.text;
        }
      }
    });
    if (spec === null || !(spec as string).startsWith('.')) return null;
    const base = path.resolve(path.dirname(sf.fileName), spec);
    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };

  const scanObjectLiteral = (
    literal: TS.ObjectLiteralExpression,
    table: string,
    into: MutableScan,
    keyPrefix = '',
  ): void => {
    const owner = literal.getSourceFile();
    const at = (node: TS.Node) =>
      `${rel(owner.fileName)}:${owner.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    for (const property of literal.properties) {
      if (t.isPropertyAssignment(property)) {
        const name =
          t.isIdentifier(property.name) || t.isStringLiteral(property.name)
            ? property.name.text
            : null;
        if (name === null) {
          into.unreadable.push(`${at(property)} — computed key in ${table}`);
          continue;
        }
        const key = keyPrefix ? `${keyPrefix}.${name}` : name;
        const initializer = unwrap(property.initializer);
        if (t.isObjectLiteralExpression(initializer)) {
          scanObjectLiteral(initializer, table, into, key);
          continue;
        }
        const value = staticString(initializer);
        if (value === undefined) {
          into.unreadable.push(`${at(property)} — ${table}.${key} is not a static string`);
          continue;
        }
        into.rows.push({ table, where: at(property), key, value });
      } else {
        into.unreadable.push(`${at(property)} — non-assignment member in ${table}`);
      }
    }
  };

  /**
   * Resolve a `createSafeTranslation` first argument to its object literal: an
   * inline table, a `const` in the same file, or a `const` imported from a
   * relative module.
   */
  const resolveTableArgument = (
    sf: TS.SourceFile,
    argument: TS.Expression,
  ): { literal: TS.ObjectLiteralExpression | null; name: string } => {
    const unwrapped = unwrap(argument);
    if (t.isObjectLiteralExpression(unwrapped)) {
      return { literal: unwrapped, name: '(inline table)' };
    }
    if (t.isIdentifier(unwrapped)) {
      const name = unwrapped.text;
      let initializer = constInitializer(sf, name);
      if (initializer === null) {
        const from = importedFrom(sf, name);
        const imported = from === null ? null : sourceFileFor(from);
        if (imported) initializer = constInitializer(imported, name);
      }
      if (initializer !== null) {
        const literal = unwrap(initializer);
        if (t.isObjectLiteralExpression(literal)) return { literal, name };
      }
      return { literal: null, name };
    }
    return { literal: null, name: t.SyntaxKind[unwrapped.kind] };
  };

  const out: MutableScan = { rows: [], unreadable: [] };
  const tables: string[] = [];
  const needle: string[] = [];

  for (const abs of sourceFiles) {
    const text = readFileSync(abs, 'utf8');
    if (text.includes(NEEDLE_IN_SOURCE)) needle.push(rel(abs));
    if (!text.includes('createSafeTranslation')) continue;
    const sf = sourceFileFor(abs);
    if (!sf) continue;
    const visit = (node: TS.Node) => {
      if (t.isCallExpression(node)) {
        const callee = node.expression;
        const name = t.isIdentifier(callee)
          ? callee.text
          : t.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null;
        if (name !== null && FACTORY_NAMES.has(name) && node.arguments.length > 0) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const { literal, name: tableName } = resolveTableArgument(sf, node.arguments[0]);
          const label = `${tableName} (${rel(abs)}:${line})`;
          if (literal === null) {
            // Not an exemption: a table the gate cannot reach is a table the
            // gate does not cover, and that has to be visible.
            out.unreadable.push(`${rel(abs)}:${line} — cannot resolve ${tableName} to a table`);
          } else {
            tables.push(label);
            scanObjectLiteral(literal, label, out);
          }
        }
      }
      t.forEachChild(node, visit);
    };
    t.forEachChild(sf, visit);
  }

  for (const { file, name } of HAND_ROLLED_TABLES) {
    const abs = path.join(repoRoot, file);
    const sf = sourceFileFor(abs);
    const initializer = sf === null ? null : constInitializer(sf, name);
    const literal = initializer === null ? null : unwrap(initializer);
    if (literal === null || !t.isObjectLiteralExpression(literal)) {
      out.unreadable.push(`${file} — hand-rolled table ${name} no longer resolves`);
      continue;
    }
    const label = `${name} (${file})`;
    tables.push(label);
    scanObjectLiteral(literal, label, out);
  }

  return { ...out, tables, needle: needle.sort(), sourceFiles };
}

const cache = new Map<string, DefaultsTableScan>();

/**
 * Discover every `createSafeTranslation` defaults table under `repoRoot`, plus
 * the three hand-rolled siblings, and read their rows from source.
 *
 * Memoised per root: the walk parses ~1600 files, and both gates in one process
 * should pay for it once.
 */
export function scanDefaultsTables(repoRoot: string): DefaultsTableScan {
  const cached = cache.get(repoRoot);
  if (cached) return cached;
  const fresh = scan(repoRoot);
  cache.set(repoRoot, fresh);
  return fresh;
}
