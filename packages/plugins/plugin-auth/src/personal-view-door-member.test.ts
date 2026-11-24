// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36506] `AuthPlugin` serves the personal-view delete door on its
 * `personal-views` slot (`IPersonalViewDoorsService.handlePersonalViewDoor`),
 * for a kernel with no `http.server`: a hosted tenant kernel runs the plugin
 * with `registerRoutes: false` and owns no socket, and the runtime
 * dispatcher's `/personal-views` domain forwards the request here.
 *
 * Every composition below is the real one: `AuthPlugin.init()` on a mock
 * kernel context whose `data` service is the in-memory engine,
 * `registerRoutes: false` (the per-environment kernel's shape). What this pins:
 *  1. `init()` registers the slot with the member, whatever `registerRoutes`
 *     says, and nothing is mounted on any server;
 *  2. the member runs the door: a request naming nobody answers the door's own
 *     `401 UNAUTHENTICATED`, byte for byte what the self-hosted mount answers;
 *  3. a method or path that is not the door answers `404 ENDPOINT_NOT_FOUND`.
 *
 * The owner's removal and the refusals of everyone else are pinned on the
 * real stack, on this member through the dispatcher alone, in the dogfood file
 * `personal-view-row-scope.dogfood.test.ts` (`[hosted]`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IPersonalViewDoorsService } from '@objectstack/spec/contracts';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const ORIGIN = 'http://localhost:3000';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function compose(options: Record<string, unknown> = {}) {
  const engine = createMemoryEngine();
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'data') return engine;
      if (name === 'manifest') return { register: vi.fn() };
      return undefined;
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  } as unknown as PluginContext;
  const plugin = new AuthPlugin({ secret: SECRET, baseUrl: ORIGIN, registerRoutes: false, ...options } as never);
  await plugin.init(ctx);
  const calls = (ctx.registerService as ReturnType<typeof vi.fn>).mock.calls;
  const slot = calls.find(([name]) => name === 'personal-views')?.[1] as IPersonalViewDoorsService | undefined;
  return { plugin, ctx, slot, calls };
}

const remove = (path = '/api/v1/personal-views/pv_1', method = 'DELETE') =>
  new Request(`${ORIGIN}${path}`, { method, headers: { 'content-type': 'application/json' } });

async function snapshot(res: Response) {
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

describe('[#36506] AuthPlugin serves the personal-view door on its personal-views slot', () => {
  it('init() registers the slot with handlePersonalViewDoor under registerRoutes: false, after auth', async () => {
    const { slot, calls } = await compose();
    expect(typeof slot?.handlePersonalViewDoor).toBe('function');
    const names = calls.map(([name]) => name);
    expect(names[0], 'auth stays the plugin\'s first service registration').toBe('auth');
    expect(names.filter((name) => name === 'personal-views')).toHaveLength(1);
  });

  it('a request naming nobody: the door\'s own 401 UNAUTHENTICATED, the same bytes the self-hosted mount answers', async () => {
    const { plugin, ctx, slot } = await compose();
    const viaMember = await snapshot(await slot!.handlePersonalViewDoor!(remove()));
    expect(viaMember.status).toBe(401);
    expect(JSON.parse(viaMember.body)?.error?.code).toBe('UNAUTHENTICATED');

    // The self-hosted face: the plugin's own mount, on a real server table.
    const server = new HonoHttpServer(0);
    (plugin as unknown as { mountPersonalViewDoor(http: unknown, c: PluginContext): void }).mountPersonalViewDoor(server, ctx);
    const viaMount = await snapshot(await server.getRawApp().fetch(remove()));
    expect(viaMember).toEqual(viaMount);
  });

  it('a method or path that is not the door: 404 ENDPOINT_NOT_FOUND', async () => {
    const { slot } = await compose();
    for (const request of [remove('/api/v1/personal-views/pv_1', 'GET'), remove('/api/v1/personal-views'), remove('/api/v1/views/pv_1')]) {
      const res = await slot!.handlePersonalViewDoor!(request);
      expect(res.status, `${request.method} ${new URL(request.url).pathname}`).toBe(404);
      expect((await res.json())?.error?.code).toBe('ENDPOINT_NOT_FOUND');
    }
  });
});
