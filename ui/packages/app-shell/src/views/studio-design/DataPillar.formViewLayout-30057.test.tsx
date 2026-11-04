// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30057 — the Data pillar's Form tab lays out the form the app
 * opens. When the object has a form view the app's New / Edit dialogs select
 * (`selectRecordFormView`), the designer shows THAT view's sections and a
 * layout edit is saved to the view's draft, never to the object's
 * `fieldGroups`; with none, it edits `fieldGroups` as before.
 *
 * Measured on the card: with `isDefault` form view sections 基本信息 / 金额信息,
 * the designer drew the object's field groups (设计器分组 / 未分组), and its
 * publish changed a layout nobody sees.
 *
 * The REAL `DataPillar`, `ObjectFormDesigner` and Preview `ObjectForm`, over a
 * metadata client double; the shell's merged objects (`useMetadata().objects`,
 * what the app's dialogs read) are served here. The records grid is stubbed.
 *
 * Pinned:
 *  - a default form view: its sections are the canvas, the chip names the
 *    view, Add group saves the VIEW's draft (its other sections and field
 *    entries untouched) and sends no object body;
 *  - CONTROL: no form view: the field groups are the canvas and Add group
 *    saves the object's `fieldGroups`, as before;
 *  - a `create` form view beside the default: New and Edit pick between them;
 *  - Preview lays the form out by the same form view;
 *  - a read-only base: the edit is saved into the pair as a declared override
 *    of the base's view (ADR-0146 D2).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.qa.deals';
const PAIR = 'com.qa.deals.custom';
const OBJECT = 'deals_deal';

const srv = vi.hoisted(() => ({
  /** The shell's merged objects, as `MetadataProvider` serves them to the app. */
  shellObjects: [] as Array<Record<string, unknown>>,
  /** Stored view items by name (the published layer the Studio reads). */
  views: new Map<string, Record<string, unknown>>(),
}));

const dealObject = () => ({
  name: OBJECT,
  label: 'Deal',
  fieldGroups: [{ key: 'designer', label: 'Designer group' }],
  fields: {
    name: { type: 'text', label: 'Deal Name', group: 'designer' },
    amount: { type: 'currency', label: 'Amount' },
    stage: { type: 'text', label: 'Stage' },
    notes: { type: 'textarea', label: 'Notes' },
  },
});

/** The default form view item, in the record shape the server stores. */
const defaultViewItem = () => ({
  name: `${OBJECT}.form`,
  object: OBJECT,
  viewKind: 'form',
  isDefault: true,
  label: 'Deal form',
  config: {
    type: 'simple',
    sections: [
      { name: 'basic', label: 'Basic info', columns: 2, fields: [{ field: 'name', required: true }, { field: 'amount' }] },
      { name: 'money', label: 'Money details', fields: ['stage'] },
    ],
  },
});
const createViewItem = () => ({
  name: `${OBJECT}.create`,
  object: OBJECT,
  viewKind: 'form',
  label: 'Quick create',
  config: { type: 'simple', sections: [{ name: 'quick', label: 'Quick create', fields: [{ field: 'name' }] }] },
});

/** A view item as the shell merges it onto its object (`applyViewItem`): the body flat, the id stamped. */
const merged = (item: Record<string, unknown>) => ({
  ...(item.config as Record<string, unknown>),
  name: item.name,
  label: item.label,
  isDefault: !!item.isDefault,
});

function serveObject(views: Array<Record<string, unknown>>) {
  const obj: Record<string, unknown> = dealObject();
  const formViews: Record<string, unknown> = {};
  for (const v of views) {
    srv.views.set(String(v.name), v);
    formViews[String(v.name)] = merged(v);
    if (v.isDefault) obj.form = merged(v);
  }
  if (views.length) obj.formViews = formViews;
  srv.shellObjects = [obj];
}

const mockClient = {
  list: vi.fn(async (_type: string, opts?: { packageId?: string }) =>
    opts?.packageId === PAIR ? [] : [{ name: OBJECT, label: 'Deal' }],
  ),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    const row = type === 'view' ? srv.views.get(name) : dealObject();
    return row ? { effective: row, code: row } : null;
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  save: vi.fn(async () => ({ ok: true, version: 'v2', state: 'draft' })),
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
  return {
    ...mod,
    useAdapter: () => ({ getObjectSchema: async () => dealObject() }),
    useMetadata: () => ({ ...mod.useMetadata(), objects: srv.shellObjects }),
  };
});

vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, ObjectView: () => <div data-testid="records-panel" /> };
});

import { DataPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

const FORM = t('engine.studio.data.tab.form', 'en');
const SECTION_NAME = t('engine.studio.designer.group.nameLabel', 'en');
const OFF_FORM = t('engine.studio.designer.offForm', 'en');
const UNGROUPED = t('engine.studio.designer.ungrouped', 'en');
const NEW_GROUP = t('engine.studio.designer.newGroup', 'en');
const NEW = t('engine.studio.data.form.flowCreate', 'en');
const EDIT = t('engine.studio.data.form.flowEdit', 'en');

function customizationOf(): StudioBaseCustomization {
  return {
    base: PKG,
    baseLabel: 'Deals',
    basedOn: '1.2.0',
    walled: false,
    pairId: null,
    ensure: vi.fn(async () => PAIR),
    ensurePackage: vi.fn(async () => {
      throw new Error('not asked here');
    }) as unknown as StudioBaseCustomization['ensurePackage'],
    marks: { status: 'off' },
  };
}

beforeEach(() => {
  srv.views.clear();
  srv.shellObjects = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openForm(props: { readOnly?: boolean; customization?: StudioBaseCustomization } = {}) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <DataPillar packageId={PKG} {...props} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
  await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
  await screen.findByRole('button', { name: 'Layout', pressed: true });
}

/** The headings the canvas draws for its declared sections. */
const sectionTitles = () => screen.queryAllByRole('textbox', { name: SECTION_NAME }).map((el) => (el as HTMLInputElement).value);
const chip = () => screen.getByTestId('form-layout-source-chip');

type SaveCall = [string, string, Record<string, unknown>, { packageId?: string; mode?: string }];
const saves = () => mockClient.save.mock.calls as unknown as SaveCall[];

describe('the Form tab lays out the form the app opens (objectstack#30057)', () => {
  it('a default form view: its sections are the canvas, and Add group saves the view draft', async () => {
    serveObject([defaultViewItem()]);
    await openForm();

    await waitFor(() => expect(sectionTitles()).toEqual(['Basic info', 'Money details']));
    expect(chip()).toHaveAttribute('data-source', 'form-view');
    expect(chip()).toHaveAttribute('data-view', `${OBJECT}.form`);
    // `notes` is in no section: it is not on the form, and the canvas says so.
    expect(screen.getByText(OFF_FORM)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Designer group')).toBeNull();
    // One layout: New and Edit open the same view, so there is nothing to pick.
    expect(screen.queryByTestId('form-layout-flow')).toBeNull();

    await userEvent.click(screen.getByTestId('form-designer-add-section-footer'));
    await waitFor(() => expect(saves().length).toBe(1), { timeout: 4000 });
    const [type, name, body, opts] = saves()[0];
    expect([type, name, opts.mode, opts.packageId]).toEqual(['view', `${OBJECT}.form`, 'draft', PKG]);
    const sections = (body.config as { sections: unknown[] }).sections;
    expect(sections).toEqual([
      ...defaultViewItem().config.sections,
      { name: 'new_group', label: NEW_GROUP, fields: [] },
    ]);
    expect(body).toMatchObject({ name: `${OBJECT}.form`, object: OBJECT, viewKind: 'form', isDefault: true });
    expect(saves().some(([ty]) => ty === 'object')).toBe(false);
  });

  it('CONTROL: no form view: the field groups are the canvas, and Add group saves fieldGroups', async () => {
    serveObject([]);
    await openForm();

    await waitFor(() => expect(sectionTitles()).toEqual(['Designer group']));
    expect(chip()).toHaveAttribute('data-source', 'field-groups');
    expect(screen.getByText(UNGROUPED)).toBeInTheDocument();
    expect(screen.queryByText(OFF_FORM)).toBeNull();

    await userEvent.click(screen.getByTestId('form-designer-add-section-footer'));
    await waitFor(() => expect(saves().length).toBe(1), { timeout: 4000 });
    const [type, name, body] = saves()[0];
    expect([type, name]).toEqual(['object', OBJECT]);
    expect(body.fieldGroups).toEqual([
      { key: 'designer', label: 'Designer group' },
      { key: 'new_group', label: NEW_GROUP },
    ]);
    expect(saves().some(([ty]) => ty === 'view')).toBe(false);
  });

  it('a create form view beside the default one: New and Edit pick which one the canvas shows', async () => {
    serveObject([defaultViewItem(), createViewItem()]);
    await openForm();

    const flow = within(await screen.findByTestId('form-layout-flow'));
    expect(flow.getByRole('button', { name: NEW, pressed: true })).toBeInTheDocument();
    await waitFor(() => expect(sectionTitles()).toEqual(['Quick create']));
    expect(chip()).toHaveAttribute('data-view', `${OBJECT}.create`);

    await userEvent.click(flow.getByRole('button', { name: EDIT }));
    expect(flow.getByRole('button', { name: EDIT, pressed: true })).toBeInTheDocument();
    await waitFor(() => expect(sectionTitles()).toEqual(['Basic info', 'Money details']));
    expect(chip()).toHaveAttribute('data-view', `${OBJECT}.form`);
  });

  it('Preview lays the form out by the same form view', async () => {
    serveObject([defaultViewItem()]);
    await openForm();
    await waitFor(() => expect(sectionTitles()).toEqual(['Basic info', 'Money details']));

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const frame = within(await screen.findByTestId('data-form-preview-frame'));
    expect(await frame.findByText('Basic info')).toBeInTheDocument();
    expect(frame.getByText('Money details')).toBeInTheDocument();
    expect(frame.queryByText('Designer group')).toBeNull();
    // `notes` is on no section of the view, so the dialog does not show it.
    expect(frame.queryByText('Notes')).toBeNull();
  });

  it('a read-only base: the edit is saved into the pair, declaring the override of the base view', async () => {
    serveObject([defaultViewItem()]);
    const customization = customizationOf();
    await openForm({ readOnly: true, customization });

    await waitFor(() => expect(sectionTitles()).toEqual(['Basic info', 'Money details']));
    await userEvent.click(screen.getByTestId('form-designer-add-section-footer'));
    await waitFor(() => expect(saves().length).toBe(1), { timeout: 4000 });
    const [type, name, body, opts] = saves()[0];
    expect([type, name, opts.packageId]).toEqual(['view', `${OBJECT}.form`, PAIR]);
    expect(body.overrides).toEqual({ package: PKG, basedOn: '1.2.0' });
    expect((body.config as { sections: unknown[] }).sections).toHaveLength(3);
    expect(customization.ensure).toHaveBeenCalledTimes(1);
    expect(saves().some(([ty]) => ty === 'object' || ty === 'object_extension')).toBe(false);
  });
});
