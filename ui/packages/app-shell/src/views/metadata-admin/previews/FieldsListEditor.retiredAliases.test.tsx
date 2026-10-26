// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the column manager SHOWS and RESERVES after the identity read is
 * retired to the canonical spelling (objectui#5725).
 *
 * The unit pins live in `view-column-io.retiredAliases.test.ts`; this suite
 * mounts the real `FieldsListEditor` because two of the claims are only true
 * end-to-end:
 *
 *   - the positional fallback `col N` actually produces a row the author can
 *     CLICK. That was the open question objectui#5725 declined to take — an
 *     empty field-key box invites re-authoring, an empty list row would leave
 *     nothing to click — and it is answered here by measurement rather than by
 *     reading the fallback and assuming a row comes out of it.
 *   - `usedFieldNames()` reaches the Add-field picker. Measured through the
 *     real popover, so the reachability claim is not taken on trust.
 *
 * NOTE on the size of defect 2: the picker does NOT hide a used field, it tags
 * it "Added" and still lets the author click it. So a spec-refused column
 * mislabelled a field as taken; it never blocked adding it. Recorded here so
 * the pin says what the mechanism does, not what it was assumed to do.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// `useObjectFields` short-circuits the fetch when handed a catalog, but still
// constructs the shared metadata client — stub it so no test reaches the
// network. Same mechanism as ViewColumnInspector.identityRead.test.tsx.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { FieldsListEditor } from './FieldsListEditor';

afterEach(cleanup);

const CATALOG = [
  { name: 'name', label: 'Name', type: 'text', hidden: false },
  { name: 'amount', label: 'Amount', type: 'number', hidden: false },
];

/** The stored shape the whole retirement family is about. */
const LEGACY = { accessorKey: 'name', header: 'Name' };

function mount(columns: unknown[], onSelectionChange = vi.fn()) {
  render(
    <FieldsListEditor
      variantKey="list"
      schema={{ type: 'grid', columns }}
      columns={columns}
      allStrings={false}
      objectName="invoices"
      objectFieldsOverride={CATALOG}
      selectedIndex={null}
      onPatch={vi.fn()}
      onSelectionChange={onSelectionChange}
    />,
  );
  return onSelectionChange;
}

/**
 * Open the Add-field picker and return its content element.
 *
 * Scoped to the popover rather than the whole render: the column list rows are
 * `role="button"` too, so an unscoped query for an option matches the row of a
 * canonical column as well and the test dies on ambiguity instead of measuring
 * anything.
 */
function openPicker(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /Add field/i }));
  return screen.getByRole('dialog');
}

/** One field's row inside the open picker. */
const option = (picker: HTMLElement, label: string) =>
  within(picker).getByRole('button', { name: new RegExp(`^${label}`) });

describe('FieldsListEditor — a spec-refused column names itself positionally', () => {
  it('renders a CLICKABLE row for a legacy column instead of its retired alias', () => {
    const onSelectionChange = mount([LEGACY]);

    // The retired alias is gone from the list…
    expect(screen.queryByText('Name')).not.toBeInTheDocument();
    // …and the row is not nameless: it says `col 1`.
    expect(screen.getByText('col 1')).toBeInTheDocument();

    // The measurement the open question turns on: the row still selects.
    const row = screen.getByText('col 1').closest('[role="button"]') as HTMLElement;
    fireEvent.click(row);
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: 'column',
      id: 'list.columns[0]',
      label: 'col 1',
    });
  });

  it('counter-probe: a canonical column still shows its declared label', () => {
    mount([{ field: 'amount', label: 'Amount' }]);

    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.queryByText('col 1')).not.toBeInTheDocument();
  });

  it('lets a declared identity outrank a stray undeclared alias', () => {
    // The column carries NO `label`, which is the shape the inverted chain
    // actually bit on: `label ?? header ?? field` reached `header` before
    // `field`, so this row read `STRAY` instead of its own declared field.
    // Measured: with `label` also present the old chain returns `label` too,
    // so a `{field, label, header}` row cannot reverse-verify this leg at all
    // — it is green against both sources and would have been a phantom pin.
    mount([{ field: 'amount', header: 'STRAY' }]);

    expect(screen.getByText('amount')).toBeInTheDocument();
    expect(screen.queryByText('STRAY')).not.toBeInTheDocument();
  });
});

describe('FieldsListEditor — a spec-refused column reserves no field name', () => {
  it('does not tag `name` as Added for a legacy {accessorKey, header} column', () => {
    mount([LEGACY]);
    const picker = openPicker();

    // Guard against a vacuous pass: the picker really opened and really lists
    // the field, so the absent badge below is a measurement, not an empty DOM.
    expect(option(picker, 'Name')).toBeInTheDocument();
    expect(within(picker).queryByText('Added')).not.toBeInTheDocument();
  });

  it('counter-probe: a canonical column DOES still reserve its name', () => {
    mount([{ field: 'name', label: 'Name' }]);
    const picker = openPicker();

    expect(within(option(picker, 'Name')).getByText('Added')).toBeInTheDocument();
    // Falsification: the badge is keyed to the bound name, not shown on every row.
    expect(within(option(picker, 'Amount')).queryByText('Added')).not.toBeInTheDocument();
  });
});
