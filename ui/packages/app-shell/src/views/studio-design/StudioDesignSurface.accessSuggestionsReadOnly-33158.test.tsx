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
import { t } from '../metadata-admin/i18n';
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
