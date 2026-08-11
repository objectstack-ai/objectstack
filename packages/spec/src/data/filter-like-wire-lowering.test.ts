// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7536] `like` / `ilike` reach the driver as PATTERNS, not as `$contains`.
 *
 * ## The defect, as QA measured it
 *
 * The wire lowering carried `'like': '$contains'` in `AST_OPERATOR_MAP`, so
 * every `like` predicate that arrived over HTTP was rewritten into a substring
 * search before any driver saw it. `$contains` LIKE-escapes its comparand and
 * wraps it in `%…%`, which breaks a `like` in BOTH directions at once:
 *
 * | filter node | measured (QA #7463) | expected |
 * |---|---|---|
 * | `["name","like","%Industries"]` | `200`, **0 rows** — the `%` bound as a literal | the rows ENDING WITH `Industries` |
 * | `["name","like","Industries"]` | `200`, a substring match **byte-identical to the `$contains` control** | an exact `LIKE 'Industries'` |
 *
 * The second row is the tell, and it is the one this file exists to keep red if
 * the fold ever returns: `like` and `contains` producing the same output means
 * `like` is not a pattern match at all.
 *
 * ## Why the assertions are at THIS level
 *
 * `parseFilterAST` / `convertComparison` is the path a wire filter actually
 * takes (`metadata-protocol`'s door runs `isFilterAST` → `parseFilterAST`;
 * objectql's engine door runs the same pair). `canonicalAstOperator` always
 * exempted `like`/`ilike` — its comment said, in as many words, that folding
 * them onto `contains` "would silently wrap the value in `%…%` and change what
 * the query means" — but that exemption only ever shaped its OWN output, and
 * the lowering the wire uses had no such exemption. A test that only asked
 * `canonicalAstOperator` would have been green throughout the defect.
 *
 * The execution half — that the SQL family runs these patterns and answers the
 * right rows, and that every other face refuses them loudly rather than
 * answering something else — lives in the driver suites. See
 * `sql-driver-like-pattern.test.ts` for the rows.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFilterAST,
  isFilterAST,
  canonicalAstOperator,
  VALID_AST_OPERATORS,
  hasDanglingLikeEscape,
  likePatternToRegexSource,
  likePatternToGlobPattern,
  matchesLikePattern,
} from './filter.zod';

describe('[#7536] the wire lowering of `like` / `ilike`', () => {
  // ── The card's repro table, as pins ───────────────────────────────────────

  it('keeps a wildcard pattern INTACT — the `%` is the caller\'s, not a literal', () => {
    // Row 1 of the table. Under the fold this lowered to
    // `{ name: { $contains: '%Industries' } }`, which driver-sql compiled to
    // `LIKE '%\%Industries%'` — a search for a literal percent sign, hence the
    // measured 0 rows.
    expect(parseFilterAST(['name', 'like', '%Industries'])).toEqual({
      name: { $like: '%Industries' },
    });
  });

  it('lowers a WILDCARD-FREE `like` to an exact pattern, NOT a substring search', () => {
    // Row 2, and the load-bearing one: this is the assertion that goes red if
    // anyone restores the `'like': '$contains'` map entry.
    expect(parseFilterAST(['name', 'like', 'Industries'])).toEqual({
      name: { $like: 'Industries' },
    });
  });

  it('does NOT produce the same lowering as the `$contains` control', () => {
    // The byte-identical response QA measured, restated as a property. Stated
    // as an inequality on purpose: a future refactor could change BOTH spellings
    // and the two assertions above would still pass while this one catches the
    // collapse.
    const like = parseFilterAST(['name', 'like', 'Industries']);
    const contains = parseFilterAST(['name', 'contains', 'Industries']);
    expect(like).not.toEqual(contains);
  });

  it('leaves the `$contains` control lowering exactly as it was', () => {
    // The other half of the same guard: `like` must move WITHOUT `contains`
    // moving. This is what goes red if someone "fixes" the divergence by
    // changing the control instead.
    expect(parseFilterAST(['name', 'contains', 'Industries'])).toEqual({
      name: { $contains: 'Industries' },
    });
  });

  // ── `ilike`, which had no lowering at all before this ─────────────────────

  it('accepts `ilike` and lowers it to its own operator', () => {
    // Before #7536 `ilike` was absent from `AST_OPERATOR_MAP` entirely, so
    // `isFilterAST` REFUSED it and the whole filter was rejected at the door.
    expect(isFilterAST(['name', 'ilike', '%industries'])).toBe(true);
    expect(parseFilterAST(['name', 'ilike', '%industries'])).toEqual({
      name: { $ilike: '%industries' },
    });
  });

  it('carries both spellings in the AST vocabulary', () => {
    expect(VALID_AST_OPERATORS.has('like')).toBe(true);
    expect(VALID_AST_OPERATORS.has('ilike')).toBe(true);
  });

  it('folds the operator case-insensitively, like every other spelling', () => {
    expect(parseFilterAST(['name', 'LIKE', '%x'])).toEqual({ name: { $like: '%x' } });
    expect(parseFilterAST(['name', 'ILike', '%x'])).toEqual({ name: { $ilike: '%x' } });
  });

  // ── The nested / negated positions the AST admits ─────────────────────────

  it('lowers a `like` inside an `and` node', () => {
    expect(parseFilterAST(['and', ['name', 'like', '%Industries'], ['stage', '=', 'won']])).toEqual({
      $and: [{ name: { $like: '%Industries' } }, { stage: 'won' }],
    });
  });

  it('lowers a `like` inside an `or` node beside its `contains` control', () => {
    // Both operators in ONE filter, which is the shape that makes a fold
    // visible at a glance: under the defect these two branches were identical.
    expect(parseFilterAST(['or', ['name', 'like', 'Acme'], ['name', 'contains', 'Acme']])).toEqual({
      $or: [{ name: { $like: 'Acme' } }, { name: { $contains: 'Acme' } }],
    });
  });

  it('lowers a `like` in the legacy flat-array position', () => {
    expect(parseFilterAST([['name', 'like', 'a%'], ['stage', '=', 'won']])).toEqual({
      $and: [{ name: { $like: 'a%' } }, { stage: 'won' }],
    });
  });

  // The AST comparison grammar has no negation operator — `not_contains` is a
  // distinct operator rather than a modifier, and `$not` is reachable only from
  // the object spelling. So the negated position is exercised where it exists:
  // as a `FilterCondition`, which needs no lowering.

  // ── `canonicalAstOperator` still answers, now by construction ─────────────

  it('canonicalises both spellings to themselves, without a hand-written exemption', () => {
    // This function always answered correctly — the hand-written exemption it
    // used to carry is what the defect's own comment documented. It now falls
    // out of the generic round-trip (`like` → `$like` → `like`), which is why
    // the exemption is gone. Pinned so the answer cannot regress with it.
    expect(canonicalAstOperator('like')).toBe('like');
    expect(canonicalAstOperator('ilike')).toBe('ilike');
    expect(canonicalAstOperator('LIKE')).toBe('like');
  });

  it('does not canonicalise `like` onto `contains`', () => {
    expect(canonicalAstOperator('like')).not.toBe(canonicalAstOperator('contains'));
  });
});

describe('[#7536] the `$like` pattern language', () => {
  // One definition, shared by every face — so these cases are the contract the
  // SQL emitters and the JS evaluator are BOTH held to.

  it('matches the whole value, so a wildcard-free pattern is EXACT', () => {
    expect(matchesLikePattern('Industries', 'Industries')).toBe(true);
    // The defect's signature, as a behaviour: a substring must NOT match.
    expect(matchesLikePattern('Acme Industries', 'Industries')).toBe(false);
  });

  it('gives `%` its "any sequence" meaning, including empty', () => {
    expect(matchesLikePattern('Acme Industries', '%Industries')).toBe(true);
    expect(matchesLikePattern('Industries', '%Industries')).toBe(true);
    expect(matchesLikePattern('Industries Ltd', '%Industries')).toBe(false);
    expect(matchesLikePattern('Acme Industries Ltd', '%Industries%')).toBe(true);
  });

  it('gives `_` its "exactly one character" meaning', () => {
    expect(matchesLikePattern('axb', 'a_b')).toBe(true);
    expect(matchesLikePattern('ab', 'a_b')).toBe(false);
    expect(matchesLikePattern('axyb', 'a_b')).toBe(false);
  });

  it('lets a backslash escape a wildcard back into a literal', () => {
    expect(matchesLikePattern('100% match', '100\\% match')).toBe(true);
    expect(matchesLikePattern('100X match', '100\\% match')).toBe(false);
    expect(matchesLikePattern('a_b', 'a\\_b')).toBe(true);
    expect(matchesLikePattern('axb', 'a\\_b')).toBe(false);
    expect(matchesLikePattern('a\\b', 'a\\\\b')).toBe(true);
  });

  it('treats regex metacharacters as LITERAL — the pattern language is LIKE, not regex', () => {
    // The `$regex` defect (#4706) restated one operator over: `.` is an
    // ordinary character to LIKE, and a translation that forgot to escape it
    // would match `axb` here.
    expect(matchesLikePattern('a.b', 'a.b')).toBe(true);
    expect(matchesLikePattern('axb', 'a.b')).toBe(false);
    expect(matchesLikePattern('a+b', 'a+b')).toBe(true);
  });

  it('is case-SENSITIVE for `$like` and ASCII-folded for `$ilike`', () => {
    expect(matchesLikePattern('ACME Corp', 'acme%')).toBe(false);
    expect(matchesLikePattern('ACME Corp', 'acme%', true)).toBe(true);
    // The #4706 Q1 = A boundary: the fold is ASCII and nothing else.
    expect(matchesLikePattern('CAFÉ', 'café', true)).toBe(false);
    expect(matchesLikePattern('CAFE', 'cafe', true)).toBe(true);
  });

  it('matches across newlines, because SQL `%` has no line concept', () => {
    expect(matchesLikePattern('a\nb', 'a%b')).toBe(true);
    expect(matchesLikePattern('a\nb', 'a_b')).toBe(true);
  });

  it('anchors the source, so a pattern cannot match a substring by accident', () => {
    expect(likePatternToRegexSource('abc')).toBe('^abc$');
  });

  it('refuses a pattern ending in a lone unpaired backslash', () => {
    expect(hasDanglingLikeEscape('abc\\')).toBe(true);
    expect(hasDanglingLikeEscape('abc\\\\')).toBe(false);
    expect(hasDanglingLikeEscape('a\\\\\\')).toBe(true);
    expect(hasDanglingLikeEscape('abc')).toBe(false);
    expect(() => likePatternToRegexSource('abc\\')).toThrow(/unpaired backslash/);
    expect(() => likePatternToGlobPattern('abc\\')).toThrow(/unpaired backslash/);
  });
});

describe('[#7536] the LIKE → GLOB translation the SQLite dialects need', () => {
  // SQLite's `LIKE` folds ASCII case and cannot be told not to per statement,
  // so a case-exact pattern match has to use `GLOB` — which speaks a DIFFERENT
  // pattern language. These cases are what stops the two from being confused.

  it('translates the wildcards', () => {
    expect(likePatternToGlobPattern('%Industries')).toBe('*Industries');
    expect(likePatternToGlobPattern('a_b')).toBe('a?b');
    expect(likePatternToGlobPattern('%a_b%')).toBe('*a?b*');
  });

  it('escapes GLOB\'s OWN metacharacters, which are ORDINARY to LIKE', () => {
    // The direction a hand-written escape forgets. An unescaped `*` in a GLOB
    // pattern is the same filter bypass an unescaped `%` is under LIKE (#5567).
    expect(likePatternToGlobPattern('a*b')).toBe('a[*]b');
    expect(likePatternToGlobPattern('a?b')).toBe('a[?]b');
    expect(likePatternToGlobPattern('a[b')).toBe('a[[]b');
    // `]` needs no escape: every `[` became a class that closes itself, so no
    // unclosed class survives for a later `]` to terminate.
    expect(likePatternToGlobPattern('a]b')).toBe('a]b');
  });

  it('turns an ESCAPED LIKE wildcard into a literal GLOB character', () => {
    expect(likePatternToGlobPattern('100\\%')).toBe('100%');
    expect(likePatternToGlobPattern('a\\_b')).toBe('a_b');
    // …and re-escapes it when the literal is a GLOB metacharacter.
    expect(likePatternToGlobPattern('a\\*b')).toBe('a[*]b');
  });

  it('translates the card\'s own patterns to the GLOB the SQLite dialects run', () => {
    // The end-to-end row counts these produce are pinned against a real SQLite
    // engine in `sql-driver-like-pattern.test.ts`; what belongs HERE is the
    // exact string, so a change to the translation is visible in this package's
    // own diff rather than only as a driver test failing later.
    expect(likePatternToGlobPattern('%Industries')).toBe('*Industries');
    expect(likePatternToGlobPattern('Industries')).toBe('Industries');
    expect(likePatternToGlobPattern('100\\%%')).toBe('100%*');
  });

  it('never emits a GLOB wildcard the LIKE pattern did not ask for', () => {
    // The property a broken translation violates, stated over every character
    // that means something to either language: the only `*` and `?` in the
    // output are the ones `%` and `_` put there. Everything else is inside a
    // self-closing class, so it cannot widen the match.
    for (const literal of ['*', '?', '[', ']', '%', '_', '\\']) {
      const pattern = `a${literal === '%' || literal === '_' || literal === '\\' ? '\\' : ''}${literal}b`;
      const glob = likePatternToGlobPattern(pattern);
      // Strip the escaped classes; nothing wildcard-ish may remain.
      expect(glob.replace(/\[.\]/g, '')).not.toMatch(/[*?]/);
    }
  });
});
