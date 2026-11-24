/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35595 — the record page's tab strip as `page:tabs` draws it (an
 * authored page, or a synthesized one drawn as written):
 *
 *   - one table, one count: a tab holding a single related list carries that
 *     list's count; a tab that merges several tables — which only an explicit
 *     page definition does — carries NO number (the platform does not total
 *     them for it);
 *   - a tab whose count is 0 keeps its place, its label muted, with no number;
 *   - the 审批 tab carries a dot while the approval its `record:approvals`
 *     block was handed is pending — never a count.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import { RelatedCountStore } from '../hooks/related-count-store';
// Registers the renderers at module scope (objectui#3010/#3021).
import '../renderers';
// `react-page` reaches this dynamically; load it during collection, not in a
// clocked case (`check:test-source-alias`).
import '@object-ui/react-runtime';

const RECORD_OBJECT = 'zz35595_account';
const PARENT_ID = 'ACC-1';
const TOTALS: Record<string, number> = { zz35595_contact: 3, zz35595_case: 2, zz35595_quote: 0 };

const makeDS = () => ({
  find: vi.fn(async (object: string) => ({ data: [], total: TOTALS[object] ?? 0 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

const relatedList = (objectName: string) => ({
  type: 'record:related_list',
  properties: { objectName, relationshipField: 'account' },
});
const text = (content: string) => [{ type: 'element:text', properties: { content } }];

function renderTabs(items: any[]) {
  const ds = makeDS();
  const utils = render(
    <RecordContextProvider objectName={RECORD_OBJECT} recordId={PARENT_ID} data={{ id: PARENT_ID }} dataSource={ds as any}>
      <SchemaRenderer schema={{ type: 'page:tabs', id: 'tabs-35595', items: [{ label: 'Details', value: 'details', children: text('D') }, ...items] } as any} />
    </RecordContextProvider>,
  );
  return { ...utils, ds };
}

const tabByLabel = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('[role="tab"]')).find((el) => el.textContent?.startsWith(label)) as HTMLElement;
const badge = (tab: HTMLElement) => tab.querySelector('[aria-label$="items"], [aria-label$="item"]');

beforeEach(() => RelatedCountStore._reset());
afterEach(() => {
  cleanup();
  RelatedCountStore._reset();
});

describe('page:tabs — one table, one count (objectstack#35595)', () => {
  it('a tab merging two related lists carries no number', async () => {
    const { container, findByLabelText } = renderTabs([
      { label: 'Related', value: 'related', children: [relatedList('zz35595_contact'), relatedList('zz35595_case')] },
      { label: 'Contacts', value: 'contacts', children: [relatedList('zz35595_contact')] },
    ]);
    // CONTROL: the single-list tab on the same strip is counted.
    expect((await findByLabelText('3 items')).textContent).toBe('3');
    expect(tabByLabel(container, 'Contacts').textContent).toBe('Contacts3');
    // The merged tab: no badge, and no 5 (= 3 + 2) anywhere.
    const merged = tabByLabel(container, 'Related');
    expect(badge(merged)).toBeNull();
    expect(merged.textContent).toBe('Related');
    expect(container.querySelector('[aria-label="5 items"]')).toBeNull();
  });

  it('a list with no records keeps its tab, muted, with no number; CONTROL: a counted one is not muted', async () => {
    const { container, findByLabelText } = renderTabs([
      { label: 'Quotes', value: 'quotes', children: [relatedList('zz35595_quote')] },
      { label: 'Cases', value: 'cases', children: [relatedList('zz35595_case')] },
    ]);
    await findByLabelText('2 items');
    await waitFor(() => expect(container.querySelector('[data-page-tab-empty]')).not.toBeNull());
    const quotes = tabByLabel(container, 'Quotes');
    const label = quotes.querySelector('[data-page-tab-empty]')!;
    expect(label.textContent).toBe('Quotes');
    expect(label.className).toContain('opacity-70');
    expect(badge(quotes)).toBeNull();
    const cases = tabByLabel(container, 'Cases');
    expect(cases.querySelector('[data-page-tab-empty]')).toBeNull();
    expect(badge(cases)?.textContent).toBe('2');
  });
});

describe('page:tabs — the 审批 tab\'s dot (objectstack#35595)', () => {
  const approvals = (pendingRequest: unknown) => ({
    label: 'Approvals',
    value: 'approvals',
    children: [{ type: 'record:approvals', properties: { approvals: { available: true, requests: [{ id: 'r1' }], pendingRequest } } }],
  });

  it('a pending approval draws a dot on its tab, not a count', () => {
    const { container } = renderTabs([approvals({ id: 'r1' })]);
    const tab = tabByLabel(container, 'Approvals');
    expect(tab.querySelector('[data-page-tab-dot]')).not.toBeNull();
    expect(badge(tab)).toBeNull();
    expect(container.querySelectorAll('[data-page-tab-dot]')).toHaveLength(1);
  });

  it('CONTROL: an approval with nothing pending draws no dot', () => {
    const { container } = renderTabs([approvals(null)]);
    expect(container.querySelector('[data-page-tab-dot]')).toBeNull();
  });
});

