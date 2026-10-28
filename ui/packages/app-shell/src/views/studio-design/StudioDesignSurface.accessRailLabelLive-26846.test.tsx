// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26846 — a label the open set's draft save changed shows on the
 * Access rail at once: the pillar reads its sets again on the matrix's
 * `onDraftSaved`, with no publish and no reload. The matrix page is a stand-in
 * that reports one draft save; the pillar and its rail are the real ones.
 *
 * CONTROL: before that save the rail reads the label it loaded.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let draftLabel = 'Dispatcher';

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => [{ type: 'permission', name: 'dispatcher', packageId: 'app.a', label: draftLabel }]),
  layered: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});
// The open set's editor: one button that stands for an autosave of its label.
vi.mock('../metadata-admin/PermissionMatrixEditor', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    PermissionMatrixEditPage: ({ onDraftSaved }: { onDraftSaved?: () => void }) => (
      <button
        type="button"
        data-testid="matrix-autosave"
        onClick={() => {
          draftLabel = 'Dispatcher v2';
          onDraftSaved?.();
        }}
      >
        autosave
      </button>
    ),
  };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { AccessPillar } from './StudioDesignSurface';

// jsdom has no matchMedia — useIsMobile (rail overlay) needs a stub.
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

afterEach(cleanup);

describe('objectstack#26846 — the Access rail follows a draft save of the open set', () => {
  it('a label the save changed shows on the rail without a publish or a reload', async () => {
    draftLabel = 'Dispatcher';
    const onDraftSaved = vi.fn();
    render(
      <MemoryRouter>
        <AccessPillar packageId="app.a" onDraftSaved={onDraftSaved} />
      </MemoryRouter>,
    );
    const rail = within(await screen.findByTestId('studio-rail-access'));
    // CONTROL: the label the rail loaded.
    expect(await rail.findByRole('button', { name: 'Dispatcher' })).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('matrix-autosave'));
    expect(onDraftSaved).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(rail.getByRole('button', { name: 'Dispatcher v2' })).toBeInTheDocument());
    expect(rail.queryByRole('button', { name: 'Dispatcher' })).toBeNull();
  });
});
