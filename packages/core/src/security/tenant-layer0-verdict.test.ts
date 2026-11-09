// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Layer 0 verdict ladder (ADR-0095 D1 / ADR-0131 D8), rung by rung — in
 * particular the rung an external object reaches when it states no
 * organization scope under a walled posture (ADR-0015 §10): the wall DENIES,
 * it does not stand down.
 */

import { describe, it, expect } from 'vitest';
import { computeTenantLayer0Verdict, type TenantLayer0Input } from './tenant-layer0-verdict.js';

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
