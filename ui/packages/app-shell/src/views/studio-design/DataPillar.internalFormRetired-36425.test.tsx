// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36425 — the Data pillar's Form tab lays out what the app's New
 * and Edit dialogs draw: the object's field groups. An internal form view the
 * object still declares is no longer loaded by those dialogs, so the designer
 * never shows its sections and never saves a layout edit into it.
 *
 * Replaces the #30057 / #30859 / #32610 cases, which pinned the form-view
 * designer this card retires.
 *
 * The REAL `DataPillar`, `ObjectFormDesigner` and Preview `ObjectForm`, over a
 * metadata client double; the shell's merged objects (`useMetadata().objects`)
 * are served here. The records grid is stubbed.
 *
 * Pinned:
 *  - an object with a default internal form view: the field groups are the
 *    canvas, the chip says so, Add group saves the object's `fieldGroups` and
 *    writes no view; Preview shows the field groups, not the view's sections;
 *  - CONTROL: no form view: the same canvas and the same save.
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
  /**
   * objectstack#30859 — pending view drafts by name: `served` is what the
   * `?state=draft` read answers (translated for the console's locale), `stored`
   * the layered read's `draft` layer (as the author wrote it; absent: unserved).
   */
  drafts: new Map<string, { served: Record<string, unknown>; stored?: Record<string, unknown> }>(),
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
    const stored = type === 'view' ? srv.drafts.get(name)?.stored : undefined;
    return row ? { effective: row, code: row, ...(stored ? { draft: stored } : {}) } : null;
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    const pending = type === 'view' ? srv.drafts.get(name) : undefined;
    return pending ? { item: pending.served, version: 'v7' } : null;
  }),
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

// The console's preview and authoring code loads `@objectstack/lint` lazily;
// warmed here so its first load is paid at import, not inside a test's clock.
import '@objectstack/lint';
import { DataPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

const FORM = t('engine.studio.data.tab.form', 'en');
const SECTION_NAME = t('engine.studio.designer.group.nameLabel', 'en');
const UNGROUPED = t('engine.studio.designer.ungrouped', 'en');
const NEW_GROUP = t('engine.studio.designer.newGroup', 'en');

beforeEach(() => {
  srv.views.clear();
  srv.drafts.clear();
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
describe('the Form tab lays out by field groups, internal form or not (objectstack#36425)', () => {
  it('an object with an internal form view: the field groups are the canvas, and Add group saves fieldGroups', async () => {
    serveObject([defaultViewItem()]);
    await openForm();

    await waitFor(() => expect(sectionTitles()).toEqual(['Designer group']));
    expect(chip()).toHaveAttribute('data-source', 'field-groups');
    expect(screen.queryByDisplayValue('Basic info')).toBeNull();
    expect(screen.queryByTestId('form-layout-flow')).toBeNull();

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

  it('Preview of an object with an internal form view shows the field groups, not the view sections', async () => {
    serveObject([defaultViewItem()]);
    await openForm();
    await waitFor(() => expect(sectionTitles()).toEqual(['Designer group']));

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const previewFrame = await screen.findByTestId('data-form-preview-frame');
    await waitFor(() => expect(previewFrame.querySelector('form')).not.toBeNull());
    const frame = within(previewFrame.querySelector('form') as HTMLElement);
    expect(await frame.findByText('Designer group')).toBeInTheDocument();
    expect(frame.queryByText('Basic info')).toBeNull();
    expect(frame.queryByText('Money details')).toBeNull();
  });

  it('CONTROL: no form view: the field groups are the canvas, and Add group saves fieldGroups', async () => {
    serveObject([]);
    await openForm();

    await waitFor(() => expect(sectionTitles()).toEqual(['Designer group']));
    expect(chip()).toHaveAttribute('data-source', 'field-groups');
    expect(screen.getByText(UNGROUPED)).toBeInTheDocument();

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
});
