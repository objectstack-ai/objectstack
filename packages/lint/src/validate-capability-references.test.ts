// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateCapabilityReferences,
  CAPABILITY_REFERENCE_UNKNOWN,
} from './validate-capability-references';

describe('validateCapabilityReferences (ADR-0066 ⑨)', () => {
  it('passes a reference to a built-in platform capability', () => {
    const findings = validateCapabilityReferences({
      objects: [{ name: 'sys_license', requiredPermissions: ['manage_platform_settings'] }],
    });
    expect(findings).toEqual([]);
  });

  it('passes a reference to a capability the stack DECLARES via defineCapability', () => {
    const findings = validateCapabilityReferences({
      capabilities: [{ name: 'export_data', label: 'Export Data', scope: 'org' }],
      objects: [{ name: 'inv_invoice', requiredPermissions: ['export_data'] }],
    });
    expect(findings).toEqual([]);
  });

  it('passes a reference to a capability the stack grants via systemPermissions', () => {
    const findings = validateCapabilityReferences({
      permissions: [{ name: 'billing_admin', systemPermissions: ['manage_billing'] }],
      objects: [{ name: 'inv_invoice', requiredPermissions: ['manage_billing'] }],
    });
    expect(findings).toEqual([]);
  });

  it('passes a reference to a capability shipped as a sys_capability seed row', () => {
    const findings = validateCapabilityReferences({
      data: [{ object: 'sys_capability', records: [{ name: 'approve_invoice' }] }],
      objects: [{ name: 'inv_invoice', requiredPermissions: ['approve_invoice'] }],
    });
    expect(findings).toEqual([]);
  });

  it('warns on an object requiredPermissions typo (registered nowhere)', () => {
    const findings = validateCapabilityReferences({
      objects: [{ name: 'sys_license', requiredPermissions: ['mange_users'] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: CAPABILITY_REFERENCE_UNKNOWN,
      where: 'object "sys_license"',
      path: 'objects[0].requiredPermissions',
    });
    expect(findings[0].message).toContain('mange_users');
  });

  it('warns per operation for the per-operation map form (ADR-0066 ⑤) and points at the slice', () => {
    const findings = validateCapabilityReferences({
      objects: [{
        name: 'inv_invoice',
        requiredPermissions: { read: ['manage_metadata'], update: ['mange_invoices'] },
      }],
    });
    // `manage_metadata` is built-in → ok; only the `update` typo warns.
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: 'objects[0].requiredPermissions.update' });
    expect(findings[0].message).toContain('mange_invoices');
  });

  it('warns on field, action, and app references', () => {
    const findings = validateCapabilityReferences({
      objects: [{
        name: 'hr_employee',
        fields: { salary: { type: 'currency', requiredPermissions: ['view_salaryy'] } },
        actions: [{ name: 'promote', requiredPermissions: ['approve_promo'] }],
      }],
      apps: [{
        name: 'hr',
        requiredPermissions: ['hr_admin'],
        navigation: [{ type: 'object', objectName: 'hr_employee', requiredPermissions: ['hr_nav_cap'] }],
      }],
      actions: [{ name: 'run_payroll', requiredPermissions: ['run_payroll_cap'] }],
    });
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual([
      'actions[0].requiredPermissions',
      'apps[0].navigation[0].requiredPermissions',
      'apps[0].requiredPermissions',
      'objects[0].actions[0].requiredPermissions',
      'objects[0].fields.salary.requiredPermissions',
    ]);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  // [#22639] The `/meta` read gate serves a list view or a dashboard only to a
  // caller holding EVERY capability its `requiredPermissions` names, so a typo
  // there hides it from everyone. Every door the key is declared at resolves.
  describe('list views and dashboards — the audience gate the /meta read gate enforces', () => {
    const GRANTED = { permissions: [{ name: 'clm_legal', systemPermissions: ['clm_legal_workbench.view'] }] };

    it('warns on a typo at every list view and dashboard position, each at its own path', () => {
      const findings = validateCapabilityReferences({
        ...GRANTED,
        objects: [{
          name: 'clm_contract',
          listViews: {
            mine: { type: 'grid', columns: ['name'] },
            legal: { type: 'grid', columns: ['name'], requiredPermissions: ['clm_legal_workbnch.view'] },
          },
        }],
        views: [
          {
            object: 'clm_contract',
            list: { type: 'grid', columns: ['name'], requiredPermissions: ['clm_legl_workbench.view'] },
            listViews: { queue: { type: 'grid', columns: ['name'], requiredPermissions: ['clm_queue.view'] } },
          },
          {
            name: 'clm_contract.saved', object: 'clm_contract', viewKind: 'list',
            config: { type: 'grid', columns: ['name'], requiredPermissions: ['clm_saved.view'] },
          },
          { name: 'clm_contract.overlay', object: 'clm_contract', viewKind: 'list', type: 'grid', requiredPermissions: ['clm_overlay.view'] },
        ],
        dashboards: [{ name: 'legal_board', label: 'Legal', widgets: [], requiredPermissions: ['clm_board.view'] }],
      });
      const byPath = (a: string[], b: string[]) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
      expect(findings.map((f) => [f.where, f.path]).sort(byPath)).toEqual([
        ['dashboard "legal_board"', 'dashboards[0].requiredPermissions'],
        ['list view "clm_contract.legal"', 'objects[0].listViews.legal.requiredPermissions'],
        ['list view "clm_contract"', 'views[0].list.requiredPermissions'],
        ['list view "clm_contract.queue"', 'views[0].listViews.queue.requiredPermissions'],
        ['view "clm_contract.saved"', 'views[1].config.requiredPermissions'],
        ['view "clm_contract.overlay"', 'views[2].requiredPermissions'],
      ]);
      expect(findings.every((f) => f.rule === CAPABILITY_REFERENCE_UNKNOWN && f.severity === 'warning')).toBe(true);
    });

    it('passes a granted capability at every one of those positions — the lit control is a stack that still warns', () => {
      const gate = ['clm_legal_workbench.view'];
      const findings = validateCapabilityReferences({
        ...GRANTED,
        objects: [{ name: 'clm_contract', listViews: { legal: { type: 'grid', requiredPermissions: gate } } }],
        views: [
          { object: 'clm_contract', list: { type: 'grid', requiredPermissions: gate }, listViews: { q: { requiredPermissions: gate } } },
          { name: 'clm_contract.saved', viewKind: 'list', config: { requiredPermissions: gate } },
          { name: 'clm_contract.overlay', viewKind: 'list', requiredPermissions: gate },
        ],
        dashboards: [
          { name: 'legal_board', requiredPermissions: gate },
          // Lit control: the one unresolved reference in this stack.
          { name: 'ops_board', requiredPermissions: ['ops_bord.view'] },
        ],
      });
      expect(findings.map((f) => f.path)).toEqual(['dashboards[1].requiredPermissions']);
    });

    it('a view or a dashboard with no requiredPermissions resolves nothing', () => {
      expect(validateCapabilityReferences({
        views: [{ object: 'clm_contract', list: { type: 'grid' }, listViews: { all: { type: 'grid' } } }],
        dashboards: [{ name: 'ops', widgets: [] }],
      })).toEqual([]);
    });
  });

  it('does NOT flag systemPermissions itself (the declaration side)', () => {
    // A package introduces a new capability by GRANTING it — never a warning.
    const findings = validateCapabilityReferences({
      permissions: [{ name: 'p', systemPermissions: ['brand_new_capability'] }],
    });
    expect(findings).toEqual([]);
  });

  it('tolerates junk / empty input', () => {
    expect(validateCapabilityReferences({})).toEqual([]);
    expect(validateCapabilityReferences(undefined as unknown as Record<string, unknown>)).toEqual([]);
    expect(validateCapabilityReferences({ objects: [null, 42, { name: 'x' }] as unknown })).toEqual([]);
  });
});
