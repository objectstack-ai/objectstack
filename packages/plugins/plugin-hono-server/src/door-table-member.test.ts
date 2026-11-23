// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36506] `createDoorTableMember`: a plugin's `IHttpServer`-mounted doors as
 * one transport-neutral `(request) => Promise<Response>` member, on a private
 * `HonoHttpServer` that never listens.
 *
 * What this pins:
 *  1. a request for one of the routes runs the mounted handler and answers
 *     exactly what the same registration answers on a `HonoHttpServer` the
 *     self-hosted way (one body, two faces);
 *  2. a method or path outside the routes answers the transport's own
 *     `404 ENDPOINT_NOT_FOUND` without building the table or reaching a door;
 *  3. the table is built once, on the first request that names a route.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IHttpServer } from '@objectstack/spec/contracts';
import { HonoHttpServer } from './adapter';
import { createDoorTableMember, matchDoorTableRoute, type DoorTableRoute } from './door-table-member';

const ROUTES: readonly DoorTableRoute[] = [
  { method: 'DELETE', route: '/api/v1/widgets/:id' },
  { method: 'PATCH', route: '/api/v1/widgets/:id' },
];

/** A registrar shaped like a plugin's: two verbs at one route, echoing what they read. */
function registrar(http: IHttpServer): void {
  http.delete('/api/v1/widgets/:id', async (req, res) => {
    res.status(200).json({ success: true, data: { id: req.params.id, deleted: true } });
  });
  http.patch('/api/v1/widgets/:id', async (req, res) => {
    if (!req.headers['x-caller']) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in first.' } });
      return;
    }
    res.status(200).json({ success: true, data: { id: req.params.id, body: req.body } });
  });
}

const at = (method: string, path: string, init: RequestInit = {}) =>
  new Request(`http://tenant.example${path}`, { method, ...init });

async function snapshot(res: Response) {
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

describe('[#36506] createDoorTableMember serves mounted doors as one transport-neutral member', () => {
  it('a request for a route answers what the same registration answers on a HonoHttpServer', async () => {
    const member = createDoorTableMember(ROUTES, registrar);
    const selfHosted = new HonoHttpServer(0);
    registrar(selfHosted);

    const requests = [
      () => at('DELETE', '/api/v1/widgets/w_1'),
      () => at('PATCH', '/api/v1/widgets/w_1', { headers: { 'content-type': 'application/json' }, body: '{"name":"n"}' }),
      () => at('PATCH', '/api/v1/widgets/w_1', {
        headers: { 'content-type': 'application/json', 'x-caller': 'u_1' },
        body: '{"name":"n"}',
      }),
    ];
    for (const make of requests) {
      const viaMember = await snapshot(await member(make()));
      const viaMount = await snapshot(await selfHosted.getRawApp().fetch(make()));
      expect(viaMember).toEqual(viaMount);
    }
    expect(JSON.parse((await snapshot(await member(requests[2]!()))).body)).toEqual({
      success: true,
      data: { id: 'w_1', body: { name: 'n' } },
    });
  });

  it('a method or path outside the routes answers 404 ENDPOINT_NOT_FOUND and never builds the table', async () => {
    const mount = vi.fn(registrar);
    const member = createDoorTableMember(ROUTES, mount);
    for (const [method, path] of [
      ['GET', '/api/v1/widgets/w_1'],
      ['PUT', '/api/v1/widgets/w_1'],
      ['DELETE', '/api/v1/widgets'],
      ['DELETE', '/api/v1/widgets/'],
      ['DELETE', '/api/v1/widgets/w_1/x'],
      ['DELETE', '/api/v1/gadgets/w_1'],
    ] as const) {
      const res = await member(at(method, path));
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' } });
    }
    expect(mount).not.toHaveBeenCalled();
  });

  it('the table is built once, on the first request that names a route', async () => {
    const mount = vi.fn(registrar);
    const member = createDoorTableMember(ROUTES, mount);
    await member(at('DELETE', '/api/v1/widgets/a'));
    await member(at('DELETE', '/api/v1/widgets/b'));
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('matchDoorTableRoute names the route, method by method, one segment per parameter', () => {
    expect(matchDoorTableRoute(ROUTES, 'delete', '/api/v1/widgets/w_1')).toEqual(ROUTES[0]);
    expect(matchDoorTableRoute(ROUTES, 'PATCH', '/api/v1/widgets/w_1')).toEqual(ROUTES[1]);
    expect(matchDoorTableRoute(ROUTES, 'DELETE', '/api/v1/widgets//')).toBeUndefined();
  });
});
