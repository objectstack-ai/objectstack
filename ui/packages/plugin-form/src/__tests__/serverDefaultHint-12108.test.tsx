/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12108 — a create form says when the server will fill a field.
 *
 * A `defaultValue` that is a CEL Expression envelope (or a runtime token such
 * as `NOW()`) is an instruction the server resolves at insert. The client
 * cannot evaluate it, so `schemaDefaults.ts` leaves the control EMPTY and the
 * submit omits the key (#4047 / #4068 / #4069). Until this card the field
 * opened empty, or on "Select an option", with nothing saying a value was
 * coming. The form renderer now draws "Set automatically when saved." under it,
 * in the field's description slot, while the field is empty.
 *
 * Pinned here, through the public `ObjectForm` entry in every layout it
 * routes to, with the real registered field widgets:
 *
 *   1. the hint on a CEL default (text, date, select, number, boolean) and
 *      on a runtime token, in every layout. A boolean is server-filled too
 *      (objectui#12121): the renderer seeds an unsupplied two-state control
 *      `false` (cloud#972) only when its default is not a runtime one, so a
 *      CEL-default boolean opens empty, with the hint, and is omitted from the
 *      create payload, while a plain boolean still seeds `false`;
 *   2. CONTROL: a literal default is seeded as today, and carries no hint;
 *      a field with no default carries none either;
 *   3. the hint follows the live value — a typed value removes it;
 *   4. it is announced: the control's `aria-describedby` names the element;
 *   5. edit and view forms never show it;
 *   6. the measured required behaviour: a REQUIRED field with a CEL default
 *      does not block Save, shows no required marker, and is omitted from the
 *      create payload, so the server fills it. The server half is
 *      `ObjectQL.insert`, which resolves defaults before it validates
 *      (objectstack `engine.ts`, the `[#4633]` note in `validateData`).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const HINT = 'Set automatically when saved.';

/** The canonical wire shape of a CEL default, as the server serves it. */
const cel = (source: string) => ({ dialect: 'cel', source });

const STAGES = [
  { label: 'Prospect', value: 'prospect' },
  { label: 'Won', value: 'won' },
];

const OBJECT_SCHEMA = {
  name: 'deal',
  fields: {
    // No default: the field the user must fill, and the no-hint control.
    title: { type: 'text', label: 'Title', required: true },
    // CEL defaults across the widget families the card names.
    code: { type: 'text', label: 'Code', defaultValue: cel("'D-' + string(1)") },
    close_date: { type: 'date', label: 'Close date', required: true, defaultValue: cel('today()') },
    stage: { type: 'select', label: 'Stage', required: true, defaultValue: cel("'prospect'"), options: STAGES },
    amount: { type: 'number', label: 'Amount', defaultValue: cel('0') },
    // A two-state control the server fills: not seeded `false` (objectui#12121).
    active: { type: 'boolean', label: 'Active', defaultValue: cel('true') },
    // A runtime token: the same classifier, so the same hint.
    reminded_at: { type: 'datetime', label: 'Reminded at', defaultValue: 'NOW()' },
    // An authored description beside a CEL default: both are drawn.
    region: {
      type: 'text',
      label: 'Region',
      description: 'Sales region.',
      defaultValue: cel("'emea'"),
    },
    // CONTROL: a literal default is seeded, exactly as before.
    status: {
      type: 'select',
      label: 'Status',
      required: true,
      defaultValue: 'open',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Closed', value: 'closed' },
      ],
    },
  },
};

/** The fields whose default the server resolves. */
const SERVER_FILLED = ['code', 'close_date', 'stage', 'amount', 'active', 'reminded_at', 'region'];
const NOT_SERVER_FILLED = ['title', 'status'];

const SECTIONS = [{ name: 'main', label: 'Main', fields: Object.keys(OBJECT_SCHEMA.fields) }];

const makeDS = (record?: Record<string, unknown>) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    create: vi.fn().mockResolvedValue({ id: 'd1' }),
    update: vi.fn().mockResolvedValue({ id: 'd1' }),
    findOne: vi.fn().mockResolvedValue(record ?? { id: 'd1' }),
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  }) as any;

/**
 * Every layout `ObjectForm` routes a create form to. The sectioned layouts get
 * the one section; the flat form builds its fields from the object schema.
 */
const LAYOUTS: Array<[string, Record<string, unknown>]> = [
  ['ObjectForm (flat)', {}],
  ['ObjectForm (sections)', { sections: SECTIONS }],
  ['ModalForm', { formType: 'modal', open: true, sections: SECTIONS }],
  ['DrawerForm', { formType: 'drawer', open: true, sections: SECTIONS }],
  ['TabbedForm', { formType: 'tabbed', sections: SECTIONS }],
  ['SplitForm', { formType: 'split', sections: SECTIONS }],
  ['WizardForm', { formType: 'wizard', sections: SECTIONS }],
];

const renderForm = (ds: any, extra: Record<string, unknown>) =>
  render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'deal', mode: 'create', ...extra } as any}
      dataSource={ds}
    />,
  );

const fieldRow = (name: string) => document.body.querySelector<HTMLElement>(`[data-field="${name}"]`);
const hintOf = (name: string) => fieldRow(name)?.querySelector('[data-server-default-hint]') ?? null;

const awaitRows = () =>
  waitFor(() => {
    for (const name of Object.keys(OBJECT_SCHEMA.fields)) {
      if (!fieldRow(name)) throw new Error(`${name} not rendered`);
    }
  });

const marksRequired = (name: string) =>
  (fieldRow(name)?.querySelectorAll('[data-required-marker]').length ?? 0) > 0;

const submit = () => {
  const form = document.body.querySelector('form') as HTMLFormElement;
  fireEvent.submit(form);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe.each(LAYOUTS)('%s — the "set on save" hint (objectui#12108)', (_name, extra) => {
  it('draws the hint under every empty field the server fills, and under no other', async () => {
    renderForm(makeDS(), extra);
    await awaitRows();

    for (const name of SERVER_FILLED) {
      expect(hintOf(name)?.textContent, name).toBe(HINT);
    }
    for (const name of NOT_SERVER_FILLED) {
      expect(hintOf(name), name).toBeNull();
    }
  });

  it('CONTROL: seeds a literal default as before, with no hint', async () => {
    renderForm(makeDS(), extra);
    await awaitRows();
    await waitFor(() =>
      expect(fieldRow('status')?.querySelector('[data-testid="select-trigger-status"]')?.textContent).toContain('Open'),
    );
    expect(hintOf('status')).toBeNull();
  });

  it('keeps the select placeholder and adds the hint below it', async () => {
    renderForm(makeDS(), extra);
    await awaitRows();
    const trigger = fieldRow('stage')?.querySelector('[data-testid="select-trigger-stage"]');
    expect(trigger?.textContent).toContain('Select an option');
    expect(hintOf('stage')?.textContent).toBe(HINT);
  });
});

describe('the hint follows the live value and reaches assistive tech (objectui#12108)', () => {
  it('goes away once the user types a value, and comes back when it is cleared', async () => {
    renderForm(makeDS(), {});
    await awaitRows();
    const input = fieldRow('code')!.querySelector('input')!;

    fireEvent.change(input, { target: { value: 'D-77' } });
    await waitFor(() => expect(hintOf('code')).toBeNull());

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(hintOf('code')?.textContent).toBe(HINT));
  });

  it('is part of the description the control names in aria-describedby', async () => {
    renderForm(makeDS(), {});
    await awaitRows();
    const input = fieldRow('code')!.querySelector('input')!;
    const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(described).toContain(HINT);
  });

  it('draws an authored description first, and the hint after it in the same element', async () => {
    renderForm(makeDS(), {});
    await awaitRows();
    const hint = hintOf('region')!;
    const description = hint.parentElement!;
    expect(description.textContent).toBe(`Sales region.${HINT}`);
    expect(hint.className).toContain('block');
    expect(fieldRow('region')!.querySelectorAll(`[id="${description.id}"]`)).toHaveLength(1);
  });
});

describe('edit and view forms never show the hint (objectui#12108)', () => {
  const STORED = { id: 'd1', title: 'Big deal', status: 'open' };

  it.each([
    ['ObjectForm (flat)', {}],
    ['ModalForm', { formType: 'modal', open: true, sections: SECTIONS }],
  ])('%s in edit mode', async (_name, extra) => {
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'deal', mode: 'edit', recordId: 'd1', ...extra } as any}
        dataSource={makeDS(STORED)}
      />,
    );
    await awaitRows();
    expect(document.body.querySelectorAll('[data-server-default-hint]')).toHaveLength(0);
  });

  it.each([
    ['ObjectForm (flat)', {}],
    ['ModalForm', { formType: 'modal', open: true, sections: SECTIONS }],
  ])('%s in view mode — the renderer reads view as create, and the disabled gate holds', async (_name, extra) => {
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'deal', mode: 'view', recordId: 'd1', ...extra } as any}
        dataSource={makeDS(STORED)}
      />,
    );
    await waitFor(() => expect(fieldRow('title')).not.toBeNull());
    expect(document.body.querySelectorAll('[data-server-default-hint]')).toHaveLength(0);
  });
});

/**
 * The measurement the card asks for: does a REQUIRED field with a CEL default
 * block Save? It does not, in any container — `isRequiredInForm` (the builders)
 * and `resolveFieldRuleState`'s `serverOwnedValue` (the renderer) lower the
 * rule on create, and the payload omits the key so `applyFieldDefaults` fills
 * it. `createDefaults.test.tsx` pins the same rule on `text` fields; this adds
 * the date and select widgets the card measured on, in every layout but the
 * wizard (its submit is the last step's button, pinned by its own suite).
 */
describe.each(LAYOUTS.filter(([name]) => name !== 'WizardForm'))(
  '%s — a required field with a CEL default does not block Save (objectui#12108)',
  (_name, extra) => {
    it('submits with close_date and stage left empty, unmarked, and omitted from the payload', async () => {
      const ds = makeDS();
      renderForm(ds, extra);
      await awaitRows();

      expect(marksRequired('close_date')).toBe(false);
      expect(marksRequired('stage')).toBe(false);
      expect(marksRequired('title')).toBe(true);

      fireEvent.change(fieldRow('title')!.querySelector('input')!, { target: { value: 'Big deal' } });
      submit();

      await waitFor(() => expect(ds.create).toHaveBeenCalled());
      const payload = ds.create.mock.calls[0][1];
      expect(payload).toMatchObject({ title: 'Big deal', status: 'open' });
      for (const name of SERVER_FILLED) expect(payload, name).not.toHaveProperty(name);
    });
  },
);
