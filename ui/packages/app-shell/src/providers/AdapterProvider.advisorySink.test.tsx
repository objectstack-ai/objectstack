/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ADAPTER channel's advisory chain: an emitted event actually REACHES the
 * sink (objectui#7116).
 *
 * Sibling of `views/metadata-admin/useMetadataClient.advisorySink.test.tsx`
 * (objectui#6969), which pins the same middle link on the OTHER client class.
 * These are two channels, not one — #6969 covers `MetadataClient`, minted per
 * component by `useMetadataClient`, whose sink rides the factory config; this
 * one covers `ObjectStackAdapter`, the long-lived instance every data surface
 * shares, whose sink is a `subscribe → unsubscribe` registration that
 * `AdapterProvider` wires once (#4237). Cutting either leaves the other green.
 *
 * ## What was missing, and why nothing red said so
 *
 * The chain has three links, and before this file only its two ends were
 * pinned:
 *
 *   producer  ObjectStackClient.meta.saveItem, wrapped by the adapter's
 *             installSaveAdvisoryInterceptor, emits the event
 *             -> pinned by data-objectstack/src/onSaveAdvisory.test.ts
 *   MIDDLE    AdapterProvider subscribes with a.onSaveAdvisory and renders
 *             through emitSaveAdvisories into sonner
 *             -> pinned by NOTHING
 *   renderer  emitSaveAdvisories turns an event into the warning
 *             -> pinned by saveAdvisoryToast.test.ts
 *
 * The producer suite asserts the event is EMITTED, into a sink it constructs
 * itself. The renderer suite asserts the message is BUILT, over an event it
 * writes by hand. Neither ever asserts the thing emitted and the thing rendered
 * are connected. Measured before writing this file, on the 45 suites that name
 * `AdapterProvider` plus the producer and renderer suites (633 tests): with the
 * `a.onSaveAdvisory` subscription deleted outright, all 45 stayed GREEN; with
 * the subscription kept but its `emitSaveAdvisories` call cut, all 45 stayed
 * GREEN; with the unsubscribe cut, all 45 stayed GREEN.
 *
 * The mechanism of the blind spot is the same one #6969 named, and starker
 * here: 38 of those 41 `AdapterProvider` suites `vi.mock` the module away —
 * legitimately, they are testing pages, not plumbing — and, before this file,
 * exactly ZERO imported the real one. (Control for that zero: the same query
 * shape against `saveAdvisoryToast` returns 2.) The seam was mocked away
 * everywhere it appeared.
 *
 * ## Why the provider must build its own adapter here
 *
 * `AdapterProvider` takes an optional `adapter` prop, and passing it makes the
 * effect return EARLY — before the subscription is installed. So a test that
 * hands in a ready-made adapter cannot see this seam at all: it would be green
 * against every ablation above. Nothing is passed here; the provider runs its
 * real `init()`, constructs the real `ObjectStackAdapter`, and the child reads
 * that instance back out of the context the provider publishes.
 *
 * ## What is real here, and what is not
 *
 * Real: the provider, its effect, the `ObjectStackAdapter` it constructs, that
 * adapter's `installSaveAdvisoryInterceptor`, the real SDK `ObjectStackClient`
 * and its response parsing, `createAuthenticatedFetch`, `withSettleSignal`, the
 * `onSaveAdvisory` registration and its unsubscribe, the i18n `t` read through
 * the provider's ref, `readSaveAdvisories`, and `emitSaveAdvisories`.
 *
 * Stubbed, and only these two:
 *   - `sonner` — the terminal sink. `AdapterProvider` imports `toast` as a
 *     module binding rather than taking it as a parameter, so intercepting the
 *     module is the only way to observe what arrives. Everything BETWEEN the
 *     producer and it is the real thing, which is the whole point.
 *   - `globalThis.fetch` — the server. It answers discovery, and answers the
 *     metadata PUT with the body the framework's runtime authoring gate
 *     actually sends.
 *
 * ## Scope — deliberately NOT a bigger test at either end
 *
 * This asserts the CONNECTION and nothing else. The tier, the per-finding
 * formatting, the door verbs and the empty-list drop are the renderer suite's;
 * the response-shape filtering, the `mode` derivation and listener isolation
 * are the producer suite's. Duplicating any of them here would grow the suite
 * without closing the hole this file exists to close.
 */

import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// The one stub in the middle of the chain — see the module doc.
vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { AdapterProvider, useAdapter } from './AdapterProvider';

/** The measured `nightly_purge` finding, in the gate's D3 shape. */
const PURGE_ADVISORY = {
  severity: 'warning' as const,
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

/**
 * The clean part of a real save response. `success`/`version`/`seq`/`state` are
 * REQUIRED by `SaveMetaItemResponseSchema` (#5745); `readSaveAdvisories` drops
 * anything half-shaped, so a fixture missing one would make this file pass for
 * the wrong reason.
 */
const CLEAN_BODY = { success: true, version: 'v2', seq: 4, state: 'active' as const };

/** A committed write the gate had something to say about. */
const ADVISED_BODY = { ...CLEAN_BODY, advisories: [PURGE_ADVISORY] };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

/** URLs of the metadata writes that actually left — the control for any zero. */
function metaWriteCount(): number {
  return fetchMock.mock.calls.filter(([input]) =>
    String(typeof input === 'string' ? input : (input as Request).url).includes('/meta/'),
  ).length;
}

/**
 * A `fetch` that answers discovery, and answers every metadata write with
 * `saveBody`. Discovery is served because the provider's `init()` awaits
 * `connect()` before it publishes the adapter to children.
 */
function serverAnswers(saveBody: unknown) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.includes('/discovery')) return jsonResponse({ success: true, data: {} });
    return jsonResponse(saveBody);
  });
  vi.stubGlobal('fetch', fetchMock);
}

/** Reads the adapter back out of the context the provider publishes. */
let captured: { getClient(): { meta: { saveItem(t: string, n: string, i: unknown): Promise<unknown> } } } | null = null;

function CaptureAdapter() {
  const adapter = useAdapter();
  // Recorded in an effect rather than during render: reassigning a
  // module-scope binding mid-render is a side effect (react-hooks/globals),
  // and the mount helper awaits this anyway.
  useEffect(() => {
    captured = adapter as unknown as typeof captured;
  }, [adapter]);
  return null;
}

/** Mounts the real provider and waits until it has published its adapter. */
async function mountProvider() {
  const view = render(
    <AdapterProvider>
      <CaptureAdapter />
    </AdapterProvider>,
  );
  await waitFor(() => expect(captured).not.toBeNull());
  return view;
}

async function save() {
  await captured!.getClient().meta.saveItem('flow', 'nightly_purge', { name: 'nightly_purge' });
}

/** The `(title, options)` pair the sink was called with. */
function warningCall(): [string, { description?: string; duration?: number } | undefined] {
  const calls = vi.mocked(toast.warning).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0] as [string, { description?: string; duration?: number } | undefined];
}

beforeEach(() => {
  captured = null;
  vi.mocked(toast.warning).mockClear();
  serverAnswers(ADVISED_BODY);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdapterProvider — an emitted adapter advisory reaches the toast sink (#7116)', () => {
  it('a save through the provider-built adapter renders the gate findings', async () => {
    await mountProvider();

    await save();

    const [title, options] = warningCall();
    // The verb proves the DOOR discriminator survived the whole seam: it is set
    // by the adapter's interceptor and read by the renderer, and nothing in
    // between may lose or rewrite it.
    expect(title).toMatch(/^Saved\b/);
    // The finding itself arrived — not merely "something was toasted".
    expect(options?.description).toContain(PURGE_ADVISORY.message);
    expect(options?.description).toContain(PURGE_ADVISORY.rule);
  });

  it('CONTROL: a clean save says nothing', async () => {
    serverAnswers(CLEAN_BODY);
    await mountProvider();

    await save();

    // The zero below is only a reading beside a control that MUST hit: the
    // write really did travel the chain, so "the sink stayed quiet" is about
    // the absent advisory list and not about a chain that never ran.
    expect(metaWriteCount()).toBe(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('the subscription is released on unmount', async () => {
    const { unmount } = await mountProvider();

    // Control: the channel is live BEFORE unmount, so the silence asserted
    // after it is about the unsubscribe and not about a chain that never ran.
    await save();
    expect(toast.warning).toHaveBeenCalledTimes(1);

    unmount();
    vi.mocked(toast.warning).mockClear();

    // The adapter outlives the provider that built it, so its interceptor still
    // emits here — only the provider's listener should be gone.
    await save();

    expect(metaWriteCount()).toBe(2);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
