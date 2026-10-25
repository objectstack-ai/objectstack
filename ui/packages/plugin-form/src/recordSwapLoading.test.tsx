/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Swapping `recordId` on a MOUNTED sectioned form must not show the old record.
 *
 * `loading` in these four containers was only ever set `true` once, by
 * `useState(true)`, and thereafter only ever set `false`. So a `recordId` change
 * re-entered the fetch effect WITHOUT going back through the loading branch: the
 * form stayed mounted showing — and accepting edits to — record A's values, with
 * no indication that a different record had been asked for, until B's response
 * landed and replaced them in place. Anything typed in that window belonged to A
 * on screen and to B on submit.
 *
 * The same effect also had no staleness guard, so two overlapping fetches landed
 * in COMPLETION order rather than request order: ask for B then C, and a slow B
 * arriving last left the form showing B while the caller had asked for C.
 *
 * Both are the same defect from the user's side — the form displays a record
 * nobody asked for — so both are pinned here. `ObjectForm` already did the right
 * thing (it re-enters loading before the fetch), which is why this only ever
 * reproduced on the sectioned variants.
 *
 * `WizardForm` got the staleness guard (objectui#10712) but not the loading
 * half, so a swap left the previous record's values drawn and editable on the
 * current step while the new read was in flight (objectui#10726). It is a row
 * of the swap table below, and a create-mode control of its own.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';
import { TabbedForm } from './TabbedForm';
import { SplitForm } from './SplitForm';
import { WizardForm, type WizardFormSchema } from './WizardForm';

registerAllFields();

const SECTIONS = [{ name: 'basics', label: 'Basics', fields: ['title'] }];

/** A `findOne` whose every response is resolved by the test, by record id. */
function deferredDataSource() {
  const pending = new Map<string, (v: unknown) => void>();
  return {
    ds: {
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'task',
        fields: { title: { type: 'text', label: 'Title' } },
      }),
      create: vi.fn(),
      update: vi.fn(),
      findOne: vi.fn(
        (_obj: string, id: string) =>
          new Promise((resolve) => {
            pending.set(id, resolve as (v: unknown) => void);
          }),
      ),
    } as any,
    /**
     * Resolve the read for `id` with that record's payload, waiting for the
     * request to actually be issued first — the fetch effect is gated on
     * `getObjectSchema` resolving, so `findOne` is a tick or two behind render.
     */
    async land(id: string, title: string) {
      const resolve = await waitFor(() => {
        const r = pending.get(id);
        if (!r) throw new Error(`no in-flight findOne for ${id}`);
        return r;
      });
      pending.delete(id);
      resolve({ id, title });
      // Let the resulting state updates flush.
      await waitFor(() => {});
    },
  };
}

const titleInput = () =>
  document.body.querySelector<HTMLInputElement>('[data-field="title"] input');

/**
 * The containers under test, as one type.
 *
 * They are genuinely different components — `ModalFormProps.schema` is a
 * `ModalFormSchema`, `DrawerFormProps.schema` a `DrawerFormSchema`, and so on,
 * each pinned to its own `formType` literal. A `describe.each` tuple therefore
 * hands JSX a UNION of their component types, and JSX resolves a union of
 * components by INTERSECTING their props: `ModalFormSchema & DrawerFormSchema &
 * …` reduces `formType` to `never`, so every schema is rejected — including the
 * right one for the case actually running. Ten of this package's thirteen
 * unchecked-test errors were that one collision, reported as
 * `Type 'any' is not assignable to type 'never'`.
 *
 * Naming the surface the parametrisation really exercises — the same two props
 * against each container — is what makes the suite expressible. `schema` is
 * deliberately `any` here and cannot be anything else: assigning
 * `React.FC< ModalFormProps >` to a shared component type requires the shared
 * schema type to be assignable to `ModalFormSchema` AND `DrawerFormSchema` AND
 * every other one at once, which nothing but `any` satisfies. That is a fact
 * about these containers having no common props base, not a cast hiding a
 * mismatch: the `formType` each case passes is checked below instead.
 */
type SectionedFormContainer = React.ComponentType<{
  schema: any;
  dataSource?: DataSource;
}>;

/** The `formType` discriminants these containers are pinned to, spelled once. */
type SectionedFormType = 'modal' | 'drawer' | 'tabbed' | 'split' | 'wizard';

const CONTAINERS: ReadonlyArray<readonly [string, SectionedFormContainer, SectionedFormType]> = [
  ['ModalForm', ModalForm, 'modal'],
  ['DrawerForm', DrawerForm, 'drawer'],
  ['TabbedForm', TabbedForm, 'tabbed'],
  ['SplitForm', SplitForm, 'split'],
  // objectui#10726. A wizard step is a section, so `SECTIONS` is its one step.
  ['WizardForm', WizardForm, 'wizard'],
];

/** The two overlay containers — the only ones with an unsaved-input guard. */
const OVERLAY_CONTAINERS = CONTAINERS.filter(([, , t]) => t === 'modal' || t === 'drawer');

const schemaFor = (formType: SectionedFormType, recordId: string) =>
  ({
    type: 'object-form',
    formType,
    objectName: 'task',
    mode: 'edit',
    recordId,
    sections: SECTIONS,
    // Overlay variants only.
    open: true,
    onOpenChange: vi.fn(),
  }) as any;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe.each(CONTAINERS)('%s — recordId swap', (_name, Form, formType) => {
  it('does not keep showing the previous record while the new one loads', async () => {
    const { ds, land } = deferredDataSource();
    const { rerender } = render(
      <Form schema={schemaFor(formType, 'r1')} dataSource={ds} />,
    );

    await land('r1', 'Record One');
    await waitFor(() => expect(titleInput()?.value).toBe('Record One'));

    // The caller asks for a different record. B's read is still in flight.
    rerender(<Form schema={schemaFor(formType, 'r2')} dataSource={ds} />);

    // Record A must be off screen — showing it here invites the user to edit
    // values that will be submitted against record B.
    expect(titleInput()?.value ?? null).not.toBe('Record One');

    await land('r2', 'Record Two');
    await waitFor(() => expect(titleInput()?.value).toBe('Record Two'));
  });

  it('ignores a stale response that lands after a newer one', async () => {
    const { ds, land } = deferredDataSource();
    const { rerender } = render(
      <Form schema={schemaFor(formType, 'r1')} dataSource={ds} />,
    );
    await land('r1', 'Record One');
    await waitFor(() => expect(titleInput()?.value).toBe('Record One'));

    // Two swaps in flight; the SECOND is what the caller wants.
    rerender(<Form schema={schemaFor(formType, 'r2')} dataSource={ds} />);
    rerender(<Form schema={schemaFor(formType, 'r3')} dataSource={ds} />);

    // Responses come back out of order — r3 first, then the slower r2.
    await land('r3', 'Record Three');
    await land('r2', 'Record Two');

    // Request order wins, not completion order.
    await waitFor(() => expect(titleInput()?.value).toBe('Record Three'));
    expect(titleInput()?.value).not.toBe('Record Two');
  });
});

/**
 * Hiding the form to load the next record UNMOUNTS the inner renderer, and that
 * renderer is the only thing that reports dirtiness (`onDirtyChange`) — it gets
 * no chance to report `false` on its way out. Left alone, the overlay's guards
 * (#2998) would stay armed for input belonging to a record no longer on screen:
 * a plain refresh would prompt, and closing would ask to discard nothing.
 */
describe.each(OVERLAY_CONTAINERS)('%s — swapping records clears the unsaved-input guard', (_name, Form, formType) => {
  it('stops blocking unload once the previous record is gone', async () => {
    const { ds, land } = deferredDataSource();
    const { rerender } = render(
      <Form schema={schemaFor(formType, 'r1')} dataSource={ds} />,
    );
    await land('r1', 'Record One');
    await waitFor(() => expect(titleInput()?.value).toBe('Record One'));

    // Dirty record A, and prove the guard is armed.
    fireEvent.change(titleInput() as HTMLInputElement, { target: { value: 'edited' } });
    await waitFor(() => {
      const evt = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
    });

    rerender(<Form schema={schemaFor(formType, 'r2')} dataSource={ds} />);

    // A's edits went with A — nothing unsaved is on screen to protect.
    const armed = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(armed);
    expect(armed.defaultPrevented).toBe(false);
  });
});

describe('create mode is unaffected', () => {
  it('never enters the loading state for a form with no recordId', async () => {
    const { ds } = deferredDataSource();
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'task',
          mode: 'create',
          sections: SECTIONS,
          open: true,
          onOpenChange: vi.fn(),
        } as any}
        dataSource={ds}
      />,
    );

    // Renders straight to an empty form; `findOne` is never called.
    await waitFor(() => expect(titleInput()).not.toBeNull());
    expect(titleInput()?.value).toBe('');
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  // objectui#10726 — the wizard's swap loading sits after its create branch.
  it('never takes a create wizard back to loading, including when its record effect re-runs', async () => {
    const { ds } = deferredDataSource();
    const createWizard = (): WizardFormSchema => ({
      type: 'object-form',
      formType: 'wizard',
      objectName: 'task',
      mode: 'create',
      sections: SECTIONS,
      // Rebuilt on every render, as callers commonly do: each rerender
      // re-runs the record effect through its create branch.
      initialValues: {},
    });
    const { rerender } = render(<WizardForm schema={createWizard()} dataSource={ds} />);

    await waitFor(() => expect(titleInput()).not.toBeNull());
    const drawn = titleInput();
    expect(drawn?.value).toBe('');

    rerender(<WizardForm schema={createWizard()} dataSource={ds} />);
    await waitFor(() => {});

    // A loading state in between would have unmounted the step form.
    expect(titleInput()).toBe(drawn);
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});

/**
 * objectui#10726 — the wizard goes back to loading on a change of RECORD only,
 * which is why its swap is keyed on the record it last loaded. A re-read of the
 * record already on screen (a caller rebuilding `initialValues`) keeps the step
 * form mounted.
 */
describe('WizardForm — a re-run for the same record', () => {
  it('keeps the step form mounted while the same record is read again', async () => {
    const { ds, land } = deferredDataSource();
    const editWizard = () => ({ ...schemaFor('wizard', 'r1'), initialValues: {} });
    const { rerender } = render(<WizardForm schema={editWizard()} dataSource={ds} />);
    await land('r1', 'Record One');
    await waitFor(() => expect(titleInput()?.value).toBe('Record One'));
    const drawn = titleInput();

    rerender(<WizardForm schema={editWizard()} dataSource={ds} />);
    await waitFor(() => expect(ds.findOne).toHaveBeenCalledTimes(2));

    expect(titleInput()).toBe(drawn);
    expect(titleInput()?.value).toBe('Record One');
  });
});
