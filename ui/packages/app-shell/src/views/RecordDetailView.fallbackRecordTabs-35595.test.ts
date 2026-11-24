/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35595 — a record page drawn as written (an authored page, or a
 * synthesized one whose strip cannot be laid out) that does not place the
 * record's approval or attachments panel gets them as tabs of its first
 * `page:tabs` strip — 「附件」 then 「审批」, after its own tabs — and no longer
 * at the page's foot. A page with no strip keeps the foot: there is nowhere
 * else to put them. The page comes back by reference when nothing is added,
 * so a page with nothing to add re-renders nothing.
 */

import { describe, it, expect } from 'vitest';
import { withFallbackRecordTabs } from './RecordDetailView';

const APPROVALS = { approvals: { available: true, requests: [{ id: 'r1' }], pendingRequest: { id: 'r1' } }, currentUserId: 'u1' };
const details = { type: 'record:details', properties: {} };

const authored = (tabs: Record<string, unknown>) => ({
  type: 'record',
  regions: [{ name: 'main', components: [{ type: 'page:header' }, tabs, { type: 'page:tabs', properties: { items: [{ label: 'Second', value: 'second', children: [] }] } }] }],
});
const firstTabs = (page: any) => page.regions[0].components[1];
const values = (tabs: any) => (tabs.properties?.items ?? tabs.items).map((item: any) => item.value);

describe('withFallbackRecordTabs (objectstack#35595)', () => {
  it('appends 附件 then 审批 to the FIRST strip, after its own tabs; the second strip is untouched', () => {
    const page = authored({ type: 'page:tabs', properties: { items: [{ label: 'Details', value: 'details', children: [details] }] } });
    const out = withFallbackRecordTabs(page, { approvals: APPROVALS, attachments: true });
    expect(out.approvals).toBe(true);
    expect(out.attachments).toBe(true);
    expect(values(firstTabs(out.page))).toEqual(['details', 'attachments', 'approvals']);
    const items = firstTabs(out.page).properties.items;
    expect(items[1].children).toEqual([{ type: 'record:attachments', properties: {} }]);
    expect(items[2].children).toEqual([{ type: 'record:approvals', properties: APPROVALS }]);
    expect(values(out.page.regions[0].components[2])).toEqual(['second']);
    // The input is not mutated.
    expect(values(firstTabs(page))).toEqual(['details']);
  });

  it('reads the strip\'s items in either spelling (`properties.items` or `items`)', () => {
    const page = authored({ type: 'page:tabs', items: [{ label: 'Details', value: 'details', children: [details] }] });
    const out = withFallbackRecordTabs(page, { approvals: null, attachments: true });
    expect(values(firstTabs(out.page))).toEqual(['details', 'attachments']);
    expect(out).toMatchObject({ approvals: false, attachments: true });
  });

  it('finds a strip nested in a component\'s children', () => {
    const page = {
      type: 'record',
      regions: [{ name: 'main', components: [{ type: 'page:card', children: [{ type: 'page:tabs', properties: { items: [{ label: 'A', value: 'a', children: [] }] } }] }] }],
    };
    const out = withFallbackRecordTabs(page, { approvals: APPROVALS, attachments: false });
    expect(values(out.page.regions[0].components[0].children[0])).toEqual(['a', 'approvals']);
    expect(out).toMatchObject({ approvals: true, attachments: false });
  });

  it('a page with no strip keeps the foot: nothing is added and the page comes back by reference', () => {
    const page = { type: 'record', regions: [{ name: 'main', components: [details] }] };
    const out = withFallbackRecordTabs(page, { approvals: APPROVALS, attachments: true });
    expect(out.page).toBe(page);
    expect(out).toMatchObject({ approvals: false, attachments: false });
  });

  it('CONTROL: nothing to add returns the page by reference', () => {
    const page = authored({ type: 'page:tabs', properties: { items: [{ label: 'Details', value: 'details', children: [details] }] } });
    const out = withFallbackRecordTabs(page, { approvals: null, attachments: false });
    expect(out.page).toBe(page);
    expect(out).toMatchObject({ approvals: false, attachments: false });
  });
});
