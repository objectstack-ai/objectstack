// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page block inspector's three LIST editors are groups named by the label
 * drawn above them: the field list (`FieldListField`, e.g. Columns), the
 * string list and the array editor. Each label heads several rows, so it is
 * not a `for` pairing — the container takes `role="group"` and answers the
 * label's id through `aria-labelledby`, the WAI-ARIA group pattern
 * `ColorPropField` already uses. Before this, `getByLabelText('Columns')` found
 * the label and no control, and a screen reader heard the rows with no group
 * name.
 *
 * The id is minted per instance (`React.useId()`), because these editors also
 * render inside array rows: the last case draws one field list per
 * `record:details` section and pins that each group answers to its own label.
 *
 * Row inputs that carry only a repeated placeholder are named from the list's
 * label plus their position ("Action names 1").
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({
  fields: [{ name: 'subject', label: 'Subject', type: 'text', hidden: false }] as Array<Record<string, unknown>>,
}));

// The filter builder lives inside a Radix popover, which does not open in
// jsdom; the popover parts render inline (this directory's existing way).
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: state.fields, loading: false, error: null }),
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({ get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) }),
}));

import { PageBlockInspector } from './PageBlockInspector';

afterEach(() => {
  cleanup();
  state.fields = [{ name: 'subject', label: 'Subject', type: 'text', hidden: false }];
});

type Row = Record<string, unknown>;

function renderBlock(type: string, properties: Row) {
  return render(
    <PageBlockInspector
      type="page"
      name="lead_page"
      draft={{
        name: 'lead_page',
        type: 'record',
        object: 'lead',
        kind: 'full',
        regions: [{ name: 'main', components: [{ id: 'b1', type, properties }] }],
      }}
      selection={{ kind: 'block', id: 'regions[0].components[0]' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={false}
      locale="en-US"
    />,
  );
}

/** The group's IDREF resolves to the label element that carries the name. */
function expectNamedByItsLabel(group: HTMLElement, label: string) {
  const labelId = group.getAttribute('aria-labelledby');
  expect(labelId).toBeTruthy();
  const labelEl = document.getElementById(labelId!);
  expect(labelEl).not.toBeNull();
  expect(labelEl!.textContent).toBe(label);
  expect(group).toContainElement(labelEl);
}

describe('page block inspector — list editors are groups named by their label', () => {
  it('names the field list (Columns) and the array editor (Sort), with their rows inside', () => {
    renderBlock('record:related_list', {
      objectName: 'task',
      relationshipField: 'lead',
      columns: ['subject'],
      sort: [{ field: 'subject', order: 'asc' }],
    });

    const columns = screen.getByRole('group', { name: 'Columns' });
    expectNamedByItsLabel(columns, 'Columns');
    expect(within(columns).getAllByRole('combobox')).toHaveLength(1);
    expect(within(columns).getByRole('button', { name: 'Remove' })).toBeInTheDocument();

    const sort = screen.getByRole('group', { name: 'Sort' });
    expectNamedByItsLabel(sort, 'Sort');
    expect(within(sort).getByText('#1')).toBeInTheDocument();
    expect(within(sort).getByRole('button', { name: 'Remove item' })).toBeInTheDocument();

    expect(columns.getAttribute('aria-labelledby')).not.toBe(sort.getAttribute('aria-labelledby'));
  });

  it('names the string list, and each row input by the label and its position', () => {
    renderBlock('record:quick_actions', { actionNames: ['approve', 'reject'] });

    const list = screen.getByRole('group', { name: 'Action names' });
    expectNamedByItsLabel(list, 'Action names');
    expect(within(list).getByRole('textbox', { name: 'Action names 1' })).toHaveValue('approve');
    expect(within(list).getByRole('textbox', { name: 'Action names 2' })).toHaveValue('reject');
  });

  it('names the field list text fallback rows the same way when the object has no fields', () => {
    state.fields = [];
    renderBlock('record:related_list', { objectName: 'task', columns: ['subject'] });

    const columns = screen.getByRole('group', { name: 'Columns' });
    expect(within(columns).getByRole('textbox', { name: 'Columns 1' })).toHaveValue('subject');
  });

  it('mints a distinct id per instance when the same list repeats inside array rows', () => {
    renderBlock('record:details', {
      sections: [
        { name: 'main', label: 'Main', fields: ['subject'] },
        { name: 'more', label: 'More', fields: ['subject'] },
      ],
    });

    const sections = screen.getByRole('group', { name: 'Sections' });
    const fieldLists = within(sections).getAllByRole('group', { name: 'Fields' });
    expect(fieldLists).toHaveLength(2);
    fieldLists.forEach((g) => expectNamedByItsLabel(g, 'Fields'));
    expect(fieldLists[0].getAttribute('aria-labelledby')).not.toBe(fieldLists[1].getAttribute('aria-labelledby'));
  });
});
