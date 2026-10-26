/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A lookup value PICKED before the referenced object's schema loads takes its
 * label from that schema once it arrives — objectui#10559.
 *
 * A pick used to cache the BUILT option it was handed, its label frozen on
 * whatever schema was loaded at pick time. A pick made before the schema
 * resolved was therefore labelled on the no-schema path (the `name` guess) and
 * kept that label for good, while the dropdown, which derives its options from
 * their rows on every render, read the object's declared `nameField` for the
 * same record. objectui#10487 fixed the hydrated value the same way this card
 * fixes the picked one: the pick keeps the ROW, and the chip's option is
 * derived from it on render.
 *
 * The fixture forces the order: the schema request is held open while the pick
 * is made, and released only after the chip has been labelled. Every row
 * carries a `name` value, so a label frozen on the no-schema path cannot pass.
 * Pinned, on each surface that commits a pick:
 *
 *  - the dropdown: the chip reads the declared `nameField` once the schema
 *    resolves, and the record is not fetched again to relabel it;
 *  - the browse-all dialog: the same;
 *  - quick-create: the same, for the record the pick created;
 *  - control: a pick made after the schema loaded reads the declared
 *    `nameField` at once;
 *  - control: the dropdown option for the same record reads the same text.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { LookupField } from './LookupField';

const CONTRACT_FIELDS: Record<string, unknown> = {
  contract_no: { type: 'text', label: 'Contract No' },
  name: { type: 'text', label: 'Name' },
};

const ROWS: Record<string, unknown>[] = [
  { id: 'c1', name: 'Acme', contract_no: 'HT-001' },
  { id: 'c2', name: 'Initech', contract_no: 'HT-002' },
];

/**
 * A backend whose `getObjectSchema` answers only when `releaseSchema()` is
 * called — so the test, not the scheduler, decides whether the pick lands
 * before the schema. `create` serves a row that also carries a `name`, so a
 * created record labelled on the no-schema path cannot pass either.
 */
function makeBackend() {
  let releaseSchema!: () => void;
  const schemaHeld = new Promise<void>((resolve) => {
    releaseSchema = resolve;
  });
  const find = vi.fn(async (objectName: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
    if (objectName !== 'contract') return { data: [], total: 0 };
    const wanted = params?.$filter?.id?.$in;
    const rows = wanted ? ROWS.filter((r) => wanted.includes(r.id)) : ROWS;
    return { data: rows.map((r) => ({ ...r })), total: rows.length };
  });
  const findOne = vi.fn(async (objectName: string, id: string) => {
    const row = objectName === 'contract' ? ROWS.find((r) => r.id === id) : undefined;
    return row ? { ...row } : null;
  });
  const create = vi.fn(async (_objectName: string, data: Record<string, unknown>) => ({
    id: 'c3',
    contract_no: 'HT-003',
    ...data,
  }));
  const getObjectSchema = vi.fn(async (objectName: string) => {
    await schemaHeld;
    return objectName === 'contract'
      ? { name: 'contract', nameField: 'contract_no', fields: CONTRACT_FIELDS }
      : undefined;
  });
  return { ds: { find, findOne, create, getObjectSchema }, releaseSchema };
}

type Backend = ReturnType<typeof makeBackend>['ds'];

/** Holds the value, so a pick commits and the chip re-resolves from it. */
function Host({ ds }: { ds: Backend }) {
  const [value, setValue] = React.useState<unknown>(null);
  return (
    <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
      <LookupField
        value={value}
        onChange={setValue}
        dataSource={ds as never}
        field={{ reference: 'contract' } as never}
      />
    </SchemaRendererContext.Provider>
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Each selected-value chip's label, read from its remove control's name. */
function chipLabels(): string[] {
  return screen
    .queryAllByRole('button', { name: /^Remove / })
    .map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Remove /, ''));
}

/** The dropdown's option labels, read from each option row's `title`. */
function optionLabels(): string[] {
  return screen.getAllByRole('option').map((el) => el.getAttribute('title') ?? '');
}

/** Mount empty and wait until the schema request is out (and still held). */
async function mountEmpty() {
  const backend = makeBackend();
  render(<Host ds={backend.ds} />);
  await waitFor(() => expect(backend.ds.getObjectSchema).toHaveBeenCalledWith('contract'));
  await settle();
  return backend;
}

async function openDropdown(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(2));
  await settle();
}

async function release(releaseSchema: () => void): Promise<void> {
  await act(async () => {
    releaseSchema();
  });
  await settle();
}

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('LookupField — a picked value is labelled from the schema once it arrives (objectui#10559)', () => {
  it('the dropdown: a pick made before the schema resolves reads the declared nameField after it does', async () => {
    const { ds, releaseSchema } = await mountEmpty();
    await openDropdown();
    // The fixture's order held: the options were built before the schema existed.
    expect(optionLabels()).toEqual(['Acme', 'Initech']);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('option')[0]);
    });
    await settle();
    // The popover closed on the pick, so no option row supplies the text.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(chipLabels()).toEqual(['Acme']);

    await release(releaseSchema);
    expect(chipLabels()).toEqual(['HT-001']);
    expect(chipLabels()).not.toContain('Acme');
    // The pick kept the row, so the schema's arrival relabels it without a fetch.
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('the browse-all dialog: a pick made before the schema resolves reads the declared nameField after it does', async () => {
    const { ds, releaseSchema } = await mountEmpty();
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-all-records'));
    });
    await waitFor(() => expect(screen.getByTestId('record-row-c1')).toBeInTheDocument());
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-row-c1'));
    });
    await settle();
    expect(screen.queryByTestId('record-row-c1')).not.toBeInTheDocument();
    expect(chipLabels()).toEqual(['Acme']);

    await release(releaseSchema);
    expect(chipLabels()).toEqual(['HT-001']);
    expect(chipLabels()).not.toContain('Acme');
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('quick-create: a record created before the schema resolves reads the declared nameField after it does', async () => {
    const { ds, releaseSchema } = await mountEmpty();
    await openDropdown();
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Globex' } });
    });
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Globex/ }));
    });
    await settle();
    expect(ds.create).toHaveBeenCalledWith('contract', { name: 'Globex' });
    expect(chipLabels()).toEqual(['Globex']);

    await release(releaseSchema);
    expect(chipLabels()).toEqual(['HT-003']);
    expect(chipLabels()).not.toContain('Globex');
  });

  it('control: a pick made after the schema loaded reads the declared nameField at once', async () => {
    const { releaseSchema } = await mountEmpty();
    await release(releaseSchema);
    await openDropdown();
    expect(optionLabels()).toEqual(['HT-001', 'HT-002']);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('option')[0]);
    });
    await settle();
    expect(chipLabels()).toEqual(['HT-001']);
  });

  it('control: after the schema resolves, the dropdown option for the picked record reads the same text as its chip', async () => {
    const { releaseSchema } = await mountEmpty();
    await openDropdown();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('option')[0]);
    });
    await settle();
    await release(releaseSchema);
    await openDropdown();
    expect(optionLabels()).toContain('HT-001');
    expect(optionLabels()).not.toContain('Acme');
    expect(chipLabels()).toEqual(['HT-001']);
  });
});
