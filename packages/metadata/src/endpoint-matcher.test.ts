// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5089 (#5040 E2) — `matchEndpoint`: the declared-endpoint matcher.
 *
 * The binding specification is the contract text on
 * `IMetadataService.matchEndpoint` / `ApiEndpointMatch`
 * (`packages/spec/src/contracts/metadata-service.ts`, landed by #5080/#5097).
 * Every `it()` below pins one clause of it, so a future edit that softens the
 * contract fails here and not in production:
 *
 *   • method compared case-insensitively;
 *   • path compared as a WHOLE STRING after trimming a trailing slash, with no
 *     percent-decoding / Unicode normalization / case folding in 17.x;
 *   • the answer is `ApiEndpointSchema.parse`-d — defaults MATERIALIZED, so an
 *     omitted `authRequired` comes back `true`;
 *   • a stored item that fails to parse is skipped LOUDLY and never breaks the
 *     good items around it;
 *   • `undefined` is a miss; a store that cannot be read THROWS, because a
 *     miss becomes a 404 and an outage must not masquerade as one;
 *   • `params` is always `{}` — 17.x defines no path-template syntax;
 *   • a duplicate METHOD+path claim resolves deterministically and loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import {
  EndpointMatcher,
  buildEndpointIndex,
  endpointIndexKey,
  normalizeEndpointMethod,
  normalizeEndpointPath,
} from './endpoint-matcher.js';

function makeLogger(): Logger & { error: ReturnType<typeof vi.fn> } {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger & { error: ReturnType<typeof vi.fn> };
}

/**
 * A minimal `ApiEndpointSchema` input that also PASSES the identity-free
 * publish gates (#5189). `authRequired` is deliberately omitted so the
 * schema-default tests still have something to prove.
 *
 * `objectParams` is not decoration: E7's target gate rejects an
 * `object_operation` that does not name both `object` and `operation`, and
 * since #5189 the index applies that gate too — a fixture without it would be
 * excluded rather than served, which is the correct behaviour and a useless
 * fixture.
 */
function endpoint(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'list_tasks',
    path: '/api/v1/apps/showcase/tasks',
    method: 'GET',
    type: 'object_operation',
    target: 'showcase_task',
    objectParams: { object: 'showcase_task', operation: 'find' },
    ...over,
  };
}

describe('normalization helpers', () => {
  it('upper-cases the method', () => {
    expect(normalizeEndpointMethod('get')).toBe('GET');
    expect(normalizeEndpointMethod('PoSt')).toBe('POST');
  });

  it('trims exactly ONE trailing slash', () => {
    expect(normalizeEndpointPath('/a/b/')).toBe('/a/b');
    expect(normalizeEndpointPath('/a/b')).toBe('/a/b');
    // one, not all — `/x//` and `/x/` are different paths to every router here
    expect(normalizeEndpointPath('/a/b//')).toBe('/a/b/');
  });

  it('never trims a lone "/" (so a query for "" cannot collide with it)', () => {
    expect(normalizeEndpointPath('/')).toBe('/');
    expect(normalizeEndpointPath('')).toBe('');
  });

  it('does NOT percent-decode, case-fold or Unicode-normalize (17.x)', () => {
    expect(normalizeEndpointPath('/a%2Fb')).toBe('/a%2Fb');
    expect(normalizeEndpointPath('/Tasks')).toBe('/Tasks');
    // NFD "é" stays NFD — no NFC folding
    expect(normalizeEndpointPath('/café')).toBe('/café');
  });

  it('keys as "METHOD path"', () => {
    expect(endpointIndexKey('get', '/x/')).toBe('GET /x');
  });
});

describe('buildEndpointIndex', () => {
  it('builds a METHOD → exact-path → parsed-endpoint index', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [endpoint(), endpoint({ name: 'create_task', method: 'POST', path: '/api/v1/apps/showcase/tasks' })],
      logger,
    );

    expect([...index.keys()].sort()).toEqual([
      'GET /api/v1/apps/showcase/tasks',
      'POST /api/v1/apps/showcase/tasks',
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('trims a stored declaration\'s trailing slash when indexing it', () => {
    const index = buildEndpointIndex([endpoint({ path: '/api/v1/apps/showcase/tasks/' })], makeLogger());
    expect(index.has('GET /api/v1/apps/showcase/tasks')).toBe(true);
  });

  it('materializes schema defaults — an omitted authRequired is `true`', () => {
    const index = buildEndpointIndex([endpoint()], makeLogger());
    expect(index.get('GET /api/v1/apps/showcase/tasks')!.authRequired).toBe(true);
  });

  it('preserves an explicit authRequired: false', () => {
    // The armed budget is not incidental: since #5189 an anonymous endpoint
    // without one never reaches the index at all (ADR-0121 D6), so this is the
    // only shape in which "authRequired: false survives the round trip" is
    // still an observable fact.
    const index = buildEndpointIndex(
      [endpoint({ authRequired: false, rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 } })],
      makeLogger(),
    );
    expect(index.get('GET /api/v1/apps/showcase/tasks')!.authRequired).toBe(false);
  });

  // [#5271] REPLACED, not re-spelled. This case used to read "strips storage
  // annotations (_lock / packageId) rather than choking on them" and asserted
  // `not.toHaveProperty('_lock')` over a fixture spelling `_lock: { managed:
  // true }` — a shape ADR-0010 never defined (`_lock` is the 4-state enum
  // none / no-overlay / no-delete / full). Both halves stopped being right when
  // `api` became a registered kind (#5271, part of #5206):
  //
  //  • `ApiEndpointSchema` now declares `...MetadataProtectionFields`, because
  //    every registered kind must — the loader stamps the envelope and an
  //    undeclared one is DROPPED on every parse, losing protection metadata on
  //    round-trip. So the old assertion pinned exactly the defect that spread
  //    fixes, and it would have kept passing for the wrong reason.
  //  • The invented `_lock` object is now a VALUE error rather than an unknown
  //    key, so the endpoint would be excluded from the index entirely — the
  //    fixture's own premise ("does not choke") silently inverted.
  //
  // What remains true, and is what this case now pins: a stored row carries
  // BOTH the ADR-0010 envelope (declared ⇒ survives) and the metadata layer's
  // own bookkeeping (`packageId` / `state`, written by `MetadataManager` and
  // NOT endpoint vocabulary ⇒ never reaches the body parse).
  //
  // [#5309] The REASON the bookkeeping is gone changed, and that is the whole
  // point of the split. It used to be the schema's unknown-key STRIPPING that
  // ate it — which is why `api` could not leave #4001's STILL_STRIP list
  // (#5271 measured it: closing the shape made every stored row fail with
  // `unrecognized_keys: ['packageId', 'state']`). Now `peelStoredEnvelope`
  // takes the envelope off BEFORE `ApiEndpointSchema` sees anything, so this
  // case passes on a strict schema too. `stored-envelope.test.ts` pins the peel
  // itself; the cases below pin it end to end through the index.
  it('keeps the ADR-0010 envelope and strips the metadata layer’s bookkeeping', () => {
    const index = buildEndpointIndex(
      [{
        ...endpoint(),
        // ADR-0010 envelope — declared by the schema, so it round-trips.
        _lock: 'no-overlay',
        _packageId: 'pkg_showcase',
        _provenance: 'package',
        // Metadata-layer bookkeeping — not endpoint vocabulary, so stripped.
        packageId: 'com.objectstack.showcase',
        state: 'active',
      }],
      makeLogger(),
    );

    const hit = index.get('GET /api/v1/apps/showcase/tasks');
    expect(hit, 'a stored row with storage annotations must still index').toBeDefined();

    const body = hit as unknown as Record<string, unknown>;
    expect(body._packageId).toBe('pkg_showcase');
    expect(body._lock).toBe('no-overlay');
    expect(body).not.toHaveProperty('packageId');
    expect(body).not.toHaveProperty('state');
  });
});

// ── [#5309] The stored ENVELOPE / authored BODY split ──────────────────────
//
// These pin the peel where it matters — through the index — rather than only
// in `stored-envelope.test.ts`. The measurement they exist to protect: with
// `ApiEndpointSchema` flipped to `strictObject` (a local probe, never
// committed — that flip is #5384's), a stored row used to fail with
// `unrecognized_keys: ['packageId', 'state']` and its route answered 404. It
// no longer can, because the envelope never reaches the schema.
describe('#5309 — the envelope never reaches the body parse', () => {
  /** Every bookkeeping key `publishPackage` stamps onto a published row. */
  const publishEnvelope = {
    packageId: 'com.objectstack.showcase',
    package: 'com.objectstack.showcase',
    state: 'active',
    version: 3,
    publishedAt: '2026-08-08T00:00:00.000Z',
    publishedBy: 'usr_admin',
    publishedDefinition: { name: 'list_tasks', path: '/api/v1/apps/showcase/tasks' },
  };

  it('indexes a FLAT published row and hands back a body carrying no bookkeeping', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex([{ ...endpoint(), ...publishEnvelope }], logger);

    const hit = index.get('GET /api/v1/apps/showcase/tasks');
    expect(hit, 'a published row must index through the split').toBeDefined();
    // The declaration survives whole …
    expect(hit!.name).toBe('list_tasks');
    expect(hit!.target).toBe('showcase_task');
    // … the schema default is still materialized (contract, not incidental) …
    expect(hit!.authRequired).toBe(true);
    // … and not one bookkeeping key is on the answer.
    const body = hit as unknown as Record<string, unknown>;
    for (const key of Object.keys(publishEnvelope)) {
      expect(body, `envelope key '${key}' leaked into the endpoint body`).not.toHaveProperty(key);
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('indexes a WRAPPED publish envelope off its `metadata` body', () => {
    // `{ name, packageId, state, metadata: {…} }` is the envelope shape
    // `publishPackage` gates (`data.metadata ?? data`) and `revertPackage`
    // writes. This index is now the same reader: before the split it parsed the
    // OUTER object, found no `path`/`method`, and excluded a row publish had
    // just accepted — the two doors disagreeing about what the document is.
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [{ name: 'list_tasks', packageId: 'com.objectstack.showcase', state: 'active', metadata: endpoint() }],
      logger,
    );

    const hit = index.get('GET /api/v1/apps/showcase/tasks');
    expect(hit, 'a publish envelope must index off its body').toBeDefined();
    expect(hit!.name).toBe('list_tasks');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('names an unparseable WRAPPED row by its envelope `name`, not `<unnamed>`', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [{ name: 'broken_ep', packageId: 'com.objectstack.showcase', metadata: { path: '/api/v1/apps/showcase/x' } }],
      logger,
    );

    expect(index.size).toBe(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('broken_ep');
  });

  it('leaves an authored declaration — no envelope at all — byte-identical', () => {
    const authored = endpoint();
    const before = structuredClone(authored);
    const index = buildEndpointIndex([authored], makeLogger());

    expect(index.get('GET /api/v1/apps/showcase/tasks')).toBeDefined();
    // The peel is a VIEW: it must never mutate the row it was handed.
    expect(authored).toEqual(before);
  });
});

describe('parse failure — loud skip, no collateral damage', () => {
  it('skips an unparseable stored item, logs it at error level, and keeps the good ones', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [
        { name: 'broken_ep', path: '/api/v1/apps/showcase/broken' }, // no method / type / target
        endpoint(),
      ],
      logger,
    );

    expect(index.has('GET /api/v1/apps/showcase/tasks')).toBe(true);
    expect(index.size).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message] = logger.error.mock.calls[0];
    expect(message).toContain('broken_ep');
    expect(message).toContain('ApiEndpointSchema');
  });

  it('names an item that has no usable name as <unnamed> instead of throwing', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex([null, 42, { path: '/x' }], logger);
    expect(index.size).toBe(0);
    expect(logger.error).toHaveBeenCalledTimes(3);
    expect(logger.error.mock.calls[0][0]).toContain('<unnamed>');
  });
});

describe('#5189 — publish gates re-applied at load (identity-free subset)', () => {
  it('EXCLUDES an anonymous endpoint with no armed rate limit (ADR-0121 D6) and says so loudly', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex([endpoint({ name: 'open_tasks', authRequired: false })], logger);

    // The whole point: the route is gone, not served anonymously and unmetered.
    expect(index.size).toBe(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, , meta] = logger.error.mock.calls[0];
    expect(message).toContain('open_tasks');
    expect(message).toContain('WITHOUT passing the');
    expect(message).toContain('404');
    expect(message).toContain('Republish');
    // the gate's own prescription rides along
    expect(message).toContain('authRequired: false');
    expect(meta).toMatchObject({ name: 'open_tasks' });
  });

  it('EXCLUDES a rateLimit that is present but not armed — `enabled` defaults to false', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [endpoint({ name: 'open_tasks', authRequired: false, rateLimit: { windowMs: 60000, maxRequests: 100 } })],
      logger,
    );
    expect(index.size).toBe(0);
    expect(logger.error.mock.calls[0][0]).toContain('meters nothing');
  });

  it('SERVES an anonymous endpoint that carries an armed budget', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [
        endpoint({
          name: 'open_tasks',
          authRequired: false,
          rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 },
        }),
      ],
      logger,
    );
    expect(index.get('GET /api/v1/apps/showcase/tasks')!.authRequired).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('EXCLUDES the other identity-free gate failures too — one judge, not a D6 special case', () => {
    for (const bad of [
      endpoint({ name: 'proxied', type: 'proxy', target: 'https://x.test' }),
      endpoint({ name: 'no_params', objectParams: undefined }),
      endpoint({ name: 'mapped', outputMapping: [{ source: 'a', target: 'b', transform: 'upper' }] }),
      endpoint({ name: 'neg_cache', cacheTtl: -1 }),
      endpoint({ name: 'post_cache', method: 'POST', cacheTtl: 30 }),
    ]) {
      const logger = makeLogger();
      expect(buildEndpointIndex([bad], logger).size).toBe(0);
      expect(logger.error).toHaveBeenCalledTimes(1);
    }
  });

  it('does NOT apply the namespace gate — the matcher has no stack identity to judge it with', () => {
    // Outside any `apps/<ns>/` carve-out: publish rejects this (it knows the
    // manifest), the index does not (it does not, and inferring one from the
    // path being judged would be circular). It is simply unreachable in
    // practice — the endpoint step only consults paths under that mount.
    const logger = makeLogger();
    const index = buildEndpointIndex([endpoint({ name: 'stray', path: '/api/v1/elsewhere' })], logger);
    expect(index.has('GET /api/v1/elsewhere')).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('excludes a gate-failing item without disturbing the good ones', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [endpoint({ name: 'open_tasks', path: '/api/v1/apps/showcase/open', authRequired: false }), endpoint()],
      logger,
    );
    expect([...index.keys()]).toEqual(['GET /api/v1/apps/showcase/tasks']);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('a gate-failing item does not take the route from a valid duplicate claimant', () => {
    const logger = makeLogger();
    // `a_tasks` would win the lexicographic tie-break — but it never claims,
    // because it never passes the gates.
    const index = buildEndpointIndex(
      [endpoint({ name: 'a_tasks', authRequired: false }), endpoint({ name: 'z_tasks' })],
      logger,
    );
    expect(index.get('GET /api/v1/apps/showcase/tasks')!.name).toBe('z_tasks');
    // one gate error, and NO duplicate-claim error: there was never a duplicate
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).not.toContain('duplicate endpoint claim');
  });
});

describe('duplicate METHOD+path claims — deterministic and loud', () => {
  it('keeps the lexicographically-first `name` and names the ignored claimant', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [
        endpoint({ name: 'zeta_tasks', target: 'z' }),
        endpoint({ name: 'alpha_tasks', target: 'a' }),
      ],
      logger,
    );

    expect(index.get('GET /api/v1/apps/showcase/tasks')!.name).toBe('alpha_tasks');
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, , meta] = logger.error.mock.calls[0];
    expect(message).toContain('duplicate endpoint claim');
    expect(meta).toMatchObject({ winner: 'alpha_tasks', ignored: 'zeta_tasks' });
  });

  it('resolves identically regardless of the order items arrive in', () => {
    const forward = buildEndpointIndex(
      [endpoint({ name: 'alpha_tasks' }), endpoint({ name: 'zeta_tasks' })],
      makeLogger(),
    );
    const reverse = buildEndpointIndex(
      [endpoint({ name: 'zeta_tasks' }), endpoint({ name: 'alpha_tasks' })],
      makeLogger(),
    );
    expect(forward.get('GET /api/v1/apps/showcase/tasks')!.name)
      .toBe(reverse.get('GET /api/v1/apps/showcase/tasks')!.name);
  });

  it('does NOT treat different methods on the same path as a duplicate', () => {
    const logger = makeLogger();
    const index = buildEndpointIndex(
      [endpoint({ name: 'a_get' }), endpoint({ name: 'b_post', method: 'POST' })],
      logger,
    );
    expect(index.size).toBe(2);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('EndpointMatcher.match', () => {
  let logger: ReturnType<typeof makeLogger>;
  let items: unknown[];
  let reads: number;
  let matcher: EndpointMatcher;

  beforeEach(() => {
    logger = makeLogger();
    items = [endpoint()];
    reads = 0;
    matcher = new EndpointMatcher({
      listApiItems: async () => {
        reads++;
        return items;
      },
      logger,
    });
  });

  it('hits an exactly-declared route', async () => {
    const match = await matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' });
    expect(match?.endpoint.name).toBe('list_tasks');
  });

  it('returns `params: {}` — 17.x has no path-template syntax', async () => {
    const match = await matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' });
    expect(match?.params).toEqual({});
  });

  it('compares the method case-insensitively', async () => {
    for (const verb of ['get', 'Get', 'gEt', 'GET']) {
      const match = await matcher.match({ method: verb, path: '/api/v1/apps/showcase/tasks' });
      expect(match?.endpoint.name).toBe('list_tasks');
    }
  });

  it('trims a trailing slash on the QUERY side too', async () => {
    const match = await matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks/' });
    expect(match?.endpoint.name).toBe('list_tasks');
  });

  it('trims on BOTH sides consistently (stored with slash, queried without)', async () => {
    items = [endpoint({ path: '/api/v1/apps/showcase/tasks/' })];
    matcher.invalidate();
    const match = await matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' });
    expect(match?.endpoint.name).toBe('list_tasks');
  });

  it('misses on an undeclared path — undefined, not an error', async () => {
    await expect(matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/nope' }))
      .resolves.toBeUndefined();
  });

  it('misses on a declared path with an undeclared method', async () => {
    await expect(matcher.match({ method: 'DELETE', path: '/api/v1/apps/showcase/tasks' }))
      .resolves.toBeUndefined();
  });

  it('misses on a case-differing path — 17.x does NOT case-fold the path', async () => {
    await expect(matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/Tasks' }))
      .resolves.toBeUndefined();
  });

  it('misses on a percent-encoded spelling — 17.x does NOT decode the path', async () => {
    items = [endpoint({ path: '/api/v1/apps/showcase/my tasks' })];
    matcher.invalidate();
    await expect(matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/my%20tasks' }))
      .resolves.toBeUndefined();
  });

  it('a prefix of a declared path is not a match — the whole string is the key', async () => {
    await expect(matcher.match({ method: 'GET', path: '/api/v1/apps/showcase' }))
      .resolves.toBeUndefined();
    await expect(matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks/42' }))
      .resolves.toBeUndefined();
  });

  it('builds the index lazily — once, then reuses it', async () => {
    expect(reads).toBe(0);
    await matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' });
    await matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' });
    await matcher.match({ method: 'GET', path: '/nope' });
    expect(reads).toBe(1);
  });

  it('shares one store read across concurrent first calls', async () => {
    await Promise.all([
      matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }),
      matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }),
      matcher.match({ method: 'GET', path: '/nope' }),
    ]);
    expect(reads).toBe(1);
  });

  it('rebuilds after invalidate(), picking up the new declaration', async () => {
    expect(await matcher.match({ method: 'POST', path: '/api/v1/apps/showcase/tasks' })).toBeUndefined();
    items = [...items, endpoint({ name: 'create_task', method: 'POST' })];
    matcher.invalidate();
    const match = await matcher.match({ method: 'POST', path: '/api/v1/apps/showcase/tasks' });
    expect(match?.endpoint.name).toBe('create_task');
    expect(reads).toBe(2);
  });
});

describe('a store that cannot be read THROWS — an outage is not a 404', () => {
  it('propagates the read failure instead of reporting a miss', async () => {
    const matcher = new EndpointMatcher({
      listApiItems: async () => {
        throw new Error('sys_metadata unreachable');
      },
      logger: makeLogger(),
    });

    await expect(matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }))
      .rejects.toThrow('sys_metadata unreachable');
  });

  it('does not cache the failure — a recovered store serves on the next call', async () => {
    let healthy = false;
    const matcher = new EndpointMatcher({
      listApiItems: async () => {
        if (!healthy) throw new Error('sys_metadata unreachable');
        return [endpoint()];
      },
      logger: makeLogger(),
    });

    await expect(matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' })).rejects.toThrow();
    healthy = true;
    const match = await matcher.match({ method: 'GET', path: '/api/v1/apps/showcase/tasks' });
    expect(match?.endpoint.name).toBe('list_tasks');
  });
});
