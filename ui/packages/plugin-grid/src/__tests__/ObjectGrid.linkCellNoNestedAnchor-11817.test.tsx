/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11817 — a link cell holds no anchor of its own.
 *
 * The Invitations list (`sys_invitation`, first column `email`) logged React's
 * "In HTML, an anchor cannot be a descendant of an anchor" warning: the grid's
 * primary column is the row's anchor to its record (objectui#4490), and
 * `EmailCellRenderer` drew its `mailto:` anchor, with a copy button beside it,
 * inside that anchor. Measured through the real `ObjectView` before the fix:
 * the primary-field link's markup held the mailto anchor and the copy button.
 *
 * Two mechanisms, one per way a cell value draws an anchor:
 *
 *   - `email` / `url` / `phone` and the file family draw theirs without asking
 *     the host, so a link cell is handed their TEXT face (`linkCellRenderer`
 *     in `cellRendererResolution`). The file family joined the set because
 *     the census below found its download link nested in a link cell;
 *   - the reference family draws one only when the host's `recordHref` answers
 *     for the referenced object, so `LinkCell` renders its children under the
 *     same host with no record destination.
 *
 * The census at the bottom walks every type the cell registry resolves
 * (`listCellRendererTypes`, a live reading) through a link column, and its
 * control proves the probe values DO draw anchors outside a link cell — a
 * census whose values drew no anchor anywhere would pass for any code.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields, listCellRendererTypes } from '@object-ui/fields';
import { ActionProvider, RelatedRecordActionsProvider, type RelatedRecordActionsValue } from '@object-ui/react';

registerAllFields();

/**
 * A host that routes to records of ANY object — the record page's bridge
 * shape, the widest one. The list page's host answers only its own object,
 * which this one covers.
 */
const host: RelatedRecordActionsValue = {
  resolve: () => ({}),
  recordHref: (objectName, recordId) =>
    `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
  openRecord: () => {},
};

function renderGrid(schemaOverrides: Record<string, unknown>, objectFields?: Record<string, unknown>) {
  const schema = {
    type: 'object-grid' as const,
    objectName: 'test_object',
    ...schemaOverrides,
  } as React.ComponentProps<typeof ObjectGrid>['schema'];
  return render(
    <ActionProvider>
      <RelatedRecordActionsProvider value={host}>
        <ObjectGrid schema={schema} objectFields={objectFields} />
      </RelatedRecordActionsProvider>
    </ActionProvider>,
  );
}

/** Every anchor that has an anchor ancestor. */
function nestedAnchors(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('a a'));
}

const CONTRACT = { url: 'https://cdn.example.com/contract.pdf', name: 'contract.pdf' };

const SELF_LINKING = [
  { type: 'email', value: 'ada@example.com', text: 'ada@example.com', scheme: 'mailto:' },
  { type: 'url', value: 'https://example.com/ada', text: 'https://example.com/ada', scheme: 'https:' },
  { type: 'phone', value: '+15550100', text: '+15550100', scheme: 'tel:' },
  { type: 'file', value: CONTRACT, text: 'contract.pdf', scheme: 'https:' },
] as const;

describe('objectui#11817 — the primary column holds its value as text, inside one anchor', () => {
  it.each(SELF_LINKING)('a `$type` first column: one anchor to the record, the value as its text', async ({ type, value, text, scheme }) => {
    const { container } = renderGrid({
      columns: [
        { field: 'contact', label: 'Contact', type },
        { field: 'name', label: 'Name' },
      ],
      data: { provider: 'value', items: [{ id: 'r1', contact: value, name: 'Ada' }] },
    });
    await waitFor(() => expect(container.querySelector('[data-testid="primary-field-link"]')).not.toBeNull());

    const link = container.querySelector('[data-testid="primary-field-link"]')!;
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/apps/demo/test_object/record/r1');
    expect(link).toHaveTextContent(text);
    expect(link.querySelector('a')).toBeNull();
    expect(link.querySelector('button')).toBeNull();
    expect(container.querySelector(`a[href^="${scheme}"]`)).toBeNull();
    expect(nestedAnchors(container)).toEqual([]);
  });

  it('a `link: true` email column takes the same face as the primary column', async () => {
    const { container } = renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'contact', label: 'Contact', type: 'email', link: true },
      ],
      data: { provider: 'value', items: [{ id: 'r1', contact: 'ada@example.com', name: 'Ada' }] },
    });
    await screen.findByTestId('link-cell');

    expect(screen.getByTestId('link-cell')).toHaveTextContent('ada@example.com');
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(nestedAnchors(container)).toEqual([]);
  });

  it('a reference in a link column draws its name, not a second anchor to the referenced record', async () => {
    const { container } = renderGrid(
      {
        columns: [{ field: 'parent_id', label: 'Parent', type: 'lookup', link: true }, { field: 'name', label: 'Name' }],
        data: { provider: 'value', items: [{ id: 'r1', name: 'Ada', parent_id: { id: 'r2', name: 'Grace' } }] },
      },
      { parent_id: { type: 'lookup', reference: 'test_object', label: 'Parent' }, name: { type: 'text', label: 'Name' } },
    );
    await screen.findByTestId('link-cell');

    const link = screen.getByTestId('link-cell');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/apps/demo/test_object/record/r1');
    expect(link).toHaveTextContent('Grace');
    expect(link.querySelector('a')).toBeNull();
    expect(nestedAnchors(container)).toEqual([]);
  });
});

describe('objectui#11817 — controls: outside a link cell, nothing changes', () => {
  it('an email column that is not the link column keeps its mailto anchor and copy button', async () => {
    const { container } = renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'contact', label: 'Contact', type: 'email' },
      ],
      data: { provider: 'value', items: [{ id: 'r1', contact: 'ada@example.com', name: 'Ada' }] },
    });
    await waitFor(() => expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull());

    expect(container.querySelector('a[href="mailto:ada@example.com"]')).toHaveTextContent('ada@example.com');
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="primary-field-link"]')).toHaveTextContent('Ada');
    expect(nestedAnchors(container)).toEqual([]);
  });

  it('a reference column that is not the link column keeps its anchor to the referenced record', async () => {
    const { container } = renderGrid(
      {
        columns: [{ field: 'name', label: 'Name' }, { field: 'parent_id', label: 'Parent', type: 'lookup' }],
        data: { provider: 'value', items: [{ id: 'r1', name: 'Ada', parent_id: { id: 'r2', name: 'Grace' } }] },
      },
      { parent_id: { type: 'lookup', reference: 'test_object', label: 'Parent' }, name: { type: 'text', label: 'Name' } },
    );
    await waitFor(() => expect(container.querySelector('a[href="/apps/demo/test_object/record/r2"]')).not.toBeNull());

    expect(container.querySelector('a[href="/apps/demo/test_object/record/r2"]')).toHaveTextContent('Grace');
    expect(nestedAnchors(container)).toEqual([]);
  });
});

/**
 * Probe values per registry key. A key with no entry gets a plain string,
 * which every renderer accepts. The families that draw an anchor get a value
 * that makes them draw it — the control below holds them to that.
 */
const PROBE_VALUE: Record<string, unknown> = {
  email: 'ada@example.com',
  url: 'https://example.com/ada',
  phone: '+15550100',
  file: CONTRACT,
  video: CONTRACT,
  audio: CONTRACT,
  lookup: { id: 'r2', name: 'Grace' },
  master_detail: { id: 'r2', name: 'Grace' },
  tree: { id: 'r2', name: 'Grace' },
};
const REFERENCE_TYPES = new Set(['lookup', 'master_detail', 'tree']);

function censusGrid(link: boolean) {
  const types = listCellRendererTypes();
  const columns = [
    { field: 'name', label: 'Name' },
    ...types.map((type) => ({ field: `f_${type}`, label: type, type, ...(link ? { link: true } : {}) })),
  ];
  const row: Record<string, unknown> = { id: 'r1', name: 'Ada' };
  const objectFields: Record<string, unknown> = { name: { type: 'text', label: 'Name' } };
  for (const type of types) {
    row[`f_${type}`] = PROBE_VALUE[type] ?? 'probe';
    objectFields[`f_${type}`] = REFERENCE_TYPES.has(type)
      ? { type, reference: 'test_object', label: type }
      : { type, label: type };
  }
  return { types, ...renderGrid({ columns, data: { provider: 'value', items: [row] } }, objectFields) };
}

describe('objectui#11817 — census: every registered cell type, drawn in a link column', () => {
  it('control: outside a link cell the probe values draw mailto, URL, tel, download and record anchors', async () => {
    const { container, types } = censusGrid(false);
    expect(types.length).toBeGreaterThan(20);
    await waitFor(() => expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull());

    expect(container.querySelector('a[href="mailto:ada@example.com"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://example.com/ada"]')).not.toBeNull();
    expect(container.querySelector('a[href="tel:+15550100"]')).not.toBeNull();
    expect(container.querySelectorAll('a[href="https://cdn.example.com/contract.pdf"]')).toHaveLength(3);
    expect(container.querySelector('a[href="/apps/demo/test_object/record/r2"]')).not.toBeNull();
  });

  it('inside link cells no type draws an anchor of its own', async () => {
    const { container, types } = censusGrid(true);
    await waitFor(() => expect(container.querySelectorAll('[data-testid="link-cell"]').length).toBe(types.length));

    expect(nestedAnchors(container).map((a) => a.outerHTML)).toEqual([]);
    // Every anchor in the table is a link cell or the primary-field link: no
    // value face put one of its own anywhere in the row.
    const foreign = Array.from(container.querySelectorAll('tbody a')).filter(
      (a) => !['link-cell', 'primary-field-link'].includes(a.getAttribute('data-testid') ?? ''),
    );
    expect(foreign.map((a) => a.outerHTML)).toEqual([]);
  });
});
