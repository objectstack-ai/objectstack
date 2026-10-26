/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every layout `ObjectForm` routes to draws the SAME fields in the SAME locked
 * state for the same principal and the same object (objectui#10612).
 *
 * ## The defect
 *
 * A form gates what it DRAWS twice: field-level security drops a field the
 * caller may not read and locks one they may read but not edit
 * (`applyFieldPermissions`), and the ADR-0092 D4 managed-object lock disables
 * every field when the object's resolved CRUD affordance for the form's mode is
 * closed (`resolveEffectiveCrudAffordances`: the `managedBy` bucket, its
 * `userActions` opt-in, and the server's effective API operation set). Only the
 * default arm applied the second gate, and only to the fields its own generator
 * produced. The drawer, modal, tabbed, split and wizard layouts drew live inputs
 * on a managed object whose write the server refuses (objectui#10613, folded
 * into this card). The field-level half landed with objectui#10563; its row here
 * is a regression pin, green before this card as well.
 *
 * Both gates now run as ONE step, `gateFormFields` in `fieldWriteGate.ts`, which
 * every layout calls on its resolved fields.
 *
 * ## The rows, and what makes each one able to fail
 *
 * One table: every layout × every principal/object pair. Each row asserts the
 * exact set of drawn fields and, per drawn field, whether it is locked (it kept
 * no enabled control).
 *
 * - "read-denied field": the caller may not read `amount`. Every layout draws
 *   `customer` alone, live. A layout that skips field-level security draws
 *   `amount` too.
 * - "managed, no userActions.create (create)" and "managed, no
 *   userActions.edit (edit)": a `better-auth` object that opens neither write.
 *   Every layout draws both fields, both locked. A layout that skips the lock
 *   draws them live.
 * - "server denies create": an ordinary object whose effective API operation
 *   set (`/me/permissions` `apiOperations`) lacks `create`. This is the lock's
 *   second input, so a layout that reads only the bucket goes red here.
 * - "managed, inline member (create)": the managed object again, with an
 *   inline `customFields` member the object does not declare. The member is
 *   locked with the rest. The default arm used to stamp the lock inside its
 *   field generator, so a member escaped it there as well.
 * - "managed, userActions.create opens it": the lit control. The same
 *   `better-auth` object opens `create`, so every layout draws both fields
 *   live, and a gate that locks everything cannot pass the table.
 *
 * Each layout is written with sections (every arm takes them) and, where the
 * arm has one, with the flat top-level `fields` path as well: the drawer and
 * modal gate their flat fields at a different call from their sections. In a
 * section `amount` is a spec entry carrying `readonly: false`, so the rows also
 * show that no entry override lifts either lock.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
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

/** An inline member only: the object does not declare `memo`. */
const MEMO = { name: 'memo', label: 'Memo', type: 'text' };

/** A section entry per member; `amount` is a spec entry whose override tries to re-open it. */
const entry = (name: string) => (name === 'amount' ? { field: 'amount', readonly: false } : name);
const sections = (names: string[]) => [{ name: 'main', label: 'Main', fields: names.map(entry) }];

/**
 * The layouts `ObjectForm` routes to, as a function of the member names drawn.
 * `sections` rows reach every arm; `flat` rows reach the three arms that also
 * draw top-level `fields` without sections.
 */
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

/** A caller with every object-level grant on `invoice`; `extra` narrows it. */
const principal = (extra: { fields?: Record<string, unknown>; apiOperations?: string[] } = {}): any => ({
  authenticated: true,
  userId: 'u-1',
  tenantId: null,
  roles: ['invoice_clerk'],
  permissionSets: ['invoice_clerk'],
  objects: {
    invoice: {
      allowCreate: true,
      allowRead: true,
      allowEdit: true,
      allowDelete: false,
      ...(extra.apiOperations ? { apiOperations: extra.apiOperations } : {}),
    },
  },
  fields: extra.fields ?? {},
});

/**
 * The principal/object pairs. `drawn` is the exact field set every layout must
 * draw, each name mapped to whether it is locked.
 */
const CASES: Array<{
  case: string;
  object: Record<string, unknown>;
  principal: any;
  mode: 'create' | 'edit';
  members?: Array<typeof MEMO>;
  drawn: Record<string, boolean>;
}> = [
  {
    case: 'read-denied field',
    object: {},
    principal: principal({ fields: { 'invoice.amount': { readable: false, editable: false } } }),
    mode: 'create',
    drawn: { customer: false },
  },
  {
    case: 'managed, no userActions.create (create)',
    object: { managedBy: 'better-auth' },
    principal: principal(),
    mode: 'create',
    drawn: { customer: true, amount: true },
  },
  {
    case: 'managed, no userActions.edit (edit)',
    object: { managedBy: 'better-auth' },
    principal: principal(),
    mode: 'edit',
    drawn: { customer: true, amount: true },
  },
  {
    case: 'server denies create',
    object: {},
    principal: principal({ apiOperations: ['read', 'update'] }),
    mode: 'create',
    drawn: { customer: true, amount: true },
  },
  {
    case: 'managed, inline member (create)',
    object: { managedBy: 'better-auth' },
    principal: principal(),
    mode: 'create',
    members: [MEMO],
    drawn: { customer: true, amount: true, memo: true },
  },
  {
    case: 'managed, userActions.create opens it (control)',
    object: { managedBy: 'better-auth', userActions: { create: true } },
    principal: principal(),
    mode: 'create',
    drawn: { customer: false, amount: false },
  },
];

function makeDS(object: Record<string, unknown>) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'invoice', fields: FIELDS, ...object }),
    findOne: vi.fn().mockResolvedValue({ ...RECORD }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
  };
}

/**
 * What the mounted form draws: every rendered field, mapped to whether it is
 * locked (`true` when it kept no enabled control). Read off `document.body`,
 * not the render container, because the drawer and modal portal out.
 */
function drawnFields(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of document.body.querySelectorAll('[data-field]')) {
    const name = item.getAttribute('data-field') as string;
    out[name] = item.querySelector('input:not([disabled]), textarea:not([disabled])') === null;
  }
  return out;
}

describe.each(LAYOUTS)('ObjectForm $layout (objectui#10612)', ({ schema }) => {
  it.each(CASES)('$case: draws the table field set in the table locked state', async (row) => {
    const names = [...Object.keys(FIELDS), ...(row.members ?? []).map((m) => m.name)];
    render(
      <MePermissionsProvider initialPermissions={row.principal}>
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'invoice',
            ...schema(names),
            ...(row.members ? { customFields: row.members } : {}),
            mode: row.mode,
            ...(row.mode === 'edit' ? { recordId: 'i1' } : {}),
          } as any}
          dataSource={makeDS(row.object) as any}
        />
      </MePermissionsProvider>,
    );

    // `customer` is drawn in every row; once it is on screen the form has
    // resolved its object and, in edit mode, its record.
    await waitFor(() => {
      const el = document.querySelector('input[name="customer"]') as HTMLInputElement | null;
      if (!el) throw new Error('form not drawn yet');
      if (row.mode === 'edit' && el.value !== RECORD.customer) throw new Error('record not on screen yet');
    });

    expect(drawnFields()).toEqual(row.drawn);
  });
});
