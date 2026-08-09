// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { describe, it, expect } from 'vitest';

import { applySystemFields } from './index.js';

// ---------------------------------------------------------------------------
// [#5378] Parity pin: the spec's derivation vs. this registry's injection.
//
// `resolveInjectedSystemColumns` (@objectstack/spec/data) answers WHICH system
// columns an object carries; `applySystemFields` (below) owns WHAT each one looks
// like and does the injecting. Since #5378 the registry CONSUMES the derivation,
// so the two agree by construction — and this test is what keeps that true. It
// matters because the derivation's second consumer is author-time
// (`@objectstack/lint`, which may not import a runtime): if the two ever
// disagreed, the linter would either reject a reference to a column that exists
// (the #5378 defect: `has(record.owner_id)` refused on an injection-only object,
// which pushed hotcrm#548 into re-declaring `owner_id` on 12 objects) or resolve
// one that does not (a silently broken predicate shipped to production).
//
// The matrix is every branch of the injection pass, so a future edit that
// re-opens a condition in ONE of the two places fails here rather than in a
// consumer six months later.
// ---------------------------------------------------------------------------
const fields = () => ({ title: { type: 'text' } });

const CASES: Array<[string, Record<string, unknown>]> = [
  ['default business object', { name: 'crm_contact', fields: fields() }],
  ["ownership: 'user'", { name: 'crm_contact', ownership: 'user', fields: fields() }],
  ["ownership: 'org'", { name: 'crm_contact', ownership: 'org', fields: fields() }],
  ["ownership: 'none'", { name: 'crm_contact', ownership: 'none', fields: fields() }],
  // [ADR-0117 D1 / #5677] Recognised by the engine before ObjectSchema emits it.
  ["ownership: 'business_unit'", { name: 'crm_contact', ownership: 'business_unit', fields: fields() }],
  ['sys_* namespace', { name: 'sys_thing', fields: fields() }],
  ["managedBy: 'platform'", { name: 'crm_contact', managedBy: 'platform', fields: fields() }],
  ["managedBy: 'better-auth'", { name: 'crm_contact', managedBy: 'better-auth', fields: fields() }],
  ['systemFields: false', { name: 'crm_contact', systemFields: false, fields: fields() }],
  ['systemFields.tenant: false', { name: 'crm_contact', systemFields: { tenant: false }, fields: fields() }],
  ['systemFields.audit: false', { name: 'crm_contact', systemFields: { audit: false }, fields: fields() }],
  ['tenancy.enabled: false', { name: 'crm_contact', tenancy: { enabled: false }, fields: fields() }],
  [
    'declares owner_id itself',
    { name: 'crm_contact', fields: { ...fields(), owner_id: { type: 'lookup', reference: 'sys_user' } } },
  ],
];

/** What the registry really adds to this object, read off the live pass. */
function actuallyInjected(def: Record<string, unknown>, multiTenant: boolean): Set<string> {
  const before = new Set(Object.keys((def.fields ?? {}) as Record<string, unknown>));
  const after = applySystemFields(structuredClone(def) as any, { multiTenant });
  return new Set(Object.keys(after.fields ?? {}).filter((k) => !before.has(k)));
}

describe('[#5378] resolveInjectedSystemColumns ↔ applySystemFields parity', () => {
  describe.each([true, false])('multiTenant: %s', (multiTenant) => {
    it.each(CASES)('%s', (_label, def) => {
      const injected = actuallyInjected(def, multiTenant);
      const derived = new Set(resolveInjectedSystemColumns(def).names);
      // `id` is the DRIVER's primary key, not this pass's output. The derivation
      // reports it (it is addressable on every object); the registry does not
      // inject it — so it is excluded here rather than papered over.
      derived.delete('id');

      // A column the object DECLARES is not "injected" (the registry lets the
      // author's field win), but it is still addressable, so the derivation
      // names it. Compare on the columns the object does not declare.
      const declared = new Set(Object.keys((def.fields ?? {}) as Record<string, unknown>));
      for (const d of declared) derived.delete(d);

      expect([...derived].sort()).toEqual([...injected].sort());
    });
  });

  it('the plan flags line up with the columns the registry adds', () => {
    for (const [label, def] of CASES) {
      const injected = actuallyInjected(def, true);
      const plan = resolveInjectedSystemColumns(def);
      const declared = new Set(Object.keys((def.fields ?? {}) as Record<string, unknown>));
      // Flag ⇒ column present (unless the author declared it, in which case the
      // registry skipped the addition but the flag is still correct).
      expect(plan.tenant, `${label}: tenant`).toBe(injected.has('organization_id') || declared.has('organization_id'));
      expect(plan.audit, `${label}: audit`).toBe(injected.has('created_at') || declared.has('created_at'));
      expect(plan.owner, `${label}: owner`).toBe(injected.has('owner_id') || declared.has('owner_id'));
      expect(plan.owningBusinessUnit, `${label}: owningBusinessUnit`)
        .toBe(injected.has('owning_business_unit_id') || declared.has('owning_business_unit_id'));
    }
  });

  it('multiTenant changes only the INDEX, never which columns exist', () => {
    // The property that lets an author-time consumer answer without any runtime
    // context — and therefore the reason the derivation takes no such option.
    for (const [label, def] of CASES) {
      expect([...actuallyInjected(def, true)].sort(), label)
        .toEqual([...actuallyInjected(def, false)].sort());
    }
    const mt = applySystemFields({ name: 'crm_contact', fields: fields() } as any, { multiTenant: true });
    const st = applySystemFields({ name: 'crm_contact', fields: fields() } as any, { multiTenant: false });
    // [#6810] The index moved from a field-level `indexed` boolean — never a
    // `FieldSchema` key — to the object's `indexes[]`. The property this test
    // guards is unchanged: the flag moves the INDEX, never the column set.
    expect((mt as any).indexes).toEqual([{ fields: ['organization_id'] }]);
    expect((st as any).indexes).toBeUndefined();
    expect((mt.fields as any).organization_id).toEqual((st.fields as any).organization_id);
  });
});
