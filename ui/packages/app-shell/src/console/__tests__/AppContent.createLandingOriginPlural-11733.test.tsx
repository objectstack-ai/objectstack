/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11733 — after a create from the list lands on the new record's
 * page, the record page's way back names the list with the object's PLURAL
 * label.
 *
 * The console's create flow (objectstack#2604) takes a page-surface object's
 * new record to its detail route and hands that route the list it came from as
 * history state (`from: { pathname, label }`), which the record page draws as
 * its back link. The origin is the object's list, but the label was the
 * singular, `objectLabel`; it is now `objectPluralLabel`, as `ObjectView`'s own
 * row navigation names the same way back.
 *
 * Measured from a real `AppContent` mount inside a real i18next instance
 * booted in the language under test (the `AppContent.declaredVisibilityKeys`
 * harness): the global record-form modal is a stand-in whose `onSuccess` is
 * called with a saved id, and the record route's page is a probe that shows
 * the state it received. The object carries enough fields to derive the PAGE
 * surface (`RECORD_SURFACE_PAGE_THRESHOLD`), which is the branch that hands
 * over the label. The `zh-CN` plural differs from the `zh-CN` label on purpose;
 * the no-plural object is the control.
 *
 * Direction, written before the run: with the origin put back to
 * `objectLabel`, the two plural cells RED (`Project` / `项目`); the control
 * GREEN on both sides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { RECORD_SURFACE_PAGE_THRESHOLD } from '@object-ui/plugin-view';

/** The part of the modal's schema this file reads. */
interface ModalSchemaProbe {
  objectName?: string;
  onSuccess: (saved: { id: string }) => Promise<void> | void;
}
const { modalSchemas } = vi.hoisted(() => ({ modalSchemas: [] as ModalSchemaProbe[] }));

/** The global record-form modal: its schema carries the `onSuccess` under test. */
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ModalForm: ({ schema }: { schema: ModalSchemaProbe }) => {
    modalSchemas.push(schema);
    return <div data-testid="modal-form" />;
  },
}));

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="console-layout">{children}</div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({ ObjectView: () => <div data-testid="object-view" /> }));

/** The record route's page: shows the way-back label it was handed. */
vi.mock('../../views/RecordDetailView', async () => {
  const { useLocation: useLoc } = await import('react-router-dom');
  return {
    RecordDetailView: () => {
      const state = useLoc().state as { from?: { label?: string } } | null;
      return <div data-testid="origin-label">{state?.from?.label ?? '(none)'}</div>;
    },
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

/** Enough plain fields to derive the PAGE record surface. */
const PAGE_FIELDS = Object.fromEntries(
  Array.from({ length: RECORD_SURFACE_PAGE_THRESHOLD + 1 }, (_, i) => [`f${i}`, { type: 'text', label: `F${i}` }]),
);

const OBJECTS = [
  { name: 'showcase_project', label: 'Project', pluralLabel: 'Projects', fields: PAGE_FIELDS },
  { name: 'showcase_note', label: 'Note', fields: PAGE_FIELDS },
];

const APPS = [{ name: 'crm', label: 'CRM', isDefault: true, navigation: [] }];

// One value for the whole run: the record route's effects key on these
// members, and a fresh value per render would re-run them without end.
const METADATA = {
  apps: APPS,
  objects: OBJECTS,
  loading: false,
  ensureType: undefined,
  error: null,
  refresh: async () => {},
};
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => METADATA,
}));

const ACTION_RUNNER = { execute: () => {}, runner: { registerHandler: () => {}, getContext: () => ({}) } };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ACTION_RUNNER,
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';

type Lang = 'en' | 'zh-CN';

/** The catalog as the console loads it: `zh-CN` translates both scalars. */
const BUNDLE: Record<Lang, Record<string, unknown>> = {
  en: {},
  'zh-CN': { showcase: { objects: { showcase_project: { label: '项目', pluralLabel: '项目清单' } } } },
};

beforeEach(() => {
  modalSchemas.length = 0;
});
afterEach(cleanup);

/** Create a record of `objectName` from its list; the way-back label its page receives. */
async function originAfterCreate(lang: Lang, objectName: string): Promise<string> {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
  render(
    <I18nProvider instance={i18n}>
      <MemoryRouter initialEntries={[`/apps/crm/${objectName}?form=new`]}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
  await waitFor(() => expect(modalSchemas.length).toBeGreaterThan(0));
  const schema = modalSchemas[modalSchemas.length - 1];
  expect(schema.objectName).toBe(objectName);
  // Not inside `act`: under React 19 an awaited `act` here did not return
  // before the test timeout (measured while writing this file), while the
  // save itself settles at once. The record route is awaited below instead;
  // `findByTestId` polls inside `act` on its own.
  await schema.onSuccess({ id: 'r9' });
  return (await screen.findByTestId('origin-label', undefined, { timeout: 5000 })).textContent ?? '';
}

describe('AppContent — a create that lands on the record page names the way back with the plural (objectui#11733)', () => {
  it('en: "Projects"', async () => {
    expect(await originAfterCreate('en', 'showcase_project')).toBe('Projects');
  });

  it('zh-CN: the translated plural', async () => {
    expect(await originAfterCreate('zh-CN', 'showcase_project')).toBe('项目清单');
  });

  it('control: an object that declares no plural is named by its label', async () => {
    expect(await originAfterCreate('en', 'showcase_note')).toBe('Note');
  });
});
