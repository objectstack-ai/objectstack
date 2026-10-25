/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Integration DOM test for #2792: render the real KanbanRenderer (flat-data
 * adapter → lazy KanbanImpl) with an off-column record and assert the
 * "Uncategorized" lane and its card actually appear on screen — the outcome
 * the pure bucketing test can't observe (hook wiring + real render).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { KanbanRenderer } from './index';

// Pay the board's lazy chunk at import time, not inside a `findBy` budget
// (AGENTS.md §测试纪律). `KanbanRenderer` renders
// `React.lazy(() => import('./KanbanImpl'))` behind a Suspense boundary, and
// both assertions below sit AFTER that boundary — the card has to be on screen
// before it can be found. Importing `./index` alone does NOT warm it: that only
// registers the lazy factory, it never executes the dynamic import. Under full
// CI parallelism a first `import()` has been measured at ~976ms against RTL's
// 1000ms default, so without this the suite would race the module loader. The
// specifier must stay byte-identical to the one in `./index` — ESM caches by
// resolved specifier, which is what makes the component's own lazy factory
// resolve immediately.
import './KanbanImpl';

const columns = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
];

describe('KanbanRenderer — uncategorized lane (#2792)', () => {
  it('renders an Uncategorized lane holding the off-column card', async () => {
    render(
      <KanbanRenderer
        schema={{
          // `object-kanban` — the bare `kanban` node type key RETIRED
          // (objectui#8802). Inert here (this is a props bag, not a document),
          // but a fixture must not spell a retired key.
          type: 'object-kanban',
          groupBy: 'status',
          columns,
          data: [
            { id: '1', title: 'On the board', status: 'todo' },
            { id: '2', title: 'Orphaned card', status: 'done' }, // no 'done' column
          ],
        }}
      />,
    );

    // Lazy KanbanImpl resolves through Suspense.
    expect(await screen.findByText('Orphaned card')).toBeInTheDocument();
    expect(screen.getByText('On the board')).toBeInTheDocument();
    // The fallback lane header is present — the orphan is visible, not dropped.
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
  });

  it('renders no Uncategorized lane when every record matches a column', async () => {
    render(
      <KanbanRenderer
        schema={{
          // `object-kanban` — the bare `kanban` node type key RETIRED
          // (objectui#8802). Inert here (this is a props bag, not a document),
          // but a fixture must not spell a retired key.
          type: 'object-kanban',
          groupBy: 'status',
          columns,
          data: [{ id: '1', title: 'Matches', status: 'in_progress' }],
        }}
      />,
    );

    expect(await screen.findByText('Matches')).toBeInTheDocument();
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument();
  });
});
