// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET {basePath}/openapi.json` at the route level (#5040 E6, #5078).
 *
 * The pure enrichment is unit-tested in `openapi-endpoints.test.ts`; what this
 * file covers is the part only the server can answer — that the handler really
 * asks the protocol for `api` items alongside `object` items, and that with the
 * empty set the world's response is unchanged.
 *
 * This route has ONE owner. #5078 established it with a real boot after a
 * shadow `generateOpenApi` branch in the dispatcher had spent months looking
 * like a second one; these assertions are the cheap standing version of that
 * boot, so the ownership claim stops depending on somebody re-running it.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

function makeServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
  } as any;
}

/**
 * A protocol that records which metadata types were enumerated and answers
 * each from `items`, in the `{ type, items }` envelope `getMetaItems` declares.
 */
function makeProtocol(items: Record<string, unknown[]>) {
  const asked: string[] = [];
  const protocol: any = {
    getMetaItems: vi.fn(async ({ type }: { type: string }) => {
      asked.push(type);
      return { type, items: items[type] ?? [] };
    }),
  };
  return { protocol, asked };
}

/** Drive the registered `GET {base}/openapi.json` handler and read the body. */
async function serveOpenApi(protocol: any) {
  const rest = new RestServer(makeServer(), protocol, { api: { requireAuth: false, version: 'v1' } } as any);
  (rest as any).registerOpenApiEndpoints('/api/v1');
  const entry = (rest as any).routeManager.get('GET', '/api/v1/openapi.json');
  expect(entry, 'the openapi.json route must be registered by this package').toBeDefined();

  let status = 200;
  let body: any;
  const res: any = {
    status: (c: number) => { status = c; return res; },
    json: (b: any) => { body = b; },
    setHeader: () => {},
    send: () => {},
  };
  await entry.handler({ headers: { host: 'example.test' }, params: {}, path: '/api/v1/openapi.json' }, res);
  return { status, body };
}

const TASKS_ENDPOINT = {
  name: 'list_tasks',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
  summary: 'List showcase tasks',
};

describe('GET /api/v1/openapi.json — endpoint enrichment', () => {
  it('enumerates `api` items alongside `object` items', async () => {
    const { protocol, asked } = makeProtocol({ object: [], api: [] });
    await serveOpenApi(protocol);
    expect(asked).toContain('object');
    expect(asked).toContain('api');
  });

  it('serves a document identical to the pre-#5093 one while no endpoint is declared', async () => {
    // The load-bearing invariant: a deployment that declares no endpoint must
    // not be able to tell the enrichment step exists. Since the #5040 E7
    // publish flip this is no longer the only state in production — endpoints
    // do publish — which is exactly why the no-declaration state needs pinning
    // rather than assuming. Compared against the same
    // handler fed a protocol with no `api` capability at all — i.e. the world
    // exactly as it was before the enrichment step existed.
    const withEmptyApis = await serveOpenApi(makeProtocol({ object: [], api: [] }).protocol);
    const withoutApiSupport = await serveOpenApi({ getMetaItems: vi.fn(async () => ({ type: 'object', items: [] })) });

    expect(withEmptyApis.status).toBe(200);
    expect(JSON.stringify(withEmptyApis.body)).toBe(JSON.stringify(withoutApiSupport.body));
  });

  it('adds one path entry per declared endpoint', async () => {
    const { protocol } = makeProtocol({ object: [], api: [TASKS_ENDPOINT] });
    const { body } = await serveOpenApi(protocol);
    const item = body.paths['/api/v1/apps/showcase/tasks'];
    expect(item).toBeDefined();
    expect(item.get.operationId).toBe('list_tasks');
    expect(item.get.summary).toBe('List showcase tasks');
    // `authRequired` defaults to true, so it points at the document's scheme.
    expect(item.get.security).toEqual(body.security);
  });

  it('still serves the document when the api enumeration throws', async () => {
    // A metadata store outage must cost the endpoint section, never the
    // document — the base spec and the object expansion are independent of it.
    const protocol: any = {
      getMetaItems: vi.fn(async ({ type }: { type: string }) => {
        if (type === 'api') throw new Error('store unavailable');
        return { type, items: [] };
      }),
    };
    const { status, body } = await serveOpenApi(protocol);
    expect(status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
  });

  it('keeps serving `{object}` expansion unchanged alongside the new step', async () => {
    const { protocol } = makeProtocol({ object: [{ name: 'showcase_task' }], api: [] });
    const { body } = await serveOpenApi(protocol);
    const expanded = Object.keys(body.paths).filter((p) => p.includes('showcase_task'));
    expect(expanded.length).toBeGreaterThan(0);
    // The template row survives, marked, exactly as before.
    expect(body.paths['/api/{object}']['x-template']).toBe(true);
  });
});
