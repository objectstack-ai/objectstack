// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11787 — the header's Changes count after a draft save.
 *
 * Found in a browser QA pass: after an autosave, an item showed its
 * "Unpublished draft" chip while the header beside it still said "No drafts
 * pending publish", until the count's read caught up. A draft save stamped with
 * this package means at least one draft is pending, so from the render in which
 * the save lands the header says so, and the read the save asks for is sent
 * after it rather than joined to one already on the wire.
 *
 * Driven through a create that still writes a draft: Create app in the Studio
 * header. objectstack#36511 — a permission set is created live now, so it
 * leaves no draft for this count to follow.
 *
 * Real: the surface, its pillar, `useMetadataClient` and the client it builds,
 * and `usePendingDrafts`. Stubbed: `globalThis.fetch` (the server; every
 * `_drafts` read is held open until the test answers it), `packages-io`'s
 * package list, `sonner`, and the dock and panels no assertion reads.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.a';
const DRAFTS = `/api/v1/meta/_drafts?package=${PACKAGE_ID}`;

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
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

// The console's preview and authoring code loads `@objectstack/lint` lazily;
// warmed here so its first load is paid at import, not inside a test's clock.
import '@objectstack/lint';
// objectstack#36900 — the surface mounts the command palette, which reaches the
// record preview's `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';
import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
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

interface HeldRead {
  respond: (drafts: Array<Record<string, unknown>>) => void;
}

/** The `_drafts` reads, in the order they were sent, each held until answered. */
const draftReads: HeldRead[] = [];
/** Draft saves the surface sent (`PUT …?mode=draft`). */
const draftSaves: string[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  draftReads.length = 0;
  draftSaves.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (url === DRAFTS) {
        return new Promise<Response>((resolve) => {
          draftReads.push({ respond: (drafts) => resolve(json({ drafts })) });
        });
      }
      if (init?.method === 'PUT' && url.includes('mode=draft')) {
        draftSaves.push(url);
        return json({});
      }
      // Every other read (the pillar's lists, the type registry, the matrix's
      // reads) answers empty — none of them is under test here.
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NONE_PENDING = t('engine.studio.publishNoneTitle', 'en');
const changesButton = () => screen.getByRole('button', { name: new RegExp(`^${t('engine.studio.changes', 'en')}`) });

async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

async function createAppThroughTheDialog() {
  const toolbar = await screen.findByTestId('studio-shell-header');
  fireEvent.click(await within(toolbar).findByRole('button', { name: t('engine.studio.app.create', 'en') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: 'Field Desk' } });
  // A draft-writing create says so (objectui#11787).
  fireEvent.click(within(dialog).getByRole('button', { name: t('engine.studio.createDraft', 'en') }));
}

describe('the Changes count after a draft save (objectui#11787)', () => {
  it('says a draft is pending from the render the save lands in, and the read it asks for is its own', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/owd`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
        </Routes>
      </MemoryRouter>,
    );
    // The mount read is on the wire and unanswered.
    await waitFor(() => expect(draftReads.length).toBeGreaterThan(0));
    await act(drain);
    const beforeSave = draftReads.length;

    await act(async () => {
      await createAppThroughTheDialog();
    });
    await waitFor(() => expect(draftSaves).toHaveLength(1));
    await act(drain);

    // The save landed: the header no longer says nothing is pending, and the
    // count is at least the draft the save wrote — before any read answers.
    expect(screen.queryByText(NONE_PENDING)).toBeNull();
    expect(changesButton()).toHaveTextContent('· 1');
    // The save sent a read of its own, not one joined to the read on the wire.
    expect(draftReads.length).toBe(beforeSave + 1);

    // The reads sent before the save answer with the ledger as it was: ignored.
    await act(async () => {
      for (const read of draftReads.slice(0, beforeSave)) read.respond([]);
      await drain();
    });
    expect(screen.queryByText(NONE_PENDING)).toBeNull();
    expect(changesButton()).toHaveTextContent('· 1');

    // The read sent after the save answers with the server's count.
    await act(async () => {
      draftReads[beforeSave].respond([
        { type: 'app', name: 'a_field_desk', packageId: PACKAGE_ID },
        { type: 'object', name: 'a_account', packageId: PACKAGE_ID },
      ]);
      await drain();
    });
    await waitFor(() => expect(changesButton()).toHaveTextContent('· 2'));
    expect(screen.queryByText(NONE_PENDING)).toBeNull();
  });
});
