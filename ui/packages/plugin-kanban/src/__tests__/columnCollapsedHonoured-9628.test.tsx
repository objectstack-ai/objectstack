/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `columns[].collapsed` is HONOURED BY THE REGISTERED BOARD — objectui#9628.
 *
 * ## The defect this file reproduces
 *
 * The key is declared on BOTH published faces of the surviving `object-kanban`
 * arm — the lane element of `ObjectKanbanSchema` (`@object-ui/types`
 * `objectql.ts` + its Zod mirror) and the runtime lane `KanbanColumn`
 * (`complex.ts` + `complex.zod.ts`) — and, until this card, was read by
 * `KanbanEnhanced` alone: a module NO production source imports (two test files
 * do). The board an authored document actually reaches is `KanbanImpl`, whose
 * only collapse is the SWIMLANE row's, held in viewer state under
 * `objectui:kanban-collapsed:<swimlaneField>` and never keyed to a lane's
 * declared `collapsed`. So an author wrote the key, both faces took it, and the
 * board did nothing — the ADR-0049 declared-but-unhonoured shape.
 *
 * ## The repair direction, and why it is this one
 *
 * Honouring at the reader, ⛔ not retiring the key. Retirement narrows a
 * published accept set (a maintainer floor), and here it would also strand
 * objectui#8801's tombstone, which names THIS key as where lane collapse lives.
 * Honouring moves no accept set: both faces already declare the member, and the
 * protocol (`@objectstack/spec` `ObjectKanbanPropsSchema.columns`) declares the
 * lane element as `z.unknown()`, so it neither names nor refuses the key.
 *
 * ## What "honoured" means here, and why it is the sibling's meaning
 *
 * `KanbanEnhanced` — the implementation the docblocks pointed authors at —
 * renders a `collapsed` lane narrow, hides its cards, and lets the viewer
 * toggle it back. This board now gives the key that same meaning, so the
 * declaration means one thing on the platform rather than two. The authored
 * value is the lane's INITIAL state; a viewer's own toggle wins after that
 * (AGENTS.md #8 — and a lane whose cards could never be reached again would be
 * a worse board than the one that ignored the key).
 *
 * ⚠️ The toggle appears only on a lane that AUTHORED `collapsed: true`. A board
 * that authors the key nowhere renders exactly as it did before this card —
 * which is what keeps every existing pin in this package green, and is the
 * reason an authored `collapsed: false` is not observably different from an
 * omitted one.
 *
 * ## The firing controls, in the same run
 *
 * Two, both on the authored lane objects this very test hands in:
 *
 *   - `className` on the SAME lane that declares `collapsed` — proves that
 *     lane's authored members reach the reader, so an inert `collapsed` is not
 *     a plumbing failure of that one lane;
 *   - `limit` on a SIBLING lane — proves the board renders authored lane
 *     members into the DOM at all (the `Full` badge is painted by that member
 *     alone).
 *
 * Before the repair both controls were green while every `collapsed`
 * expectation below was red, which is what made the zero a reading.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { KanbanColumnSchema, ObjectKanbanSchema } from '@object-ui/types/zod';

import { KanbanRenderer } from '../index';
// Pay the board's lazy chunk at import time rather than inside a `findBy`
// budget — the specifier must stay byte-identical to `../index`'s, which is
// what makes that module's own `React.lazy` factory resolve immediately.
import '../KanbanImpl';

/** The authored lanes. `todo` collapses; `doing` carries the sibling control. */
const COLUMNS = [
  { id: 'todo', title: 'To Do', collapsed: true, className: 'repro-9628-lane' },
  { id: 'doing', title: 'Doing', limit: 1 },
];

const DATA = [
  { id: 'r1', title: 'Alpha', status: 'todo' },
  { id: 'r2', title: 'Beta', status: 'doing' },
];

function renderBoard() {
  return render(
    <KanbanRenderer
      schema={{ type: 'object-kanban', groupBy: 'status', columns: COLUMNS, data: DATA }}
    />,
  );
}

/** The lane box, found by the `role="group"` every column view carries. */
const lane = (title: string) => screen.getByRole('group', { name: title });

describe('both published faces declare the key (objectui#9628)', () => {
  it('the `object-kanban` lane element accepts `collapsed`', () => {
    const parsed = ObjectKanbanSchema.safeParse({
      type: 'object-kanban',
      data: [],
      groupBy: 'status',
      columns: [{ id: 'todo', title: 'To Do', collapsed: true }],
    });
    expect(parsed.success).toBe(true);
    expect(
      parsed.success && (parsed.data as { columns: Array<{ collapsed?: boolean }> }).columns[0].collapsed,
    ).toBe(true);
  });

  it('the runtime lane mirror accepts `collapsed`', () => {
    const parsed = KanbanColumnSchema.safeParse({
      id: 'todo',
      title: 'To Do',
      cards: [],
      collapsed: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && (parsed.data as { collapsed?: boolean }).collapsed).toBe(true);
  });

  it('CONTROL — an undeclared lane key is dropped rather than kept, so the two above are readings', () => {
    const parsed = KanbanColumnSchema.safeParse({
      id: 'todo',
      title: 'To Do',
      cards: [],
      collapsedd: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'collapsedd' in (parsed.data as object)).toBe(false);
  });
});

describe('the registered board honours `columns[].collapsed` (objectui#9628)', () => {
  it('renders the declared lane collapsed, with its cards withheld', async () => {
    renderBoard();

    // The board is on screen — asserted through the sibling lane's card, so a
    // failure below cannot be "nothing rendered".
    expect(await screen.findByText('Beta')).toBeInTheDocument();

    // CONTROL 1 — this very lane's authored `className` reached the reader.
    expect(lane('To Do')).toHaveClass('repro-9628-lane');

    // CONTROL 2 — an authored lane member reaches the DOM on the sibling lane.
    // The `Full` badge is painted by `column.limit` alone: no limit, no badge.
    const doing = lane('Doing');
    expect(within(doing).getByText('Full')).toBeInTheDocument();

    // THE SUBJECT — the collapsed lane withholds its cards and says so.
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'To Do cards' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'To Do' })).toHaveAttribute('aria-expanded', 'false');

    // The sibling lane is untouched: no disclosure, cards on screen.
    expect(screen.queryByRole('button', { name: 'Doing' })).not.toBeInTheDocument();
    expect(within(doing).getByRole('list', { name: 'Doing cards' })).toBeInTheDocument();
  });

  it('the viewer can expand it again, and the authored value does not win back', async () => {
    renderBoard();
    expect(await screen.findByText('Beta')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'To Do' });
    act(() => { toggle.click(); });

    expect(screen.getByRole('button', { name: 'To Do' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(within(lane('To Do')).getByRole('list', { name: 'To Do cards' })).toBeInTheDocument();
  });

  it('honours it on the SWIMLANE layout too, in the title row and in every lane row', async () => {
    render(
      <KanbanRenderer
        schema={{
          type: 'object-kanban',
          groupBy: 'status',
          swimlaneField: 'region',
          columns: COLUMNS,
          data: [
            { id: 'r1', title: 'Alpha', status: 'todo', region: 'west' },
            { id: 'r2', title: 'Beta', status: 'doing', region: 'west' },
          ],
        }}
      />,
    );

    // CONTROL — the swimlane layout is the one on screen, and the sibling
    // column's cells are painted in the lane row.
    expect(await screen.findByText('Beta')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Doing - west cards' })).toBeInTheDocument();

    // THE SUBJECT — the collapsed column is withheld from the lane row, and the
    // title row carries its disclosure.
    expect(screen.queryByRole('list', { name: 'To Do - west cards' })).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'To Do' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    act(() => { toggle.click(); });
    expect(screen.getByRole('list', { name: 'To Do - west cards' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('a board that authors the key nowhere renders no disclosure at all', async () => {
    render(
      <KanbanRenderer
        schema={{
          type: 'object-kanban',
          groupBy: 'status',
          columns: [{ id: 'todo', title: 'To Do' }],
          data: [{ id: 'r1', title: 'Alpha', status: 'todo' }],
        }}
      />,
    );

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'To Do' })).not.toBeInTheDocument();
  });
});
