// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12517 — the shell header's two doors into the one pending-changes
 * sheet open it in two postures: Publish opens it to confirm, Changes opens it
 * to review. One sheet, one component; the host only says which door was used.
 *
 * Publish stays review-then-confirm (objectui#2261): the header click opens the
 * sheet and publishes nothing; only the sheet's footer button does. With
 * nothing pending, Publish stays disabled and described by
 * `publish-none-reason` (objectui#12303).
 *
 * Real: the surface, `useMetadataClient` and `usePendingDrafts`. Stubbed:
 * `globalThis.fetch`, `packages-io`'s package list, `sonner`, the dock and
 * panels no assertion reads, and `DraftChangesPanel`, replaced by a probe that
 * prints the props the surface mounts it with (the panel's own postures are
 * pinned by `DraftChangesPanel.posture-12517.test.tsx`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.a';
const DRAFTS = `/api/v1/meta/_drafts?packageId=${PACKAGE_ID}`;

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: PACKAGE_ID, writable: true, namespace: 'a' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: (props: { open: boolean; posture?: string; onPublish?: unknown }) =>
    props.open ? (
      <div
        data-testid="probe-changes-panel"
        data-posture={props.posture ?? 'none'}
        data-can-publish={String(typeof props.onPublish === 'function')}
      />
    ) : null,
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

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
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

let pending: Array<Record<string, unknown>> = [];
/** Every request the surface sent that is not a read. */
const writes: string[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  writes.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method && init.method !== 'GET') writes.push(`${init.method} ${url}`);
      if (url === DRAFTS) return json({ drafts: pending });
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSurface() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/access`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const changesButton = () => screen.getByRole('button', { name: new RegExp(`^${t('engine.studio.changes', 'en')}`) });
const publishButton = () => screen.getByRole('button', { name: t('engine.studio.publish', 'en') });

describe('objectui#12517 — Publish opens the sheet to confirm, Changes opens it to review', () => {
  beforeEach(() => {
    pending = [
      { type: 'object', name: 'a_ticket', packageId: PACKAGE_ID },
      { type: 'app', name: 'a_app', packageId: PACKAGE_ID },
      { type: 'page', name: 'a_home', packageId: PACKAGE_ID },
    ];
  });

  it('Publish opens the one sheet in the confirm posture, and publishes nothing by itself', async () => {
    renderSurface();
    await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('3'));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    fireEvent.click(publishButton());
    const sheet = await screen.findByTestId('probe-changes-panel');
    expect(sheet).toHaveAttribute('data-posture', 'confirm');
    expect(sheet).toHaveAttribute('data-can-publish', 'true');
    expect(screen.getAllByTestId('probe-changes-panel')).toHaveLength(1);
    // Review-then-confirm (objectui#2261): the header click wrote nothing.
    expect(writes.filter((w) => w.includes('publish'))).toEqual([]);
  });

  it('Changes opens the same sheet in the review posture', async () => {
    renderSurface();
    await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('3'));
    fireEvent.click(changesButton());
    const sheet = await screen.findByTestId('probe-changes-panel');
    expect(sheet).toHaveAttribute('data-posture', 'review');
    expect(screen.getAllByTestId('probe-changes-panel')).toHaveLength(1);
  });

  it('each door sets its own posture: Publish, then Changes, reads review the second time', async () => {
    renderSurface();
    await waitFor(() => expect(publishButton()).toBeEnabled());
    fireEvent.click(publishButton());
    expect(await screen.findByTestId('probe-changes-panel')).toHaveAttribute('data-posture', 'confirm');
    fireEvent.click(changesButton());
    await waitFor(() =>
      expect(screen.getByTestId('probe-changes-panel')).toHaveAttribute('data-posture', 'review'),
    );
  });
});

describe('objectui#12517 keeps objectui#12303 — nothing pending', () => {
  beforeEach(() => {
    pending = [];
  });

  it('Publish stays disabled and described by publish-none-reason; no count pill', async () => {
    renderSurface();
    const reason = await screen.findByTestId('publish-none-reason');
    expect(publishButton()).toBeDisabled();
    expect(publishButton()).toHaveAttribute('aria-describedby', reason.id);
    expect(screen.queryByTestId('studio-changes-count')).toBeNull();
    // Changes still opens the sheet, to review.
    fireEvent.click(changesButton());
    expect(await screen.findByTestId('probe-changes-panel')).toHaveAttribute('data-posture', 'review');
  });
});
