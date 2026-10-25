// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11797 — concurrent `fetchPackages()` calls share one request.
 *
 * Opening a package mounts three readers of `GET /api/v1/packages` at once —
 * the switcher list, the writability courtesy gate and the namespace lookup
 * (the `PACKAGE_LIST_TOAST_ID` doc in `StudioDesignSurface.tsx` names all
 * three) — and each one sent its own request. Counted on the wire here: the
 * stubbed `fetch` holds every request open until the test answers it, so
 * "at once" means the first request is genuinely pending when the next call
 * is made.
 *
 * A `.tsx` file for its environment, not for JSX: the
 * `objectui:packages-changed` announcement is a `window` event, and only the
 * DOM project has a `window`.
 *
 * The rules pinned besides the one-request count:
 *   - every caller gets its own parsed list;
 *   - the entry goes when the request settles, so a later call asks again (no
 *     reuse window);
 *   - a failure reaches every caller that shared it and is not remembered;
 *   - a duplicate, or a create/edit announced by `objectui:packages-changed`,
 *     drops the pending request, so a read asked after it is never answered
 *     by a request sent before it;
 *   - a request only answers callers of the `fetch` it went through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { duplicatePackage, fetchPackages } from './packages-io';

interface HeldRequest {
  method: string;
  url: string;
  respond: (status: number, body: unknown) => void;
}

function heldFetch() {
  const held: HeldRequest[] = [];
  const fn = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        held.push({
          method: (init?.method ?? 'GET').toUpperCase(),
          url: String(input),
          respond: (status, body) =>
            resolve(
              new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
        });
      }),
  );
  vi.stubGlobal('fetch', fn);
  const listReads = () => held.filter((r) => r.method === 'GET' && r.url === '/api/v1/packages');
  return { held, listReads };
}

async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const listBody = (...ids: string[]) => ({
  data: { packages: ids.map((id) => ({ manifest: { id, name: id }, writable: true })) },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPackages — concurrent calls share one request (objectui#11797)', () => {
  it('three readers mounting at once put one GET on the wire, and each gets its own list', async () => {
    const { listReads } = heldFetch();
    const calls = [fetchPackages(), fetchPackages(), fetchPackages()];
    await drain();
    expect(listReads()).toHaveLength(1);

    listReads()[0].respond(200, listBody('com.acme.crm'));
    const [a, b, c] = await Promise.all(calls);
    expect(a.map((p) => p.id)).toEqual(['com.acme.crm']);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(b).not.toBe(a);
    expect(b[0]).not.toBe(a[0]);
  });

  it('a caller editing its list or an entry in its own continuation leaves another caller untouched', async () => {
    // Every caller parses the shared payload itself, and `PkgEntry` holds only
    // primitives, so no caller is handed anything that points into the payload
    // or into another caller's list.
    const { listReads } = heldFetch();
    const first = fetchPackages().then((mine) => {
      mine[0].name = 'edited-by-first';
      mine.push({ id: 'com.acme.extra', name: 'extra', writable: false, namespace: null });
      return mine;
    });
    const second = fetchPackages();
    await drain();
    listReads()[0].respond(200, listBody('com.acme.crm'));

    expect((await first).map((p) => p.name)).toEqual(['edited-by-first', 'extra']);
    expect(await second).toEqual([{ id: 'com.acme.crm', name: 'com.acme.crm', writable: true, namespace: 'crm' }]);
  });

  it('is not a response cache: once the request settles, the next call asks the server again', async () => {
    const { listReads } = heldFetch();
    const first = fetchPackages();
    await drain();
    listReads()[0].respond(200, listBody('com.acme.crm'));
    await first;

    const later = fetchPackages();
    await drain();
    expect(listReads()).toHaveLength(2);
    listReads()[1].respond(200, listBody('com.acme.crm', 'com.acme.hr'));
    expect((await later).map((p) => p.id)).toEqual(['com.acme.crm', 'com.acme.hr']);
  });

  it('rejects every caller that shared a failed request, and does not remember the failure', async () => {
    const { listReads } = heldFetch();
    const first = fetchPackages();
    const second = fetchPackages();
    await drain();
    expect(listReads()).toHaveLength(1);
    listReads()[0].respond(503, {
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Package service is restarting.' },
    });
    await expect(first).rejects.toThrow('Package service is restarting.');
    await expect(second).rejects.toThrow('Package service is restarting.');

    const retry = fetchPackages();
    await drain();
    expect(listReads()).toHaveLength(2);
    listReads()[1].respond(200, listBody('com.acme.crm'));
    await expect(retry).resolves.toHaveLength(1);
  });

  it('after a duplicate, a read goes to the server even while a read from before it is still pending', async () => {
    const { held, listReads } = heldFetch();
    const before = fetchPackages();
    await drain();

    const duplicating = duplicatePackage('com.acme.crm', 'com.acme.crm_copy');
    await drain();
    const post = held.find((r) => r.method === 'POST')!;
    expect(post.url).toBe('/api/v1/packages/com.acme.crm/duplicate');
    post.respond(200, { success: true, data: { success: true, copiedCount: 1, failedCount: 0 } });
    await duplicating;

    const after = fetchPackages();
    await drain();
    expect(listReads()).toHaveLength(2);

    // The read asked before the write still answers the caller that held it.
    listReads()[0].respond(200, listBody('com.acme.crm'));
    listReads()[1].respond(200, listBody('com.acme.crm', 'com.acme.crm_copy'));
    await expect(before).resolves.toHaveLength(1);
    await expect(after).resolves.toHaveLength(2);
  });

  it('a failed duplicate drops the pending read too', async () => {
    const { held, listReads } = heldFetch();
    void fetchPackages();
    await drain();
    const duplicating = duplicatePackage('com.acme.crm', 'com.acme.crm_copy');
    await drain();
    held.find((r) => r.method === 'POST')!.respond(500, { success: false, error: { message: 'copy failed midway' } });
    await expect(duplicating).rejects.toThrow('copy failed midway');

    void fetchPackages();
    await drain();
    expect(listReads()).toHaveLength(2);
  });

  it('after `objectui:packages-changed`, a read goes to the server even while one from before is pending', async () => {
    const { listReads } = heldFetch();
    void fetchPackages();
    await drain();

    window.dispatchEvent(new CustomEvent('objectui:packages-changed'));
    void fetchPackages();
    await drain();
    expect(listReads()).toHaveLength(2);
  });

  it('a request only answers callers of the fetch it went through', async () => {
    const first = heldFetch();
    void fetchPackages();
    await drain();
    const second = heldFetch();
    void fetchPackages();
    await drain();
    expect(first.listReads()).toHaveLength(1);
    expect(second.listReads()).toHaveLength(1);
  });
});
