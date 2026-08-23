// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10101] Unit pins for the SHARED platform-row organization resolver — the
 * cloud#1395 Option A ruling's artifact ("A platform row's organization is the
 * SUBJECT record's organization; actor context is the fallback, never the
 * primary"), promoted here from plugin-audit so audit stamping, the
 * approval-row writer and the automation-run recorder share ONE precedence.
 *
 * The four-limb precedence is pinned per limb, and the `sys_api_key`
 * divergence is pinned by name: `tenancy.organizationField` answers "which
 * column says who this row is ABOUT", `tenantField`/`organization_id` answers
 * "what is this object WALLED by", and the two DELIBERATELY diverge for
 * credential tables (#8287). Flattening that divergence — resolving the stamp
 * from the wall, or walling from the stamp — is the two-tables-disagree
 * pathology this promotion exists to end.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createFieldPresenceProbe,
  createRecordOrganizationResolver,
  resolveRecordOrganizationField,
} from './record-organization.js';

/** Minimal engine double: `getSchema` over a name → definition map. */
function engineOf(defs: Record<string, any>) {
  return {
    getSchema: vi.fn((name: string) => defs[name]),
  };
}

const hasFieldOf = (def: any) => (field: string) =>
  def?.fields != null && Object.prototype.hasOwnProperty.call(def.fields, field);

describe('resolveRecordOrganizationField — the four-limb precedence', () => {
  it('limb 0: a declared `tenancy.organizationField` wins over everything, the ADR-0066 opt-out included (sys_api_key)', () => {
    // The shipped divergent case: an UNWALLED credential table
    // (`enabled: false`) whose rows are still ABOUT one organization, under a
    // column that deliberately is NOT the tenant column.
    const def = {
      name: 'sys_api_key',
      tenancy: { enabled: false, organizationField: 'active_organization_id' },
      fields: { id: {}, name: {}, user_id: {}, active_organization_id: {}, revoked: {} },
    };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBe('active_organization_id');
  });

  it('limb 0 guard (#5315): a declared organizationField naming a MISSING column falls through, never resolves to nothing', () => {
    // Missing column + disabled tenancy → limb 1 answers null (not the
    // phantom name, and not organization_id either).
    const def = {
      name: 'sys_api_key',
      tenancy: { enabled: false, organizationField: 'active_organization_id' },
      fields: { id: {}, organization_id: {} },
    };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBeNull();
  });

  it('limb 1: `tenancy.enabled === false` WITHOUT an organizationField resolves null even when an org FK exists (ADR-0066)', () => {
    // The sys_sso_provider shape: platform-global, keeps an optional org FK,
    // explicitly not tenant-scoped. Stamping from the FK would hide a global
    // object's platform rows from the platform admin who acted.
    const def = {
      name: 'sys_sso_provider',
      tenancy: { enabled: false },
      fields: { id: {}, organization_id: {} },
    };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBeNull();
  });

  it('limb 2: a declared `tenancy.tenantField` answers when present', () => {
    const def = {
      name: 'ws_doc',
      tenancy: { enabled: true, tenantField: 'workspace_id' },
      fields: { id: {}, workspace_id: {}, organization_id: {} },
    };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBe('workspace_id');
  });

  it('limb 3: the canonical injected `organization_id` when nothing is declared', () => {
    const def = { name: 'crm_deal', fields: { id: {}, organization_id: {} } };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBe('organization_id');
  });

  it('limb 4: no organization of its own → null (single-tenant shape)', () => {
    const def = { name: 'crm_deal', fields: { id: {}, amount: {} } };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBeNull();
    expect(resolveRecordOrganizationField(undefined, () => true)).toBeNull();
    expect(resolveRecordOrganizationField(null, () => true)).toBeNull();
  });
});

describe('createFieldPresenceProbe', () => {
  it('answers from the registered schema, map and array field shapes alike, memoized per object', () => {
    const engine = engineOf({
      map_obj: { fields: { id: {}, organization_id: {} } },
      arr_obj: { fields: [{ name: 'id' }, { name: 'organization_id' }] },
    });
    const has = createFieldPresenceProbe(engine);
    expect(has('map_obj', 'organization_id')).toBe(true);
    expect(has('arr_obj', 'organization_id')).toBe(true);
    expect(has('map_obj', 'missing')).toBe(false);
    expect(has('nowhere', 'organization_id')).toBe(false);
    has('map_obj', 'id');
    // one getSchema per object, not per question
    expect(engine.getSchema.mock.calls.filter(([n]) => n === 'map_obj')).toHaveLength(1);
  });

  it('an engine with no getSchema reports every field absent (skip-the-stamp posture, never a throw)', () => {
    const has = createFieldPresenceProbe({});
    expect(has('anything', 'organization_id')).toBe(false);
  });
});

describe('createRecordOrganizationResolver — the writers’ memoized face', () => {
  it('organizationOf reads the resolved column off the first candidate record that carries a non-empty value', () => {
    const engine = engineOf({ crm_deal: { fields: { id: {}, organization_id: {} } } });
    const r = createRecordOrganizationResolver(engine);
    expect(r.organizationFieldFor('crm_deal')).toBe('organization_id');
    expect(r.organizationOf('crm_deal', { id: 'd1', organization_id: 'org_A' })).toBe('org_A');
    // precedence across candidates: first non-empty wins (live record before
    // trigger snapshot, result before prior state — the callers' order)
    expect(
      r.organizationOf('crm_deal', { id: 'd1', organization_id: '' }, { id: 'd1', organization_id: 'org_B' }),
    ).toBe('org_B');
    expect(r.organizationOf('crm_deal', undefined, null, { id: 'd1' })).toBeNull();
  });

  it('pins the sys_api_key divergence end to end: the stamp column is active_organization_id, never the wall', () => {
    const engine = engineOf({
      sys_api_key: {
        tenancy: { enabled: false, organizationField: 'active_organization_id' },
        fields: { id: {}, name: {}, user_id: {}, active_organization_id: {}, revoked: {} },
      },
    });
    const r = createRecordOrganizationResolver(engine);
    expect(r.organizationFieldFor('sys_api_key')).toBe('active_organization_id');
    expect(
      r.organizationOf('sys_api_key', { id: 'k1', active_organization_id: 'org_key' }),
    ).toBe('org_key');
    // A record carrying an `organization_id` VALUE anyway (defensive noise)
    // still stamps from the DECLARED column, not the canonical spelling.
    expect(
      r.organizationOf('sys_api_key', { id: 'k1', organization_id: 'org_wrong', active_organization_id: 'org_key' }),
    ).toBe('org_key');
  });

  it('degrades to null — the acting-context fallback signal — on a getSchema-less double, a throwing getSchema, and an unknown object', () => {
    expect(createRecordOrganizationResolver({}).organizationOf('crm_deal', { organization_id: 'org_A' })).toBeNull();
    const throwing = { getSchema: () => { throw new Error('not booted'); } };
    expect(createRecordOrganizationResolver(throwing).organizationOf('crm_deal', { organization_id: 'org_A' })).toBeNull();
    const empty = engineOf({});
    expect(createRecordOrganizationResolver(empty).organizationOf('crm_deal', { organization_id: 'org_A' })).toBeNull();
  });

  it('memoizes the column per object (one schema read for N writes)', () => {
    const engine = engineOf({ crm_deal: { fields: { id: {}, organization_id: {} } } });
    const r = createRecordOrganizationResolver(engine);
    r.organizationOf('crm_deal', { organization_id: 'a' });
    r.organizationOf('crm_deal', { organization_id: 'b' });
    r.organizationFieldFor('crm_deal');
    // one call from the probe's field-set read + one from the column
    // resolution — and no growth with further questions
    const calls = engine.getSchema.mock.calls.filter(([n]) => n === 'crm_deal').length;
    r.organizationOf('crm_deal', { organization_id: 'c' });
    expect(engine.getSchema.mock.calls.filter(([n]) => n === 'crm_deal').length).toBe(calls);
    expect(calls).toBeLessThanOrEqual(2);
  });
});
