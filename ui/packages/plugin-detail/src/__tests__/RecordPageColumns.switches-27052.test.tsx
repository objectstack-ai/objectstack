/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 — `RecordPageColumns` with the reader's column switches.
 * The blocks are stubbed (each node draws its type), so what is measured is
 * where each node lands when a column is switched off.
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
  },
);
const columns = buildDefaultPageColumns(page)!;

const column = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-record-column="${name}"]`) as HTMLElement | null;
const nodesIn = (el: Element | null) =>
  Array.from(el?.querySelectorAll('[data-node]') ?? []).map((n) => n.getAttribute('data-node'));
const shown = (container: HTMLElement) =>
  container.querySelector('[data-record-columns]')?.getAttribute('data-record-columns-shown');

afterEach(() => cleanup());

describe('RecordPageColumns — the column switches (objectstack#27052)', () => {
  it('both on draws what it drew before', () => {
    const { container } = render(
      <RecordPageColumns tier="three-column" columns={columns} switches={{ timeline: true, related: true }} />,
    );
    expect(shown(container)).toBe('details timeline related');
    expect(container.querySelector('[data-record-folded-timeline]')).toBeNull();
  });

  it('timeline off, three columns: details | related, the timeline folded into its 「动态」 card under the lists', () => {
    const { container } = render(
      <RecordPageColumns
        tier="three-column"
        columns={columns}
        switches={{ timeline: false, related: true }}
        footer={<p data-testid="meta-footer">meta</p>}
      />,
    );
    expect(shown(container)).toBe('details related');
    expect(column(container, 'timeline')).toBeNull();
    const related = column(container, 'related')!;
    const folded = related.querySelector('[data-record-folded-timeline]')!;
    expect(folded).not.toBeNull();
    expect(folded.getAttribute('aria-label')).toBe('Activity');
    expect(nodesIn(folded)).toEqual(['record:activity']);
    // Lists first, the folded card after them; the meta line closes the
    // details column (objectstack#27055).
    expect(nodesIn(related)).toEqual(['record:related_list', 'record:related_list', 'record:activity']);
    expect(column(container, 'details')!.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    // The related lists stay siblings of one parent (one empty-fold stack).
    const lists = related.querySelectorAll('[data-node="record:related_list"]');
    expect(lists[0].parentElement).toBe(lists[1].parentElement);
  });

  it('timeline off, two columns: details | related resident, no rail toggle', () => {
    const { container } = render(
      <RecordPageColumns tier="two-column" columns={columns} switches={{ timeline: false, related: true }} />,
    );
    expect(shown(container)).toBe('details related');
    expect(screen.queryByTestId('record-related-rail-toggle')).toBeNull();
    expect(within(column(container, 'related')!).getAllByText('task')).toHaveLength(1);
  });

  it('related off, three columns: details | timeline, the related column behind the rail toggle', () => {
    const { container } = render(
      <RecordPageColumns tier="three-column" columns={columns} switches={{ timeline: true, related: false }} />,
    );
    expect(shown(container)).toBe('details timeline');
    expect(column(container, 'related')).toBeNull();
    fireEvent.click(screen.getByTestId('record-related-rail-toggle'));
    expect(nodesIn(column(container, 'related'))).toEqual(['record:related_list', 'record:related_list']);
  });

  it('both off: details alone; the rail holds the lists and the folded timeline', () => {
    const { container } = render(
      <RecordPageColumns tier="three-column" columns={columns} switches={{ timeline: false, related: false }} />,
    );
    expect(shown(container)).toBe('details');
    fireEvent.click(screen.getByTestId('record-related-rail-toggle'));
    expect(column(container, 'related')!.querySelector('[data-record-folded-timeline]')).not.toBeNull();
  });
});
