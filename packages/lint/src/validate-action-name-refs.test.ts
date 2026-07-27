// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validateActionNameRefs, ACTION_NAME_UNDEFINED } from './validate-action-name-refs.js';

const withActions = () => ({
  objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
  actions: [{ name: 'crm_convert_lead', label: 'Convert', type: 'script' }],
});

describe('validateActionNameRefs — list view bulk/row actions', () => {
  // The literal HotCRM instance: three bulk actions, none of them defined.
  it('errors on every undefined bulkAction', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [
        {
          name: 'crm_lead',
          list: { bulkActions: ['mass_update', 'mass_delete', 'assign_owner'] },
        },
      ],
    });
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
    expect(findings.every((f) => f.rule === ACTION_NAME_UNDEFINED)).toBe(true);
    expect(findings.map((f) => f.path)).toEqual([
      'views[0].list.bulkActions[0]',
      'views[0].list.bulkActions[1]',
      'views[0].list.bulkActions[2]',
    ]);
    expect(findings[0].message).toContain('does nothing when clicked');
  });

  it('errors on an undefined rowAction', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [{ name: 'crm_lead', list: { rowActions: ['complete_task'] } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].list.rowActions[0]');
  });

  it('accepts a defined action, global or object-embedded', () => {
    const stack = {
      objects: [
        {
          name: 'crm_lead',
          fields: {},
          actions: [{ name: 'crm_mark_hot', label: 'Mark hot', type: 'script' }],
        },
      ],
      actions: [{ name: 'crm_convert_lead', label: 'Convert', type: 'script' }],
      views: [
        { name: 'crm_lead', list: { rowActions: ['crm_convert_lead'], bulkActions: ['crm_mark_hot'] } },
      ],
    };
    expect(validateActionNameRefs(stack)).toEqual([]);
  });

  it('checks each named listViews entry', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [
        {
          name: 'crm_lead',
          listViews: {
            all: { bulkActions: ['crm_convert_lead'] },
            hot: { bulkActions: ['ghost_action'] },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].listViews.hot.bulkActions[0]');
  });

  it('offers a did-you-mean for a near-miss', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [{ name: 'crm_lead', list: { bulkActions: ['crm_convert_leads'] } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "crm_convert_lead"?');
  });
});

describe('validateActionNameRefs — page quick actions', () => {
  it('errors on an undefined actionNames entry', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      pages: [
        {
          name: 'lead_record',
          components: [
            {
              type: 'record:quick_actions',
              properties: { location: 'record_section', actionNames: ['showcase_mark_done'] },
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('pages[0].components[0].properties.actionNames[0]');
  });

  it('walks nested component children', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      pages: [
        {
          name: 'p',
          components: [
            {
              type: 'layout:columns',
              children: [{ type: 'record:quick_actions', properties: { actionNames: ['nope'] } }],
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('pages[0].components[0].children[0].properties.actionNames[0]');
  });
});

describe('validateActionNameRefs — navigation action items', () => {
  it('errors on an undefined nav actionName', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_new', type: 'action', label: 'New', actionDef: { actionName: 'ghost_action' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].navigation[0].actionDef.actionName');
  });

  it('accepts a defined nav actionName and walks areas', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          areas: [
            {
              id: 'a',
              label: 'A',
              navigation: [
                { id: 'nav_c', type: 'action', label: 'Convert', actionDef: { actionName: 'crm_convert_lead' } },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('validateActionNameRefs — floor', () => {
  it('is silent on a clean stack and tolerates empty input', () => {
    expect(validateActionNameRefs(withActions())).toEqual([]);
    expect(validateActionNameRefs({})).toEqual([]);
    expect(validateActionNameRefs(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('ignores a non-action nav item that happens to carry an actionDef', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_o', type: 'object', label: 'Leads', objectName: 'crm_lead', actionDef: { actionName: 'ghost' } },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});
