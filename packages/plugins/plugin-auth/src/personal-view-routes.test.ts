// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The owner's delete door's own shell (`personal-view-routes.ts`): the answers
 * it gives before the engine is ever asked. The authorization itself (own row
 * removed, another member's and an organization administrator's attempt
 * answered like an unknown id, a platform administrator refused loudly, the
 * generic delete still refused) is pinned on the real engine and security
 * plugin in `personal-view-hooks.test.ts`, and through the real HTTP stack in
 * the dogfood file `personal-view-row-scope.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { AuthzStoreUnavailableError } from '@objectstack/core';

import {
  PERSONAL_VIEW_REMOVE_ROUTE,
  registerPersonalViewRoutes,
  type PersonalViewEngine,
  type PersonalViewRoutesDeps,
} from './personal-view-routes.js';

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
  await handler({ method: 'DELETE', path: '/api/v1/personal-views/v1', params: {}, query: {}, headers: {}, ...req }, res);
  return answer;
}

/** An engine that records whether it was asked anything. */
function untouchedEngine() {
  const engine = { findOne: vi.fn(), delete: vi.fn() };
  return engine as typeof engine & PersonalViewEngine;
}

function door(deps: PersonalViewRoutesDeps): Handler {
  const { routes, server } = capturingServer();
  registerPersonalViewRoutes(server as any, deps);
  const handler = routes.get(`DELETE ${PERSONAL_VIEW_REMOVE_ROUTE}`);
  if (!handler) throw new Error('the registrar mounted no DELETE door');
  return handler;
}

const MEMBER = { userId: 'u_member', positions: [], permissions: [] } as any;

describe('the personal-view delete door — answers given before the engine is asked', () => {
  it('mounts exactly DELETE /api/v1/personal-views/:id', () => {
    const { routes, server } = capturingServer();
    registerPersonalViewRoutes(server as any, {} as any);
    expect([...routes.keys()]).toEqual(['DELETE /api/v1/personal-views/:id']);
  });

  it('a permission store that cannot be read answers its own 503, not a denial', async () => {
    const engine = untouchedEngine();
    const answer = await call(
      door({
        getEngine: () => engine,
        resolveCaller: async () => {
          throw new AuthzStoreUnavailableError('sys_user_permission_set', new Error('connection refused'));
        },
      }),
      { params: { id: 'v1' } },
    );
    expect(answer.status).toBe(503);
    expect(answer.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(engine.findOne).not.toHaveBeenCalled();
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('a request naming nobody is 401 UNAUTHENTICATED', async () => {
    const engine = untouchedEngine();
    const answer = await call(door({ getEngine: () => engine, resolveCaller: async () => undefined }), {
      params: { id: 'v1' },
    });
    expect(answer.status).toBe(401);
    expect(answer.body?.error?.code).toBe('UNAUTHENTICATED');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('a held sign-in answers the authentication policy’s own 403', async () => {
    const engine = untouchedEngine();
    const held = { ...MEMBER, authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } };
    const answer = await call(door({ getEngine: () => engine, resolveCaller: async () => held }), {
      params: { id: 'v1' },
    });
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('PASSWORD_EXPIRED');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('a query parameter is refused, not ignored: 400 VALIDATION_ERROR', async () => {
    const engine = untouchedEngine();
    const answer = await call(door({ getEngine: () => engine, resolveCaller: async () => MEMBER }), {
      params: { id: 'v1' },
      query: { user_id: 'someone_else' },
    });
    expect(answer.status).toBe(400);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(engine.findOne).not.toHaveBeenCalled();
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('no data engine registered is 503 SERVICE_UNAVAILABLE', async () => {
    const answer = await call(door({ getEngine: () => undefined, resolveCaller: async () => MEMBER }), {
      params: { id: 'v1' },
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
      params: { id: 'v1' },
    });
    expect(answer.status).toBe(500);
    expect(answer.body?.error?.code).toBe('INTERNAL_ERROR');
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('the removal runs as the system, attributed to the caller, inside the caller\'s organization', async () => {
    const engine = {
      findOne: vi.fn().mockResolvedValue({ id: 'v1', user_id: 'u_member' }),
      delete: vi.fn().mockResolvedValue(true),
    };
    const answer = await call(
      door({ getEngine: () => engine, resolveCaller: async () => ({ ...MEMBER, tenantId: 'org_a' }) }),
      { params: { id: 'v1' } },
    );
    expect(answer.status).toBe(200);
    expect(answer.body?.data).toEqual({ id: 'v1', deleted: true });
    expect(engine.findOne.mock.calls[0][1].context.userId).toBe('u_member');
    expect(engine.delete.mock.calls[0][1]).toEqual({
      where: { id: 'v1' },
      context: { isSystem: true, attributedUserId: 'u_member', tenantId: 'org_a' },
    });
  });
});
