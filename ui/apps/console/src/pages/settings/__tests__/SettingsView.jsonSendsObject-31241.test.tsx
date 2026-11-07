/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsView — a `json` setting leaves the page as the value its text parses
 * to, never as the text (objectstack#31241).
 *
 * ADR-0007 declares `json` | code editor | object. The field is a textarea, and
 * the page used to PUT the textarea's text: `lifecycle.quotas` was stored as a
 * string, and the lifecycle sweep read every quota as absent. Now the text is
 * parsed at Save: valid JSON is sent as the object or array, blank text as a
 * clear (`null`), and text that does not parse blocks Save on that row the way
 * a format miss does (objectui#13287), with the widget's own translated
 * sentence (`fields.object.invalidJson`).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getSettingsNamespace = vi.fn();
const saveSettingsNamespace = vi.fn();
const runSettingsAction = vi.fn();

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    getSettingsNamespace: (...a: unknown[]) => getSettingsNamespace(...a),
    saveSettingsNamespace: (...a: unknown[]) => saveSettingsNamespace(...a),
    runSettingsAction: (...a: unknown[]) => runSettingsAction(...a),
  };
});

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import { SettingsView } from '../SettingsView';

/** The Data Lifecycle page's shape: a toggle, two `json` maps and a number. */
function lifecyclePayload(values: Record<string, unknown> = {}) {
  const resolved: Record<string, unknown> = {};
  const all = { enabled: true, quotas: {}, quota_defaults: {}, growth_alert_rows: 0, ...values };
  for (const [k, v] of Object.entries(all)) resolved[k] = { value: v, source: 'default', locked: false };
  return {
    manifest: {
      namespace: 'lifecycle',
      label: 'Data Lifecycle',
      specifiers: [
        { type: 'toggle', key: 'enabled', label: 'Enforce lifecycle policies' },
        { type: 'json', key: 'quotas', label: 'Row quotas' },
        { type: 'json', key: 'quota_defaults', label: 'Per-class quota defaults' },
        { type: 'number', key: 'growth_alert_rows', label: 'Growth alert threshold' },
      ],
    },
    values: resolved,
  };
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/settings/lifecycle']}>
      <Routes>
        <Route path="/settings/:namespace" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rowFor = (key: string) => document.querySelector<HTMLElement>(`[data-settings-key="${key}"]`);
const boxFor = (key: string) => rowFor(key)?.querySelector('textarea') ?? null;
const alertIn = (key: string) => rowFor(key)?.querySelector('[role="alert"]') ?? null;

async function typeAndSave(key: string, text: string) {
  await screen.findByText('Row quotas');
  fireEvent.change(boxFor(key)!, { target: { value: text } });
  fireEvent.click(await screen.findByRole('button', { name: /save/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSettingsNamespace.mockResolvedValue({ values: {} });
});
afterEach(cleanup);

describe('SettingsView — a `json` setting is sent as its parsed value (objectstack#31241)', () => {
  it('sends the object the text parses to, never the text', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload());
    renderView();
    await typeAndSave('quotas', '{\n  "sys_audit_log": 1000\n}');

    await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
    const [namespace, patch] = saveSettingsNamespace.mock.calls[0] as [string, Record<string, unknown>];
    expect(namespace).toBe('lifecycle');
    expect(patch).toEqual({ quotas: { sys_audit_log: 1000 } });
    expect(typeof patch.quotas).toBe('object');
  });

  it('sends an array as an array, and blank text as a clear (null)', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quota_defaults: { telemetry: 5 } }));
    renderView();
    await screen.findByText('Row quotas');
    fireEvent.change(boxFor('quotas')!, { target: { value: '[1, 2]' } });
    fireEvent.change(boxFor('quota_defaults')!, { target: { value: '   ' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
    expect(saveSettingsNamespace.mock.calls[0][1]).toEqual({ quotas: [1, 2], quota_defaults: null });
  });

  it('text that does not parse blocks Save: no request, the row marked with the widget sentence', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload());
    renderView();
    await typeAndSave('quotas', '{ "sys_audit_log": 1000');

    await waitFor(() => expect(alertIn('quotas')).toBeTruthy());
    // Provider-less, `t` answers the key itself: the widget's own key, not a new one.
    expect(alertIn('quotas')!.textContent).toMatch(/invalidJson|Invalid JSON/);
    expect(saveSettingsNamespace).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('a locked stored value is not seeded and does not block an unrelated save', async () => {
    // An env override pins the text; nothing on this page can change it, so it
    // is neither put in the draft nor judged.
    const payload = lifecyclePayload();
    payload.values.quota_defaults = { value: '{ not json', source: 'env', locked: true };
    getSettingsNamespace.mockResolvedValue(payload);
    renderView();
    await screen.findByText('Row quotas');
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
    await typeAndSave('quotas', '{"sys_job_run": 1}');

    await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
    expect(saveSettingsNamespace.mock.calls[0][1]).toEqual({ quotas: { sys_job_run: 1 } });
  });
});

describe('SettingsView — a `json` value stored as text is offered for one save (objectstack#31241)', () => {
  const STORED = '{"sys_audit_log": 1000}';
  const noteIn = (key: string) => rowFor(key)?.querySelector('[data-testid="settings-field-note"]') ?? null;

  it('shows the save bar on load with the stored text as one unsaved change, and a note on the row', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quotas: STORED }));
    renderView();

    const bar = await screen.findByTestId('settings-unsaved-count');
    // Provider-less, `t` answers the key; the count is the draft's size.
    expect(bar.textContent).toMatch(/unsavedCount/);
    expect(boxFor('quotas')!.value).toBe(STORED);
    expect(noteIn('quotas')?.textContent).toMatch(/jsonStoredAsText/);
    // A key stored as an object is neither seeded nor noted.
    expect(noteIn('quota_defaults')).toBeNull();
    expect(saveSettingsNamespace).not.toHaveBeenCalled();
  });

  it('clicking Save without touching the row PUTs the object the stored text holds', async () => {
    // The load reads the text; the re-read after the save reads the object.
    getSettingsNamespace
      .mockResolvedValueOnce(lifecyclePayload({ quotas: STORED }))
      .mockResolvedValue(lifecyclePayload({ quotas: { sys_audit_log: 1000 } }));
    saveSettingsNamespace.mockResolvedValue({
      values: { quotas: { value: { sys_audit_log: 1000 }, source: 'global', locked: false } },
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
    expect(saveSettingsNamespace.mock.calls[0]).toEqual(['lifecycle', { quotas: { sys_audit_log: 1000 } }]);
    // Stored as an object now: the bar and the note are gone.
    await waitFor(() => expect(screen.queryByTestId('settings-unsaved-count')).toBeNull());
    expect(noteIn('quotas')).toBeNull();
  });

  it('stored text that does not parse is seeded too, and Save stops on its row', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quota_defaults: '{ not json' }));
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(alertIn('quota_defaults')).toBeTruthy());
    expect(alertIn('quota_defaults')!.textContent).toMatch(/invalidJson|Invalid JSON/);
    expect(saveSettingsNamespace).not.toHaveBeenCalled();
  });
});
