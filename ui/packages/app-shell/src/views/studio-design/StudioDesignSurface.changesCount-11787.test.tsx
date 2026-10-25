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
 * Driven through a save every author reaches: the Access pillar's
 * "New permission set", whose dialog also carries Studio's one create label.
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
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

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

async function createSetThroughTheDialog() {
  // The rail's "+" (the empty block's button shares its name since objectui#12514).
  fireEvent.click(await screen.findByTestId('studio-rail-add'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByPlaceholderText(t('engine.studio.access.labelPlaceholder', 'en')), {
    target: { value: 'Set C' },
  });
  // Studio's one create label (objectui#11787): every create dialog writes a draft.
  fireEvent.click(within(dialog).getByRole('button', { name: t('engine.studio.createDraft', 'en') }));
}

describe('the Changes count after a draft save (objectui#11787)', () => {
  it('says a draft is pending from the render the save lands in, and the read it asks for is its own', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/access`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>,
    );
    // The mount read is on the wire and unanswered.
    await waitFor(() => expect(draftReads.length).toBeGreaterThan(0));
    await act(drain);
    const beforeSave = draftReads.length;

    await act(async () => {
      await createSetThroughTheDialog();
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
        { type: 'permission', name: 'set_c', packageId: PACKAGE_ID },
        { type: 'object', name: 'a_account', packageId: PACKAGE_ID },
      ]);
      await drain();
    });
    await waitFor(() => expect(changesButton()).toHaveTextContent('· 2'));
    expect(screen.queryByText(NONE_PENDING)).toBeNull();
  });
});
