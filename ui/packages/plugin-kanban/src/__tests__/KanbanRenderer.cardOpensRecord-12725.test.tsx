// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725, objectui#12888 — on the running board, a card is a door to
 * its record: a click opens it, and so does Enter on a focused card. The card
 * also takes the press, which is what its drag sensor starts from.
 *
 * These were the CONTROLS of Studio's card-selection pins, which retired with
 * Studio's Interfaces column (objectstack#36502); the runtime behaviour they
 * guarded stays, so they live here, beside the board.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KanbanRenderer } from '../index';
// Cards render inside `KanbanRenderer`'s `React.lazy` boundary: imported at
// module scope so the cold transform is billed to the import phase (objectui#3010).
import '../KanbanImpl';

const LANES = [
  { id: 'open', title: 'Open' },
  { id: 'done', title: 'Done' },
];
const ROWS = [
  { id: 'r1', title: 'Bob', status: 'open', priority: 'high' },
  { id: 'r2', title: 'Ada', status: 'open', priority: 'low' },
  { id: 'r3', title: 'Cyd', status: 'done', priority: 'low' },
];

/** What a card click asks the runtime to open. */
const openRecord = vi.fn();

function Board() {
  return (
    <KanbanRenderer
      schema={{
        type: 'object-kanban',
        groupBy: 'status',
        columns: LANES,
        data: ROWS,
        onCardClick: (card: { id: string }) => openRecord(card.id),
      } as never}
    />
  );
}

async function bobCard(): Promise<HTMLElement> {
  return (await screen.findByText('Bob', undefined, { timeout: 4000 })).closest('[data-kanban-card]') as HTMLElement;
}

beforeEach(() => {
  openRecord.mockClear();
});

describe('a card on the running board opens its record (objectui#12725, objectui#12888)', () => {
  it('a click opens the record, and the card takes the press', async () => {
    render(<Board />);
    const bob = await bobCard();
    expect(bob).toHaveAttribute('data-kanban-card', 'r1');
    const press = vi.fn();
    bob.addEventListener('pointerdown', press);

    fireEvent.pointerDown(bob);
    fireEvent.click(bob);

    expect(press).toHaveBeenCalledTimes(1);
    expect(openRecord).toHaveBeenCalledWith('r1');
  });

  it('Enter on a focused card opens the record', async () => {
    render(<Board />);
    const bob = await bobCard();
    bob.focus();

    fireEvent.keyDown(bob, { key: 'Enter' });

    expect(openRecord).toHaveBeenCalledWith('r1');
  });
});
