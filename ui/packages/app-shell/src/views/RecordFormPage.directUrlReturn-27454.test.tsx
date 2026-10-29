/**
 * objectstack-ai/objectstack#27454 — a full-page record form entered by direct
 * URL returns INSIDE the app after save or cancel: the record detail (edit) or
 * the object list (create), as in-app entry does with nothing behind it. The
 * tab's own history is longer than the console's, so `window.history.length`
 * is simulated as 3 on every cell. Direction, written before the run: keyed on
 * `window.history.length > 1`, every direct-URL cell RED; in-app cells GREEN.
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
  toast: Object.assign(vi.fn(), { success: toastSuccess, error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

// Stand-in form: one button per exit, as `ObjectForm` calls `onSuccess(result)` / `onCancel()`.
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

const TASK = { name: 'showcase_task', label: 'Task', nameField: 'subject', fields: { subject: { type: 'text' } } };
const METADATA = { objects: [TASK], loading: false };
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => METADATA }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => null }));

const Where = () => h('div', { 'data-testid': 'where' }, useLocation().pathname);

const LIST = '/apps/crm/showcase_task';
const DETAIL = '/apps/crm/showcase_task/record/t1';
const VIEW = '/apps/crm/showcase_task/view/open';

beforeEach(() => {
  toastSuccess.mockClear();
  vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
