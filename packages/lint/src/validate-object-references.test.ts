// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateObjectReferences,
  OBJECT_REFERENCE_UNKNOWN,
  OBJECT_REFERENCE_UNREGISTERED_PLATFORM,
} from './validate-object-references.js';

/** Minimal stack with one own object, mirroring the HotCRM shape. */
const baseStack = () => ({
  objects: [
    { name: 'crm_lead', fields: { name: { type: 'text' }, status: { type: 'text' } } },
    { name: 'crm_account', fields: { name: { type: 'text' } } },
  ],
});

describe('validateObjectReferences — action params', () => {
  // The literal HotCRM instance: a bulk-action lookup pointing at `user`
  // instead of the platform object `sys_user`.
  it('errors on a bulk-action lookup param referencing `user`', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [
        {
          name: 'mass_reassign',
          params: [{ name: 'owner', type: 'lookup', reference: 'user' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNKNOWN);
    expect(findings[0].path).toBe('actions[0].params[0].reference');
    expect(findings[0].message).toContain('"user"');
    // The fix-it must name the real platform object, since that is the actual mistake.
    expect(findings[0].hint).toContain('sys_user');
  });

  it('accepts a lookup param referencing a real platform object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [
        { name: 'mass_reassign', params: [{ name: 'owner', type: 'lookup', reference: 'sys_user' }] },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('accepts a lookup param referencing an own object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [
        { name: 'link', params: [{ name: 'account', type: 'lookup', reference: 'crm_account' }] },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('errors on an unknown objectOverride', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [{ name: 'a', params: [{ field: 'role', objectOverride: 'member' }] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('actions[0].params[0].objectOverride');
  });

  it('checks object-embedded actions too', () => {
    const stack = baseStack();
    (stack.objects[0] as Record<string, unknown>).actions = [
      { name: 'convert', params: [{ name: 'target', type: 'lookup', reference: 'accounts' }] },
    ];
    const findings = validateObjectReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].actions[0].params[0].reference');
    // `accounts` is one edit away from `crm_account`? No — but the suggester
    // should stay quiet rather than offer a bad guess.
    expect(findings[0].severity).toBe('error');
  });
});

describe('validateObjectReferences — dashboard global filters', () => {
  // The other HotCRM `object: 'user'` instance.
  it('errors on optionsFrom.object naming a nonexistent object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      dashboards: [
        {
          name: 'sales_overview',
          globalFilters: [
            { name: 'owner', optionsFrom: { object: 'user', valueField: 'id', labelField: 'name' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('dashboards[0].globalFilters[0].optionsFrom.object');
  });

  it('accepts optionsFrom.object naming an own object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      dashboards: [
        { name: 'd', globalFilters: [{ name: 'acct', optionsFrom: { object: 'crm_account' } }] },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('validateObjectReferences — ADR-0021 dataset base object (#14105)', () => {
  // The measured row 6: `object: 'duly_tsk'` where the object is `duly_task`.
  // On published 17.2.0 this exited 0 with "Validation passed", and `build`
  // wrote the dangling dataset into `dist/objectstack.json`.
  it('errors on a dataset over an object that does not exist', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      datasets: [
        {
          name: 'lead_metrics',
          object: 'crm_led',
          dimensions: [{ name: 'status', field: 'status' }],
          measures: [{ name: 'n', aggregate: 'count' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNKNOWN);
    expect(findings[0].path).toBe('datasets[0].object');
    expect(findings[0].where).toBe('dataset "lead_metrics"');
    expect(findings[0].message).toContain('Did you mean "crm_lead"?');
  });

  it('accepts a dataset over an own object', () => {
    expect(
      validateObjectReferences({
        ...baseStack(),
        datasets: [{ name: 'lead_metrics', object: 'crm_lead', dimensions: [], measures: [] }],
      }),
    ).toEqual([]);
  });

  it('accepts the platform datasets this stack cannot see (rung ③)', () => {
    // `system.datasets.ts` ships five of these. A local "not in this stack ⇒
    // error" check would have reported every one; the curated registry is the
    // whole reason this site lives on this rule.
    expect(
      validateObjectReferences({
        ...baseStack(),
        datasets: [
          { name: 'sys_user_metrics', object: 'sys_user', dimensions: [], measures: [] },
          { name: 'sys_organization_metrics', object: 'sys_organization', dimensions: [], measures: [] },
          { name: 'sys_session_metrics', object: 'sys_session', dimensions: [], measures: [] },
          { name: 'sys_audit_log_metrics', object: 'sys_audit_log', dimensions: [], measures: [] },
          {
            name: 'sys_package_installation_metrics',
            object: 'sys_package_installation',
            dimensions: [],
            measures: [],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('warns rather than errors on a platform-shaped base object nothing registers', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      datasets: [{ name: 'm', object: 'sys_approval_process', dimensions: [], measures: [] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNREGISTERED_PLATFORM);
  });
});

describe('validateObjectReferences — the severity ladder', () => {
  // The `sys_approval_process` case: platform-shaped but registered by nothing.
  // ADR-0019 removed the process object when approval became a flow node.
  it('warns (not errors) on a platform-prefixed name no package registers', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_approvals', type: 'object', label: 'Approvals', objectName: 'sys_approval_process', requiresObject: 'sys_approval_process' },
          ],
        },
      ],
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.severity).toBe('warning');
      expect(f.rule).toBe(OBJECT_REFERENCE_UNREGISTERED_PLATFORM);
    }
    // Both the gate and the (gate-exempted) target are reported.
    expect(findings.map((f) => f.path)).toEqual([
      'apps[0].navigation[0].requiresObject',
      'apps[0].navigation[0].objectName',
    ]);
    expect(findings[0].hint).toContain('sys_approval_request');
  });

  it('accepts a requiresObject naming a real plugin object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_approvals', type: 'object', label: 'Approvals', objectName: 'sys_approval_request', requiresObject: 'sys_approval_request' },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('accepts a cloud-only object name', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      apps: [
        {
          name: 'admin',
          navigation: [
            { id: 'nav_apps', type: 'object', label: 'Apps', objectName: 'sys_app', requiresObject: 'sys_app' },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('walks area navigation and nested children', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      apps: [
        {
          name: 'crm',
          areas: [
            {
              id: 'area_sales',
              label: 'Sales',
              navigation: [
                {
                  id: 'nav_group',
                  type: 'group',
                  label: 'Group',
                  children: [{ id: 'nav_x', type: 'object', label: 'X', requiresObject: 'nope_object' }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].areas[0].navigation[0].children[0].requiresObject');
  });
});

describe('validateObjectReferences — exemptions (false-positive floor)', () => {
  it('skips interpolated targets', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [
        { name: 'a', params: [{ name: 'p', reference: '${objectName}' }] },
        { name: 'b', params: [{ name: 'p', reference: '{current_object}' }] },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('is silent on a clean stack', () => {
    expect(validateObjectReferences(baseStack())).toEqual([]);
  });

  it('tolerates a non-object / empty input', () => {
    expect(validateObjectReferences({} as Record<string, unknown>)).toEqual([]);
    expect(validateObjectReferences(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('accepts the map-shaped (normalized) stack form', () => {
    const findings = validateObjectReferences({
      objects: { crm_lead: { fields: {} } },
      actions: { link: { params: [{ name: 'p', reference: 'crm_lead' }] } },
    });
    expect(findings).toEqual([]);
  });
});
