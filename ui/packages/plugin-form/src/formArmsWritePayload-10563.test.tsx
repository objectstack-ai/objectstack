/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every layout `ObjectForm` routes a record save through writes the SAME
 * payload (objectui#10563).
 *
 * ## The defect
 *
 * The simple form, `ModalForm` and `DrawerForm` build what a save writes in one
 * sequence: strip what the form never writes (`sanitizeFormData` — server-owned,
 * computed, read-only, unknown to the object, and refused by field-level
 * security through `fieldWriteGate`), then, on an edit, keep only the fields
 * that differ from the record the form read (`dirtyEditPayload`,
 * objectui#10156). `TabbedForm`, `SplitForm` and `WizardForm` did neither. An
 * edit on any of them wrote every value the form held — `id`, `owner_id`,
 * `created_by`, `updated_at`, the formula column and the field the caller may
 * read but not edit — which the server answers with a 403 (objectui#10108) or
 * an unknown-field refusal. A simple form whose mobile `stepper` option shows it
 * one field at a time is rendered by `WizardForm`, so it took the same route.
 *
 * ## The rows, and what makes each one able to fail
 *
 * One row per route and per write, with the simple form as the lit control on
 * the same record, the same principal and the same edit:
 *
 * - "edit" asserts the EXACT payload after changing one field. A route that
 *   writes its raw values sends the whole record, so it goes red.
 * - "nothing changed" asserts the exact payload of a save with no edit. The
 *   dirty diff sends the full sanitized payload then, so this is the row where
 *   only the strip stands between the server and the refused columns; it goes
 *   red on a route that diffs but does not sanitize. The two business columns
 *   that ARE on the wire are its control: the fix is "send the right fields",
 *   not "send fewer".
 * - "host seam" asserts what a host `submitHandler` receives on an edit — the
 *   same payload the form would have written itself.
 * - "create" asserts that a create seeded with a whole record (a copy of an
 *   existing one) posts its business columns and none of the refused ones. The
 *   simple form has always stripped a create; the three layouts did not.
 * - "inline member" asserts the other side of the strip: with `customFields`
 *   the object definition is not used for it, so a member the object does not
 *   declare is still written, while the roster and the field-level verdict,
 *   which need no definition, still apply.
 * - "render" asserts the other half of the field-level invariant: the field
 *   the caller may not edit is not OFFERED as a live input. The three layouts
 *   rendered it enabled when a section named it by string, and with the strip
 *   above in place a value typed there would be dropped behind a 200.
 *
 * The last block is the master-detail header laid out `tabbed`, which reaches
 * `TabbedForm` through the parent form's host seam.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, act, cleanup, screen } from '@testing-library/react';
import React from 'react';

import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();
afterEach(cleanup);

const VERSION = '2026-09-25 00:00:00.000';

/**
 * The card's object. `total` is a formula column, `owner_id` / `created_by` /
 * `updated_at` are the columns the platform stamps, and `score` is an ordinary
 * business column that only the CALLER's permission set refuses.
 */
const DEAL_SCHEMA = {
  name: 'deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    total: { type: 'formula', label: 'Total', expression: 'record.qty * record.price' },
    score: { type: 'number', label: 'Score' },
    owner_id: { type: 'lookup', label: 'Owner', system: true },
    created_by: { type: 'lookup', label: 'Created by', system: true },
    updated_at: { type: 'datetime', label: 'Updated', system: true },
  },
};

/** The record exactly as `dataSource.findOne` returns it. */
const STORED = {
  id: 'd1',
  name: 'Mine',
  stage: 'open',
  total: 42,
  score: 7,
  owner_id: 'u9',
  created_by: 'u9',
  updated_at: VERSION,
};

/** Everything on {@link STORED} a form may never write for this caller. */
const REFUSED = ['id', 'total', 'score', 'owner_id', 'created_by', 'updated_at'] as const;

/** The caller may read `score` but not edit it. */
const PRINCIPAL: any = {
  authenticated: true,
  userId: 'u-editor',
  tenantId: null,
  roles: ['deal_editor'],
  permissionSets: ['deal_editor'],
  objects: { deal: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false } },
  fields: { 'deal.score': { readable: true, editable: false } },
};

/** `extra` is an inline member only: the object does not declare it. */
const members = (extra: string[]) => ['name', ...extra, 'stage', 'total', 'score'];
const sections = (extra: string[]) => [
  { name: 'main', label: 'Main', fields: ['name', ...extra, 'stage'] },
  { name: 'more', label: 'More', fields: ['total', 'score'] },
];

/**
 * The routes a record save can take out of `ObjectForm`. `steps` is how many
 * times the step form is submitted before the last one writes: the wizard
 * collects a step per submit, and the stepper here is one step of every field.
 */
const ROUTES: Array<{ route: string; layout: (extra?: string[]) => Record<string, unknown>; steps: number }> = [
  { route: 'simple (control)', layout: (extra = []) => ({ fields: members(extra) }), steps: 1 },
  { route: 'tabbed (TabbedForm)', layout: (extra = []) => ({ formType: 'tabbed', sections: sections(extra) }), steps: 1 },
  { route: 'split (SplitForm)', layout: (extra = []) => ({ formType: 'split', sections: sections(extra) }), steps: 1 },
  { route: 'wizard (WizardForm)', layout: (extra = []) => ({ formType: 'wizard', sections: sections(extra) }), steps: 2 },
  {
    route: 'simple + mobile.stepper (WizardForm)',
    layout: (extra = []) => ({ fields: members(extra), mobile: { stepper: true, stepperFieldsPerStep: 99 } }),
    steps: 1,
  },
];

function makeDS() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(DEAL_SCHEMA),
    findOne: vi.fn().mockResolvedValue({ ...STORED }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (_o: string, d: any) => ({ id: 'new1', ...d })),
    update: vi.fn(async (_o: string, _id: string, d: any) => ({ ...STORED, ...d })),
  };
}

function mount(schema: Record<string, unknown>, ds: ReturnType<typeof makeDS>) {
  return render(
    <MePermissionsProvider initialPermissions={PRINCIPAL}>
      <ObjectForm schema={{ type: 'object-form', objectName: 'deal', ...schema } as any} dataSource={ds as any} />
    </MePermissionsProvider>,
  ).container;
}

/** The `field` input, once it shows `value` — i.e. once the record is on screen. */
const inputShowing = (root: HTMLElement, field: string, value: string) =>
  waitFor(() => {
    const el = root.querySelector(`input[name="${field}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${field} not rendered`);
    if (el.value !== value) throw new Error('record not on screen yet');
    return el;
  });
const nameInput = (root: HTMLElement, value: string) => inputShowing(root, 'name', value);

const change = async (el: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(el, { target: { value } });
  });
};

async function submitSteps(root: HTMLElement, steps: number) {
  for (let i = 0; i < steps; i++) {
    await act(async () => {
      fireEvent.submit(root.querySelector('form') as HTMLFormElement);
    });
  }
}

describe.each(ROUTES)('ObjectForm $route', ({ layout, steps }) => {
  const editSchema = { ...layout(), mode: 'edit', recordId: 'd1' };

  it('edit: changing one field writes that field alone, with the OCC token it read', async () => {
    const ds = makeDS();
    const root = mount(editSchema, ds);

    const input = await nameInput(root, 'Mine');
    await change(input, 'Mine v2');
    await submitSteps(root, steps);

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('deal', 'd1', { name: 'Mine v2' }, { ifMatch: VERSION });
  });

  it('nothing changed: the full payload carries the business columns and none of the refused ones', async () => {
    const ds = makeDS();
    const root = mount(editSchema, ds);

    await nameInput(root, 'Mine');
    await submitSteps(root, steps);

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    const payload = ds.update.mock.calls[0][2];
    for (const key of REFUSED) expect(payload).not.toHaveProperty(key);
    expect(payload).toEqual({ name: 'Mine', stage: 'open' });
  });

  it('host seam: an edit hands the submitHandler what the form would have written', async () => {
    const ds = makeDS();
    const submitHandler = vi.fn(async (values: any) => ({ ...STORED, ...values }));
    const root = mount({ ...editSchema, submitHandler }, ds);

    const input = await nameInput(root, 'Mine');
    await change(input, 'Mine v2');
    await submitSteps(root, steps);

    await waitFor(() => expect(submitHandler).toHaveBeenCalledTimes(1));
    expect(submitHandler).toHaveBeenCalledWith({ name: 'Mine v2' });
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('create: a create seeded with a whole record posts its business columns and none of the refused ones', async () => {
    const ds = makeDS();
    const root = mount({ ...layout(), mode: 'create', initialValues: { ...STORED } }, ds);

    const input = await nameInput(root, 'Mine');
    await change(input, 'Copy of Mine');
    await submitSteps(root, steps);

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    const payload = ds.create.mock.calls[0][1];
    for (const key of REFUSED) expect(payload).not.toHaveProperty(key);
    expect(payload).toEqual({ name: 'Copy of Mine', stage: 'open' });
  });

  it('render: the field the caller may read but not edit is not offered as a live input', async () => {
    const ds = makeDS();
    const root = mount(editSchema, ds);

    await nameInput(root, 'Mine');
    // Control: the field the caller may edit is live.
    expect((root.querySelector('input[name="stage"]') as HTMLInputElement).disabled).toBe(false);
    // `score` is on the wizard's last step; every other route shows it at once.
    await submitSteps(root, steps - 1);
    const score = await inputShowing(root, 'score', String(STORED.score));
    expect(score.disabled).toBe(true);
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('inline member: a member the object does not declare is written; the roster and the field-level verdict still apply', async () => {
    const ds = makeDS();
    const root = mount(
      {
        ...layout(['extra']),
        customFields: [{ name: 'extra', label: 'Extra', type: 'text' }],
        mode: 'create',
        initialValues: { ...STORED },
      },
      ds,
    );

    await nameInput(root, 'Mine');
    await change(await inputShowing(root, 'extra', ''), 'kept');
    await submitSteps(root, steps);

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    const payload = ds.create.mock.calls[0][1];
    expect(payload).toMatchObject({ name: 'Mine', stage: 'open', extra: 'kept' });
    for (const key of ['id', 'score', 'owner_id', 'created_by', 'updated_at']) {
      expect(payload).not.toHaveProperty(key);
    }
  });
});

describe('MasterDetailForm with a header laid out tabbed — the parent operation', () => {
  const PO_SCHEMA = {
    name: 'po',
    fields: {
      ref: { type: 'text', label: 'Ref' },
      status: { type: 'text', label: 'Status' },
      owner_id: { type: 'lookup', label: 'Owner', system: true },
      updated_at: { type: 'datetime', label: 'Updated', system: true },
    },
  };
  const PO = { id: 'po1', ref: 'PO-1', status: 'draft', owner_id: 'u9', updated_at: VERSION };

  it('changing one header field sends only that field in the parent operation', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
    const ds: any = {
      getObjectSchema: vi.fn().mockResolvedValue(PO_SCHEMA),
      findOne: vi.fn().mockResolvedValue({ ...PO }),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      batchTransaction,
    };
    const { container } = render(
      <MasterDetailForm
        schema={{
          objectName: 'po',
          mode: 'edit',
          recordId: 'po1',
          formType: 'tabbed',
          sections: [{ name: 'main', label: 'Main', fields: ['ref', 'status'] }],
          details: [
            { childObject: 'po_line', relationshipField: 'po', columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any] },
          ],
        } as any}
        dataSource={ds}
      />,
    );

    await change(await inputShowing(container, 'ref', 'PO-1'), 'PO-2');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    const ops = batchTransaction.mock.calls[0][0];
    expect(ops[0]).toEqual({ object: 'po', action: 'update', id: 'po1', data: { ref: 'PO-2' } });
  });
});
