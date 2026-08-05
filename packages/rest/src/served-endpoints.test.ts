// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5224] `selectServedEndpoints` — the unit under the two machine-readable
// endpoint faces.
//
// The break it closes was measured on a real showcase boot: an `api` row
// written straight through `PUT /meta/api/{name}` is enumerated by
// `protocol.getMetaItems` (ObjectQL SchemaRegistry + `sys_metadata`) and
// invisible to `IMetadataService.matchEndpoint` (the manager's registry +
// its registered loaders), so `/meta/api` and `/openapi.json` both announced
// `GET /api/v1/apps/showcase/backdoor` — the latter with `security: []` — while
// every request to it answered 404.
//
// What is pinned here is the SEMANTICS of the narrowing; the wiring into both
// faces is pinned by `rest-endpoint-surfaces-served-only.test.ts` against the
// real `MetadataManager`.

import { describe, it, expect, vi } from 'vitest';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';
import {
  isEndpointMatchAuthority,
  selectServedEndpoints,
  type EndpointMatchAuthority,
} from './served-endpoints';

const TASKS = {
  name: 'showcase_task_feed',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
  authRequired: true,
  _packageId: 'com.example.showcase',
};

const BACKDOOR = {
  name: 'e8_backdoor',
  path: '/api/v1/apps/showcase/backdoor',
  method: 'GET',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
  authRequired: false,
};

/** An authority that serves exactly the routes it was given. */
function authorityServing(...endpoints: Array<Record<string, unknown>>): EndpointMatchAuthority {
  const index = new Map<string, ApiEndpointMatch>();
  for (const e of endpoints) {
    index.set(`${String(e.method).toUpperCase()} ${String(e.path)}`, {
      endpoint: e as never,
      params: {},
    });
  }
  return {
    matchEndpoint: vi.fn(async ({ method, path }) =>
      index.get(`${String(method).toUpperCase()} ${String(path)}`)),
  };
}

const silent = { error: vi.fn() };

describe('selectServedEndpoints — announce only what the matcher serves', () => {
  it('keeps a declaration the matcher resolves to the SAME name', async () => {
    const served = await selectServedEndpoints([TASKS], authorityServing(TASKS), silent);

    expect(served.map((s) => s.item)).toEqual([TASKS]);
    // The matcher's own parsed value is carried alongside the stored item —
    // the OpenAPI face documents that one, so schema defaults are materialized
    // rather than re-derived on a second code path.
    expect(served[0]?.endpoint.name).toBe('showcase_task_feed');
  });

  it('drops the declaration the matcher does not know — the #5224 defect', async () => {
    // The exact measured shape: both rows are enumerated, only one is served.
    const served = await selectServedEndpoints([TASKS, BACKDOOR], authorityServing(TASKS), silent);

    expect(served.map((s) => (s.item as { name: string }).name)).toEqual(['showcase_task_feed']);
  });

  it('names every omission at `error`, in one aggregated line', async () => {
    const logger = { error: vi.fn() };
    await selectServedEndpoints([TASKS, BACKDOOR], authorityServing(TASKS), logger);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.error.mock.calls[0]!;
    expect(message).toContain('e8_backdoor');
    expect(message).toContain('GET /api/v1/apps/showcase/backdoor');
    // Absence must be loud AND actionable: the line says what happens to the
    // route and how to make the declaration real.
    expect(message).toContain('404');
    expect(message).toContain('publishPackage');
    expect((meta as { omitted: unknown[] }).omitted).toHaveLength(1);
  });

  it('says nothing when every declaration is served', async () => {
    const logger = { error: vi.fn() };
    await selectServedEndpoints([TASKS], authorityServing(TASKS), logger);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('drops the LOSER of a duplicate route claim, keeping the matcher its winner', async () => {
    // Two items claim `GET /api/v1/apps/showcase/tasks`. `buildEndpointIndex`
    // resolves that lexicographically-first-`name`-wins, and the loser is
    // served by nobody — so it must not be announced either. The rule itself is
    // never restated here: the answer comes back from the matcher.
    const loser = { ...TASKS, name: 'z_late_claim' };
    const served = await selectServedEndpoints([TASKS, loser], authorityServing(TASKS), silent);

    expect(served.map((s) => (s.item as { name: string }).name)).toEqual(['showcase_task_feed']);
  });

  it('drops an item with no usable name / method / path', async () => {
    const logger = { error: vi.fn() };
    const served = await selectServedEndpoints(
      [{ name: 'half', method: 'GET' }, { path: '/api/v1/apps/x/y', method: 'GET' }],
      authorityServing(TASKS),
      logger,
    );

    expect(served).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![0]).toContain('no usable name/method/path');
  });

  it('an empty input asks the matcher nothing and reports nothing', async () => {
    const authority = authorityServing(TASKS);
    const logger = { error: vi.fn() };

    expect(await selectServedEndpoints([], authority, logger)).toEqual([]);
    expect(authority.matchEndpoint).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('PROPAGATES a store outage instead of reporting an empty served set', async () => {
    // `matchEndpoint` throws when its store cannot be read, precisely so an
    // outage cannot masquerade as a miss (its contract; ADR-0110 D3 for the
    // singular read). Swallowing it here would turn an unreadable store into
    // the confident claim that the deployment declares no endpoints.
    const authority: EndpointMatchAuthority = {
      matchEndpoint: vi.fn(async () => { throw new Error('metadata store unreachable'); }),
    };

    await expect(selectServedEndpoints([TASKS], authority, silent))
      .rejects.toThrow('metadata store unreachable');
  });
});

describe('isEndpointMatchAuthority', () => {
  it('accepts a service carrying `matchEndpoint`', () => {
    expect(isEndpointMatchAuthority({ matchEndpoint: () => undefined })).toBe(true);
  });

  it('rejects an occupant without it — the contract method is OPTIONAL', () => {
    // `runAppEndpointStep` makes the identical probe and serves nothing when it
    // fails; a face that assumed the method exists would throw on a legal shape.
    expect(isEndpointMatchAuthority({ register: () => undefined })).toBe(false);
    expect(isEndpointMatchAuthority(undefined)).toBe(false);
    expect(isEndpointMatchAuthority(null)).toBe(false);
  });
});
