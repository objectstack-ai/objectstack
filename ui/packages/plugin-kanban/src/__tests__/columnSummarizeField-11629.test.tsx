/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11629 — each column header renders the sum of the view's
 * `summarizeField` over the column's rows.
 *
 * `@objectstack/spec` declares `summarizeField` on the view-level
 * `KanbanConfig` ("Field to sum at top of column (e.g. amount)"), the showcase
 * authors it on its task board, and `ListView`'s kanban branch relays it onto
 * the `object-kanban` node it generates (pinned in `plugin-list`'s
 * `ListView.test.tsx`, "does not leak the vocabulary keys onto the component
 * schema"). Nothing under this package read it, so the board showed the card
 * count and no total. The nodes below are shaped as that relay writes them:
 * the board keys plus `summarizeField`.
 *
 * Every row reads the header the way a person reads it — the rendered text of
 * the total beside the count — never a flag or a context value.
 *
 * The controls that make each reading a verdict:
 *   - `NO SUMMARIZE FIELD` is the same board without the key: no total, and
 *     the header's controls are exactly the count badge they were before.
 *   - `UNSATURATED` keeps the bare total where the windowed row adds `+`.
 *   - `READABLE` paints totals where `DENIED` paints none, on one stub.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';

/** Stable stub identity — `ObjectKanban` carries `perms` in its dependency lists. */
const { permsStub, permsState } = vi.hoisted(() => {
  const permsState: { isLoaded: boolean; readable: string[] } = { isLoaded: false, readable: [] };
  return {
    permsState,
    permsStub: {
      get isLoaded() { return permsState.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? permsState.readable.includes(field) : true,
      check: () => ({ allowed: true }),
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      systemPermissions: undefined,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as never };
});

// Registers `object-kanban`. Module scope, not a hook: the import IS the
// registration (AGENTS.md's test-discipline section).
import '../index';
// The board renders inside `KanbanBoardCore`'s `React.lazy` boundary; importing
// the chunk at module scope bills the cold transform to the import phase
// instead of racing a `waitFor` budget (objectui#3010).
import '../KanbanImpl';

afterEach(() => {
  cleanup();
  permsState.isLoaded = false;
  permsState.readable = [];
});

const OBJECT = 'task';

const OBJECT_SCHEMA = {
  name: OBJECT,
  label: 'Task',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    region: { type: 'text', label: 'Region' },
    // A `number` with no `scale` — the showcase's `estimate_hours` shape.
    hours: { type: 'number', label: 'Estimate (h)' },
    amount: { type: 'currency', label: 'Amount', currency: 'USD' },
  },
};

const LANES = [
  { id: 'open', title: 'Open' },
  { id: 'won', title: 'Won' },
  { id: 'lost', title: 'Lost' },
];

/**
 * Mixed values and nulls. `open` holds a number, a `null`, a numeric string
 * and a row that lacks the field; `won` holds one number; `lost` is empty.
 */
const MIXED_ROWS = [
  { id: 't1', name: 'Spec', stage: 'open', region: 'east', hours: 10, amount: 1000 },
  { id: 't2', name: 'Build', stage: 'open', region: 'west', hours: null, amount: null },
  { id: 't3', name: 'Ship', stage: 'open', region: 'east', hours: '2.5', amount: 250.5 },
  { id: 't4', name: 'Tidy', stage: 'open', region: 'west' },
  { id: 't5', name: 'Win', stage: 'won', region: 'east', hours: 4, amount: 1250 },
];

type Row = Record<string, unknown>;

function makeAdapter(rows: Row[]) {
  return {
    find: vi.fn(async (_object: string, _query?: Record<string, unknown>) => ({ data: rows })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
  };
}

const BOARD = {
  type: 'object-kanban',
  objectName: OBJECT,
  groupBy: 'stage',
  columns: LANES,
};

function renderBoard(rows: Row[], extra: Record<string, unknown> = {}) {
  const adapter = makeAdapter(rows);
  const view = render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer schema={{ ...BOARD, ...extra } as never} />
    </SchemaRendererProvider>,
  );
  return { ...view, adapter };
}

/** The flat header's controls: the element holding the count badge (and now the total). */
function headerControls(container: HTMLElement, laneId: string): HTMLElement {
  const title = container.querySelector(`#kanban-col-${laneId}`);
  const controls = title?.parentElement?.lastElementChild;
  if (!controls) throw new Error(`no flat header for ${laneId}`);
  return controls as HTMLElement;
}

/** The text a sighted reader sees in a total: everything but its screen-reader label. */
function visibleText(total: Element): string {
  const clone = total.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.sr-only').forEach((n) => n.remove());
  return (clone.textContent ?? '').trim();
}

/** The total painted in one flat column header, or `null` when there is none. */
function flatTotal(container: HTMLElement, laneId: string): string | null {
  const total = headerControls(container, laneId).querySelector('[data-kanban-lane-total]');
  return total ? visibleText(total) : null;
}

/** Wait until the board has painted the card that proves its rows arrived. */
async function cardsPainted(container: HTMLElement, cardTitle: string) {
  await waitFor(() =>
    expect(container.querySelector(`[role="listitem"][aria-label="${cardTitle}"]`)).not.toBeNull(),
  );
}

describe('objectui#11629 — the column header totals `summarizeField`', () => {
  it('sums mixed values and nulls, counts absent and null as 0, and totals an empty column 0', async () => {
    const { container } = renderBoard(MIXED_ROWS, { summarizeField: 'hours' });
    await cardsPainted(container, 'Win');

    // 10 + null + '2.5' + absent = 12.5; the numeric string counts as the
    // number the card cell shows for it.
    await waitFor(() => expect(flatTotal(container, 'open')).toBe('12.5'));
    expect(flatTotal(container, 'won')).toBe('4');
    // The empty column still has a total, and it is 0.
    expect(flatTotal(container, 'lost')).toBe('0');
    // Null and absent never surface as NaN anywhere on the board.
    expect(container.textContent).not.toContain('NaN');
  });

  it('names the total by the field label, for the tooltip and the screen reader', async () => {
    const { container } = renderBoard(MIXED_ROWS, { summarizeField: 'hours' });
    await cardsPainted(container, 'Win');
    await waitFor(() => expect(flatTotal(container, 'won')).toBe('4'));

    const total = headerControls(container, 'won').querySelector('[data-kanban-lane-total]')!;
    expect(total.getAttribute('title')).toBe('Estimate (h)');
    expect(total.querySelector('.sr-only')?.textContent?.trim()).toBe('Estimate (h)');
  });

  it('NO SUMMARIZE FIELD: the same board paints no total, and the header keeps only its count badge', async () => {
    const { container } = renderBoard(MIXED_ROWS);
    await cardsPainted(container, 'Win');

    expect(container.querySelectorAll('[data-kanban-lane-total]')).toHaveLength(0);
    for (const lane of LANES) {
      const controls = headerControls(container, lane.id);
      // Exactly the count badge — the DOM every header had before this card.
      expect(controls.children).toHaveLength(1);
      expect(controls.textContent?.trim()).toBe(lane.id === 'open' ? '4' : lane.id === 'won' ? '1' : '0');
    }
  });

  it('formats the total with the field\'s own cell renderer — a currency total reads as the cards read it', async () => {
    const { container } = renderBoard(MIXED_ROWS, { summarizeField: 'amount', cardFields: ['amount'] });
    await cardsPainted(container, 'Win');

    // `won` holds one card, so its total and that card's amount cell are the
    // same value through the same renderer: the two must read identically.
    const winCard = container.querySelector('[role="listitem"][aria-label="Win"]')!;
    await waitFor(() => expect(winCard.querySelector('dd')?.textContent).toBe('$1,250.00'));
    await waitFor(() => expect(flatTotal(container, 'won')).toBe(winCard.querySelector('dd')!.textContent));

    // 1000 + null + 250.5 + absent, written as currency, not as a bare number.
    expect(flatTotal(container, 'open')).toBe('$1,250.50');
    expect(flatTotal(container, 'lost')).toBe('$0.00');
  });

  it('rounds a sum to the widest input, so 0.1 + 0.2 reads 0.3 on a field with no declared scale', async () => {
    const rows = [
      { id: 'r1', name: 'One', stage: 'open', hours: 0.1 },
      { id: 'r2', name: 'Two', stage: 'open', hours: 0.2 },
    ];
    const { container } = renderBoard(rows, { summarizeField: 'hours' });
    await cardsPainted(container, 'Two');

    await waitFor(() => expect(flatTotal(container, 'open')).toBe('0.3'));
  });

  it('shows no total for a lane holding a value that is not a number — never NaN', async () => {
    const rows = [
      { id: 'r1', name: 'Odd', stage: 'open', hours: 'about three' },
      { id: 'r2', name: 'Even', stage: 'won', hours: 3 },
    ];
    const { container } = renderBoard(rows, { summarizeField: 'hours' });
    await cardsPainted(container, 'Even');

    // CONTROL: the other lane on the same board does total.
    await waitFor(() => expect(flatTotal(container, 'won')).toBe('3'));
    expect(flatTotal(container, 'open')).toBeNull();
    expect(container.textContent).not.toContain('NaN');
  });
});

describe('objectui#11629 — what the total covers is said, never silently partial', () => {
  const WINDOW = 3;
  const windowRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `w${i}`, name: `Row ${i}`, stage: 'open', hours: 2 }));

  it('WINDOWED: a saturated fetch marks the total `+`, exactly as it marks the count', async () => {
    const { container, adapter } = renderBoard(windowRows(WINDOW), { summarizeField: 'hours', limit: WINDOW });
    await cardsPainted(container, 'Row 2');

    await waitFor(() => expect(flatTotal(container, 'open')).toBe('6+'));
    // The count badge beside it carries the same marker.
    expect(headerControls(container, 'open').firstElementChild?.textContent?.trim()).toBe('3+');
    // Non-vacuity: the request really was windowed.
    expect(adapter.find.mock.calls[0][1]?.$top).toBe(WINDOW);
  });

  it('UNSATURATED CONTROL: a fetch that came back short keeps the bare total', async () => {
    const { container } = renderBoard(windowRows(WINDOW - 1), { summarizeField: 'hours', limit: WINDOW });
    await cardsPainted(container, 'Row 1');

    await waitFor(() => expect(flatTotal(container, 'open')).toBe('4'));
  });
});

describe('objectui#11629 — the swimlane layout totals each column in its title row', () => {
  it('paints one total per column, over every lane\'s cards in that column', async () => {
    const { container } = renderBoard(MIXED_ROWS, { summarizeField: 'hours', swimlaneField: 'region' });
    await cardsPainted(container, 'Win');

    const region = container.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Kanban board with swimlanes');
    const titleRow = region!.firstElementChild as HTMLElement;

    await waitFor(() =>
      expect(
        [...titleRow.querySelectorAll('[data-kanban-lane-total]')].map(visibleText),
      ).toEqual(['12.5', '4', '0']),
    );
  });
});

describe('objectui#11629 — no total the viewer could not have computed', () => {
  it('DENIED: a field the viewer may not read gets no total', async () => {
    permsState.isLoaded = true;
    permsState.readable = ['name', 'stage'];
    const { container } = renderBoard(MIXED_ROWS, { summarizeField: 'hours' });
    await cardsPainted(container, 'Win');

    expect(container.querySelectorAll('[data-kanban-lane-total]')).toHaveLength(0);
  });

  it('READABLE CONTROL: the same stub granting the field paints the totals', async () => {
    permsState.isLoaded = true;
    permsState.readable = ['name', 'stage', 'hours'];
    const { container } = renderBoard(MIXED_ROWS, { summarizeField: 'hours' });
    await cardsPainted(container, 'Win');

    await waitFor(() => expect(flatTotal(container, 'open')).toBe('12.5'));
  });

  it('a field the object does not declare gets no total, rather than a column of zeros', async () => {
    const { container } = renderBoard(MIXED_ROWS, { summarizeField: 'not_a_field' });
    await cardsPainted(container, 'Win');

    expect(container.querySelectorAll('[data-kanban-lane-total]')).toHaveLength(0);
  });
});
