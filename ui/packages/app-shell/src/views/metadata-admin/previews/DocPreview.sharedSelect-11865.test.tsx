// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A doc's book-section picker is the shared `Select` (objectui#11865).
 *
 * The `doc` canvas placed the doc in a book section with a browser-native
 * select element, one optgroup per book, beside the shared Radix `Select` the
 * rest of the designer picks with. The card asks for one control for one kind
 * of choice, surface by surface; this suite covers this picker.
 *
 * What is pinned:
 *   - the picker IS the primitive (a Radix combobox trigger), keeps the name
 *     its `<label htmlFor>` gave the native control, and no native select is
 *     left; each book is a group headed by the book's label;
 *   - every option writes the patch the native control wrote, for a doc with
 *     no section, one in a shared section key, and one in a key no book
 *     declares; re-picking the shown option writes nothing;
 *   - a stored key no option carries is what the trigger shows while the
 *     books load or after they fail to, where the native control showed
 *     "not placed in a section";
 *   - read-only disables the trigger in the primitive's own look
 *     (objectui#11781);
 *   - the keyboard alone opens the picker and selects.
 *
 * DIRECTION, observed against the native control: every pin here but the
 * name pin is red there, because each opens the primitive's listbox or reads
 * its trigger. The patch literals are what a `change` event on the
 * pre-conversion picker wrote, read once on that component.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';

const mockClient = {
  list: vi.fn(async (_type: string): Promise<unknown[]> => []),
};

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { DocPreview } from './DocPreview';

const STUB_NS = 'doc-preview-shared-select-11865';

/** Two books that share the section key `reference`; listed sorted by label. */
const MANUAL = {
  name: 'docprobe_manual',
  label: 'Probe Manual',
  groups: [
    { key: 'getting_started', label: 'Getting started', include: 'docprobe_gs_*' },
    { key: 'reference', label: 'Reference' },
  ],
};
const HANDBOOK = {
  name: 'handbook',
  label: 'Handbook',
  groups: [
    { key: 'reference', label: 'Reference' },
    { key: 'faq', label: 'FAQ' },
  ],
};

beforeAll(() => {
  ComponentRegistry.register('markdown', (() => null) as never, { namespace: STUB_NS });
});
afterAll(() => {
  ComponentRegistry.unregister('markdown', STUB_NS);
});
beforeEach(() => {
  mockClient.list.mockReset();
  mockClient.list.mockImplementation(async () => [MANUAL, HANDBOOK]);
});
afterEach(() => cleanup());

/** A patch as text, with a key that holds `undefined` named rather than dropped. */
const asText = (patch: unknown) => JSON.stringify(patch, (_k, v) => (v === undefined ? '(undefined)' : v));

/** Mount the canvas on a doc in `group`, and wait for the book list to be read. */
async function mount(group: string | undefined, opts: { editing?: boolean } = {}) {
  const patches: string[] = [];
  render(
    <DocPreview
      type="doc"
      name="my_guide"
      draft={{ name: 'my_guide', content: 'x', ...(group ? { group } : {}) }}
      editing={opts.editing ?? true}
      locale="en-US"
      onPatch={(p) => patches.push(asText(p))}
    />,
  );
  await waitFor(() => expect(screen.getByTestId('doc-placement')).toBeInTheDocument());
  return patches;
}

const trigger = () => screen.getByRole('combobox', { name: 'Book section' });

async function openSections(): Promise<HTMLElement> {
  fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
  return screen.findByRole('listbox');
}

describe('a doc picks its book section with the shared Select (objectui#11865)', () => {
  it('renders the picker as the Radix combobox trigger, named by its label, with no native select left', async () => {
    await mount('faq');
    expect(document.querySelector('select')).toBeNull();
    const el = trigger();
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveAttribute('id', 'doc-book-section');
    expect(el).toHaveTextContent(/^FAQ$/);
  });

  it('heads each book with its label, in the order the native optgroups had', async () => {
    await mount(undefined);
    const listbox = await openSections();
    const inBook = (name: string) =>
      within(within(listbox).getByRole('group', { name })).getAllByRole('option').map((o) => o.textContent);
    expect(within(listbox).getAllByRole('group')).toHaveLength(2);
    expect(inBook('Handbook')).toEqual(['Reference', 'FAQ']);
    expect(inBook('Probe Manual')).toEqual(['Getting started', 'Reference']);
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Not placed in a section',
      'Reference',
      'FAQ',
      'Getting started',
      'Reference',
    ]);
  });

  // [stored group, option position, the patches the pick writes]. Each literal
  // is what the native control's `change` wrote for that option, read on the
  // pre-conversion picker, except the rows marked re-pick: the option the
  // trigger already shows, which writes nothing here, as a browser's native
  // control fired no `change` for it (the test DOM's did).
  const NOT_PLACED = '{"group":"(undefined)"}';
  it.each([
    [undefined, 0, [], 're-pick'],
    [undefined, 1, ['{"group":"reference"}'], ''],
    [undefined, 2, ['{"group":"faq"}'], ''],
    [undefined, 3, ['{"group":"getting_started"}'], ''],
    [undefined, 4, ['{"group":"reference"}'], ''],
    ['reference', 0, [NOT_PLACED], ''],
    ['reference', 1, [], 're-pick'],
    ['reference', 2, ['{"group":"faq"}'], ''],
    ['reference', 3, ['{"group":"getting_started"}'], ''],
    // The second book's `reference`: the same key, so the same patch.
    ['reference', 4, ['{"group":"reference"}'], ''],
    ['retired_section', 0, [NOT_PLACED], ''],
    ['retired_section', 1, ['{"group":"reference"}'], ''],
    ['retired_section', 2, ['{"group":"faq"}'], ''],
    ['retired_section', 3, ['{"group":"getting_started"}'], ''],
    ['retired_section', 4, ['{"group":"reference"}'], ''],
    ['retired_section', 5, [], 're-pick'],
  ] as const)('stored %s, option %i writes %j %s', async (group, at, expected, _note) => {
    const patches = await mount(group);
    const options = within(await openSections()).getAllByRole('option');
    fireEvent.click(options[at]!);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(patches).toEqual(expected);
  });

  it('shows a stored key no book declares as the key in no book, once the books are listed', async () => {
    await mount('retired_section');
    expect(trigger()).toHaveTextContent(/^retired_section \(not a section of any book\)$/);
  });

  it('shows the stored key itself while the books load, where the native control showed "not placed"', async () => {
    mockClient.list.mockImplementation(() => new Promise(() => {}));
    render(<DocPreview type="doc" name="my_guide" draft={{ name: 'my_guide', content: 'x', group: 'reference' }} editing locale="en-US" onPatch={() => {}} />);
    expect(trigger()).toHaveTextContent(/^reference$/);
  });

  it('shows the stored key itself when the books fail to load, where the native control showed "not placed"', async () => {
    mockClient.list.mockImplementation(async () => {
      throw new Error('503 Service Unavailable');
    });
    render(<DocPreview type="doc" name="my_guide" draft={{ name: 'my_guide', content: 'x', group: 'reference' }} editing locale="en-US" onPatch={() => {}} />);
    await screen.findByRole('alert');
    expect(trigger()).toHaveTextContent(/^reference$/);
  });

  it('read-only disables the trigger, which then opens nothing', async () => {
    await mount('reference', { editing: false });
    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveTextContent(/^Reference$/);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter opens the picker and Enter on an option selects it', async () => {
    const patches = await mount(undefined);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'FAQ' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(patches).toEqual(['{"group":"faq"}']);
  });
});
