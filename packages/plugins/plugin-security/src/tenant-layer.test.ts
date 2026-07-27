// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Layer 0 — the organization wall — across all three tenancy postures
 * (ADR-0095 D1, widened by ADR-0105 D1/D2).
 *
 * The invariants under test are the ones the whole authorization kernel rests
 * on: the wall is computed independently of business RLS, composed FIRST, and
 * crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object.
 * ADR-0105 widens only the PREDICATE (equality → set membership under `group`);
 * every composition rule must be unchanged, in every posture.
 */

import { describe, it, expect } from 'vitest';

import { computeTenantLayer0Filter, andComposeLayers } from './tenant-layer.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

/** A plain tenant business object with a member caller — the common case. */
const base = {
  organizationId: 'org-a',
  accessibleOrgIds: ['org-a', 'org-b'],
  objectHasOrgIdField: true,
  tenancyDisabled: false,
  posturePermitsCrossTenant: false,
  isPlatformAdmin: false,
} as const;

describe('computeTenantLayer0Filter — posture spectrum (ADR-0105 D1/D2)', () => {
  describe('single', () => {
    it('is inert — no wall, whatever the context carries', () => {
      expect(computeTenantLayer0Filter({ ...base, tenancyPosture: 'single' })).toBeNull();
    });

    it('stays inert even with no active org and no memberships', () => {
      expect(
        computeTenantLayer0Filter({
          ...base,
          tenancyPosture: 'single',
          organizationId: undefined,
          accessibleOrgIds: [],
        }),
      ).toBeNull();
    });
  });

  describe('isolated (the hard wall — behavior unchanged)', () => {
    it('scopes to the ACTIVE organization, ignoring the wider membership set', () => {
      expect(computeTenantLayer0Filter({ ...base, tenancyPosture: 'isolated' })).toEqual({
        organization_id: 'org-a',
      });
    });

    it('fails closed with no active organization', () => {
      expect(
        computeTenantLayer0Filter({ ...base, tenancyPosture: 'isolated', organizationId: undefined }),
      ).toEqual(RLS_DENY_FILTER);
    });
  });

  describe('group (union / MOAC access)', () => {
    it('scopes to the caller\'s whole membership set, not the active org', () => {
      // The load-bearing difference: a group-HQ analyst reads every plant they
      // belong to on one screen, with no context switching (Oracle MOAC, the
      // pattern the ADR adopts over one-org-at-a-time responsibility switching).
      expect(computeTenantLayer0Filter({ ...base, tenancyPosture: 'group' })).toEqual({
        organization_id: { $in: ['org-a', 'org-b'] },
      });
    });

    it('does not widen past membership even when an org is active elsewhere', () => {
      expect(
        computeTenantLayer0Filter({
          ...base,
          tenancyPosture: 'group',
          organizationId: 'org-z',
          accessibleOrgIds: ['org-a'],
        }),
      ).toEqual({ organization_id: { $in: ['org-a'] } });
    });

    it('fails closed on an EMPTY access set (no membership, no reach)', () => {
      expect(
        computeTenantLayer0Filter({ ...base, tenancyPosture: 'group', accessibleOrgIds: [] }),
      ).toEqual(RLS_DENY_FILTER);
    });

    it('fails closed when the access set is ABSENT (context never resolved it)', () => {
      // A transport that forgets to carry `accessible_org_ids` must deny, not
      // fall back to the active org — silently degrading to equality would make
      // the wall depend on which surface the request arrived through.
      expect(
        computeTenantLayer0Filter({ ...base, tenancyPosture: 'group', accessibleOrgIds: undefined }),
      ).toEqual(RLS_DENY_FILTER);
    });

    it('copies the id set (a later mutation cannot reach the compiled filter)', () => {
      const orgIds = ['org-a'];
      const filter = computeTenantLayer0Filter({
        ...base,
        tenancyPosture: 'group',
        accessibleOrgIds: orgIds,
      });
      orgIds.push('org-victim');
      expect(filter).toEqual({ organization_id: { $in: ['org-a'] } });
    });
  });

  // W1/W2 (ADR-0095): the wall is not weakenable by business RLS, and the
  // superuser bit alone never crosses it. ADR-0105 D4 extends the SAME rule to
  // `group` — only a true PLATFORM_ADMIN on a posture-permitting object exits.
  describe('cross-wall exemption holds identically in group and isolated', () => {
    for (const tenancyPosture of ['group', 'isolated'] as const) {
      it(`${tenancyPosture}: a platform admin crosses on a posture-permitting object`, () => {
        expect(
          computeTenantLayer0Filter({
            ...base,
            tenancyPosture,
            isPlatformAdmin: true,
            posturePermitsCrossTenant: true,
          }),
        ).toBeNull();
      });

      it(`${tenancyPosture}: a TENANT admin (superuser bit, no platform rung) stays walled`, () => {
        // `isPlatformAdmin` already folds in the platform-exclusive capability
        // probe, so a tenant org_admin arrives here as false — finding F2 / #2937.
        const filter = computeTenantLayer0Filter({
          ...base,
          tenancyPosture,
          isPlatformAdmin: false,
          posturePermitsCrossTenant: true,
        });
        expect(filter).not.toBeNull();
      });

      it(`${tenancyPosture}: a platform admin stays walled on a PUBLIC business object`, () => {
        const filter = computeTenantLayer0Filter({
          ...base,
          tenancyPosture,
          isPlatformAdmin: true,
          posturePermitsCrossTenant: false,
        });
        expect(filter).not.toBeNull();
      });

      it(`${tenancyPosture}: contributes nothing on a tenancy-disabled object`, () => {
        expect(
          computeTenantLayer0Filter({ ...base, tenancyPosture, tenancyDisabled: true }),
        ).toBeNull();
      });

      it(`${tenancyPosture}: contributes nothing when the object has no organization_id`, () => {
        expect(
          computeTenantLayer0Filter({ ...base, tenancyPosture, objectHasOrgIdField: false }),
        ).toBeNull();
      });

      it(`${tenancyPosture}: assumes a tenant object when the field set is unresolved`, () => {
        const filter = computeTenantLayer0Filter({
          ...base,
          tenancyPosture,
          objectHasOrgIdField: undefined,
        });
        expect(filter).not.toBeNull();
      });
    }
  });
});

describe('andComposeLayers — Layer 0 is always outermost', () => {
  it('places the group union wall FIRST so a Layer 1 disjunction cannot widen it', () => {
    const layer0 = computeTenantLayer0Filter({ ...base, tenancyPosture: 'group' })!;
    const layer1 = { $or: [{ owner_id: 'u1' }, { public: true }] };
    expect(andComposeLayers(layer0, layer1)).toEqual({ $and: [layer0, layer1] });
  });

  it('passes either side through when the other contributes nothing', () => {
    expect(andComposeLayers(null, { owner_id: 'u1' })).toEqual({ owner_id: 'u1' });
    expect(andComposeLayers({ organization_id: 'org-a' }, null)).toEqual({ organization_id: 'org-a' });
    expect(andComposeLayers(null, null)).toBeNull();
  });
});
