/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29462 — the record detail page's half of a `referenceNameVisible`
 * lookup / user field (director ruling 6574398310, letter B).
 *
 * The server's `$expand` answers a target the reader is refused as
 * `{ id, name, readRefused: true }`. These drive the real `DetailSection`, the
 * record page's field grid, so they stay red if the plain-text face is wired
 * anywhere the detail body does not reach: the row draws the served name with
 * no link and no hover card, and the recording data source the page hands its
 * renderers is asked nothing about the target. A readable sibling on the same
 * page keeps its link (the CONTROL).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { DetailSection } from '../DetailSection';
import { RelatedRecordActionsProvider, SchemaRendererProvider } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';

// The desktop read row only renders above the mobile breakpoint.
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const objectSchema = {
  fields: {
    payroll_id: { type: 'lookup', reference: 'hr_payroll', referenceNameVisible: true },
    approvers: { type: 'user', multiple: true, referenceNameVisible: true },
    manager_id: { type: 'user', referenceNameVisible: true },
    project_id: { type: 'lookup', reference: 'pm_project', referenceNameVisible: true },
  },
};

const section: DetailViewSection = {
  fields: [
    { name: 'payroll_id', label: 'Payroll' },
    { name: 'approvers', label: 'Approvers' },
    { name: 'manager_id', label: 'Manager' },
    { name: 'project_id', label: 'Project' },
  ],
} as DetailViewSection;

const data = {
  payroll_id: { id: 'pay-1', name: 'Payroll Q3', readRefused: true },
  approvers: [
    { id: 'u-1', name: 'Ada Lovelace', readRefused: true },
    { id: 'u-2', name: 'Record #u-2', readRefused: true },
  ],
  manager_id: { id: 'u-9', name: 'Grace Hopper', readRefused: true },
  // CONTROL: the reader may read this target, so it is the expanded record.
  project_id: { id: 'prj-1', name: 'Apollo' },
};

function recordingDataSource() {
  const calls: Array<{ method: string; object?: unknown }> = [];
  const record = (method: string, answer: unknown) =>
    vi.fn(async (object?: unknown) => {
      calls.push({ method, object });
      return answer;
    });
  return {
    calls,
    ds: {
      findOne: record('findOne', null),
      find: record('find', { data: [] }),
      getObjectSchema: record('getObjectSchema', null),
    } as any,
  };
}

const host = {
  resolve: () => ({}),
  recordHref: (objectName: string, recordId: string | number) => `/apps/demo/${objectName}/record/${recordId}`,
  openRecord: vi.fn(),
} as any;

function renderSection() {
  const { ds, calls } = recordingDataSource();
  const utils = render(
    <SchemaRendererProvider dataSource={ds}>
      <RelatedRecordActionsProvider value={host}>
        <DetailSection section={section} data={data} objectSchema={objectSchema} dataSource={ds} />
      </RelatedRecordActionsProvider>
    </SchemaRendererProvider>,
  );
  return { ...utils, calls };
}

/** The value region of one field row, located from its label. */
function valueRegion(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

const nameOnly = (root: HTMLElement) => root.querySelectorAll('[data-slot="reference-name-only"]');

describe('DetailSection — a referenceNameVisible target the reader is refused (#29462)', () => {
  it('a lookup row draws the served name as plain text, with no link', () => {
    renderSection();
    const row = valueRegion('Payroll');
    expect(nameOnly(row)).toHaveLength(1);
    expect(nameOnly(row)[0]!.textContent).toBe('Payroll Q3');
    expect(row.querySelector('a')).toBeNull();
  });

  it('a user row draws the served name as plain text', () => {
    renderSection();
    const row = valueRegion('Manager');
    expect(nameOnly(row)).toHaveLength(1);
    expect(nameOnly(row)[0]!.textContent).toBe('Grace Hopper');
    expect(row.querySelector('a')).toBeNull();
  });

  it('a multi-value row draws one text chip per element', () => {
    renderSection();
    const row = valueRegion('Approvers');
    expect([...nameOnly(row)].map((c) => c.textContent)).toEqual(['Ada Lovelace', 'Record #u-2']);
    expect(row.querySelector('a')).toBeNull();
  });

  it('nothing reads a refused target, hovered or not', async () => {
    const { calls } = renderSection();
    for (const el of nameOnly(valueRegion('Payroll'))) {
      fireEvent.mouseEnter(el);
      fireEvent.pointerEnter(el);
      fireEvent.focus(el);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const targetReads = calls.filter((c) => c.object === 'hr_payroll' || c.object === 'sys_user');
    expect(targetReads).toEqual([]);
  });

  it('CONTROL: a readable target on the same page keeps its link', () => {
    renderSection();
    const row = valueRegion('Project');
    expect(nameOnly(row)).toHaveLength(0);
    expect(row.querySelector('a')).toHaveAttribute('href', '/apps/demo/pm_project/record/prj-1');
  });
});
