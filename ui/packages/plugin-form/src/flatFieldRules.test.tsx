/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A no-sections overlay form honours the object's ADR-0036 field-level rules —
 * objectui#4755.
 *
 * `DrawerForm` and `ModalForm` each accept `objectName` with no `sections`, and
 * each used to build the runtime field list with its own hand-copied loop. The
 * drawer's copy stopped at `multiple`: `visibleWhen`, `readonlyWhen` and
 * `requiredWhen` never reached the runtime `FormField`, so
 * `resolveFieldRuleState` had nothing to resolve and every declaration was
 * silently ignored — a `visibleWhen`-FALSE field rendered anyway, a
 * `readonlyWhen`-TRUE field stayed editable (and the server then dropped the
 * write and reported `droppedFields`), and `requiredWhen` never fired.
 *
 * Both containers are driven here as ONE table, deliberately: the modal rows
 * are the non-regression half (it already behaved this way and must keep
 * doing so after both builders converged onto `buildFlatFields`), the drawer
 * rows are the fix. Any future re-fork of either builder shows up as one
 * container's rows going red while the other's stay green — which is exactly
 * the signal that was missing when this drift shipped.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';

registerAllFields();

/**
 * An invoice whose three conditional rules all key off the same live field, so
 * one `status` value decides all three verdicts at once.
 */
const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    status: { type: 'text', label: 'Status' },
    // Shown only once the invoice has been sent.
    sent_at: { type: 'text', label: 'Sent at', visibleWhen: "record.status == 'sent'" },
    // Frozen once the invoice has been sent (the server strips the write too).
    amount: { type: 'text', label: 'Amount', readonlyWhen: "record.status == 'sent'" },
    // Mandatory only once the invoice has been sent.
    reference: { type: 'text', label: 'Reference', requiredWhen: "record.status == 'sent'" },
  },
};

const makeDS = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    create: vi.fn().mockResolvedValue({ id: 'r1' }),
    update: vi.fn().mockResolvedValue({ id: 'r1' }),
    findOne: vi.fn().mockResolvedValue({ id: 'r1' }),
  }) as any;

const submit = () => fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);

/**
 * The editable control of a rendered field, if the renderer gave it one.
 *
 * A locked field is not a disabled `<input>` in this design system — the
 * renderer swaps the control for a read-only VALUE DISPLAY (`data-slot`
 * `empty-value` when there is nothing to show). So "is it locked" is asked as
 * "did it keep an editable control", which is also the fact the user
 * experiences; a `readonly` attribute check would silently pass on a field
 * that renders no control at all.
 */
const controlOf = (field: string) =>
  document.body.querySelector(`[data-field="${field}"] input, [data-field="${field}"] textarea`);

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const CONTAINERS: Array<[string, React.ComponentType<any>, string]> = [
  ['ModalForm', ModalForm as any, 'modal'],
  ['DrawerForm', DrawerForm as any, 'drawer'],
];

describe.each(CONTAINERS)('%s — no-sections form honours field-level rules (#4755)', (_name, Container, formType) => {
  /** No `sections`, no `customFields` — the flat builder is the only producer. */
  const renderFlat = (ds: any, status: string) =>
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'invoice',
          mode: 'create',
          open: true,
          initialData: { status },
        } as any}
        dataSource={ds}
      />,
    );

  /**
   * The same form on an EDIT of a stored row: with `mode: 'edit'` and a
   * `recordId` the container hands the renderer `previousValues`, which is
   * what makes it an edit form. `readonlyWhen` binds there only — the server
   * exempts INSERT from it (objectui#13436).
   */
  const renderFlatEdit = (ds: any, status: string) => {
    ds.findOne.mockResolvedValue({ id: 'r1', status });
    return render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'invoice',
          mode: 'edit',
          recordId: 'r1',
          open: true,
          initialData: { id: 'r1', status },
        } as any}
        dataSource={ds}
      />,
    );
  };

  it('hides a `visibleWhen`-FALSE field and shows it when the predicate holds', async () => {
    renderFlat(makeDS(), 'draft');
    await screen.findByLabelText(/^Status$/);
    expect(screen.queryByLabelText(/^Sent at$/)).toBeNull();

    cleanup();

    renderFlat(makeDS(), 'sent');
    expect(await screen.findByLabelText(/^Sent at$/)).toBeTruthy();
  });

  it('locks a `readonlyWhen`-TRUE field on an edit form', async () => {
    renderFlatEdit(makeDS(), 'sent');
    await waitFor(() => expect(document.body.querySelector('[data-field="amount"]')).toBeTruthy());
    await waitFor(() => expect(controlOf('amount')).toBeNull());
  });

  it('leaves a `readonlyWhen`-TRUE field editable on a create form (objectui#13436)', async () => {
    // The server does not apply `readonlyWhen` on INSERT, so a create form
    // must not lock the field either: the user could not fill a form the API
    // accepts.
    renderFlat(makeDS(), 'sent');
    await waitFor(() => expect(document.body.querySelector('[data-field="amount"]')).toBeTruthy());
    expect(controlOf('amount')).not.toBeNull();
  });

  it('leaves the same field editable when the predicate is FALSE', async () => {
    renderFlat(makeDS(), 'draft');
    await waitFor(() => expect(document.body.querySelector('[data-field="amount"]')).toBeTruthy());
    expect(controlOf('amount')).not.toBeNull();
  });

  it('refuses the submit while a `requiredWhen` field is empty', async () => {
    const ds = makeDS();
    renderFlat(ds, 'sent');
    // The predicate reached BOTH layers: the marker (display) and the
    // validator (submit). Asserting only the refusal would pass on a form that
    // is merely broken.
    const reference = await screen.findByLabelText(/^Reference/);
    expect(reference).toHaveAttribute('aria-required', 'true');

    submit();

    await waitFor(() => expect(document.body.textContent).toMatch(/required/i));
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('lets the submit through once the `requiredWhen` field is filled', async () => {
    const ds = makeDS();
    renderFlat(ds, 'sent');
    fireEvent.change(await screen.findByLabelText(/^Reference/), { target: { value: 'INV-1' } });

    submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ reference: 'INV-1' });
  });

  it('does not require the field while the predicate is FALSE', async () => {
    const ds = makeDS();
    renderFlat(ds, 'draft');
    expect(await screen.findByLabelText(/^Reference/)).not.toHaveAttribute('aria-required', 'true');

    submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
  });
});
