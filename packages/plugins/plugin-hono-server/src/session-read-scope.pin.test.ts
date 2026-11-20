// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where this transport opens the request's session-read scopes
 * (`@objectstack/core` `request-session-read.ts`), through the real Hono app.
 *
 * The middleware seam runs its chain in a scope of its own (the inbound rate
 * limiter reads the caller there), and a route registered through the server
 * runs in that same scope only when every handler between the seam and the
 * route is a whole-server middleware. A session read's answer can depend on
 * ambient state a middleware scoped to a path opens for the handlers below it
 * (plugin-auth's door under the auth base path carries the request's address
 * to the reads made behind it, and the organization's IP list is judged on
 * those reads only, ADR-0069 D5), so a read made in front of such a door must
 * never answer a reader behind it.
 *
 * What these pins hold, each with one session API double counting its calls
 * and every reader reading with the same header set:
 *
 *  1. ⭐ A route behind whole-server middleware only is served the seam's read.
 *  2. A route behind a middleware scoped to its path reads for itself, inside
 *     the ambient state that middleware opened.
 *  3. A raw-app route reads for itself.
 *  4. A request served in process from inside a route reads for itself.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, it, expect } from 'vitest';
import { readRequestSession, resolveAuthzContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse } from '@objectstack/core';

import { HonoHttpServer } from './adapter';

/** An engine double with the two seams the carrier watches: the write epoch and `registerMiddleware`. */
async function watchedEngine() {
  const engine = {
    writeEpoch: {
      current: 0,
      bump(_reason: string) { this.current += 1; },
      subscribe(_listener: unknown) { return () => {}; },
    },
    registerMiddleware(_fn: unknown) {},
    async find() { return []; },
    async findOne() { return null; },
  };
  // The first `resolveAuthzContext` naming an engine registers its write
  // observer, as a booted kernel's first request does.
  await resolveAuthzContext({ ql: engine, headers: new Headers() } as Parameters<typeof resolveAuthzContext>[0])
    .catch(() => undefined);
  return engine;
}

/** The ambient state a door opens for the reads behind it. */
const door = new AsyncLocalStorage<string>();

/** A session API double: counts its calls and records the door each was made behind. */
function makeApi() {
  const api = {
    calls: 0,
    doors: [] as Array<string | undefined>,
    async getSession(_input: { headers: unknown }) {
      api.calls += 1;
      api.doors.push(door.getStore());
      return { user: { id: 'u1' }, session: { userId: 'u1', expiresAt: new Date(Date.now() + 3_600_000) } } as any;
    },
  };
  return api;
}

const TOKEN = { authorization: 'Bearer pin-token' };

/** The header set this transport hands a middleware and a route, `host` backfilled. */
function headersOf(c: any): Headers {
  const record = c.req.header() as Record<string, string>;
  if (!record.host) record.host = new URL(c.req.url).host;
  return new Headers(record);
}

/**
 * A server as `HonoServerPlugin` composes it — the seam installed before any
 * route — with a limiter-shaped middleware reading the caller in the seam.
 */
async function serverWith() {
  const engine = await watchedEngine();
  const api = makeApi();
  const server = new HonoHttpServer(0);
  server.installMiddlewareSeam();
  server.use(async (req: IHttpRequest, _res: IHttpResponse, next: () => void | Promise<void>) => {
    await readRequestSession(api as any, new Headers(req.headers as Record<string, string>), engine);
    await next();
  });
  const route = async (req: IHttpRequest, res: IHttpResponse) => {
    await readRequestSession(api as any, new Headers(req.headers as Record<string, string>), engine);
    res.status(200);
    res.json({ ok: true });
  };
  return { server, api, engine, route, raw: server.getRawApp() as any };
}

const call = (server: HonoHttpServer, path: string) =>
  server.getRawApp().fetch(new Request(`http://localhost${path}`, { headers: TOKEN }));

describe('the middleware seam\'s session read reaches a registered route only past whole-server middleware', () => {
  it('⭐ a route behind whole-server middleware only is served the seam\'s read', async () => {
    const { server, api, route, raw } = await serverWith();
    // A whole-server middleware registered after the seam, as a host guard is.
    raw.use('*', async (_c: unknown, next: () => Promise<void>) => next());
    server.get('/api/v1/data/thing', route);
    const res = await call(server, '/api/v1/data/thing');
    expect(res.status).toBe(200);
    expect(api.calls).toBe(1);
  });

  it('a route behind a middleware scoped to its path reads for itself, inside that middleware\'s ambient state', async () => {
    const { server, api, route, raw } = await serverWith();
    raw.use('/api/v1/auth/*', (_c: unknown, next: () => Promise<void>) => door.run('auth-door', () => next()));
    server.get('/api/v1/auth/thing', route);
    const res = await call(server, '/api/v1/auth/thing');
    expect(res.status).toBe(200);
    expect(api.calls).toBe(2);
    expect(api.doors).toEqual([undefined, 'auth-door']);
  });

  it('a route behind another route that matched and handed the request on reads for itself', async () => {
    const { server, api, route, raw } = await serverWith();
    raw.all('/api/v1/data/*', (_c: unknown, next: () => Promise<void>) => next());
    server.get('/api/v1/data/thing', route);
    await call(server, '/api/v1/data/thing');
    expect(api.calls).toBe(2);
  });

  it('a raw-app route reads for itself', async () => {
    const { server, api, engine, raw } = await serverWith();
    raw.get('/api/v1/raw', async (c: any) => {
      await readRequestSession(api as any, headersOf(c), engine);
      return c.json({ ok: true });
    });
    const res = await call(server, '/api/v1/raw');
    expect(res.status).toBe(200);
    expect(api.calls).toBe(2);
  });

  it('a request served in process from inside a route reads for itself', async () => {
    const { server, api, engine, raw } = await serverWith();
    raw.get('/api/v1/inner', async (c: any) => {
      await readRequestSession(api as any, headersOf(c), engine);
      return c.json({ inner: true });
    });
    server.get('/api/v1/outer', async (req: IHttpRequest, res: IHttpResponse) => {
      await readRequestSession(api as any, new Headers(req.headers as Record<string, string>), engine);
      const inner = await call(server, '/api/v1/inner');
      res.status(inner.status);
      res.json({ outer: true });
    });
    const res = await call(server, '/api/v1/outer');
    expect(res.status).toBe(200);
    // Outer: the seam's read, served to the outer route. Inner: its own seam's
    // read, and the inner raw route's own.
    expect(api.calls).toBe(3);
  });
});
