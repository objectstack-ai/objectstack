// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10101] Unit pins for the SHARED platform-row organization resolver — the
 * cloud#1395 Option A ruling's artifact ("A platform row's organization is the
 * SUBJECT record's organization; actor context is the fallback, never the
 * primary"), promoted here from plugin-audit so audit stamping, the
 * approval-row writer and the automation-run recorder share ONE precedence.
 *
 * The four-limb precedence is pinned per limb, and the `sys_api_key`
 * divergence is pinned by name: `PLATFORM_STAMP_ORGANIZATION_COLUMNS` answers
 * "which column says who this row is ABOUT", `tenantField`/`organization_id`
 * answers "what is this object WALLED by", and the two DELIBERATELY diverge for
 * credential tables (#8287). Flattening that divergence — resolving the stamp
 * from the wall, or walling from the stamp — is the two-tables-disagree
 * pathology this promotion exists to end.
 *
 * ⭐ [#19054] Limb 0 used to read the authorable `tenancy.organizationField`
 * key; protocol 18 retires that key (ADR-0049) and the divergence moves into
 * the platform table keyed by OBJECT NAME. Two consequences these pins state
 * rather than assume: an object outside that table gets limb 0 skipped no
 * matter what columns it carries, and the engine-bound faces resolve limb 0
 * from the name they were ASKED about, not from a `name` the definition may or
 * may not echo.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createFieldPresenceProbe,
  createRecordOrganizationResolver,
  createRecordWallOrganizationResolver,
  resolveRecordOrganizationField,
  resolveRecordWallOrganizationField,
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
  it('limb 0: the platform stamp column wins over everything, the ADR-0066 opt-out included (sys_api_key)', () => {
    // The shipped divergent case: an UNWALLED credential table
    // (`enabled: false`) whose rows are still ABOUT one organization, under a
    // column that deliberately is NOT the tenant column. Since #19054 the
    // divergence is a platform fact keyed by object NAME — the definition
    // declares nothing.
    const def = {
      name: 'sys_api_key',
      tenancy: { enabled: false },
      fields: { id: {}, name: {}, user_id: {}, active_organization_id: {}, revoked: {} },
    };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBe('active_organization_id');
  });

  it('limb 0 is keyed by NAME, not by column shape: an ordinary object carrying the same column is not a stamp row (#19054)', () => {
    // ⛔ The anti-widening pin. The retired key made "this object stamps from
    // somewhere else" authorable; the platform table makes it a closed set. An
    // application object that happens to carry a column by that name — or that
    // would have declared the key before protocol 18 — takes the ordinary
    // limbs, so no application can put a fourth spelling of "who is this row
    // about" into the platform's mouth.
    const lookalike = {
      name: 'crm_lead',
      tenancy: { enabled: true, tenantField: 'workspace_id' },
      fields: { id: {}, workspace_id: {}, active_organization_id: {}, organization_id: {} },
    };
    expect(resolveRecordOrganizationField(lookalike, hasFieldOf(lookalike))).toBe('workspace_id');

    const unwalledLookalike = {
      name: 'crm_credential',
      tenancy: { enabled: false },
      fields: { id: {}, active_organization_id: {}, organization_id: {} },
    };
    expect(resolveRecordOrganizationField(unwalledLookalike, hasFieldOf(unwalledLookalike))).toBeNull();
  });

  it('limb 0 guard (#5315): a platform stamp column the object does NOT have falls through, never resolves to nothing', () => {
    // Missing column + disabled tenancy → limb 1 answers null (not the
    // phantom name, and not organization_id either).
    const def = {
      name: 'sys_api_key',
      tenancy: { enabled: false },
      fields: { id: {}, organization_id: {} },
    };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBeNull();
  });

  it('limb 1: `tenancy.enabled === false` on a non-stamp object resolves null even when an org FK exists (ADR-0066)', () => {
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

/**
 * [#18378] The WALL face — the same limbs MINUS limb 0.
 *
 * ⭐ The pins are written as a PAIR against the stamp face above wherever the
 * two can diverge, because "these two answer the same question except here" is
 * the whole claim, and a pin that only exercised the wall face would pass on an
 * implementation that had quietly become a second copy of the precedence.
 */
describe('resolveRecordWallOrganizationField — limb 0 is not a limb here', () => {
  it('the sys_api_key shape: the stamp face answers the platform column, the wall face answers NULL', () => {
    // The ONE object in the platform stamp table, and the reason the two faces
    // exist: `enabled: false` says nothing walls this table (#8287), so there
    // is no organization for work launched from such a row to ACT AS, however
    // clearly the row says who it is ABOUT.
    const def = {
      name: 'sys_api_key',
      tenancy: { enabled: false },
      fields: { id: {}, name: {}, user_id: {}, active_organization_id: {}, revoked: {} },
    };
    expect(resolveRecordOrganizationField(def, hasFieldOf(def))).toBe('active_organization_id');
    expect(resolveRecordWallOrganizationField(def, hasFieldOf(def))).toBeNull();
  });

  it('the wall face never consults the platform stamp table, even where the object carries that column', () => {
    // A stamp row that IS walled would be the shape where the two faces could
    // silently converge. `sys_api_key` is not walled, so the discriminating
    // fixture is the credential table itself seen from both sides plus the
    // ordinary walled neighbour: the wall face must reach its own column by
    // limbs 2/3 alone, never by the stamp table.
    const walled = {
      name: 'ws_doc',
      tenancy: { enabled: true, tenantField: 'workspace_id' },
      fields: { id: {}, workspace_id: {}, active_organization_id: {}, organization_id: {} },
    };
    expect(resolveRecordWallOrganizationField(walled, hasFieldOf(walled))).toBe('workspace_id');
    expect(resolveRecordOrganizationField(walled, hasFieldOf(walled))).toBe('workspace_id');
  });

  it('limbs 1 to 4 are SHARED — the two faces agree everywhere limb 0 is absent', () => {
    // The anti-drift pin. Every shape the stamp face pins above, minus the ones
    // in the platform stamp table: the answers must be identical, so a future
    // edit that "fixes" one body cannot leave the other behind.
    const shapes = [
      { name: 'sys_sso_provider', tenancy: { enabled: false }, fields: { id: {}, organization_id: {} } },
      { name: 'ws_doc', tenancy: { enabled: true, tenantField: 'workspace_id' }, fields: { id: {}, workspace_id: {}, organization_id: {} } },
      { name: 'ws_doc_phantom', tenancy: { enabled: true, tenantField: 'nope' }, fields: { id: {}, organization_id: {} } },
      { name: 'crm_deal', fields: { id: {}, organization_id: {} } },
      { name: 'crm_deal_bare', fields: { id: {}, amount: {} } },
    ];
    for (const def of shapes) {
      expect(
        resolveRecordWallOrganizationField(def, hasFieldOf(def)),
        `wall and stamp must agree on '${def.name}'`,
      ).toBe(resolveRecordOrganizationField(def, hasFieldOf(def)));
    }
    expect(resolveRecordWallOrganizationField(undefined, () => true)).toBeNull();
    expect(resolveRecordWallOrganizationField(null, () => true)).toBeNull();
  });
});

describe('createRecordWallOrganizationResolver — the sweep’s memoized face', () => {
  it('resolves the wall column end to end, and answers null on the unwalled credential shape', () => {
    const engine = engineOf({
      crm_deal: { fields: { id: {}, organization_id: {} } },
      // ⭐ No `name` on the definition, deliberately: the engine-bound faces
      // resolve limb 0 from the name they were ASKED about. Several engine
      // doubles in this monorepo return bare `{ tenancy, fields }` maps, and a
      // stamp column that depended on whether a schema echoes its own name
      // would be a difference no caller can see.
      sys_api_key: {
        tenancy: { enabled: false },
        fields: { id: {}, active_organization_id: {} },
      },
    });
    const wall = createRecordWallOrganizationResolver(engine);
    expect(wall.organizationFieldFor('crm_deal')).toBe('organization_id');
    expect(wall.organizationOf('crm_deal', { id: 'd1', organization_id: 'org_A' })).toBe('org_A');
    expect(wall.organizationFieldFor('sys_api_key')).toBeNull();
    expect(wall.organizationOf('sys_api_key', { id: 'k1', active_organization_id: 'org_key' })).toBeNull();
    // The stamp face over the SAME engine still answers — the divergence is in
    // the faces, not in the engine or the fixture.
    expect(
      createRecordOrganizationResolver(engine).organizationOf('sys_api_key', {
        id: 'k1',
        active_organization_id: 'org_key',
      }),
    ).toBe('org_key');
  });

  it('shares the glue: same degradation posture, same memoization', () => {
    expect(createRecordWallOrganizationResolver({}).organizationOf('crm_deal', { organization_id: 'org_A' })).toBeNull();
    const throwing = { getSchema: () => { throw new Error('not booted'); } };
    expect(createRecordWallOrganizationResolver(throwing).organizationOf('crm_deal', { organization_id: 'org_A' })).toBeNull();
    const engine = engineOf({ crm_deal: { fields: { id: {}, organization_id: {} } } });
    const wall = createRecordWallOrganizationResolver(engine);
    wall.organizationOf('crm_deal', { organization_id: 'a' });
    const calls = engine.getSchema.mock.calls.filter(([n]) => n === 'crm_deal').length;
    wall.organizationOf('crm_deal', { organization_id: 'b' });
    expect(engine.getSchema.mock.calls.filter(([n]) => n === 'crm_deal').length).toBe(calls);
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
      // Bare definition, no `name` echoed — this is the shape the three
      // sanctioned writers' own engine doubles use, and the face must resolve
      // limb 0 from the name it was asked about (#19054).
      sys_api_key: {
        tenancy: { enabled: false },
        fields: { id: {}, name: {}, user_id: {}, active_organization_id: {}, revoked: {} },
      },
    });
    const r = createRecordOrganizationResolver(engine);
    expect(r.organizationFieldFor('sys_api_key')).toBe('active_organization_id');
    expect(
      r.organizationOf('sys_api_key', { id: 'k1', active_organization_id: 'org_key' }),
    ).toBe('org_key');
    // A record carrying an `organization_id` VALUE anyway (defensive noise)
    // still stamps from the PLATFORM column, not the canonical spelling.
    expect(
      r.organizationOf('sys_api_key', { id: 'k1', organization_id: 'org_wrong', active_organization_id: 'org_key' }),
    ).toBe('org_key');
  });

  it('⛔ the stamp table is a closed set: the same shape under any other object name takes the ordinary limbs (#19054)', () => {
    // The control for the pin above. The engine-bound face is where limb 0 is
    // reached with an authoritative name, so this is where "closed set" has to
    // be stated: an object that is byte-identical to `sys_api_key` except for
    // its name gets no stamp column at all, and the caller falls back to the
    // acting context exactly as it does for every other unwalled object.
    const engine = engineOf({
      tenant_credential: {
        tenancy: { enabled: false },
        fields: { id: {}, name: {}, user_id: {}, active_organization_id: {}, revoked: {} },
      },
    });
    const r = createRecordOrganizationResolver(engine);
    expect(r.organizationFieldFor('tenant_credential')).toBeNull();
    expect(
      r.organizationOf('tenant_credential', { id: 'k1', active_organization_id: 'org_key' }),
    ).toBeNull();
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
