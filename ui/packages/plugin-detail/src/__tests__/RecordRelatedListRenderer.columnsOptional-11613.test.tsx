/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#11613 — `record:related_list` draws columns whether or not the node
 * authors `columns`, so the registration need not require the key.
 *
 * The spec row (`ComponentPropsMap['record:related_list'].columns`) is
 * optional, and its describe says what an omitted list means: "columns derive
 * from the related object's highlightFields / default list columns". The
 * registration declared `columns` required anyway, so the page compile refused
 * a node the row accepts. Dropping `required` (the console's
 * `related-list-columns-optional-11613.test.ts` pins the compile) is only
 * honest if the node with no authored `columns` still draws a list. This file
 * measures that through the REAL renderer, the real `ElementDataSourceGate`,
 * the real `RelatedList` and the real table, reading rendered header and body
 * cells:
 *
 * 1. The neither node (no `columns`, no named view) draws columns derived from
 *    the related object, with or without an object-only `dataSource` binding.
 *    No hint, no blank, no throw: `RelatedList` reads the unauthored list as
 *    "nothing authored" and derives.
 * 2. The view-bound node (no `columns`, a `dataSource` naming a view) draws the
 *    VIEW's columns, not the derived set.
 * 3. Authored `columns` still win, over the view and over the derivation.
 *
 * Every read waits on a positive body cell first: the derived set cannot exist
 * before the object schema lands, so a table with a cell is a table whose
 * columns are settled.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';

/**
 * Desktop, pinned rather than inherited (the objectui#8399 reason): under the
 * 768 breakpoint a `type="table"` related list renders a card gallery with no
 * header cells, and every assertion here reads them.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => cleanup());

/** The related object: three listable fields plus the foreign key back to the parent. */
const FIELDS = {
  subject: { type: 'text', label: 'Subject' },
  status: { type: 'text', label: 'Status' },
  priority: { type: 'text', label: 'Priority' },
  account_id: { type: 'lookup', label: 'Account', reference: 'account' },
};

/** A saved list view of the related object that lists one column. */
const LIST_VIEWS = {
  open_tasks: { name: 'open_tasks', label: 'Open tasks', columns: ['subject'] },
};

const ROWS = [
  { id: 't1', subject: 'Fix the pump', status: 'open', priority: 'high', account_id: 'ACC-1' },
];

const makeDS = () => ({
  find: vi.fn(async () => ROWS),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS, listViews: LIST_VIEWS })),
});

/** Every rendered header cell's text, in DOM order. */
const headers = () =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

/** Every rendered body cell's text, in DOM order. */
const cellTexts = () => screen.getAllByRole('cell').map((c) => (c.textContent || '').trim());

const waitForCell = (text: string) => waitFor(() => expect(cellTexts()).toContain(text));

/** Render the BLOCK end to end, under a record context for the parent `account`. */
function renderBlock(schema: Record<string, unknown>) {
  return render(
    <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={makeDS() as any}>
      <RecordRelatedListRenderer schema={{ relationshipField: 'account_id', ...schema } as any} />
    </RecordContextProvider>,
  );
}

describe('objectui#11613 — a record:related_list with no authored columns still draws columns', () => {
  it('the neither node (no columns, no view) draws columns derived from the related object', async () => {
    const { container } = renderBlock({ objectName: 'task' });
    await waitForCell('Fix the pump');

    // Derived from the object's fields: the listable ones, not the foreign key
    // back to this parent, which the walk drops.
    expect(headers()).toEqual(expect.arrayContaining(['Subject', 'Status', 'Priority']));
    expect(headers()).not.toContain('Account');
    expect(cellTexts()).toEqual(expect.arrayContaining(['Fix the pump', 'open', 'high']));
    // Not a hint and not the gate's error panel: the list itself is drawn.
    expect(container.textContent).not.toContain('missing objectName');
    expect(
      container.querySelector('[data-testid="record-related-list-datasource-error"]'),
    ).toBeNull();
  });

  it('the neither node bound by object alone (no view) draws the same derived columns', async () => {
    // An object-only binding supplies no columns: the gate maps a view's
    // field list onto `columns`, and there is no view here.
    renderBlock({ objectName: 'task', dataSource: { object: 'task' } });
    await waitForCell('Fix the pump');

    expect(headers()).toEqual(expect.arrayContaining(['Subject', 'Status', 'Priority']));
    expect(headers()).not.toContain('Account');
  });

  it('the view-bound node with no columns draws the view’s columns, not the derived set', async () => {
    renderBlock({ objectName: 'task', dataSource: { object: 'task', view: 'open_tasks' } });
    await waitForCell('Fix the pump');

    expect(headers()).toEqual(['Subject']);
    expect(cellTexts()).not.toContain('high');
  });

  it('authored columns win over a named view', async () => {
    renderBlock({
      objectName: 'task',
      columns: ['priority'],
      dataSource: { object: 'task', view: 'open_tasks' },
    });
    await waitForCell('high');

    expect(headers()).toEqual(['Priority']);
    expect(cellTexts()).not.toContain('Fix the pump');
  });

  it('authored columns win over the derivation', async () => {
    renderBlock({ objectName: 'task', columns: ['status'] });
    await waitForCell('open');

    expect(headers()).toEqual(['Status']);
    expect(cellTexts()).not.toContain('Fix the pump');
  });
});
