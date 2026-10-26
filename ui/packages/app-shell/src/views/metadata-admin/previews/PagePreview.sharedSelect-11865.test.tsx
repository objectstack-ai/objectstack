// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A record page's sample-record picker is the shared `Select` (objectui#11865).
 *
 * The picker above a record page's preview chose which sample record the page
 * renders with a browser-native select element, beside the shared Radix
 * `Select` the rest of the designer picks with. The card asks for one control
 * for one kind of choice, surface by surface; this suite covers this picker.
 *
 * What is pinned:
 *   - the picker IS the primitive (a Radix combobox trigger) and no native
 *     select is left; it has no accessible name, as the native control had
 *     none (the caption beside it is a `span`);
 *   - every sample, picked, binds the record the native control bound, read
 *     as the record context the preview opens;
 *   - a chosen id the samples no longer carry (the page was bound to another
 *     object since) shows, and binds, the first sample, as the native control
 *     did;
 *   - the keyboard alone opens the picker and selects.
 *
 * Not pinned, because the picker has none: a disabled or read-only state. It
 * picks which sample the preview renders and writes no metadata.
 *
 * DIRECTION, observed against the native control: every pin here but the
 * name pin is red there, because each opens the primitive's listbox or reads
 * its trigger. The bound-record literals are what a `change` event on the
 * pre-conversion picker bound, read once on that component.
 */

import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/** Every record context the preview opened: the object, the record id, its name. */
const { providerSpy } = vi.hoisted(() => ({ providerSpy: vi.fn() }));

// The rendered page body is orthogonal to the picker; the record context is a
// spy that still renders its children.
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: () => <div data-testid="mock-schema-renderer" />,
  RecordContextProvider: ({
    children,
    objectName,
    recordId,
    data,
  }: {
    children?: ReactNode;
    objectName: string;
    recordId: unknown;
    data: { name?: unknown };
  }) => {
    providerSpy({ objectName, recordId, name: data?.name });
    return <>{children}</>;
  },
}));

import { PagePreview } from './PagePreview';

/** Each object's sample records; one keyed by `_id`, one by `name` alone. */
const RECORDS: Record<string, unknown[]> = {
  showcase_account: [
    { id: 'r1', name: 'Northwind' },
    { id: 'r2', name: 'Contoso' },
    { _id: 'm3', name: 'Acme' },
    { name: 'only_name' },
  ],
  showcase_contact: [
    { id: 'c1', name: 'Ada' },
    { id: 'c2', name: 'Grace' },
  ],
};

const answer = (body: unknown) => ({ json: async () => body }) as unknown as Response;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const meta = /\/api\/v1\/meta\/object\/([^?]+)/.exec(url);
      if (meta) return answer({ item: { name: meta[1], fields: { name: { type: 'text' } } } });
      const data = /\/api\/v1\/data\/([^?]+)/.exec(url);
      if (data) return answer({ records: RECORDS[decodeURIComponent(data[1])] ?? [] });
      return answer({});
    }),
  );
}

const pageOn = (object: string) => ({
  name: 'p',
  label: 'P',
  type: 'record',
  object,
  regions: [{ name: 'main', components: [{ type: 'record:details' }] }],
});

/** Let the record-binding effect's reads resolve and its state settle. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function mount(object = 'showcase_account') {
  stubFetch();
  const view = render(<PagePreview type="page" name="p" draft={pageOn(object)} />);
  await settle();
  return view;
}

/** The picker's trigger: the one combobox on the mount. */
const trigger = () => screen.getByRole('combobox');

/** The record context the preview opened last, as JSON text. */
const bound = () => JSON.stringify(providerSpy.mock.calls.at(-1)?.[0]);

async function pick(label: string): Promise<void> {
  fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
  const options = within(await screen.findByRole('listbox')).getAllByRole('option');
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`the picker lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  providerSpy.mockClear();
});

describe('a record page preview picks its sample record with the shared Select (objectui#11865)', () => {
  it('renders the picker as the Radix combobox trigger, with no native select left and no name', async () => {
    await mount();
    expect(document.querySelector('select')).toBeNull();
    const el = trigger();
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveTextContent('Northwind');
    expect(el).not.toHaveAccessibleName();
  });

  it('lists every sample, in the order the data endpoint answered', async () => {
    await mount();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const options = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Northwind', 'Contoso', 'Acme', 'only_name']);
  });

  // Each literal is the record context the native control's `change` opened
  // for that sample, read on the pre-conversion picker.
  it.each([
    ['Northwind', '{"objectName":"showcase_account","recordId":"r1","name":"Northwind"}'],
    ['Contoso', '{"objectName":"showcase_account","recordId":"r2","name":"Contoso"}'],
    ['Acme', '{"objectName":"showcase_account","recordId":"m3","name":"Acme"}'],
    ['only_name', '{"objectName":"showcase_account","recordId":"only_name","name":"only_name"}'],
  ])('picking %s binds the record the native control bound', async (label, expected) => {
    await mount();
    await pick(label);
    expect(bound()).toBe(expected);
    expect(trigger()).toHaveTextContent(label);
  });

  it('shows and binds the first sample when the chosen id is not among the samples, as the native control did', async () => {
    const { rerender } = await mount();
    await pick('Contoso');
    // Bound to another object since: the chosen id `r2` is not one of its samples.
    rerender(<PagePreview type="page" name="p" draft={pageOn('showcase_contact')} />);
    await settle();
    // The native control showed "Ada" and the preview bound `c1`, read on the base.
    expect(trigger()).toHaveTextContent(/^Ada$/);
    expect(bound()).toBe('{"objectName":"showcase_contact","recordId":"c1","name":"Ada"}');
  });

  it('Enter opens the picker and Enter on an option selects it', async () => {
    await mount();
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Acme' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger()).toHaveTextContent('Acme');
    expect(bound()).toBe('{"objectName":"showcase_account","recordId":"m3","name":"Acme"}');
  });
});
