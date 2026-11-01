/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28472 — the record page's Delete confirmation names the objects
 * the delete cascades into, from the served `cascadeDeleteObjects`, by label.
 *
 * The page's `objectDef` is the list read's entry, which never serves the key,
 * so the page reads the by-name schema the adapter carries it on
 * (`dataSource.getObjectSchema`); the data source here answers exactly what
 * the adapter would. The REAL `ActionConfirmDialog` opens, and its body is
 * read. Strings are read from the packs by KEY.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { builtInLocales } from '@object-ui/i18n/locales';
import { attachCascadeDeleteObjects } from '@object-ui/core';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_lead';
const RECORD_ID = 'rec-lead-1';

type Pack = {
  detail: { delete: string; moreActions: string };
  objectActions: { deleteConfirm: string; deleteCascade: string };
};
const EN = builtInLocales.en as unknown as Pack;
const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k]);

const LEAD = {
  name: OBJECT_NAME,
  label: 'Lead',
  managedBy: 'platform',
  fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
};
const CAMPAIGN_MEMBER = {
  name: 'crm_campaign_member',
  label: 'Campaign Member',
  managedBy: 'platform',
  fields: { name: { type: 'text', label: 'Name' } },
};
const OBJECTS = [LEAD, CAMPAIGN_MEMBER];

const METADATA = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;

/** A data source whose by-name schema read answers `served`, as the adapter would. */
function makeDataSource(served: unknown) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Ada' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) =>
      name === OBJECT_NAME ? attachCascadeDeleteObjects(structuredClone(LEAD), served) : null,
    ),
  } as any;
}

async function openDeleteConfirm(served: unknown): Promise<HTMLElement> {
  const dataSource = makeDataSource(served);
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/apps/crm/${OBJECT_NAME}/${RECORD_ID}`]}>
        <MetadataCtx.Provider value={METADATA}>
          <RecordDetailView
            dataSource={dataSource}
            objects={OBJECTS}
            onEdit={() => {}}
            objectNameOverride={OBJECT_NAME}
            recordIdOverride={RECORD_ID}
          />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector('[role="toolbar"]')).toBeTruthy());
  const trigger = screen.getByRole('button', { name: EN.detail.moreActions });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  const item = screen
    .getAllByRole('menuitem')
    .find((el) => (el.textContent ?? '').trim() === EN.detail.delete);
  expect(item).toBeTruthy();
  fireEvent.click(item!);
  const dialog = await screen.findByRole('alertdialog');
  expect(dataSource.delete).not.toHaveBeenCalled();
  return dialog;
}

/** The dialog body: the description under the title. */
function body(dialog: HTMLElement): string {
  const heading = within(dialog).getByRole('heading');
  const description = heading.parentElement?.querySelector('p');
  return (description?.textContent ?? '').trim();
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('record page Delete names the cascade objects (objectstack#28472)', () => {
  it('a served list of one object adds one line naming its label', async () => {
    const dialog = await openDeleteConfirm(['crm_campaign_member']);
    expect(body(dialog)).toBe(
      `${EN.objectActions.deleteConfirm} ${fill(EN.objectActions.deleteCascade, { objects: 'Campaign Member' })}`,
    );
  });

  it('a served empty list adds nothing', async () => {
    const dialog = await openDeleteConfirm([]);
    expect(body(dialog)).toBe(EN.objectActions.deleteConfirm);
  });

  it('no served list adds nothing and keeps today\'s text', async () => {
    const dialog = await openDeleteConfirm(undefined);
    expect(body(dialog)).toBe(EN.objectActions.deleteConfirm);
  });
});
