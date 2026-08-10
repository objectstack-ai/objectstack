// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5262 — `SchemaRegistry`'s env-derived multi-tenant default reads the
// AUTHORITATIVE tenancy posture, never the demoted `OS_MULTI_ORG_ENABLED`.
//
// ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
// `OS_MULTI_ORG_ENABLED` to a back-compat INPUT of `resolveTenancyPosture()`.
// The registry kept calling `resolveMultiOrgEnabled()`, so a deployment
// configured the documented way — the posture knob and nothing else — built its
// schemas as single-tenant while SecurityPlugin, reading the posture, compiled a
// Layer 0 wall that filters EVERY read by `organization_id`. Two layers, one
// fact, two answers. Third recurrence of the shape (cloud#1020, #5233).
//
// What actually diverges is the INDEX: since the column/flag decoupling the
// `organization_id` column is provisioned unconditionally, and `multiTenant`
// governs only whether it is indexed. So the defect is not a missing column —
// it is the wall's hottest predicate running unindexed on every posture-only
// deployment. That is the fact these tests pin, deliberately and narrowly,
// rather than the broader "columns go missing" reading.
//
// [#6810] WHERE that index is declared moved, and these assertions moved with
// it: from a field-level `organization_id.indexed` boolean to an entry in the
// object's `indexes[]`. The boolean was never a `FieldSchema` key (#2377 /
// ADR-0049) and only `driver-mongodb` ever read it, so what #5262 pinned as
// "the index" was in truth a flag that built nothing on the SQL drivers every
// walled deployment runs. Reading `indexes[]` is the first spelling of this
// fact a driver actually materializes — and `multiTenant: false` now says
// "no index declared" rather than "an index declared false". The posture logic
// under test is untouched; only the surface the answer is read off.
//
// Driven through the REAL `SchemaRegistry` constructor + `registerObject`
// pipeline, reading the stored definition back out — the same path the kernel
// takes at boot. Nothing about the resolver is stubbed: the tests set the real
// environment variables and let the real `resolveTenancyPosture()` fold them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchemaRegistry } from './registry';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;

/**
 * Configure the deployment's tenancy env exactly as an operator would, then
 * register a plain business object through the real registry and hand back the
 * stored definition. `undefined` means "leave the variable UNSET" — which is
 * the whole point of the regression: a posture-only deployment sets one knob.
 */
const registerUnder = (env: { posture?: string; legacy?: string }) => {
  if (env.posture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = env.posture;
  if (env.legacy === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = env.legacy;

  // No `multiTenant` option — this is the env-derived default under test.
  const registry = new SchemaRegistry();
  registry.registerObject(
    { name: 'lead', fields: { first_name: { type: 'text' } } } as any,
    'crm',
    'crm',
    'own',
  );
  return (registry as any).objectContributors.get('lead')[0].definition;
};

/**
 * [#6810] Is the tenant index declared on the object this posture produced?
 *
 * The `indexes[]` entry the drivers materialize — the successor to the
 * field-level `indexed` boolean these tests used to read.
 */
const indexesTenantColumn = (stored: any): boolean =>
  (stored.indexes ?? []).some(
    (i: any) => Array.isArray(i?.fields) && i.fields.length === 1 && i.fields[0] === 'organization_id',
  );

beforeEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_MULTI_ORG_ENABLED;
});
afterEach(() => {
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
});

describe('#5262 — SchemaRegistry keys its multi-tenant default off OS_TENANCY_POSTURE', () => {
  it('posture-only deployment (OS_TENANCY_POSTURE=isolated, legacy boolean UNSET) indexes organization_id', () => {
    // THE regression. Configured exactly as the v17 docs say: the authoritative
    // knob and nothing else. Before the fix `resolveMultiOrgEnabled()` returned
    // false here and the column landed UNINDEXED on a fully walled deployment.
    const stored = registerUnder({ posture: 'isolated' });

    expect(stored.fields.organization_id).toBeDefined();
    expect(stored.fields.organization_id.reference).toBe('sys_organization');
    expect(indexesTenantColumn(stored)).toBe(true);
  });

  it('`group` is a walled posture too — not just `isolated`', () => {
    // The registry asks `postureEnforcesWall`, the spec's own vocabulary,
    // instead of comparing against `'isolated'`. `group` walls organizations
    // just as much (ADR-0105 D1); it only widens READ scope to the membership
    // set, and `organization_id IN (...)` needs the index every bit as much as
    // `organization_id = ?` does.
    expect(indexesTenantColumn(registerUnder({ posture: 'group' }))).toBe(true);
  });

  it('legacy-boolean-only deployment keeps working — back-compat via the posture resolver', () => {
    // Nothing already deployed changes behaviour: `resolveTenancyPosture()`
    // falls back to `OS_MULTI_ORG_ENABLED` when the posture knob is unset, so
    // the pre-ADR-0105 configuration still resolves to `isolated`.
    expect(indexesTenantColumn(registerUnder({ legacy: 'true' }))).toBe(true);
  });

  it('single-org deployments still leave the column unindexed', () => {
    // Intent unchanged — only the knob is corrected. Nothing filters by
    // organization on an unwalled stack, so the index would be dead weight.
    expect(indexesTenantColumn(registerUnder({ posture: 'single' }))).toBe(false);
    expect(indexesTenantColumn(registerUnder({ legacy: 'false' }))).toBe(false);
    expect(indexesTenantColumn(registerUnder({}))).toBe(false);
  });

  it('an explicit legacy `false` does not veto the authoritative posture', () => {
    // The precise inversion the demotion created: the canonical knob asks for a
    // wall, the superseded one says "no multi-org". The canonical knob wins —
    // otherwise the legacy flag would still be authoritative in disguise.
    expect(indexesTenantColumn(registerUnder({ posture: 'isolated', legacy: 'false' }))).toBe(true);
  });

  it('an explicit `multiTenant` option still overrides the env entirely', () => {
    // The option is how embedders and the bulk of this package's own suite pin
    // a mode; the posture read is only the DEFAULT when they say nothing.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.registerObject({ name: 'lead', fields: {} }, 'crm', 'crm', 'own');
    const stored = (registry as any).objectContributors.get('lead')[0].definition;
    expect(indexesTenantColumn(stored)).toBe(false);
    expect(stored.fields.organization_id).toBeDefined();
  });

  it('the column itself is provisioned either way — only the index moves', () => {
    // Guards the claim this file is scoped on. If a future change makes the
    // COLUMN conditional again, the blast radius of a posture misread grows
    // from "slow" to "the wall has nothing to filter on", and this fails.
    expect(registerUnder({ posture: 'isolated' }).fields.organization_id).toBeDefined();
    expect(registerUnder({ posture: 'single' }).fields.organization_id).toBeDefined();
  });
});
