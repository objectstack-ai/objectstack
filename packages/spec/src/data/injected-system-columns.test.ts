// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { AUDIT_PROVENANCE_FIELDS } from './field-group-layout';
import { resolveInjectedSystemColumns } from './injected-system-columns';

// ---------------------------------------------------------------------------
// [#5378] The per-object injected-column derivation.
//
// The verdicts below are the MEASURED behaviour of the registry's
// `applySystemFields` (see the probe table in the PR). The parity pin that keeps
// the two agreeing lives in objectql — `system-managed-fields-conformance.test.ts`
// — because only that package can import both; this file pins the derivation's
// own contract, which is what author-time consumers read.
// ---------------------------------------------------------------------------
describe('resolveInjectedSystemColumns — the injected columns, so author-time validation resolves them too', () => {
  const business = { name: 'crm_contact', fields: { name: { type: 'text' } } };

  it('gives a default business object every system column', () => {
    const plan = resolveInjectedSystemColumns(business);
    expect(plan).toMatchObject({ tenant: true, audit: true, owner: true, owningBusinessUnit: true });
    expect([...plan.names].sort()).toEqual([
      'created_at', 'created_by', 'id', 'organization_id', 'owner_id',
      'owning_business_unit_id', 'updated_at', 'updated_by',
    ]);
  });

  it("treats an omitted `ownership` exactly like 'user'", () => {
    const omitted = resolveInjectedSystemColumns(business);
    const explicit = resolveInjectedSystemColumns({ ...business, ownership: 'user' });
    expect([...explicit.names].sort()).toEqual([...omitted.names].sort());
  });

  // The whole reason the derivation is conditional rather than a blanket union:
  // a consumer resolving `record.owner_id` on one of these objects must still
  // report it, because the column genuinely is not there.
  it.each(['org', 'none'])("withholds BOTH ownership anchors for ownership: '%s'", (ownership) => {
    const plan = resolveInjectedSystemColumns({ ...business, ownership });
    expect(plan.owner).toBe(false);
    expect(plan.owningBusinessUnit).toBe(false);
    expect(plan.names.has('owner_id')).toBe(false);
    expect(plan.names.has('owning_business_unit_id')).toBe(false);
    // The tenant + audit columns are unaffected by the ownership tier.
    expect(plan.names.has('organization_id')).toBe(true);
    for (const f of AUDIT_PROVENANCE_FIELDS) expect(plan.names.has(f)).toBe(true);
  });

  // [ADR-0117 D1 / #5677] The tier the engine recognises before `ObjectSchema`
  // can emit it: an owning UNIT, deliberately no owning person.
  it("gives ownership: 'business_unit' the unit anchor but NOT owner_id", () => {
    const plan = resolveInjectedSystemColumns({ ...business, ownership: 'business_unit' });
    expect(plan.owner).toBe(false);
    expect(plan.owningBusinessUnit).toBe(true);
    expect(plan.names.has('owner_id')).toBe(false);
    expect(plan.names.has('owning_business_unit_id')).toBe(true);
  });

  it.each([
    ['a sys_* name', { name: 'sys_thing', fields: {} }],
    ["managedBy: 'platform'", { name: 'crm_contact', managedBy: 'platform', fields: {} }],
  ])('makes %s ineligible for ownership, keeping tenant + audit', (_label, def) => {
    const plan = resolveInjectedSystemColumns(def);
    expect(plan.owner).toBe(false);
    expect(plan.owningBusinessUnit).toBe(false);
    expect(plan.tenant).toBe(true);
    expect(plan.audit).toBe(true);
  });

  it('withholds organization_id for either tenant opt-out', () => {
    for (const def of [
      { ...business, systemFields: { tenant: false } },
      { ...business, tenancy: { enabled: false } },
    ]) {
      const plan = resolveInjectedSystemColumns(def);
      expect(plan.tenant).toBe(false);
      expect(plan.names.has('organization_id')).toBe(false);
      expect(plan.audit).toBe(true); // independent axis
      expect(plan.owner).toBe(true);
    }
  });

  it('injects nothing into the shipped sys_api_key shape — the better-auth bail runs before tenancy', () => {
    // [#19054] This case used to pin read-neutrality against the stamp-only
    // `tenancy.organizationField` key, feeding the plan a declaration and
    // asserting it moved no verdict. The key is retired from the authorable
    // surface in protocol 18 (ADR-0049), so there is no declaration left to be
    // neutral about and a fixture still carrying one would pin a branch that
    // can no longer be reached — a check that passes because nothing is
    // produced. What survives is the half that was never about the key: the
    // shipped credential table gets NO injected system columns, because the
    // `managedBy: 'better-auth'` bail is reached before tenancy is consulted
    // at all. That is the fact the whole stamp-vs-wall divergence rests on —
    // the table has no `organization_id` and therefore no wall (#8287).
    const apiKeyShape = resolveInjectedSystemColumns({
      name: 'sys_api_key',
      managedBy: 'better-auth',
      tenancy: { enabled: false },
      fields: {},
    });
    expect(apiKeyShape).toMatchObject({ tenant: false, audit: false, owner: false, owningBusinessUnit: false });
    expect([...apiKeyShape.names]).toEqual(['id']);

    // The bail is the reason, not the `enabled: false`: the same object WITHOUT
    // an explicit tenancy block reaches the same verdicts.
    const withoutTenancyBlock = resolveInjectedSystemColumns({
      name: 'sys_api_key',
      managedBy: 'better-auth',
      fields: {},
    });
    expect([...withoutTenancyBlock.names]).toEqual(['id']);
  });

  it('withholds the audit family for systemFields.audit: false', () => {
    const plan = resolveInjectedSystemColumns({ ...business, systemFields: { audit: false } });
    expect(plan.audit).toBe(false);
    for (const f of AUDIT_PROVENANCE_FIELDS) expect(plan.names.has(f)).toBe(false);
    expect(plan.tenant).toBe(true);
    expect(plan.owner).toBe(true);
  });

  // `systemFields: false` is NOT an object, so a naive `sf?.audit !== false`
  // read would leave the audit family switched ON — the trap the two hard
  // opt-outs are folded into the derivation to close.
  it.each([
    ['systemFields: false', { ...business, systemFields: false }],
    ["managedBy: 'better-auth'", { ...business, managedBy: 'better-auth' }],
  ])('injects nothing for %s', (_label, def) => {
    const plan = resolveInjectedSystemColumns(def);
    expect(plan).toMatchObject({ tenant: false, audit: false, owner: false, owningBusinessUnit: false });
    // …except the primary key, which is the DRIVER's and survives both opt-outs.
    expect([...plan.names]).toEqual(['id']);
  });

  it('reports a column that the object also declares — existence, not provenance', () => {
    const plan = resolveInjectedSystemColumns({
      name: 'crm_contact',
      fields: { name: { type: 'text' }, owner_id: { type: 'lookup', reference: 'sys_user' } },
    });
    // The registry lets the author's field win, but the COLUMN exists either
    // way, so a consumer asking "is this name addressable" gets one answer.
    expect(plan.names.has('owner_id')).toBe(true);
  });

  it('tolerates bare / junk input like its sibling derivations', () => {
    for (const junk of [undefined, null, 42, 'nope', [], {}]) {
      expect(() => resolveInjectedSystemColumns(junk)).not.toThrow();
      expect(resolveInjectedSystemColumns(junk).names.has('id')).toBe(true);
    }
    // A nameless record is still ownership-eligible (no `sys_` prefix to find).
    expect(resolveInjectedSystemColumns({}).owner).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [ADR-0131 D7] The #12699 deployment declaration made total: the plan's one
// deployment input. An object the deployment declares platform-global gets no
// organization column on that deployment; nothing else moves, and an absent
// input is the authored plan, byte for byte.
// ---------------------------------------------------------------------------
describe('resolveInjectedSystemColumns — the deployment\'s platform-global declaration (ADR-0131 D7)', () => {
  const declared = { name: 'sys_widget_registry', fields: { title: { type: 'text' } } };
  const sibling = { name: 'crm_task', fields: { title: { type: 'text' } } };
  const deployment = { platformGlobalObjects: new Set(['sys_widget_registry']) };

  it('withholds organization_id from a declared object, and only that column', () => {
    const authored = resolveInjectedSystemColumns(declared);
    const plan = resolveInjectedSystemColumns(declared, deployment);
    expect(authored.tenant).toBe(true);
    expect(plan.tenant).toBe(false);
    expect(plan.names.has('organization_id')).toBe(false);
    // Every other decision is the authored one.
    expect({ audit: plan.audit, owner: plan.owner, owningBusinessUnit: plan.owningBusinessUnit }).toEqual({
      audit: authored.audit,
      owner: authored.owner,
      owningBusinessUnit: authored.owningBusinessUnit,
    });
    expect([...plan.names].sort()).toEqual([...authored.names].filter((n) => n !== 'organization_id').sort());
  });

  it('CONTROL: a non-declared object on the same deployment keeps its column', () => {
    const plan = resolveInjectedSystemColumns(sibling, deployment);
    expect(plan.tenant).toBe(true);
    expect(plan.names.has('organization_id')).toBe(true);
  });

  it('accepts the declaration as an array as well as a set', () => {
    expect(resolveInjectedSystemColumns(declared, { platformGlobalObjects: ['sys_widget_registry'] }).tenant).toBe(false);
  });

  it.each([
    ['no second argument', undefined],
    ['an absent key', {}],
    ['an empty set', { platformGlobalObjects: new Set<string>() }],
    ['an empty list', { platformGlobalObjects: [] as string[] }],
  ])('%s: every plan is byte-identical to the authored one', (_label, input) => {
    for (const def of [
      declared,
      sibling,
      { ...declared, systemFields: { tenant: false } },
      { ...declared, tenancy: { enabled: false } },
      { ...declared, systemFields: false },
      { ...declared, managedBy: 'better-auth' },
      { ...sibling, ownership: 'business_unit' },
      {},
    ]) {
      const authored = resolveInjectedSystemColumns(def);
      const plan = resolveInjectedSystemColumns(def, input);
      expect({ ...plan, names: [...plan.names] }).toEqual({ ...authored, names: [...authored.names] });
    }
  });

  it('a nameless record is never declared, whatever the declaration names', () => {
    expect(resolveInjectedSystemColumns({}, { platformGlobalObjects: [''] }).tenant).toBe(true);
  });
});
