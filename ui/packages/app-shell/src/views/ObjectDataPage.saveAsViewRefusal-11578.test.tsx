// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11578, door 1 of 2: a refused "Save as view" on the object data
 * page is said to the user, and never reported as a save.
 *
 * ## The defect this pins
 *
 * `ObjectDataPage.handleSaveAsView` caught the failed save with
 * `console.error('[ObjectDataPage] Failed to save view:', err)` and nothing
 * else, and the dialog had already closed. Measured by the objectui#11576 dev
 * against the platform's view gate answering 422: the dialog closed, the page
 * did not move, and no toast, alert or navigation told the user the view was
 * never saved.
 *
 * ## What runs
 *
 * The real `ObjectDataPage`, the real `CreateViewDialog`, and a real
 * `@object-ui/data-objectstack` `MetadataClient` whose fetch answers the PUT
 * with the refusal under test, so the error the door catches is the one the
 * client's own parser builds from the wire. Two refusal classes ride the
 * same door: the dispatcher's `422 INVALID_METADATA` envelope with structured
 * issues, and a `403` permission refusal that carries only a message.
 *
 * ## What the pins assert
 *
 * Refused: one `toast.error` whose description carries the door's message (the
 * issue's path and prose, or the 403's message), no success toast, the dialog
 * still open with the user's label and name, and the page where it was.
 * Saved: the user lands on the new draft in preview mode, as before.
 *
 * Direction, written before the run: on the unmodified tree both refused cases
 * go RED (no toast; the dialog has closed), and the saved case stays GREEN, as
 * the control that a successful save still navigates.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

/** What the PUT answers in this test: a refusal, or a 2xx. */
let putAnswer: () => Response;
const puts: string[] = [];

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The dispatcher's ADR-0112 refusal envelope for a view the spec gate refused. */
const INVALID_METADATA = () =>
  json(
    {
      success: false,
      error: {
        code: 'INVALID_METADATA',
        message: 'The view failed spec validation: 1 issue (columns [custom])',
        details: {
          code: 'INVALID_METADATA',
          issues: [{ path: 'columns', message: 'Column "ghost_field" is not a field of crm_deal', code: 'custom' }],
        },
      },
    },
    422,
  );
/** A permission refusal: a message and no structured issues. */
const PERMISSION_DENIED = () =>
  json(
    { success: false, error: { code: 'PERMISSION_DENIED', message: 'Saving views requires the Manage Metadata permission' } },
    403,
  );

function wire() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname;
    if (init?.method === 'PUT' && path.includes('/meta/view/')) {
      puts.push(path);
      return putAnswer();
    }
    if (path.endsWith('/meta/dataset')) return json([], 200);
    return json({ data: [] }, 200);
  });
}
let client: MetadataClient;

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }), checkField: () => true, getFieldPermissions: () => [],
      getRowFilter: () => undefined, getObjectApiOperations: () => undefined, roles: [], isLoaded: false,
      hasCapabilities: () => true, can: () => true, cannot: () => false,
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  // "Save as view" and its dialog are admin-only.
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));
// The list itself is orthogonal to the save door.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectDataPage } from './ObjectDataPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const DEAL = {
  name: 'crm_deal',
  label: 'Deal',
  managedBy: 'platform',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};
const PAGE = '/apps/demo/crm_deal/data';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

const where = () => screen.getByTestId('where').textContent;
const submit = () => screen.getByTestId('create-view-submit') as HTMLButtonElement;
const labelInput = () => screen.getByTestId('create-view-name-input') as HTMLInputElement;
const nameInput = () => screen.getByTestId('create-view-machine-name-input') as HTMLInputElement;

/** Open "Save as view", name the view, press Create, and wait for the PUT. */
async function saveAsView() {
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada' }}>
      <MemoryRouter initialEntries={[PAGE]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/data"
            element={<ObjectDataPage dataSource={{ find: vi.fn(async () => ({ data: [] })) }} objects={[DEAL]} />}
          />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </ExpressionProvider>,
  );
  fireEvent.click(screen.getByTestId('object-data-save-as-view'));
  fireEvent.change(labelInput(), { target: { value: 'Pipeline board' } });
  await waitFor(() => expect(nameInput().value).toBe('pipeline_board'));
  await waitFor(() => expect(submit().disabled).toBe(false));
  await act(async () => {
    fireEvent.click(submit());
  });
  await waitFor(() => expect(puts).toHaveLength(1));
}

beforeEach(() => {
  cleanup();
  puts.length = 0;
  client = new MetadataClient({ baseUrl: 'http://localhost', fetch: wire() as unknown as typeof fetch });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('"Save as view" says a refused save, and never reports it as saved (objectui#11578)', () => {
  it.each([
    { refusal: '422 INVALID_METADATA', answer: INVALID_METADATA, says: ['columns', 'Column "ghost_field" is not a field of crm_deal'] },
    { refusal: '403 permission', answer: PERMISSION_DENIED, says: ['Saving views requires the Manage Metadata permission'] },
  ])('a $refusal refusal shows the door\'s message; the dialog stays open with the input, and the page does not move', async ({ answer, says }) => {
    putAnswer = answer;
    await saveAsView();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [, options] = vi.mocked(toast.error).mock.calls[0] as [unknown, { description?: unknown } | undefined];
    for (const text of says) expect(String(options?.description)).toContain(text);
    expect(toast.success).not.toHaveBeenCalled();

    expect(screen.getByTestId('create-view-dialog')).toBeTruthy();
    expect(labelInput().value).toBe('Pipeline board');
    expect(nameInput().value).toBe('pipeline_board');
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(where()).toBe(PAGE);
  });

  it('a saved view still lands the user on the new draft in preview mode (control)', async () => {
    putAnswer = () => json({ success: true }, 200);
    await saveAsView();

    await waitFor(() => expect(where()).toBe('/apps/demo/crm_deal/view/crm_deal.pipeline_board?preview=draft'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId('create-view-dialog')).toBeNull();
  });
});
