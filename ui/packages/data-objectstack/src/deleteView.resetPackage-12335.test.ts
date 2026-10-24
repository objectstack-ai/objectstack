/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import type { MetadataError } from './metadata-client';

/**
 * objectui#12335 — `deleteView` keeps its package-less deletes, and the door's
 * `409 RESOURCE_CONFLICT` leaves it as a thrown error, not swallowed.
 *
 * `deleteView(objectName, viewName)` reaches the delete door through
 * `MetadataClient.reset` twice (draft home, then published home, #4479). It
 * holds no package binding: the shared `DataSource.deleteView?` contract in
 * `@object-ui/types` passes none, so the two resets name none. Since objectstack
 * `543b33dee` (`@objectstack/rest` 18.0.0-next.1) a package-less delete of a
 * view two packages hold is refused `409 RESOURCE_CONFLICT`, deleting nothing.
 * Pinned here: no `package` key on either request, and the refusal reaches the
 * caller with its `status` and `code`, from whichever home refused.
 */

const VIEW = 'account.shared_pipeline';

const AMBIGUOUS = {
  error:
    "Name the package this delete is for, then send it again: on the REST door add ?package= with the package id, " +
    `in process pass packageId. Nothing was deleted. view '${VIEW}' belongs to 2 packages ('com.acme.alpha', 'com.acme.beta'), ` +
    'and a delete that names none has no single row to remove.',
  code: 'RESOURCE_CONFLICT',
};
const NO_DRAFT = { success: true, reset: false, message: `No pending draft for view/${VIEW}.` };

function makeDS(answers: { draft: () => Response; published: () => Response }) {
  const deletes: URLSearchParams[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/meta/view/') && (init?.method ?? 'GET') === 'DELETE') {
      deletes.push(new URLSearchParams(url.search));
      return url.searchParams.get('state') === 'draft' ? answers.draft() : answers.published();
    }
    return json({ success: true, data: { capabilities: {}, routes: {} } });
  });
  const ds = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
  // Connected, with a pass-through metadata cache, as `deleteView.homes.test.ts` sets it up.
  Object.assign(ds as unknown as Record<string, unknown>, {
    connected: true,
    connectionState: 'connected',
    metadataCache: {
      get: async (_key: string, loader: () => Promise<unknown>) => loader(),
      invalidate: () => {},
      getCachedSync: () => undefined,
      getStats: () => ({}),
    },
  });
  return { ds, deletes };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('deleteView — package-less deletes, and a 409 that is thrown (objectui#12335)', () => {
  it('the draft home refuses: deleteView throws the door`s 409 and stops before the published home', async () => {
    const h = makeDS({ draft: () => json(AMBIGUOUS, 409), published: () => json(NO_DRAFT) });

    const err = (await h.ds.deleteView('account', VIEW).catch((e: unknown) => e)) as MetadataError;

    expect(err.status).toBe(409);
    expect(err.code).toBe('RESOURCE_CONFLICT');
    expect(h.deletes).toHaveLength(1);
    expect(h.deletes[0]!.get('state')).toBe('draft');
    expect(h.deletes[0]!.has('package')).toBe(false);
  });

  it('the published home refuses: the thrown error carries the 409 as its cause', async () => {
    const h = makeDS({ draft: () => json(NO_DRAFT), published: () => json(AMBIGUOUS, 409) });

    const err = (await h.ds.deleteView('account', VIEW).catch((e: unknown) => e)) as Error & { cause?: MetadataError };

    expect(err).toBeInstanceOf(Error);
    expect(err.cause?.status).toBe(409);
    expect(err.cause?.code).toBe('RESOURCE_CONFLICT');
    expect(h.deletes).toHaveLength(2);
    for (const q of h.deletes) expect(q.has('package')).toBe(false);
  });
});
