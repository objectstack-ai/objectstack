// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11784 — the package sheet's three confirmations are in-app.
 *
 * Before: *Delete app* chained two `window.confirm` calls, and the second one
 * picked `?keepData=true` on Cancel, so an author who pressed Cancel there
 * still deleted the package's structure. *Duplicate* asked for the target id
 * with `window.prompt`, and *Discard changes (N)* discarded every draft with
 * no question at all. Native dialogs are also blocked or auto-answered in an
 * embedded frame.
 *
 * After, pinned here through the real `PackageDetailSheet`:
 *   - Delete opens ONE dialog: an explicit *structure only* / *structure and
 *     data* choice (no default), the package name typed to arm the destructive
 *     button, and a Cancel that sends nothing. *structure only* sends
 *     `?keepData=true`; *structure and data* sends no query.
 *   - Discard asks once, naming the draft count; its Cancel sends nothing.
 *   - Duplicate is the Studio landing's inline form: the typed id is what is
 *     sent, and an id the spec's id rule (`isSpecPackageId`, objectui#11855)
 *     refuses never reaches the server.
 *   - None of the three calls `window.confirm` or `window.prompt`.
 *
 * Every request is recorded by the fetch stub, so "sends nothing" is read off
 * the wire, not off the UI.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { PackageDetailSheet, PackagesPage, type InstalledPackageRow } from './PackagesPage';

const PKG_ID = 'com.acme.crm';
const PKG_NAME = 'Acme CRM';
const PKG: InstalledPackageRow = {
  manifest: { id: PKG_ID, name: PKG_NAME, version: '1.0.0', type: 'app' },
  enabled: true,
  status: 'installed',
  // Every served row carries its `source` (objectstack#24010) and the
  // server's writability verdict (objectstack#14375); the Packages list
  // refuses a row without either, each by its own name (objectui#12790).
  source: 'authored',
  writable: true,
};
const DRAFTS = [
  { type: 'object', name: 'acme_lead' },
  { type: 'view', name: 'acme_lead_list' },
];

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
/** What `POST /duplicate` answers; a test may replace it. */
let duplicateAnswer: unknown;
let confirmSpy: ReturnType<typeof vi.fn>;
let promptSpy: ReturnType<typeof vi.fn>;
let savedConfirm: PropertyDescriptor | undefined;
let savedPrompt: PropertyDescriptor | undefined;

function respond(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  duplicateAnswer = { success: true, data: { success: true, copiedCount: 3, failedCount: 0 } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: input, method, body });
      if (input === '/api/v1/packages' && method === 'GET') {
        return respond({ success: true, data: { packages: [PKG] } });
      }
      if (input.startsWith('/api/v1/meta/_drafts')) {
        return respond({ success: true, data: { drafts: DRAFTS } });
      }
      if (input.endsWith('/discard-drafts')) {
        return respond({ success: true, data: { discardedCount: DRAFTS.length, failedCount: 0 } });
      }
      if (input.endsWith('/duplicate')) {
        return respond(duplicateAnswer);
      }
      return respond({ success: true, data: {} });
    }),
  );
  // happy-dom implements neither; install spies so a native call is observed
  // (and answered) rather than thrown. The Cancel-path pin answers the way the
  // measured defect was reached: OK to the first question, Cancel to the second.
  savedConfirm = Object.getOwnPropertyDescriptor(window, 'confirm');
  savedPrompt = Object.getOwnPropertyDescriptor(window, 'prompt');
  confirmSpy = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  promptSpy = vi.fn(() => null);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
  Object.defineProperty(window, 'prompt', { configurable: true, writable: true, value: promptSpy });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (savedConfirm) Object.defineProperty(window, 'confirm', savedConfirm);
  else delete (window as unknown as Record<string, unknown>).confirm;
  if (savedPrompt) Object.defineProperty(window, 'prompt', savedPrompt);
  else delete (window as unknown as Record<string, unknown>).prompt;
});

function renderSheet() {
  const onChanged = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <PackageDetailSheet pkg={PKG} open onOpenChange={onOpenChange} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return { onChanged, onOpenChange };
}

const writes = () => calls.filter((c) => c.method !== 'GET');
const deletes = () => calls.filter((c) => c.method === 'DELETE');

/** Let any handler the click scheduled run before reading the wire. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function openDeleteDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete app' }));
  return screen.findByTestId('pkg-detail-delete-dialog');
}

describe('PackageDetailSheet — Delete app is one in-app dialog (objectui#11784)', () => {
  it('Cancel deletes nothing, however the question is asked', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete app' }));
    await settle();
    // If a dialog is up, answer it with Cancel; a native confirm was already
    // answered by the spy (OK, then Cancel).
    const dialog = screen.queryByTestId('pkg-detail-delete-dialog');
    if (dialog) fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-cancel'));
    await settle();
    expect(deletes()).toEqual([]);
  });

  it('Cancel after choosing a mode and typing the name still sends no DELETE', async () => {
    const { onChanged, onOpenChange } = renderSheet();
    const dialog = await openDeleteDialog();
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-mode-all'));
    fireEvent.change(within(dialog).getByTestId('pkg-detail-delete-name-input'), {
      target: { value: PKG_NAME },
    });
    expect(within(dialog).getByTestId('pkg-detail-delete-confirm')).not.toBeDisabled();
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-cancel'));
    await waitFor(() => expect(screen.queryByTestId('pkg-detail-delete-dialog')).toBeNull());
    await settle();
    expect(deletes()).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('the destructive button stays disabled until a mode is chosen AND the name matches', async () => {
    renderSheet();
    const dialog = await openDeleteDialog();
    const confirm = within(dialog).getByTestId('pkg-detail-delete-confirm');
    const input = within(dialog).getByTestId('pkg-detail-delete-name-input');

    // No default mode: nothing chosen, nothing typed.
    expect(within(dialog).getByTestId('pkg-detail-delete-mode-structure')).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByTestId('pkg-detail-delete-mode-all')).toHaveAttribute('aria-checked', 'false');
    expect(confirm).toBeDisabled();

    // The name alone does not arm it.
    fireEvent.change(input, { target: { value: PKG_NAME } });
    expect(confirm).toBeDisabled();

    // A mode with a wrong name does not arm it.
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-mode-structure'));
    fireEvent.change(input, { target: { value: 'Acme' } });
    expect(confirm).toBeDisabled();

    // The id is not the name the dialog asks for.
    fireEvent.change(input, { target: { value: PKG_ID } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: PKG_NAME } });
    expect(confirm).not.toBeDisabled();

    // A click on a disabled button sends nothing either.
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(confirm);
    await settle();
    expect(deletes()).toEqual([]);
  });

  it('*structure only* sends `?keepData=true`, then refreshes and closes the sheet', async () => {
    const { onChanged, onOpenChange } = renderSheet();
    const dialog = await openDeleteDialog();
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-mode-structure'));
    fireEvent.change(within(dialog).getByTestId('pkg-detail-delete-name-input'), {
      target: { value: PKG_NAME },
    });
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-confirm'));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].url).toBe(`/api/v1/packages/${PKG_ID}?keepData=true`);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('*structure and data* sends no `keepData`', async () => {
    renderSheet();
    const dialog = await openDeleteDialog();
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-mode-all'));
    fireEvent.change(within(dialog).getByTestId('pkg-detail-delete-name-input'), {
      target: { value: PKG_NAME },
    });
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-confirm'));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].url).toBe(`/api/v1/packages/${PKG_ID}`);
  });

  it('a refused DELETE closes the dialog, keeps the sheet open and shows the refusal', async () => {
    const REFUSAL = 'Deleting packages requires the `studio.access` capability.';
    const base = globalThis.fetch as unknown as (input: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if ((init.method ?? 'GET').toUpperCase() === 'DELETE') {
          calls.push({ url: input, method: 'DELETE', body: undefined });
          return respond({ success: false, error: { code: 'FORBIDDEN', message: REFUSAL } }, 403);
        }
        return base(input, init);
      }),
    );
    const { onChanged, onOpenChange } = renderSheet();
    const dialog = await openDeleteDialog();
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-mode-all'));
    fireEvent.change(within(dialog).getByTestId('pkg-detail-delete-name-input'), {
      target: { value: PKG_NAME },
    });
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-confirm'));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    // The sheet leads with the sentence; the declared code is behind "More"
    // (objectui#13332).
    expect(await screen.findByText(REFUSAL)).toBeTruthy();
    fireEvent.click(screen.getByTestId('refusal-more'));
    expect(screen.getByTestId('refusal-detail').textContent).toBe(`${REFUSAL} (FORBIDDEN)`);
    await waitFor(() => expect(screen.queryByTestId('pkg-detail-delete-dialog')).toBeNull());
    expect(onChanged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('reopening the dialog starts over: no mode, no name', async () => {
    renderSheet();
    let dialog = await openDeleteDialog();
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-mode-all'));
    fireEvent.change(within(dialog).getByTestId('pkg-detail-delete-name-input'), {
      target: { value: PKG_NAME },
    });
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-cancel'));
    await waitFor(() => expect(screen.queryByTestId('pkg-detail-delete-dialog')).toBeNull());

    dialog = await openDeleteDialog();
    expect(within(dialog).getByTestId('pkg-detail-delete-mode-all')).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByTestId('pkg-detail-delete-name-input')).toHaveValue('');
    expect(within(dialog).getByTestId('pkg-detail-delete-confirm')).toBeDisabled();
  });
});

describe('PackageDetailSheet — Discard changes asks first (objectui#11784)', () => {
  it('names the draft count, and its Cancel sends no request', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: `Discard changes (${DRAFTS.length})` }));
    const dialog = await screen.findByTestId('pkg-detail-discard-dialog');
    expect(dialog.textContent).toContain(`(${DRAFTS.length})`);
    fireEvent.click(within(dialog).getByTestId('pkg-detail-discard-cancel'));
    await waitFor(() => expect(screen.queryByTestId('pkg-detail-discard-dialog')).toBeNull());
    await settle();
    expect(writes()).toEqual([]);
  });

  it('its confirm discards once', async () => {
    const { onChanged } = renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: `Discard changes (${DRAFTS.length})` }));
    const dialog = await screen.findByTestId('pkg-detail-discard-dialog');
    fireEvent.click(within(dialog).getByTestId('pkg-detail-discard-confirm'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: `/api/v1/packages/${PKG_ID}/discard-drafts` });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });
});

describe('PackageDetailSheet — Duplicate is the landing inline form (objectui#11784)', () => {
  it('sends the typed id and name', async () => {
    const { onChanged } = renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    const form = await screen.findByTestId('pkg-detail-dup-form');
    fireEvent.change(within(form).getByTestId('pkg-detail-dup-id-input'), {
      target: { value: 'com.acme.crm2' },
    });
    fireEvent.change(within(form).getByTestId('pkg-detail-dup-name-input'), {
      target: { value: 'Acme CRM two' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Create copy' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST',
      url: `/api/v1/packages/${PKG_ID}/duplicate`,
      body: { targetPackageId: 'com.acme.crm2', targetName: 'Acme CRM two' },
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('pkg-detail-dup-form')).toBeNull();
  });

  it('refuses an id the spec rule rejects: the button stays disabled and nothing is sent', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    const form = await screen.findByTestId('pkg-detail-dup-form');
    const idInput = within(form).getByTestId('pkg-detail-dup-id-input');
    // A bare segment is not a reverse-domain package id.
    fireEvent.change(idInput, { target: { value: 'crmcopy' } });
    const go = within(form).getByRole('button', { name: 'Create copy' });
    expect(go).toBeDisabled();
    expect(within(form).getByTestId('pkg-id-format-hint')).toBeTruthy();
    fireEvent.click(go);
    fireEvent.keyDown(idInput, { key: 'Enter' });
    await settle();
    expect(writes()).toEqual([]);
  });

  it('a 200 whose verdict is `success: false` is an error, not "duplicated"', async () => {
    // What the landing's call already refused (`duplicatePackage`); the sheet's
    // own reader looked only at the envelope's `success` and said "duplicated".
    duplicateAnswer = { success: true, data: { success: false, copiedCount: 0, failedCount: 0 } };
    const { onChanged } = renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    const form = await screen.findByTestId('pkg-detail-dup-form');
    fireEvent.change(within(form).getByTestId('pkg-detail-dup-id-input'), {
      target: { value: 'com.acme.crm2' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Create copy' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(await screen.findByText(/Nothing was copied/)).toBeTruthy();
    expect(screen.queryByText('Package duplicated into a new base.')).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('its Cancel closes the form and sends nothing', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    const form = await screen.findByTestId('pkg-detail-dup-form');
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('pkg-detail-dup-form')).toBeNull());
    await settle();
    expect(writes()).toEqual([]);
  });
});

describe('PackageDetailSheet — no native dialog on these three paths (objectui#11784)', () => {
  it('Delete, Discard and Duplicate never call window.confirm or window.prompt', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete app' }));
    await settle();
    const del = screen.queryByTestId('pkg-detail-delete-dialog');
    if (del) fireEvent.click(within(del).getByTestId('pkg-detail-delete-cancel'));
    await settle();

    fireEvent.click(await screen.findByRole('button', { name: `Discard changes (${DRAFTS.length})` }));
    await settle();
    const dis = screen.queryByTestId('pkg-detail-discard-dialog');
    if (dis) fireEvent.click(within(dis).getByTestId('pkg-detail-discard-cancel'));
    await settle();

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    await settle();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });
});

describe('Console Packages page — a delete there stays on the page (objectui#11784)', () => {
  /**
   * Studio's return to its landing after a delete is the Studio HOST's
   * (`PackageSwitcher`'s eviction in `StudioDesignSurface.tsx`), not the
   * sheet's. The same sheet serves this console page, whose `onChanged` only
   * reloads the list; `/studio` is not a destination here.
   */
  function PathProbe() {
    return <div data-testid="path">{useLocation().pathname}</div>;
  }

  it('reloads the list and closes the sheet, without navigating to /studio', async () => {
    const START = '/apps/demo/component/packages';
    render(
      <MemoryRouter initialEntries={[START]}>
        <PathProbe />
        <Routes>
          <Route path={START} element={<PackagesPage />} />
          <Route path="/studio" element={<div data-testid="studio-landing" />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>,
    );
    const listReads = () => calls.filter((c) => c.method === 'GET' && c.url === '/api/v1/packages');

    fireEvent.click(await screen.findByText(PKG_NAME));
    const dialog = await openDeleteDialog();
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-mode-all'));
    fireEvent.change(within(dialog).getByTestId('pkg-detail-delete-name-input'), {
      target: { value: PKG_NAME },
    });
    fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-confirm'));

    await waitFor(() => expect(deletes()).toHaveLength(1));
    await waitFor(() => expect(listReads()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete app' })).toBeNull());
    expect(screen.getByTestId('path').textContent).toBe(START);
    expect(screen.queryByTestId('studio-landing')).toBeNull();
    expect(screen.queryByTestId('elsewhere')).toBeNull();
  });
});
