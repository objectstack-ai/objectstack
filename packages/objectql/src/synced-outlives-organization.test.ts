// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4] `managedBy: 'synced'` does NOT outlive its organization.
 *
 * Synced rows are business records the organization owns, so the ruling of
 * record on organization delete (letter B) stands as it is: an organization
 * that still owns them is refused, and nothing is exempted from either
 * refusal. The bucket joins the write guards, never this exemption.
 */
import { describe, expect, it } from 'vitest';
import { CascadePlanningFacet as ObjectQL } from './engine-cascade-planning.js';

describe("outlivesOrganization (engine-cascade-planning) — 'synced' is not exempt", () => {
  it('a synced object does not outlive the organization, and keeps no organization reference', () => {
    const copy = { name: 'erp_order_copy', managedBy: 'synced', fields: {} } as any;
    expect(ObjectQL.outlivesOrganization(copy)).toBe(false);
    expect(ObjectQL.keepsOrganizationReference(copy, 'parent_org_id')).toBe(false);
  });

  it('twins: the two exempt buckets still outlive it', () => {
    for (const managedBy of ['append-only', 'engine-owned']) {
      expect(ObjectQL.outlivesOrganization({ name: 'x', managedBy, fields: {} } as any), managedBy).toBe(true);
    }
  });
});
