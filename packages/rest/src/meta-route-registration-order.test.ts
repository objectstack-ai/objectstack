// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/meta` registration ORDER (#7526).
 *
 * The `/meta` family is the one place on this server where a route's position
 * in the registration sequence decides whether it can ever run. Hono is
 * first-match-wins (measured in `plugin-hono-server`'s
 * `mounted-route-introspection.test.ts`), and this family carries two
 * catch-alls that shadow their literal siblings:
 *
 *   * `GET /meta/:type` swallows every one-segment path — `diagnostics`,
 *     `_drafts`, `types` — that is not registered ahead of it;
 *   * `GET /meta/:type/:section/:name` swallows every three-segment path —
 *     `/history`, `/audit`, `/diff`, `/published` — likewise.
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

  it('registers every three-segment literal BEFORE the compound-name catch-all', () => {
    const order = metaRoutesInOrder();
    const catchAll = indexOf(order, 'GET /api/v1/meta/:type/:section/:name');

    for (const literal of [
      'GET /api/v1/meta/:type/:name/published',
      'GET /api/v1/meta/:type/:name/history',
      'GET /api/v1/meta/:type/:name/audit',
      'GET /api/v1/meta/:type/:name/diff',
      'GET /api/v1/meta/:type/:name/references',
      'GET /api/v1/meta/:type/:name/layers',
    ]) {
      expect(
        indexOf(order, literal),
        `${literal} is registered AFTER GET /api/v1/meta/:type/:section/:name and is therefore shadowed — `
        + 'it answers the compound-name read instead, which for `published` was a stub identical '
        + 'before publish AND for a bogus name',
      ).toBeLessThan(catchAll);
    }
  });

  it('registers the FSM state read before the compound `/published` twin they collide on', () => {
    const order = metaRoutesInOrder();
    // The single colliding path is `/meta/objects/x/state/published`. Two
    // literal segments beat one, so the state-machine reading must win it.
    expect(indexOf(order, 'GET /api/v1/meta/objects/:name/state/:field'))
      .toBeLessThan(indexOf(order, 'GET /api/v1/meta/:type/:section/:name/published'));
    expect(indexOf(order, 'GET /api/v1/meta/object/:name/state/:field'))
      .toBeLessThan(indexOf(order, 'GET /api/v1/meta/:type/:section/:name/published'));
  });

  it('mounts the three routes #7526 found dead', () => {
    const order = metaRoutesInOrder();
    for (const key of [
      'GET /api/v1/meta/types',
      'GET /api/v1/meta/:type/:name/published',
      'GET /api/v1/meta/objects/:name/state/:field',
    ]) {
      expect(order, `${key} is not registered — this is the #7526 defect returning`).toContain(key);
    }
  });
});
