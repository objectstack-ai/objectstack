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

/** A minimal, valid `ApiEndpointSchema` input. `authRequired` deliberately omitted. */
function endpoint(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'list_tasks',
    path: '/api/v1/apps/showcase/tasks',
    method: 'GET',
    type: 'object_operation',
    target: 'showcase_task',
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
    const index = buildEndpointIndex([endpoint({ authRequired: false })], makeLogger());
    expect(index.get('GET /api/v1/apps/showcase/tasks')!.authRequired).toBe(false);
  });

  it('strips storage annotations (_lock / packageId) rather than choking on them', () => {
    const index = buildEndpointIndex(
      [{ ...endpoint(), _lock: { managed: true }, _packageId: 'pkg_showcase' }],
      makeLogger(),
    );
    const hit = index.get('GET /api/v1/apps/showcase/tasks')!;
    expect(hit).toBeDefined();
    expect(hit as Record<string, unknown>).not.toHaveProperty('_lock');
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
