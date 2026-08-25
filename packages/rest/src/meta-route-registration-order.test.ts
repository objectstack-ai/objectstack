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
 * [#11932] The `POST` half arrived later and is pinned here too. Its constraint
 * is REAL but currently LATENT, and the difference is stated rather than
 * blurred, because a reader who assumes the `GET` story applies verbatim will
 * draw the wrong conclusion from a green run: `/meta` mounts NO `POST`
 * catch-all (measured, and pinned below as a list), so nothing on the live
 * table can shadow the compound promotion door today. What IS measured against
 * a real Hono app is that a same-arity sibling registered ahead of it DOES
 * shadow it — so the constraint is one bad edit away rather than theoretical,
 * and reachability is probed against the live router instead of inferred from
 * a position in the table.
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
// [#11932] The REAL router, not a model of one. `resolveMountedRoute` is the
// same live-router observation the dogfood parity gate reads (#7526 rule 2:
// registration is not reachability), and it is what turns "is the pattern in
// the table" into "which registration would actually answer this path".
// `vitest.config.ts` aliases this specifier to the sibling's SOURCE, so no
// build artifact sits on the path these cases measure.
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

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
    // The single colliding path is `/meta/object/x/state/published`. Two
    // literal segments beat one, so the state-machine reading must win it.
    //
    // #9180 step 2 deleted the plural twin's arm of this pin along with the
    // plural registration — but NOT the pin: the collision is between the FSM
    // read and the compound `/published` route, and it outlives the spelling
    // that was retired. Deleting the whole pin would have un-guarded the
    // surviving route against exactly the #7526 defect it exists to catch.
    expect(indexOf(order, 'GET /api/v1/meta/object/:name/state/:field'))
      .toBeLessThan(indexOf(order, 'GET /api/v1/meta/:type/:section/:name/published'));
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

  it('mounts BOTH arities of the per-item promotion door (#11932)', () => {
    const order = metaRoutesInOrder();
    for (const key of [
      'POST /api/v1/meta/:type/:name/publish',
      'POST /api/v1/meta/:type/:section/:name/publish',
    ]) {
      expect(
        order,
        `${key} is not registered — a compound-named draft can be staged `
        + '(PUT ?mode=draft, #11712) and read back (/published, #7526) with no per-item door to promote it',
      ).toContain(key);
    }
  });

  it('registers the compound promotion door immediately beside its single-segment twin', () => {
    const order = metaRoutesInOrder();
    // Adjacency is #7019's ruling made structural: the two arities come out of
    // ONE two-entry loop, so a divergence between them has to be written
    // deliberately rather than drifted into. If a later edit splits them apart
    // this reddens, and that is the moment to re-read #7019.
    expect(indexOf(order, 'POST /api/v1/meta/:type/:section/:name/publish'))
      .toBe(indexOf(order, 'POST /api/v1/meta/:type/:name/publish') + 1);
  });

  it('⛔ `/meta` mounts no POST catch-all — the premise the ordering cases below rest on', () => {
    // Measured rather than assumed, and pinned as a LIST so it cannot rot
    // quietly: only a SAME-arity pattern can absorb a five-segment `/meta`
    // path, and none of these is one. If this list grows such a pattern, the
    // latent constraint has become live and the reachability cases below stop
    // being a demonstration and start being the thing under test.
    expect(metaRoutesInOrder().filter((k) => k.startsWith('POST '))).toEqual([
      'POST /api/v1/meta/_migrate-stored',
      'POST /api/v1/meta/:type/:name/publish',
      'POST /api/v1/meta/:type/:section/:name/publish',
      'POST /api/v1/meta/:type/:name/rollback',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [#11932] REACHABILITY, over the real router — the half `metaRoutesInOrder`
// structurally cannot answer.
//
// `getRoutes()` reports what was REGISTERED. On a first-match-wins router that
// is necessary and not sufficient (#7526 rule 2), so these cases boot the real
// `HonoHttpServer`, hand it the real `RestServer` registration sequence, and
// ask the LIVE router which pattern would answer a concrete path.
// ═══════════════════════════════════════════════════════════════════════════

/** The real adapter, carrying the real registration order. */
function liveRouter(): HonoHttpServer {
  const hono = new HonoHttpServer(0);
  const rest = new RestServer(hono as any, createCapableProtocol() as any, {} as any);
  rest.registerRoutes();
  return hono;
}

describe('[#11932] the compound promotion door is REACHABLE, not merely registered', () => {
  it('⭐ a compound-named promotion resolves to the compound pattern', () => {
    expect(liveRouter().resolveMountedRoute('POST', '/api/v1/meta/object/crm/task/publish'))
      .toEqual({ method: 'POST', pattern: '/api/v1/meta/:type/:section/:name/publish' });
  });

  it('and the single-segment spelling still resolves to its OWN pattern', () => {
    // The fence: mounting a second arity must not move the first one's answer.
    // Both are asserted, so a change that widened one by narrowing the other
    // reddens here rather than passing as "the compound case works".
    expect(liveRouter().resolveMountedRoute('POST', '/api/v1/meta/object/crm_task/publish'))
      .toEqual({ method: 'POST', pattern: '/api/v1/meta/:type/:name/publish' });
  });

  it('⭐ the instrument returns a NEGATIVE for a path this build does not mount', () => {
    // The canary. Without it, "the compound publish path resolves" could be a
    // probe that resolves everything. `POST …/rollback` is the same shape one
    // door over and is mounted in ONE arity only, so the live router answers
    // `undefined` for its compound spelling — which is exactly what the publish
    // door answered before this card.
    //
    // ⛔ Not a ruling that the rollback door should stay single-arity. It is
    // this suite's control; the asymmetry it records is filed separately.
    expect(liveRouter().resolveMountedRoute('POST', '/api/v1/meta/object/crm/task/rollback'))
      .toBeUndefined();
  });

  it('⛔ shows what a wrong-place registration would do — first-match-wins, measured', async () => {
    // The hazard demonstrated on the real router rather than asserted in a
    // comment. A same-arity sibling registered AHEAD of the promotion door
    // answers the promotion path instead — with its own 200 body, the #7526
    // disguise, not an error anyone would notice.
    const wrong = new HonoHttpServer(0);
    wrong.post('/api/v1/meta/:type/:section/:name/:verb', ((_q: any, res: any) => res.json({ answered: 'sibling' })) as any);
    wrong.post('/api/v1/meta/:type/:section/:name/publish', ((_q: any, res: any) => res.json({ answered: 'publish' })) as any);

    expect(wrong.resolveMountedRoute('POST', '/api/v1/meta/object/crm/task/publish'))
      .toEqual({ method: 'POST', pattern: '/api/v1/meta/:type/:section/:name/:verb' });
    expect(await (await wrong.getRawApp().request('/api/v1/meta/object/crm/task/publish', { method: 'POST' })).json())
      .toEqual({ answered: 'sibling' });

    // The same two registrations, the other way round.
    const right = new HonoHttpServer(0);
    right.post('/api/v1/meta/:type/:section/:name/publish', ((_q: any, res: any) => res.json({ answered: 'publish' })) as any);
    right.post('/api/v1/meta/:type/:section/:name/:verb', ((_q: any, res: any) => res.json({ answered: 'sibling' })) as any);

    expect(await (await right.getRawApp().request('/api/v1/meta/object/crm/task/publish', { method: 'POST' })).json())
      .toEqual({ answered: 'publish' });
  });

  it('a DIFFERENT-arity sibling cannot absorb it, however it is ordered', async () => {
    // Why the constraint is latent today rather than violated: only a
    // SAME-arity pattern can match this path. Registered first, the compound
    // three-param `POST` still does not answer the promotion path.
    const arity = new HonoHttpServer(0);
    arity.post('/api/v1/meta/:type/:section/:name', ((_q: any, res: any) => res.json({ answered: 'compound' })) as any);
    arity.post('/api/v1/meta/:type/:section/:name/publish', ((_q: any, res: any) => res.json({ answered: 'publish' })) as any);

    expect(arity.resolveMountedRoute('POST', '/api/v1/meta/object/crm/task/publish'))
      .toEqual({ method: 'POST', pattern: '/api/v1/meta/:type/:section/:name/publish' });
  });
});

describe('/meta registration order — the retired plural', () => {
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
