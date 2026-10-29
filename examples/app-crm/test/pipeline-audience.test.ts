// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27735] The Pipeline dashboard's audience gate, as the stack ships it.
 *
 * The server judges these declarations: the dashboard read by name refuses a
 * caller missing any `requiredPermissions` entry (`audience-permission`), and
 * the app's navigation drops an entry whose `requiredPermissions` the caller
 * does not hold. Both compare against the union of the caller's sets'
 * `systemPermissions`. This example does not depend on the REST package, so
 * the gate itself is not run here; what is pinned is every input it reads,
 * read off the parsed stack rather than the source constants:
 *
 * - the dashboard and its nav entry require the same, non-empty list;
 * - every required capability is declared on the stack (`scope: 'org'`) and
 *   granted by exactly the CRM sets that read `crm_opportunity`, the object
 *   behind `opportunity_metrics` — never a gate nobody holds;
 * - those sets reach people through the CRM positions, and no other set
 *   (a plain member's) grants it.
 */

import { describe, expect, it } from 'vitest';
import stack from '../objectstack.config.js';

type NavEntry = { id?: string; type?: string; dashboardName?: string; requiredPermissions?: string[]; children?: NavEntry[] };

function findNav(entries: NavEntry[] | undefined, id: string): NavEntry | undefined {
  for (const entry of entries ?? []) {
    if (entry.id === id) return entry;
    const hit = findNav(entry.children, id);
    if (hit) return hit;
  }
  return undefined;
}

const dashboard = (stack.dashboards ?? []).find((d) => d.name === 'pipeline_dashboard');
const app = (stack.apps ?? []).find((a) => a.name === 'crm_app');
const navEntry = findNav(app?.navigation as NavEntry[] | undefined, 'nav_pipeline_dashboard');
const sets = (stack.permissions ?? []) as Array<{ name: string; systemPermissions?: string[]; objects?: Record<string, { allowRead?: boolean }> }>;
const required = dashboard?.requiredPermissions ?? [];

describe('Pipeline dashboard audience (#27735)', () => {
  it('the dashboard and its nav entry require the same capability list', () => {
    expect(dashboard).toBeDefined();
    expect(navEntry).toMatchObject({ type: 'dashboard', dashboardName: 'pipeline_dashboard' });
    expect(required).toEqual(['crm.view_pipeline']);
    expect(navEntry!.requiredPermissions).toEqual(required);
  });

  it('every required capability is declared on the stack, scoped to the organization', () => {
    const declared = new Map((stack.capabilities ?? []).map((c) => [c.name, c]));
    for (const cap of required) {
      expect(declared.get(cap)).toMatchObject({ name: cap, scope: 'org' });
    }
  });

  it('is granted by exactly the sets that read the opportunities its widgets aggregate', () => {
    const readers = sets.filter((s) => s.objects?.crm_opportunity?.allowRead === true).map((s) => s.name).sort();
    expect(readers).toEqual(['crm_sales_user']);
    for (const cap of required) {
      const holders = sets.filter((s) => (s.systemPermissions ?? []).includes(cap)).map((s) => s.name).sort();
      expect(holders).toEqual(readers);
    }
  });

  it('reaches sales users through the CRM positions and no other set', () => {
    const distributed = (stack.positions ?? [])
      .filter((p) => (p.permissionSets ?? []).includes('crm_sales_user'))
      .map((p) => p.name)
      .sort();
    expect(distributed).toEqual(['finance_approver', 'sales_manager', 'sales_rep']);
    // A member without a sales position holds none of the stack's other sets'
    // system permissions toward this gate.
    const others = sets.filter((s) => s.name !== 'crm_sales_user');
    expect(others.map((s) => s.name)).toEqual(['guest_portal']);
    for (const s of others) {
      expect((s.systemPermissions ?? []).filter((cap) => required.includes(cap))).toEqual([]);
    }
  });
});
