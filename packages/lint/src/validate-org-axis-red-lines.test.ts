// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  validateOrgAxisRedLines,
  ORG_AXIS_PERMISSION_INHERITANCE,
  ORG_AXIS_CROSS_ORG_BU_GRANT,
} from './validate-org-axis-red-lines.js';

const rules = (stack: unknown) => validateOrgAxisRedLines(stack).map((f) => f.rule);

describe('validateOrgAxisRedLines — ① no permission inheritance on the org axis', () => {
  it('flags an RLS `using` on a permission set that walks the org parent', () => {
    const findings = validateOrgAxisRedLines({
      permissions: [
        {
          name: 'group_hq_reader',
          rowLevelSecurity: [
            {
              name: 'child_orgs',
              object: 'work_order',
              using: 'organization_id IN (current_user.parent_organization_id)',
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: ORG_AXIS_PERMISSION_INHERITANCE,
      path: 'permissions[0].rowLevelSecurity[0].using',
    });
    // The fix-it must point at membership, the mechanism that actually works.
    expect(findings[0].hint).toMatch(/accessible_org_ids/);
  });

  it('flags a `check` clause too (write-side inheritance is the same defect)', () => {
    expect(
      rules({
        permissions: [
          {
            name: 'p',
            rowLevelSecurity: [{ name: 'r', check: "parent_organization_id = 'org_hq'" }],
          },
        ],
      }),
    ).toEqual([ORG_AXIS_PERMISSION_INHERITANCE]);
  });

  it('flags an object-authored RLS policy', () => {
    const findings = validateOrgAxisRedLines({
      objects: [
        {
          name: 'work_order',
          rowLevelSecurity: [{ name: 'rollup', using: 'parent_organization_id = current_user.organization_id' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].rowLevelSecurity[0].using');
  });

  it('flags a sharing rule whose criteria walk the org parent', () => {
    expect(
      rules({
        sharingRules: [
          { name: 'hq_rollup', object: 'work_order', criteria: { parent_organization_id: 'org_hq' } },
        ],
      }),
    ).toEqual([ORG_AXIS_PERMISSION_INHERITANCE]);
  });

  it('stays silent on membership-based and business-unit scoping (the sanctioned paths)', () => {
    expect(
      rules({
        permissions: [
          {
            name: 'plant_reader',
            rowLevelSecurity: [
              // ADR-0105 D2 — the engine's own union wall vocabulary.
              { name: 'my_orgs', using: 'organization_id IN (current_user.accessible_org_ids)' },
              // Intra-org hierarchy — the business-unit tree, not the org tree.
              { name: 'my_unit', using: 'business_unit_id IN (current_user.unit_ids)' },
              { name: 'mine', using: 'owner_id = current_user.id' },
            ],
          },
        ],
        sharingRules: [
          { name: 'plant_team', object: 'work_order', sharedTo: { type: 'business_unit', id: 'bu_plant_a' } },
        ],
        objects: [{ name: 'work_order' }],
      }),
    ).toEqual([]);
  });
});

describe('validateOrgAxisRedLines — ② business-unit trees stay org-internal', () => {
  const platformGlobalStack = (tenancy: unknown) => ({
    objects: [{ name: 'material_catalog', tenancy }],
    sharingRules: [
      {
        name: 'catalog_to_plant',
        object: 'material_catalog',
        sharedTo: { type: 'business_unit', id: 'bu_plant_a' },
      },
    ],
  });

  it('flags a business-unit grant on a `tenancy.enabled: false` object', () => {
    const findings = validateOrgAxisRedLines(platformGlobalStack({ enabled: false }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: ORG_AXIS_CROSS_ORG_BU_GRANT,
      path: 'sharingRules[0].sharedTo',
    });
    expect(findings[0].message).toMatch(/spans EVERY organization/);
  });

  it('flags the `systemFields.tenant: false` spelling of the same opt-out', () => {
    expect(
      rules({
        objects: [{ name: 'material_catalog', systemFields: { tenant: false } }],
        sharingRules: [
          { name: 'r', object: 'material_catalog', sharedTo: { type: 'business_unit', id: 'bu' } },
        ],
      }),
    ).toEqual([ORG_AXIS_CROSS_ORG_BU_GRANT]);
  });

  it('allows a business-unit grant on an ORG-SCOPED object (the normal case)', () => {
    expect(rules(platformGlobalStack({ enabled: true }))).toEqual([]);
    expect(rules(platformGlobalStack(undefined))).toEqual([]);
  });

  it('allows a non-BU audience on a platform-global object', () => {
    expect(
      rules({
        objects: [{ name: 'material_catalog', tenancy: { enabled: false } }],
        sharingRules: [
          { name: 'r', object: 'material_catalog', sharedTo: { type: 'position', name: 'buyer' } },
        ],
      }),
    ).toEqual([]);
  });
});

describe('validateOrgAxisRedLines — input tolerance', () => {
  it('returns no findings for empty / malformed input instead of throwing', () => {
    expect(validateOrgAxisRedLines(undefined)).toEqual([]);
    expect(validateOrgAxisRedLines({})).toEqual([]);
    expect(validateOrgAxisRedLines({ permissions: 'nonsense', objects: 42 })).toEqual([]);
  });

  it('accepts the name-keyed map shape as well as arrays', () => {
    expect(
      rules({
        permissions: {
          group_hq: { rowLevelSecurity: [{ name: 'r', using: 'parent_organization_id = 1' }] },
        },
      }),
    ).toEqual([ORG_AXIS_PERMISSION_INHERITANCE]);
  });
});
