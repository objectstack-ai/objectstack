// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12335 — the runtime draft bar's Discard keeps the package-less
 * delete, and the door's `409 RESOURCE_CONFLICT` reaches the user.
 *
 * The runtime persistence seam (`runtime-metadata-persistence.ts`) saves,
 * publishes and reads its drafts naming no package: `RuntimePersistCtx`
 * carries no binding, so the seam has none to state on the discard either.
 * Since objectstack `543b33dee` (`@objectstack/rest` 18.0.0-next.1) a
 * package-less delete addresses the item's one package, and an item two
 * packages hold is refused `409 RESOURCE_CONFLICT` with `?package=` as the
 * remedy. The card's rule for a caller that does not know the binding: keep
 * the package-less call, and show the refusal with its remedy.
 *
 * The real bar, the real seam and a REAL `MetadataClient`, whose transport
 * answers the draft DELETE as the framework does for such an item.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { MetadataClient } from '@object-ui/data-objectstack';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

import { RuntimeDraftBar } from './RuntimeDraftBar';

const AMBIGUOUS =
  "Name the package this delete is for, then send it again: on the REST door add ?package= with the package id, " +
  "in process pass packageId. Nothing was deleted. view 'crm_deal.pipeline' belongs to 2 packages " +
  "('com.acme.alpha', 'com.acme.beta'), and a delete that names none has no single row to remove.";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let deletes: URLSearchParams[] = [];

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') {
        deletes.push(new URLSearchParams(url.search));
        return url.searchParams.get('package')
          ? json(200, { success: true, reset: true })
          : json(409, { error: AMBIGUOUS, code: 'RESOURCE_CONFLICT' });
      }
      // The pending draft that makes the bar render.
      return json(200, { type: 'view', name: 'crm_deal.pipeline', item: { label: 'Pipeline' } });
    }) as unknown as typeof fetch,
  });
}

beforeEach(() => {
  deletes = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('RuntimeDraftBar — Discard of an item two packages hold (objectui#12335)', () => {
  it('sends ?state=draft and no `package` key, and the 409 is a toast carrying the door`s remedy', async () => {
    const onAfterChange = vi.fn();
    render(
      <RuntimeDraftBar type="view" name="crm_deal.pipeline" metadataClient={realClient()} onAfterChange={onAfterChange} />,
    );
    await screen.findByTestId('runtime-draft-bar');

    await act(async () => {
      fireEvent.click(screen.getByTestId('runtime-draft-discard'));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.get('state')).toBe('draft');
    expect(deletes[0]!.has('package')).toBe(false);

    const [, options] = vi.mocked(toast.error).mock.calls[0] as [unknown, { description?: unknown } | undefined];
    expect(String(options?.description)).toBe(AMBIGUOUS);
    // The draft was not discarded, so the bar still says so.
    expect(screen.getByTestId('runtime-draft-indicator')).toBeTruthy();
    expect(onAfterChange).not.toHaveBeenCalled();
  });
});
