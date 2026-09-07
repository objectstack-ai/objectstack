// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15999 ruling item 3, the PRIORITY row] The parent-governed download gate
 * answers an authorization-store OUTAGE as the `503 SERVICE_UNAVAILABLE` the
 * brand declares — not as its own `403` capability denial.
 *
 * ## What was measured, and why this row came first
 *
 * `buildFileReadAuthorizer` re-raises `AuthzStoreUnavailableError` rather than
 * returning `'deny'` (#13279). `registerStorageRoutes`' `authorizeDownload`
 * then wrapped the whole authorizer call in `catch { verdict = 'deny' }` one
 * frame up, so the re-raise was absorbed and the outage rendered as
 * `403 FILE_DOWNLOAD_DENIED` / `403 ATTACHMENT_DOWNLOAD_DENIED`. Fail-CLOSED,
 * never an admission — but indistinguishable on the wire from a genuine
 * refusal, which is the exact confusion #13279 exists to prevent, and the worst
 * shape in this card's six-site census (the datasource and settings families
 * lost the envelope into a 500; this one lost it into a *verdict*).
 *
 * ## RELAY, not re-raise — and the measurement that decides it
 *
 * A bare re-raise from this `catch` escapes into the route's own outer
 * `catch (err) { sendError(res, 500, 'INTERNAL', …) }`, which answers a bare
 * `500 INTERNAL`: no longer wrong-but-informative, merely opaque. The shared
 * render that would give an escaped ADR-0112 envelope its declared status is
 * #16545 and has not landed. So this door RELAYS — it answers the declared
 * envelope before the throw escapes, which is correct today and stays correct
 * once #16545 lands (the shared render then only sees what no route relayed).
 * `badRequest` in `service-datasource`'s `admin-routes.ts` has used the same
 * shape for a service-thrown `503`/`SERVICE_UNAVAILABLE` since #6504.
 *
 * ## What the controls are for
 *
 * A door that answered 503 for EVERYTHING would pass an outage-only suite while
 * taking every download offline, and a relay widened past the brand would let
 * an unrelated coded throw pick this gate's status. So both directions are
 * driven here:
 *
 *  - `allow` still serves and still mints (§1);
 *  - `deny` still answers its own 403, in BOTH spellings — the field-owned
 *    `FILE_DOWNLOAD_DENIED` and the attachments-scope `ATTACHMENT_DOWNLOAD_DENIED`
 *    (§1), so the relay cannot be read as having replaced the refusal;
 *  - `unauthenticated` still answers 401 (§1);
 *  - ⭐ a NON-branded throw from the authorizer still falls closed to that same
 *    403 (§3). That is the arm that pins the relay's WIDTH: it is scoped to the
 *    brand, and a failed authz check must never fall open.
 *
 * Both download doors are driven for every arm — `/files/:fileId/url` and the
 * `/files/:fileId` redirect sibling are one decision reached two ways, and the
 * outage repair is worth nothing if only one of them learned it.
 *
 * ⛔ Nothing here asserts `toThrow()`: an unrepaired door throws too. The claim
 * is the ENVELOPE — `status` and `code` — per ADR-0112.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AuthzStoreUnavailableError,
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
} from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';

const BASE = '/api/v1/storage';

/** The field-owned subject file — its refusal spelling is `FILE_DOWNLOAD_DENIED`. */
const FIELD_OWNED = 'f_owned';
/** The attachments-scope subject — its refusal spelling is `ATTACHMENT_DOWNLOAD_DENIED`. */
const ATTACHED = 'f_attached';

interface Captured {
  status: number;
  body: any;
  headers: Record<string, string>;
  /** Did the adapter MINT a capability? The fact a status-only suite cannot see. */
  minted: number;
}

async function tmpAdapter(): Promise<LocalStorageAdapter> {
  const rootDir = join(tmpdir(), `os-15999-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  return new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret-15999' });
}

async function seededStore(): Promise<StorageMetadataStore> {
  const store = new StorageMetadataStore(null);
  await store.createFile({
    id: FIELD_OWNED,
    key: `user/${FIELD_OWNED}.png`,
    name: 'x.png',
    status: 'committed',
    acl: 'private',
    scope: 'user',
    ref_object: 'product',
    ref_id: 'p1',
  } as any);
  await store.createFile({
    id: ATTACHED,
    key: `attachments/${ATTACHED}.bin`,
    name: 'y.bin',
    status: 'committed',
    acl: 'private',
    scope: 'attachments',
  } as any);
  return store;
}

type Authorizer = NonNullable<Parameters<typeof registerStorageRoutes>[3]>['authorizeFileRead'];

async function harness(authorizeFileRead: Authorizer) {
  const storage = await tmpAdapter();
  const store = await seededStore();
  const routes = new Map<string, RouteHandler>();
  const http = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  let minted = 0;
  const original = storage.getPresignedDownload.bind(storage);
  (storage as any).getPresignedDownload = async (...args: unknown[]) => {
    minted += 1;
    return (original as any)(...args);
  };
  registerStorageRoutes(http as any, storage as any, store, { basePath: BASE, authorizeFileRead });

  return async (door: 'url' | 'redirect', fileId: string): Promise<Captured> => {
    const path = door === 'url' ? `${BASE}/files/:fileId/url` : `${BASE}/files/:fileId`;
    const handler = routes.get(`GET:${path}`);
    if (!handler) throw new Error(`fixture: no handler for GET ${path}`);
    const captured: Captured = { status: 200, body: undefined, headers: {}, minted: 0 };
    const res: any = {
      json(data: any) { captured.body = data; return res; },
      send() { return res; },
      status(code: number) { captured.status = code; return res; },
      header(n: string, v: string) { captured.headers[n] = v; return res; },
    };
    await handler(
      { params: { fileId }, query: {}, body: undefined, headers: {}, method: 'GET', path } as IHttpRequest,
      res as IHttpResponse,
    );
    captured.minted = minted;
    return captured;
  };
}

const codeOf = (c: Captured) => c.body?.error?.code;
const DOORS: Array<'url' | 'redirect'> = ['url', 'redirect'];

// ---------------------------------------------------------------------------
// §1 — Controls, in every direction, BEFORE any subject arm.
// ---------------------------------------------------------------------------

describe('[#15999] §1 — the download gate still serves, still refuses, still challenges', () => {
  it.each(DOORS)('CONTROL · `allow` serves and MINTS a capability (%s door)', async (door) => {
    const call = await harness(async () => 'allow');
    const res = await call(door, FIELD_OWNED);
    expect(res.status).toBe(door === 'url' ? 200 : 302);
    expect(res.minted).toBe(1);
  });

  it.each(DOORS)('CONTROL · `deny` on a FIELD-OWNED file is still 403 FILE_DOWNLOAD_DENIED (%s door)', async (door) => {
    const call = await harness(async () => 'deny');
    const res = await call(door, FIELD_OWNED);
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('FILE_DOWNLOAD_DENIED');
    expect(res.minted).toBe(0);
  });

  it.each(DOORS)('CONTROL · `deny` on an ATTACHMENTS-scope file is still 403 ATTACHMENT_DOWNLOAD_DENIED (%s door)', async (door) => {
    const call = await harness(async () => 'deny');
    const res = await call(door, ATTACHED);
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('ATTACHMENT_DOWNLOAD_DENIED');
    expect(res.minted).toBe(0);
  });

  it.each(DOORS)('CONTROL · `unauthenticated` is still 401 AUTH_REQUIRED (%s door)', async (door) => {
    const call = await harness(async () => 'unauthenticated');
    const res = await call(door, FIELD_OWNED);
    expect(res.status).toBe(401);
    expect(codeOf(res)).toBe('AUTH_REQUIRED');
    expect(res.minted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT. An unreadable authorization store is an OUTAGE.
// ---------------------------------------------------------------------------

describe('[#15999] §2 — an authorization-store outage is relayed as its declared envelope', () => {
  it.each(DOORS)('REPAIRED: %s door answers 503 SERVICE_UNAVAILABLE — was 403 FILE_DOWNLOAD_DENIED', async (door) => {
    const call = await harness(async () => {
      throw new AuthzStoreUnavailableError('sys_user_permission_set');
    });
    const res = await call(door, FIELD_OWNED);
    expect(res.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    expect(res.status).toBe(503);
    expect(codeOf(res)).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    // ⛔ Never the refusal it used to wear.
    expect(codeOf(res)).not.toBe('FILE_DOWNLOAD_DENIED');
    // The SECURITY half is unchanged: an outage mints nothing.
    expect(res.minted).toBe(0);
  });

  it.each(DOORS)('the attachments-scope door relays it too (%s door)', async (door) => {
    const call = await harness(async () => {
      throw new AuthzStoreUnavailableError('sys_attachment');
    });
    const res = await call(door, ATTACHED);
    expect(res.status).toBe(503);
    expect(codeOf(res)).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect(codeOf(res)).not.toBe('ATTACHMENT_DOWNLOAD_DENIED');
    expect(res.minted).toBe(0);
  });

  it('the operator learns WHICH read failed — the message names the object, and says it is not a denial', async () => {
    const call = await harness(async () => {
      throw new AuthzStoreUnavailableError('sys_user_permission_set');
    });
    const res = await call('url', FIELD_OWNED);
    expect(res.body?.error?.message).toContain('sys_user_permission_set');
    expect(res.body?.error?.message).toContain('not a permission denial');
    // ⛔ And the envelope is the declared one, not a hand-rolled sibling.
    expect(res.body).toMatchObject({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('the redirect door issues NO Location on an outage', async () => {
    const call = await harness(async () => {
      throw new AuthzStoreUnavailableError('sys_attachment');
    });
    const res = await call('redirect', ATTACHED);
    expect(res.headers.Location).toBeUndefined();
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// §3 — THE WIDTH PIN. The relay is scoped to the brand; everything else still
// falls closed. Without this arm the repair could be a blanket "any throw is a
// 503", which would fail OPEN on faults that must stay refusals.
// ---------------------------------------------------------------------------

describe('[#15999] §3 — every OTHER throw still falls closed to the gate\'s own 403', () => {
  it.each(DOORS)('a plain Error from the authorizer is still 403, never 503 (%s door)', async (door) => {
    const call = await harness(async () => { throw new Error('some unrelated fault'); });
    const res = await call(door, FIELD_OWNED);
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('FILE_DOWNLOAD_DENIED');
    expect(res.minted).toBe(0);
  });

  it('a throw carrying a DIFFERENT declared status does not get to pick this gate\'s answer', async () => {
    // The brand is the predicate, not "has a `status`". A coded refusal from
    // somewhere else in the authorizer must not be relayed as though the store
    // were unreadable.
    const call = await harness(async () => {
      const e = Object.assign(new Error('teapot'), { status: 418, code: 'TEAPOT' });
      throw e;
    });
    const res = await call('url', FIELD_OWNED);
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('FILE_DOWNLOAD_DENIED');
  });

  it('an object carrying ONLY the declared status+code but no brand is not relayed either', async () => {
    // The brand survives module duplication where `instanceof` does not
    // (`authz-store-unavailable.ts` module doc); the converse is that a
    // look-alike without it is NOT this error, and must not be treated as one.
    const call = await harness(async () => {
      throw Object.assign(new Error('look-alike'), {
        status: AUTHZ_STORE_UNAVAILABLE_STATUS,
        code: AUTHZ_STORE_UNAVAILABLE_CODE,
      });
    });
    const res = await call('url', FIELD_OWNED);
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('FILE_DOWNLOAD_DENIED');
  });
});
