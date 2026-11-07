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

  it('a stored value that is not this save\'s does not block it', async () => {
    // A deployment that saved through the old page holds the text; editing
    // another key must still save.
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quota_defaults: '{ not json' }));
    renderView();
    await typeAndSave('quotas', '{"sys_job_run": 1}');

    await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
    expect(saveSettingsNamespace.mock.calls[0][1]).toEqual({ quotas: { sys_job_run: 1 } });
  });
});
