/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4252 — an app the session may not open must be distinguishable from
 * an app that is not there.
 *
 * The app LIST is the generic metadata list route `GET /api/v1/meta/:type`
 * requested with the singular type segment `app`, and the server filters it per
 * session in `filterAppForUser` (`packages/rest/src/rest-server.ts`), so those
 * two conditions are byte-identical in the list: both are simply absent. The
 * maintainer ruling (2026-08-12) put the
 * distinction on the BY-NAME route instead of flagging the list — the
 * enumeration surface is not widened past what a by-name probe already implies
 * — and objectstack#8013 (PR #8135) shipped it:
 *
 *   - EXISTS + session lacks `requiredPermissions` → `403`
 *     `{ success: false, error: { code: 'PERMISSION_DENIED', message } }`
 *   - an unpublished app (ADR-0045 §3 keeps it externally unobservable), an app
 *     gated by an absent optional service (ADR-0057 D10 — nothing was denied to
 *     the CALLER) → `404 RESOURCE_NOT_FOUND`.
 *   - ⭐ a name that resolves to NOTHING → `200` with the declared envelope
 *     MINUS its `item`. Measured on a real server while implementing
 *     objectui#9262 (showcase example, `objectstack` 60b9955, API 17.4.0);
 *     this file previously asserted a 404 here and the assertion was wrong
 *     about the server, not about the code. Both are absence.
 *
 * ## objectui#9262 — the verdicts this file now pins
 *
 * `probeAppAccess` used to answer `granted` whenever the call did not throw,
 * which made every nonexistent app `granted` on a live server, and folded a 404
 * absence together with an unreachable server into one `unknown`. The verdict
 * set widened by two members (`not_found`, `unreachable`) and `unknown` was
 * narrowed to "nothing was asked". Each case below names which answer produced
 * which verdict, because the whole point of the widening is that the screen
 * above it says only what was obtained.
 *
 * Every case here goes through the real `ObjectStackClient` over a stubbed
 * `fetch`, so what is measured includes the client's own error stamping
 * (`error.code` off `body.error.code`, `error.httpStatus` off the status) —
 * the seam a hand-built rejection would have skipped straight past.
 *
 * The discrimination is on the ADR-0112 CODE, never the status (objectui#4408),
 * and the last two cases are what hold that: they cross the two apart, so a
 * reimplementation that reads `httpStatus === 403` goes red in both directions
 * rather than passing on the happy path.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ObjectStackAdapter,
  isAppPermissionDeniedError,
  isMetaItemAbsentError,
  APP_PERMISSION_DENIED_CODE,
  META_ITEM_ABSENT_CODE,
} from './index';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The 403 body objectstack#8135 emits, transcribed from that merged diff. */
const DENIED_BODY = {
  success: false,
  error: {
    code: 'PERMISSION_DENIED',
    message: "You do not have permission to open the 'finance' app.",
  },
};

/** The 404 absence body — an app that EXISTS and is withheld for a non-permission reason. */
const ABSENT_BODY = {
  error: { code: 'RESOURCE_NOT_FOUND', message: 'Metadata item not found or access denied.' },
};

/**
 * The 200 a real server gives for a name with nothing behind it, transcribed
 * from the live response (see the header). It is the declared
 * `GetMetaItemResponse` envelope with `item` — a REQUIRED member of that schema
 * — simply not there. In `rest-server.ts` the 403 and the 404 both sit inside
 * `if (isAppType && visible)`, so a name that resolves to no document skips the
 * gate entirely and the envelope falls through to `res.json`.
 */
const ITEMLESS_ENVELOPE = {
  type: 'app',
  name: 'no_such_app',
  lock: 'none',
  editable: true,
  deletable: true,
  resettable: false,
};

function makeAdapter(answer: (url: string) => Response) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => answer(String(input)));
  const adapter = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
  return { adapter, fetchImpl };
}

describe('isAppPermissionDeniedError', () => {
  it('matches the by-name route\'s denial code, in either ADR-0112 spelling', () => {
    expect(APP_PERMISSION_DENIED_CODE).toBe('PERMISSION_DENIED');
    expect(isAppPermissionDeniedError({ code: 'PERMISSION_DENIED' })).toBe(true);
    // The console is versioned separately from the server it talks to; the
    // pre-ADR-0112 lowercase spelling still resolves (`errorCodeIs`).
    expect(isAppPermissionDeniedError({ code: 'permission_denied' })).toBe(true);
  });

  it('does NOT match absence, the enable-block denials, or a bare status', () => {
    expect(isAppPermissionDeniedError({ code: 'RESOURCE_NOT_FOUND' })).toBe(false);
    // `API_ACCESS_DENIED_CODES` (objectui#4408) is a different question: those
    // are pure functions of an object's `enable` metadata and identical for
    // every persona. This one is a statement about the caller.
    expect(isAppPermissionDeniedError({ code: 'OBJECT_API_DISABLED' })).toBe(false);
    expect(isAppPermissionDeniedError({ httpStatus: 403 })).toBe(false);
    expect(isAppPermissionDeniedError(undefined)).toBe(false);
  });
});

describe('isMetaItemAbsentError', () => {
  it("matches the metadata routes' absence code, in either ADR-0112 spelling", () => {
    expect(META_ITEM_ABSENT_CODE).toBe('RESOURCE_NOT_FOUND');
    expect(isMetaItemAbsentError({ code: 'RESOURCE_NOT_FOUND' })).toBe(true);
    expect(isMetaItemAbsentError({ code: 'resource_not_found' })).toBe(true);
  });

  it('does NOT match a denial, or a bare 404 status', () => {
    // The two answers must never cross: a denial read as absence would tell a
    // user their permission problem is a typo, and the reverse tells them their
    // typo is a permission problem (objectui#4252's defect, both ways round).
    expect(isMetaItemAbsentError({ code: 'PERMISSION_DENIED' })).toBe(false);
    expect(isMetaItemAbsentError({ httpStatus: 404 })).toBe(false);
    expect(isMetaItemAbsentError(undefined)).toBe(false);
    expect(isAppPermissionDeniedError({ code: META_ITEM_ABSENT_CODE })).toBe(false);
  });
});

describe('ObjectStackAdapter.probeAppAccess — over the wire', () => {
  it('reports `denied` for the 403 PERMISSION_DENIED envelope', async () => {
    const { adapter, fetchImpl } = makeAdapter(() => json(403, DENIED_BODY));

    await expect(adapter.probeAppAccess('finance')).resolves.toBe('denied');
    // The by-name address, singular — what objectstack#8013 pinned its cases
    // against and what `MetadataProvider` already reads items by.
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/v1/meta/app/finance');
  });

  it('reports `not_found` for the 404 absence envelope', async () => {
    const { adapter } = makeAdapter(() => json(404, ABSENT_BODY));
    await expect(adapter.probeAppAccess('no_such_app')).resolves.toBe('not_found');
  });

  it('THE MEASURED DEFECT — an item-less 200 is `not_found`, not `granted`', async () => {
    // objectui#9262 cause 8, measured on a real server before the branch was
    // written: the by-name route answers 200 for a name that resolves to
    // nothing, so "the call did not throw" reported `granted` for an app that
    // does not exist — and `granted` falls through to the same screen, which is
    // why nobody saw it. Every typo, every never-created app and every
    // unpublished draft took this path.
    const { adapter } = makeAdapter(() => json(200, ITEMLESS_ENVELOPE));
    await expect(adapter.probeAppAccess('no_such_app')).resolves.toBe('not_found');
  });

  it('reports `granted` when the route serves the app', async () => {
    const { adapter } = makeAdapter(() =>
      json(200, { type: 'app', name: 'finance', item: { name: 'finance', label: 'Finance' } }),
    );
    await expect(adapter.probeAppAccess('finance')).resolves.toBe('granted');
  });

  it('a 200 whose `item` is explicitly null is absence too, not a served app', async () => {
    // The envelope member is declared `unknown`, so `null` is a value it can
    // carry. Nothing was served either way — the discriminator is whether a
    // DOCUMENT came back, not whether the key was typed.
    const { adapter } = makeAdapter(() => json(200, { type: 'app', name: 'finance', item: null }));
    await expect(adapter.probeAppAccess('finance')).resolves.toBe('not_found');
  });

  it('reports `unreachable` — never `denied`, never `not_found` — when the server cannot be reached', async () => {
    // Nothing was learned about the app. Reading this as absence would be the
    // #4252 defect mirrored: a screen asserting a state it never measured.
    const { adapter } = makeAdapter(() => {
      throw new Error('network down');
    });
    await expect(adapter.probeAppAccess('finance')).resolves.toBe('unreachable');
  });

  it('reports `unknown` for an empty name without asking anything', async () => {
    // The one surviving `unknown`: nothing was asked, so nothing was measured.
    const { adapter, fetchImpl } = makeAdapter(() => json(200, {}));
    await expect(adapter.probeAppAccess('')).resolves.toBe('unknown');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws — a caller renders a screen off this, not a catch block', async () => {
    const { adapter } = makeAdapter(() => new Response('<html>gateway</html>', { status: 502 }));
    await expect(adapter.probeAppAccess('finance')).resolves.toBe('unreachable');
  });

  it('a 5xx is `unreachable`, and a 404 with no declared code is too', async () => {
    // The absence verdict is earned by the CODE, exactly as the denial is
    // (objectui#4408). A 404 that carries no declared code is a transport fact
    // many things produce — a proxy, an appliance, a mis-typed route — and none
    // of them said the app is missing.
    const { adapter: five } = makeAdapter(() => json(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } }));
    await expect(five.probeAppAccess('finance')).resolves.toBe('unreachable');

    const { adapter: bare } = makeAdapter(() => json(404, { message: 'Not Found' }));
    await expect(bare.probeAppAccess('finance')).resolves.toBe('unreachable');
  });

  // ── code, not status ─────────────────────────────────────────────────────
  //
  // Both directions, because a status-reading implementation passes every case
  // above. 403 is not the fact; `PERMISSION_DENIED` is.

  it('a 403 WITHOUT the code is `unreachable` — a status alone never denies', async () => {
    const { adapter } = makeAdapter(() =>
      json(403, { error: { code: 'CSRF_TOKEN_INVALID', message: 'stale token' } }),
    );
    await expect(adapter.probeAppAccess('finance')).resolves.toBe('unreachable');
  });

  it('the code decides even when the status is not 403', async () => {
    // Hypothetical on today's server, and deliberately so: the contract this
    // console consumes is the code. If the route ever answers the same denial
    // under a different status, the branch must follow the code — and if this
    // case is ever deleted, the reason must be that the CODE changed.
    const { adapter } = makeAdapter(() => json(401, DENIED_BODY));
    await expect(adapter.probeAppAccess('finance')).resolves.toBe('denied');
  });
});

/**
 * objectui#4940 — `getApp` and `getPage` used to address the SAME metadata
 * types this file already pins (`probeAppAccess` above asserts `app`,
 * singular, at line 96) but through the plural collection spelling
 * (`'apps'` / `'pages'`). Both resolved today only because the server folds
 * plural → singular (`RestServer.metaTypeSingular`, `PLURAL_TO_SINGULAR` from
 * `@objectstack/spec/shared`) — so the drift was unexercised, not
 * latent-broken, but nothing asserted either spelling for these two sites.
 * Extending THIS file's pin (rather than opening a new one) keeps the
 * app-type spelling guard in one place: `probeAppAccess` and `getApp`
 * address the same type sixty lines apart in `index.ts`, and a reader should
 * find both assertions together.
 *
 * Unlike `probeAppAccess`, both methods call `connect()` first, which issues
 * its own `/api/v1/discovery` fetch — so asserting on the raw `fetch` mock's
 * first call (the line-96 shape) would race against that unrelated request.
 * These stub `client.meta.getItem` directly instead (the pattern already
 * used by `updateView.draft.test.ts`) and assert the type argument the
 * adapter actually passed, which is a strictly stronger pin than a URL
 * substring: it fails on ANY non-singular spelling, not just `'apps'`.
 */
describe('ObjectStackAdapter.getApp / getPage — meta type spelling (objectui#4940)', () => {
  it('getApp requests the metadata type in the singular', async () => {
    const { adapter } = makeAdapter(() => json(200, {}));
    (adapter as any).connected = true;
    const getItem = vi.fn(async () => ({ item: { name: 'finance', label: 'Finance' } }));
    (adapter as any).client = { meta: { getItem } };

    await adapter.getApp('finance');

    expect(getItem).toHaveBeenCalledWith('app', 'finance');
  });

  it('getPage requests the metadata type in the singular', async () => {
    const { adapter } = makeAdapter(() => json(200, {}));
    (adapter as any).connected = true;
    const getItem = vi.fn(async () => ({ item: { name: 'home', label: 'Home' } }));
    (adapter as any).client = { meta: { getItem } };

    await adapter.getPage('home');

    expect(getItem).toHaveBeenCalledWith('page', 'home');
  });
});

/**
 * objectui#12285 — `probeAppAccess` is handed the URL segment, and ADR-0048
 * §3.1 makes the package id an app's routing key, so the probe is asked with a
 * package id as often as with a name. Since objectstack-ai/objectstack#23183
 * (in `@objectstack/*` `18.0.0-next.2`) the by-name app route answers for that
 * key: a withheld app 403 `PERMISSION_DENIED`, an unknown package 404, a holder
 * 200 with the app under its own `name`. The probe needs no change to read
 * those; these cases pin that it sends the key as given (dots are not encoded
 * away) and reads each answer to the same verdict as for a name. The bodies
 * are transcribed from a live `18.0.0-next.2` backend read while landing this
 * card; nothing here re-derives them.
 */
describe('ObjectStackAdapter.probeAppAccess — a package-id key (objectui#12285)', () => {
  it('reports `denied` for the 403 a withheld app answers on its package id, asked by that key', async () => {
    const { adapter, fetchImpl } = makeAdapter(() =>
      json(403, {
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: "You do not have permission to open the 'com.objectstack.setup' app.",
        },
      }),
    );

    await expect(adapter.probeAppAccess('com.objectstack.setup')).resolves.toBe('denied');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/v1/meta/app/com.objectstack.setup');
  });

  it('reports `not_found` for an unknown package id', async () => {
    const { adapter } = makeAdapter(() => json(404, ABSENT_BODY));
    await expect(adapter.probeAppAccess('com.example.no-such-pkg')).resolves.toBe('not_found');
  });

  it('reports `granted` when a holder is served the app under its own name', async () => {
    const { adapter } = makeAdapter(() =>
      json(200, { type: 'app', name: 'setup', item: { name: 'setup', label: 'Setup' } }),
    );
    await expect(adapter.probeAppAccess('com.objectstack.setup')).resolves.toBe('granted');
  });
});
