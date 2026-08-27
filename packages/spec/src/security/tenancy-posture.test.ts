// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12699] `OrgScopingEntitlement` — the per-deployment wall-shaping contract.
 *
 * The interface is consumed structurally off a LIVE service object
 * (`getService('org-scoping')`), so these cases pin the runtime twin the
 * consumers validate with: what a well-formed declaration looks like, what
 * junk must be refused, and that a service instance's unrelated machinery
 * (name/version/init/...) never disqualifies its declaration.
 */

import { describe, it, expect } from 'vitest';
import {
  OrgScopingEntitlementSchema,
  PlatformGlobalObjectsSchema,
  normalizeTenancyPosture,
  type OrgScopingEntitlement,
} from './tenancy-posture';

describe('[#12699] PlatformGlobalObjectsSchema', () => {
  it('accepts exact object machine names', () => {
    const parsed = PlatformGlobalObjectsSchema.safeParse([
      'sys_setting',
      'sys_job_queue',
      'cloud_capability',
      '_private_ledger',
    ]);
    expect(parsed.success).toBe(true);
  });

  it('accepts the empty list (an explicit "no exemptions")', () => {
    expect(PlatformGlobalObjectsSchema.safeParse([]).success).toBe(true);
  });

  it.each([
    ['a bare string', 'sys_setting'],
    ['a wildcard entry', ['sys_setting', '*']],
    ['a glob-shaped entry', ['sys_*']],
    ['an empty-string entry', ['']],
    ['a non-string entry', ['sys_setting', 42]],
    ['an uppercase name', ['SysSetting']],
    ['a number', 42],
    ['an object', { objects: ['sys_setting'] }],
  ])('refuses %s', (_label, value) => {
    expect(PlatformGlobalObjectsSchema.safeParse(value).success).toBe(false);
  });
});

describe('[#12699] OrgScopingEntitlementSchema', () => {
  it('accepts a full declaration', () => {
    const declaration: OrgScopingEntitlement = {
      supportedPostures: ['isolated'],
      platformGlobalObjects: ['sys_setting', 'sys_job'],
      suppressUnboundedOrgAdminGrant: true,
    };
    expect(OrgScopingEntitlementSchema.safeParse(declaration).success).toBe(true);
  });

  it('accepts the empty declaration (every key optional — the pre-seam runtime)', () => {
    expect(OrgScopingEntitlementSchema.safeParse({}).success).toBe(true);
  });

  it('tolerates a live service object carrying unrelated machinery (non-strict by design)', () => {
    const serviceShaped = {
      name: 'com.example.org-scoping',
      version: '1.0.0',
      init: () => undefined,
      supportedPostures: ['group', 'isolated'],
      platformGlobalObjects: ['sys_setting'],
    };
    const parsed = OrgScopingEntitlementSchema.safeParse(serviceShaped);
    expect(parsed.success).toBe(true);
    // ...and the parse yields only the declaration, machinery stripped.
    expect(parsed.success && parsed.data).toEqual({
      supportedPostures: ['group', 'isolated'],
      platformGlobalObjects: ['sys_setting'],
    });
  });

  it.each([
    ['junk platformGlobalObjects', { platformGlobalObjects: 'sys_setting' }],
    ['junk suppress flag', { suppressUnboundedOrgAdminGrant: 'yes' }],
    ['junk posture entry', { supportedPostures: ['isolated', 'multi'] }],
  ])('refuses %s', (_label, value) => {
    expect(OrgScopingEntitlementSchema.safeParse(value).success).toBe(false);
  });

  it('the schema and the interface agree (compile-time parity witness)', () => {
    // Assignability both ways, checked by tsc when this file typechecks.
    const fromSchema = OrgScopingEntitlementSchema.parse({
      supportedPostures: ['isolated'],
      platformGlobalObjects: ['sys_setting'],
      suppressUnboundedOrgAdminGrant: true,
    });
    const asInterface: OrgScopingEntitlement = fromSchema;
    expect(asInterface.suppressUnboundedOrgAdminGrant).toBe(true);
  });
});

describe('normalizeTenancyPosture (pre-existing seam, exercised alongside)', () => {
  it('maps the legacy `multi` spelling to `isolated`', () => {
    expect(normalizeTenancyPosture('multi')).toBe('isolated');
  });
  it('returns undefined for junk rather than a weaker posture', () => {
    expect(normalizeTenancyPosture('everything')).toBeUndefined();
  });
});
