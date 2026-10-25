/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13083 — an object field whose `visibleWhen` names
 * `current_user.hasCapability(NAME)` is answered on the record form page.
 *
 * objectui#13006 bound the viewer's `systemPermissions` into the
 * `ExpressionProvider` scope, so page nodes answer `hasCapability`. This page
 * builds its field-list evaluator by hand (it sits ABOVE the provider it
 * mounts), and that hand-built evaluator passed `permissions` but not
 * `systemPermissions`. The engine then refused every `hasCapability` call on a
 * field, and the field gate fails OPEN on a fault: the field rendered for a
 * holder AND a non-holder, with a diagnostic.
 *
 * Everything on the path is real except the leaves the sibling suite
 * (`RecordFormPage.predicateScope.test.tsx`) also stubs: `MePermissionsProvider`
 * holds a real payload, `useExpressionSystemPermissions()` reads it, and the
 * page's own evaluator filters `objectDef.fields` into the `schema.fields`
 * handed to `ObjectForm`, which is what these tests read.
 *
 * Reverse verification (direction predicted before running): drop the
 * `systemPermissions` hand-off in `RecordFormPage`, and the NON-HOLDER arm goes
 * red (the field is shown by the fail-open fault), and the HOLDER arm goes red
 * through its silence assertion (shown, but reported). The NOT-LOADED control
 * stays green either way: it is the fault this binding must not mask.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
// The reporter's dedupe `Set` is module state: reset it so every arm's
// "nothing reported" is a reading, not a leftover from an earlier arm.
import { __resetVisibilityPredicateWarnings } from '../../../react/src/utils/visibilityDiagnostic';
import { RecordFormPage } from './RecordFormPage';

const h = React.createElement;

const { formSchemas, authState } = vi.hoisted(() => ({
  formSchemas: [] as Array<{ fields: string[] }>,
  authState: { user: null as Record<string, unknown> | null },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    get user() { return authState.user; },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: { fields: string[] } }) => {
    formSchemas.push(schema);
    return h('div', { 'data-testid': 'object-form' });
  },
}));

const metadataState = { objects: [] as unknown[], loading: false };
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => metadataState }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => null }));

const cel = (source: string) => ({ dialect: 'cel', source });
const PREDICATE = "current_user.hasCapability('manage_org_users')";

const ORG = {
  name: 'org_member',
  label: 'Members',
  fields: {
    name: { type: 'text' },
    roster_note: { type: 'text', visibleWhen: cel(PREDICATE) },
  },
};

const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user', positions: ['everyone'] };

function payload(systemPermissions: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    roles: [],
    permissionSets: ['member'],
    systemPermissions,
    objects: { org_member: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
    fields: {},
  };
}

function page() {
  return h(I18nProvider, {
    config: { defaultLanguage: 'en', detectBrowserLanguage: false },
    children: h(
      MemoryRouter,
      { initialEntries: ['/apps/crm/org_member/new'] },
      h(Routes, null, h(Route, {
        path: '/apps/:appName/:objectName/new',
        element: h(RecordFormPage, { mode: 'create' }),
      })),
    ),
  });
}

const withPermissions = (caps: string[]) =>
  h(MePermissionsProvider, { initialPermissions: payload(caps), children: page() });

const lastFields = (): string[] => formSchemas[formSchemas.length - 1].fields;

let warnings: string[];
beforeEach(() => {
  warnings = [];
  __resetVisibilityPredicateWarnings();
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warnings.push(a.join(' ')));
  metadataState.objects = [ORG];
  authState.user = USER;
  formSchemas.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('record form page: a field gated on current_user.hasCapability (objectui#13083)', () => {
  it('HOLDER: shown, with nothing reported', async () => {
    render(withPermissions(['setup.access', 'manage_org_users']));
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).toContain('name');
    expect(lastFields()).toContain('roster_note');
    expect(warnings.filter((w) => w.includes('hasCapability'))).toEqual([]);
  });

  it('NON-HOLDER: hidden, with nothing reported — a verdict, not a fault', async () => {
    render(withPermissions(['setup.access']));
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    // Control: the filter still lets the ungated field by.
    expect(lastFields()).toContain('name');
    expect(lastFields()).not.toContain('roster_note');
    expect(warnings.filter((w) => w.includes('hasCapability'))).toEqual([]);
  });

  it('CONTROL — NOT LOADED: the predicate still FAULTS loudly, never a silent answer', async () => {
    render(page());
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    // The field gate is fail-open on a fault (the shipped field policy), so the
    // field is shown — and the fault is reported naming the predicate. A
    // silent `false` would have hidden it with nothing said.
    expect(lastFields()).toContain('roster_note');
    expect(warnings.some((w) => w.includes(PREDICATE))).toBe(true);
  });
});
