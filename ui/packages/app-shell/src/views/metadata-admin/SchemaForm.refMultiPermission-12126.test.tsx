// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12126 — a spec-form field that declares
 * `widget: 'ref-multi:permission'` renders a multi-picker of the declared
 * permission sets, and stores a LIST of their names.
 *
 * ## The defect this lands ahead of
 *
 * objectstack#22794 moves the position form's `permissionSets` row from
 * `type: 'tags'` to `widget: 'ref-multi:permission'` (ADR-0131 D4: a reference
 * to a declared item is by machine name, resolved registry-first). `WIDGETS`
 * had no entry for that key, so `resolveFieldFace` sent it down the announced
 * raw-JSON face: a JSON `<textarea>` under "widget ref-multi:permission —
 * falling back to JSON…". Landing the spec first would have turned the tag box
 * into a JSON box.
 *
 * ## What this file pins
 *
 *  - with the catalog on the host's `WidgetContext`, the add picker offers the
 *    declared sets not yet picked, and a pick appends that set's NAME to the
 *    stored list — in a SECTION, and in a REPEATER row under both layouts;
 *  - a stored name the catalog does not declare stays listed, flagged
 *    `(not found)`; a declared one is not flagged;
 *  - removing a name writes the list without it;
 *  - the FAILED arm shows the shared failure notice and still adds a typed name;
 *  - with NO catalog the field takes typed names, ⛔ never the raw-JSON face;
 *  - the host's label names the list (`labelling: 'group'`), in both states.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchemaForm } from './SchemaForm';
import { formDeclaresWidget, WIDGET_LABELLING, type WidgetContext } from './widgets';
import { loaded, failed } from './loadState';
import { t, tFormat } from './i18n';

afterEach(cleanup);

const CATALOG = [
  { name: 'sales_manager', label: 'Sales manager' },
  { name: 'sales_rep', label: 'Sales rep' },
  { name: 'support_agent' },
];

const WITH_CATALOG: WidgetContext = { conditionScope: 'none', permissionSets: loaded(CATALOG) };

const LABEL = 'Permission Sets';
const ADD = t('engine.form.addPermissionSetPlain', 'en-US');
const NOT_FOUND = t('engine.form.notFound', 'en-US');
/** The announced fallback the unregistered hint rendered in place of a picker. */
const RAW_JSON_NOTICE = tFormat('engine.form.fallbackJson', 'en-US', { widget: 'ref-multi:permission' });

/** The position form's row, as objectstack#22794 declares it: an explicit widget and no `type`. */
function sectionForm() {
  return {
    type: 'simple',
    sections: [
      { label: 'Position', fields: [{ field: 'permissionSets', label: LABEL, widget: 'ref-multi:permission' }] },
    ],
  } as never;
}

/** `PositionSchema.permissionSets`: an optional list of snake_case names. */
function sectionSchema() {
  return {
    type: 'object',
    properties: { permissionSets: { type: 'array', items: { type: 'string' } } },
  } as never;
}

type Layout = 'grid' | 'card';

function repeaterForm(layout: Layout) {
  return {
    type: 'simple',
    sections: [
      {
        label: 'S',
        fields: [
          {
            field: 'rows',
            type: 'repeater',
            ...(layout === 'grid' ? { widget: 'grid' } : {}),
            fields: [
              { field: 'name', label: 'Name' },
              { field: 'permissionSets', label: LABEL, widget: 'ref-multi:permission' },
            ],
          },
        ],
      },
    ],
  } as never;
}

function repeaterSchema() {
  return {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, permissionSets: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  } as never;
}

function renderSection(
  ctx: WidgetContext | undefined,
  value: Record<string, unknown> = {},
  readOnly = false,
) {
  const onChange = vi.fn<(next: Record<string, unknown>) => void>();
  render(
    <SchemaForm
      schema={sectionSchema()}
      form={sectionForm()}
      value={value}
      widgetContext={ctx}
      onChange={onChange}
      readOnly={readOnly}
    />,
  );
  return onChange;
}

/** The named list the host label points at. */
function theList() {
  return screen.getByRole('group', { name: LABEL });
}

/** The names listed in the field, each with whatever flag it carries. */
function listed(): string[] {
  return within(theList())
    .queryAllByRole('listitem')
    .map((li) => li.textContent ?? '');
}

async function pick(option: RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: ADD }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

/** The defect's face, read positively so a picker that renders nothing cannot pass. */
function expectNoRawJsonFace() {
  expect(screen.queryByText(RAW_JSON_NOTICE), 'the announced raw-JSON fallback is on screen').toBeNull();
  expect(document.querySelector('textarea'), 'a JSON textarea renders in place of the field').toBeNull();
}

describe('`ref-multi:permission` with the catalog — a multi-picker of declared permission sets (objectui#12126)', () => {
  it('renders the picker, not the raw-JSON face, and a pick appends that set name to the stored list', async () => {
    const onChange = renderSection(WITH_CATALOG, { permissionSets: ['sales_manager'] });
    expectNoRawJsonFace();
    await pick(/sales_rep/);
    expect(onChange).toHaveBeenLastCalledWith({ permissionSets: ['sales_manager', 'sales_rep'] });
  });

  it('a first pick on an empty field stores a one-name list', async () => {
    const onChange = renderSection(WITH_CATALOG);
    await pick(/support_agent/);
    expect(onChange).toHaveBeenLastCalledWith({ permissionSets: ['support_agent'] });
  });

  it('offers only the declared sets not yet picked, with the label beside the name', async () => {
    renderSection(WITH_CATALOG, { permissionSets: ['sales_manager'] });
    await userEvent.click(screen.getByRole('combobox', { name: ADD }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Sales repsales_rep', 'support_agent']);
  });

  it('lists the stored names, a declared one unflagged', () => {
    renderSection(WITH_CATALOG, { permissionSets: ['sales_manager', 'support_agent'] });
    expect(listed()).toEqual(['Sales managersales_manager×', 'support_agent×']);
  });

  it('a stored name the catalog does not declare stays listed, flagged — never dropped', () => {
    renderSection(WITH_CATALOG, { permissionSets: ['sales_rep', 'retired_set'] });
    const [known, unknown] = within(theList()).getAllByRole('listitem');
    expect(unknown).toHaveTextContent('retired_set');
    expect(unknown).toHaveTextContent(NOT_FOUND);
    expect(known).toHaveTextContent('sales_rep');
    expect(known).not.toHaveTextContent(NOT_FOUND);
  });

  it('a flagged name is still picked around: a pick keeps it in the stored list', async () => {
    const onChange = renderSection(WITH_CATALOG, { permissionSets: ['retired_set'] });
    await pick(/sales_rep/);
    expect(onChange).toHaveBeenLastCalledWith({ permissionSets: ['retired_set', 'sales_rep'] });
  });

  it('removing a name writes the list without it', () => {
    const onChange = renderSection(WITH_CATALOG, { permissionSets: ['sales_manager', 'sales_rep'] });
    fireEvent.click(screen.getByRole('button', { name: tFormat('engine.form.removeNamed', 'en-US', { name: 'sales_manager' }) }));
    expect(onChange).toHaveBeenLastCalledWith({ permissionSets: ['sales_rep'] });
  });

  it('read-only: the names stay listed, flags included, with no add or remove control', () => {
    renderSection(WITH_CATALOG, { permissionSets: ['sales_rep', 'retired_set'] }, true);
    expect(listed()).toEqual(['Sales repsales_rep', `retired_set${NOT_FOUND}`]);
    expect(screen.queryByRole('combobox', { name: ADD })).toBeNull();
    expect(within(theList()).queryAllByRole('button')).toEqual([]);
  });

  for (const layout of ['grid', 'card'] as const) {
    it(`a REPEATER row (${layout} layout) renders the picker and writes the list into that row`, async () => {
      const onChange = vi.fn<(next: Record<string, unknown>) => void>();
      render(
        <SchemaForm
          schema={repeaterSchema()}
          form={repeaterForm(layout)}
          value={{ rows: [{ name: 'r1' }] }}
          widgetContext={WITH_CATALOG}
          onChange={onChange}
        />,
      );
      // The card layout keeps a row collapsed until it is opened.
      if (layout === 'card') fireEvent.click(screen.getByText(/#1/));
      expectNoRawJsonFace();
      await pick(/sales_rep/);
      expect(onChange).toHaveBeenLastCalledWith({ rows: [{ name: 'r1', permissionSets: ['sales_rep'] }] });
    });
  }
});

describe('`ref-multi:permission` when the catalog has not answered (objectui#12126)', () => {
  it('FAILED: the shared failure notice, the stored names unflagged, and a box that still adds a typed name', () => {
    const onChange = renderSection(
      { conditionScope: 'none', permissionSets: failed('HTTP 503') },
      { permissionSets: ['sales_rep'] },
    );
    expect(screen.getByTestId('ref-multi-permission-load-failed')).toHaveTextContent('HTTP 503');
    expect(listed()).toEqual(['sales_rep×']);
    const box = screen.getByRole('textbox', { name: ADD });
    fireEvent.change(box, { target: { value: 'support_agent' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ permissionSets: ['sales_rep', 'support_agent'] });
  });

  it('LOADING: the add box is disabled, and no stored name is flagged', () => {
    renderSection({ conditionScope: 'none', permissionSets: { status: 'loading' } }, { permissionSets: ['sales_rep'] });
    expect(screen.getByRole('textbox', { name: ADD })).toBeDisabled();
    expect(listed()).toEqual(['sales_rep×']);
  });

  it('NO catalog: typed names are added to the list, ⛔ never the raw-JSON face', () => {
    const onChange = renderSection(undefined, { permissionSets: ['sales_rep'] });
    expectNoRawJsonFace();
    const box = screen.getByRole('textbox', { name: ADD });
    fireEvent.change(box, { target: { value: 'support_agent, sales_rep' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenLastCalledWith({ permissionSets: ['sales_rep', 'support_agent'] });
  });
});

describe('`ref-multi:permission` is named by the host label as a list (objectui#12126)', () => {
  it('is declared `group`, and the host label names the list in both states', () => {
    expect(WIDGET_LABELLING['ref-multi:permission']).toBe('group');
    for (const readOnly of [false, true]) {
      renderSection(WITH_CATALOG, { permissionSets: ['sales_rep'] }, readOnly);
      expect(theList()).toBeInTheDocument();
      cleanup();
    }
  });
});

describe('formDeclaresWidget — the gate on the catalog request (objectui#12126)', () => {
  it('finds the hint in a section row, in a legacy `groups` entry and on a repeater sub-field', () => {
    expect(formDeclaresWidget(sectionForm(), 'ref-multi:permission')).toBe(true);
    expect(formDeclaresWidget(repeaterForm('grid'), 'ref-multi:permission')).toBe(true);
    expect(
      formDeclaresWidget(
        { groups: [{ fields: [{ field: 'p', widget: 'ref-multi:permission' }] }] } as never,
        'ref-multi:permission',
      ),
    ).toBe(true);
  });

  it('answers no for a form without it, and for no form', () => {
    expect(formDeclaresWidget(sectionForm(), 'ref:dataset')).toBe(false);
    expect(
      formDeclaresWidget({ sections: [{ fields: ['name', { field: 'tags', type: 'tags' }] }] } as never, 'ref-multi:permission'),
    ).toBe(false);
    expect(formDeclaresWidget(undefined, 'ref-multi:permission')).toBe(false);
  });
});
