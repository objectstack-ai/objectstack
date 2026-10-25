// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Excel import bar's target-object picker is the shared `Select`
 * (objectui#11865).
 *
 * The bar in the AI build panel ("Import deals.xlsx into …") picked its target
 * object with a browser-native select, beside the shared Radix `Select` the
 * rest of the console picks with. The card asks for one control for one kind
 * of choice, surface by surface.
 *
 * What is pinned:
 *   - the picker IS the primitive (a Radix combobox trigger); no native select
 *     is left in the bar;
 *   - it had no accessible name and still has none (kept for parity; see the
 *     pull request's acceptance notes);
 *   - it lists the objects the native control listed, in its order, and
 *     starts on the same one;
 *   - every option leads to the import the native control led to (the schema
 *     read and the wizard's object), compared as JSON text;
 *   - a held object name the list does not carry is what the trigger shows;
 *   - with no object to list it is the primitive's disabled trigger
 *     (objectui#11781);
 *   - the keyboard alone opens the picker and selects.
 *
 * DIRECTION, observed against the native control: every pin here but the name
 * pin is red there, because each one reads the picker as the primitive's
 * trigger. What makes the write rows guards of "the conversion changed nothing
 * the bar imports into" is the literal each compares against: a `change` event
 * on the pre-conversion bar's native control, then Import, led to that same
 * JSON, read once on that bar with these fixtures. The held-name readings were
 * taken there the same way.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  /** What the object list answers; `null` makes it fail. */
  objects: [] as unknown[] | null,
  /** The props each mounted ImportWizard received. */
  wizard: [] as Array<Record<string, unknown>>,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => async () =>
    h.objects === null
      ? new Response('unavailable', { status: 500 })
      : new Response(JSON.stringify({ data: { items: h.objects } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
}));
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ImportWizard: (props: { objectName: string; objectLabel: string; fields: unknown; initialFile?: File }) => {
    h.wizard.push({
      objectName: props.objectName,
      objectLabel: props.objectLabel,
      fields: props.fields,
      file: props.initialFile?.name,
    });
    return <div data-testid="import-wizard" />;
  },
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { ExcelImportBar } from '../ExcelImportBar';

/** The served object list: a platform object the bar filters out, and one with no label. */
const OBJECTS = [
  { name: 'crm_account', label: 'Account' },
  { name: 'sys_user', label: 'User' },
  { name: 'crm_deal', label: 'Deal' },
  { name: 'crm_lead' },
];
const FILE = new File(['a,b\n1,2'], 'deals.xlsx');
/** What `t()` answers with no i18n provider: the key itself. */
const IMPORT = 'excelImport.importAction';

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

function mount(defaultObjectName?: string) {
  const dataSource = {
    getObjectSchema: vi.fn(async (_name: string) => ({
      fields: { title: { type: 'text', label: 'Title' }, total: { type: 'formula' } },
    })),
  };
  const utils = render(
    <ExcelImportBar file={FILE} dataSource={dataSource} defaultObjectName={defaultObjectName} onDone={vi.fn()} />,
  );
  return { ...utils, dataSource };
}

/** The bar's picker: its one combobox. */
const trigger = () => screen.getByRole('combobox');
const importButton = () => screen.getByRole('button', { name: IMPORT });

async function openPicker(): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(label: string): Promise<void> {
  const options = await openPicker();
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`no "${label}" listed: ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

/** Press Import and return what it led to as JSON text: the schema read and the wizard's object. */
async function doImport(dataSource: { getObjectSchema: ReturnType<typeof vi.fn> }): Promise<string> {
  fireEvent.click(importButton());
  await screen.findByTestId('import-wizard');
  return JSON.stringify({ getObjectSchema: dataSource.getObjectSchema.mock.calls, wizard: h.wizard[h.wizard.length - 1] });
}

beforeEach(() => {
  cleanup();
  h.objects = OBJECTS;
  h.wizard.length = 0;
});

describe('the target-object picker is the shared Select (objectui#11865)', () => {
  it('renders the picker as the Radix combobox trigger, on the first listed object', async () => {
    const { container } = mount();
    await settle();
    expect(trigger().tagName).toBe('BUTTON');
    expect(trigger()).toHaveTextContent('Account');
    expect(container.querySelectorAll('select')).toHaveLength(0);
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('has no accessible name, as the native control had none', async () => {
    mount();
    await settle();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: '' })).toBe(trigger());
  });

  it('lists the objects the native control listed, in its order', async () => {
    mount();
    await settle();
    expect((await openPicker()).map((o) => o.textContent)).toEqual(['Account', 'Deal', 'crm_lead']);
  });
});

/** [the option picked, the JSON text of what Import led to]. */
const WRITES: ReadonlyArray<readonly [label: string, json: string]> = [
  ['Account', '{"getObjectSchema":[["crm_account"]],"wizard":{"objectName":"crm_account","objectLabel":"Account","fields":[{"name":"title","label":"Title","type":"text","required":false}],"file":"deals.xlsx"}}'],
  ['Deal', '{"getObjectSchema":[["crm_deal"]],"wizard":{"objectName":"crm_deal","objectLabel":"Deal","fields":[{"name":"title","label":"Title","type":"text","required":false}],"file":"deals.xlsx"}}'],
  ['crm_lead', '{"getObjectSchema":[["crm_lead"]],"wizard":{"objectName":"crm_lead","objectLabel":"crm_lead","fields":[{"name":"title","label":"Title","type":"text","required":false}],"file":"deals.xlsx"}}'],
];

describe('every option imports into what the native control imported into', () => {
  it.each(WRITES)('%s', async (label, json) => {
    const { dataSource } = mount();
    await settle();
    await pick(label);
    expect(trigger()).toHaveTextContent(label);
    expect(await doImport(dataSource)).toBe(json);
  });

  it('starts on `defaultObjectName` when the list carries it', async () => {
    const { dataSource } = mount('crm_deal');
    await settle();
    expect(trigger().textContent).toBe('Deal');
    expect(await doImport(dataSource)).toBe(
      '{"getObjectSchema":[["crm_deal"]],"wizard":{"objectName":"crm_deal","objectLabel":"Deal","fields":[{"name":"title","label":"Title","type":"text","required":false}],"file":"deals.xlsx"}}',
    );
  });
});

describe('a held object name the list does not carry is what the trigger shows', () => {
  it('a `defaultObjectName` the list does not return: shown, and imported into as held', async () => {
    const { dataSource } = mount('ghost');
    await settle();
    // The native control showed "Account" here while Import loaded into `ghost`.
    expect(trigger()).toHaveTextContent('ghost');
    expect((await openPicker()).map((o) => o.textContent)).toEqual(['ghost', 'Account', 'Deal', 'crm_lead']);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(await doImport(dataSource)).toBe(
      '{"getObjectSchema":[["ghost"]],"wizard":{"objectName":"ghost","objectLabel":"ghost","fields":[{"name":"title","label":"Title","type":"text","required":false}],"file":"deals.xlsx"}}',
    );
  });

  it('a failed object list with a `defaultObjectName`: disabled, showing the object Import still loads into', async () => {
    h.objects = null;
    const { dataSource } = mount('crm_deal');
    await settle();
    // The native control was disabled and blank here while Import loaded into `crm_deal`.
    expect(trigger()).toBeDisabled();
    expect(trigger().textContent).toBe('crm_deal');
    expect(importButton()).toBeEnabled();
    expect(await doImport(dataSource)).toBe(
      '{"getObjectSchema":[["crm_deal"]],"wizard":{"objectName":"crm_deal","objectLabel":"crm_deal","fields":[{"name":"title","label":"Title","type":"text","required":false}],"file":"deals.xlsx"}}',
    );
  });
});

describe('with no object to list, the picker is disabled through the primitive (objectui#11781)', () => {
  it('an empty list: disabled, the keyboard does not open it, and Import stays disabled', async () => {
    h.objects = [];
    mount();
    await settle();
    // The primitive's disabled trigger: Radix marks it `data-disabled`.
    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveAttribute('data-disabled');
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    await settle();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(importButton()).toBeDisabled();
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens the picker and Enter on an option selects it', async () => {
    const { dataSource } = mount();
    await settle();
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Deal' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger()).toHaveTextContent('Deal');
    expect(await doImport(dataSource)).toBe(WRITES[1][1]);
  });
});
