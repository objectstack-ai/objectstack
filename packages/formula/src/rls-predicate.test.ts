// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The unit tests that travelled with `isSupportedRlsExpression` /
 * `sqlPredicateToCel` when #4983 hoisted them out of
 * `@objectstack/plugin-security` (`security-plugin.test.ts`, describe block
 * "RLSCompiler D4 — uncompilable predicates are surfaced"). The two shape cases
 * are reproduced VERBATIM below: the hoist is a change of address, so a moved
 * test that also changes its assertions would hide the one thing the move has
 * to prove. The consumer-side half — that `RLSCompiler` still warns, still
 * fails closed, and still agrees with this predicate — stayed in
 * plugin-security, where the consumer is.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSupportedRlsExpression, sqlPredicateToCel } from './rls-predicate';
import { compileCelToFilter, isPushdownableCel } from './cel-to-filter';
import { matchesFilterCondition } from './matches-filter';
import type { FilterCondition } from '@objectstack/spec/data';

/**
 * This file's own directory, resolved ONCE.
 *
 * Deliberately a single module-level constant rather than a `const here = …` in
 * each test that needs it. This package's `tsconfig.json` excludes `*.test.ts`,
 * so `pnpm typecheck` never reads this file — but `check-type-check-coverage`
 * re-measures it with the exclusion lifted and holds the count to a shrink-only
 * TEST_DEBT ledger (#5278). `import.meta` costs two raw errors there (TS1470 +
 * TS2339) under the package's CommonJS-targeted config, so a SECOND occurrence
 * would raise the ledger by two for no behavioural reason. One occurrence, two
 * readers.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// ADR-0056 D4 — RLS predicates that won't compile must not vanish in silence
// (moved verbatim from plugin-security/src/security-plugin.test.ts, #4983)
// ---------------------------------------------------------------------------
describe('isSupportedRlsExpression — the ADR-0056 D4 shape gate', () => {
  it('isSupportedRlsExpression accepts the compilable shapes', () => {
    // Legacy SQL-ish subset (bridged `=`/`IN`).
    expect(isSupportedRlsExpression('owner_id = current_user.id')).toBe(true);
    expect(isSupportedRlsExpression('owner = current_user.email')).toBe(true);
    expect(isSupportedRlsExpression("status = 'published'")).toBe(true);
    expect(isSupportedRlsExpression('id IN (current_user.org_user_ids)')).toBe(true);
    expect(isSupportedRlsExpression('1 = 1')).toBe(true);
    // ADR-0058: the canonical compiler lowers a broader pushdown subset, so the
    // shape gate now (correctly) reports these as enforceable — `==`/`!=`,
    // comparisons, and CEL compound predicates all compile to a FilterCondition.
    expect(isSupportedRlsExpression('owner == current_user.id')).toBe(true);   // `==`
    expect(isSupportedRlsExpression('amount > 100')).toBe(true);               // comparison
    expect(isSupportedRlsExpression('region != null')).toBe(true);             // null check
    expect(isSupportedRlsExpression('a == 1 && b == 2')).toBe(true);           // CEL compound
  });

  it('isSupportedRlsExpression rejects genuinely non-pushdownable shapes', () => {
    // These cannot lower to a FilterCondition for ANY input, so the gate must
    // reject them (ADR-0055 / ADR-0056 D4) — they fail closed at runtime.
    expect(isSupportedRlsExpression('a = current_user.id AND b = 1')).toBe(false); // SQL AND ≠ CEL && (unparseable)
    expect(isSupportedRlsExpression('amount + 1 > 2')).toBe(false);                // arithmetic
    expect(isSupportedRlsExpression('id IN (SELECT id FROM users)')).toBe(false);  // subquery
    expect(isSupportedRlsExpression('record.a.b == 1')).toBe(false);              // cross-object traversal
    expect(isSupportedRlsExpression('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The bridge's boundary conditions — the reason a COPY of it was unacceptable
// ---------------------------------------------------------------------------
//
// `sqlPredicateToCel` is a regex rewrite, and its edge cases are precisely the
// red/green line of the authoring gate built on it (#4983). A second
// implementation drifting by one character would make `os validate` reject
// policies the runtime executes correctly — the false-positive direction, which
// is worse than the gap. Pinning them here is what makes ONE definition worth
// insisting on.

describe('sqlPredicateToCel — the legacy bridge, pinned at its boundaries', () => {
  it('rewrites the historically-supported SQL subset', () => {
    expect(sqlPredicateToCel('owner_id = current_user.id')).toBe('owner_id == current_user.id');
    expect(sqlPredicateToCel('id IN (current_user.org_user_ids)')).toBe('id in (current_user.org_user_ids)');
    expect(sqlPredicateToCel('1 = 1')).toBe('1 == 1');
  });

  it('never rewrites inside a quoted string literal', () => {
    expect(sqlPredicateToCel("status = 'a = b'")).toBe("status == 'a = b'");
    expect(sqlPredicateToCel("note = 'IN transit'")).toBe("note == 'IN transit'");
  });

  it('is IDEMPOTENT on canonical CEL — an authored predicate passes through unchanged', () => {
    for (const cel of [
      'owner_id == current_user.id',
      'id in current_user.org_user_ids',
      'amount >= 100',
      'amount <= 100',
      'region != null',
      "a == 1 && b == 'x'",
    ]) {
      expect(sqlPredicateToCel(cel)).toBe(cel);
      expect(sqlPredicateToCel(sqlPredicateToCel(cel))).toBe(cel);
    }
  });

  it('leaves comparison operators containing `=` alone', () => {
    // The lookbehind/lookahead exist for these: `>=`, `<=`, `!=`, `==`.
    expect(sqlPredicateToCel('a >= 1')).toBe('a >= 1');
    expect(sqlPredicateToCel('a <= 1')).toBe('a <= 1');
    expect(sqlPredicateToCel('a != 1')).toBe('a != 1');
  });
});

// ---------------------------------------------------------------------------
// The composition the gate depends on
// ---------------------------------------------------------------------------

describe('isSupportedRlsExpression — composition and dependency direction', () => {
  it('is exactly `isPushdownableCel(sqlPredicateToCel(x)).ok` for a non-blank predicate', () => {
    const corpus = [
      'owner_id = current_user.id',
      "status = 'published'",
      'id IN (current_user.org_user_ids)',
      'amount > 100',
      'a == 1 && b == 2',
      'amount + 1 > 2',
      'size(record.tags) > 0',
      "record.account.region == 'EU'",
      'a = current_user.id AND b = 1',
    ];
    for (const source of corpus) {
      expect({ source, ok: isSupportedRlsExpression(source) })
        .toEqual({ source, ok: isPushdownableCel(sqlPredicateToCel(source)).ok });
    }
  });

  /**
   * #4983's hard constraint: the direction is `plugin-security` → `formula` and
   * `lint` → `formula`, NEVER the reverse. `@objectstack/formula` depends on
   * `@objectstack/spec` alone (see its package.json), and this module may not
   * quietly acquire a runtime import — that would put the hoisted predicate back
   * out of `@objectstack/lint`'s reach ("Depends on @objectstack/spec; never on
   * a runtime") and undo the whole move. Asserted against the source, because
   * a dependency that is only wrong at build time produces no failing assertion.
   */
  it('never imports a runtime — the hoist direction is pinned, not just intended', () => {
    const source = readFileSync(join(HERE, 'rls-predicate.ts'), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers).toEqual(['./cel-to-filter']);

    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@marcbachmann/cel-js', '@objectstack/spec']);
  });
});

// ---------------------------------------------------------------------------
// #6641 — the schema's own `@example` predicates must COMPILE
// ---------------------------------------------------------------------------
//
// `packages/spec/src/security/rls.zod.ts` documents `using` / `check` with
// `@example` predicates, and an author copies them verbatim. An example that
// does not compile is therefore not a typography defect: `compileExpression`
// returns `null`, `compileFilter` sees `filters.length === 0` and returns
// `RLS_DENY_FILTER`, so with a single policy the object denies EVERY row — and
// `@objectstack/lint`'s `validateRlsPredicateEnforceability` rejects the same
// predicate at authoring time, because it asks the very function above. The
// symptom an author gets is "I followed the schema's example, and now lint
// errors and every query is empty".
//
// #6641 was exactly that. `check`'s enumerated-values example read
// `status IN ('draft', 'pending')`; `sqlPredicateToCel` rewrites the WORD `IN`
// and never the parentheses, and CEL's list literal is BRACKETED, so the
// bridged `status in ('draft', 'pending')` is a parse error. The neighbouring
// `IN (current_user.<array>)` form survives only because a single `(expr)`
// happens to be a legal CEL parenthesised group — it collapses the moment a
// second element appears, which is why measuring one example never covered the
// other.
//
// Asserted against the SOURCE TEXT on purpose: a documentation example is not
// reachable from any import, so no ordinary unit test can ever go red on it.
// This is the guard that whole defect class was missing.

/** `packages/spec/src/security/rls.zod.ts`, from this file's own location. */
const RLS_ZOD_SOURCE = join(HERE, '..', '..', 'spec', 'src', 'security', 'rls.zod.ts');

/** The `@example "…"` predicates declared on ONE property's own TSDoc block. */
function predicateExamples(property: 'using' | 'check'): string[] {
  const source = readFileSync(RLS_ZOD_SOURCE, 'utf8');
  const decl = source.indexOf(`\n  ${property}: z.string()`);
  expect(decl, `\`${property}: z.string()\` not found in rls.zod.ts`).toBeGreaterThan(-1);
  const block = source.slice(source.lastIndexOf('/**', decl), decl);
  return [...block.matchAll(/@example\s+"([^"]+)"/g)].map((m) => m[1]!);
}

describe('rls.zod.ts @example — the schema documents only predicates that compile (#6641)', () => {
  it.each(['using', 'check'] as const)('every `%s` @example passes the ADR-0056 D4 shape gate', (property) => {
    const examples = predicateExamples(property);
    // Anti-vacuity. A green loop over an empty list is this pin's own failure
    // mode: reshape the docblock, or move the examples, and a bare `for` would
    // keep reporting success while guarding nothing.
    expect(examples.length).toBeGreaterThanOrEqual(3);
    expect(examples.map((source) => ({ source, supported: isSupportedRlsExpression(source) })))
      .toEqual(examples.map((source) => ({ source, supported: true })));
  });

  it('the `check` enumerated-values example is a CEL bracket list that means "one of these"', () => {
    // Substance, not wording: find the example by the idiom it demonstrates,
    // then read the expectations out of what it COMPILES to, so renaming the
    // field or the statuses keeps this green while breaking the idiom fails.
    // Case-INSENSITIVE on purpose: the SQL spelling `IN (…)` must be caught by
    // this test and fail on the bracket assertion below, not slip past the
    // filter and leave an empty list that a laxer pin would call green.
    const [enumerated, ...extra] = predicateExamples('check').filter((e) => /\bin\b/i.test(e));
    expect(extra).toEqual([]);
    expect(enumerated).toBeTypeOf('string');

    // Bracketed, never parenthesised — `(a, b)` is not a CEL expression.
    expect(enumerated).toMatch(/\bin\s*\[/);
    // Already canonical CEL, so the deprecated SQL bridge is a no-op on it
    // (ADR-0058 D1): the example teaches the canonical dialect, not the bridge.
    expect(sqlPredicateToCel(enumerated!)).toBe(enumerated);

    const compiled = compileCelToFilter(enumerated!, { variables: {} });
    expect(compiled.ok).toBe(true);
    const filter = (compiled as { ok: true; filter: unknown }).filter as Record<string, { $in?: unknown[] }>;
    const [field, ...moreFields] = Object.keys(filter);
    expect(moreFields).toEqual([]);
    const allowed = filter[field!]?.$in;
    // More than one member is the whole point — the one-element spelling was
    // never the broken case.
    expect(Array.isArray(allowed) && allowed.length > 1).toBe(true);

    // CHECK-clause semantics: the write path validates the POST-IMAGE against
    // this filter (`plugin-security/security-plugin.ts` step 3.6, via
    // `matchesFilterCondition`). Only the enumerated values may be written;
    // anything else — including an absent or null field — is refused. That is
    // what "Only allow certain statuses" has to mean to be a true example.
    for (const value of allowed as unknown[]) {
      expect(matchesFilterCondition({ [field!]: value }, filter as FilterCondition)).toBe(true);
    }
    const notEnumerated = '__status_not_in_the_example__';
    expect(allowed).not.toContain(notEnumerated);
    expect(matchesFilterCondition({ [field!]: notEnumerated }, filter as FilterCondition)).toBe(false);
    expect(matchesFilterCondition({ [field!]: null }, filter as FilterCondition)).toBe(false);
    expect(matchesFilterCondition({}, filter as FilterCondition)).toBe(false);
  });
});
