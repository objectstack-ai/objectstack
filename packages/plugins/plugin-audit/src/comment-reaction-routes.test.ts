// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The unreact door's own shell (`comment-reaction-routes.ts`): who mounts it,
 * and the answers it gives before the engine is ever asked. The authorization
 * itself — own row removed, foreign row refused, an unreadable reaction
 * answered like an unknown id, the generic delete still refused — is pinned on
 * the real kernel, security plugin and caller resolution in plugin-security's
 * `comment-reaction-unreact-door.integration.test.ts`, which can compose
 * plugin-security where this package cannot.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthzStoreUnavailableError, ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';

import { AuditPlugin } from './audit-plugin.js';
import {
  COMMENT_REACTION_REMOVE_ROUTE,
  registerCommentReactionRoutes,
  type CommentReactionEngine,
  type CommentReactionRoutesDeps,
} from './comment-reaction-routes.js';

type Handler = (req: unknown, res: unknown) => unknown;

function capturingServer() {
  const routes = new Map<string, Handler>();
  const record = (verb: string) => (path: string, handler: Handler) => {
    routes.set(`${verb} ${path}`, handler);
  };
  return {
    routes,
    server: {
      get: record('GET'),
      post: record('POST'),
      put: record('PUT'),
      patch: record('PATCH'),
      delete: record('DELETE'),
      use: () => undefined,
      listen: async () => undefined,
      close: async () => undefined,
    },
  };
}

async function call(handler: Handler, req: Partial<{ params: any; query: any; headers: any }>) {
  const answer: { status: number; body: any } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      answer.status = code;
      return res;
    },
    json(body: unknown) {
      answer.body = body;
    },
  };
  await handler({ method: 'DELETE', path: '/api/v1/comments/reactions/r1', params: {}, query: {}, headers: {}, ...req }, res);
  return answer;
}

/** An engine that records whether it was asked anything. */
function untouchedEngine() {
  const engine = { findOne: vi.fn(), delete: vi.fn() };
  return engine as typeof engine & CommentReactionEngine;
}

function door(deps: CommentReactionRoutesDeps): Handler {
  const { routes, server } = capturingServer();
  registerCommentReactionRoutes(server as any, deps);
  const handler = routes.get(`DELETE ${COMMENT_REACTION_REMOVE_ROUTE}`);
  if (!handler) throw new Error('the registrar mounted no DELETE door');
  return handler;
}

const MEMBER = { userId: 'u_member', positions: ['org_member'], permissions: [] } as any;

describe('the unreact door — answers given before the engine is asked', () => {
  it('a permission store that cannot be read answers its own 503, not a denial', async () => {
    const engine = untouchedEngine();
    const answer = await call(
      door({
        getEngine: () => engine,
        resolveCaller: async () => {
          throw new AuthzStoreUnavailableError('sys_user_permission_set', new Error('connection refused'));
        },
      }),
      { params: { id: 'r1' } },
    );
    expect(answer.status).toBe(503);
    expect(answer.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(engine.findOne).not.toHaveBeenCalled();
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('a request naming nobody is 401 UNAUTHENTICATED', async () => {
    const engine = untouchedEngine();
    const answer = await call(door({ getEngine: () => engine, resolveCaller: async () => ({}) as any }), {
      params: { id: 'r1' },
    });
    expect(answer.status).toBe(401);
    expect(answer.body?.error?.code).toBe('UNAUTHENTICATED');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('a held sign-in answers the authentication policy’s own 403', async () => {
    const engine = untouchedEngine();
    const held = { ...MEMBER, authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } };
    const answer = await call(door({ getEngine: () => engine, resolveCaller: async () => held }), {
      params: { id: 'r1' },
    });
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('PASSWORD_EXPIRED');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('no data engine registered is 503 SERVICE_UNAVAILABLE', async () => {
    const answer = await call(door({ getEngine: () => undefined, resolveCaller: async () => MEMBER }), {
      params: { id: 'r1' },
    });
    expect(answer.status).toBe(503);
    expect(answer.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('an engine fault is a 500 INTERNAL_ERROR, never a refusal', async () => {
    const engine = {
      findOne: vi.fn().mockRejectedValue(new Error('disk on fire')),
      delete: vi.fn(),
    };
    const answer = await call(door({ getEngine: () => engine, resolveCaller: async () => MEMBER }), {
      params: { id: 'r1' },
    });
    expect(answer.status).toBe(500);
    expect(answer.body?.error?.code).toBe('INTERNAL_ERROR');
    expect(engine.delete).not.toHaveBeenCalled();
  });
});

describe('AuditPlugin mounts the unreact door on the kernel’s HTTP server', () => {
  let kernel: ObjectKernel | undefined;
  afterEach(async () => {
    await kernel?.shutdown().catch(() => undefined);
    kernel = undefined;
  });

  const httpPlugin = (server: unknown): Plugin => ({
    name: 'test.http',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('http.server', server);
    },
  });

  it('with an HTTP server: DELETE /api/v1/comments/reactions/:id is mounted', async () => {
    const { routes, server } = capturingServer();
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(httpPlugin(server));
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();
    expect([...routes.keys()]).toContain('DELETE /api/v1/comments/reactions/:id');
  }, 60_000);

  it('without one: nothing is mounted and the boot still succeeds', async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await expect(kernel.bootstrap()).resolves.toBeUndefined();
  }, 60_000);
});
