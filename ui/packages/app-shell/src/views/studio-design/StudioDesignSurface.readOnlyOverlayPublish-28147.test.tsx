// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D2 (#28130 child 2a) — "publish applies it": on a read-only
 * package, the drafts pending are the overlays its items were customized with
 * in place, and the package publish (`POST /packages/:id/publish-drafts`)
 * publishes them. So the Studio header's Publish is read-only there only while
 * nothing is pending; with a pending overlay draft it opens the changes sheet
 * to confirm, as on a writable package, and the sheet can publish.
 *
 * The REAL `StudioDesignSurface` over a fetch stub (the harness of
 * `StudioDesignSurface.publishPosture-12517.test.tsx`), with the changes sheet
 * a probe that says whether it was handed a publish. The nothing-pending half
 * keeps the read-only reason pinned in `publishReadOnlyReason-12303`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'com.acme.crm';
const DRAFTS = `/api/v1/meta/_drafts?packageId=${PACKAGE_ID}`;

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: 'Acme CRM', writable: false, namespace: 'crm' }]),
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

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      if (String(input) === DRAFTS) return json({ drafts: pending });
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

const publishButton = () => screen.getByRole('button', { name: new RegExp(`^${t('engine.studio.publish', 'en')}`) });
const changesButton = () => screen.getByRole('button', { name: new RegExp(`^${t('engine.studio.changes', 'en')}`) });

describe('ADR-0146 D2 — Publish on a read-only package follows what is pending', () => {
  it('with an overlay draft pending, Publish opens the sheet to confirm, and the sheet can publish', async () => {
    pending = [{ type: 'view', name: 'crm_case.open', packageId: PACKAGE_ID }];
    renderSurface();
    await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('1'), { timeout: 8000 });
    // The package list has answered read-only, and Publish is not held by it.
    await screen.findByTestId('studio-pkg-readonly', undefined, { timeout: 8000 });
    await waitFor(() => expect(publishButton()).toBeEnabled());
    expect(publishButton().parentElement).not.toHaveAttribute('data-disabled-reason');
    fireEvent.click(publishButton());
    const panel = await screen.findByTestId('probe-changes-panel');
    expect(panel).toHaveAttribute('data-posture', 'confirm');
    expect(panel).toHaveAttribute('data-can-publish', 'true');
  });

  it('with nothing pending, Publish stays disabled with the read-only reason, and the sheet cannot publish', async () => {
    pending = [];
    renderSurface();
    await screen.findByTestId('studio-pkg-readonly', undefined, { timeout: 8000 });
    await waitFor(() => expect(publishButton().parentElement).toHaveAttribute('data-disabled-reason'));
    expect(publishButton()).toBeDisabled();
    fireEvent.click(changesButton());
    expect(await screen.findByTestId('probe-changes-panel')).toHaveAttribute('data-can-publish', 'false');
  });
});
