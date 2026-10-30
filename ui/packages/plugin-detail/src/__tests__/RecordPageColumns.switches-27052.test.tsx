/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 → objectstack#27524, Target 4 — `RecordPageColumns` with
 * the reader's ONE switch, ⊟ (the right column). The timeline switch, its
 * folded 「动态」 card and the related rail retired: 动态 is the right column's
 * first panel, so ⊟ takes the 动态 panel and the related panels out
 * together, and the details take the row. The stack has no right column, so
 * the switch does not reach it. The blocks are stubbed (each node draws its
 * type), so what is measured is where each node lands.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

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

describe('RecordPageColumns — the right-column switch ⊟ (objectstack#27052, objectstack#27524)', () => {
  it('absent or on: details | right column, 动态 first', () => {
    for (const rightColumn of [undefined, true]) {
      const { container, unmount } = render(<RecordPageColumns tier="wide" columns={columns} rightColumn={rightColumn} />);
      expect(shown(container)).toBe('details right');
      expect(nodesIn(column(container, 'right'))).toEqual(['record:activity', 'record:related_list', 'record:related_list']);
      unmount();
    }
  });

  for (const tier of ['wide', 'two-column'] as const) {
    it(`off, ${tier}: the details alone take the row — no right column, no 动态 panel, no lists, no rail`, () => {
      const { container } = render(
        <RecordPageColumns tier={tier} columns={columns} rightColumn={false} footer={<p data-testid="meta-footer">meta</p>} />,
      );
      expect(shown(container)).toBe('details');
      expect(column(container, 'right')).toBeNull();
      expect(container.querySelector('[data-record-timeline-panel]')).toBeNull();
      expect(container.querySelectorAll('[data-node="record:related_list"]')).toHaveLength(0);
      expect(container.querySelector('[data-testid="record-related-rail-toggle"]')).toBeNull();
      expect(container.querySelector('[data-record-folded-timeline]')).toBeNull();
      expect(column(container, 'details')!.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    });
  }

  it('the stack does not read it: its panels follow the details whatever the switch says', () => {
    const { container } = render(<RecordPageColumns tier="stack" columns={columns} rightColumn={false} />);
    expect(shown(container)).toBe('details');
    expect(nodesIn(column(container, 'right'))).toEqual(['record:activity', 'record:related_list', 'record:related_list']);
  });
});
