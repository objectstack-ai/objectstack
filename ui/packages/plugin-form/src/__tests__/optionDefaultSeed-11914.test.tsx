/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11914 — a CREATE form preselects the option a field's option list
 * marks `default: true`.
 *
 * Measured before the fix through the console's create dialog (the global
 * `ModalForm`) on the objectstack tutorial's verbatim ticket object: Priority
 * and Status, both required `select`s that mark one option `default: true` and
 * declare no field-level `defaultValue`, opened on the "Select an option"
 * placeholder. The form could not be submitted until the user picked the very
 * values the metadata had already chosen — while the server, given the same
 * create without those keys, stores the marked options.
 *
 * The server's rule is `ObjectQL.applyFieldDefaults` falling back to its
 * `resolveOptionDefault` (objectstack#7246) when the field declares no
 * `defaultValue`. The pins below are that rule, read from the client side:
 *
 *   - one marked option is preselected, and submitted without a manual pick;
 *   - CONTROL: a field whose options mark nothing stays empty;
 *   - a field-level `defaultValue` wins over the option flag — including a
 *     runtime one, which the server resolves at insert and the form leaves
 *     empty, so the flag is never seeded in its place;
 *   - a single-valued field takes the FIRST marked option; a multi-valued one
 *     takes every marked option, as an array;
 *   - an explicit choice wins: the caller's seed, and the user's own pick;
 *   - an EDIT form never applies it — the stored record is what it shows.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, ObjectFormSchema } from '@object-ui/types';
import { schemaDefaultValues, seedCreateValues } from '../schemaDefaults';
import { ModalForm, type ModalFormSchema } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

/**
 * The objectstack tutorial's ticket object (`build-with-claude-code.mdx`,
 * step 3), as the server serves it: `Field.select` returns its config
 * unchanged, so neither field carries a `defaultValue`.
 */
const TICKET = {
  name: 'support_desk_ticket',
  fields: {
    subject: { type: 'text', label: 'Subject', required: true },
    priority: {
      type: 'select',
      label: 'Priority',
      required: true,
      options: [
        { label: 'Low', value: 'low', default: true },
        { label: 'Normal', value: 'normal' },
        { label: 'High', value: 'high' },
        { label: 'Urgent', value: 'urgent' },
      ],
    },
    status: {
      type: 'select',
      label: 'Status',
      required: true,
      options: [
        { label: 'Open', value: 'open', color: '#3B82F6', default: true },
        { label: 'Pending', value: 'pending', color: '#F59E0B' },
        { label: 'Resolved', value: 'resolved', color: '#10B981' },
        { label: 'Closed', value: 'closed', color: '#6B7280' },
      ],
    },
    // CONTROL: options that mark nothing.
    channel: {
      type: 'select',
      label: 'Channel',
      options: [
        { label: 'Email', value: 'email' },
        { label: 'Phone', value: 'phone' },
      ],
    },
  },
};

/** A partial data-source double: the four methods these forms call. */
const makeDS = (objectSchema: unknown = TICKET, record?: unknown) => {
  const mocks = {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn().mockResolvedValue({ id: 't1' }),
    findOne: vi.fn().mockResolvedValue(record ?? { id: 't1' }),
  };
  return { ...mocks, dataSource: mocks as unknown as DataSource };
};
type MockDS = ReturnType<typeof makeDS>;

const triggerText = (field: string) =>
  document.body.querySelector(`[data-testid="select-trigger-${field}"]`)?.textContent ?? '';

/** Radix renders a hidden native `<select>` inside a form; a pick through it
 *  drives the same `onValueChange` a pointer pick does. */
const nativeSelect = (field: string) =>
  document.body.querySelector(`select[name="${field}"]`) as HTMLSelectElement | null;

const submit = () => {
  fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('schemaDefaultValues — an option marked `default: true` (objectui#11914)', () => {
  const opts = (...marked: boolean[]) =>
    marked.map((m, i) => ({ label: `O${i}`, value: `o${i}`, ...(m ? { default: true } : {}) }));

  it('seeds the marked option of a field that declares no `defaultValue`', () => {
    expect(schemaDefaultValues(TICKET)).toEqual({ priority: 'low', status: 'open' });
  });

  it('CONTROL: seeds nothing when no option is marked', () => {
    const seeded = schemaDefaultValues({
      fields: { channel: { type: 'select', options: opts(false, false) } },
    });
    expect(seeded).toEqual({});
    expect('channel' in seeded).toBe(false);
  });

  it('lets a static field-level `defaultValue` win over the option flag', () => {
    expect(
      schemaDefaultValues({
        fields: { s: { type: 'select', defaultValue: 'o1', options: opts(true, false) } },
      }),
    ).toEqual({ s: 'o1' });
  });

  it('never seeds the option in place of a RUNTIME `defaultValue` — the server resolves that one', () => {
    const seeded = schemaDefaultValues({
      fields: {
        a: { type: 'select', defaultValue: 'NOW()', options: opts(true) },
        b: { type: 'select', defaultValue: { dialect: 'cel', source: "'o0'" }, options: opts(true) },
      },
    });
    expect(seeded).toEqual({});
  });

  it('falls back to the option when `defaultValue` is null — the engine\'s own presence test', () => {
    expect(
      schemaDefaultValues({
        fields: { s: { type: 'select', defaultValue: null, options: opts(false, true) } },
      }),
    ).toEqual({ s: 'o1' });
  });

  it('takes the FIRST marked option on a single-valued field', () => {
    expect(
      schemaDefaultValues({ fields: { s: { type: 'select', options: opts(false, true, true) } } }),
    ).toEqual({ s: 'o1' });
  });

  it('takes EVERY marked option, as an array, on a multi-valued field', () => {
    expect(
      schemaDefaultValues({
        fields: {
          tags: { type: 'multiselect', options: opts(true, false, true) },
          // `select` + `multiple` is multi-valued by the same spec predicate.
          picks: { type: 'select', multiple: true, options: opts(false, true, true) },
          // One marked option on a multi-valued field is still an array.
          one: { type: 'multiselect', options: opts(false, true) },
        },
      }),
    ).toEqual({ tags: ['o0', 'o2'], picks: ['o1', 'o2'], one: ['o1'] });
  });

  it('keeps the default a scalar when `multiple` sits on a type outside the multi-valued sets', () => {
    // `isMultiValueField` calls `text` single-valued whatever the flag says,
    // and the engine stores a scalar for it — so the form seeds one too.
    expect(
      schemaDefaultValues({
        fields: { t: { type: 'text', multiple: true, options: opts(true, true) } },
      }),
    ).toEqual({ t: 'o0' });
  });

  it('seeds an option spelled `current_user` as that literal value, never the acting user', () => {
    // An option value is a picklist literal, not a runtime token: the engine
    // stores the twelve characters, so the form previews the same.
    expect(
      schemaDefaultValues(
        {
          fields: {
            s: { type: 'select', options: [{ label: 'Me', value: 'current_user', default: true }] },
          },
        },
        { currentUserId: 'u42' },
      ),
    ).toEqual({ s: 'current_user' });
  });

  it('skips a marked option that carries no value', () => {
    expect(
      schemaDefaultValues({
        fields: { s: { type: 'select', options: [{ label: 'X', value: null, default: true }] } },
      }),
    ).toEqual({});
  });

  it('lets the caller\'s seed outrank the option flag', () => {
    expect(seedCreateValues(TICKET, { status: 'pending' })).toEqual({
      priority: 'low',
      status: 'pending',
    });
  });
});

const renderModalCreate = (ds: MockDS, extra: Partial<ModalFormSchema> = {}) =>
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'support_desk_ticket',
        mode: 'create',
        open: true,
        sections: [
          { name: 'basics', label: 'Basics', fields: ['subject', 'priority', 'status', 'channel'] },
        ],
        ...extra,
      }}
      dataSource={ds.dataSource}
    />,
  );

describe('ModalForm (the console create dialog) — option defaults (objectui#11914)', () => {
  it('opens the tutorial ticket with Priority and Status preselected, and submits them unpicked', async () => {
    const ds = makeDS();
    renderModalCreate(ds);

    await waitFor(() => expect(triggerText('priority')).toContain('Low'));
    expect(triggerText('status')).toContain('Open');

    const subject = document.body.querySelector<HTMLInputElement>('[data-field="subject"] input');
    fireEvent.change(subject as HTMLInputElement, { target: { value: 'Printer on fire' } });
    submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ priority: 'low', status: 'open' });
  });

  it('CONTROL: leaves a select whose options mark nothing on its placeholder', async () => {
    renderModalCreate(makeDS());

    await waitFor(() => expect(triggerText('priority')).toContain('Low'));
    expect(triggerText('channel')).not.toContain('Email');
    expect(triggerText('channel')).not.toContain('Phone');
  });

  it('lets the user\'s own pick win over the preselected option', async () => {
    const ds = makeDS();
    renderModalCreate(ds, { initialData: { subject: 'Printer on fire' } });

    await waitFor(() => expect(triggerText('status')).toContain('Open'));
    await waitFor(() => expect(nativeSelect('status')).not.toBeNull());
    fireEvent.change(nativeSelect('status') as HTMLSelectElement, { target: { value: 'pending' } });
    await waitFor(() => expect(triggerText('status')).toContain('Pending'));

    submit();
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ priority: 'low', status: 'pending' });
  });

  it('lets a caller-supplied seed win over the preselected option', async () => {
    renderModalCreate(makeDS(), { initialData: { status: 'resolved' } });

    await waitFor(() => expect(triggerText('status')).toContain('Resolved'));
    expect(triggerText('priority')).toContain('Low');
  });

  it('preselects every marked option of a multi-valued field', async () => {
    const ds = makeDS({
      name: 'support_desk_ticket',
      fields: {
        tags: {
          type: 'multiselect',
          label: 'Tags',
          options: [
            { label: 'Billing', value: 'billing', default: true },
            { label: 'Bug', value: 'bug' },
            { label: 'Urgent', value: 'urgent', default: true },
          ],
        },
      },
    });
    renderModalCreate(ds, {
      sections: [{ name: 'basics', label: 'Basics', fields: ['tags'] }],
    });

    const pressed = (value: string) =>
      document.body
        .querySelector(`[data-testid="multiselect-option-${value}"]`)
        ?.getAttribute('aria-pressed');
    await waitFor(() => expect(pressed('billing')).toBe('true'));
    expect(pressed('urgent')).toBe('true');
    expect(pressed('bug')).toBe('false');
  });

  it('does not apply the option flag to an EDIT form over the stored record', async () => {
    // The stored row leaves `status` ABSENT — the case a leaking default
    // would show up on (an explicit null would overwrite it either way).
    const ds = makeDS(TICKET, { id: 't1', subject: 'Printer on fire' });
    renderModalCreate(ds, { mode: 'edit', recordId: 't1' });

    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await waitFor(() => {
      const el = document.body.querySelector<HTMLInputElement>('[data-field="subject"] input');
      if (el?.value !== 'Printer on fire') throw new Error('record not loaded yet');
    });
    expect(triggerText('status')).not.toContain('Open');
    expect(triggerText('priority')).not.toContain('Low');
  });
});

describe('ObjectForm (the page-mode create form) — option defaults (objectui#11914)', () => {
  it('opens the tutorial ticket with Priority and Status preselected', async () => {
    const schema: ObjectFormSchema = { type: 'object-form', objectName: 'support_desk_ticket', mode: 'create' };
    render(<ObjectForm schema={schema} dataSource={makeDS().dataSource} />);

    await waitFor(() => expect(triggerText('priority')).toContain('Low'));
    expect(triggerText('status')).toContain('Open');
    expect(triggerText('channel')).not.toContain('Email');
  });

  it('does not apply the option flag to an EDIT form over the stored record', async () => {
    const ds = makeDS(TICKET, { id: 't1', subject: 'Printer on fire' });
    const schema: ObjectFormSchema = {
      type: 'object-form',
      objectName: 'support_desk_ticket',
      mode: 'edit',
      recordId: 't1',
    };
    render(<ObjectForm schema={schema} dataSource={ds.dataSource} />);

    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await waitFor(() => {
      const el = document.body.querySelector<HTMLInputElement>('[data-field="subject"] input');
      if (el?.value !== 'Printer on fire') throw new Error('record not loaded yet');
    });
    expect(triggerText('status')).not.toContain('Open');
  });
});
