/**
 * objectui#5544 — one network call for N overlapping identical GETs.
 *
 * These pin the four properties the fix stands on. Each one is a way the dedup
 * could look successful while being wrong, so a request-count assertion alone is
 * not enough:
 *
 *  - N concurrent same-key GETs ⇒ ONE call, and every caller gets the data.
 *    (Count-only would also pass if late callers resolved `undefined`.)
 *  - A rejection reaches EVERY sharer, with the status intact, so a caller's
 *    retry policy still sees its 503.
 *  - Different keys never share — different URL, different headers, different
 *    credentials mode. The console asks `get-session` twice on purpose, once
 *    Bearer-only and once by cookie, and those two must stay two.
 *  - A wave that starts AFTER the first settled refetches. This is in-flight
 *    sharing, not a cache: no TTL, no stale window.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HttpFetchError,
  inflightGetKey,
  sharedGetJson,
  resetInflightGetsForTesting,
} from '../index.js';

/** A promise plus its settlers, so a test controls exactly when a fetch answers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The minimum of `Response` that {@link sharedGetJson} reads. */
function jsonResponse(body: unknown, status = 200, retryAfter?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => (name === 'Retry-After' ? (retryAfter ?? null) : null) },
  } as unknown as Response;
}

const URL_A = 'https://example.test/api/v1/runtime/config';
const JSON_GET: RequestInit = { credentials: 'include', headers: { Accept: 'application/json' } };

beforeEach(() => {
  // The `unit` project runs with `isolate: false`, and the registry lives on
  // `globalThis` on purpose — so it MUST be cleared between files, not just
  // between cases.
  resetInflightGetsForTesting();
});

describe('inflightGetKey', () => {
  it('is stable across header spelling and order', () => {
    const a = inflightGetKey(URL_A, { credentials: 'include', headers: { Accept: 'application/json', 'X-Tenant-ID': 't1' } });
    const b = inflightGetKey(URL_A, { credentials: 'include', headers: { 'x-tenant-id': 't1', accept: 'application/json' } });
    expect(a).toBe(b);
  });

  it('separates requests that differ only in credentials mode or headers', () => {
    const cookie = inflightGetKey(URL_A, { credentials: 'include' });
    const bearerOnly = inflightGetKey(URL_A, { credentials: 'omit', headers: { Authorization: 'Bearer x' } });
    expect(cookie).not.toBe(bearerOnly);
  });

  it('is the exact string the pre-boot script in index.html builds by hand', () => {
    // The inline classic script cannot import, so it spells this format out.
    // If the format here changes, that script stops sharing SILENTLY — this
    // assertion is the tripwire, and `apps/console` executes the shipped text
    // against the real function for the end-to-end half.
    expect(inflightGetKey(URL_A, JSON_GET)).toBe(
      `GET\ninclude\n${URL_A}\naccept=application/json`,
    );
  });
});

describe('sharedGetJson', () => {
  it('collapses N concurrent same-key GETs into one call, and answers all of them', async () => {
    const gate = deferred<Response>();
    const fetchImpl = vi.fn(() => gate.promise);

    const callers = [1, 2, 3, 4, 5].map(() =>
      sharedGetJson<{ productName: string }>(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
    );
    gate.resolve(jsonResponse({ productName: 'ObjectOS' }));
    const results = await Promise.all(callers);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Every caller is served — a dedup that starves the late ones would leave
    // `undefined` here and still show a call count of 1.
    expect(results).toHaveLength(5);
    for (const result of results) expect(result).toEqual({ productName: 'ObjectOS' });
  });

  it('hands each caller its own object, so one caller cannot mutate another', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ branding: { productName: 'ObjectOS' } }));
    const [first, second] = await Promise.all([
      sharedGetJson<{ branding: { productName: string } }>(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
      sharedGetJson<{ branding: { productName: string } }>(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).not.toBe(second);
    first!.branding.productName = 'mutated';
    expect(second!.branding.productName).toBe('ObjectOS');
  });

  it('fans a rejection out to every sharer, status intact', async () => {
    const gate = deferred<Response>();
    const fetchImpl = vi.fn(() => gate.promise);

    const callers = [1, 2, 3].map(() =>
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch).then(
        () => ({ ok: true }) as const,
        (err: unknown) => ({ ok: false, err }) as const,
      ),
    );
    gate.resolve(jsonResponse(null, 503, '2'));
    const settled = await Promise.all(callers);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const outcome of settled) {
      expect(outcome.ok).toBe(false);
      const err = (outcome as { err: unknown }).err;
      // `code`+`status` equivalent for this transport: the error class and the
      // status a retry policy reads. A bare "it threw" would pass even if the
      // status were lost, and `LocalizationFetchProvider` decides whether to
      // retry from exactly this.
      expect(err).toBeInstanceOf(HttpFetchError);
      expect((err as HttpFetchError).status).toBe(503);
      expect((err as HttpFetchError).retryAfterMs).toBe(2000);
    }
  });

  it('propagates a thrown fetch (offline) to every sharer', async () => {
    const boom = new Error('network down');
    const fetchImpl = vi.fn(async () => {
      throw boom;
    });
    const outcomes = await Promise.allSettled([
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      expect((outcome as PromiseRejectedResult).reason).toBe(boom);
    }
  });

  it('does not share across different URLs, headers, or credentials modes', async () => {
    const gate = deferred<Response>();
    const fetchImpl = vi.fn(() => gate.promise);

    const all = Promise.all([
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
      sharedGetJson(`${URL_A}?key=ui.recent`, JSON_GET, fetchImpl as unknown as typeof fetch),
      // Same URL, Bearer-only and no cookie — the stale-token probe. Collapsing
      // this into the cookie call would destroy the signal it exists to read.
      sharedGetJson(URL_A, { credentials: 'omit', headers: { Authorization: 'Bearer stale' } }, fetchImpl as unknown as typeof fetch),
    ]);
    gate.resolve(jsonResponse({}));
    await all;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('refetches on a wave that starts after the first settled — no cache, no TTL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ n: 1 }));

    await Promise.all([
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Second wave, strictly after settle.
    await Promise.all([
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('leaves nothing behind after a rejected request, so the next caller retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, 503))
      .mockResolvedValueOnce(jsonResponse({ n: 2 }));

    await expect(sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(
      HttpFetchError,
    );
    await expect(sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch)).resolves.toEqual({ n: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('opts a cancellable request out of sharing, in both directions', async () => {
    const gate = deferred<Response>();
    const fetchImpl = vi.fn(() => gate.promise);

    const all = Promise.all([
      // A caller with its own AbortSignal must neither join…
      sharedGetJson(URL_A, { ...JSON_GET, signal: new AbortController().signal }, fetchImpl as unknown as typeof fetch),
      // …nor be joined: aborting one caller must never cancel another's read.
      sharedGetJson(URL_A, JSON_GET, fetchImpl as unknown as typeof fetch),
      sharedGetJson(URL_A, { ...JSON_GET, signal: new AbortController().signal }, fetchImpl as unknown as typeof fetch),
    ]);
    gate.resolve(jsonResponse({ n: 1 }));
    const results = await all;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const result of results) expect(result).toEqual({ n: 1 });
  });

  it('refuses to share a mutation', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      sharedGetJson(URL_A, { ...JSON_GET, method: 'POST' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('issues a GET even when the caller passed method: GET explicitly', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
    await sharedGetJson(URL_A, { ...JSON_GET, method: 'get' }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe('GET');
  });
});
