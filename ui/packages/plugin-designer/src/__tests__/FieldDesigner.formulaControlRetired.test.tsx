/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6043 — the Field Designer offers no formula-expression control, and
 * its form no longer carries the key in either direction.
 *
 * The wire halves of this card are pinned by
 * `MetadataFieldsPage.retiredFormula.test.tsx` and
 * `MetadataService.retiredFormula.test.ts`. This file pins the half neither of
 * those can see: the CONTROL. A converter that drops `formula` keeps the PUT
 * parseable even while the drawer still renders a formula textarea — the author
 * would then type an expression, watch the save succeed, and get a field that
 * computes nothing. That failure is invisible to a wire assertion, so it needs
 * its own instrument here.
 *
 * ## What was removed, and why not renamed
 *
 * The control wrote `formula`, a key `FieldSchema` refuses BY NAME, so saving a
 * formula field returned a hard 422 `INVALID_METADATA` that blocked every later
 * save of the object. The spec spells the concept `expression` — and the rename
 * was refused, because `FieldSchema` judges the key and never the expression
 * LANGUAGE (it accepts `expression: '!!!not cel at all!!!'`). Spec `expression`
 * is CEL rooted at `record`; this control's placeholder taught
 * `e.g. price * quantity`, whose bare field refs `celAuthoring.ts` records as
 * evaluating to null silently. Renaming would have bought a green save for an
 * expression that quietly computes nothing.
 *
 * Teaching CEL in the control instead would need lint, autocomplete and
 * `returnType` inference — i.e. `CelPredicateField`, which lives in
 * `@object-ui/app-shell`. app-shell DEPENDS on this package, so it cannot be
 * imported back without a cycle, and this package has no CEL engine of its own.
 * Formula expressions are therefore authored in metadata-admin's
 * `ObjectFieldInspector`, where the real `@objectstack/formula` engine checks
 * them.
 *
 * ## Every absence here is paired with a presence
 *
 * A `queryByTestId(...)` that returns null is green when the control is gone AND
 * green when the drawer never opened, the mock never rendered, or the section
 * list came back empty. So each absence below is asserted next to a POSITIVE
 * CONTROL — a sibling control of the same section, captured through the same
 * testid channel in the same render. If the harness did nothing, the control
 * fails first and the absence is never read as a result.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { DesignerFieldDefinition } from '@object-ui/types';
import { FieldDesigner } from '../FieldDesigner';

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-form')),
}));

/**
 * A formula field as it exists after this card: a real, authorable field TYPE
 * (`FieldSchema` accepts `{ type: 'formula', label }`) with no expression key
 * on the designer's model at all.
 */
const FIELDS: DesignerFieldDefinition[] = [
  { id: 'amount', name: 'amount', label: 'Amount', type: 'number' },
  { id: 'total', name: 'total', label: 'Total', type: 'formula' },
  { id: 'owner_id', name: 'owner_id', label: 'Owner', type: 'lookup', referenceTo: 'account' },
];

afterEach(cleanup);

function renderDesigner(onFieldsChange?: (f: DesignerFieldDefinition[]) => void) {
  render(
    <FieldDesigner objectName="invoice" fields={FIELDS} onFieldsChange={onFieldsChange} />,
  );
}

/**
 * Open the edit drawer for one field.
 *
 * The grid mock fills its rows from `dataSource.find()`, a PROMISE, so the row
 * buttons do not exist on the first paint. Querying for one synchronously threw
 * "unable to find an element" while the tree was still empty — and had this file
 * only asserted absences, that same empty tree would have made every one of them
 * pass. Waiting for the row is what turns the assertions that follow into
 * readings of a mounted drawer.
 */
async function openEditDrawer(fieldName: string) {
  const row = await screen.findByTestId(`grid-edit-${fieldName}`);
  fireEvent.click(row);
  await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());
}

describe('objectui#6043 · the drawer offers no formula-expression control', () => {
  it('renders no `formula` field in the create drawer', async () => {
    renderDesigner();
    fireEvent.click(screen.getByTestId('grid-add-btn'));
    await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());

    // POSITIVE CONTROL first. `referenceTo` is the sibling control in the very
    // same `typeSpecific` section, reached through the same testid channel. If
    // it is missing the harness rendered nothing and the absence below would be
    // a vacuous pass rather than a measurement.
    expect(screen.getByTestId('drawer-field-referenceTo')).toBeTruthy();
    expect(screen.getByTestId('drawer-section-typeSpecific')).toBeTruthy();

    expect(screen.queryByTestId('drawer-field-formula')).toBeNull();
  });

  it('renders no `formula` field in the edit drawer either', async () => {
    // Create and edit build the drawer from the same schema but different
    // `initialValues`, and the pre-fix code seeded the key on BOTH paths.
    renderDesigner();
    await openEditDrawer('total');

    expect(screen.getByTestId('drawer-field-referenceTo')).toBeTruthy();
    expect(screen.getByTestId('drawer-mode').textContent).toBe('edit');

    expect(screen.queryByTestId('drawer-field-formula')).toBeNull();
  });
});

describe('objectui#6043 · the form model carries no formula expression', () => {
  it('emits no `formula` key when an existing formula field is edited and saved', async () => {
    // End-to-end through the real code: the mock submits `schema.initialValues`
    // back into the real `handleFormSuccess`, so this exercises the edit SEED
    // and the update WRITE path together — the two sites that both named the
    // key before this card.
    const changed = vi.fn();
    renderDesigner(changed);
    await openEditDrawer('total');
    fireEvent.click(screen.getByTestId('drawer-submit'));

    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const emitted: DesignerFieldDefinition[] = changed.mock.calls[0][0];
    const total = emitted.find((f) => f.name === 'total')!;

    expect('formula' in total).toBe(false);
    // Not renamed either — the designer has no expression source and must not
    // invent one under the accepted spelling.
    expect('expression' in total).toBe(false);
    // Falsification: the round-trip actually happened and preserved the field,
    // so the absences above are a model that stopped carrying the key rather
    // than a submit that never fired.
    expect(total.type).toBe('formula');
    expect(total.label).toBe('Total');
  });

  it('still round-trips a lookup target through the same path', async () => {
    // The must-not-change half. This is the control for the test above: it
    // proves the edit seed and update path still carry type-specific values in
    // general, so their silence on `formula` is specific rather than a broken
    // form.
    //
    // ⚠ This case also passes on a revert of this card, and says so
    // deliberately — objectui#6041 owns the `reference` spelling, not this file.
    const changed = vi.fn();
    renderDesigner(changed);
    await openEditDrawer('owner_id');
    fireEvent.click(screen.getByTestId('drawer-submit'));

    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const emitted: DesignerFieldDefinition[] = changed.mock.calls[0][0];
    const owner = emitted.find((f) => f.name === 'owner_id')!;

    expect(owner.referenceTo).toBe('account');
  });

  it('keeps `formula` in the type palette — the TYPE was never the defect', async () => {
    // Measured on `@objectstack/spec` 17.2.0: `FieldSchema.safeParse({ type:
    // 'formula', label: 'Tax' })` succeeds. Only the expression key was refused,
    // so removing the type would have broken formula fields outright — the
    // opposite of this card. The grouped type filter is the palette's own
    // surface, so the option living there is the checkable form of that claim.
    renderDesigner();
    // The filter is the shared Select (objectui#11865): its options are read
    // from the open list, by label.
    fireEvent.keyDown(screen.getByTestId('field-designer-type-filter'), { key: 'ArrowDown' });
    const labels = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent);

    expect(labels).toContain('Formula');
    // Control: the list is populated, so the presence above is a real reading.
    expect(labels).toContain('Lookup');
    expect(labels.length).toBeGreaterThan(5);
  });
});
