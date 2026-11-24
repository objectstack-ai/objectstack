// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#33158 (ADR-0090 D5/D9) — the Access pillar's suggested-bindings
 * strip on a READ-ONLY package. A marketplace-installed package is read-only in
 * Studio, and it is the package that ships an `isDefault` set; accepting or
 * dismissing that suggestion is a deployment decision about the package, not
 * an edit of it, so the strip is drawn whatever `readOnly` says.
 *
 * The REAL `AccessPillar` and `SuggestedBindingsPanel`, over a metadata client
 * double and a stub of the suggestion door's client.
 *
 * Pinned:
 *  - on a read-only package a pending suggestion renders the strip with Accept
 *    and Dismiss, listed for this package;
 *  - CONTROL: a writable package renders the same strip;
 *  - CONTROL: on the read-only package the pillar's authoring affordance (the
 *    rail's "+ New") stays absent, while the writable package offers it;
 *  - a list refused `403` (a caller without `manage_metadata`) renders no
 *    strip and no error.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// The source under test reaches a dynamic `import('@objectstack/lint')`; pay
// that load during collection, never inside a case's clocked window.
import '@objectstack/lint';

const PKG = 'app.example.crm';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  confirm: vi.fn(),
  dismiss: vi.fn(),
  reopen: vi.fn(),
}));

vi.mock('../../services/suggestedBindingsApi', () => ({
  listSuggestedBindings: api.list,
  confirmSuggestedBinding: api.confirm,
  dismissSuggestedBinding: api.dismiss,
  reopenSuggestedBinding: api.reopen,
}));

const client = {
  withPreviewDrafts() { return this; },
  list: vi.fn(async (type: string) =>
    type === 'permission' ? [{ name: 'crm_user', label: 'CRM user', isDefault: true }] : [],
  ),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: null, code: null, overlay: null, overlayScope: null })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => ({ fields: [] })),
  save: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { toast } from 'sonner';
import { t, tFormat } from '../metadata-admin/i18n';
import { AccessPillar } from './StudioDesignSurface';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const en = (key: string) => t(key, 'en');

const PENDING = {
  id: 'sug_1',
  package_id: PKG,
  permission_set_name: 'crm_user',
  anchor: 'everyone' as const,
  status: 'pending' as const,
};

function refused(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAccess(readOnly: boolean) {
  render(
    <MemoryRouter>
      <AccessPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

describe('objectstack#33158 — the suggested-bindings strip on a read-only package', () => {
  it('a read-only package: a pending suggestion renders the strip with Accept and Dismiss', async () => {
    api.list.mockResolvedValue([PENDING]);
    renderAccess(true);
    const row = within(await screen.findByTestId('suggested-binding-crm_user', undefined, { timeout: 8000 }));
    expect(row.getByTestId('suggested-binding-confirm-crm_user')).toHaveTextContent(
      en('engine.studio.access.suggestConfirm'),
    );
    expect(row.getByTestId('suggested-binding-dismiss-crm_user')).toHaveTextContent(
      en('engine.studio.access.suggestDismiss'),
    );
    expect(api.list).toHaveBeenCalledWith({ packageId: PKG });
  });

  it('CONTROL: a writable package renders the same strip', async () => {
    api.list.mockResolvedValue([PENDING]);
    renderAccess(false);
    const row = within(await screen.findByTestId('suggested-binding-crm_user', undefined, { timeout: 8000 }));
    expect(row.getByTestId('suggested-binding-confirm-crm_user')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith({ packageId: PKG });
  });

  it('CONTROL: the read-only package keeps its authoring affordance absent; the writable one offers it', async () => {
    api.list.mockResolvedValue([PENDING]);
    renderAccess(true);
    await screen.findByTestId('suggested-bindings-panel', undefined, { timeout: 8000 });
    await screen.findByTestId('studio-rail-access');
    expect(screen.queryByTestId('studio-rail-add')).toBeNull();
    cleanup();

    renderAccess(false);
    await screen.findByTestId('suggested-bindings-panel', undefined, { timeout: 8000 });
    expect(await screen.findByTestId('studio-rail-add')).toBeInTheDocument();
  });

  it('a list refused 403 (no manage_metadata) renders no strip and no error', async () => {
    api.list.mockRejectedValue(
      refused(403, 'PERMISSION_DENIED', 'listing audience-binding suggestions requires the `manage_metadata` capability.'),
    );
    renderAccess(true);
    await screen.findByTestId('studio-rail-access', undefined, { timeout: 8000 });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    // Let the refused read settle before asserting its absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('suggested-bindings-panel')).toBeNull();
    expect(screen.queryByText(/manage_metadata/)).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#33864 — the strip names the suggested set by the label the rail
 * reads for it (`ux-conventions.labels-over-machine-names`), never by its
 * machine name: the banner, the Accept and Dismiss toasts, and the state line
 * a resolved row keeps. The suggestion row carries the machine name only; the
 * double's set list (`crm_user` → "CRM user") is where the label comes from.
 */
describe('objectstack#33864 — the suggested-bindings strip names its set by label', () => {
  const fmt = (key: string, set: string, anchor?: string) =>
    tFormat(key, 'en', anchor === undefined ? { set } : { set, anchor });

  it('the pending banner names the set by its label', async () => {
    api.list.mockResolvedValue([PENDING]);
    renderAccess(false);
    const row = await screen.findByTestId('suggested-binding-crm_user', undefined, { timeout: 8000 });
    await waitFor(() =>
      expect(row).toHaveTextContent(fmt('engine.studio.access.suggestPromptEveryone', 'CRM user')),
    );
    expect(row).not.toHaveTextContent('"crm_user"');
  });

  it('the Accept toast and the accepted state line name the set by its label', async () => {
    api.list.mockResolvedValue([PENDING]);
    api.confirm.mockResolvedValue({
      suggestion: { ...PENDING, status: 'confirmed', deployment_decision: true },
      bindingCreated: true,
    });
    renderAccess(false);
    const row = await screen.findByTestId('suggested-binding-crm_user', undefined, { timeout: 8000 });
    await waitFor(() => expect(row).toHaveTextContent('CRM user'));
    within(row).getByTestId('suggested-binding-confirm-crm_user').click();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        fmt('engine.studio.access.suggestConfirmedToast', 'CRM user', 'everyone'),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('suggested-binding-crm_user')).toHaveTextContent(
        fmt('engine.studio.access.suggestAcceptedState', 'CRM user'),
      ),
    );
  });

  it('the Dismiss toast and the dismissed state line name the set by its label', async () => {
    api.list.mockResolvedValue([PENDING]);
    api.dismiss.mockResolvedValue({ ...PENDING, status: 'dismissed', deployment_decision: true });
    renderAccess(false);
    const row = await screen.findByTestId('suggested-binding-crm_user', undefined, { timeout: 8000 });
    await waitFor(() => expect(row).toHaveTextContent('CRM user'));
    within(row).getByTestId('suggested-binding-dismiss-crm_user').click();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(fmt('engine.studio.access.suggestDismissedToast', 'CRM user')),
    );
    await waitFor(() =>
      expect(screen.getByTestId('suggested-binding-crm_user')).toHaveTextContent(
        fmt('engine.studio.access.suggestDismissedState', 'CRM user'),
      ),
    );
  });

  it('CONTROL: a set the rail holds no label for is named by its machine name', async () => {
    client.list.mockImplementationOnce(async (type: string) =>
      type === 'permission' ? [{ name: 'crm_user', label: '', isDefault: true }] : [],
    );
    api.list.mockResolvedValue([PENDING]);
    renderAccess(false);
    const row = await screen.findByTestId('suggested-binding-crm_user', undefined, { timeout: 8000 });
    await screen.findByTestId('studio-rail-access');
    await waitFor(() =>
      expect(row).toHaveTextContent(fmt('engine.studio.access.suggestPromptEveryone', 'crm_user')),
    );
  });
});

/**
 * objectstack#33865 (`ux-conventions.write-feedback`) — Revoke on a granted
 * suggestion is a write, and it answers with a toast naming the set, as Grant
 * and Dismiss do. The Studio mount hands the strip its own `revokedToast`
 * sentence; this reads it through the REAL pillar: Grant, then Revoke on the
 * row the Grant left.
 *
 * Pinned:
 *  - Grant → Revoke: the Revoke answers with the revoked sentence naming the
 *    set by its label, after the Grant's own toast, and the row then reads
 *    dismissed with Reconsider;
 *  - CONTROL: a Revoke the server refuses answers with the server's message
 *    and never the revoked sentence — the toast follows the write, not the
 *    press.
 */
describe('objectstack#33865 — Revoke on a granted suggestion answers with a toast', () => {
  const fmt = (key: string, set: string, anchor?: string) =>
    tFormat(key, 'en', anchor === undefined ? { set } : { set, anchor });
  const GRANTED = { ...PENDING, status: 'confirmed' as const, deployment_decision: true };

  async function grant() {
    api.list.mockResolvedValue([PENDING]);
    api.confirm.mockResolvedValue({ suggestion: GRANTED, bindingCreated: true });
    renderAccess(false);
    const row = await screen.findByTestId('suggested-binding-crm_user', undefined, { timeout: 8000 });
    await waitFor(() => expect(row).toHaveTextContent('CRM user'));
    within(row).getByTestId('suggested-binding-confirm-crm_user').click();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        fmt('engine.studio.access.suggestConfirmedToast', 'CRM user', 'everyone'),
      ),
    );
    return screen.findByTestId('suggested-binding-revoke-crm_user');
  }

  it('Grant then Revoke: the Revoke toasts the revoked sentence naming the set, and the row reads dismissed', async () => {
    api.dismiss.mockResolvedValue({ ...GRANTED, status: 'dismissed' });
    const revoke = await grant();
    expect(toast.success).toHaveBeenCalledTimes(1);

    revoke.click();
    await waitFor(() =>
      expect(toast.success).toHaveBeenLastCalledWith(fmt('engine.studio.access.suggestRevokedToast', 'CRM user')),
    );
    expect(toast.success).toHaveBeenCalledTimes(2);
    expect(api.dismiss).toHaveBeenCalledWith('sug_1');
    const row = screen.getByTestId('suggested-binding-crm_user');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'dismissed'));
    expect(row).toHaveTextContent(fmt('engine.studio.access.suggestDismissedState', 'CRM user'));
    expect(within(row).getByTestId('suggested-binding-reopen-crm_user')).toBeInTheDocument();
  });

  it('CONTROL: a refused Revoke toasts the server message, never the revoked sentence', async () => {
    api.dismiss.mockRejectedValue(refused(409, 'CONFLICT', 'the suggestion changed under you'));
    const revoke = await grant();

    revoke.click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('the suggestion changed under you'));
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalledWith(fmt('engine.studio.access.suggestRevokedToast', 'CRM user'));
  });
});
