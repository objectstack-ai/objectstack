// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { lintUnscopedDeclaredIndexes, UNIQUE_UNSCOPED_DECLARED_INDEX } from '@objectstack/lint';
import { IndexSchema } from '@objectstack/spec/data';
import { SysUserPreference } from './sys-user-preference.object';

/**
 * #8323 — `sys_user_preference`'s `(user_id, key)` uniqueness is per
 * ORGANIZATION, and the spelling that says so is the explicit one.
 *
 * ## Why this pin exists as a literal
 *
 * The two `unique` spellings mean opposite things at the two levels: a
 * FIELD-level `unique: true` has been per-organization since #3696, while a
 * DECLARED index's `unique: true` is the positional spelling of `'global'` and
 * materializes the listed columns verbatim. `packages/lint` names that "the
 * #4986 trap", and this declaration was one of its two instances in the
 * platform's own metadata — measured in production as: a user belonging to two
 * organizations could never persist a preference key they had already used in
 * the first one, silently, because `userState.save()` swallows the refusal.
 *
 * Reverting this one word would restore that bug with no other visible change,
 * so it is pinned by literal rather than by "is unique in some sense".
 *
 * The driver-side behaviour — that this declaration materializes
 * `(COALESCE(organization_id,'__global__'), user_id, key)`, that a
 * cross-organization write is accepted and a same-organization duplicate is
 * still refused — is pinned in
 * `driver-sql/src/sql-driver-declared-index-organization-respelling.test.ts`,
 * whose fixture copies the `indexes[]` entry asserted here. This test is what
 * keeps the copy honest.
 */
describe('sys_user_preference — declared uniqueness is organization-scoped (#8323)', () => {
  const uniqueIndexes = (SysUserPreference.indexes ?? []).filter((i: any) => i.unique);

  it('declares exactly one unique index, on (user_id, key)', () => {
    expect(uniqueIndexes).toHaveLength(1);
    expect(uniqueIndexes[0].fields).toEqual(['user_id', 'key']);
  });

  it("spells the scope 'organization' — NOT bare `true`", () => {
    // ⛔ Bare `true` here is `'global'`: one holder across the whole
    // installation, which is the defect #8323 reports. `'global'` is equally
    // wrong for this object and equally rejected by this assertion.
    expect(uniqueIndexes[0].unique).toBe('organization');
  });

  it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
    expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
      fields: ['user_id', 'key'],
      unique: 'organization',
    });
  });

  it('reports no `unique/unscoped-declared-index` finding', () => {
    // The rule that would have caught this at authoring time. It fires on the
    // bare spelling alone, so a green result here IS the statement that no
    // declared index on this object leaves its scope unstated.
    const findings = lintUnscopedDeclaredIndexes([SysUserPreference as any]);
    expect(findings.filter((f) => f.rule === UNIQUE_UNSCOPED_DECLARED_INDEX)).toEqual([]);
  });

  it('the rule DOES fire on the pre-fix spelling — this pin is not vacuous', () => {
    // Anti-vacuity: proves the assertion above can fail. A lint rule that
    // reported nothing for every input would make the previous test green
    // while the trap was wide open.
    const preFix = {
      ...(SysUserPreference as any),
      indexes: [{ fields: ['user_id', 'key'], unique: true }, { fields: ['user_id'], unique: false }],
    };
    const findings = lintUnscopedDeclaredIndexes([preFix]);
    expect(findings.filter((f) => f.rule === UNIQUE_UNSCOPED_DECLARED_INDEX)).toHaveLength(1);
  });

  it('leaves the non-unique index alone', () => {
    // Scope discipline: #8323 changes uniqueness scope, nothing else.
    expect((SysUserPreference.indexes ?? []).map((i: any) => [i.fields, i.unique ?? false])).toEqual([
      [['user_id', 'key'], 'organization'],
      [['user_id'], false],
    ]);
  });
});
