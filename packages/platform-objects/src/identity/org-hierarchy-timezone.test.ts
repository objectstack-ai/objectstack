// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14238 — the organization hierarchy carries the IANA zone a date boundary is
 * computed in. Maintainer ruling 2026-09-02 (option A, verbatim 「同意」):
 * `sys_business_unit` gains a nullable `timezone` that inherits down the
 * `parent_business_unit_id` chain, and `sys_organization` gains `timezone` as
 * that chain's root default. No resolver API (option B waits for a second
 * consumer); `sys_user` is not the home (option C refused).
 *
 * This file pins the DECLARED shape, in three parts:
 *
 *  1. both columns exist, on `text`, optional, and declare
 *     `valueDomain: 'iana_time_zone'` — the ruling's own precondition: 「if not,
 *     the engine seat sequences this card behind it rather than shipping an
 *     unvalidated text column」. A column that lost the declaration would be
 *     exactly the shape the ruling refused, and every other assertion here
 *     would still pass over it;
 *  2. the two columns are ONE shape — same type, optionality, bound and domain,
 *     no default on either. The card's thesis is that every author invents this
 *     column differently, and the platform's own two precedents
 *     (`sys_job.timezone`: 100, no default; `sys_report_schedule.timezone`: 64,
 *     default `UTC`; neither validated) already disagree in three dimensions.
 *     The ruled pair must not become a third and a fourth spelling;
 *  3. the declared domain admits `UTC`, the fallback the contract names for a
 *     wholly unset chain, and the declared bound admits every zone the runtime
 *     enumerates. Why the first is not automatic — `Intl.supportedValuesOf`
 *     omits `UTC`, so a column judged against the enumeration would refuse the
 *     platform's own default — is measured and pinned beside the predicate in
 *     `packages/spec` (`value-domain.test.ts`), once; this file asks the
 *     predicate the column actually inherits and does not re-implement it.
 *
 * The write-path half — a non-member WRITTEN to either column is refused with
 * the ADR-0114 code `value_domain` — lives in plugin-auth's
 * `org-hierarchy-timezone-write-contract.test.ts`, the one package that depends
 * on both the columns and the evaluator.
 */

import { describe, it, expect } from 'vitest';
import { isValueDomainMember } from '@objectstack/spec/shared';
import { SysBusinessUnit } from './sys-business-unit.object';
import { SysOrganization } from './sys-organization.object';

type ColumnShape = {
  type?: unknown;
  required?: unknown;
  maxLength?: unknown;
  valueDomain?: unknown;
  defaultValue?: unknown;
  readonly?: unknown;
  group?: unknown;
};

const unitColumn = () => (SysBusinessUnit.fields as Record<string, ColumnShape>).timezone;
const orgColumn = () => (SysOrganization.fields as Record<string, ColumnShape>).timezone;

/** The keys on which the two ruled columns must agree — "one spelling". */
const SHAPE_KEYS = ['type', 'required', 'maxLength', 'valueDomain', 'defaultValue', 'readonly'] as const;

describe('#14238 — sys_business_unit.timezone and sys_organization.timezone', () => {
  it('reads the real declarations, not an empty probe', () => {
    // Vacuity control: a renamed column or a changed export would otherwise let
    // every assertion below pass over `undefined`.
    expect(SysBusinessUnit.name).toBe('sys_business_unit');
    expect(SysOrganization.name).toBe('sys_organization');
    expect(unitColumn()).toBeTypeOf('object');
    expect(orgColumn()).toBeTypeOf('object');
  });

  it.each([
    ['sys_business_unit', unitColumn],
    ['sys_organization', orgColumn],
  ])('%s.timezone is an optional, domain-validated, bounded text column', (_object, column) => {
    const c = column();
    expect(c.type).toBe('text');
    // Nullable, by the ruling's word: on the unit "null" means INHERIT, on the
    // organization it means UTC. `required: true` would make both meanings
    // unreachable.
    expect(c.required).toBe(false);
    // The ruling's precondition — the one line that turns an unvalidated text
    // column into a validated one. `VALUE_DOMAIN_FIELD_TYPES` is `{text}`, so
    // the declaration is also the reason the type above must stay `text`.
    expect(c.valueDomain).toBe('iana_time_zone');
    expect(c.maxLength).toBe(64);
    // No schema default on either column, deliberately: on the unit a default
    // would mean "stop inheriting"; on the organization it would give UTC two
    // spellings (unset on rows that predate the column, 'UTC' on rows minted
    // after it). The contract has one: unset resolves to UTC.
    expect('defaultValue' in c).toBe(false);
    // `stripReadonlyFields` runs on the update path BEFORE the validator, so a
    // readonly column is one an administrator could never set — and the root
    // default is, by the ruling's word, a value an administrator sets.
    expect(c.readonly ?? false).toBe(false);
  });

  it('the two columns are ONE shape — the platform does not invent it twice', () => {
    const pick = (c: ColumnShape) => Object.fromEntries(SHAPE_KEYS.map((k) => [k, c[k]]));
    expect(pick(unitColumn())).toEqual(pick(orgColumn()));
  });

  it('the unit column lives in the Hierarchy group — it is resolved along the hierarchy', () => {
    expect(unitColumn().group).toBe('Hierarchy');
  });

  it('the declared domain admits the fallback the contract names (`UTC`) and refuses a zone that does not exist', () => {
    // Asked of the predicate the write path calls (`isValueDomainMember`), under
    // the domain the column actually declares — not of a re-implementation.
    const domain = unitColumn().valueDomain as 'iana_time_zone';
    expect(isValueDomainMember(domain, 'UTC')).toBe(true);
    expect(isValueDomainMember(domain, 'Asia/Shanghai')).toBe(true);
    // Shape-valid and nonexistent — the case a `pattern` cannot refuse.
    expect(isValueDomainMember(domain, 'Mars/Olympus')).toBe(false);
  });

  it('the declared bound admits every zone the runtime enumerates, with room for the tzdb links it omits', () => {
    // A sourced bound, not an alignment convenience: the enumeration's longest
    // name on the repo's Node baseline is 30 characters and the tzdb caps each
    // path component at 14, so 64 is twice the domain's real ceiling. If a
    // future ICU ever enumerates a name the bound refuses, this goes red
    // instead of the column silently refusing a legal zone.
    const longest = Math.max(...Intl.supportedValuesOf('timeZone').map((z) => z.length));
    expect(longest).toBeLessThanOrEqual(unitColumn().maxLength as number);
    // The longest identifier in the tzdb itself is a backward link the
    // enumeration omits and the probe admits — 32 characters, still under half
    // the bound.
    const longestLink = 'America/Argentina/ComodRivadavia';
    expect(longestLink.length).toBe(32);
    expect(isValueDomainMember('iana_time_zone', longestLink)).toBe(true);
    expect(longestLink.length).toBeLessThanOrEqual(unitColumn().maxLength as number);
  });
});
