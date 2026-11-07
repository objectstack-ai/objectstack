/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The sharing-rule new form's object picker (objectstack#31217, the console
 * half of objectstack#30209 row 5): `sys_sharing_rule.object_name` declares
 * `widget: 'shareable-object-ref'`, and `ObjectForm` draws it as a picker over
 * `GET /api/v1/sharing/shareable-objects` — only the objects a rule save
 * admits, in the door's order (business objects, then platform objects).
 *
 * The door is reached through the host's authenticated fetch on
 * `SchemaRendererContext`, stubbed with the door's own envelope; the form is
 * mounted inside the provider, as the console mounts it. When the door refuses
 * (403) or sharing rules do not run (501), the field is the `object-ref`
 * picker over every registered object, never an empty picker.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup, screen, within } from '@testing-library/react';
import React from 'react';
import { SchemaRendererProvider } from '@object-ui/react';

import { ObjectForm } from '../ObjectForm';

const SHAREABLE_OBJECTS_URL = '/api/v1/sharing/shareable-objects';

/** The field as `plugin-sharing` declares it on `sys_sharing_rule`. */
const SHARING_RULE = {
  name: 'sys_sharing_rule',
  fields: {
    object_name: {
      type: 'text',
      label: 'Object',
      required: true,
      maxLength: 100,
      widget: 'shareable-object-ref',
    },
  },
};

/** The door's answer: business objects first, then platform objects, each by label. */
const DOOR_ANSWER = {
  success: true,
  data: {
    objects: [
      { name: 'crm_account', label: 'Account', system: false },
      { name: 'crm_opportunity', label: 'Opportunity', system: false },
      { name: 'sys_team', label: 'Team', system: true },
    ],
  },
};

/** Every registered object — what `object-ref` offers, sessions and keys included. */
const ALL_OBJECTS = [
  { name: 'crm_account', label: 'Account' },
  { name: 'crm_opportunity', label: 'Opportunity' },
  { name: 'crm_audit_note', label: 'Audit Note' },
  { name: 'sys_session', label: 'Session' },
  { name: 'sys_api_key', label: 'API Key' },
  { name: 'sys_team', label: 'Team' },
];

const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mount(answer: () => Promise<Response>, initialData?: Record<string, unknown>) {
  const apiFetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => answer());
  const ds = {
    getObjectSchema: vi.fn().mockResolvedValue(SHARING_RULE),
    getObjects: vi.fn(async () => ALL_OBJECTS),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'r1', ...d })),
    update: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(async () => ({ data: [] })),
  };
  const view = render(
    <SchemaRendererProvider dataSource={ds as any} apiFetch={apiFetch}>
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'sys_sharing_rule', mode: 'create', initialData } as any}
        dataSource={ds as any}
      />
    </SchemaRendererProvider>,
  );
  return { ds, apiFetch, ...view };
}

/** Open the picker and read its options, in the order drawn. */
async function openOptions(): Promise<string[]> {
  const trigger = await screen.findByRole('combobox');
  fireEvent.click(trigger);
  const listbox = await screen.findByRole('listbox');
  return within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
}

afterEach(() => cleanup());

describe('the sharing-rule object picker lists only shareable objects (objectstack#31217)', () => {
  it('lists the door\'s objects in its order, business objects first, and nothing else', async () => {
    const { apiFetch, ds } = mount(json(200, DOOR_ANSWER));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(String(apiFetch.mock.calls[0][0])).toBe(SHAREABLE_OBJECTS_URL);
    await waitFor(async () =>
      expect(await openOptions()).toEqual(['Account (crm_account)', 'Opportunity (crm_opportunity)', 'Team (sys_team)']),
    );
    // No credential or session object, and no object the save would refuse.
    const drawn = (await openOptions()).join(' | ');
    expect(drawn).not.toContain('sys_session');
    expect(drawn).not.toContain('sys_api_key');
    expect(drawn).not.toContain('crm_audit_note');
    // The registry list is never read when the door answers.
    expect(ds.getObjects).not.toHaveBeenCalled();
  });

  it('CONTROL: a shareable object stays selectable and the form saves its name', async () => {
    const { ds, container } = mount(json(200, DOOR_ANSWER));

    await waitFor(async () => expect(await openOptions()).toContain('Opportunity (crm_opportunity)'));
    fireEvent.click(screen.getByRole('option', { name: 'Opportunity (crm_opportunity)' }));
    const trigger = screen.getByRole('combobox');
    await waitFor(() => expect(trigger).toHaveTextContent('Opportunity (crm_opportunity)'));

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][0]).toBe('sys_sharing_rule');
    expect(ds.create.mock.calls[0][1]).toMatchObject({ object_name: 'crm_opportunity' });
  });

  it('keeps a stored object the door does not list, so editing never drops it', async () => {
    mount(json(200, DOOR_ANSWER), { object_name: 'crm_audit_note' });

    await waitFor(async () =>
      expect(await openOptions()).toEqual([
        'crm_audit_note',
        'Account (crm_account)',
        'Opportunity (crm_opportunity)',
        'Team (sys_team)',
      ]),
    );
  });

  it.each([
    [403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'Not a sharing-rule administrator.' } }],
    [501, { success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Sharing rules are not running.' } }],
  ])('a %i from the door falls back to the object-ref list, never an empty picker', async (status, body) => {
    const { ds, container } = mount(json(status, body));

    await waitFor(() => expect(ds.getObjects).toHaveBeenCalled());
    await waitFor(async () => expect(await openOptions()).toHaveLength(ALL_OBJECTS.length));
    // `object-ref`'s own list: every registered object, sorted by label.
    expect(await openOptions()).toContain('Account (crm_account)');

    fireEvent.click(screen.getByRole('option', { name: 'Account (crm_account)' }));
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ object_name: 'crm_account' });
  });
});
