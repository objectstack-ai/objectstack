/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6493 — the field-visibility gate on the record form page binds the
 * roots this tier declares.
 *
 * This is the call site, not the seam: the page filters `objectDef.fields` by
 * their declared visibility keys and hands the surviving names to `ObjectForm`
 * as `schema.fields`, which is what these tests read.
 *
 * ⚠️ FIXTURE SPELLING, objectui#6514. These gates were authored on `visible`
 * when this file was written, because that was the key the page then read.
 * `FieldSchema` refuses that spelling, and objectui#6514 moved the call site
 * onto the declared `visibleWhen` (and the static `hidden`). The carrier key is
 * all that changed here: every predicate text, every user fixture and every
 * assertion below is objectui#6493's, unweakened. What this file measures is
 * which ROOTS the evaluator binds — `current_user` / `ctx.user` / `os.user` /
 * `features` — and that is independent of which key carries the predicate.
 *
 * The evaluator used to be a private `new ExpressionEvaluator({ user, app,
 * data })` built beside — not from — the `ExpressionProvider` this same page
 * mounts around the form. `current_user`, `ctx.user`, `os.user` and `features`
 * were unbound in it, and an unbound root fails OPEN, so every gate below
 * rendered its field for everyone. Each `not.toContain` here was `toContain`
 * before the fix.
 *
 * Note what is NOT being tested: the error path. A CEL predicate over an
 * unbound root never reaches `evaluateVisibility`'s `catch` — `evalFieldPredicate`
 * fails soft to `true` on its own — so binding the roots and fail-open-on-throw
 * are independent, and the latter is deliberately unchanged (#6443 / #6487).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { RecordFormPage } from './RecordFormPage';

const h = React.createElement;

const { formSchemas, getAuthConfig, authState } = vi.hoisted(() => ({
  formSchemas: [] as any[],
  getAuthConfig: vi.fn(async () => ({ features: {} as Record<string, unknown> })),
  authState: {
    user: null as Record<string, unknown> | null,
    activeOrganization: null as { name: string } | null,
  },
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
    getAuthConfig,
    get activeOrganization() { return authState.activeOrganization; },
  }),
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: any) => {
    formSchemas.push(schema);
    return h('div', { 'data-testid': 'object-form' });
  },
}));

const metadataState = { objects: [] as any[], loading: false };
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => metadataState }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => null }));

/** The served shape: `ExpressionInputSchema` normalises authored strings into this. */
const cel = (source: string) => ({ dialect: 'cel', source });

const CONTACTS = {
  name: 'contacts',
  label: 'Contacts',
  fields: {
    name: { type: 'text' },
    commission: { type: 'currency', visibleWhen: cel("'sales_manager' in current_user.positions") },
    escalate_to: { type: 'text', visibleWhen: cel("'sales_manager' in ctx.user.positions") },
    owner_note: { type: 'text', visibleWhen: cel("'sales_manager' in os.user.positions") },
    org_switcher: { type: 'text', visibleWhen: cel('features.multiOrgEnabled == true') },
  },
};

const MANAGER = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user', positions: ['sales_manager'] };
const CLERK = { id: 'u2', name: 'Bo', email: 'bo@example.com', role: 'user', positions: ['sales_clerk'] };

function renderPage() {
  return render(
    h(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      children: h(
        MemoryRouter,
        { initialEntries: ['/apps/crm/contacts/new'] },
        h(Routes, null, h(Route, {
          path: '/apps/:appName/:objectName/new',
          element: h(RecordFormPage, { mode: 'create' }),
        })),
      ),
    }),
  );
}

/**
 * The field list from the LAST schema handed to `ObjectForm`. `features` is
 * fetched, so the first render is always the pre-fetch one — reading anything
 * but the last schema would assert against an empty `features` bag and pass for
 * the wrong reason.
 */
const lastFields = (): string[] => formSchemas[formSchemas.length - 1].fields;

beforeEach(() => {
  metadataState.objects = [CONTACTS];
  metadataState.loading = false;
  authState.user = CLERK;
  authState.activeOrganization = null;
  getAuthConfig.mockResolvedValue({ features: {} });
  formSchemas.length = 0;
});
afterEach(cleanup);

describe('objectui#6493 — a current_user field gate hides the field on the record form page', () => {
  it('withholds the gated field from a user the rule excludes', async () => {
    authState.user = CLERK;
    renderPage();

    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    // Ungated fields are unaffected — the filter still lets everything else by.
    expect(lastFields()).toContain('name');
    // Was `toContain` before the fix: `current_user` was not in the bag, the
    // predicate faulted, and the fault read as "visible".
    expect(lastFields()).not.toContain('commission');
  });

  it('grants it to a user the rule admits', async () => {
    authState.user = MANAGER;
    renderPage();

    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).toContain('commission');
  });

  it('honours the ctx.user and os.user spellings of the same object (ADR-0068 D1)', async () => {
    authState.user = CLERK;
    renderPage();

    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).not.toContain('escalate_to');
    expect(lastFields()).not.toContain('owner_note');

    cleanup();
    formSchemas.length = 0;
    authState.user = MANAGER;
    renderPage();

    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).toContain('escalate_to');
    expect(lastFields()).toContain('owner_note');
  });
});

describe('objectui#6493 — a features field gate is live on the record form page', () => {
  it('hides the field when the deployment flag is off', async () => {
    getAuthConfig.mockResolvedValue({ features: { multiOrgEnabled: false } });
    renderPage();

    // Wait for the flag to land, not merely for a render: before it resolves
    // `features` is `{}` and the predicate faults open, which is the same
    // answer the defect gave.
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    await waitFor(() => expect(lastFields()).not.toContain('org_switcher'));
  });

  it('shows the field when the deployment flag is on', async () => {
    getAuthConfig.mockResolvedValue({ features: { multiOrgEnabled: true } });
    renderPage();

    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    await waitFor(() => expect(lastFields()).toContain('org_switcher'));
  });
});
