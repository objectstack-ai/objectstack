/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A lookup option's label follows the ADR-0079 order the record page follows —
 * objectui#10343, an inherited branch of objectui#9436's ruling C1.
 *
 * `@objectstack/spec` 17.4.0 describes `titleFormat` as "[DEPRECATED →
 * nameField (ADR-0079)] … an explicit nameField now takes precedence", and
 * describes a lookup's `displayField` as the "Field shown as each candidate's
 * label in the picker/popover (defaults to the referenced object's
 * name/title)". `recordToOption` put the rendered `titleFormat` FIRST — above
 * the referenced object's declared `nameField` and above the lookup field's own
 * `displayField` — so one record read one way on its record page and in its
 * lookup cell, and another way in the dropdown that picks it.
 *
 * The order pinned here is the one triage placed (the field's own
 * `displayField`, then the declared `nameField`, then `titleFormat`), which is
 * `@object-ui/core`'s `getRecordDisplayName` with the field's declared
 * `displayField` as its `titleField` — the same call `LookupCellRenderer`
 * already makes.
 *
 * Every fixture record also carries a `name` field on purpose. A lookup field
 * that declares no `displayField` must not let the widget's own `name` guess
 * outrank the object's declarations: the spec says the undeclared default is
 * "the referenced object's name/title", and the "only a `titleFormat`" pin
 * below is red for any order that reads `name` above the template.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { LookupField } from './LookupField';

interface ObjectDecl {
  nameField?: string;
  titleFormat?: string;
}

const CONTRACT_FIELDS: Record<string, unknown> = {
  contract_no: { type: 'text', label: 'Contract No' },
  name: { type: 'text', label: 'Name' },
  party: { type: 'text', label: 'Party' },
  short_code: { type: 'text', label: 'Short Code' },
};

const ROWS: Record<string, unknown>[] = [
  { id: 'c1', contract_no: 'HT-001', name: 'Acme', party: 'Globex', short_code: 'AC' },
  { id: 'c2', contract_no: 'HT-002', name: 'Initech', party: 'Umbrella', short_code: 'IN' },
];

function makeBackend(decl: ObjectDecl, rows: Record<string, unknown>[] = ROWS) {
  const find = vi.fn(async (objectName: string) =>
    objectName === 'contract' ? { data: rows.map((r) => ({ ...r })), total: rows.length } : { data: [], total: 0 },
  );
  const findOne = vi.fn(async (objectName: string, id: string) =>
    objectName === 'contract' ? rows.find((r) => r.id === id) ?? null : null,
  );
  const getObjectSchema = vi.fn(async (objectName: string) =>
    objectName === 'contract' ? { name: 'contract', fields: CONTRACT_FIELDS, ...decl } : undefined,
  );
  return { find, findOne, getObjectSchema } as any;
}

type Backend = ReturnType<typeof makeBackend>;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function renderLookup(ds: Backend, field: Record<string, unknown>, value: unknown = undefined): void {
  render(
    <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
      <LookupField
        value={value}
        onChange={() => {}}
        dataSource={ds}
        field={{ reference: 'contract', ...field } as never}
      />
    </SchemaRendererContext.Provider>,
  );
}

/** Open the dropdown and read each candidate's label (its `title` attribute). */
async function optionLabels(ds: Backend, field: Record<string, unknown> = {}): Promise<string[]> {
  renderLookup(ds, field);
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('contract'));
  await settle();
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
  await settle();
  return screen.getAllByRole('option').map((el) => el.getAttribute('title') ?? '');
}

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('LookupField — option label order: displayField, then nameField, then titleFormat (objectui#10343)', () => {
  it('the object declares both nameField and titleFormat: the option shows the nameField value', async () => {
    const labels = await optionLabels(makeBackend({ nameField: 'contract_no', titleFormat: '{party} / {contract_no}' }));
    expect(labels).toEqual(['HT-001', 'HT-002']);
    // The template renders nowhere, and the widget's `name` guess does not win either.
    expect(labels.join(' ')).not.toContain('Globex');
    expect(labels.join(' ')).not.toContain('Acme');
  });

  it("the field declares displayField: the option shows it, above the object's nameField and titleFormat", async () => {
    const labels = await optionLabels(
      makeBackend({ nameField: 'contract_no', titleFormat: '{party} / {contract_no}' }),
      { displayField: 'short_code' },
    );
    expect(labels).toEqual(['AC', 'IN']);
  });

  it('only a titleFormat: the template is still used', async () => {
    const labels = await optionLabels(makeBackend({ titleFormat: '{party} / {contract_no}' }));
    expect(labels).toEqual(['Globex / HT-001', 'Umbrella / HT-002']);
  });

  it('control: a nameField blank on the record falls through to the template', async () => {
    const rows = ROWS.map((r) => ({ ...r, contract_no: '' }));
    const labels = await optionLabels(
      makeBackend({ nameField: 'contract_no', titleFormat: '{party} / {contract_no}' }, rows),
    );
    expect(labels).toEqual(['Globex', 'Umbrella']);
  });

  it('control: a `{{field}}` template renders as its `{field}` twin (the shared title renderer)', async () => {
    const labels = await optionLabels(makeBackend({ titleFormat: '{{party}} / {{contract_no}}' }));
    expect(labels).toEqual(['Globex / HT-001', 'Umbrella / HT-002']);
  });

  it('the selected-value chip of an expanded reference reads the same order', async () => {
    const ds = makeBackend({ nameField: 'contract_no', titleFormat: '{party} / {contract_no}' });
    renderLookup(ds, {}, { ...ROWS[0] });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('contract'));
    await settle();
    // The chip renders above the trigger; the dropdown is closed, so no option
    // row can supply either text.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('HT-001')).toBeInTheDocument();
    expect(screen.queryByText(/Globex/)).toBeNull();
  });
});
