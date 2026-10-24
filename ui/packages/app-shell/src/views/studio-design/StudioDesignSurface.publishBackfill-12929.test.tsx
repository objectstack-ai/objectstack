// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12929 — Done when: a draft adding a boolean with a default over N
 * rows publishes with the option checked and the response count N is shown;
 * unchecked, nothing is written.
 *
 * End to end through the Studio's own publish: the header's Publish opens the
 * real review sheet (confirm posture, every row expanded), the drill-in offers
 * the unchecked choice naming the object's N records, the sheet's Publish all
 * hands the checked field to the surface, and the surface sends it through the
 * real `MetadataClient` to `POST /packages/:id/publish-drafts`. The server's
 * receipt (`backfillApplied`) is what the toast reports.
 *
 * "Nothing is written" is asserted on the request: the protocol writes into
 * existing rows only for the fields the body's `backfill` names
 * (objectstack#24253), so an unchecked publish sends a body with no `backfill`
 * — byte for byte the `{}` it sent before this card.
 *
 * Real: the surface, the sheet, `useMetadataClient` and the client it builds,
 * `usePendingDrafts`. Stubbed: `globalThis.fetch` (the server), the adapter
 * (the record count, N), `packages-io`'s package list, `sonner`, and the
 * panels no assertion reads.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';
const OBJECT = 'b2r4_ticket';
/** The object's existing records — the count the choice names and the receipt reports. */
const N = 12;

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
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: PACKAGE_ID, writable: true, namespace: 'b2r4' }]),
  };
});

const ADAPTER = { find: vi.fn(async () => ({ data: [], total: N })) };
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ADAPTER };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { toast } from 'sonner';
import { StudioDesignSurface } from './StudioDesignSurface';
import { t, tFormat } from '../metadata-admin/i18n';

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

const PUBLISHED_BODY = { name: OBJECT, label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } };
/** The draft adds a boolean with a literal default. */
const DRAFT_BODY = {
  ...PUBLISHED_BODY,
  fields: { ...PUBLISHED_BODY.fields, done: { type: 'boolean', label: 'Done', defaultValue: false } },
};

/** Every body the surface sent to the batch door. */
const publishBodies: unknown[] = [];
/** When set, the receipt reports the field stopped short after N rows, with this reason. */
let stoppedReason: string | null = null;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * The batch door, as the protocol answers it inside the dispatcher's envelope:
 * `backfillApplied` only when the request named a field (objectstack#24253).
 */
function batchAnswer(requested: { backfill?: Array<{ object: string; field: string }> }) {
  return {
    success: true,
    data: {
      success: true,
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: [{ type: 'object', name: OBJECT, version: 'sha256:1' }],
      failed: [],
      ...(requested.backfill?.length
        ? {
            backfillApplied: {
              success: stoppedReason === null,
              fields: requested.backfill.map((f) => ({
                ...f,
                updated: N,
                ...(stoppedReason === null ? {} : { error: stoppedReason }),
              })),
            },
          }
        : {}),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  publishBodies.length = 0;
  stoppedReason = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: unknown }) => {
      const url = String(input);
      if (url.includes('/publish-drafts')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        publishBodies.push(init?.body);
        return json(batchAnswer(body));
      }
      if (url.includes('/meta/_drafts')) return json({ drafts: [{ type: 'object', name: OBJECT, packageId: PACKAGE_ID }] });
      if (/\/meta\/object(\?|$)/.test(url)) return json([{ name: OBJECT }]);
      if (url.includes(`/meta/object/${OBJECT}`)) return json(url.includes('state=draft') ? DRAFT_BODY : PUBLISHED_BODY);
      // Every other read (the type registry, the pillar lists) answers empty —
      // none of them is under test here.
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Open the sheet the way the author does: the header's Publish, which opens it to confirm.
 *
 * Resolves once the backfill option is drawn, NOT once its count is: the drill-in
 * asks the adapter for the record count only after the option renders, and names
 * no number until that read lands. A read of the counted name (N) is therefore a
 * waiting `findByRole`, never a synchronous `getByRole`, which races the count.
 */
async function openSheet(): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  const publish = () => screen.getByRole('button', { name: t('engine.studio.publish', 'en') });
  await waitFor(() => expect(publish()).toBeEnabled());
  fireEvent.click(publish());
  const sheet = await screen.findByTestId('draft-changes-panel');
  await within(sheet).findByTestId('draft-backfill-option');
  return sheet;
}

const publishedTitle = () => tFormat('engine.studio.publishedAllCountOne', 'en', { count: 1 });

describe('Studio publish with the default backfill (objectui#12929)', () => {
  it('checked: the boolean’s default is asked for, and the receipt’s count N is shown', async () => {
    const sheet = await openSheet();
    // The choice names the object's N existing records, and starts unchecked.
    const box = await within(sheet).findByRole('checkbox', { name: new RegExp(`\\b${N}\\b`) });
    expect(box).not.toBeChecked();

    fireEvent.click(box);
    fireEvent.click(within(sheet).getByTestId('draft-changes-publish'));

    await waitFor(() => expect(publishBodies).toHaveLength(1));
    expect(JSON.parse(String(publishBodies[0]))).toEqual({ backfill: [{ object: OBJECT, field: 'done' }] });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(vi.mocked(toast.success).mock.calls).toEqual([
      [
        publishedTitle(),
        { description: tFormat('engine.studio.backfillWritten', 'en', { field: `${OBJECT}.done`, count: N }) },
      ],
    ]);
    expect(String(vi.mocked(toast.success).mock.calls[0]![1]?.description)).toContain(String(N));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('a field that stopped short: the publish still stands, said as a warning carrying the rows and the reason', async () => {
    stoppedReason = 'record b2r4_ticket/r13: a validation rule refused the write';
    const sheet = await openSheet();
    fireEvent.click(await within(sheet).findByRole('checkbox', { name: new RegExp(`\\b${N}\\b`) }));
    fireEvent.click(within(sheet).getByTestId('draft-changes-publish'));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(vi.mocked(toast.warning).mock.calls).toEqual([
      [
        publishedTitle(),
        {
          description: tFormat('engine.studio.backfillStopped', 'en', {
            field: `${OBJECT}.done`,
            count: N,
            error: stoppedReason,
          }),
        },
      ],
    ]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('unchecked: the publish names no field, so nothing is written into existing rows', async () => {
    const sheet = await openSheet();
    // Waited for, like the cases above: the count lands after the option draws.
    expect(await within(sheet).findByRole('checkbox', { name: new RegExp(`\\b${N}\\b`) })).not.toBeChecked();

    fireEvent.click(within(sheet).getByTestId('draft-changes-publish'));

    await waitFor(() => expect(publishBodies).toHaveLength(1));
    // Byte for byte the request every publish sent before this card.
    expect(publishBodies[0]).toBe('{}');
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // No receipt, so no backfill line: the toast is the publish's alone.
    expect(vi.mocked(toast.success).mock.calls).toEqual([[publishedTitle()]]);
  });
});
