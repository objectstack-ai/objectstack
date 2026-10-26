/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { CONTEXT_TOKEN_SUGGESTIONS, CONTEXT_TOKENS } from '@objectstack/spec/data';

import { resolveContextTokens } from '../filter-tokens';

/**
 * objectui#7265 — `filter-tokens.ts` carried module-local copies of two
 * `@objectstack/spec/data` exports (`CONTEXT_TOKEN_SUGGESTIONS`, the near-miss
 * map, and `isContextToken`, the membership predicate). Both are imports now.
 *
 * ## What this file pins, and why it is not a tautology
 *
 * The expectations below are a LITERAL TRANSCRIPTION of what the deleted local
 * copies did, taken at 567f370 before the swap. They are deliberately NOT read
 * back from the import that replaced them — an assertion shaped
 * `expect(imported).toEqual(imported)` passes no matter what the spec does, and
 * the whole risk of replacing a local definition with an imported one is that a
 * later spec release moves it underneath us.
 *
 * The import is used for ONE thing: to widen the candidate pool the cases are
 * driven over. That can only make this file stricter — a tenth near-miss
 * spelling added upstream enters the pool, warns, and fails the exact-set
 * assertion; a spelling dropped upstream stops warning and fails the same one.
 *
 * The surface under test is the resolver's OBSERVABLE behaviour (what comes
 * back, and what it warns), because that is what the two deleted symbols were
 * for. Neither was ever exported from `@object-ui/core`.
 */

/** Every near-miss spelling the deleted local map carried, with its target. */
const NEAR_MISSES_AT_567f370 = [
  ['current_user', 'current_user_id'],
  ['current_user_email', 'current_user_id'],
  ['user_id', 'current_user_id'],
  ['userid', 'current_user_id'],
  ['me', 'current_user_id'],
  ['current_organization_id', 'current_org_id'],
  ['org_id', 'current_org_id'],
  ['organization_id', 'current_org_id'],
  ['current_tenant_id', 'current_org_id'],
] as const;

/**
 * The near-miss spellings `@objectstack/spec` 17.5.0 ADDED to the imported map,
 * transcribed from the installed map when the bump turned the exact-set
 * assertion red (objectui#11073) — the pool widening doing its job. Kept apart
 * from the 567f370 table so that table stays what it says it is.
 *
 * Four were added; only these two WARN, because `{record.id}` and `{record-id}`
 * never reach the lookup: the resolver's whole-token pattern is
 * `[a-zA-Z0-9_]+`, so a `.` or `-` spelling is not a placeholder to it and
 * passes through in silence, exactly as it did before the bump.
 */
const NEAR_MISSES_ADDED_AT_17_5_0 = [
  ['current_record_id', 'record_id'],
  ['recordid', 'record_id'],
] as const;

/** Every token the deleted local predicate answered `true` for. */
const CONTEXT_TOKENS_AT_567f370 = ['current_user_id', 'current_org_id'] as const;

type Scope = { currentUserId?: string | null; currentOrgId?: string | null };

const IN_SCOPE: Scope = { currentUserId: 'usr_42', currentOrgId: 'org_7' };

/** Resolves one placeholder and reports both halves of the observable result. */
function resolveOne(token: string, scope: Scope = IN_SCOPE) {
  const warnings: string[] = [];
  const out = resolveContextTokens(
    { f: `{${token}}` },
    { ...scope, onUnresolved: (m) => warnings.push(m) },
  );
  return { value: (out as { f: unknown }).f, warnings };
}

describe('objectui#7265 — the derived map and predicate behave as the local copies did', () => {
  it('accepts and rejects exactly the tokens the local predicate did', () => {
    // The predicate half, stated over the vocabulary rather than inferred from
    // the map: a token that RESOLVES is one the predicate admitted.
    const resolves = [
      ...CONTEXT_TOKENS_AT_567f370,
      ...NEAR_MISSES_AT_567f370.map(([spelling]) => spelling),
      ...CONTEXT_TOKENS,
      'today',
      'this_month',
      'nav_region_selector',
      'unknown_thing',
    ].filter((token) => resolveOne(token).value !== `{${token}}`);

    expect([...new Set(resolves)].sort()).toEqual([...CONTEXT_TOKENS_AT_567f370].sort());
  });

  it('resolves each recognised token to its scope value, in both spellings', () => {
    for (const token of CONTEXT_TOKENS_AT_567f370) {
      const expected = token === 'current_user_id' ? 'usr_42' : 'org_7';
      expect(resolveOne(token)).toEqual({ value: expected, warnings: [] });
      // `${token}` is the second accepted spelling and must not diverge.
      const warnings: string[] = [];
      expect(
        resolveContextTokens(
          { f: `\${${token}}` },
          { ...IN_SCOPE, onUnresolved: (m) => warnings.push(m) },
        ),
      ).toEqual({ f: expected });
      expect(warnings).toEqual([]);
    }
  });

  it('leaves a recognised token in place and warns when scope has no value', () => {
    const signedOut = resolveOne('current_user_id', { currentUserId: null });
    expect(signedOut.value).toBe('{current_user_id}');
    expect(signedOut.warnings).toHaveLength(1);
    expect(signedOut.warnings[0]).toContain('no signed-in user in scope');

    const noOrg = resolveOne('current_org_id', { currentOrgId: undefined });
    expect(noOrg.value).toBe('{current_org_id}');
    expect(noOrg.warnings[0]).toContain('no active organization in scope');
  });

  it('warns with the same suggestion target for every near-miss spelling', () => {
    for (const [spelling, target] of [...NEAR_MISSES_AT_567f370, ...NEAR_MISSES_ADDED_AT_17_5_0]) {
      const { value, warnings } = resolveOne(spelling);
      expect(value).toBe(`{${spelling}}`); // never substituted — it is not a token
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`"{${spelling}}" is not a recognised token`);
      expect(warnings[0]).toContain(`did you mean "{${target}}"?`);
    }
  });

  it('warns for EXACTLY those spellings — nothing gained, nothing lost upstream', () => {
    // The candidate pool unions the literal table with the imported map's keys,
    // so an entry added or removed upstream lands in the pool either way; the
    // EXPECTED set stays the literal transcription.
    const pool = [
      ...NEAR_MISSES_AT_567f370.map(([spelling]) => spelling),
      ...Object.keys(CONTEXT_TOKEN_SUGGESTIONS),
    ];
    const warners = [...new Set(pool)].filter((s) => resolveOne(s).warnings.length > 0);

    expect(warners.sort()).toEqual(
      [...NEAR_MISSES_AT_567f370, ...NEAR_MISSES_ADDED_AT_17_5_0].map(([spelling]) => spelling).sort(),
    );
  });

  it('keeps the lookup case-folded, as the local copy did', () => {
    const shouty = resolveOne('CURRENT_USER');
    expect(shouty.value).toBe('{CURRENT_USER}');
    expect(shouty.warnings[0]).toContain('did you mean "{current_user_id}"?');
  });

  it('still passes other vocabularies through in silence', () => {
    // Date macros and nav-only context-selector ids are not this resolver's
    // business; warning on them is the regression a widened predicate causes.
    for (const token of ['today', 'this_quarter', 'nav_region_selector']) {
      expect(resolveOne(token)).toEqual({ value: `{${token}}`, warnings: [] });
    }
  });

  it('pins the token tuple itself, so a third token cannot arrive unnoticed', () => {
    // `resolveContextTokens` builds its scope lookup with a `satisfies
    // Record<ContextTokenName, …>` clause, so a third token reds the compile.
    // This states the same ratchet at runtime, where the failure names itself.
    expect([...CONTEXT_TOKENS]).toEqual([...CONTEXT_TOKENS_AT_567f370]);
  });
});
