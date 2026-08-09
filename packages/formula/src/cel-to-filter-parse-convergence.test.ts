// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6132 — the convergence's "nothing within the limits moved" half.
 *
 * `cel-to-filter.ts` used to parse through a private, limitless
 * `new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true })`.
 * It now parses through `parseCelToAstWithReason` — #4812's canonical front end,
 * which additionally carries `DEFAULT_LIMITS`, the ObjectStack stdlib, and the
 * #3306 `rewriteNullableTernary` rewrite.
 *
 * Two of those three are invisible to this lowerer; the third is not, and the
 * issue named it as scope: `rewriteNullableTernary` wraps the non-null branch of
 * a `cond ? value : null` in `dyn(...)`, so the AST fed to `lowerCelAst` for a
 * ternary is a different tree than before. A ternary was already
 * non-pushdownable — but "the REASON it is non-pushdownable" changing is
 * behaviour, and behaviour gets pinned rather than discovered in CI.
 *
 * This file is that pin, in both directions: the OLD front end is rebuilt here
 * (the only place in the repo that still may) and every source both front ends
 * accept must produce a byte-identical `CelFilterCompileResult`.
 */

import { Environment } from '@marcbachmann/cel-js';
import { describe, expect, it } from 'vitest';

import { compileCelToFilter, isPushdownableCel, lowerCelAst } from './cel-to-filter';
import { parseCelToAst } from './cel-engine';

/**
 * The env `cel-to-filter.ts` carried before #6132, verbatim. Rebuilt HERE, in a
 * test, precisely so it exists nowhere else: its purpose is to be the "before"
 * of a comparison, not a second answer to "what parses".
 */
const legacyEnv = new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true });

const VARS = {
  current_user: {
    id: 'u1',
    email: 'a@b.c',
    organization_id: 'org1',
    org_user_ids: ['u1', 'u2'],
    empty_set: [],
  },
};

/**
 * The pushdown corpus: every shape the formula / plugin-security /
 * plugin-sharing / lint suites drive through `compileCelToFilter` or
 * `isPushdownableCel`, plus the ternary shapes the issue called out.
 */
const CORPUS = [
  // ── supported subset ──
  "record.region == 'EMEA'",
  'record.owner_id == current_user.id',
  'record.organization_id == current_user.organization_id',
  'record.owner == current_user.email',
  'record.amount > 100',
  'record.amount >= 100',
  'record.amount < 100',
  'record.amount <= 100',
  '100 < record.amount',
  'record.done == false',
  'record.done == true',
  'record.closed_at == null',
  'record.closed_at != null',
  "record.stage in ['a', 'b']",
  'record.id in current_user.org_user_ids',
  'record.id in current_user.empty_set',
  "record.name.startsWith('A')",
  "record.name.endsWith('Z')",
  "record.name.contains('mid')",
  "record.health == 'red' && record.budget > 100000",
  "record.a == 1 && (record.b == 2 || !(record.c == 3))",
  'record.owner == record.manager',
  'owner_id == current_user.id',
  'owner',
  '1 == 1',
  'true',
  'false',
  // ── refused shapes: the reason must not move either ──
  'record.amount + 1 > 2',
  'record.amount * 2 > 100',
  'size(record.tags) > 0',
  'has(record.owner_id)',
  "record.account.region == 'EU'",
  'record.a.b == 1',
  'record.stage ==',
  '{}',
  "record.tags == ['a']",
  'record.a in record.b',
  "record.name.matches('x')",
  "'EMEA' == 'EMEA'",
  '1 == 2',
  // ── the ternaries: the ONE shape whose AST the convergence changes ──
  "record.done ? 'y' : null",
  'record.amount > 0 ? record.amount : null',
  'record.x == null ? 1 : null',
  "record.a == (record.b ? 'x' : null)",
  "record.a in (record.b ? ['x'] : null)",
  '(record.b ? true : null) == true',
  "record.name.startsWith(record.b ? 'x' : null)",
  "record.done ? 'y' : 'n'",
  'record.a == 1 ? null : record.b == 2',
];

describe('#6132 — within the limits, the converged parse is behaviour-identical', () => {
  for (const source of CORPUS) {
    it(`identical result: ${source}`, () => {
      // Both front ends must agree that this source is within the limits at
      // all; a corpus entry that only one accepts is a bounds case, and those
      // live in the two switch-position suites, not here.
      let legacyAst: unknown;
      let legacyParsed = true;
      try {
        legacyAst = legacyEnv.parse(source).ast;
      } catch {
        legacyParsed = false;
      }
      const canonicalAst = parseCelToAst(source);

      if (!legacyParsed) {
        // A syntax fault: neither front end may accept it, and the compiler's
        // answer is the same `parse-error` it always was.
        expect(canonicalAst).toBeNull();
        expect(compileCelToFilter(source, { variables: VARS }).ok).toBe(false);
        return;
      }
      expect(canonicalAst, `${source} is within the limits for one front end only`).not.toBeNull();

      const before = lowerCelAst(legacyAst as never, { variables: VARS }, 'value');
      const after = compileCelToFilter(source, { variables: VARS });
      expect(after).toEqual(before);

      const beforeShape = lowerCelAst(legacyAst as never, {}, 'shape');
      const afterShape = isPushdownableCel(source);
      expect(afterShape.ok).toBe(beforeShape.ok);
      if (!afterShape.ok && !beforeShape.ok) expect(afterShape.detail).toBe(beforeShape.detail);
    });
  }
});

describe('#6132 — the ternary: the AST changes, the verdict and its reason do not', () => {
  const TERNARIES = CORPUS.filter((s) => s.includes('?') && s.includes(':'));

  it('the corpus really does carry the shape under discussion', () => {
    expect(TERNARIES.length).toBeGreaterThanOrEqual(7);
  });

  it('`rewriteNullableTernary` really does change the AST for a null-guard ternary', () => {
    // If this stops being true the pin below is vacuous, so it is asserted
    // rather than assumed: the canonical AST carries a `dyn(...)` wrap the
    // legacy one does not.
    const source = "record.done ? 'y' : null";
    const canonical = JSON.stringify(parseCelToAst(source));
    const legacy = JSON.stringify(legacyEnv.parse(source).ast);
    expect(canonical).not.toBe(legacy);
  });

  for (const source of TERNARIES) {
    it(`still non-pushdownable for the SAME reason: ${source}`, () => {
      const result = compileCelToFilter(source, { variables: VARS });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('unsupported');
      // The `?:` node faults before the lowerer ever descends into a branch, so
      // the `dyn(...)` wrap the rewrite adds INSIDE a branch is never reached.
      expect(result.detail).toMatch(/^unsupported (operator|operand) "\?:"$/);
    });
  }
});
