/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsView on a cloud-managed environment (objectstack#34149).
 *
 * The server half (`cloud-managed-settings.ts` in service-settings) refuses the
 * hosted `storage` namespace, the writes naming a hidden `ai` key and the
 * refused actions with `409 RESOURCE_CONFLICT`, `details.managedBy:
 * 'platform'`, and serves `ai` projected (provider, model and credential keys
 * left out). A direct route to either page must say the platform manages it,
 * not draw an empty form or a generic error. Self-hosted pages are unchanged.
 *
 * The refusal is read by its code and `details.managedBy`; a 409 carrying
 * neither is pinned to today's error card (CONTROL).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

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

/** The served auth config; each case sets its `features`. */
let authFeatures: Record<string, unknown> | undefined;
const getAuthConfig = vi.fn(async () => ({ features: authFeatures }));
const AUTH = { getAuthConfig };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => AUTH,
}));

import { SettingsView } from '../SettingsView';

const MANAGED_TITLE = 'Managed by the platform';
const AI_LINE = 'The AI provider, its model and credentials are managed by the platform.';

/** A failed read as `api.ts`'s `jsonOrThrow` builds it. */
function rejection(status: number, error: Record<string, unknown>) {
  const err = new Error(String(error.message)) as Error & { status?: number; payload?: unknown };
  err.status = status;
  err.payload = { success: false, error };
  return err;
}

/** The hosted refusal of `GET /api/settings/storage`, as service-settings answers it. */
const HOSTED_STORAGE_REFUSAL = () =>
  rejection(409, {
    code: 'RESOURCE_CONFLICT',
    message:
      'This environment is cloud-managed: file storage is provided and configured by the hosting platform, so its settings are not shown here.',
    details: { namespace: 'storage', managedBy: 'platform' },
  });

const STORAGE_PAYLOAD = {
  manifest: {
    namespace: 'storage',
    label: 'File storage',
    specifiers: [{ type: 'text', key: 'bucket', label: 'Bucket' }],
  },
  values: { bucket: { value: 'uploads', source: 'default' } },
};

/** `ai` as a hosted server serves it: the provider keys and their buttons left out. */
const AI_PROJECTED = {
  manifest: {
    namespace: 'ai',
    label: 'AI',
    specifiers: [
      { type: 'group', label: 'Conversation titles' },
      { type: 'boolean', key: 'title_generation_enabled', label: 'Generate titles' },
      { type: 'group', label: 'Observability' },
      { type: 'boolean', key: 'trace_enabled', label: 'Trace' },
      { type: 'action_button', id: 'flush_traces', label: 'Flush traces' },
    ],
  },
  values: {
    title_generation_enabled: { value: true, source: 'default' },
    trace_enabled: { value: false, source: 'default' },
  },
};

/** `ai` with its provider served, as a self-hosted server serves it. */
const AI_FULL = {
  manifest: {
    namespace: 'ai',
    label: 'AI',
    specifiers: [
      { type: 'select', key: 'provider', label: 'Provider', options: [{ value: 'openai', label: 'OpenAI' }] },
      { type: 'action_button', id: 'test', label: 'Test connection' },
      { type: 'boolean', key: 'title_generation_enabled', label: 'Generate titles' },
    ],
  },
  values: {
    provider: { value: 'openai', source: 'default' },
    title_generation_enabled: { value: true, source: 'default' },
  },
};

function renderView(namespace: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/settings/${namespace}`]}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  getSettingsNamespace.mockReset();
  saveSettingsNamespace.mockReset();
  runSettingsAction.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  getAuthConfig.mockClear();
  authFeatures = undefined;
});
afterEach(() => cleanup());

describe('the hosted storage page (objectstack#34149)', () => {
  it('draws the managed state for a 409 RESOURCE_CONFLICT naming managedBy platform: no form, no retry', async () => {
    getSettingsNamespace.mockRejectedValue(HOSTED_STORAGE_REFUSAL());
    const { container } = renderView('storage');

    const managed = await screen.findByTestId('settings-platform-managed');
    expect(managed.textContent).toContain(MANAGED_TITLE);
    // Not the error card: the server's sentence is not drawn.
    expect(screen.queryByText(/cloud-managed: file storage/)).toBeNull();
    // No form, no save bar, no retry.
    expect(container.querySelector('input, textarea, [role="combobox"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry|save/i })).toBeNull();
    expect(getSettingsNamespace).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a 409 RESOURCE_CONFLICT without managedBy keeps the error card', async () => {
    getSettingsNamespace.mockRejectedValue(
      rejection(409, {
        code: 'RESOURCE_CONFLICT',
        message: 'Some other conflict.',
        details: { namespace: 'storage' },
      }),
    );
    renderView('storage');

    expect(await screen.findByText('Some other conflict.')).toBeTruthy();
    expect(screen.queryByTestId('settings-platform-managed')).toBeNull();
  });

  it('CONTROL: a self-hosted storage page renders its form', async () => {
    getSettingsNamespace.mockResolvedValue(STORAGE_PAYLOAD);
    const { container } = renderView('storage');

    expect(await screen.findByText('Bucket')).toBeTruthy();
    expect(container.querySelector('input')).not.toBeNull();
    expect(screen.queryByTestId('settings-platform-managed')).toBeNull();
  });
});

describe('the hosted AI page (objectstack#34149)', () => {
  it('draws one managed line above the served keys when hosted and the provider was withheld', async () => {
    authFeatures = { cloudManaged: true };
    getSettingsNamespace.mockResolvedValue(AI_PROJECTED);
    renderView('ai');

    const line = await screen.findByTestId('settings-ai-provider-managed');
    expect(line.textContent).toBe(AI_LINE);
    // The tenant's own preferences stay editable.
    expect(screen.getByText('Generate titles')).toBeTruthy();
    expect(screen.getByText('Trace')).toBeTruthy();
  });

  it('CONTROL: a self-hosted AI page draws no line', async () => {
    authFeatures = { cloudManaged: false };
    getSettingsNamespace.mockResolvedValue(AI_FULL);
    renderView('ai');

    expect(await screen.findByText('Provider')).toBeTruthy();
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    expect(screen.queryByTestId('settings-ai-provider-managed')).toBeNull();
  });

  it('CONTROL: a page served without a provider on a self-hosted environment draws no line', async () => {
    authFeatures = { cloudManaged: false };
    getSettingsNamespace.mockResolvedValue(AI_PROJECTED);
    renderView('ai');

    expect(await screen.findByText('Generate titles')).toBeTruthy();
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    expect(screen.queryByTestId('settings-ai-provider-managed')).toBeNull();
  });

  it('CONTROL: a hosted server that still serves the provider draws its form and no line', async () => {
    authFeatures = { cloudManaged: true };
    getSettingsNamespace.mockResolvedValue(AI_FULL);
    renderView('ai');

    expect(await screen.findByText('Provider')).toBeTruthy();
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    expect(screen.queryByTestId('settings-ai-provider-managed')).toBeNull();
  });

  it('an action refused at run time as platform-managed toasts the managed text', async () => {
    getSettingsNamespace.mockResolvedValue(AI_FULL);
    runSettingsAction.mockRejectedValue(
      rejection(409, {
        code: 'RESOURCE_CONFLICT',
        message: "This environment is cloud-managed: the AI provider, its model and credentials is provided and configured by the hosting platform, so 'test' is not run here.",
        details: { namespace: 'ai', managedBy: 'platform', actionId: 'test' },
      }),
    );
    renderView('ai');

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(MANAGED_TITLE));
  });

  it('a save refused as platform-managed toasts the managed text', async () => {
    getSettingsNamespace.mockResolvedValue({
      manifest: { namespace: 'ai', label: 'AI', specifiers: [{ type: 'text', key: 'openai_model', label: 'Model' }] },
      values: { openai_model: { value: 'gpt-4o', source: 'default' } },
    });
    saveSettingsNamespace.mockRejectedValue(
      rejection(409, {
        code: 'RESOURCE_CONFLICT',
        message: "This environment is cloud-managed: … so 'openai_model' cannot be changed here. Nothing was written.",
        details: { namespace: 'ai', managedBy: 'platform', keys: ['openai_model'] },
      }),
    );
    const { container } = renderView('ai');

    await screen.findByText('Model');
    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: 'gpt-5' } });
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(MANAGED_TITLE));
  });
});
