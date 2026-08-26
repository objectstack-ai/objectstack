// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/meta` registration ORDER (#7526).
 *
 * The `/meta` family is the one place on this server where a route's position
 * in the registration sequence decides whether it can ever run. Hono is
 * first-match-wins (measured in `plugin-hono-server`'s
 * `mounted-route-introspection.test.ts`), and this family used to carry two
 * catch-alls that shadow their literal siblings:
 *
 *   * `GET /meta/:type` swallows every one-segment path — `diagnostics`,
 *     `_drafts`, `types` — that is not registered ahead of it;
 *   * `GET /meta/:type/:section/:name` swallowed every three-segment path —
 *     `/history`, `/audit`, `/diff`, `/published` — likewise. [#12195] That
 *     one is RETIRED with compound-name addressing, so the hazard is gone
 *     rather than ordered around; the pin below inverted to match, because a
 *     re-mount is how the hazard comes back and an order pin phrased against
 *     the retired route would go green while the retirement is undone.
 *
 * `GET /meta/types` and `GET /meta/:type/:name/published` were both DEAD in
 * shipped builds for the second reason apiece: one was never registered at
 * all, the other never registered at all. Registering them is only half the
 * fix; leaving the order unpinned means the next person who tidies this
 * function can silently undo it, and the failure is a plausible 200 rather
 * than an error.
 *
 * WHY THIS AND NOT ONLY THE PARITY GATE. The dogfood parity gate
 * (`route-ledger-live-mount-parity.dogfood.test.ts`) catches the same breakage
 * against a real booted server, and it is the stronger check. This one is
 * cheap, runs in this package's own unit suite, and names the constraint at
 * the file it constrains — so the feedback arrives while the edit is being
 * made rather than at the end of a 20-second boot in another package.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createCapableProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({}),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
    getData: vi.fn().mockResolvedValue({}),
    createData: vi.fn().mockResolvedValue({ id: '1' }),
    updateData: vi.fn().mockResolvedValue({}),
    deleteData: vi.fn().mockResolvedValue({ success: true }),
  };
}

/** `GET /api/v1/meta/...` keys in the order the server registered them. */
function metaRoutesInOrder(): string[] {
  const rest = new RestServer(createMockServer() as any, createCapableProtocol() as any, {} as any);
  rest.registerRoutes();
  return rest
    .getRoutes()
    .map((r) => `${r.method.toUpperCase()} ${r.path}`)
    .filter((k) => k.includes('/api/v1/meta'));
}

/** Index of a route key, or `-1`. Fails loudly rather than returning a lie. */
function indexOf(order: string[], key: string): number {
  const i = order.indexOf(key);
  expect(i, `${key} is not registered at all — the route cannot serve, in any order`).toBeGreaterThanOrEqual(0);
  return i;
}

describe('/meta registration order', () => {
  it('registers every one-segment literal BEFORE the GET /meta/:type catch-all', () => {
    const order = metaRoutesInOrder();
    const catchAll = indexOf(order, 'GET /api/v1/meta/:type');

    for (const literal of [
      'GET /api/v1/meta/types',
      'GET /api/v1/meta/diagnostics',
      'GET /api/v1/meta/_drafts',
    ]) {
      expect(
        indexOf(order, literal),
        `${literal} is registered AFTER GET /api/v1/meta/:type, so it is mounted and unreachable — `
        + 'the catch-all answers it with a plausible 200 that no client can tell from an empty result',
      ).toBeLessThan(catchAll);
    }
  });

  // [#12195] The three compound arities are RETIRED, so the two pins that used
  // to live here — "every three-segment literal precedes the compound-name
  // catch-all" and "the FSM state read precedes the compound `/published`
  // twin" — no longer have a second route to order against.
  //
  // ⛔ They are NOT deleted as satisfied. Both pinned a SHADOWING hazard, and
  // the way that hazard returns is a compound arity being mounted again, at
  // which point an order pin phrased against it would go green while the
  // retirement it guards is undone. So the pin is INVERTED: the constraint is
  // now that these paths are not registered AT ALL, which is the statement
  // that actually holds after the removal and the one a re-mount breaks.
  it('mounts NO compound `:section` arity — the retired catch-all stays retired', () => {
    const order = metaRoutesInOrder();
    const compound = order.filter((key) => key.includes(':section'));
    expect(
      compound,
      'a compound-name arity is mounted again. #12176 retired compound metadata '
      + 'item names and #12194 refuses every slash-bearing name at the publish door, '
      + 'so this route can only be reached by a name that cannot be created — and as '
      + 'a three-segment catch-all it shadows /history, /audit, /diff, /published '
      + 'and /layers on the way',
    ).toEqual([]);
  });

  it('keeps every three-segment literal mounted after the catch-all above them went away', () => {
    // The companion half: removing the shadowing route must not have removed
    // the routes it used to shadow. Without this, the pin above is satisfied
    // by deleting the whole family.
    const order = metaRoutesInOrder();
    for (const literal of [
      'GET /api/v1/meta/:type/:name/published',
      'GET /api/v1/meta/:type/:name/history',
      'GET /api/v1/meta/:type/:name/audit',
      'GET /api/v1/meta/:type/:name/diff',
      'GET /api/v1/meta/:type/:name/references',
      'GET /api/v1/meta/:type/:name/layers',
    ]) {
      expect(order, `${literal} is no longer registered`).toContain(literal);
    }
  });

  it('keeps the FSM state read mounted — it is now the ONLY reading of its path', () => {
    const order = metaRoutesInOrder();
    // `/meta/object/x/state/published` used to be a collision: the compound
    // `/published` twin read it as "the published version of the compound name
    // object/x/state", and only the two literal segments winning kept the FSM
    // reading. With the twin retired nothing else matches four segments.
    indexOf(order, 'GET /api/v1/meta/object/:name/state/:field');
    expect(order.filter((k) => k.includes(':section') && k.endsWith('/published'))).toEqual([]);
  });

  it('mounts the three routes #7526 found dead', () => {
    const order = metaRoutesInOrder();
    for (const key of [
      'GET /api/v1/meta/types',
      'GET /api/v1/meta/:type/:name/published',
      'GET /api/v1/meta/object/:name/state/:field',
    ]) {
      expect(order, `${key} is not registered — this is the #7526 defect returning`).toContain(key);
    }
  });

  it('no longer registers the plural FSM state read (#9180 step 2)', () => {
    // The retirement is the ruling's substance, so it is pinned as a fact
    // about the mount table rather than left to the ledger's prose: the
    // `/meta` type segment is singular, always, and re-adding the plural
    // registration would restore the two-dialect surface the ruling retired.
    //
    // This asserts the withdrawal of a DECLARED route only. It says nothing
    // about `META_URL_TO_SINGULAR`, which this route never consulted (it
    // matches a literal segment, not a `:type` param) and which step 2 leaves
    // exactly as it found it.
    expect(metaRoutesInOrder())
      .not.toContain('GET /api/v1/meta/objects/:name/state/:field');
  });
});
