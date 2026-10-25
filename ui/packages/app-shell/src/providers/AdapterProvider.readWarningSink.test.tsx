/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MIDDLE link of the metadata read-warning chain (objectui#7741): an
 * emitted event actually REACHES the sink.
 *
 * Sibling of `AdapterProvider.advisorySink.test.tsx` (objectui#7116), and it
 * exists for the reason that file measured: the two ENDS of a channel can both
 * be green while the wire between them is cut.
 *
 *   producer  ObjectStackAdapter.listImportMappings classifies the failure and
 *             emits on onMetadataReadWarning
 *             -> pinned by data-objectstack/src/listImportMappings.test.ts
 *   MIDDLE    AdapterProvider subscribes and renders through
 *             emitMetadataReadWarning into sonner
 *             -> pinned HERE
 *   renderer  emitMetadataReadWarning turns an event into the warning
 *             -> pinned by metadataReadWarningToast.test.ts
 *
 * ## Why the provider must build its own adapter
 *
 * `AdapterProvider` takes an optional `adapter` prop, and passing it makes the
 * effect return EARLY — before the subscription is installed. So a test that
 * hands in a ready-made adapter cannot see this seam at all. Nothing is passed
 * here; the provider runs its real `init()`, constructs the real adapter, and
 * the child reads that instance back out of the context the provider publishes.
 *
 * Stubbed, and only these two: `sonner` (the terminal sink — `AdapterProvider`
 * imports `toast` as a module binding, so intercepting the module is the only
 * way to observe what arrives) and `globalThis.fetch` (the server). Everything
 * between is real.
 */

import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

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

/** The object the objectstack#14026 misdiagnosis was actually about. */
const OBJECT = 'crm_plant_cost';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Mapping reads that actually left — the control for any zero below. */
function mappingReadCount(): number {
  return fetchMock.mock.calls.filter(([input]) =>
    String(typeof input === 'string' ? input : (input as Request).url).includes('/meta/mapping'),
  ).length;
}

/**
 * A `fetch` that answers discovery, and answers `GET /meta/mapping` with
 * `mappingAnswer`. Discovery is served because the provider's `init()` awaits
 * `connect()` before it publishes the adapter to children.
 */
function serverAnswers(mappingAnswer: () => Response) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.includes('/discovery')) return jsonResponse({ success: true, data: {} });
    if (url.includes('/meta/mapping')) return mappingAnswer();
    return jsonResponse({ success: false }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

let captured: { listImportMappings(objectName: string): Promise<unknown[]> } | null = null;

function CaptureAdapter() {
  const adapter = useAdapter();
  useEffect(() => {
    captured = adapter as unknown as typeof captured;
  }, [adapter]);
  return null;
}

async function mountProvider() {
  const view = render(
    <AdapterProvider>
      <CaptureAdapter />
    </AdapterProvider>,
  );
  await waitFor(() => expect(captured).not.toBeNull());
  return view;
}

function warningCall(): [string, { description?: string; duration?: number } | undefined] {
  const calls = vi.mocked(toast.warning).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0] as [string, { description?: string; duration?: number } | undefined];
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = null;
  vi.mocked(toast.warning).mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  serverAnswers(() =>
    jsonResponse({ success: false, error: { code: 'PERMISSION_DENIED', message: 'manage_metadata required' } }, 403),
  );
});

afterEach(() => {
  cleanup();
  warnSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe('AdapterProvider — a refused metadata read reaches the toast sink (objectui#7741)', () => {
  it('a refused mapping read through the provider-built adapter is announced', async () => {
    await mountProvider();

    // The return is unchanged: the caller is still handed an empty list.
    await expect(captured!.listImportMappings(OBJECT)).resolves.toEqual([]);

    const [title, options] = warningCall();
    // The object name proves the event's payload survived the whole seam.
    expect(title).toContain(OBJECT);
    expect(options?.description).toContain('could not be read');
    // The server's own code travelled too — the field the adapter branched ON.
    expect(options?.description).toContain('PERMISSION_DENIED');
  });

  it('CONTROL: a served answer says nothing', async () => {
    serverAnswers(() => jsonResponse({ type: 'mapping', items: [] }));
    await mountProvider();

    await expect(captured!.listImportMappings(OBJECT)).resolves.toEqual([]);

    // The zero is only a reading beside a control that MUST hit: the read
    // really did travel, so the silence is about a served empty collection and
    // not about a chain that never ran.
    expect(mappingReadCount()).toBe(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('CONTROL: a deployment that does not serve the `mapping` kind stays quiet', async () => {
    // ⛔ The one case that must NOT become a visible fault: a real, supported
    // older deployment. Same empty list, same hidden selector, no toast.
    serverAnswers(() =>
      jsonResponse(
        { success: false, error: { code: 'INVALID_REQUEST', message: "'mapping' is not a metadata type." } },
        400,
      ),
    );
    await mountProvider();

    await expect(captured!.listImportMappings(OBJECT)).resolves.toEqual([]);

    expect(mappingReadCount()).toBe(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('the subscription is released on unmount', async () => {
    const { unmount } = await mountProvider();

    // Control: the channel is live BEFORE unmount.
    await captured!.listImportMappings(OBJECT);
    expect(toast.warning).toHaveBeenCalledTimes(1);

    const adapter = captured!;
    unmount();
    vi.mocked(toast.warning).mockClear();

    await adapter.listImportMappings(OBJECT);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
