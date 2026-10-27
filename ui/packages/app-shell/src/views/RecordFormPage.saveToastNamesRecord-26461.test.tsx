/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26461 — the full-page record form (`/new` and
 * `/edit`) names the saved record in its success toast, the same way the
 * dialog paths do since objectstack-ai/objectstack#26172
 * (`ux-conventions.write-feedback`): `Task "Quarterly review" created`, by its
 * ADR-0079 display name. A record with nothing nameable (the resolver's
 * `Record #<id>` floor, or no saved record at all) keeps the object-label
 * toast (`Task created successfully`).
 *
 * The form is a stand-in whose button calls `onSuccess` with the saved record,
 * as `ObjectForm` does after its write (`schema.onSuccess(result)`); the toast
 * is read off sonner's `toast.success`.
 *
 * Direction, written before the run: with the page's toast still the object
 * label alone, every "names the record" cell RED (`Task created
 * successfully`); every "no name" cell GREEN on both sides.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { RecordFormPage } from './RecordFormPage';

const h = React.createElement;

const { toastSuccess, saveState } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  saveState: { saved: undefined as Record<string, unknown> | undefined },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
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

// Stand-in for the real form: a button that calls `onSuccess` with the saved
// record, as `ObjectForm` hands its write's result to `schema.onSuccess`.
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: { onSuccess?: (saved?: unknown) => void } }) =>
    h(
      'button',
      {
        type: 'button',
        'data-testid': 'fire-success',
        onClick: () => schema.onSuccess?.(saveState.saved),
      },
      'ok',
    ),
}));

/** Declares its name field: a saved task is named by `subject`. */
const TASK = {
  name: 'showcase_task',
  label: 'Task',
  nameField: 'subject',
  fields: { subject: { type: 'text', label: 'Subject' }, done: { type: 'boolean', label: 'Done' } },
};
const METADATA = { objects: [TASK], loading: false };
vi.mock('../providers/MetadataProvider', () => ({
  useMetadata: () => METADATA,
}));
vi.mock('../providers/AdapterProvider', () => ({
  useAdapter: () => null,
}));

beforeEach(() => {
  toastSuccess.mockClear();
  saveState.saved = undefined;
});
afterEach(cleanup);

/** Mount the page in `mode`, save `saved` through the form, and return the toast it raised. */
async function saveOn(
  mode: 'create' | 'edit',
  saved: Record<string, unknown> | undefined,
  language = 'en',
): Promise<string> {
  saveState.saved = saved;
  const path =
    mode === 'create' ? '/apps/crm/showcase_task/new' : '/apps/crm/showcase_task/record/t1/edit';
  const route =
    mode === 'create'
      ? '/apps/:appName/:objectName/new'
      : '/apps/:appName/:objectName/record/:recordId/edit';
  render(
    h(I18nProvider, {
      config: { defaultLanguage: language, detectBrowserLanguage: false },
      children: h(
        MemoryRouter,
        { initialEntries: [path] },
        h(Routes, null, h(Route, { path: route, element: h(RecordFormPage, { mode }) })),
      ),
    }),
  );
  fireEvent.click(screen.getByTestId('fire-success'));
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
  return String(toastSuccess.mock.calls[0][0]);
}

describe('RecordFormPage — the save toast names the saved record (objectstack-ai/objectstack#26461)', () => {
  it('create: names the record by its declared name field', async () => {
    expect(await saveOn('create', { id: 't1', subject: 'Quarterly review' })).toBe(
      'Task "Quarterly review" created',
    );
  });

  it('update: names the record by its declared name field', async () => {
    expect(await saveOn('edit', { id: 't1', subject: 'Quarterly review' })).toBe(
      'Task "Quarterly review" updated',
    );
  });

  it('create, no name (the `Record #<id>` floor): the object-label toast', async () => {
    expect(await saveOn('create', { id: 't2', done: false })).toBe('Task created successfully');
  });

  it('update, no name (the `Record #<id>` floor): the object-label toast', async () => {
    expect(await saveOn('edit', { id: 't1', done: true })).toBe('Task updated successfully');
  });

  it('update, no saved record handed back: the object-label toast', async () => {
    expect(await saveOn('edit', undefined)).toBe('Task updated successfully');
  });

  it('zh: the pack string names the record', async () => {
    expect(await saveOn('edit', { id: 't1', subject: '季度复盘' }, 'zh')).toBe('Task“季度复盘”已更新');
  });
});
