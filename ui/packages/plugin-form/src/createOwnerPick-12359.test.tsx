/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An owner the user picks on a New form is written; an owner the form was
 * seeded with and the user left alone is not (objectui#12359).
 *
 * ## What the base commit did
 *
 * `sanitizeFormData` drops `owner_id` from every payload, and only the EDIT
 * path added a changed owner back (objectui#12205). A New form whose layout
 * renders Owner therefore offered a live lookup, showed the picked user's chip,
 * and then created the record with no `owner_id` key, so the server stamped the
 * creator and answered 201 with no error.
 *
 * ## The two failure directions, and the rows shaped around each
 *
 * - DROPPED (this card): a picked owner is not sent. The "is sent" rows assert
 *   the exact create payload.
 * - ECHOED (objectui#10108): an owner the user did not touch is sent. On a
 *   create that is a seeded owner — the acting user from a `current_user`
 *   default, or a caller's prefill. The "is not sent" rows assert the owner's
 *   absence beside another field that proves the payload is not empty.
 *
 * The client never decides whether the caller may assign another owner: the
 * server refuses an insert naming another user without the transfer grant, and
 * the refusal row pins that it reaches the form as its error.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, screen, act, cleanup } from '@testing-library/react';
import React from 'react';

import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererContext } from '@object-ui/react';
import { MePermissionsProvider } from '@object-ui/permissions';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';
import { ObjectForm } from './ObjectForm';
import { createOwnerPayload, sanitizeFormData } from './sanitize';
import { formWritePayload } from './writePayload';

registerAllFields();
afterEach(cleanup);

/** The platform-injected owner: `OWNER_FIELD_DEF` — `system`, not `readonly`, no default. */
const OWNER_DEF = { type: 'lookup', label: 'Owner', reference: 'sys_user', required: false, readonly: false, system: true };

const CASE_SCHEMA = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    owner_id: OWNER_DEF,
    organization_id: { type: 'lookup', label: 'Organization', reference: 'sys_organization', hidden: true, readonly: true, system: true },
  },
};

/** An object whose author declared the owner defaulting to the acting user. */
const DEFAULTED_SCHEMA = {
  ...CASE_SCHEMA,
  fields: { ...CASE_SCHEMA.fields, owner_id: { ...OWNER_DEF, defaultValue: 'current_user' } },
};

const USERS = [
  { id: 'u1', name: 'Ada Lovelace' },
  { id: 'u2', name: 'Grace Hopper' },
];

const USER_SCHEMA = { name: 'sys_user', nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } };

function makeDS(objectSchema: unknown = CASE_SCHEMA, create?: any) {
  return {
    getObjectSchema: vi.fn(async (objectName: string) => (objectName === 'sys_user' ? USER_SCHEMA : objectSchema)),
    findOne: vi.fn(async (objectName: string, id: string) => {
      const u = objectName === 'sys_user' ? USERS.find((x) => x.id === id) : undefined;
      return u ? { ...u } : null;
    }),
    find: vi.fn(async (objectName: string, params?: any) => {
      if (objectName !== 'sys_user') return { data: [], total: 0 };
      const wanted: unknown[] | undefined = params?.$filter?.id?.$in;
      const rows = wanted ? USERS.filter((u) => wanted.includes(u.id)) : USERS;
      return { data: rows.map((u) => ({ ...u })), total: rows.length };
    }),
    create: create ?? vi.fn(async (_o: string, d: any) => ({ id: 'n1', ...d })),
    update: vi.fn(),
  };
}

/** The acting user, so a `current_user` default seeds `u1` (#5683). */
const ME_PERMISSIONS = {
  authenticated: true,
  userId: 'u1',
  tenantId: 't1',
  roles: ['user'],
  permissionSets: [],
  objects: { '*': { allowCreate: true, allowRead: true, allowEdit: true } },
  fields: {},
};

/** Mounted the way the console mounts a New form, signed in as `u1`. */
const mount = (ui: React.ReactElement, ds: unknown) =>
  render(
    <MePermissionsProvider initialPermissions={ME_PERMISSIONS as any}>
      <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>{ui}</SchemaRendererContext.Provider>
    </MePermissionsProvider>,
  );

/** The layout a console New form declares: the owner is a rendered member. */
const SECTIONS = [{ name: 'main', label: 'Main', fields: ['subject', 'owner_id'] }];

const createSchema = (extra: Record<string, unknown> = {}) =>
  ({ type: 'object-form', objectName: 'crm_case', mode: 'create', open: true, sections: SECTIONS, ...extra }) as any;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const input = (name: string) =>
  waitFor(() => {
    const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

const change = async (el: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(el, { target: { value } });
  });
};

/** Pick through the real lookup: open its dropdown and choose a user. */
async function pickOwner(label: string) {
  await waitFor(() => expect(screen.getByTestId('lookup-trigger-owner_id')).toBeTruthy());
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger-owner_id'));
  });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(2));
  const option = screen.getAllByRole('option').find((o) => (o.getAttribute('title') ?? o.textContent ?? '').includes(label));
  if (!option) throw new Error(`no option ${label}`);
  await act(async () => {
    fireEvent.click(option);
  });
  await settle();
}

const submit = async () => {
  await act(async () => {
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
  });
  await settle();
};

describe('createOwnerPayload — the owner rides a create only when the user picked it (objectui#12359)', () => {
  const save = (
    values: Record<string, unknown>,
    seed: Record<string, unknown> | null | undefined,
    opts: { canEdit?: (f: string) => boolean; schema?: any } = {},
  ) => {
    const schema = opts.schema ?? CASE_SCHEMA;
    const payload = sanitizeFormData(values, schema, { canEdit: opts.canEdit });
    return createOwnerPayload(payload, seed, { values, objectSchema: schema, canEdit: opts.canEdit });
  };

  it('a picked owner is sent beside the other fields', () => {
    expect(save({ subject: 'Printer jam', owner_id: 'u2' }, {})).toEqual({ subject: 'Printer jam', owner_id: 'u2' });
  });

  it('a pick over a seeded owner is sent', () => {
    expect(save({ subject: 'Printer jam', owner_id: 'u2' }, { owner_id: 'u1' })).toEqual({
      subject: 'Printer jam',
      owner_id: 'u2',
    });
  });

  it('a seeded owner left alone is not sent (objectui#10108)', () => {
    expect(save({ subject: 'Printer jam', owner_id: 'u1' }, { owner_id: 'u1' })).toEqual({ subject: 'Printer jam' });
  });

  it('an owner the form does not hold (undefined) is not a pick', () => {
    expect(save({ subject: 'Printer jam', owner_id: undefined }, {})).toEqual({ subject: 'Printer jam' });
  });

  it('with no seed to judge against, the owner stays off the wire as before', () => {
    expect(save({ subject: 'Printer jam', owner_id: 'u2' }, null)).toEqual({ subject: 'Printer jam' });
    expect(save({ subject: 'Printer jam', owner_id: 'u2' }, undefined)).toEqual({ subject: 'Printer jam' });
  });

  it('the caller\'s field-level security still refuses it', () => {
    const canEdit = (f: string) => f !== 'owner_id';
    expect(save({ subject: 'Printer jam', owner_id: 'u2' }, {}, { canEdit })).toEqual({ subject: 'Printer jam' });
  });

  it('an object that declares its owner readonly still refuses it', () => {
    const schema = { ...CASE_SCHEMA, fields: { ...CASE_SCHEMA.fields, owner_id: { ...OWNER_DEF, readonly: true } } };
    expect(save({ subject: 'Printer jam', owner_id: 'u2' }, {}, { schema })).toEqual({ subject: 'Printer jam' });
  });

  it('the rest of the transfer-grant family stays refused even when it differs from the seed', () => {
    expect(save({ subject: 'Printer jam', organization_id: 'org2', tenant_id: 't2' }, {})).toEqual({ subject: 'Printer jam' });
  });
});

describe('formWritePayload — a create with its opening values (objectui#12359)', () => {
  const form = { mode: 'create', objectName: 'crm_case' };

  it('writes a picked owner on both payloads, since a create writes `payload`', () => {
    const { payload, writePayload } = formWritePayload({ subject: 'Printer jam', owner_id: 'u2' }, form, {
      objectSchema: CASE_SCHEMA,
      canEdit: undefined,
      snapshot: null,
      createBaseline: {},
    });
    expect(payload).toEqual({ subject: 'Printer jam', owner_id: 'u2' });
    expect(writePayload).toEqual(payload);
  });

  it('does not write a seeded owner left alone', () => {
    const { writePayload } = formWritePayload({ subject: 'Printer jam', owner_id: 'u1' }, form, {
      objectSchema: DEFAULTED_SCHEMA,
      canEdit: undefined,
      snapshot: null,
      createBaseline: { owner_id: 'u1' },
    });
    expect(writePayload).toEqual({ subject: 'Printer jam' });
  });

  it('an owner emptied over a runtime default is left to the producer (#4069)', () => {
    const { writePayload } = formWritePayload({ subject: 'Printer jam', owner_id: null }, form, {
      objectSchema: DEFAULTED_SCHEMA,
      canEdit: undefined,
      snapshot: null,
      createBaseline: { owner_id: 'u1' },
    });
    expect(writePayload).toEqual({ subject: 'Printer jam' });
  });

  it('with a null create baseline, the owner stays off the wire as before', () => {
    const { writePayload } = formWritePayload({ subject: 'Printer jam', owner_id: 'u2' }, form, {
      objectSchema: CASE_SCHEMA,
      canEdit: undefined,
      snapshot: null,
      createBaseline: null,
    });
    expect(writePayload).toEqual({ subject: 'Printer jam' });
  });
});

describe.each([
  ['ModalForm (the console\'s New dialog)', ModalForm, 'modal'],
  ['DrawerForm', DrawerForm, 'drawer'],
])('%s — create', (_label, Form: any, formType: string) => {
  it('a picked owner is sent', async () => {
    const ds = makeDS();
    mount(<Form schema={createSchema({ formType })} dataSource={ds as any} />, ds);

    await change(await input('subject'), 'Printer jam');
    await pickOwner('Grace Hopper');
    await submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create).toHaveBeenCalledWith('crm_case', { subject: 'Printer jam', owner_id: 'u2' });
  });

  it('an Owner left empty is not sent', async () => {
    const ds = makeDS();
    mount(<Form schema={createSchema({ formType })} dataSource={ds as any} />, ds);

    await change(await input('subject'), 'Printer jam');
    await submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toEqual({ subject: 'Printer jam' });
  });

  it('the creator seeded by a current_user default is not a pick, and is not sent', async () => {
    const ds = makeDS(DEFAULTED_SCHEMA);
    mount(<Form schema={createSchema({ formType })} dataSource={ds as any} />, ds);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Ada Lovelace' })).toBeTruthy());

    await change(await input('subject'), 'Printer jam');
    await submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toEqual({ subject: 'Printer jam' });
  });

  it('a pick over the seeded creator is sent', async () => {
    const ds = makeDS(DEFAULTED_SCHEMA);
    mount(<Form schema={createSchema({ formType })} dataSource={ds as any} />, ds);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Ada Lovelace' })).toBeTruthy());

    await change(await input('subject'), 'Printer jam');
    await pickOwner('Grace Hopper');
    await submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toEqual({ subject: 'Printer jam', owner_id: 'u2' });
  });
});

/**
 * The layouts `ObjectForm` routes a create through `formWritePayload`, each of
 * which must hand over the values it OPENED with (`createBaseline`).
 */
const OBJECT_FORM_ROUTES: Array<{ route: string; layout: Record<string, unknown> }> = [
  { route: 'simple (ObjectForm, finalDefaultValues)', layout: { sections: SECTIONS } },
  { route: 'tabbed (TabbedForm, formData)', layout: { formType: 'tabbed', sections: SECTIONS } },
  { route: 'split (SplitForm, formData)', layout: { formType: 'split', sections: SECTIONS } },
  { route: 'wizard (WizardForm, its seed ref)', layout: { formType: 'wizard', sections: SECTIONS } },
];

describe.each(OBJECT_FORM_ROUTES)('ObjectForm $route — create (objectui#12359)', ({ layout }) => {
  const schema = () => ({ type: 'object-form', objectName: 'crm_case', mode: 'create', ...layout }) as any;

  it('a picked owner is sent', async () => {
    const ds = makeDS();
    mount(<ObjectForm schema={schema()} dataSource={ds as any} />, ds);

    await change(await input('subject'), 'Printer jam');
    await pickOwner('Grace Hopper');
    await submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toEqual({ subject: 'Printer jam', owner_id: 'u2' });
  });

  it('the creator seeded by a current_user default is not a pick, and is not sent', async () => {
    const ds = makeDS(DEFAULTED_SCHEMA);
    mount(<ObjectForm schema={schema()} dataSource={ds as any} />, ds);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Ada Lovelace' })).toBeTruthy());

    await change(await input('subject'), 'Printer jam');
    await submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toEqual({ subject: 'Printer jam' });
  });

  it('a pick over the seeded creator is sent', async () => {
    const ds = makeDS(DEFAULTED_SCHEMA);
    mount(<ObjectForm schema={schema()} dataSource={ds as any} />, ds);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Ada Lovelace' })).toBeTruthy());

    await change(await input('subject'), 'Printer jam');
    await pickOwner('Grace Hopper');
    await submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toEqual({ subject: 'Printer jam', owner_id: 'u2' });
  });
});

describe('ModalForm — the server judges a picked owner (objectui#12359)', () => {
  it('a refused pick surfaces as the form\'s error, and the dialog stays open', async () => {
    const refusal = Object.assign(new Error("'owner_id' is system-managed"), { httpStatus: 403, code: 'FORBIDDEN' });
    const create = vi.fn().mockRejectedValue(refusal);
    const ds = makeDS(CASE_SCHEMA, create);
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    mount(<ModalForm schema={createSchema({ formType: 'modal', onSuccess, onOpenChange })} dataSource={ds as any} />, ds);

    await change(await input('subject'), 'Printer jam');
    await pickOwner('Grace Hopper');
    await submit();

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][1]).toEqual({ subject: 'Printer jam', owner_id: 'u2' });
    expect(await screen.findAllByText("You don't have permission to save this record.")).not.toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
