/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/core` ↔ `@objectstack/spec` drift guard
 * (objectui#3158, objectstack#4115 — ledger batch 4).
 *
 * Thirteen symbols in core wore names `@objectstack/spec` owns. They resolved
 * two ways, and the tests below differ accordingly:
 *
 *  - **Derived** (`StyleMap`, `ResponsiveStyles`, `RowHeight`, `CONTEXT_TOKENS`,
 *    `CrudAffordances`, `RowCrudPredicates`): the name is now bound to the spec
 *    at compile time, so the remaining risk is not drift but REGRESSION — a
 *    future edit quietly restoring a local declaration under the same name. The
 *    checks here therefore assert IDENTITY with the spec (reference identity for
 *    the const, mutual assignability for the types), which a hand copy fails and
 *    a re-export cannot.
 *
 *  - **Renamed** (`ChartSeriesBinding`, `ActionRunnerHandler`,
 *    `RegistryPluginDefinition`, `SchemaNodeValidationError`,
 *    `SchemaNodeValidationResult`, `defineSystemView`,
 *    `resolveEffectiveCrudAffordances`): the concepts genuinely differ from the
 *    spec exports whose names they were wearing. The risk is picking a new name
 *    the spec ALREADY owns — the `PageComponentSchema` mistake from
 *    objectui#3074 — so each new name is asserted absent from the spec's export
 *    set, types and values alike.
 *
 * Why `CONTEXT_TOKENS` needs a REFERENCE check and not a value check: the copy
 * this burn-down deleted was byte-identical to the spec's tuple. It passed every
 * value comparison and every behavioural test in this repo for as long as it
 * existed. `toBe` is the only assertion that can tell a re-export from a fork
 * (objectui#3003).
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

import {
  CONTEXT_TOKENS as SpecCONTEXT_TOKENS,
  resolveCrudAffordances as specResolveCrudAffordances,
} from '@objectstack/spec/data';
import type {
  CrudAffordances as SpecCrudAffordances,
  RowCrudPredicates as SpecRowCrudPredicates,
} from '@objectstack/spec/data';
import type {
  StyleMap as SpecStyleMap,
  ResponsiveStyles as SpecResponsiveStyles,
  RowHeight as SpecRowHeight,
} from '@objectstack/spec/ui';

import { CONTEXT_TOKENS } from '../filter-tokens.js';
import type { StyleMap, ResponsiveStyles } from '../../styling/scoped-styles.js';
import type { RowHeight } from '../normalize-list-view.js';
import { DENSITY_MODE_TO_ROW_HEIGHT, ROW_HEIGHT_TO_DENSITY_MODE } from '../normalize-list-view.js';
import { resolveEffectiveCrudAffordances } from '../managedBy.js';
import type { CrudAffordances, RowCrudPredicates } from '../managedBy.js';

// ─────────────────────────────────────────────────────────────────────────────
// Derived — the names are the spec's, bound at compile time
// ─────────────────────────────────────────────────────────────────────────────

describe('CONTEXT_TOKENS is the spec\'s tuple, not a copy of it', () => {
  it('is the SAME OBJECT the spec exports', () => {
    // Reference identity, deliberately. The deleted copy was
    // `['current_user_id', 'current_org_id'] as const` — identical contents, so
    // `toEqual` passed on the fork too and would keep passing if someone
    // re-forked it tomorrow. Only `toBe` fails on a copy.
    expect(CONTEXT_TOKENS).toBe(SpecCONTEXT_TOKENS);
  });

  it('still carries the vocabulary the resolver depends on', () => {
    // A cheap sanity net: if the spec ever RETIRES a token, this fails here
    // rather than as a silently-unresolved placeholder in a dashboard widget
    // (the framework#3574 failure mode this module exists to prevent).
    expect([...CONTEXT_TOKENS]).toEqual(['current_user_id', 'current_org_id']);
  });
});

describe('the styling vocabulary is spec-owned (ADR-0065)', () => {
  it('StyleMap is mutually assignable with the spec\'s', () => {
    expectTypeOf<StyleMap>().toEqualTypeOf<SpecStyleMap>();
  });

  it('ResponsiveStyles is mutually assignable with the spec\'s', () => {
    expectTypeOf<ResponsiveStyles>().toEqualTypeOf<SpecResponsiveStyles>();
  });
});

describe('RowHeight is spec-owned', () => {
  it('is mutually assignable with the spec\'s RowHeightSchema vocabulary', () => {
    expectTypeOf<RowHeight>().toEqualTypeOf<SpecRowHeight>();
  });

  it('maps every spec row height onto a density mode', () => {
    // These maps are `Record<RowHeight, …>`, so a spec-side ADDITION is a
    // compile error rather than a row height with no mapping. This assertion
    // pins the current vocabulary so the compile error has a readable twin.
    expect(Object.keys(ROW_HEIGHT_TO_DENSITY_MODE).sort()).toEqual(
      ['compact', 'extra_tall', 'medium', 'short', 'tall'],
    );
  });

  it('round-trips density → row height → density', () => {
    for (const [density, rowHeight] of Object.entries(DENSITY_MODE_TO_ROW_HEIGHT)) {
      expect(ROW_HEIGHT_TO_DENSITY_MODE[rowHeight]).toBe(density);
    }
  });
});

describe('the CRUD affordance matrix is spec-owned (ADR-0103)', () => {
  it('CrudAffordances is mutually assignable with the spec\'s', () => {
    expectTypeOf<CrudAffordances>().toEqualTypeOf<SpecCrudAffordances>();
  });

  it('RowCrudPredicates is mutually assignable with the spec\'s', () => {
    // The deleted local copy typed both predicates as `unknown`, which is WIDER
    // than the spec's `Expression | ExpressionInput`. That direction of drift is
    // invisible to a one-way `extends` check, so assert both ways.
    expectTypeOf<RowCrudPredicates>().toEqualTypeOf<SpecRowCrudPredicates>();
  });

  it('delegates the bucket table to the spec rather than restating it', () => {
    // The deleted `DEFAULTS` table was a line-for-line copy of the spec's
    // `CRUD_AFFORDANCE_DEFAULTS`. With no effective-API-operation set supplied,
    // objectui's resolver must be a pass-through of the spec's — if someone
    // reintroduces a local table, these diverge the first time the spec
    // re-buckets an object class.
    for (const managedBy of [
      undefined, 'platform', 'config', 'system',
      'engine-owned', 'append-only', 'better-auth', 'totally-unknown',
    ]) {
      expect(
        resolveEffectiveCrudAffordances({ managedBy }),
        `bucket '${String(managedBy)}' diverges from the spec`,
      ).toEqual(specResolveCrudAffordances({ managedBy }));
    }
  });

  it('delegates the #2614 userActions override parse too', () => {
    const cases = [
      { managedBy: 'system', userActions: { edit: true } },
      { managedBy: 'platform', userActions: { edit: false, delete: false } },
      { managedBy: 'system', userActions: { edit: { enabled: true, visibleWhen: 'record.x' } } },
      { managedBy: 'platform', userActions: { delete: { disabledWhen: 'record.locked' } } },
      { managedBy: 'config', userActions: { create: true, import: true, exportCsv: false } },
    ] as const;
    for (const schema of cases) {
      expect(resolveEffectiveCrudAffordances(schema)).toEqual(
        specResolveCrudAffordances(schema as Parameters<typeof specResolveCrudAffordances>[0]),
      );
    }
  });

  it('keeps the #3391 intersection, which the spec has no notion of', () => {
    // The one thing that is genuinely objectui's — and the reason the local
    // function keeps a local name instead of being deleted outright.
    const withoutServerConstraint = resolveEffectiveCrudAffordances({ managedBy: 'platform' });
    expect(withoutServerConstraint).toEqual({
      create: true, import: true, edit: true, delete: true, exportCsv: true,
    });

    const readOnlyServer = resolveEffectiveCrudAffordances(
      { managedBy: 'platform' },
      ['get', 'list', 'export'],
    );
    expect(readOnlyServer).toEqual({
      create: false, import: false, edit: false, delete: false, exportCsv: true,
    });

    // An empty effective set means "expose nothing", not "no constraint".
    expect(resolveEffectiveCrudAffordances({ managedBy: 'platform' }, [])).toEqual({
      create: false, import: false, edit: false, delete: false, exportCsv: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rename tripwires — the new names must not be spec names
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every export name `@objectstack/spec` publishes, per subpath — TYPES included.
 *
 * A runtime `import()` would only see values, and five of the seven names below
 * are types, so a value-only check would pass vacuously on exactly the cases
 * that matter. This reads the compiler's view of each subpath's `.d.ts`, which
 * is the same source `scripts/check-spec-symbol-derivation.mjs` uses.
 */
function specExportNames(subpaths: readonly string[]): Set<string> {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@objectstack/spec/package.json');
  const pkgDir = dirname(pkgPath);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    exports?: Record<string, { import?: { types?: string }; require?: { types?: string } }>;
  };

  const files: string[] = [];
  for (const [sub, cond] of Object.entries(pkg.exports ?? {})) {
    const name = sub === '.' ? '@objectstack/spec' : `@objectstack/spec${sub.slice(1)}`;
    if (!subpaths.includes(name)) continue;
    const dts = cond?.import?.types ?? cond?.require?.types;
    if (dts) files.push(resolve(pkgDir, dts));
  }
  if (files.length !== subpaths.length) {
    throw new Error(`could not resolve type entrypoints for ${subpaths.join(', ')}`);
  }

  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();

  const names = new Set<string>();
  for (const file of files) {
    const sf = program.getSourceFile(file);
    const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) throw new Error(`no module symbol for ${file}`);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) names.add(exported.getName());
  }
  return names;
}

describe('renamed local concepts do not collide with a spec export (objectui#3074 lesson)', () => {
  const names = specExportNames([
    '@objectstack/spec',
    '@objectstack/spec/ui',
    '@objectstack/spec/data',
    '@objectstack/spec/kernel',
    '@objectstack/spec/contracts',
  ]);

  it('reads a plausible spec export set (guards the assertions below)', () => {
    expect(names.size).toBeGreaterThan(100);
    // The names these seven were renamed OFF are still the spec's — that is why
    // the renames happened, and it keeps this test honest about what it reads.
    for (const owned of [
      'ChartSeries', 'ActionHandler', 'PluginDefinition',
      'ValidationError', 'ValidationResult', 'defineView', 'resolveCrudAffordances',
    ]) {
      expect(names, `spec no longer owns '${owned}' — re-run the triage`).toContain(owned);
    }
  });

  it.each([
    ['ChartSeriesBinding', 'renderer-internal {dataKey,label} from buildChartSeries'],
    ['ActionRunnerHandler', 'client-side ActionRunner handler, not the objectql one'],
    ['RegistryPluginDefinition', 'component-registry plugin, not a package manifest'],
    ['SchemaNodeValidationError', 'one issue found walking an SDUI schema tree'],
    ['SchemaNodeValidationResult', 'the outcome of walking an SDUI schema tree'],
    ['defineSystemView', 'freeze + mark, not the spec view-document factory'],
    ['resolveEffectiveCrudAffordances', 'spec matrix ∧ server effective API operations'],
  ])('the spec does not own `%s` (%s)', (name) => {
    expect(names).not.toContain(name);
  });

  it('records the names that were CHECKED AND REJECTED while picking these', () => {
    // Not decoration. `SchemaValidationResult` and `SchemaValidationReport` were
    // the first choices for the validator pair and both turned out to BE spec
    // exports — the same way `PageComponentSchema` did in objectui#3074. Pinning
    // them here means the next person to reach for the obvious name sees why it
    // is not used, instead of rediscovering it through a red guard.
    for (const rejected of ['SchemaValidationResult', 'SchemaValidationReport']) {
      expect(names, `'${rejected}' is no longer spec-owned — the note above is stale`)
        .toContain(rejected);
    }
  });
});

/**
 * `EvaluatorPredicateInput` — the #3314 rename (objectui#3314, objectstack#4115).
 *
 * `packages/core/src/evaluator/predicateInput.ts` declares the union
 * `ExpressionEvaluator.evaluateCondition` ACCEPTS. Its first spelling was
 * `PredicateInput`, which `@objectstack/spec` owns — and owns for a different
 * concept, so `check:spec-symbols` failed it (correctly: same name, different
 * meaning is the whole failure class).
 *
 * The two really are different, which is why this is a rename and not a
 * re-export:
 *
 *   spec  `PredicateInput` = `z.input<typeof PredicateInputSchema>`
 *         — what an AUTHOR writes: bare string | `{ dialect: cel|cron|template,
 *           source?, ast?, meta? }`.
 *   local `EvaluatorPredicateInput`
 *         — what the EVALUATOR takes after normalization: `boolean` |
 *           `${…}` template string | `{ dialect: 'cel'; source: string }` |
 *           `undefined`.
 *
 * Neither assigns to the other: the spec union has no `boolean` arm and no
 * `${…}` convention, and this one has no `cron` dialect, no optional `source`,
 * no `ast` / `meta`.
 *
 * A separate `specExportNames` call from the block above, over ALL published
 * subpaths (`/shared` included — that is where the collision was reported), so
 * this guard stands alone and cannot pass vacuously because the name lives on a
 * subpath the other list happens to omit.
 */
describe('EvaluatorPredicateInput is renamed off a spec-owned name (#3314)', () => {
  const names = specExportNames([
    '@objectstack/spec',
    '@objectstack/spec/shared',
    '@objectstack/spec/ui',
    '@objectstack/spec/data',
    '@objectstack/spec/kernel',
    '@objectstack/spec/contracts',
  ]);

  it('reads a plausible spec export set (guards the assertions below)', () => {
    expect(names.size).toBeGreaterThan(100);
  });

  it('the spec still owns `PredicateInput`, which is why the rename happened', () => {
    // The other direction of the tripwire: if the spec ever RETIRES the name,
    // the local type can take it back and this rename should be revisited — a
    // workaround must not outlive its reason (objectui#3169).
    expect(names, "spec no longer owns 'PredicateInput' — re-run the triage")
      .toContain('PredicateInput');
  });

  it('the spec does not own `EvaluatorPredicateInput` (normalized evaluator argument, not the authored predicate)', () => {
    // Renaming ONTO another spec-held name is the objectui#3074 mistake; this
    // is the assertion that would have caught it.
    expect(names).not.toContain('EvaluatorPredicateInput');
  });

  it('records the sibling names that are spec-owned and were therefore NOT used', () => {
    // Checked while picking the new name. Pinning them means the next reader
    // sees why the obvious spellings are unavailable instead of rediscovering
    // it through a red gate.
    for (const owned of ['PredicateInputSchema', 'Predicate', 'ExpressionInput']) {
      expect(names, `'${owned}' is no longer spec-owned — the note above is stale`)
        .toContain(owned);
    }
  });
});
