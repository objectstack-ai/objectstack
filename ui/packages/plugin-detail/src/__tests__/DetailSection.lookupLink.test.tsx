/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4336 — the reporter's check, at the end of the real path.
 *
 * On a record detail page a valued lookup (`关联维修派工单` → 维修派工单)
 * rendered as plain text plus a copy button: hovering showed no link state,
 * clicking did nothing, and `document.querySelector('a')` over the field's
 * value region found nothing. Both readonly and non-readonly fields behaved
 * the same way, so this is display-mode rendering, not an editability gate.
 *
 * These drive the real `DetailSection`, not the cell renderer, so they stay
 * red if the link is wired anywhere the detail body does not actually reach.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { DetailSection } from '../DetailSection';
import { RelatedRecordActionsProvider } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';

// The desktop read row (the one carrying the copy affordance) only renders
// above the mobile breakpoint.
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const objectSchema = {
  fields: {
    work_order_id: { type: 'lookup', reference: 'mtc_work_order', readonly: true },
    inspection_task_id: { type: 'lookup', reference: 'mtc_task' },
    empty_order_id: { type: 'lookup', reference: 'mtc_work_order' },
    remark: { type: 'text' },
    operator: { type: 'text' },
  },
};

// Five rows with ONE empty: below the section's auto-hide-empty ratio (≥25%),
// so the empty lookup really renders and its "no empty link" pin can be read.
const section: DetailViewSection = {
  fields: [
    { name: 'work_order_id', label: '关联维修派工单' },
    { name: 'inspection_task_id', label: '点检任务' },
    { name: 'empty_order_id', label: '生成的维修派工单' },
    { name: 'remark', label: '备注' },
    { name: 'operator', label: '操作人' },
  ],
} as DetailViewSection;

const data = {
  // readonly lookup, expanded by the server ($expand → { id, name })
  work_order_id: { id: 'wo-1', name: 'TYG1WX20260812001001' },
  // non-readonly lookup, same shape — the issue reports both behave alike
  inspection_task_id: { id: 'task-9', name: '#1072b埋弧焊机日常点检(TYWI003)' },
  empty_order_id: null,
  remark: 'plain text field',
  operator: '张三',
};

function makeHost(overrides: Record<string, unknown> = {}) {
  return {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) =>
      `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: vi.fn(),
    ...overrides,
  } as any;
}

function renderSection(host: any = makeHost()) {
  return render(
    <RelatedRecordActionsProvider value={host}>
      <DetailSection section={section} data={data} objectSchema={objectSchema} />
    </RelatedRecordActionsProvider>,
  );
}

/** The value region of one field row, located from its label. */
function valueRegion(container: HTMLElement, label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  const row = labelEl.parentElement as HTMLElement;
  expect(row).toBeTruthy();
  expect(container.contains(row)).toBe(true);
  return row;
}

describe('DetailSection — lookup values link to the referenced record (#4336)', () => {
  it('readonly lookup: the value region carries an anchor at the record href', () => {
    const { container } = renderSection();

    const anchor = valueRegion(container, '关联维修派工单').querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('href', '/apps/demo/mtc_work_order/record/wo-1');
    expect(anchor).toHaveTextContent('TYG1WX20260812001001');
  });

  it('non-readonly lookup: same treatment — readonly is irrelevant here', () => {
    const { container } = renderSection();

    const anchor = valueRegion(container, '点检任务').querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('href', '/apps/demo/mtc_task/record/task-9');
    expect(anchor).toHaveTextContent('#1072b埋弧焊机日常点检(TYWI003)');
  });
});

describe('DetailSection — must-not-change (#4336)', () => {
  it('the copy affordance still sits beside the linked value', () => {
    const { container } = renderSection();

    const row = valueRegion(container, '关联维修派工单');
    expect(row.querySelector('a')).not.toBeNull();
    // The copy button is the row's only <button>; it is rendered for any
    // non-inline-editable field with a value, alongside the link.
    expect(row.querySelectorAll('button').length).toBe(1);
  });

  it('a lookup with no value renders the placeholder, never an empty link', () => {
    const { container } = renderSection();

    const row = valueRegion(container, '生成的维修派工单');
    expect(row.querySelector('a')).toBeNull();
    expect(row.textContent).toContain('—');
  });

  it('non-lookup fields are untouched', () => {
    const { container } = renderSection();

    const row = valueRegion(container, '备注');
    expect(row.querySelector('a')).toBeNull();
    expect(row).toHaveTextContent('plain text field');
  });

  it('no host record routing (designer / embedded): plain text, exactly as before', () => {
    const { container } = render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('TYG1WX20260812001001')).toBeInTheDocument();
  });
});
