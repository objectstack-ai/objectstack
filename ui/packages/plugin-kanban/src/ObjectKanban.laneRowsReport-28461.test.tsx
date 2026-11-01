/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28461 — a board reports the cards it draws, lane by lane
 * (`onRowGroupsChange`), so a record pane opened from a card can step within
 * that card's lane and name it.
 *
 * Each open lane is reported in board order with its title and its cards in
 * the order it draws them. A collapsed lane — here the lost lane, collapsed by
 * its option's lifecycle kind — draws no cards and is left out; opening it
 * brings it back.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`.
import './index';
// The board renders inside a `React.lazy` boundary; importing the chunk at
// module scope bills the cold transform to the import phase (objectui#3010),
// same specifier as the lazy factory.
import './KanbanImpl';
import type { KanbanLaneRows } from './KanbanImpl';

const STAGE_OPTIONS = [
  { value: 'new', label: 'New', kind: 'open' },
  { value: 'won', label: 'Won', kind: 'won' },
  { value: 'lost', label: 'Lost', kind: 'lost' },
];

const OBJECT_SCHEMA = {
  name: 'lanes_deal',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'select', label: 'Stage', options: STAGE_OPTIONS },
  },
};

const ROWS = [
  { id: 'd1', name: 'Acme renewal', stage: 'new' },
  { id: 'd2', name: 'Globex pilot', stage: 'won' },
  { id: 'd3', name: 'Initech expansion', stage: 'new' },
  { id: 'd4', name: 'Hooli rollout', stage: 'lost' },
  { id: 'd5', name: 'Umbrella audit', stage: 'new' },
];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as any;
}

const summary = (lanes: readonly KanbanLaneRows[] | undefined) =>
  (lanes ?? []).map((lane) => [lane.label, lane.rows.map((card) => card.id)]);

afterEach(() => cleanup());

describe('a board reports its open lanes and their cards (objectstack#28461)', () => {
  it('reports each open lane in board order with its cards; a collapsed lane is left out until opened', async () => {
    const report = vi.fn();
    render(
      <SchemaRendererProvider dataSource={makeDataSource()}>
        <SchemaRenderer
          schema={{ type: 'object-kanban', objectName: 'lanes_deal', groupBy: 'stage' } as any}
          onRowGroupsChange={report}
        />
      </SchemaRendererProvider>,
    );
    await vi.waitFor(() =>
      expect(summary(report.mock.calls.at(-1)?.[0])).toEqual([
        ['New', ['d1', 'd3', 'd5']],
        ['Won', ['d2']],
      ]),
    );
    const lost = screen.getAllByRole('button').find((el) => el.getAttribute('aria-expanded') === 'false' && /Lost/.test(el.textContent ?? ''));
    expect(lost, 'the lost lane starts collapsed').toBeTruthy();
    fireEvent.click(lost!);
    await vi.waitFor(() =>
      expect(summary(report.mock.calls.at(-1)?.[0])).toEqual([
        ['New', ['d1', 'd3', 'd5']],
        ['Won', ['d2']],
        ['Lost', ['d4']],
      ]),
    );
  });
});
