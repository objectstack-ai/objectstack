/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 — `RecordPageColumns`, the column tiers of the synthesized
 * record page. The blocks themselves are stubbed (each node draws its type),
 * so what is measured here is the layout alone: where each node lands, that
 * the header is drawn once, that no tab strip exists, and the two-column
 * tier's related rail.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: ({ schema }: { schema: any }) => (
    <div data-node={schema?.type}>{schema?.properties?.objectName ?? schema?.type}</div>
  ),
}));

import { RecordPageColumns } from '../RecordPageColumns';
import { buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';

const page = buildDefaultPageSchema(
  { name: 'lead', label: 'Lead', fields: { name: { name: 'name', type: 'text' } } },
  {
    related: [
      { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
      { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
    ],
    history: { entries: [] },
  },
);
const columns = buildDefaultPageColumns(page)!;

const column = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-record-column="${name}"]`) as HTMLElement | null;
const nodesIn = (el: HTMLElement | null) =>
  Array.from(el?.querySelectorAll('[data-node]') ?? []).map((n) => n.getAttribute('data-node'));

afterEach(() => cleanup());

describe('RecordPageColumns — three columns (objectstack#26678)', () => {
  it('draws one header, then details | timeline | related, and no tab strip', () => {
    const { container } = render(
      <RecordPageColumns tier="three-column" columns={columns} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(container.querySelector('[data-record-page-tier="three-column"]')).not.toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.querySelectorAll('[data-node="page:header"]')).toHaveLength(1);
    expect(nodesIn(column(container, 'details'))).toEqual(['record:details']);
    expect(nodesIn(column(container, 'timeline'))).toEqual(['record:discussion', 'record:history']);
    expect(nodesIn(column(container, 'related'))).toEqual(['record:related_list', 'record:related_list']);
    // The meta line closes the details column (objectstack#27055).
    const related = column(container, 'related')!;
    expect(within(related).queryByTestId('meta-footer')).toBeNull();
    expect(column(container, 'details')!.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    // The related lists are siblings of one parent, so they form one empty-fold stack.
    const lists = related.querySelectorAll('[data-node="record:related_list"]');
    expect(lists[0].parentElement).toBe(lists[1].parentElement);
  });

  it('collapses a column with nothing in it; the footer then closes the details column', () => {
    const bare = buildDefaultPageColumns(buildDefaultPageSchema({ name: 'thing', fields: {} }, { hideDiscussion: true }))!;
    const { container } = render(
      <RecordPageColumns tier="three-column" columns={bare} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(column(container, 'details')).not.toBeNull();
    expect(column(container, 'timeline')).toBeNull();
    expect(column(container, 'related')).toBeNull();
    expect(within(column(container, 'details')!).getByTestId('meta-footer')).toBeTruthy();
  });
});

describe('RecordPageColumns — two columns and the related rail (objectstack#26678)', () => {
  it('draws details | timeline with the rail closed and its lists unmounted', () => {
    const { container } = render(
      <RecordPageColumns tier="two-column" columns={columns} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(container.querySelector('[data-record-page-tier="two-column"]')).not.toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(nodesIn(column(container, 'details'))).toEqual(['record:details']);
    expect(nodesIn(column(container, 'timeline'))).toEqual(['record:discussion', 'record:history']);
    expect(column(container, 'related')).toBeNull();
    expect(container.querySelectorAll('[data-node="record:related_list"]')).toHaveLength(0);
    // The footer closes the details column while the rail is closed.
    expect(within(column(container, 'details')!).getByTestId('meta-footer')).toBeTruthy();

    const toggle = screen.getByRole('button', { name: /Related/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The toggle counts the related collections.
    expect(toggle.textContent).toContain('2');
  });

  it('opens the rail from the toggle, and Escape closes it back to the toggle', () => {
    const { container } = render(<RecordPageColumns tier="two-column" columns={columns} />);
    const toggle = screen.getByRole('button', { name: /Related/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rail = column(container, 'related')!;
    expect(rail).not.toBeNull();
    expect(rail.id).toBe(toggle.getAttribute('aria-controls'));
    expect(nodesIn(rail)).toEqual(['record:related_list', 'record:related_list']);

    fireEvent.keyDown(rail, { key: 'Escape' });
    expect(column(container, 'related')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('draws no toggle when the related column is empty', () => {
    const bare = buildDefaultPageColumns(buildDefaultPageSchema({ name: 'thing', fields: {} }))!;
    render(<RecordPageColumns tier="two-column" columns={bare} />);
    expect(screen.queryByRole('button', { name: /Related/ })).toBeNull();
  });
});
