/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A form locked because the object's affordance is CLOSED says so, and a
 * wizard does not walk the user on (objectui#11000).
 *
 * ## The defect
 *
 * The ADR-0092 D4 lock (`gateFormFields`) disables every drawn field when the
 * object's affordance for the form's mode is closed for the user: `create` on
 * a create form, `edit` on an edit form. The lock was right, but nothing on the
 * form said why, and a wizard's Next stayed enabled: a member without `create`
 * met a form that silently refused typing and invited them through steps they
 * could not submit.
 *
 * ## The rows, and what makes each one able to fail
 *
 * One table, every layout `ObjectForm` routes to × every principal/object pair,
 * provider-less, so the notice renders the English defaults (the zh rendering
 * is `closedAffordanceNotice.i18n-11000.test.tsx`). Each row asserts the notice
 * (its absence, or the affordance it names and its text) and, per drawn field,
 * whether it is locked.
 *
 * - "member without create": the server's effective API operation set lacks
 *   `create`. Every field is locked and the notice names `create` and the
 *   object's label. Red before this card: there was no notice.
 * - "member without edit (edit form)": the same on an edit form, naming `edit`.
 * - "owner": every operation. No notice, every field live — the control. A
 *   notice that always rendered cannot pass it.
 * - "field-level lock, affordance open": the caller may read `amount` but not
 *   edit it. `amount` is locked, `customer` is live, and there is NO notice: a
 *   per-field lock is not a closed affordance.
 * - "readonly field, affordance open": the object declares `amount` readonly.
 *   The same verdict: no notice.
 *
 * The wizard block below adds the navigation half: while the affordance is
 * closed, Next and the final submit are disabled and the indicator does not
 * jump forward (`allowSkip`); Cancel stays usable and every step stays shown.
 * For the owner, Next and the forward jump work.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';

registerAllFields();
afterEach(cleanup);

const FIELDS = {
  customer: { type: 'text', label: 'Customer' },
  amount: { type: 'number', label: 'Amount' },
};
const RECORD = { id: 'i1', customer: 'Acme', amount: 5 };

const sections = (names: string[]) => [{ name: 'main', label: 'Main', fields: names }];

const LAYOUTS: Array<{ layout: string; schema: (names: string[]) => Record<string, unknown> }> = [
  { layout: 'simple / sections (default arm)', schema: (n) => ({ sections: sections(n) }) },
  { layout: 'drawer / sections (DrawerForm)', schema: (n) => ({ formType: 'drawer', sections: sections(n) }) },
  { layout: 'modal / sections (ModalForm)', schema: (n) => ({ formType: 'modal', sections: sections(n) }) },
  { layout: 'tabbed / sections (TabbedForm)', schema: (n) => ({ formType: 'tabbed', sections: sections(n) }) },
  { layout: 'split / sections (SplitForm)', schema: (n) => ({ formType: 'split', sections: sections(n) }) },
  { layout: 'wizard / sections (WizardForm)', schema: (n) => ({ formType: 'wizard', sections: sections(n) }) },
  { layout: 'simple / flat (default arm)', schema: (n) => ({ fields: n }) },
  { layout: 'drawer / flat (DrawerForm)', schema: (n) => ({ formType: 'drawer', fields: n }) },
  { layout: 'modal / flat (ModalForm)', schema: (n) => ({ formType: 'modal', fields: n }) },
];

const ALL_OPERATIONS = ['create', 'read', 'update', 'delete'];

/** A caller on `invoice` whose effective API operation set is `apiOperations`. */
const principal = (apiOperations: string[], fields: Record<string, unknown> = {}): any => ({
  authenticated: true,
  userId: 'u-1',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: {
    invoice: {
      allowCreate: apiOperations.includes('create'),
      allowRead: true,
      allowEdit: apiOperations.includes('update'),
      allowDelete: false,
      apiOperations,
    },
  },
  fields,
});

const CREATE_NOTICE = "You don't have permission to create Invoice records. The fields are read-only.";
const EDIT_NOTICE = "You don't have permission to edit Invoice records. The fields are read-only.";

const CASES: Array<{
  case: string;
  object: Record<string, unknown>;
  principal: any;
  mode: 'create' | 'edit';
  notice: { affordance: 'create' | 'edit'; text: string } | null;
  drawn: Record<string, boolean>;
  /** Fields a layout may leave undrawn; when drawn, they must match `drawn`. */
  mayOmit?: string[];
}> = [
  {
    case: 'member without create',
    object: {},
    principal: principal(['read', 'update']),
    mode: 'create',
    notice: { affordance: 'create', text: CREATE_NOTICE },
    drawn: { customer: true, amount: true },
  },
  {
    case: 'member without edit (edit form)',
    object: {},
    principal: principal(['create', 'read']),
    mode: 'edit',
    notice: { affordance: 'edit', text: EDIT_NOTICE },
    drawn: { customer: true, amount: true },
  },
  {
    case: 'owner (control)',
    object: {},
    principal: principal(ALL_OPERATIONS),
    mode: 'create',
    notice: null,
    drawn: { customer: false, amount: false },
  },
  {
    case: 'field-level lock, affordance open',
    object: {},
    principal: principal(ALL_OPERATIONS, { 'invoice.amount': { readable: true, editable: false } }),
    mode: 'create',
    notice: null,
    drawn: { customer: false, amount: true },
  },
  {
    case: 'readonly field, affordance open',
    object: { fields: { ...FIELDS, amount: { ...FIELDS.amount, readonly: true } } },
    principal: principal(ALL_OPERATIONS),
    mode: 'create',
    notice: null,
    // The flat arms leave a readonly field off the form altogether; the
    // sectioned arms draw it locked. Either way the affordance is open.
    drawn: { customer: false, amount: true },
    mayOmit: ['amount'],
  },
];

function makeDS(object: Record<string, unknown> = {}) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'invoice', label: 'Invoice', fields: FIELDS, ...object }),
    findOne: vi.fn().mockResolvedValue({ ...RECORD }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockResolvedValue({ ...RECORD }),
    update: vi.fn().mockResolvedValue({ ...RECORD }),
  };
}

/** Every rendered field, mapped to whether it kept no enabled control. */
function drawnFields(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of document.body.querySelectorAll('[data-field]')) {
    const name = item.getAttribute('data-field') as string;
    out[name] = item.querySelector('input:not([disabled]), textarea:not([disabled])') === null;
  }
  return out;
}

/** Read off `document.body`: the drawer and the modal portal out. */
const notices = () => Array.from(document.body.querySelectorAll('[data-testid="closed-affordance-notice"]'));

async function formOnScreen(mode: 'create' | 'edit') {
  await waitFor(() => {
    const el = document.querySelector('input[name="customer"]') as HTMLInputElement | null;
    if (!el) throw new Error('form not drawn yet');
    if (mode === 'edit' && el.value !== RECORD.customer) throw new Error('record not on screen yet');
  });
}

describe.each(LAYOUTS)('ObjectForm $layout: the closed-affordance notice (objectui#11000)', ({ schema }) => {
  it.each(CASES)('$case', async (row) => {
    render(
      <MePermissionsProvider initialPermissions={row.principal}>
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'invoice',
            ...schema(Object.keys(FIELDS)),
            mode: row.mode,
            ...(row.mode === 'edit' ? { recordId: 'i1' } : {}),
          } as any}
          dataSource={makeDS(row.object) as any}
        />
      </MePermissionsProvider>,
    );
    await formOnScreen(row.mode);

    const drawn = drawnFields();
    const expected = { ...row.drawn };
    for (const name of row.mayOmit ?? []) if (!(name in drawn)) delete expected[name];
    expect(drawn).toEqual(expected);
    const shown = notices();
    if (row.notice === null) {
      expect(shown).toHaveLength(0);
    } else {
      // ONE notice, announced as a status, naming the permission and the object.
      expect(shown).toHaveLength(1);
      expect(shown[0].getAttribute('role')).toBe('status');
      expect(shown[0].getAttribute('data-affordance')).toBe(row.notice.affordance);
      expect(shown[0].textContent).toBe(row.notice.text);
    }
  });
});

describe('WizardForm navigation while the affordance is closed (objectui#11000)', () => {
  /** Two steps, `allowSkip` on, so the indicator COULD jump forward. */
  function mountWizard(apiOperations: string[], mode: 'create' | 'edit' = 'create', steps = 2) {
    const onCancel = vi.fn();
    const ds = makeDS();
    render(
      <MePermissionsProvider initialPermissions={principal(apiOperations)}>
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'invoice',
            formType: 'wizard',
            allowSkip: true,
            mode,
            ...(mode === 'edit' ? { recordId: 'i1' } : {}),
            onCancel,
            sections: [
              { name: 'who', label: 'Who', fields: ['customer'] },
              { name: 'what', label: 'What', fields: ['amount'] },
            ].slice(0, steps),
          } as any}
          dataSource={ds as any}
        />
      </MePermissionsProvider>,
    );
    return { onCancel, ds };
  }

  const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('member without create: the notice shows, the fields and Next are disabled, the indicator does not jump forward', async () => {
    const { onCancel } = mountWizard(['read', 'update']);
    await formOnScreen('create');

    expect(notices()).toHaveLength(1);
    expect(notices()[0].textContent).toBe(CREATE_NOTICE);
    expect(drawnFields()).toEqual({ customer: true });
    expect(button('Next').disabled).toBe(true);

    // Every step is still shown; only the one AHEAD refuses to open.
    const ahead = screen.getByTestId('wizard-step:what') as HTMLButtonElement;
    expect(ahead.disabled).toBe(true);
    fireEvent.click(ahead);
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();

    // Cancel stays usable.
    expect(button('Cancel').disabled).toBe(false);
    fireEvent.click(button('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('member without create, single step: the final Create is disabled', async () => {
    const { ds } = mountWizard(['read', 'update'], 'create', 1);
    await formOnScreen('create');

    expect(notices()).toHaveLength(1);
    const submit = button('Create');
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('member without edit, on an edit wizard: the notice names edit and Next is disabled', async () => {
    mountWizard(['create', 'read'], 'edit');
    await formOnScreen('edit');

    expect(notices()).toHaveLength(1);
    expect(notices()[0].textContent).toBe(EDIT_NOTICE);
    expect(button('Next').disabled).toBe(true);
  });

  it('owner (control): no notice, Next is enabled and advances, the indicator jumps forward', async () => {
    mountWizard(ALL_OPERATIONS);
    await formOnScreen('create');

    expect(notices()).toHaveLength(0);
    expect(drawnFields()).toEqual({ customer: false });
    expect(button('Next').disabled).toBe(false);
    expect((screen.getByTestId('wizard-step:what') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button('Next'));
    await screen.findByText('Step 2 of 2');
    // On step 2, Back and the final Create are live.
    expect(button('Back').disabled).toBe(false);
    expect(button('Create').disabled).toBe(false);
  });
});
