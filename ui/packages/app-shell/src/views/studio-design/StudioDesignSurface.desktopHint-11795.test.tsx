// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11795 — Studio stays a desktop tool, and on a phone it says so: one
 * line under the header (`engine.studio.desktopHint`), shown below `md` (the
 * width `useIsMobile` answers for), and nowhere wider.
 *
 * The REAL surface on its Data tab; the chat dock and the panels it does not
 * need are stubbed as in the sibling surface pins.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (_t: string, name: string) => ({ effective: { name } })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const realInnerWidth = window.innerWidth;
function setViewportWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({
            success: true,
            data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Field Ops' }, writable: true }] },
          })
        : answer([]),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setViewportWidth(realInnerWidth);
});

function renderSurfaceAt(width: number) {
  setViewportWidth(width);
  return render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/data`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const HINT = t('engine.studio.desktopHint', 'en');

describe('StudioDesignSurface — the one-line desktop hint on a phone (objectui#11795)', () => {
  it('a phone-width window shows the hint once, under the header', async () => {
    renderSurfaceAt(390);

    const hint = await screen.findByText(HINT);
    expect(hint).toHaveAttribute('role', 'note');
    expect(screen.getAllByText(HINT)).toHaveLength(1);
    // Directly below the Studio header, above the pillar.
    expect(hint.previousElementSibling?.tagName).toBe('HEADER');
  });

  it('the control: from `md` up, no hint', async () => {
    renderSurfaceAt(768);

    await waitFor(() =>
      expect(screen.getByTestId('studio-pkg-chip')).toHaveAttribute('data-pkg-list-state', 'loaded'),
    );
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
