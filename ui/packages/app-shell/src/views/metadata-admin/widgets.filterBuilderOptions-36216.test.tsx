// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36216 — every host that builds the `filter-builder` field list
 * hands the shared `FilterBuilder` each column's declared `options`, so a
 * picklist (`select`) column's value is a picker over its choices and stores
 * the option's `value`, never a free-text box where a typed label matches no
 * record.
 *
 * Pinned, on each host, a `select` column against a `text` CONTROL:
 *  - the generic editor's object catalog (`objectCatalogOf`, record and array
 *    forms) and the runtime view panel's catalog (`mapObjectFields`) carry the
 *    declared choices, in the spec's `{ value, label }` shape;
 *  - the `filter-builder` widget over that catalog: the picklist row's value is
 *    a picker listing the choices' labels, and picking one writes its value;
 *  - the view-variant inspector (fed by `mapObjectFields`, and by its own
 *    `useObjectFields` read) and the page block's related-list filter: the
 *    picklist row's value is a picker, the text row's a `Value` box.
 *
 * Direction: without `options` reaching the builder a picklist row draws the
 * same `Value` box as the text row, so every picklist case is red and every
 * text CONTROL green either way.
 */

import '@testing-library/jest-dom/vitest';
// The source loads these lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The builder lives inside a Radix popover, which does not open in jsdom; the
// popover parts render inline (this directory's existing way of reaching it).
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});

const STATUS_OPTIONS = [
  { value: 'new', label: 'New Request' },
  { value: 'done', label: 'Completed' },
];

/** The served `ticket` object: a text column and a picklist column. */
const TICKET_FIELDS = {
  subject: { name: 'subject', label: 'Subject', type: 'text' },
  status: { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
} as const;
const TICKET = { name: 'ticket', label: 'Ticket', fields: TICKET_FIELDS };

const clients = vi.hoisted(() => {
  const fake = {
    get: async (type: string, name: string) => (type === 'object' && name === 'ticket' ? TICKET_DOC() : undefined),
    list: async () => [] as unknown[],
    withPreviewDrafts() {
      return this;
    },
  };
  return { fake };
});
// `vi.hoisted` runs before the module body, so the served document is read lazily.
function TICKET_DOC() {
  return TICKET;
}
vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return { ...mod, useMetadataClient: () => clients.fake };
});

import { WIDGETS } from './widgets';
import { loaded } from './loadState';
import { objectCatalogOf } from './ResourceEditPage';
import { mapObjectFields } from '../ViewConfigPanel';
import { ViewVariantInspector } from './inspectors/ViewVariantInspector';
import { PageBlockInspector } from './inspectors/PageBlockInspector';

afterEach(cleanup);

async function pickFrom(scope: HTMLElement, index: number, label: string) {
  const triggers = within(scope).getAllByRole('combobox');
  fireEvent.keyDown(triggers[index], { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find((o) => o.textContent === label);
    expect(found, `no "${label}" in the dropdown`).toBeTruthy();
    return found!;
  });
  fireEvent.click(option);
}

/** The value control of the one row in `scope`: the free-text boxes and the value picker. */
function valueControlOf(scope: HTMLElement) {
  return {
    textBoxes: within(scope).queryAllByPlaceholderText('Value').length,
    picker: within(scope).queryAllByRole('combobox').find((c) => c.textContent === 'Select value'),
  };
}

/** Add a row in the builder inside `scope` and point it at `label`. */
async function addRowFor(scope: HTMLElement, label: string) {
  fireEvent.click(within(scope).getByRole('button', { name: 'Add filter' }));
  await pickFrom(scope, 0, label);
}

/** Open the value picker and read its option labels. */
async function choicesOf(picker: HTMLElement): Promise<string[]> {
  fireEvent.keyDown(picker, { key: 'ArrowDown' });
  return waitFor(() => {
    const found = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(found.length).toBeGreaterThan(0);
    return found;
  });
}

type Rule = { field: string; operator: string; value?: unknown };

const FilterWidget = WIDGETS['filter-builder'];

function WidgetHost({ writes }: { writes: Array<Rule[] | undefined> }) {
  const [value, setValue] = React.useState<Rule[] | undefined>(undefined);
  return (
    <div data-testid="host">
      <FilterWidget
        schema={{}}
        value={value}
        context={{ conditionScope: 'none', objectFields: loaded(objectCatalogOf(TICKET).fields) }}
        onChange={(rules) => {
          writes.push(rules as Rule[] | undefined);
          setValue(rules as Rule[] | undefined);
        }}
      />
    </div>
  );
}

describe('the catalogs that feed the filter-builder carry a picklist field’s options (objectstack#36216)', () => {
  it('`objectCatalogOf` carries the declared choices, record or array form, and none on a text column', () => {
    for (const catalog of [objectCatalogOf(TICKET), objectCatalogOf({ fields: Object.values(TICKET_FIELDS) })]) {
      expect(catalog.fields.find((f) => f.name === 'status')?.options).toEqual(STATUS_OPTIONS);
      expect(catalog.fields.find((f) => f.name === 'subject')).toEqual({ name: 'subject', label: 'Subject', type: 'text' });
    }
  });

  it('`mapObjectFields` carries the declared choices, and none on a text column', () => {
    const fields = mapObjectFields(TICKET as never);
    expect(fields.find((f) => f.name === 'status')?.options).toEqual(STATUS_OPTIONS);
    expect(fields.find((f) => f.name === 'subject')).not.toHaveProperty('options');
  });
});

describe('the filter-builder widget over the generic editor’s catalog offers a picklist’s options (objectstack#36216)', () => {
  it('a picklist row’s value is a picker over the choices, and picking one writes its value', async () => {
    const writes: Array<Rule[] | undefined> = [];
    render(<WidgetHost writes={writes} />);
    const host = screen.getByTestId('host');
    await addRowFor(host, 'Status');
    const { textBoxes, picker } = valueControlOf(host);
    expect(textBoxes).toBe(0);
    expect(picker).toBeTruthy();
    expect(await choicesOf(picker!)).toEqual(['New Request', 'Completed']);
    fireEvent.click(screen.getByRole('option', { name: 'New Request' }));
    expect(writes.at(-1)).toEqual([{ field: 'status', operator: 'equals', value: 'new' }]);
  });

  it('CONTROL: a text row’s value is a free-text box', async () => {
    render(<WidgetHost writes={[]} />);
    const host = screen.getByTestId('host');
    await addRowFor(host, 'Subject');
    expect(valueControlOf(host)).toEqual({ textBoxes: 1, picker: undefined });
  });
});

function VariantHarness({ override }: { override: boolean }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'tickets',
    object: 'ticket',
    list: { type: 'grid', data: { provider: 'object', object: 'ticket' }, columns: ['subject'] },
  });
  return (
    <div data-testid="host">
      <ViewVariantInspector
        type="view"
        name="tickets"
        draft={draft}
        onPatch={(patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch }))}
        onSelectionChange={() => {}}
        onClearSelection={() => {}}
        readOnly={false}
        locale={'en-US'}
        variantKey="list"
        familyKey="list"
        isHome={false}
        {...(override ? { objectFieldsOverride: mapObjectFields(TICKET as never) } : {})}
      />
    </div>
  );
}

async function variantBuilder(override: boolean): Promise<HTMLElement> {
  render(<VariantHarness override={override} />);
  const trigger = await screen.findByTestId('filter-builder-trigger');
  const builder = trigger.parentElement as HTMLElement;
  await waitFor(() => expect(within(builder).getByRole('button', { name: 'Add filter' })).toBeInTheDocument());
  return builder;
}

describe('the view-variant inspector’s filter offers a picklist’s options (objectstack#36216)', () => {
  it.each([
    ['the runtime view panel’s catalog', true],
    ['its own object read', false],
  ])('over %s, a picklist row’s value is a picker over the choices', async (_host, override) => {
    const builder = await variantBuilder(override);
    await addRowFor(builder, 'Status');
    const { textBoxes, picker } = valueControlOf(builder);
    expect(textBoxes).toBe(0);
    expect(await choicesOf(picker!)).toEqual(['New Request', 'Completed']);
  });

  it('CONTROL: a text row’s value is a free-text box', async () => {
    const builder = await variantBuilder(false);
    await addRowFor(builder, 'Subject');
    expect(valueControlOf(builder)).toEqual({ textBoxes: 1, picker: undefined });
  });
});

function PageHarness() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'account_page',
    type: 'record',
    object: 'account',
    kind: 'full',
    regions: [{ name: 'main', components: [{ id: 'tickets', type: 'record:related_list', properties: { objectName: 'ticket', relationshipField: 'account' } }] }],
  });
  return (
    <PageBlockInspector
      type="page"
      name="account_page"
      draft={draft}
      selection={{ kind: 'block', id: 'regions[0].components[0]' }}
      onPatch={(patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch }))}
      onClearSelection={() => {}}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

async function pageBlockBuilder(): Promise<HTMLElement> {
  render(<PageHarness />);
  const block = await screen.findByTestId('block-filter-rules');
  await waitFor(() => expect(within(block).getByRole('button', { name: 'Add filter' })).toBeInTheDocument());
  return block;
}

describe('the page block’s related-list filter offers a picklist’s options (objectstack#36216)', () => {
  it('a picklist row’s value is a picker over the choices', async () => {
    const block = await pageBlockBuilder();
    await addRowFor(block, 'Status');
    const { textBoxes, picker } = valueControlOf(block);
    expect(textBoxes).toBe(0);
    expect(await choicesOf(picker!)).toEqual(['New Request', 'Completed']);
  });

  it('CONTROL: a text row’s value is a free-text box', async () => {
    const block = await pageBlockBuilder();
    await addRowFor(block, 'Subject');
    expect(valueControlOf(block)).toEqual({ textBoxes: 1, picker: undefined });
  });
});
