/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The advisory chain's MIDDLE link: an emitted event actually REACHES the sink
 * (objectui#6969).
 *
 * ## What was missing, and why nothing red said so
 *
 * The chain has three links, and before this file only its two ends were
 * pinned:
 *
 *   producer  MetadataClient.save / .publishDraft emit the event
 *             -> pinned by metadata-client.saveAdvisories.test.ts and
 *                metadata-client.publishAdvisories.test.ts
 *   MIDDLE    useMetadataClient hands its toast sink to the client factory,
 *             which hands it to the MetadataClient constructor
 *             -> pinned by NOTHING
 *   renderer  emitSaveAdvisories turns an event into the warning
 *             -> pinned by saveAdvisoryToast.test.ts
 *
 * The producer suites assert the event is EMITTED, into a sink they construct
 * themselves. The renderer suite asserts the message is BUILT, over an event it
 * writes by hand. Neither one ever asserts that the thing emitted and the thing
 * rendered are connected — so cutting the middle silenced BOTH doors, save and
 * publish, with every named suite green. Measured before writing this file:
 * with the `onSaveAdvisory` hand-off deleted from the factory call in
 * `useMetadata.ts`, 226 test files / 2369 tests stayed green.
 *
 * The mechanism of the blind spot is worth naming, because it is not an
 * oversight anyone could have spotted by reading a coverage number: 51 suites
 * `vi.mock('./useMetadata')` — legitimately, they are testing pages, not
 * plumbing — and, before this file, exactly ZERO imported the real
 * `useMetadataClient`. The seam was mocked away everywhere it appeared.
 *
 * ## What is real here, and what is not
 *
 * Real: the hook, its `useCallback` sink, the i18n `t` it closes over, the
 * PreviewModeContext read, `createConsoleMetadataClient`, the authenticated
 * fetch wrapper, the `MetadataClient` instance, its response parsing, its
 * `readSaveAdvisories` filter, and `emitSaveAdvisories`.
 *
 * Stubbed, and only these two:
 *   - `sonner` — the terminal sink. It is imported directly by the hook (not
 *     injected), so intercepting the module is the only way to observe what
 *     arrives. Everything BETWEEN the producer and it is the real thing, which
 *     is the whole point.
 *   - `globalThis.fetch` — the server. It answers with the response body the
 *     framework's runtime authoring gate actually sends.
 *
 * ## Scope — deliberately NOT a bigger test at either end
 *
 * This asserts the CONNECTION and nothing else. The tier (warning, never
 * error), the per-finding formatting and the empty-list drop are the renderer
 * suite's; `withEnvironment` clone survival and the response-shape filtering
 * are the producer suites'. Duplicating any of them here would grow the suite
 * without closing the hole this file exists to close.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

// The one stub in the middle of the chain — see the module doc. `toast` is
// imported by `useMetadata.ts` as a module binding, so it cannot be handed over
// the way `saveAdvisoryToast.test.ts` hands over its sink.
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
import { useMetadataClient } from './useMetadata';

/**
 * The measured `nightly_purge` finding, in the gate's D3 shape. All six keys
 * are required — `readSaveAdvisories` drops anything half-shaped, so a fixture
 * missing one would make this file pass for the wrong reason.
 */
const PURGE_ADVISORY = {
  severity: 'warning' as const,
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

/** A committed write the gate had something to say about. */
const ADVISED_BODY = {
  success: true,
  version: 'sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  seq: 7,
  advisories: [PURGE_ADVISORY],
};

/** The same write, clean. The server omits `advisories` entirely. */
const CLEAN_BODY = {
  success: true,
  version: 'sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  seq: 7,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function serverAnswers(body: unknown) {
  fetchMock = vi.fn(async () => jsonResponse(body));
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  vi.mocked(toast.warning).mockClear();
  serverAnswers(ADVISED_BODY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** The `(title, options)` pair the sink was called with. */
function warningCall(): [string, { description?: string; duration?: number } | undefined] {
  const calls = vi.mocked(toast.warning).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0] as [string, { description?: string; duration?: number } | undefined];
}

describe('useMetadataClient — an emitted advisory reaches the toast sink', () => {
  it('SAVE door: a save whose response carries findings renders them', async () => {
    const { result } = renderHook(() => useMetadataClient());

    await result.current.save('flow', 'nightly_purge', { name: 'nightly_purge' });

    const [title, options] = warningCall();
    // The verb proves the DOOR discriminator survived the whole seam: it is set
    // by the producer and read by the renderer, and nothing in between may lose
    // or rewrite it.
    expect(title).toMatch(/^Saved\b/);
    // The finding itself arrived — not merely "something was toasted".
    expect(options?.description).toContain(PURGE_ADVISORY.message);
    expect(options?.description).toContain(PURGE_ADVISORY.rule);
  });

  it('PUBLISH door: the same client, the same sink, the published verb', async () => {
    const { result } = renderHook(() => useMetadataClient());

    // `publishDraft` rather than `publish` because it is what the console's own
    // publish path (`usePublishAllDrafts`) calls through THIS hook.
    await result.current.publishDraft('flow', 'nightly_purge');

    const [title, options] = warningCall();
    expect(title).toMatch(/^Published\b/);
    expect(options?.description).toContain(PURGE_ADVISORY.message);
  });

  it('CONTROL: a clean write says nothing at either door', async () => {
    serverAnswers(CLEAN_BODY);
    const { result } = renderHook(() => useMetadataClient());

    await result.current.save('flow', 'nightly_purge', { name: 'nightly_purge' });
    await result.current.publishDraft('flow', 'nightly_purge');

    // The zero above is only a reading beside a control that MUST hit: both
    // writes really did travel the chain, so "the sink stayed quiet" is about
    // the empty advisory list and not about a chain that never ran.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
