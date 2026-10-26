/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12194 — the record form page's breadcrumb draws the lifecycle badge
 * (`ManagedByBadge`) for an authoring caller only.
 *
 * Triage ruled the badge an authoring aid (option a). On the form it could look
 * like the end user's explanation for read-only fields, but that sentence is
 * the form's own: `ObjectForm` draws `ClosedAffordanceNotice` (objectui#11000)
 * from the same verdict that locks the fields, and it never reads the badge.
 * So the form follows the rule the record page does
 * (`RecordDetailView.managedByBadgeAuthoring-12194`).
 *
 * Measured from a real `RecordFormPage` mount (the
 * `RecordFormPage.listLinkPlural-11733` harness; the form itself is a stand-in,
 * since the badge sits in the page header outside it) under the real
 * `MePermissionsProvider`, fed the `/me/permissions` answer the case names.
 * Every absence is read after the page title has painted, and the authoring
 * case draws the badge in the same harness.
 *
 * Direction, written before the run: with the gate taken out of
 * `ManagedByBadge`, the end-user case goes RED and the others stay GREEN.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { RecordFormPage } from './RecordFormPage';

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

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

// Stand-in for the real form: the badge is drawn in the page header, outside it.
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="form-stand-in" />,
}));

const OBJECTS = [
  { name: 'auth_user_12194', label: 'User', managedBy: 'better-auth', fields: { name: { type: 'text' } } },
  { name: 'plain_note_12194', label: 'Note', fields: { name: { type: 'text' } } },
];

vi.mock('../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: OBJECTS, loading: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({
  useAdapter: () => null,
}));

/** A `/me/permissions` answer holding exactly `held`. */
function answer(held: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: [],
    systemPermissions: held,
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
}

/** An end user: the server reported the set, and it lacks `manage_metadata`. */
const END_USER = answer(['setup.access']);
/** An authoring caller. */
const AUTHOR = answer(['manage_metadata']);

afterEach(cleanup);

/**
 * Mount the edit form page for `objectName` under `perms`, wait for its title
 * to read `title`, and return the bucket of every badge on the page.
 */
async function badgeBuckets(objectName: string, title: string, perms: MePermissionsResponse) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  render(
    <I18nProvider instance={i18n}>
      <MePermissionsProvider initialPermissions={perms}>
        <MemoryRouter initialEntries={[`/apps/demo/${objectName}/record/r1/edit`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/record/:recordId/edit"
              element={<RecordFormPage mode="edit" />}
            />
          </Routes>
        </MemoryRouter>
      </MePermissionsProvider>
    </I18nProvider>,
  );
  expect((await screen.findByTestId('record-form-page-title')).textContent).toBe(title);
  expect(screen.getByTestId('form-stand-in')).toBeTruthy();
  return Array.from(document.querySelectorAll('[data-testid="managed-by-badge"]')).map((b) =>
    b.getAttribute('data-bucket'),
  );
}

describe('RecordFormPage — the header’s lifecycle badge is an authoring aid (objectui#12194)', () => {
  it('an end user editing a better-auth record sees no badge', async () => {
    expect(await badgeBuckets('auth_user_12194', 'Edit User', END_USER)).toEqual([]);
  });

  it('an authoring caller on the same form sees the badge, naming its bucket', async () => {
    expect(await badgeBuckets('auth_user_12194', 'Edit User', AUTHOR)).toEqual(['better-auth']);
  });

  it('CONTROL — an object with no managedBy draws no badge, for an authoring caller or an end user', async () => {
    expect(await badgeBuckets('plain_note_12194', 'Edit Note', AUTHOR)).toEqual([]);
    cleanup();
    expect(await badgeBuckets('plain_note_12194', 'Edit Note', END_USER)).toEqual([]);
  });
});
