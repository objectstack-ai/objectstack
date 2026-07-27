// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validateNavAccess, NAV_OBJECT_UNGRANTED } from './validate-nav-access.js';

const objects = [
  { name: 'crm_lead', fields: { name: { type: 'text' } } },
  { name: 'crm_forecast', fields: { name: { type: 'text' } } },
];

const navApp = (items: unknown[]) => [{ name: 'crm', label: 'CRM', navigation: items }];

const objectNav = (id: string, objectName: string) => ({
  id,
  type: 'object',
  label: objectName,
  objectName,
});

describe('validateNavAccess', () => {
  // The HotCRM instance: an object in the menu that no set grants.
  it('warns on a nav-exposed object no permission set grants read on', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_leads', 'crm_lead'), objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        { name: 'crm_user', label: 'CRM User', objects: { crm_lead: { allowRead: true } } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(NAV_OBJECT_UNGRANTED);
    expect(findings[0].path).toBe('apps[0].navigation[1].objectName');
    expect(findings[0].message).toContain('crm_forecast');
  });

  // The platform's own `admin_full_access` uses this shape; a stack may too.
  // Without wildcard support the matrix records the literal key `*` and the
  // rule would fire on exactly the stacks that granted the most.
  it('accepts a wildcard read grant as covering every object', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        { name: 'full', label: 'Full', objects: { '*': { allowRead: true, viewAllRecords: true } } },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('accepts read granted through viewAllRecords or modifyAllRecords', () => {
    for (const bit of ['viewAllRecords', 'modifyAllRecords']) {
      const findings = validateNavAccess({
        objects,
        apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
        permissions: [
          { name: 'admin', label: 'Admin', objects: { crm_forecast: { [bit]: true } } },
        ],
      });
      expect(findings, `${bit} should grant read`).toEqual([]);
    }
  });

  it('does not treat a write-only grant as read', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        { name: 'writer', label: 'Writer', objects: { crm_forecast: { allowCreate: true, allowEdit: true } } },
      ],
    });
    expect(findings).toHaveLength(1);
  });

  it('reports an object once even when several nav entries expose it', () => {
    const findings = validateNavAccess({
      objects,
      apps: [
        {
          name: 'crm',
          navigation: [objectNav('nav_a', 'crm_forecast')],
          areas: [{ id: 'area', label: 'Area', navigation: [objectNav('nav_b', 'crm_forecast')] }],
        },
      ],
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toHaveLength(1);
  });

  it('walks area navigation and nested children', () => {
    const findings = validateNavAccess({
      objects,
      apps: [
        {
          name: 'crm',
          areas: [
            {
              id: 'area_sales',
              label: 'Sales',
              navigation: [
                {
                  id: 'grp',
                  type: 'group',
                  label: 'Group',
                  children: [objectNav('nav_forecast', 'crm_forecast')],
                },
              ],
            },
          ],
        },
      ],
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].areas[0].navigation[0].children[0].objectName');
  });
});

describe('validateNavAccess — exemptions (false-positive floor)', () => {
  it('skips platform-provided objects — their own packages grant them', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([
        objectNav('nav_users', 'sys_user'),
        objectNav('nav_approvals', 'sys_approval_request'),
      ]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toEqual([]);
  });

  it('skips a stack that declares no permission sets at all', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
    });
    expect(findings).toEqual([]);
  });

  it('skips an object this stack does not define', () => {
    // A dangling nav target is `validate-object-references`' finding, not this
    // rule's — reporting it here would double-report one mistake.
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_ghost', 'crm_ghost')]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toEqual([]);
  });

  it('ignores non-object nav entries', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([
        { id: 'nav_dash', type: 'dashboard', label: 'D', dashboardName: 'd' },
        { id: 'nav_url', type: 'url', label: 'U', url: '/x' },
        { id: 'nav_sep', type: 'separator' },
      ]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toEqual([]);
  });

  it('is silent when every exposed object is granted, and tolerates empty input', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_leads', 'crm_lead'), objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        {
          name: 'p',
          label: 'P',
          objects: { crm_lead: { allowRead: true }, crm_forecast: { allowRead: true } },
        },
      ],
    });
    expect(findings).toEqual([]);
    expect(validateNavAccess({})).toEqual([]);
    expect(validateNavAccess(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('accepts a grant coming from any one of several sets', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        { name: 'a', label: 'A', objects: { crm_lead: { allowRead: true } } },
        { name: 'b', label: 'B', objects: { crm_forecast: { allowRead: true } } },
      ],
    });
    expect(findings).toEqual([]);
  });
});
