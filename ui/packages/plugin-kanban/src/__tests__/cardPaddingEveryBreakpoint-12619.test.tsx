/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12619 — a card's reduced padding holds at every breakpoint.
 *
 * The card header wrote `p-2 sm:p-4 pb-2` and the card content `p-2 sm:p-4
 * pt-0`. Tailwind emits the `sm:` rule after the base side rule, so from `sm`
 * up `sm:p-4` padded the header's foot and the content's top back to 16px
 * each: measured in a browser at 1280 px as a blank band between the card's
 * title and its first field line. It was there on main wherever a card had
 * field lines; objectui#12619 gives every list-view card field lines, so every
 * card showed it.
 *
 * The rule pinned is the CLASS of defect, read off the rendered elements
 * rather than one string: wherever a card element pads a side down at the base
 * breakpoint and also carries a responsive `sm:p-*` shorthand, it restates
 * that side at `sm:`. This DOM applies no stylesheet, so the class list is the
 * reading; the shorthand control keeps the rule from passing on a card that
 * has no responsive padding at all.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ObjectKanban } from '../ObjectKanban';
// The board renders inside a `React.lazy` boundary; importing the chunk at
// module scope bills the cold transform to the import phase (objectui#3010).
import '../KanbanImpl';

afterEach(cleanup);

const OBJECT_DEF = {
  name: 'deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
    account: { type: 'text', label: 'Account' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const ROWS = [{ id: 'd1', name: 'First deal', stage: 'open', account: 'Acme', amount: 2000 }];

const adapter = {
  find: vi.fn(async () => ({ data: ROWS })),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => OBJECT_DEF),
} as any;

/** The side tokens a base breakpoint pads down, and their `sm:` restatement. */
function unrestatedSides(el: Element): string[] {
  const classes = new Set(el.className.split(/\s+/).filter(Boolean));
  const hasResponsiveShorthand = [...classes].some((c) => /^sm:p-\d/.test(c));
  if (!hasResponsiveShorthand) return [];
  return [...classes]
    .filter((c) => /^p[tbrlxy]-\d/.test(c))
    .filter((c) => !classes.has(`sm:${c}`));
}

describe('a card keeps its reduced padding at every breakpoint (objectui#12619)', () => {
  it('the header\'s foot and the content\'s top are restated at `sm:`', async () => {
    render(
      <ObjectKanban
        schema={{ type: 'object-kanban', objectName: 'deal', groupBy: 'stage', cardFields: ['account', 'amount'] } as any}
        dataSource={adapter}
        data={ROWS}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    const card = screen.getByRole('listitem', { name: 'First deal' });
    const content = card.querySelector('dl')?.parentElement;
    const header = content?.previousElementSibling;
    expect(content).toBeTruthy();
    expect(header).toBeTruthy();

    // CONTROL: both elements carry the responsive shorthand the rule is about.
    expect(header!.className).toMatch(/(^|\s)sm:p-4(\s|$)/);
    expect(content!.className).toMatch(/(^|\s)sm:p-4(\s|$)/);
    // And both pad a side down at the base breakpoint.
    expect(header!.className).toMatch(/(^|\s)pb-2(\s|$)/);
    expect(content!.className).toMatch(/(^|\s)pt-0(\s|$)/);

    expect({ header: unrestatedSides(header!), content: unrestatedSides(content!) }).toEqual({ header: [], content: [] });
  });
});
