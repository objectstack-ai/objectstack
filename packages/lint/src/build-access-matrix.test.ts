// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D6 — access-matrix snapshot: pure build + semantic diff.

import { describe, it, expect } from 'vitest';
import { buildAccessMatrix, diffAccessMatrix } from './build-access-matrix.js';

const STACK = {
  objects: [
    { name: 'crm_lead', sharingModel: 'private' },
    { name: 'crm_account', sharingModel: 'public_read' },
  ],
  permissions: [
    {
      name: 'sales_user',
      objects: {
        crm_lead: { allowRead: true, allowCreate: true, allowEdit: true, readScope: 'unit' },
        crm_account: { allowRead: true },
      },
    },
    {
      name: 'crm_admin',
      objects: {
        crm_lead: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true },
      },
    },
  ],
};

describe('buildAccessMatrix (ADR-0090 D6)', () => {
  it('derives one sorted row per (set × object) with OWD context', () => {
    const m = buildAccessMatrix(STACK);
    expect(m.version).toBe(1);
    expect(m.entries.map((e) => `${e.permissionSet}/${e.object}`)).toEqual([
      'crm_admin/crm_lead',
      'sales_user/crm_account',
      'sales_user/crm_lead',
    ]);
    const lead = m.entries.find((e) => e.permissionSet === 'sales_user' && e.object === 'crm_lead')!;
    expect(lead).toMatchObject({ create: true, read: true, edit: true, delete: false, readScope: 'unit', sharingModel: 'private' });
    // VAMA implies the read bit even without allowRead.
    const admin = m.entries.find((e) => e.permissionSet === 'crm_admin')!;
    expect(admin.viewAllRecords).toBe(true);
    expect(admin.read).toBe(true);
  });

  it('is deterministic (same input → identical JSON)', () => {
    expect(JSON.stringify(buildAccessMatrix(STACK))).toBe(JSON.stringify(buildAccessMatrix(STACK)));
  });
});

describe('diffAccessMatrix (semantic review lines)', () => {
  it('identical matrices produce no lines', () => {
    expect(diffAccessMatrix(buildAccessMatrix(STACK), buildAccessMatrix(STACK))).toEqual([]);
  });

  it('reports gained bits by name — the crm_admin-gains-delete shape', () => {
    const before = buildAccessMatrix(STACK);
    const after = buildAccessMatrix(JSON.parse(JSON.stringify(STACK)));
    const sales = (after.entries as any[]).find((e) => e.permissionSet === 'sales_user' && e.object === 'crm_lead');
    sales.delete = true;
    const lines = diffAccessMatrix(before, after);
    expect(lines).toEqual(["'sales_user' gains delete on 'crm_lead'"]);
  });

  it('reports depth changes, entry additions/removals, and OWD swings', () => {
    const before = buildAccessMatrix(STACK);
    const mutated = JSON.parse(JSON.stringify(STACK));
    mutated.permissions[0].objects.crm_lead.readScope = 'org';       // depth widened
    delete mutated.permissions[0].objects.crm_account;                // entry removed
    mutated.permissions[1].objects.crm_account = { allowRead: true }; // entry added
    mutated.objects[0].sharingModel = 'public_read_write';            // OWD swing
    const lines = diffAccessMatrix(before, buildAccessMatrix(mutated));
    expect(lines.some((l) => l.includes("read depth on 'crm_lead': unit → org"))).toBe(true);
    expect(lines.some((l) => l.includes("'sales_user' loses ALL access to 'crm_account'"))).toBe(true);
    expect(lines.some((l) => l.includes("'crm_admin' gains access to 'crm_account'"))).toBe(true);
    expect(lines.some((l) => l.includes('record baseline (OWD): private → public_read_write'))).toBe(true);
  });
});
