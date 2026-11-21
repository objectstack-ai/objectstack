// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The comment doors' own shell (`comment-routes.ts`): which routes the
 * registrar mounts, and the answers the resolution door gives before the
 * engine is ever asked. The authorization itself — a member resolving a
 * colleague's thread, removing their own comment and no one else's, a comment
 * with replies kept, the data door unchanged — is pinned on the real kernel,
 * security plugin and caller resolution in plugin-security's
 * `comment-doors.integration.test.ts`, which can compose plugin-security where
 * this package cannot.
 */

import { describe, it, expect, vi } from 'vitest';
import { AuthzStoreUnavailableError } from '@objectstack/core';

import {
  COMMENT_REMOVE_ROUTE,
  COMMENT_RESOLUTION_ROUTE,
  registerCommentDoorsRoutes,
  type CommentDoorsEngine,
  type CommentDoorsRoutesDeps,
} from './comment-routes.js';

type Handler = (req: unknown, res: unknown) => unknown;

function mount(deps: CommentDoorsRoutesDeps) {
  const routes = new Map<string, Handler>();
  const record = (verb: string) => (path: string, handler: Handler) => {
    routes.set(`${verb} ${path}`, handler);
  };
  registerCommentDoorsRoutes(
    { get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE') } as any,
    deps,
  );
  return routes;
}

async function resolveCall(deps: CommentDoorsRoutesDeps, req: Partial<{ params: any; query: any; body: any }>) {
  const handler = mount(deps).get(`PUT ${COMMENT_RESOLUTION_ROUTE}`);
  if (!handler) throw new Error('the registrar mounted no resolution door');
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
  await handler({ method: 'PUT', path: '/api/v1/comments/c1/resolution', params: { id: 'c1' }, query: {}, headers: {}, ...req }, res);
  return answer;
}

function untouchedEngine() {
  const engine = { findOne: vi.fn(), delete: vi.fn(), update: vi.fn() };
  return engine as typeof engine & CommentDoorsEngine;
}

const MEMBER = { userId: 'u_member', positions: ['org_member'], permissions: [] } as any;

describe('the comment doors — what the registrar mounts', () => {
  it('mounts the resolution door and the own-comment delete door, and touches nothing before a request', () => {
    const getEngine = vi.fn();
    const resolveCaller = vi.fn();
    const routes = mount({ getEngine, resolveCaller });
    expect([...routes.keys()].sort()).toEqual([`DELETE ${COMMENT_REMOVE_ROUTE}`, `PUT ${COMMENT_RESOLUTION_ROUTE}`]);
    expect(getEngine).not.toHaveBeenCalled();
    expect(resolveCaller).not.toHaveBeenCalled();
  });
});

describe('the resolution door — answers given before the engine is asked', () => {
  it('a permission store that cannot be read answers its own 503, not a denial', async () => {
    const engine = untouchedEngine();
    const answer = await resolveCall(
      {
        getEngine: () => engine,
        resolveCaller: async () => {
          throw new AuthzStoreUnavailableError('sys_user_permission_set', new Error('connection refused'));
        },
      },
      { body: { resolved: true } },
    );
    expect(answer.status).toBe(503);
    expect(answer.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('a request naming nobody is 401 UNAUTHENTICATED', async () => {
    const engine = untouchedEngine();
    const answer = await resolveCall({ getEngine: () => engine, resolveCaller: async () => ({}) as any }, { body: { resolved: true } });
    expect(answer.status).toBe(401);
    expect(answer.body?.error?.code).toBe('UNAUTHENTICATED');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('a held sign-in answers the authentication policy’s own 403', async () => {
    const engine = untouchedEngine();
    const held = { ...MEMBER, authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } };
    const answer = await resolveCall({ getEngine: () => engine, resolveCaller: async () => held }, { body: { resolved: true } });
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('PASSWORD_EXPIRED');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('no data engine registered is 503 SERVICE_UNAVAILABLE', async () => {
    const answer = await resolveCall({ getEngine: () => undefined, resolveCaller: async () => MEMBER }, { body: { resolved: false } });
    expect(answer.status).toBe(503);
    expect(answer.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('a body other than exactly { resolved: boolean } is 400 VALIDATION_ERROR, and the engine is not asked', async () => {
    for (const body of [undefined, null, {}, [], { resolved: 1 }, { resolved: true, extra: 1 }, { is_resolved: true }]) {
      const engine = untouchedEngine();
      const answer = await resolveCall({ getEngine: () => engine, resolveCaller: async () => MEMBER }, { body });
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(engine.findOne).not.toHaveBeenCalled();
      expect(engine.update).not.toHaveBeenCalled();
    }
  });

  it('a query parameter is refused, not ignored: 400 VALIDATION_ERROR', async () => {
    const engine = untouchedEngine();
    const answer = await resolveCall(
      { getEngine: () => engine, resolveCaller: async () => MEMBER },
      { body: { resolved: true }, query: { force: 'true' } },
    );
    expect(answer.status).toBe(400);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('the write sends is_resolved alone, under a system context attributed to the caller and kept in their organization', async () => {
    const engine = {
      findOne: vi.fn(async (_o: string, q: any) =>
        q.context?.isSystem ? { id: 'c1', is_resolved: true, resolved_by: 'u_member', resolved_at: '2026-11-21T00:00:00.000Z' } : { id: 'c1' },
      ),
      update: vi.fn(async () => ({})),
      delete: vi.fn(),
    };
    const caller = { ...MEMBER, tenantId: 'org_1' };
    const answer = await resolveCall({ getEngine: () => engine as any, resolveCaller: async () => caller }, { body: { resolved: true } });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(engine.findOne.mock.calls[0][1].context).toBe(caller);
    expect(engine.update).toHaveBeenCalledWith('sys_comment', { is_resolved: true }, {
      where: { id: 'c1' },
      context: { isSystem: true, attributedUserId: 'u_member', tenantId: 'org_1' },
    });
    expect(answer.body?.data).toEqual({ id: 'c1', is_resolved: true, resolved_by: 'u_member', resolved_at: '2026-11-21T00:00:00.000Z' });
  });
});
