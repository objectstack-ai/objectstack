// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Layer 0 verdict ladder (ADR-0095 D1 / ADR-0131 D8), rung by rung — in
 * particular the rung an external object reaches when it states no
 * organization scope under a walled posture (ADR-0015 §10): the wall DENIES,
 * it does not stand down.
 */

import { describe, it, expect } from 'vitest';
import { computeTenantLayer0Verdict, isOutsideEveryOrganization, type TenantLayer0Input } from './tenant-layer0-verdict.js';

const member = (over: Partial<TenantLayer0Input> = {}): TenantLayer0Input => ({
  tenancyPosture: 'isolated',
  organizationId: 'org-1',
  objectHasOrgIdField: true,
  tenancyDisabled: false,
  posturePermitsCrossTenant: false,
  isPlatformAdmin: false,
  ...over,
});

describe('computeTenantLayer0Verdict — an external object that states no organization scope', () => {
  it('under `isolated` the wall denies: no provable scope, no row', () => {
    expect(computeTenantLayer0Verdict(member({ externalOrganizationScopeUndeclared: true, objectHasOrgIdField: false })))
      .toEqual({ kind: 'deny' });
  });

  it('under `group` the wall denies too — the union predicate has no column to name', () => {
    expect(computeTenantLayer0Verdict(member({
      tenancyPosture: 'group', accessibleOrgIds: ['org-1', 'org-2'],
      externalOrganizationScopeUndeclared: true, objectHasOrgIdField: false,
    }))).toEqual({ kind: 'deny' });
  });

  it('the denial precedes the platform-admin crossing: an undeclared object is a configuration defect, not a posture', () => {
    expect(computeTenantLayer0Verdict(member({
      externalOrganizationScopeUndeclared: true, objectHasOrgIdField: false,
      isPlatformAdmin: true, posturePermitsCrossTenant: true,
    }))).toEqual({ kind: 'deny' });
  });

  it('a declared opt-out (`tenancy.enabled: false`) still contributes nothing — the object is shared by every organization', () => {
    expect(computeTenantLayer0Verdict(member({ tenancyDisabled: true, externalOrganizationScopeUndeclared: false, objectHasOrgIdField: false })))
      .toEqual({ kind: 'none' });
  });

  it('a declared `organization_id` keeps the wall', () => {
    expect(computeTenantLayer0Verdict(member({ externalOrganizationScopeUndeclared: false })))
      .toEqual({ kind: 'organization', organizationId: 'org-1' });
  });

  it('CONTROL: under `single` nothing is read — an undeclared object answers `none` like every other', () => {
    expect(computeTenantLayer0Verdict(member({ tenancyPosture: 'single', externalOrganizationScopeUndeclared: true, objectHasOrgIdField: false })))
      .toEqual({ kind: 'none' });
  });

  it('CONTROL: the flag omitted reads as every caller before it — a column-less object answers `none`', () => {
    expect(computeTenantLayer0Verdict(member({ objectHasOrgIdField: false }))).toEqual({ kind: 'none' });
  });
});

/**
 * [ADR-0093 D8.1, as amended] Under every tenancy posture, a person's data
 * access requires a current membership in the organization, judged on each
 * request. Under `single` that is the organization's one wall; the walled
 * postures already answered it and still do.
 */
describe('computeTenantLayer0Verdict — a person outside every organization (ADR-0093 D8.1, as amended)', () => {
  const single = (over: Partial<TenantLayer0Input> = {}) => member({ tenancyPosture: 'single', organizationId: undefined, ...over });

  it('under `single` a tenant object answers `deny`', () => {
    expect(computeTenantLayer0Verdict(single({ outsideEveryOrganization: true }))).toEqual({ kind: 'deny' });
    // An object whose columns are not resolved yet fails toward the wall, as everywhere.
    expect(computeTenantLayer0Verdict(single({ outsideEveryOrganization: true, objectHasOrgIdField: undefined }))).toEqual({ kind: 'deny' });
  });

  it('CONTROL: a current member under `single` meets no wall', () => {
    expect(computeTenantLayer0Verdict(single({ outsideEveryOrganization: false }))).toEqual({ kind: 'none' });
    expect(computeTenantLayer0Verdict(single())).toEqual({ kind: 'none' });
  });

  it('a non-tenant object stays outside the wall, as under every posture', () => {
    expect(computeTenantLayer0Verdict(single({ outsideEveryOrganization: true, tenancyDisabled: true }))).toEqual({ kind: 'none' });
    expect(computeTenantLayer0Verdict(single({ outsideEveryOrganization: true, objectHasOrgIdField: false }))).toEqual({ kind: 'none' });
  });

  it('the posture matrix answers the same: `isolated` and `group` deny the same person', () => {
    expect(computeTenantLayer0Verdict(member({ organizationId: undefined, accessibleOrgIds: [], outsideEveryOrganization: true }))).toEqual({ kind: 'deny' });
    expect(computeTenantLayer0Verdict(member({ tenancyPosture: 'group', organizationId: undefined, accessibleOrgIds: [], outsideEveryOrganization: true }))).toEqual({ kind: 'deny' });
  });
});

describe('isOutsideEveryOrganization — who the rule reads as outside', () => {
  const person = (over: Record<string, unknown> = {}) => ({ userId: 'u1', accessible_org_ids: [], posture: 'MEMBER', ...over });

  it('a person whose resolved membership set is empty is outside', () => {
    expect(isOutsideEveryOrganization(person())).toBe(true);
  });

  it('an organization claim beside an empty set is not a membership', () => {
    expect(isOutsideEveryOrganization(person({ tenantId: 'org-1' }))).toBe(true);
  });

  it('CONTROL: a current member is not outside', () => {
    expect(isOutsideEveryOrganization(person({ accessible_org_ids: ['org-1'] }))).toBe(false);
  });

  it('a system context, a platform operator and a caller with no principal are not judged as persons outside', () => {
    expect(isOutsideEveryOrganization(person({ isSystem: true }))).toBe(false);
    expect(isOutsideEveryOrganization(person({ posture: 'PLATFORM_ADMIN' }))).toBe(false);
    expect(isOutsideEveryOrganization(person({ userId: undefined }))).toBe(false);
    expect(isOutsideEveryOrganization(person({ userId: '' }))).toBe(false);
    expect(isOutsideEveryOrganization(undefined)).toBe(false);
  });

  it('an envelope that carries no membership set states nothing about membership', () => {
    expect(isOutsideEveryOrganization({ userId: 'u1' })).toBe(false);
  });
});
