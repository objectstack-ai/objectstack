/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5183 — a kanban card badge and the grid cell beside it must render
 * one option in one colour.
 *
 * objectui#5141 taught the grid's cell renderer to honour an author-declared
 * hex; the kanban card kept resolving through `getBadgeColorClasses`, which
 * returns a class string and so cannot carry a runtime colour. The same
 * option then rendered one colour in a grid cell and another on the card
 * beside it — the user-visible bar from #5141's reporter.
 *
 * ── The comparison surface ───────────────────────────────────────────────
 * `getCellRenderer('select')` is the exact lookup ObjectGrid performs for a
 * select cell, so the component rendered here IS the desktop grid's cell —
 * not a re-implementation of it. `plugin-kanban` does not (and should not)
 * depend on `plugin-grid`, so the shared renderer is the honest join point.
 *
 * ── The card badge travels as DATA ───────────────────────────────────────
 * The card badge crosses a data boundary (`KanbanCard.badges[]`) rather than
 * being a JSX element the resolver can style directly, which is why the class
 * needed a `colorStyle` sibling to travel with it. A test that only checked
 * the className would have passed with the style dropped in transit — the
 * className is a build-time-static Tailwind string, identical on both
 * surfaces, and the custom properties are the entire payload.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { getCellRenderer } from '@object-ui/fields';
// Registers `object-kanban`.
import './index';
// The board renders inside `KanbanRenderer`'s `React.lazy` boundary. Importing
// the chunk at module scope bills the cold transform to the import phase
// (unbounded) instead of racing a `waitFor` budget under full parallelism —
// the objectui#3010 rule, same specifier as `index.tsx`'s factory so ESM's
// module cache makes that factory resolve immediately.
import './KanbanImpl';

/** The reported pair from #5141: one palette family, two distinct colours. */
const EMERALD = '#2ecc71';
const FOREST = '#1e8449';

const OPTIONS = [
  { value: 'emerald', label: 'Emerald', color: EMERALD },
  { value: 'forest', label: 'Forest', color: FOREST },
];

const PRIORITY_FIELD = { name: 'priority', type: 'select', label: 'Priority', options: OPTIONS };

const ROWS = [
  { id: 'c1', name: 'Card one', status: 'open', priority: 'emerald' },
  { id: 'c2', name: 'Card two', status: 'open', priority: 'forest' },
];

const LANES = [{ id: 'open', title: 'Open' }];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'test_object',
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        status: { type: 'text' },
        priority: PRIORITY_FIELD,
      },
    }),
  } as any;
}

afterEach(cleanup);

const BADGE_VARS = ['--os-badge-bg', '--os-badge-fg', '--os-badge-border'] as const;

type BadgeVars = Record<string, string>;

/** Custom properties declared by the badge-ish element labelled `label`. */
function badgeVarsFor(root: HTMLElement, label: string): BadgeVars | undefined {
  const carrier = Array.from(root.querySelectorAll<HTMLElement>('[style]')).find(
    (el) =>
      el.textContent?.trim() === label &&
      el.style.getPropertyValue('--os-badge-bg').trim() !== '',
  );
  if (!carrier) return undefined;
  const out: BadgeVars = {};
  for (const name of BADGE_VARS) out[name] = carrier.style.getPropertyValue(name).trim();
  return out;
}

/** The grid's select cell, obtained through the registry the grid itself uses. */
function renderGridCell(value: string) {
  const SelectCell = getCellRenderer('select');
  return render(<SelectCell value={value} field={PRIORITY_FIELD as any} />);
}

async function renderBoard() {
  const adapter = makeDataSource();
  const result = render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            objectName: 'test_object',
            groupBy: 'status',
            columns: LANES,
            cardFields: ['priority'],
          } as any
        }
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain('Card one'));
  return result;
}

describe('objectui#5183 — kanban card badges agree with the grid cell', () => {
  it('a declared hex resolves identically on the card and in the cell', async () => {
    const cell = renderGridCell('emerald');
    const cellVars = badgeVarsFor(cell.container, 'Emerald');
    cleanup();

    const board = await renderBoard();
    const cardVars = badgeVarsFor(board.container, 'Emerald');

    // Both surfaces resolved SOMETHING. Without this, two `undefined`s would
    // read as agreement — and "no style at all" is exactly the pre-fix state.
    expect(cellVars?.['--os-badge-bg']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cardVars?.['--os-badge-bg']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cardVars).toEqual(cellVars);
  });

  it('two same-family hexes stay distinguishable on the card', async () => {
    const board = await renderBoard();
    const emerald = badgeVarsFor(board.container, 'Emerald');
    const forest = badgeVarsFor(board.container, 'Forest');

    // `hexToPaletteName` buckets both into `green`: under the class-only path
    // the two cards were byte-identical, which is agreement without fidelity.
    expect(emerald?.['--os-badge-bg']).toBeTruthy();
    expect(forest?.['--os-badge-bg']).toBeTruthy();
    expect(emerald!['--os-badge-bg']).not.toBe(forest!['--os-badge-bg']);
  });
});
