// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13440 — every in-repo call of `isMissingTableError` must name the object it
 * was reading. This file is the mechanism that makes that true; the JSDoc on
 * the function is only the explanation.
 *
 * ── The defect class ─────────────────────────────────────────────────────────
 *
 * #13324 repaired the predicate by giving it `readObject`, so a driver fault
 * naming a DIFFERENT relation can no longer be answered "this table is not
 * provisioned yet". The parameter had to ship OPTIONAL: `@objectstack/types` is
 * published (17.2.0, `exports` `.` and `./node`), and re-exported again from
 * `@objectstack/metadata/errors`, so a required parameter is a breaking change
 * to a published API — a major bump, which is a maintainer's call and not a
 * side effect of a bug fix.
 *
 * Optional is right for the world outside this repo and wrong for the inside of
 * it. `isMissingTableError(err)` still compiles, still type-checks, and still
 * returns the pre-#13324 WIDE verdict — silently. On the authz path
 * (`packages/core/src/security/resolve-authz-context.ts`) that verdict resolves
 * a permission-store OUTAGE to `[]` permissions instead of failing loud, so the
 * omission fails in the OPEN direction. That is the same declared-but-not-
 * enforced shape #13324 existed to close, one level up: the obligation is
 * stated in prose, and prose is exactly what #13324 proved insufficient.
 *
 * ── Why a gate and not a required parameter ──────────────────────────────────
 *
 * A gate binds only callers inside this repository, so it buys the enforcement
 * without the major bump: external consumers keep the optional form the
 * published API promises them. Making the parameter required remains available
 * as a follow-up and stays a human decision.
 *
 * ── The exemption axis, and why it is exactly this narrow ────────────────────
 *
 * `driver-error-classification.test.ts` calls the one-argument form ~30 times
 * ON PURPOSE: those are the tests OF the optional form, pinning that
 * `isMissingTableError(err)` still behaves for the external consumers the
 * optional parameter protects. A gate written to the naive rule would fail
 * every one of them, and the obvious "fix" — passing a read object — would
 * delete the coverage of the published one-argument contract.
 *
 * So the exemption is the DEFINING PACKAGE'S OWN CONTRACT TESTS and nothing
 * else: `packages/types/src/driver-error-classification*.test.ts`. Everything
 * else under `packages/` — production and test code alike — must pass the read
 * object. The defining module itself is deliberately NOT exempt: the predicate
 * delegates to `matchesDriverError` and never calls itself, so a
 * self-referential one-argument call there would be a new fact worth failing on.
 *
 * ── Why the checks below are not just "green on the current tree" ────────────
 *
 * A scanner that silently stops matching yields the same empty violation set as
 * a clean repo, and the assertion cannot tell them apart. Two positive controls
 * separate them, and they fail in different directions:
 *
 *   SEES THE EXEMPT FILE  — with the exemption disabled, the defining test file
 *                           must yield a substantial one-argument population
 *                           (30 on the commit this landed). Zero there means the
 *                           call matcher is broken, not that the repo is clean.
 *   REACHES OTHER PACKAGES — the two-argument production population outside
 *                           `packages/types` must be substantial (18 on the same
 *                           commit). Zero there means the directory walk never
 *                           left the defining package, which is the failure that
 *                           would make the whole gate vacuous.
 *
 * A third check guards the matcher's one structural blind spot. Callees are
 * matched BY NAME, so a renamed import binding
 * (`import { isMissingTableError as x }`) would be invisible. None exists today;
 * if one appears, this fails and asks for the matcher to be taught about it,
 * rather than letting the population quietly shrink.
 *
 * ── Boundary, stated rather than discovered later ────────────────────────────
 *
 * The scanned surface is `packages/` — the surface the ruling on #13440 names.
 * Measured when this landed, `apps/`, `examples/`, `e2e/` and `scripts/` call
 * the predicate zero times in total, so the narrower surface loses nothing
 * today; widening it is the `SCANNED_TREE` constant below plus a wider glob in
 * `CROSS_PACKAGE_TEST_INPUTS` (and, for a NEW top-level root, a matching entry
 * in ci.yml's `crosspkg:` filter — `check-ci-filter-parity.mjs` is the gate
 * that says so).
 *
 * ⚠️ The EXTENSION boundary is `.ts` alone, and unlike the tree above that one
 * is not free — it is a deliberate trade with a second gate. Measured on the
 * commit this landed, under `packages/`:
 *
 *     .ts    5181 tracked, 48 mention the predicate   <- the scanned set
 *     .tsx      8 tracked,  0 mention the predicate   <- excluded
 *     .mts     17 tracked,  0 mention the predicate   <- excluded
 *     .cts      0 tracked,  0 mention the predicate   <- excluded
 *
 * So nothing is lost today. What forbids simply widening it is that this
 * package's declared radius is INHERITED as watch hints by
 * `check:cross-package-test-inputs`, and the dispatch-gates self-test pins that
 * no hint of that family reaches the `realtime-hooks.test.tsx` file in
 * `packages/client-react` — the live specimen for "a test class the hint route
 * cannot reach". A glob here that covers `.tsx` makes that case fail. It is a
 * real red and not a nuisance: the specimen is how that tool proves its residue
 * classes are not empty.
 *
 * (That file is named in two halves rather than as one quoted path on purpose.
 * This gate's own registrar collects quoted whole paths out of COMMENTS, so
 * spelling it here would put it on this package's roster and demand the very
 * `.tsx` glob the paragraph exists to forbid — measured, it fails exactly that
 * way.)
 *
 * ⇒ If a `.tsx` (or `.mts`) caller of this predicate ever appears, widening
 * `SOURCE_FILE` below is only HALF the change: the declared glob must widen
 * with it, and re-pointing that self-test specimen is a `scripts/pm/` edit
 * owned by another lane. Do not widen the scanner alone — that reads as
 * coverage while turbo never re-runs this test for the files it now claims to
 * judge, which is the #7802 shape the declaration table exists to prevent. The
 * two pins below keep this paragraph honest rather than decorative.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/**
 * This package is CJS-typed (no `"type": "module"`), so `module: NodeNext`
 * forbids `import.meta` here — the same constraint `node-isolation.test.ts`
 * records. Walk up from the CWD to this package's own manifest instead, which
 * works wherever vitest is invoked from.
 */
function findUp(marker: (dir: string) => boolean, what: string): string {
  let dir = process.cwd();
  for (;;) {
    if (marker(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not locate ${what} walking up from ${process.cwd()}`);
    dir = parent;
  }
}

const PACKAGE_ROOT = findUp((dir) => {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
  return name === '@objectstack/types';
}, 'the @objectstack/types package root');

/**
 * The repo root reached by ARITHMETIC from this package rather than by a second
 * marker-file walk, and that is deliberate. A walk keyed on a workspace-root
 * marker would NAME that root file, which
 * `check-cross-package-test-inputs.mjs` then requires this package to declare —
 * and a declared root-level path is a top-level root that
 * `check-ci-filter-parity.mjs` in turn requires in ci.yml's `crosspkg:` filter.
 * (Both gates named bare rather than by path on purpose: the first one's
 * literal collector takes quoted whole paths out of COMMENTS too, so spelling
 * one here would force this package to declare a radius it never reads.)
 * Anchoring off the manifest keeps this gate's whole declared radius inside
 * `packages/**`, which ci.yml's `core:` filter already covers, so the gate costs
 * one table entry and one turbo task and no scheduler surgery.
 *
 * The arithmetic is not trusted on faith: the anchor test below requires the
 * walk to find this package's OWN defining module, which no wrong root can
 * satisfy.
 */
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/** The tree this gate binds. See the boundary note in the header. */
const SCANNED_TREE = join(REPO_ROOT, 'packages');

/** Build output and vendored code are not in-repo call sites. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next']);

/**
 * The scanned extension set, spelled ONCE so the pins below can assert it and
 * so it stays in exact correspondence with this package's declared glob in
 * `CROSS_PACKAGE_TEST_INPUTS` (`packages/**\/*.ts`). Read the extension
 * boundary in the header before changing either — they widen together or not
 * at all.
 */
const SOURCE_FILE = (name: string): boolean => name.endsWith('.ts') && !name.endsWith('.d.ts');

/**
 * The defining package's own contract tests — the tests OF the optional form.
 * The glob is deliberately anchored to the whole repo-relative path: a
 * same-named file in another package is not a contract test of this predicate.
 */
const EXEMPT = /^packages\/types\/src\/driver-error-classification[^/]*\.test\.ts$/;

const PREDICATE = 'isMissingTableError';

interface CallSite {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly argumentCount: number;
  /** A second argument written as `undefined` / `null` / `void 0`. */
  readonly readObjectDiscarded: boolean;
}

interface RenamedImport {
  readonly path: string;
  readonly line: number;
  readonly local: string;
}

function sourceFilesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_FILE(entry.name)) continue;
      out.push(join(dir, entry.name));
    }
  };
  walk(root);
  return out;
}

/** `undefined`, `null` and `void 0` all mean "cannot say" to the predicate. */
function discardsReadObject(argument: ts.Expression): boolean {
  if (ts.isIdentifier(argument) && argument.text === 'undefined') return true;
  if (argument.kind === ts.SyntaxKind.NullKeyword) return true;
  return ts.isVoidExpression(argument);
}

function analyse(files: readonly string[]): { calls: CallSite[]; renamedImports: RenamedImport[] } {
  const calls: CallSite[] = [];
  const renamedImports: RenamedImport[] = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes(PREDICATE)) continue;
    const path = relative(REPO_ROOT, file).split(sep).join('/');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : undefined;
        if (name === PREDICATE) {
          const start = node.getStart(sourceFile);
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
          const second = node.arguments[1];
          calls.push({
            path,
            line: line + 1,
            column: character + 1,
            text: node.getText(sourceFile).replace(/\s+/g, ' '),
            argumentCount: node.arguments.length,
            readObjectDiscarded: second !== undefined && discardsReadObject(second),
          });
        }
      }
      // A renamed binding would make the by-name match above blind.
      if (ts.isImportSpecifier(node) && node.propertyName?.text === PREDICATE) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        renamedImports.push({ path, line: line + 1, local: node.name.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { calls, renamedImports };
}

const FILES = sourceFilesUnder(SCANNED_TREE);
const { calls: ALL_CALLS, renamedImports: RENAMED_IMPORTS } = analyse(FILES);

const offends = (call: CallSite): boolean => call.argumentCount < 2 || call.readObjectDiscarded;

const REMEDY =
  'Pass the object you were reading as the second argument — ' +
  "`isMissingTableError(err, object)`. Without it the predicate returns the pre-#13324 WIDE verdict: " +
  'a fault naming some OTHER relation is answered "this table is not provisioned yet", ' +
  'which on a read path means an outage is silently reported as "no rows".';

function render(sites: readonly CallSite[]): string {
  return sites
    .map((c) => `  ${c.path}:${c.line}:${c.column}  ${c.text}`)
    .join('\n');
}

describe('isMissingTableError — every in-repo call names the object it read (#13440)', () => {
  it('the scan is anchored to the real workspace root', () => {
    expect(existsSync(SCANNED_TREE)).toBe(true);
    expect(relative(REPO_ROOT, PACKAGE_ROOT).split(sep).join('/')).toBe('packages/types');
    // Self-referential: a mis-anchored walk cannot reach the module under test.
    const scanned = new Set(FILES.map((f) => relative(REPO_ROOT, f).split(sep).join('/')));
    expect(scanned.has('packages/types/src/driver-error-classification.ts')).toBe(true);
  });

  // ── POSITIVE CONTROL ──────────────────────────────────────────────────────
  // An empty violation set is the passing state, and a broken scanner produces
  // the identical empty set. These two say the scanner is looking.

  it('POSITIVE CONTROL: sees the exempt contract tests (~30 one-argument calls)', () => {
    const inExemptFiles = ALL_CALLS.filter((c) => EXEMPT.test(c.path) && c.argumentCount < 2);
    expect(
      inExemptFiles.length,
      'the defining contract tests exercise the one-argument published form ~30 times ' +
        '(30 when this landed); finding none means the call matcher stopped matching, ' +
        'not that the repo is clean',
    ).toBeGreaterThanOrEqual(20);
  });

  it('POSITIVE CONTROL: the walk reaches packages other than the defining one', () => {
    const elsewhere = ALL_CALLS.filter(
      (c) => !c.path.startsWith('packages/types/') && c.argumentCount >= 2,
    );
    const packages = new Set(elsewhere.map((c) => c.path.split('/').slice(0, 2).join('/')));
    expect(
      elsewhere.length,
      'production call sites outside packages/types pass the read object (18 when this ' +
        'landed); finding none means the directory walk never left the defining package, ' +
        'which would make this gate vacuous',
    ).toBeGreaterThanOrEqual(15);
    expect(packages.size).toBeGreaterThanOrEqual(3);
  });

  // ── THE EXTENSION BOUNDARY ────────────────────────────────────────────────
  // The header explains why this gate reads `.ts` and nothing else. These two
  // keep that paragraph from becoming decoration.

  it('the scanned extension set is exactly `.ts`, matching the declared glob', () => {
    // Pure predicate assertions — no I/O, so this adds nothing to the radius
    // this package must declare. Widening any line here without widening
    // `packages/**\/*.ts` in CROSS_PACKAGE_TEST_INPUTS is the #7802 shape:
    // the scan would judge files turbo never re-runs it for.
    expect(SOURCE_FILE('engine.ts')).toBe(true);
    expect(SOURCE_FILE('engine.d.ts')).toBe(false);
    expect(SOURCE_FILE('realtime-hooks.test.tsx')).toBe(false);
    expect(SOURCE_FILE('thing.mts')).toBe(false);
    expect(SOURCE_FILE('thing.cts')).toBe(false);
    expect(FILES.every((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))).toBe(true);
  });

  it('POSITIVE CONTROL: `.tsx` files really do exist under packages/, so excluding them is a decision', () => {
    // Filename-only: this counts directory ENTRIES and never opens a `.tsx`
    // file, so the exclusion cannot smuggle in a content dependence on files
    // outside the declared glob. A floor, not a pin — adding `.tsx` files can
    // never redden it, and finding zero would mean the header's measurement
    // (8 when this landed) had quietly become a statement about nothing.
    const countTsx = (dir: string): number => {
      let n = 0;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) n += countTsx(join(dir, entry.name));
        } else if (entry.isFile() && entry.name.endsWith('.tsx')) n += 1;
      }
      return n;
    };
    expect(countTsx(SCANNED_TREE)).toBeGreaterThanOrEqual(1);
  });

  it('no renamed import hides a call from the by-name matcher', () => {
    expect(
      RENAMED_IMPORTS,
      `${PREDICATE} is matched by callee NAME, so a renamed binding would be invisible to ` +
        'this gate. One now exists — teach the matcher the local name before this can pass:\n' +
        RENAMED_IMPORTS.map((r) => `  ${r.path}:${r.line}  as ${r.local}`).join('\n'),
    ).toEqual([]);
  });

  // ── THE GATE ──────────────────────────────────────────────────────────────

  it('no in-repo call omits or discards the read object', () => {
    const violations = ALL_CALLS.filter((c) => !EXEMPT.test(c.path) && offends(c));
    expect(
      violations,
      `${violations.length} call site(s) of ${PREDICATE}() do not name the object being read:\n` +
        `${render(violations)}\n\n${REMEDY}\n\n` +
        'The only exemption is the defining package\'s own contract tests ' +
        '(packages/types/src/driver-error-classification*.test.ts), which pin the published ' +
        'one-argument form on purpose. If your call genuinely has no read object by ' +
        'construction, that is a decision for the card, not a widening of this gate.',
    ).toEqual([]);
  });
});
