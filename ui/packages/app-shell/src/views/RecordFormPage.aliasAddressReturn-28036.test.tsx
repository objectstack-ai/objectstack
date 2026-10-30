/**
 * objectstack-ai/objectstack#28036 — a full-page record form opened on its
 * app-NAME address stays in the app after save or cancel. The console moves
 * that address to the package-id one with a `replace` navigate on load
 * (`AppContent`'s canonical app pathname), which gives the entry a generated
 * key with nothing of the console's behind it. Each cell replays that replace
 * on a real browser history under `BrowserRouter`. Direction, written before
 * the run: keyed on `location.key !== 'default'`, every alias cell RED (Back
 * leaves the app); the in-app cell GREEN.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
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
/**
 * The console's two navigations: a react-router push to `to`, and the
 * replace `AppContent` makes on an app-name address (to its package id).
 */
const Nav = ({ to, canonical }: { to: string; canonical: string }) => {
  const navigate = useNavigate();
  return h(
    React.Fragment,
    null,
    h('button', { type: 'button', 'data-testid': 'push', onClick: () => { void navigate(to); } }, 'push'),
    h('button', { type: 'button', 'data-testid': 'canonical', onClick: () => { void navigate(canonical, { replace: true }); } }, 'canonical'),
  );
};

const ALIAS = '/apps/crm_app/showcase_task';
const APP = '/apps/com.example.crm/showcase_task';
const LIST = APP;
const DETAIL = `${APP}/record/t1`;
const VIEW = `${APP}/view/open`;

beforeEach(() => {
  toastSuccess.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const formOf = (base: string, mode: 'create' | 'edit') => (mode === 'create' ? `${base}/new` : `${base}/record/t1/edit`);

/**
 * Open the form on its app-name address — loaded on it, or pushed from
 * `before` — let the console replace it with the package-id address, fire
 * `exit`, return where it lands.
 */
async function exitFromAlias(mode: 'create' | 'edit', exit: 'success' | 'cancel', before?: string): Promise<string> {
  window.history.replaceState(null, '', before ?? formOf(ALIAS, mode));
  render(
    h(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      children: h(
        BrowserRouter,
        null,
        h(Nav, { to: formOf(ALIAS, mode), canonical: formOf(APP, mode) }),
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
  if (before) fireEvent.click(screen.getByTestId('push'));
  fireEvent.click(screen.getByTestId('canonical'));
  // The replace minted a key, so the old in-app test read this entry as having history.
  const { key } = window.history.state as { key?: string };
  expect(key).toBeTruthy();
  expect(key).not.toBe('default');
  fireEvent.click(screen.getByTestId(exit === 'success' ? 'fire-success' : 'fire-cancel'));
  return (await screen.findByTestId('where')).textContent ?? '';
}

describe('RecordFormPage — the app-name address stays in the app (objectstack-ai/objectstack#28036)', () => {
  it('edit, app-name URL: saves, toasts once, lands on the record detail', async () => {
    expect(await exitFromAlias('edit', 'success')).toBe(DETAIL);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Task "Quarterly review" updated');
  });

  it('create, app-name URL: saves, toasts once, lands on the object list', async () => {
    expect(await exitFromAlias('create', 'success')).toBe(LIST);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Task "Quarterly review" created');
  });

  it('edit, app-name URL: cancel lands on the record detail, no toast', async () => {
    expect(await exitFromAlias('edit', 'cancel')).toBe(DETAIL);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('edit, pushed from a page of the app: save goes back to that page', async () => {
    expect(await exitFromAlias('edit', 'success', VIEW)).toBe(VIEW);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });
});
