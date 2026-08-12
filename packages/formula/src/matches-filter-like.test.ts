// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7536] `$like` / `$ilike` on the write-side evaluator.
 *
 * ## Why this face gets ARMS while driver-memory gets a refusal
 *
 * The two are not inconsistent, they are answering different questions. A
 * DRIVER compiles a read: it can refuse a filter it cannot express, and the
 * caller sees a 400. This evaluator answers an RLS write-side `check` per
 * record, and its documented posture is that an operator it does not know
 * returns `false` — fail-closed, deny the write. That posture is right for a
 * spelling the protocol does not have, and wrong for one it DOES: a declared
 * `$like` hitting the silent default would deny every write while the read
 * scope's SQL happily matched rows. One predicate, two answers, across the
 * write gate and the read gate — the #3948 shape, and exactly the defect the
 * #6993 census measured for `$icontains`.
 *
 * So the rule this file enforces is the one `matches-filter.ts`' header states:
 * every operator an author may WRITE has an arm here. The test is the
 * declaration surface (`StringOperatorSchema`), not the `FILTER_OPERATORS`
 * allowlist — `$like` is staged out of that array on purpose, and staging must
 * not be a way to reintroduce the silent `false`.
 *
 * The semantics are the spec's shared `matchesLikePattern`, which is what
 * `driver-sql` compiles to `LIKE` / `GLOB` — so a `check` evaluated here and
 * the same predicate compiled to SQL cannot disagree.
 */

import { describe, it, expect } from 'vitest';
import { matchesFilterCondition } from './matches-filter.js';

const row = (name: unknown) => ({ name });

describe('[#7536] matchesFilterCondition — $like / $ilike', () => {
  it('matches the WHOLE value, so a wildcard-free pattern is exact', () => {
    expect(matchesFilterCondition(row('Industries'), { name: { $like: 'Industries' } })).toBe(true);
    // The defect's signature: a substring must NOT match.
    expect(matchesFilterCondition(row('Acme Industries'), { name: { $like: 'Industries' } })).toBe(false);
  });

  it('binds the caller\'s wildcards', () => {
    expect(matchesFilterCondition(row('Acme Industries'), { name: { $like: '%Industries' } })).toBe(true);
    expect(matchesFilterCondition(row('Industries Ltd'), { name: { $like: '%Industries' } })).toBe(false);
    expect(matchesFilterCondition(row('axb'), { name: { $like: 'a_b' } })).toBe(true);
    expect(matchesFilterCondition(row('ab'), { name: { $like: 'a_b' } })).toBe(false);
  });

  it('honours a backslash escape', () => {
    expect(matchesFilterCondition(row('a_b'), { name: { $like: 'a\\_b' } })).toBe(true);
    expect(matchesFilterCondition(row('axb'), { name: { $like: 'a\\_b' } })).toBe(false);
  });

  it('is case-SENSITIVE for $like and ASCII-folded for $ilike', () => {
    expect(matchesFilterCondition(row('ACME Corp'), { name: { $like: 'acme%' } })).toBe(false);
    expect(matchesFilterCondition(row('ACME Corp'), { name: { $ilike: 'acme%' } })).toBe(true);
    // The #4706 Q1 = A boundary — the fold is ASCII and nothing else. A
    // `toLowerCase()` implementation answers `true` here and diverges from the
    // SQL read side, which is the whole reason the fold lives in the spec.
    expect(matchesFilterCondition(row('CAFÉ'), { name: { $ilike: 'café' } })).toBe(false);
  });

  it('does NOT agree with $contains — the two operators stayed distinct', () => {
    const record = row('Acme Industries');
    expect(matchesFilterCondition(record, { name: { $contains: 'Industries' } })).toBe(true);
    expect(matchesFilterCondition(record, { name: { $like: 'Industries' } })).toBe(false);
  });

  it('answers FALSE for a non-string value rather than throwing', () => {
    // This evaluator is TOTAL by contract: `plugin-security`'s explain engine
    // calls it per record, so a throw would turn a per-record verdict into an
    // aborted operation.
    expect(matchesFilterCondition(row(42), { name: { $like: '%4%' } })).toBe(false);
    expect(matchesFilterCondition(row(null), { name: { $like: '%' } })).toBe(false);
  });

  it('answers FALSE for a malformed pattern rather than throwing', () => {
    // A dangling trailing escape is refused LOUDLY by the driver faces, where a
    // caller can act on it. Here the fail-closed answer is the safe one, and
    // totality is the contract.
    expect(matchesFilterCondition(row('abc'), { name: { $like: 'abc\\' } })).toBe(false);
  });

  it('is reached through combinators too', () => {
    expect(matchesFilterCondition(row('Acme Industries'), {
      $or: [{ name: { $like: 'nope' } }, { name: { $like: '%Industries' } }],
    })).toBe(true);
    expect(matchesFilterCondition(row('Acme Industries'), {
      $not: { name: { $like: '%Industries' } },
    })).toBe(false);
  });
});
