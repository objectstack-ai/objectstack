/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An authored `object-gantt` writes its props in the spec's `properties` bag,
 * and the bag draws what the flat spelling drew (objectui#10859, batch 6).
 *
 * `@object-ui/types` now arms the authored node from
 * `ComponentPropsMap['object-gantt']`: `{ type: 'object-gantt', properties: {
 * … } }` validates, and the flat spelling is refused by name
 * (`object-gantt-properties-bag-10859-b6.test.ts` holds both faces). That move
 * is only safe if the renderer reads the bag, so this file renders the node
 * through the real registry and a recording adapter:
 *
 *  - the bag queries its `objectName` with its own `filter` and `sort`, and
 *    hands the chart one task per returned row, titled by its `gantt` block;
 *  - the flat spellings code still composes — the `gantt` block on the node,
 *    and the flattened `GanttConfig` keys `ObjectView` writes — make the
 *    identical call and hand the chart the same tasks: `SchemaRenderer` hoists
 *    the bag onto the node before `ObjectGantt` reads it;
 *  - a bag bound through the node's `dataSource` queries the bound object;
 *  - a bag on inline rows draws them without a host query;
 *  - control: a bag naming a different object queries that object and never
 *    the fixture's, so the first row cannot pass on a fetch the bag did not
 *    drive.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, DeclaredNode, ObjectGanttBlockNode } from '@object-ui/types';
import { safeValidateSchema } from '@object-ui/types/zod';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

type StandInTask = { id: string | number; title: string; start: Date; end: Date; progress: number };

// The bar canvas is not the subject; the tasks the chart is handed are. The
// stand-in lists them, as the sibling ObjectGantt tests stub the view.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: { tasks: StandInTask[] }) => (
    <ul data-testid="gantt-view">
      {tasks.map((task) => (
        <li
          key={String(task.id)}
          data-testid="gantt-task"
          data-id={String(task.id)}
          data-start={task.start.toISOString()}
          data-end={task.end.toISOString()}
          data-progress={task.progress}
        >
          {task.title}
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import './index';

const GANTT = { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name', progressField: 'progress' };
// `as const` keeps `operator` the literal the bag's filter row declares; a
// widened `string` is refused there (objectui#8347 took away the index
// signature that used to admit the bag on the post-hoist node type).
const FILTER = [{ field: 'status', operator: 'equals' as const, value: 'open' }];
const SORT: Array<{ field: string; order: 'asc' | 'desc' }> = [{ field: 'name', order: 'desc' }];
const ROWS = [
  { id: 't1', name: 'Design', start_date: '2026-03-02', end_date: '2026-03-06', progress: 100, status: 'open' },
  { id: 't2', name: 'Build', start_date: '2026-03-09', end_date: '2026-03-20', progress: 40, status: 'open' },
];

/** The authored spelling, spec-valid. */
const BAG: ObjectGanttBlockNode = { type: 'object-gantt', properties: { objectName: 'task', gantt: GANTT, filter: FILTER, sort: SORT } };
/** The same props written flat, with the `gantt` block — what a code composer can build. */
const FLAT: DeclaredNode = { type: 'object-gantt', objectName: 'task', gantt: GANTT, filter: FILTER, sort: SORT };
/** The flattened `GanttConfig` keys `ObjectView` writes onto the node it composes. */
const FLAT_CONFIG: DeclaredNode = { type: 'object-gantt', objectName: 'task', ...GANTT, filter: FILTER, sort: SORT };
/** The bag with its object supplied by the node's binding instead. */
const BOUND_BAG: DeclaredNode = { type: 'object-gantt', dataSource: { object: 'task' }, properties: { gantt: GANTT } };
/** The bag on inline rows. */
const INLINE_BAG: DeclaredNode = { type: 'object-gantt', properties: { staticData: ROWS, gantt: GANTT } };

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockImplementation(async (name: string) => ({
      name,
      fields: {
        name: { type: 'text' },
        start_date: { type: 'date' },
        end_date: { type: 'date' },
        progress: { type: 'number' },
        status: { type: 'text' },
      },
    })),
  };
}

function renderNode(schema: DeclaredNode) {
  const adapter = makeAdapter();
  const view = render(
    <SchemaRendererProvider dataSource={adapter as unknown as DataSource}>
      {/* No cast (objectui#11466): each fixture is a `DeclaredNode`. The bag
          spellings are the authored `object-gantt` node; `FLAT` and
          `FLAT_CONFIG` are the `ObjectGanttSchema` twin, the node as code
          composes it, which the validator refuses as authored metadata and
          the renderer reads all the same (objectui#11355). */}
      <SchemaRenderer schema={schema} />
    </SchemaRendererProvider>,
  );
  return { adapter, ...view };
}

/** The tasks the chart was handed, once it has been handed all of them. */
async function tasksOf(container: HTMLElement, count: number) {
  await waitFor(() => expect(container.querySelectorAll('[data-testid="gantt-task"]')).toHaveLength(count));
  return Array.from(container.querySelectorAll('[data-testid="gantt-task"]')).map((el) => ({
    id: el.getAttribute('data-id'),
    title: el.textContent,
    start: el.getAttribute('data-start'),
    end: el.getAttribute('data-end'),
    progress: el.getAttribute('data-progress'),
  }));
}

describe('object-gantt renders from its `properties` bag (objectui#10859 batch 6)', () => {
  it('the fixtures are the spellings the validator now tells apart (lit control)', () => {
    expect(safeValidateSchema(BAG).success).toBe(true);
    expect(safeValidateSchema(BOUND_BAG).success).toBe(true);
    expect(safeValidateSchema(INLINE_BAG).success).toBe(true);
    expect(safeValidateSchema(FLAT).success).toBe(false);
    expect(safeValidateSchema(FLAT_CONFIG).success).toBe(false);
  });

  it('the bag queries its object with its own filter and sort, and hands the chart one task per row', async () => {
    const { adapter, container } = renderNode(BAG);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, { $filter?: unknown; $orderby?: unknown }];
    expect(object).toBe('task');
    expect(JSON.stringify(params.$filter)).toContain('status');
    expect(params.$orderby).toEqual({ name: 'desc' });
    const tasks = await tasksOf(container, ROWS.length);
    expect(tasks.map((task) => task.title).sort()).toEqual(['Build', 'Design']);
  });

  it.each([
    ['the `gantt` block on the node', FLAT],
    ['the flattened `GanttConfig` keys', FLAT_CONFIG],
  ] as const)('the flat spelling a composer builds (%s) makes the identical call and hands the chart the same tasks', async (_label, flatNode) => {
    const bag = renderNode(BAG);
    await waitFor(() => expect(bag.adapter.find).toHaveBeenCalled());
    const bagTasks = await tasksOf(bag.container, ROWS.length);
    bag.unmount();
    const flat = renderNode(flatNode);
    await waitFor(() => expect(flat.adapter.find).toHaveBeenCalled());
    const flatTasks = await tasksOf(flat.container, ROWS.length);
    expect(flat.adapter.find.mock.calls[0]).toEqual(bag.adapter.find.mock.calls[0]);
    expect(flatTasks).toEqual(bagTasks);
  });

  it('a bag bound through the node\'s `dataSource` queries the bound object', async () => {
    const { adapter, container } = renderNode(BOUND_BAG);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('task');
    await tasksOf(container, ROWS.length);
  });

  it('a bag on inline rows draws them, and the host adapter is never queried', async () => {
    const { adapter, container } = renderNode(INLINE_BAG);
    const tasks = await tasksOf(container, ROWS.length);
    expect(tasks.map((task) => task.title).sort()).toEqual(['Build', 'Design']);
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('control: a bag naming another object queries that object, never the fixture\'s', async () => {
    const { adapter } = renderNode({ ...BAG, properties: { ...BAG.properties, objectName: 'milestone' } });
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const objects = adapter.find.mock.calls.map((call) => call[0]);
    expect(objects).toContain('milestone');
    expect(objects).not.toContain('task');
  });
});
