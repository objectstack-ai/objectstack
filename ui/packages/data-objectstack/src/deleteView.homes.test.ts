/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import { MetadataClient } from './metadata-client';
import { formatMetadataError } from './metadata-error';

/**
 * `deleteView` removes every home the view has (#4479).
 *
 * A view has two possible homes — the pending per-item DRAFT
 * (`DELETE /meta/view/:name?state=draft`) and the PUBLISHED overlay
 * (`DELETE /meta/view/:name`) — and `deleteView` used to address only the
 * published one. The three cases, and what each used to do:
 *
 * | case               | before #4479                                        |
 * |--------------------|-----------------------------------------------------|
 * | draft-only view    | BUG — hits the published overlay, `reset:false`, the |
 * |                    | draft survives and the tab is back after reload      |
 * | published-only     | correct — `reset:true`, tab gone                     |
 * | published + draft  | ACCIDENTALLY correct — the published row goes, so    |
 * |                    | the tab goes; the orphan draft is left behind        |
 *
 * The third row is why the mirror of #4139 is NOT mechanical.
 * `persistRuntimeMetadata` (app-shell) stages **every** runtime edit as a
 * draft, so "publish a view, then edit it" routinely produces a pair — and a
 * naive draft-FIRST-only mirror would have discarded just the draft there,
 * silently downgrading **Delete view** into **Discard draft**, which is a
 * different operation that already exists (`discardRuntimeDraft`).
 *
 * The ruling on #4479: delete BOTH homes, draft first. Draft first because a
 * failure between the two calls then leaves the PUBLISHED overlay intact and
 * the operation cleanly retryable — the reverse order strands a draft-only
 * view, which is this card's original bug shape.
 *
 * ## The wire these pins model
 *
 * Every receipt below is the framework's own, read verbatim from
 * `packages/metadata-protocol/src/protocol.ts` (`deleteMetaItem`) — the
 * no-row branch and the delete-ful branch. Both no-row answers are a **200**
 * carrying `reset:false`, NOT a 404:
 *
 * - no draft pending  -> `{success:true, reset:false, message:"No pending draft for view/x."}`
 * - no published row  -> `{success:true, reset:false, message:"No view 'x' found — nothing to delete."}`
 *
 * That measurement is what makes a blind two-call implementation legitimate
 * here: neither "missing home" answer is an error, so there is nothing for a
 * probe to protect against and the probe `updateView` needs (its read must
 * resolve the row it is about to merge onto) has no counterpart for a delete.
 *
 * Nothing here mocks `deleteView`. The adapter is real and drives a
 * wire-shaped `fetch`; the SDK stand-in on `ds.client.meta.deleteItem`
 * mirrors the real client's transport (same URL, same `unwrapResponse`) so
 * that the pins address the REQUEST, not the transport that issued it.
 */

const VIEW = 'account.my_pipeline';

/** Framework receipt: a draft row existed and was discarded. */
const DRAFT_DISCARDED = {
  success: true,
  reset: true,
  seq: 41,
  message: `Draft discarded — view/${VIEW}. [seq=41]`,
};
/** Framework receipt: nothing pending. 200, not 404. */
const NO_DRAFT = {
  success: true,
  reset: false,
  message: `No pending draft for view/${VIEW}.`,
};
/** Framework receipt: a runtime-only published row existed and is gone. */
const PUBLISHED_DELETED = {
  success: true,
  reset: true,
  seq: 42,
  message: `Deleted view '${VIEW}' — it no longer exists. [seq=42]`,
};
/** Framework receipt: no published row. 200, not 404 — the answer #4479 quoted. */
const NO_PUBLISHED = {
  success: true,
  reset: false,
  message: `No view '${VIEW}' found — nothing to delete.`,
};

interface Call {
  /** `'draft'` when the request carried `?state=draft`, else `'published'`. */
  home: 'draft' | 'published';
  method: string;
  url: string;
}

interface Harness {
  ds: any;
  /** Every DELETE against `/meta/view/...`, in issue order. */
  deletes: Call[];
  /** Just the home of each DELETE, in issue order — the ordering pin. */
  order: () => Array<'draft' | 'published'>;
  /** Keys passed to `metadataCache.invalidate`, in order. */
  invalidated: string[];
  baseUrl: string;
  fetchImpl: any;
}

/**
 * Adapter whose two delete addresses answer independently.
 *
 * @param opts.draft      receipt (or Error/status) for `DELETE ...?state=draft`
 * @param opts.published  receipt (or Error/status) for `DELETE ...` (active)
 */
function makeDS(opts: {
  draft?: unknown | { failStatus: number; failBody?: unknown };
  published?: unknown | { failStatus: number; failBody?: unknown };
} = {}): Harness {
  const deletes: Call[] = [];
  const invalidated: string[] = [];
  const baseUrl = 'http://test.local';

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const answer = (spec: unknown) => {
    if (spec && typeof spec === 'object' && 'failStatus' in (spec as any)) {
      const status = (spec as any).failStatus as number;
      const body = (spec as any).failBody ?? { error: { message: 'boom', code: 'server_error' } };
      return json(body, status);
    }
    return json(spec);
  };

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/meta/view/')) {
      if (method === 'DELETE') {
        const home = url.includes('state=draft') ? 'draft' : 'published';
        deletes.push({ home, method, url });
        return answer(home === 'draft' ? opts.draft ?? NO_DRAFT : opts.published ?? NO_PUBLISHED);
      }
      return json({ error: 'not found' }, 404);
    }
    return json({ success: true, data: { capabilities: {}, routes: {} } });
  });

  const ds: any = new ObjectStackAdapter({ baseUrl, fetch: fetchImpl });
  ds.connected = true;
  ds.connectionState = 'connected';

  ds.metadataCache = {
    get: async (_key: string, loader: () => Promise<any>) => loader(),
    invalidate: (key: string) => {
      invalidated.push(key);
    },
    getCachedSync: () => undefined,
    getStats: () => ({}),
  };

  // SDK transport stand-in. NOT a stub of the behaviour under test: it issues
  // the same real request the shipped `client.meta.deleteItem` issues
  // (`${baseUrl}/api/v1/meta/:type/:name`, DELETE) and unwraps the
  // `{success, data}` envelope exactly as `unwrapResponse` does, so the
  // published half is observed at the WIRE whichever transport carries it.
  ds.client = {
    meta: {
      deleteItem: async (type: string, name: string) => {
        const res = await fetchImpl(
          `${baseUrl}/api/v1/meta/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
          { method: 'DELETE' },
        );
        const body: any = await res.json();
        if (!res.ok) {
          throw Object.assign(new Error(body?.error?.message ?? 'request failed'), {
            httpStatus: res.status,
          });
        }
        if (body && typeof body.success === 'boolean' && 'data' in body) return body.data;
        return body;
      },
      getItem: vi.fn(async () => {
        throw Object.assign(new Error('Metadata item not found'), { httpStatus: 404 });
      }),
      saveItem: vi.fn(async () => ({ success: true })),
      getItems: vi.fn(async () => ({ items: [] })),
    },
  };

  return {
    ds,
    deletes,
    order: () => deletes.map((c) => c.home),
    invalidated,
    baseUrl,
    fetchImpl,
  };
}

describe('deleteView removes every home the view has (#4479)', () => {
  // ── Row 1: draft-only — the reported bug ────────────────────────────────
  describe('draft-only view (the #4479 bug row)', () => {
    it('deletes the draft home, so the view is actually gone', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: NO_PUBLISHED });

      const receipt = await h.ds.deleteView('account', VIEW);

      // The user-visible symptom first: before #4479 the only request issued
      // was the unqualified one, the server answered `reset:false` /
      // "nothing to delete", and this receipt came back `{deleted:false}`
      // with the draft untouched and the tab back after reload.
      expect(receipt.deleted).toBe(true);
      // ...because the draft home was never addressed.
      expect(h.order()).toContain('draft');
    });

    it('reports the draft home as the one that had the row', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: NO_PUBLISHED });

      const receipt = await h.ds.deleteView('account', VIEW);

      expect(receipt.draft?.removed).toBe(true);
      expect(receipt.published?.removed).toBe(false);
    });
  });

  // ── Row 2: published-only — correct before, must stay correct ───────────
  describe('published-only view (correct before #4479)', () => {
    it('still deletes the published home and still reports deleted', async () => {
      const h = makeDS({ draft: NO_DRAFT, published: PUBLISHED_DELETED });

      const receipt = await h.ds.deleteView('account', VIEW);

      expect(h.order()).toContain('published');
      // Unchanged from before #4479 — this half was never broken.
      expect(receipt.deleted).toBe(true);
    });

    it('addresses both homes even when only one answers with a row', async () => {
      const h = makeDS({ draft: NO_DRAFT, published: PUBLISHED_DELETED });

      const receipt = await h.ds.deleteView('account', VIEW);

      expect(h.order()).toEqual(['draft', 'published']);
      expect(receipt.draft?.removed).toBe(false);
      expect(receipt.published?.removed).toBe(true);
    });
  });

  // ── Row 3: the pair — accidentally correct before; MUST NOT REGRESS ─────
  describe('published + pending draft pair (must-not-change + the anti-mirror guard)', () => {
    it('MUST NOT CHANGE: the published home is still deleted, so the tab still goes', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: PUBLISHED_DELETED });

      const receipt = await h.ds.deleteView('account', VIEW);

      // This is the assertion a naive draft-first mirror of #4139 would have
      // broken: it would have discarded the draft and returned, leaving the
      // published row serving the view and the tab present after reload.
      expect(h.order()).toContain('published');
      expect(receipt.deleted).toBe(true);
    });

    it('also discards the orphan draft, so a republish cannot resurrect the view', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: PUBLISHED_DELETED });

      const receipt = await h.ds.deleteView('account', VIEW);

      expect(h.order()).toEqual(['draft', 'published']);
      expect(receipt.draft?.removed).toBe(true);
      expect(receipt.published?.removed).toBe(true);
    });

    it('invalidates both view cache keys exactly once (#4363 rule, unchanged)', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: PUBLISHED_DELETED });

      await h.ds.deleteView('account', VIEW);

      // Two homes deleted, still ONE ordered pair: the #4363 rule is per
      // WRITE METHOD, not per request.
      expect(h.invalidated).toEqual([`view:account:${VIEW}`, 'view-overrides:account', 'list:view']);
    });
  });

  // ── Row 4: neither home — the control ───────────────────────────────────
  it('MUST NOT CHANGE: a view with no home at all reports deleted:false', async () => {
    const h = makeDS({ draft: NO_DRAFT, published: NO_PUBLISHED });

    const receipt = await h.ds.deleteView('account', VIEW);

    // Both homes answer 200 `reset:false`. Nothing was removed and the
    // receipt has never claimed otherwise — that answer is preserved.
    expect(receipt.deleted).toBe(false);
  });

  // ── Ordering ────────────────────────────────────────────────────────────
  it('addresses the draft home strictly before the published one', async () => {
    const h = makeDS({ draft: DRAFT_DISCARDED, published: PUBLISHED_DELETED });

    await h.ds.deleteView('account', VIEW);

    expect(h.order()).toEqual(['draft', 'published']);
    expect(h.deletes[0].url).toContain('state=draft');
    expect(h.deletes[1].url).not.toContain('state=draft');
  });

  // ── One transport, one error contract ───────────────────────────────────
  it('sends both deletes to the same `/api/v1/meta/view/:name` route', async () => {
    const h = makeDS({ draft: DRAFT_DISCARDED, published: PUBLISHED_DELETED });

    await h.ds.deleteView('account', VIEW);

    const base = `${h.baseUrl}/api/v1/meta/view/${encodeURIComponent(VIEW)}`;
    expect(h.deletes[0].url).toBe(`${base}?state=draft`);
    expect(h.deletes[1].url).toBe(base);
  });

  // ── Failure paths — updateView's convention: throw, never degrade ───────
  describe('partial failure', () => {
    it('a failing draft delete throws and leaves the published home untouched', async () => {
      const h = makeDS({ draft: { failStatus: 500 }, published: PUBLISHED_DELETED });

      await expect(h.ds.deleteView('account', VIEW)).rejects.toThrow();

      // The whole reason the ruling put the draft FIRST: a mid-operation
      // failure must leave the published overlay serving the view, so the
      // user retries a delete rather than being left with the draft-only
      // shape that is this card's original bug.
      expect(h.order()).toEqual(['draft']);
    });

    it('a failing published delete throws rather than reporting deleted:true', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: { failStatus: 500 } });

      await expect(h.ds.deleteView('account', VIEW)).rejects.toThrow();

      expect(h.order()).toEqual(['draft', 'published']);
    });

    it('the published-half failure carries the partial outcome, never rounds it to true', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: { failStatus: 500 } });

      const err: any = await h.ds.deleteView('account', VIEW).catch((e: any) => e);

      // "draft gone, overlay left" is exactly what the old
      // `{ deleted: boolean }` could not express.
      expect(err.outcome?.deleted).toBe(false);
      expect(err.outcome?.draft?.removed).toBe(true);
      expect(err.outcome?.published?.removed).toBe(false);
      expect(err.cause).toBeDefined();
    });

    it('a non-refusal published failure still says the view is served and to retry, with the server text', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: { failStatus: 500 } });

      const err: any = await h.ds.deleteView('account', VIEW).catch((e: any) => e);
      const shown = formatMetadataError(err);

      expect(shown).toContain('NOT fully removed');
      expect(shown).toContain('retry the delete');
      expect(shown).toContain('boom');
    });

    it('still invalidates the view cache keys when a half fails', async () => {
      const h = makeDS({ draft: DRAFT_DISCARDED, published: { failStatus: 500 } });

      await h.ds.deleteView('account', VIEW).catch(() => undefined);

      // The draft row IS gone, so a cache still holding it is stale for the
      // full TTL. #4363's asymmetry decides it: an unnecessary invalidation
      // costs one refetch, a missed one costs five minutes of stale overrides.
      expect(h.invalidated).toEqual([`view:account:${VIEW}`, 'view-overrides:account', 'list:view']);
    });
  });

  // ── A refused half reaches formatMetadataError (objectui#12416) ─────────
  //
  // Since `@objectstack/rest` 18.0.0-next.1 a package-less delete of a view
  // two packages hold is refused `409 RESOURCE_CONFLICT`, and the door's
  // sentence names the remedy (`?package=`). Callers render a caught error
  // through `formatMetadataError(err)` (the console's Delete view toast,
  // objectui#12398), which reads the error's issues or its OWN message — not
  // `cause`. These pins hold that the remedy reaches that reader from either
  // half, and that a refusal is not answered with "retry".
  describe('a refused half surfaces the server reason through formatMetadataError (objectui#12416)', () => {
    const REMEDY = 'on the REST door add ?package= with the package id';
    const CONFLICT = {
      error:
        `Name the package this delete is for, then send it again: ${REMEDY}, ` +
        `in process pass packageId. Nothing was deleted. view '${VIEW}' belongs to 2 packages ` +
        "('com.acme.alpha', 'com.acme.beta'), and a delete that names none has no single row to remove.",
      code: 'RESOURCE_CONFLICT',
    };

    it('published-half 409: the remedy is shown, the partial state is still said, no retry advice', async () => {
      const h = makeDS({ draft: NO_DRAFT, published: { failStatus: 409, failBody: CONFLICT } });

      const err: any = await h.ds.deleteView('account', VIEW).catch((e: any) => e);
      const shown = formatMetadataError(err);

      expect(shown).toContain(REMEDY);
      expect(shown).toContain(CONFLICT.error);
      expect(shown).toContain('NOT fully removed');
      expect(shown).not.toContain('retry the delete');
      // Additive: the served error is still the cause, status and code intact.
      expect(err.cause?.status).toBe(409);
      expect(err.cause?.code).toBe('RESOURCE_CONFLICT');
      expect(err.outcome?.published?.removed).toBe(false);
    });

    it('draft-half 409: unchanged, the served error itself is thrown', async () => {
      const h = makeDS({ draft: { failStatus: 409, failBody: CONFLICT }, published: PUBLISHED_DELETED });

      const err: any = await h.ds.deleteView('account', VIEW).catch((e: any) => e);

      expect(formatMetadataError(err)).toBe(CONFLICT.error);
      expect(err.status).toBe(409);
      expect(err.code).toBe('RESOURCE_CONFLICT');
      expect(h.order()).toEqual(['draft']);
    });
  });

  // ── discardRuntimeDraft stays a DIFFERENT operation ─────────────────────
  it('stays distinct from Discard draft, which touches only the draft home', async () => {
    // `discardRuntimeDraft` (app-shell `runtime-metadata-persistence.ts`) is
    // documented as "the published overlay is untouched" and is exactly this
    // one call. Driven here through the same primitive rather than imported,
    // because app-shell is downstream of this package — the point is that the
    // two operations issue DIFFERENT request sets against the same wire.
    const h = makeDS({ draft: DRAFT_DISCARDED, published: PUBLISHED_DELETED });

    await new MetadataClient({ baseUrl: h.baseUrl, fetch: h.fetchImpl }).reset('view', VIEW, {
      state: 'draft',
    });
    expect(h.order()).toEqual(['draft']);

    // Same wire, same view: Delete view addresses BOTH homes. If these two
    // ever issue the same request set, one of the operations has been lost.
    const fresh = makeDS({ draft: DRAFT_DISCARDED, published: PUBLISHED_DELETED });
    await fresh.ds.deleteView('account', VIEW);
    expect(fresh.order()).toEqual(['draft', 'published']);
  });
});
