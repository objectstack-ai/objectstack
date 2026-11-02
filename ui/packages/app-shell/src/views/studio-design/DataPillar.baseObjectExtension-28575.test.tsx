// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28575 (ADR-0146 D10, D3) — Studio adds a field to a read-only
 * base's object as the customer's extension of it, in the base's paired
 * `<base>.custom` package: the field is `__c`, the extension is the pair's
 * `object_extension` item filed under the object's name, the base object's
 * body is never sent, and a base field takes only the spec's display-property
 * whitelist, written as the extension's `fieldPatches`.
 *
 * The REAL `DataPillar` and the REAL field inspector, over a metadata client
 * double; the records grid is stubbed to its "+" column (drawn from the
 * grid's authoring context, as the real grid draws it). The customization the
 * surface hands the pillar is built here: its `ensure` is the ensure door.
 *
 * Pinned:
 *  - Add field "Region" asks the ensure door once, writes `region__c` into an
 *    extension at the pair, and sends no body of the base object; the field
 *    shows in the Form at once and its inspector edits the extension;
 *  - a second add does not ask the door again;
 *  - a published `region__c` (served on the object AND declared by the pair's
 *    published extension) shows once, a second add keeps it in the draft, and
 *    the popover refuses `region__c` as taken;
 *  - a label edit on a base field writes only `label`, into `fieldPatches`;
 *  - `required` on a base field is not editable, under the whitelist sentence;
 *  - a refusal (the ensure door's, the save door's) is shown as sent;
 *  - walled: Add field draws disabled in the console's sentence, and nothing
 *    is asked or written;
 *  - CONTROL: a writable package's add-field and inspector are unchanged.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';
const OBJECT = 'crm_account';

const srv = vi.hoisted(() => ({
  /** The object as the base serves it (the pair's PUBLISHED extension already merged in). */
  served: {} as Record<string, unknown>,
  /** The pair's published extension row of the object, `null` when it has none. */
  publishedExt: null as Record<string, unknown> | null,
  /** The pair's pending extension draft, `null` when it has none. */
  draftExt: null as Record<string, unknown> | null,
  /** The save door's refusal for an extension write, when set. */
  refuse: null as Error | null,
}));

const baseServed = () => ({
  name: OBJECT,
  label: 'Account',
  fields: {
    name: { type: 'text', label: 'Account Name', required: true },
    industry: { type: 'select', label: 'Industry', options: [{ value: 'technology', label: 'Technology' }] },
  },
});

const mockClient = {
  list: vi.fn(async (_type: string, opts?: { packageId?: string }) =>
    opts?.packageId === PAIR ? [] : [{ name: OBJECT, label: 'Account' }],
  ),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: srv.served, code: srv.served })),
  getDraft: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) =>
    type === 'object_extension' && name === OBJECT && opts?.packageId === PAIR && srv.draftExt
      ? { type, name, item: srv.draftExt }
      : null,
  ),
  get: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) =>
    type === 'object_extension' && name === OBJECT && opts?.packageId === PAIR ? srv.publishedExt : null,
  ),
  save: vi.fn(async (type: string, _name: string, _body: unknown, _opts?: { packageId?: string }) => {
    if (type === 'object_extension' && srv.refuse) throw srv.refuse;
    return { ok: true, version: 'v2', state: 'draft' };
  }),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  function GridDouble() {
    const authoring = useGridFieldAuthoring();
    return (
      <div data-testid="records-panel">
        {authoring?.onAddColumn && (
          <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
            Add column
          </button>
        )}
      </div>
    );
  }
  return { ...mod, ObjectView: GridDouble };
});

import { DataPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { t, tFormat } from '../metadata-admin/i18n';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';

registerMetadataInspector('object', ObjectFieldInspector);

const FORM = t('engine.studio.data.tab.form', 'en');
const ADD_FIELD = t('engine.studio.data.addField', 'en');
const WALLED = t('engine.studio.customize.walled', 'en');

const ensure = vi.fn(async (): Promise<string> => PAIR);

function customizationOf(over: Partial<StudioBaseCustomization> = {}): StudioBaseCustomization {
  return {
    base: BASE,
    baseLabel: 'HotCRM',
    basedOn: '4.0.0',
    walled: false,
    pairId: PAIR,
    ensure,
    ensurePackage: vi.fn(async () => ({
      basePackageId: BASE,
      packageId: PAIR,
      namespace: 'hotcrm_custom',
      dependencyRange: '^4',
      created: false,
      writable: true,
    })) as unknown as StudioBaseCustomization['ensurePackage'],
    marks: { status: 'off' },
    ...over,
  };
}

beforeEach(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
  srv.served = baseServed();
  srv.publishedExt = null;
  srv.draftExt = null;
  srv.refuse = null;
  ensure.mockImplementation(async () => PAIR);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderBase(over: Partial<StudioBaseCustomization> = {}) {
  render(
    <MemoryRouter initialEntries={[`/studio/${BASE}/data`]}>
      <DataPillar packageId={BASE} readOnly customization={customizationOf(over)} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
}

async function openForm() {
  await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
  await screen.findByRole('button', { name: 'Layout', pressed: true });
}

type SaveCall = [string, string, Record<string, unknown>, { packageId?: string; mode?: string }];
const saves = () => mockClient.save.mock.calls as unknown as SaveCall[];
const extensionSaves = () => saves().filter(([type]) => type === 'object_extension');

/** Open the Form toolbar's Add field, fill it and press Create. */
async function addFromFormToolbar(label: string): Promise<void> {
  await userEvent.click(await screen.findByTestId('data-form-add-extension-field'));
  const popover = await screen.findByTestId('add-field-popover');
  await userEvent.type(within(popover).getByTestId('add-field-label-input'), label);
  await userEvent.click(within(popover).getByTestId('add-field-create'));
}

/** A field card of the Form layout, by its label (a base object's layout is read-only). */
const cardOf = (label: string) =>
  screen.queryAllByLabelText(tFormat('engine.studio.designer.fieldAriaReadOnly', 'en', { label }));

describe('Studio adds a field to a read-only base object as an extension in its pair (objectstack#28575)', () => {
  it('Add field "Region" asks the ensure door once, writes region__c into an extension at the pair, and sends no body of the base object', async () => {
    await renderBase();
    await openForm();
    await userEvent.click(await screen.findByTestId('data-form-add-extension-field'));
    const popover = await screen.findByTestId('add-field-popover');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Region');
    // The api name carries the suffix before Create.
    expect(within(popover).getByTestId('add-field-api-name-preview')).toHaveTextContent('region__c');
    await userEvent.click(within(popover).getByTestId('add-field-create'));

    await waitFor(() => expect(extensionSaves()).toHaveLength(1), { timeout: 8000 });
    expect(ensure).toHaveBeenCalledTimes(1);
    const [[type, name, body, opts]] = extensionSaves();
    expect([type, name]).toEqual(['object_extension', OBJECT]);
    expect(opts).toMatchObject({ mode: 'draft', packageId: PAIR });
    expect(body).toStrictEqual({ extend: OBJECT, fields: { region__c: { type: 'text', label: 'Region' } } });
    // The base object's body is never sent.
    expect(saves().filter(([t]) => t === 'object')).toEqual([]);

    // Wanted 3 — it shows in the Form at once, and its inspector edits the extension.
    expect(cardOf('Region')).toHaveLength(1);
    const inspector = await screen.findByTestId('data-field-inspector');
    expect(within(inspector).getByText('region__c')).toBeInTheDocument();
    const label = within(inspector).getByTestId('field-label-input');
    expect(label).toBeEnabled();
    expect(within(inspector).queryByTestId('field-base-patch-only')).toBeNull();
    await userEvent.type(label, ' code');
    await waitFor(
      () =>
        expect(extensionSaves().at(-1)?.[2]).toStrictEqual({
          extend: OBJECT,
          fields: { region__c: { type: 'text', label: 'Region code' } },
        }),
      { timeout: 8000 },
    );
    expect(saves().filter(([t]) => t === 'object')).toEqual([]);
  });

  it('a second add does not ask the ensure door again', async () => {
    await renderBase();
    await openForm();
    await addFromFormToolbar('Region');
    await waitFor(() => expect(extensionSaves()).toHaveLength(1), { timeout: 8000 });
    await addFromFormToolbar('Tier');
    await waitFor(
      () => expect(Object.keys((extensionSaves().at(-1)?.[2].fields ?? {}) as object)).toEqual(['region__c', 'tier__c']),
      { timeout: 8000 },
    );
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('the Records grid "+" offers it too, suffixed the same way', async () => {
    await renderBase();
    await userEvent.click(screen.getByTestId('grid-add-column'));
    const popover = await screen.findByTestId('add-field-popover');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Region');
    expect(within(popover).getByTestId('add-field-api-name-preview')).toHaveTextContent('region__c');
    await userEvent.click(within(popover).getByTestId('add-field-create'));
    await waitFor(() => expect(extensionSaves()).toHaveLength(1), { timeout: 8000 });
    expect(Object.keys(extensionSaves()[0]![2].fields as object)).toEqual(['region__c']);
  });

  it('a published region__c shows once, a second add keeps it, and the popover refuses region__c as taken', async () => {
    // Published: the base serves the merged field, and the pair's row declares it.
    const region = { type: 'text', label: 'Region' };
    srv.served = { ...baseServed(), fields: { ...baseServed().fields, region__c: region } };
    srv.publishedExt = { extend: OBJECT, fields: { region__c: region }, _packageId: PAIR };
    await renderBase();
    await openForm();
    await waitFor(() => expect(cardOf('Region')).toHaveLength(1), { timeout: 8000 });

    await userEvent.click(await screen.findByTestId('data-form-add-extension-field'));
    const popover = await screen.findByTestId('add-field-popover');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Region');
    // `region__c` is taken: the popover asks for another name, and says why.
    expect(within(popover).getByTestId('add-field-api-name-hint')).toHaveTextContent(
      tFormat('engine.studio.data.addFieldApiNameTaken', 'en', { name: 'region__c' }),
    );
    expect(within(popover).getByTestId('add-field-create')).toHaveAttribute('aria-disabled', 'true');
    await userEvent.clear(within(popover).getByTestId('add-field-label-input'));
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Tier');
    await userEvent.click(within(popover).getByTestId('add-field-create'));

    await waitFor(() => expect(extensionSaves()).toHaveLength(1), { timeout: 8000 });
    // The draft starts from the published body: publishing it keeps region__c.
    expect(extensionSaves()[0]![2]).toStrictEqual({
      extend: OBJECT,
      fields: { region__c: region, tier__c: { type: 'text', label: 'Tier' } },
    });
    expect(cardOf('Region')).toHaveLength(1);
    expect(cardOf('Tier')).toHaveLength(1);
  });

  it('a label edit on a base field writes only `label`, into the extension’s fieldPatches', async () => {
    await renderBase();
    await openForm();
    await userEvent.click(cardOf('Account Name')[0]!);
    const inspector = await screen.findByTestId('data-field-inspector');
    const label = within(inspector).getByTestId('field-label-input');
    expect(label).toBeEnabled();
    await userEvent.clear(label);
    await userEvent.type(label, 'Company');
    await waitFor(
      () => expect(extensionSaves().at(-1)?.[2]).toStrictEqual({ extend: OBJECT, fieldPatches: { name: { label: 'Company' } } }),
      { timeout: 8000 },
    );
    expect(saves().filter(([t]) => t === 'object')).toEqual([]);
    // Shown with the patch applied, and still the base's field (its api name stays).
    expect(cardOf('Company')).toHaveLength(1);
  });

  it('an option label of a base field is patched by its stored value', async () => {
    await renderBase();
    await openForm();
    await userEvent.click(cardOf('Industry')[0]!);
    const inspector = await screen.findByTestId('data-field-inspector');
    const optionLabel = within(inspector).getByTestId('option-label');
    expect(optionLabel).toBeEnabled();
    expect(within(inspector).getByTestId('option-value')).toBeDisabled();
    await userEvent.clear(optionLabel);
    await userEvent.type(optionLabel, 'Tech');
    await waitFor(
      () =>
        expect(extensionSaves().at(-1)?.[2]).toStrictEqual({
          extend: OBJECT,
          fieldPatches: { industry: { options: { technology: { label: 'Tech' } } } },
        }),
      { timeout: 8000 },
    );
  });

  it('`required` on a base field is not editable, and one sentence names the whitelist', async () => {
    await renderBase();
    await openForm();
    await userEvent.click(cardOf('Account Name')[0]!);
    const inspector = await screen.findByTestId('data-field-inspector');
    expect(within(inspector).getByRole('checkbox', { name: t('designer.field.required', 'en') })).toBeDisabled();
    expect(within(inspector).getByRole('checkbox', { name: t('designer.field.unique', 'en') })).toBeDisabled();
    for (const key of ['designer.field.description', 'designer.field.helpText', 'designer.field.placeholder']) {
      expect(within(inspector).getByLabelText(t(key, 'en'))).toBeEnabled();
    }
    const sentence = within(inspector).getByTestId('field-base-patch-only');
    for (const name of ['designer.field.label', 'designer.field.helpText', 'designer.field.placeholder']) {
      expect(sentence).toHaveTextContent(t(name, 'en'));
    }
    expect(sentence).toHaveTextContent(t('designer.field.basePatchOnly.optionLabels', 'en'));
  });

  it('a refusal is shown as the server sent it: the ensure door’s, and the save door’s', async () => {
    const walled = 'Only the platform operator may customize an installed package on this deployment.';
    ensure.mockImplementation(async () => {
      throw new Error(walled);
    });
    await renderBase();
    await openForm();
    await addFromFormToolbar('Region');
    await waitFor(() => expect(screen.getByText(walled, { exact: false })).toBeInTheDocument(), { timeout: 8000 });

    cleanup();
    vi.clearAllMocks();
    ensure.mockImplementation(async () => PAIR);
    const suffix = 'Field `region__c` is refused: an extension field must end in __c.';
    srv.refuse = Object.assign(new Error(suffix), { status: 400, code: 'VALIDATION_ERROR' });
    await renderBase();
    await openForm();
    await addFromFormToolbar('Region');
    await waitFor(() => expect(screen.getByText(suffix, { exact: false })).toBeInTheDocument(), { timeout: 8000 });
  });

  it('walled: Add field draws disabled in the console’s own sentence, and nothing is asked or written', async () => {
    await renderBase({ walled: true });
    expect(screen.queryByTestId('grid-add-column')).toBeNull();
    const blocked = screen.getByTestId('data-add-field-walled');
    expect(blocked).toHaveAttribute('title', WALLED);
    expect(within(blocked).getByRole('button', { name: new RegExp(ADD_FIELD) })).toBeDisabled();
    expect(blocked).toHaveTextContent(WALLED);
    await openForm();
    expect(screen.queryByTestId('data-form-add-extension-field')).toBeNull();
    expect(screen.getByTestId('data-add-field-walled')).toBeInTheDocument();
    // A base field opens read-only, as on any read-only package.
    await userEvent.click(cardOf('Account Name')[0]!);
    const inspector = await screen.findByTestId('data-field-inspector');
    expect(within(inspector).getByTestId('field-label-input')).toBeDisabled();
    await new Promise((r) => setTimeout(r, 300));
    expect(ensure).not.toHaveBeenCalled();
    expect(mockClient.save).not.toHaveBeenCalled();
  });
});

describe('CONTROL: a writable package’s add-field is unchanged (objectstack#28575)', () => {
  it('a plain name into the object’s own body, and a fully editable inspector', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
        <DataPillar packageId="com.example.showcase" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
    await openForm();
    expect(screen.queryByTestId('data-form-add-extension-field')).toBeNull();
    await userEvent.click(within(screen.getByTestId('form-toolbar')).getByRole('button', { name: ADD_FIELD }));
    const popover = await screen.findByTestId('add-field-popover');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Region');
    expect(within(popover).getByTestId('add-field-api-name-preview')).toHaveTextContent(/^.*region$/);
    await userEvent.click(within(popover).getByTestId('add-field-create'));
    await waitFor(() => expect(saves().some(([type]) => type === 'object')).toBe(true), { timeout: 8000 });
    const [, , body] = saves().filter(([type]) => type === 'object').at(-1)!;
    expect(Object.keys(body.fields as object)).toEqual(['name', 'industry', 'region']);
    expect(extensionSaves()).toEqual([]);
    expect(ensure).not.toHaveBeenCalled();
    const inspector = await screen.findByTestId('data-field-inspector');
    expect(within(inspector).queryByTestId('field-base-patch-only')).toBeNull();
    expect(within(inspector).getByRole('checkbox', { name: t('designer.field.required', 'en') })).toBeEnabled();
  });
});
