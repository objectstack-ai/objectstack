/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 → objectstack#27524, Target 6 — `RecordPageColumns`, the
 * synthesized record page laid out by one rule. The blocks themselves are
 * stubbed (each node draws its type, and reports the details column cap it
 * is drawn under), so what is measured here is the layout alone: where each
 * node lands, that the header is drawn once, that no tab strip and no rail
 * exist, the 动态 panel leading the right column, and each tier's measures.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('@object-ui/react', async (importOriginal) => {
  const { DetailsColumnCapContext } = await import('../defaultRecordPage');
  const Stub = ({ schema }: { schema: any }) => (
    <div data-node={schema?.type} data-cap={React.useContext(DetailsColumnCapContext)}>
      {schema?.properties?.objectName ?? schema?.type}
    </div>
  );
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: Stub,
  };
});

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
const nodesIn = (el: HTMLElement | null) =>
  Array.from(el?.querySelectorAll('[data-node]') ?? []).map((n) => n.getAttribute('data-node'));
const grid = (container: HTMLElement) => container.querySelector('[data-record-columns]') as HTMLElement;

afterEach(() => cleanup());

describe('RecordPageColumns — details | the right column (objectstack#27524, Target 6)', () => {
  it('wide (≥ 1120): one header, details | right column at 380 px, 动态 first, no tab strip', () => {
    const { container } = render(
      <RecordPageColumns tier="wide" columns={columns} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(container.querySelector('[data-record-page-tier="wide"]')).not.toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.querySelectorAll('[data-node="page:header"]')).toHaveLength(1);
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details right');
    expect(grid(container).className).toContain('grid-cols-[minmax(0,1fr)_23.75rem]');
    expect(nodesIn(column(container, 'details'))).toEqual(['record:details']);
    // The 动态 panel leads the right column; the related panels follow it.
    const right = column(container, 'right')!;
    expect(right.firstElementChild?.hasAttribute('data-record-timeline-panel')).toBe(true);
    expect(nodesIn(right)).toEqual(['record:activity', 'record:related_list', 'record:related_list']);
    // No timeline column exists any more (「动态是面板，不是栏」).
    expect(column(container, 'timeline')).toBeNull();
    // The meta line closes the details column (objectstack#27055).
    expect(within(right).queryByTestId('meta-footer')).toBeNull();
    expect(column(container, 'details')!.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    // The related lists are siblings of one parent, so they form one empty-fold stack.
    const lists = right.querySelectorAll('[data-node="record:related_list"]');
    expect(lists[0].parentElement).toBe(lists[1].parentElement);
    // Wide: a details section may take three field columns.
    expect(column(container, 'details')!.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('3');
  });

  it('two-column (760 – 1119): the right column at 320 px, its lists resident — no rail, no toggle', () => {
    const { container } = render(<RecordPageColumns tier="two-column" columns={columns} />);
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details right');
    expect(grid(container).className).toContain('grid-cols-[minmax(0,1fr)_20rem]');
    expect(nodesIn(column(container, 'right'))).toEqual(['record:activity', 'record:related_list', 'record:related_list']);
    expect(screen.queryByRole('button', { name: /Related/ })).toBeNull();
    expect(container.querySelector('[data-testid="record-related-rail-toggle"]')).toBeNull();
    // Beside the 320 px column a details section takes two field columns at most.
    expect(column(container, 'details')!.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('2');
  });

  it('a page with nothing for the right column draws the details alone; the footer closes them', () => {
    const bare = buildDefaultPageColumns(buildDefaultPageSchema({ name: 'thing', fields: {} }, { hideDiscussion: true }))!;
    const { container } = render(
      <RecordPageColumns tier="wide" columns={bare} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(column(container, 'details')).not.toBeNull();
    expect(column(container, 'right')).toBeNull();
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details');
    expect(within(column(container, 'details')!).getByTestId('meta-footer')).toBeTruthy();
  });
});

describe('RecordPageColumns — the stack (< 760, objectstack#27524, Target 6)', () => {
  it('ONE column: the details and their footer, then the right column’s panels in their order — no tabs', () => {
    const { container } = render(
      <RecordPageColumns tier="stack" columns={columns} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(container.querySelector('[data-record-page-tier="stack"]')).not.toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details');
    expect(grid(container).className).toContain('grid-cols-1');
    // Details first, the panels after them, in one flow.
    const [details, right] = Array.from(grid(container).children) as HTMLElement[];
    expect(details.getAttribute('data-record-column')).toBe('details');
    expect(right.getAttribute('data-record-column')).toBe('right');
    expect(details.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    expect(nodesIn(right)).toEqual(['record:activity', 'record:related_list', 'record:related_list']);
    // The stack's details are the whole width: the section's own container decides.
    expect(details.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('3');
  });
});
