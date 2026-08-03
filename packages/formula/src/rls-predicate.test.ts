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
import { isPushdownableCel } from './cel-to-filter';

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
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'rls-predicate.ts'), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers).toEqual(['./cel-to-filter']);

    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@marcbachmann/cel-js', '@objectstack/spec']);
  });
});
