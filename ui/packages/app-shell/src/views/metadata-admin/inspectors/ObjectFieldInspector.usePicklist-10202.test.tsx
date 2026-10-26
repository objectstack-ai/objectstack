// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10202 — "use picklist" in the select-field editor.
 *
 * The ruling (6006062645, item (a)): a picker over the picklists the runtime
 * serves, by name; choosing one sets `picklist` and clears inline `options`;
 * inline options are refused on a picklist-bound field, as the spec refuses
 * both.
 *
 * The inspector is the real one, mounted in a host that applies each `onPatch`
 * the way the designers do (`{ ...draft, ...patch }`), so every assertion reads
 * the field the next save would carry. The roster is the inspector's own read,
 * `client.list('picklist')`, answered with the row shape the runtime serves
 * (measured on objectstack `main`: `name`, `label`, `options`, `_packageId`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldSchema } from '@objectstack/spec/data';

type Row = Record<string, unknown>;

/** `GET /meta/picklist`, as the runtime serves it. */
const SERVED_PICKLISTS: Row[] = [
  {
    name: 'acme_tier',
    label: 'Tier',
    options: [
      { label: 'Gold', value: 'gold' },
      { label: 'Silver', value: 'silver' },
    ],
    _packageId: 'com.acme.core',
  },
  { name: 'acme_size', label: 'Size', options: [{ label: 'Small', value: 's' }], _packageId: 'com.acme.core' },
];

const roster = vi.hoisted(() => ({
  answer: null as null | (() => Promise<unknown[]>),
  /** Hand the inspector a NEW client object on every call, as an unmemoised host would. */
  freshClient: false,
  /** How many times the roster was requested. */
  reads: 0,
}));

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  const make = () => ({
    list: async (type: string) => {
      if (type === 'picklist') roster.reads += 1;
      return type === 'picklist' && roster.answer ? roster.answer() : [];
    },
    listDrafts: async () => [],
  });
  const stable = make();
  return { ...mod, useMetadataClient: () => (roster.freshClient ? make() : stable) };
});

vi.mock('../previews/useObjectFields', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../previews/useObjectFields')>();
  return { ...mod, useObjectFields: () => ({ fields: [], loading: false, error: null }) };
});

import { ObjectFieldInspector } from './ObjectFieldInspector';

beforeEach(() => {
  roster.answer = async () => SERVED_PICKLISTS.map((p) => ({ ...p }));
  roster.freshClient = false;
  roster.reads = 0;
  // Radix Select reads pointer capture, which the DOM double does not implement.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
});

afterEach(cleanup);

/** The inspector in a host that applies its patches, as both designers do. */
function mount(fields: Record<string, Row>, selected: string) {
  let latest: Row = { name: 'acme_account', fields };
  function Host() {
    const [draft, setDraft] = React.useState<Row>(latest);
    return (
      <ObjectFieldInspector
        type="object"
        name="acme_account"
        draft={draft}
        selection={{ kind: 'field', id: selected }}
        onPatch={(patch) =>
          setDraft((d) => {
            latest = { ...d, ...patch };
            return latest;
          })
        }
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={false}
        locale="en-US"
      />
    );
  }
  render(<Host />);
  return { field: () => (latest.fields as Record<string, Row>)[selected] };
}

const sourcePicker = () => screen.getByRole('combobox', { name: 'Options from' });

async function choose(optionName: string | RegExp) {
  await userEvent.click(sourcePicker());
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

/** The inline options editor's own affordance: present exactly when inline options are offered. */
const addValueButton = () => screen.queryByRole('button', { name: 'Add value' });

describe('ObjectFieldInspector — use picklist (objectui#10202)', () => {
  it('offers the served picklists by name, beside the field\'s own options', async () => {
    mount({ status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] } }, 'status');
    await userEvent.click(sourcePicker());
    expect(await screen.findByRole('option', { name: 'Tier (acme_tier)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Size (acme_size)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: "This field's own options" })).toBeInTheDocument();
  });

  it('choosing a picklist sets `picklist`, removes `options` outright, and the field is one the door accepts', async () => {
    const { field } = mount(
      { status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] } },
      'status',
    );
    expect(addValueButton(), 'premise: an inline field offers its options editor').not.toBeNull();
    await choose('Tier (acme_tier)');

    expect(field()).toEqual({ type: 'select', label: 'Status', picklist: 'acme_tier' });
    expect(Object.prototype.hasOwnProperty.call(field(), 'options')).toBe(false);
    const parsed = FieldSchema.safeParse(field());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('a bound field refuses inline options: no options editor, the list\'s values shown read-only with the reason', async () => {
    mount({ tier: { type: 'select', label: 'Tier', picklist: 'acme_tier' } }, 'tier');
    await waitFor(() => expect(screen.getByTestId('picklist-bound-options')).toHaveTextContent('Gold'));
    const bound = screen.getByTestId('picklist-bound-options');
    expect(bound).toHaveTextContent('Silver');
    expect(bound).toHaveTextContent(/Options come from the picklist “Tier”/);
    // The roster carries the list's OWN options only, so the list says it is not the whole offer.
    expect(bound).toHaveTextContent('These are the picklist’s own values. Values other packages add to it are offered too.');
    expect(addValueButton(), 'no inline options editor on a bound field').toBeNull();
    expect(bound.querySelector('input, textarea, button')).toBeNull();
  });

  it('a SERVED bound field shows the resolved options it carries (extensions included)', async () => {
    mount(
      {
        tier: {
          type: 'select',
          label: 'Tier',
          picklist: 'acme_tier',
          options: [
            { label: 'Gold', value: 'gold' },
            { label: 'Silver', value: 'silver' },
            { label: 'Platinum', value: 'platinum' },
          ],
        },
      },
      'tier',
    );
    const bound = screen.getByTestId('picklist-bound-options');
    expect(bound).toHaveTextContent('Platinum');
    // The served copy IS the whole offer: no "own values only" note.
    expect(bound).not.toHaveTextContent('own values');
    expect(addValueButton()).toBeNull();
  });

  it('choosing the field\'s own options removes `picklist` and the served copy, and offers the editor again', async () => {
    const { field } = mount(
      { tier: { type: 'select', label: 'Tier', picklist: 'acme_tier', options: [{ label: 'Gold', value: 'gold' }] } },
      'tier',
    );
    await choose("This field's own options");
    expect(field()).toEqual({ type: 'select', label: 'Tier' });
    expect(addValueButton()).not.toBeNull();
    expect(screen.queryByTestId('picklist-bound-options')).toBeNull();
  });

  it('a retype keeps the binding on another option type and drops it on any other type (the spec refuses it there)', async () => {
    const { field } = mount({ tier: { type: 'select', label: 'Tier', picklist: 'acme_tier' } }, 'tier');
    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Multi-Select' }));
    expect(field()).toMatchObject({ type: 'multiselect', picklist: 'acme_tier' });

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Text' }));
    expect(field()).toEqual({ type: 'text', label: 'Tier' });
    expect(FieldSchema.safeParse(field()).success).toBe(true);
  });

  it('a bound field\'s default value is chosen from the list\'s values', async () => {
    const { field } = mount({ tier: { type: 'select', label: 'Tier', picklist: 'acme_tier' } }, 'tier');
    await waitFor(() => expect(screen.getByTestId('picklist-bound-options')).toHaveTextContent('Gold'));
    await userEvent.click(screen.getByRole('combobox', { name: 'Default value' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Silver' }));
    expect(field()).toMatchObject({ picklist: 'acme_tier', defaultValue: 'silver' });
  });

  it('a stored name the served list does not carry is drawn flagged, never as unset', async () => {
    mount({ tier: { type: 'select', label: 'Tier', picklist: 'acme_gone' } }, 'tier');
    await waitFor(() => expect(sourcePicker()).toHaveTextContent('acme_gone (not found)'));
  });

  it('reads the roster once per mount, even when the host hands it a fresh client on every render (AGENTS.md #10)', async () => {
    // A loader keyed on the client's identity re-ran on every render, and each
    // run re-entered `loading` and rendered again: a render loop that held a
    // worker at 100% CPU — measured on `ObjectFieldInspector.optionLabel.test.tsx`,
    // whose mock returns a fresh client per call. Mounted the way that suite
    // mounts it (no stateful host), with real timers only.
    roster.freshClient = true;
    render(
      <ObjectFieldInspector
        type="object"
        name="acme_account"
        draft={{ name: 'acme_account', fields: { tier: { type: 'select', label: 'Tier', picklist: 'acme_tier' } } }}
        selection={{ kind: 'field', id: 'tier' }}
        onPatch={() => {}}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={false}
        locale="en-US"
      />,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByRole('combobox', { name: 'Options from' })).toBeInTheDocument();
    expect(roster.reads).toBe(1);
  });

  it('a failed roster read says so and keeps the field\'s own options choosable; it is never drawn as "no picklists"', async () => {
    roster.answer = async () => {
      throw new Error('HTTP 503');
    };
    const { field } = mount({ tier: { type: 'select', label: 'Tier', picklist: 'acme_tier' } }, 'tier');
    const notice = await screen.findByTestId('inspector-select-roster-failure');
    expect(notice).toHaveTextContent('HTTP 503');
    // The stored binding is drawn bare (no "not found" claim from a roster that never answered).
    expect(sourcePicker()).toHaveTextContent('acme_tier');
    expect(sourcePicker()).not.toHaveTextContent('not found');
    await act(async () => {
      await choose("This field's own options");
    });
    expect(field()).toEqual({ type: 'select', label: 'Tier' });
  });
});
