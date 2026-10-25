// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12109 — the console's default read gate on a navigation tree:
 * `withoutUnreadableObjectEntries` drops a `type: 'object'` entry whose object
 * the caller may not read, at any depth, and leaves every other entry as it is.
 *
 * The rendered surfaces that prune through it are pinned beside them
 * (`UnifiedSidebar.objectReadGate-12109.test.tsx`,
 * `nav-object-read-gate-12109.render.test.tsx`); this file pins the function's
 * own contract, the `type: 'object'`-only reach in particular.
 */

import { describe, it, expect, vi } from 'vitest';
import type { NavigationItem } from '@object-ui/types';
import { mayReadObject, withoutUnreadableObjectEntries, type ObjectReadCheck } from '../navObjectReadGate';

/** A service agent's answer: no read on opportunities, read on everything else. */
const agent: ObjectReadCheck = (object) => object !== 'crm_opportunity';

const ids = (items: NavigationItem[]): string[] =>
  items.flatMap((item) => [item.id ?? '', ...(item.type === 'separator' ? [] : ids(item.children ?? []))]);

describe('withoutUnreadableObjectEntries (objectui#12109)', () => {
  it('drops an object entry the caller may not read, and keeps one they may read', () => {
    const items: NavigationItem[] = [
      { id: 'nav_opportunity', type: 'object', objectName: 'crm_opportunity', label: 'Opportunities' },
      { id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' },
    ];
    expect(ids(withoutUnreadableObjectEntries(items, agent))).toEqual(['nav_account']);
  });

  it('drops it at every depth: inside a group, and an object entry takes its children with it', () => {
    const items: NavigationItem[] = [
      {
        id: 'group_sales',
        type: 'group',
        label: 'Sales',
        children: [
          { id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' },
          {
            id: 'nav_opportunity',
            type: 'object',
            objectName: 'crm_opportunity',
            label: 'Opportunities',
            children: [{ id: 'nav_pipeline', type: 'dashboard', dashboardName: 'pipeline', label: 'Pipeline' }],
          },
        ],
      },
      {
        id: 'group_my_work',
        type: 'group',
        label: 'My Work',
        children: [
          { id: 'nav_my_deals', type: 'object', objectName: 'crm_opportunity', viewName: 'my_open_deals', label: 'My Deals' },
        ],
      },
    ];
    // The emptied group is KEPT: whether a group with no surviving child draws
    // is the layout's item guard's question, and it answers "no".
    expect(ids(withoutUnreadableObjectEntries(items, agent))).toEqual(['group_sales', 'nav_account', 'group_my_work']);
  });

  it('CONTROL: an entry that is not `type: object` is unchanged, whatever object its target reads', () => {
    const items: NavigationItem[] = [
      { id: 'nav_dash', type: 'dashboard', dashboardName: 'crm_opportunity', label: 'Pipeline' },
      { id: 'nav_report', type: 'report', reportName: 'crm_opportunity', label: 'Report' },
      { id: 'nav_page', type: 'page', pageName: 'crm_opportunity', label: 'Page' },
      { id: 'nav_url', type: 'url', url: '/apps/crm/crm_opportunity', label: 'By URL' },
      { id: 'nav_action', type: 'action', label: 'Update Stage', actionDef: { actionName: 'mass_update_stage' } },
      { id: 'nav_component', type: 'component', componentRef: 'approvals:inbox', requiresObject: 'crm_opportunity', label: 'Inbox' },
      { id: 'nav_doc', type: 'doc', doc: 'crm_opportunity', label: 'Doc' },
      { id: 'sep', type: 'separator' },
    ];
    const kept = withoutUnreadableObjectEntries(items, agent);
    expect(kept).toBe(items);
    expect(ids(kept)).toEqual(ids(items));
  });

  it('a caller who may read everything gets the very tree back, nested parents included', () => {
    const group: NavigationItem = {
      id: 'group_sales',
      type: 'group',
      label: 'Sales',
      children: [{ id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' }],
    };
    const items: NavigationItem[] = [group];
    const kept = withoutUnreadableObjectEntries(items, () => true);
    expect(kept).toBe(items);
    expect(kept[0]).toBe(group);
  });

  it('asks the verdict for the `read` action of the entry\'s own `objectName`, once per object entry', () => {
    const can = vi.fn<ObjectReadCheck>(() => true);
    withoutUnreadableObjectEntries(
      [
        { id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' },
        { id: 'nav_dash', type: 'dashboard', dashboardName: 'crm_lead', label: 'Leads board' },
      ],
      can,
    );
    expect(can.mock.calls).toEqual([['crm_account', 'read']]);
    expect(mayReadObject(can, 'crm_lead')).toBe(true);
    expect(can).toHaveBeenLastCalledWith('crm_lead', 'read');
  });
});
