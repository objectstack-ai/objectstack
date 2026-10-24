// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (the remainder, item 3) — the AI copilot's mark on an array
 * element it added is drawn INSIDE that element's row, by the two widgets
 * Studio's list-view properties draw arrays with:
 *
 *  - `WIDGETS['field-multi']` (a kanban card's fields, `kanban.columns`);
 *  - `FieldsListEditor` (a view's `columns`), whose rows are `FieldListRow`.
 *
 * Each takes the marked set through the optional `copilotAdded` prop. Pinned:
 *  - a marked element's row holds the draft chip; a published (unmarked) row
 *    holds none;
 *  - with no `copilotAdded`, the widget draws exactly what it draws when the
 *    set marks nothing it holds: the prop's absence changes nothing.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';

// `useObjectFields` short-circuits the fetch when handed a catalog, but still
// constructs the shared metadata client: stubbed so no test reaches the network
// (the mechanism `FieldsListEditor.fieldLabels-12693.test.tsx` uses).
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { FieldsListEditor } from './FieldsListEditor';
import { WIDGETS } from '../widgets';
import { loaded } from '../loadState';

afterEach(cleanup);

const CATALOG = [
  { name: 'book', label: 'Book', type: 'text', hidden: false },
  { name: 'reader', label: 'Reader', type: 'text', hidden: false },
  { name: 'due_date', label: 'Due date', type: 'date', hidden: false },
];

const FieldMulti = WIDGETS['field-multi'];

function mountFieldMulti(copilotAdded?: ReadonlySet<string>): HTMLElement {
  const { container } = render(
    <FieldMulti
      schema={{}}
      value={['book', 'reader', 'due_date']}
      onChange={() => {}}
      context={{ conditionScope: 'flattened', objectFields: loaded(CATALOG) }}
      copilotAdded={copilotAdded}
    />,
  );
  return container;
}

function mountColumns(copilotAdded?: ReadonlySet<string>): HTMLElement {
  const columns = ['book', 'reader', 'due_date'];
  const { container } = render(
    <FieldsListEditor
      variantKey="config"
      schema={{ type: 'grid', columns }}
      columns={columns}
      allStrings
      objectName="acme_loan"
      objectFieldsOverride={CATALOG}
      selectedIndex={null}
      onPatch={() => {}}
      copilotAdded={copilotAdded}
    />,
  );
  return container;
}

/** The row drawing the element stored as `name`: the nearest box around its name. */
const rowOf = (container: HTMLElement, name: string): HTMLElement =>
  within(container).getByText(name, { selector: 'code' }).closest('div')!;

const markIn = (row: HTMLElement) => within(row).queryByTestId('studio-draft-element-chip');

describe.each([
  ['field-multi', mountFieldMulti],
  ['FieldsListEditor', mountColumns],
] as const)('%s — the copilot’s element mark sits in the element’s row (objectui#12725)', (_name, mount) => {
  it('marks the rows of the elements the copilot added, and no published row', () => {
    const container = mount(new Set(['reader', 'due_date']));
    for (const name of ['reader', 'due_date']) {
      const mark = markIn(rowOf(container, name));
      expect(mark).not.toBeNull();
      expect(mark).toHaveAttribute('data-draft-of', name);
    }
    expect(markIn(rowOf(container, 'book'))).toBeNull();
    expect(within(container).getAllByTestId('studio-draft-element-chip')).toHaveLength(2);
  });

  it('CONTROL: with no `copilotAdded` the widget draws no mark, and the same markup as a set marking nothing it holds', () => {
    const absent = mount(undefined).innerHTML;
    cleanup();
    const unmarked = mount(new Set(['not_in_value'])).innerHTML;
    expect(absent).not.toContain('studio-draft-element-chip');
    expect(absent).toBe(unmarked);
  });
});
