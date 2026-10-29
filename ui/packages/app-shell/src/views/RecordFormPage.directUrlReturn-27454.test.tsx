/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27454 — a full-page record form entered by
 * direct URL (pasted, new tab, deep link) returns INSIDE the app after save or
 * cancel, by the same route in-app entry takes when nothing is behind it: the
 * record detail (edit) or the object list (create). The tab's own history is
 * longer than the console's (`window.history.length` counts entries from
 * before the document), so it is simulated here as 3 on every cell.
 *
 * Direction, written before the run: with `goBack` still keyed on
 * `window.history.length > 1`, every direct-URL cell RED (it goes Back, which
 * leaves the form where it is in a one-entry memory router); every in-app cell
 * GREEN on both sides.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { RecordFormPage } from './RecordFormPage';

const h = React.createElement;

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

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

// Stand-in for the real form: one button per exit, as `ObjectForm` calls
// `schema.onSuccess(result)` after its write and `schema.onCancel()` on Cancel.
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: { onSuccess?: (s?: unknown) => void; onCancel?: () => void } }) =>
    h(
      'div',
      null,
      h('button', { type: 'button', 'data-testid': 'fire-success', onClick: () => schema.onSuccess?.({ id: 't1', subject: 'Quarterly review' }) }, 'ok'),
      h('button', { type: 'button', 'data-testid': 'fire-cancel', onClick: () => schema.onCancel?.() }, 'cancel'),
    ),
}));

const TASK = {
  name: 'showcase_task',
  label: 'Task',
  nameField: 'subject',
  fields: { subject: { type: 'text', label: 'Subject' } },
};
const METADATA = { objects: [TASK], loading: false };
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => METADATA }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => null }));

function Where() {
  return h('div', { 'data-testid': 'where' }, useLocation().pathname);
}

const LIST = '/apps/crm/showcase_task';
const DETAIL = '/apps/crm/showcase_task/record/t1';
const VIEW = '/apps/crm/showcase_task/view/open';

beforeEach(() => {
  toastSuccess.mockClear();
  // The tab had history before the console loaded.
  vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Mount the form behind `before` (none = direct URL), fire `exit`, return where it lands. */
function exitFrom(mode: 'create' | 'edit', exit: 'success' | 'cancel', before?: string): string {
  const form = mode === 'create' ? `${LIST}/new` : `${DETAIL}/edit`;
  const entries = before ? [before, form] : [form];
  render(
    h(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      children: h(
        MemoryRouter,
        { initialEntries: entries, initialIndex: entries.length - 1 },
        h(
          Routes,
          null,
          h(Route, { path: '/apps/:appName/:objectName/new', element: h(RecordFormPage, { mode: 'create' }) }),
          h(Route, { path: '/apps/:appName/:objectName/record/:recordId/edit', element: h(RecordFormPage, { mode: 'edit' }) }),
          h(Route, { path: '*', element: h(Where) }),
        ),
      ),
    }),
  );
  fireEvent.click(screen.getByTestId(exit === 'success' ? 'fire-success' : 'fire-cancel'));
  return screen.getByTestId('where').textContent ?? '';
}

describe('RecordFormPage — direct-URL entry returns inside the app (objectstack-ai/objectstack#27454)', () => {
  it('edit, direct URL: saves, toasts, lands on the record detail', () => {
    expect(exitFrom('edit', 'success')).toBe(DETAIL);
    expect(toastSuccess).toHaveBeenCalledWith('Task "Quarterly review" updated');
  });

  it('create, direct URL: saves, toasts, lands on the object list', () => {
    expect(exitFrom('create', 'success')).toBe(LIST);
    expect(toastSuccess).toHaveBeenCalledWith('Task "Quarterly review" created');
  });

  it('edit, direct URL: cancel lands on the record detail, no toast', () => {
    expect(exitFrom('edit', 'cancel')).toBe(DETAIL);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('edit, in-app entry: save goes back to the page it came from', () => {
    expect(exitFrom('edit', 'success', VIEW)).toBe(VIEW);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('create, in-app entry: cancel goes back to the page it came from', () => {
    expect(exitFrom('create', 'cancel', VIEW)).toBe(VIEW);
  });
});
