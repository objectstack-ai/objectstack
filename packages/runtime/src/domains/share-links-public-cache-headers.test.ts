// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21839] The dispatcher's two PUBLIC share-link routes answer with
 * `Cache-Control: no-store` and `Vary: X-Share-Password, X-Share-Password-Encoding`
 * on every outcome (the second name since #22049, which made the answer depend on
 * the header declaring the password's encoding too), and the authenticated
 * routes are not touched.
 *
 * Driven over a REAL `ObjectQL` + `@objectstack/driver-sql` + better-sqlite3,
 * the same harness `share-links-internal-hash-probe.test.ts` uses, so every
 * answer below is the one production builds. The plugin-sharing mount pins the
 * same pair in `plugin-sharing/src/share-link-password.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
import { ShareLinkService, SysShareLink } from '@objectstack/plugin-sharing';
import { apiErrorResponse } from '../error-envelope.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { handleShareLinksRequest } from './share-links.js';

const SHARED = 'pin_doc';
const RECORD = 'doc_1';
const PASSWORD = 'no store 21839';

const TARGET = {
  name: SHARED,
  label: 'Pinned Doc',
  publicSharing: { enabled: true, allowedAudiences: ['link_only'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

const realErrorFromThrown = (() => {
  const dispatcher: any = new HttpDispatcher({ context: { getService: () => null } } as any);
  return (e: any, fallbackStatus?: number) => dispatcher.errorFromThrown(e, fallbackStatus);
})();

function makeDeps(engine: any, svc: any): DomainHandlerDeps {
  const deps: any = {
    resolveService: async (_c: any, name: string) =>
      name === SHARE_LINK_SERVICE ? svc : name === 'objectql' ? engine : undefined,
    getRequestKernelService: async (_c: any, name: string) => (name === 'objectql' ? engine : undefined),
    success: (data: any, meta?: any) => ({ status: 200, body: { success: true, data, ...(meta ? { meta } : {}) } }),
    error: (message: string, httpStatus = 500, details?: any) => apiErrorResponse({ message, httpStatus, details }),
    routeNotFound: (route: string) => apiErrorResponse({ message: `Route not found: ${route}`, httpStatus: 404 }),
    errorFromThrown: realErrorFromThrown,
  };
  return deps as DomainHandlerDeps;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try {
      await engines.pop()!.destroy();
    } catch {
      /* noop */
    }
  }
});

type Answer = { status: number; body?: any; headers?: Record<string, string> };

async function harness() {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, TARGET]) engine.registry.registerObject(o as any, '@objectstack/runtime-test');
  await engine.syncSchemas();
  await engine.insert(SHARED, { id: RECORD, title: 'Shared doc' }, { context: { isSystem: true } } as any);
  const svc = new ShareLinkService({ engine: engine as any });
  const deps = makeDeps(engine, svc);
  const call = async (
    subPath: string,
    method: string,
    query: Record<string, string> = {},
    executionContext?: Record<string, unknown>,
  ): Promise<Answer> => {
    const res = await handleShareLinksRequest(deps, subPath, method, undefined, query, {
      executionContext,
    } as unknown as HttpProtocolContext);
    if (!res.handled || !res.response) throw new Error(`${method} ${subPath} was not handled`);
    return res.response as Answer;
  };
  const link = await svc.createLink(
    { object: SHARED, recordId: RECORD, password: PASSWORD },
    { isSystem: true, userId: 'usr_creator' } as any,
  );
  return { call, link };
}

function expectNoStore(answer: Answer, label: string) {
  expect(answer.headers?.['Cache-Control'], label).toBe('no-store');
  expect(answer.headers?.Vary, label).toBe('X-Share-Password, X-Share-Password-Encoding');
}

describe('[#21839] dispatcher public share-link routes are never cached', () => {
  it('/resolve: success, every refusal, and an unknown token', async () => {
    const { call, link } = await harness();

    const right = await call(`/${link.token}/resolve`, 'GET', { password: PASSWORD });
    expect(right.status).toBe(200);
    expectNoStore(right, 'resolved');

    const bare = await call(`/${link.token}/resolve`, 'GET');
    expect(bare.body?.error?.code).toBe('NEEDS_PASSWORD');
    expectNoStore(bare, 'needs password');

    const wrong = await call(`/${link.token}/resolve`, 'GET', { password: 'not it' });
    expect(wrong.body?.error?.code).toBe('WRONG_PASSWORD');
    expectNoStore(wrong, 'wrong password');

    const unknown = await call('/no-such-token-21839/resolve', 'GET');
    expect(unknown.status).toBe(404);
    expectNoStore(unknown, 'unknown token');
  });

  it('/messages: a refusal and an unsupported object both carry the headers', async () => {
    const { call, link } = await harness();

    const refused = await call(`/${link.token}/messages`, 'GET');
    expect(refused.status).toBe(404);
    expectNoStore(refused, 'refused');

    const unsupported = await call(`/${link.token}/messages`, 'GET', { password: PASSWORD });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body?.error?.code).toBe('UNSUPPORTED');
    expectNoStore(unsupported, 'unsupported');
  });

  it('the authenticated routes are not given the public headers', async () => {
    const { call } = await harness();
    const list = await call('', 'GET', {}, { userId: 'usr_creator', isSystem: true });
    expect(list.headers?.['Cache-Control']).toBeUndefined();
    expect(list.headers?.Vary).toBeUndefined();
  });
});

describe('[#21839] a throw outside the body try still carries the public headers', () => {
  const throwingDeps = (): DomainHandlerDeps =>
    ({
      ...makeDeps(undefined, undefined),
      resolveService: async () => {
        throw Object.assign(new Error('service registry unavailable'), { status: 503 });
      },
    }) as unknown as DomainHandlerDeps;

  it('resolveService throwing on /resolve and /messages answers the mapped error with the headers', async () => {
    for (const route of ['/tok_21839/resolve', '/tok_21839/messages']) {
      const res = await handleShareLinksRequest(throwingDeps(), route, 'GET', undefined, {}, {} as HttpProtocolContext);
      expect(res.handled, route).toBe(true);
      const answer = res.response as Answer;
      expect(answer.status, route).toBe(503);
      expectNoStore(answer, route);
    }
  });

  it('an authenticated route still propagates the throw unchanged', async () => {
    await expect(
      handleShareLinksRequest(throwingDeps(), '', 'GET', undefined, {}, {} as HttpProtocolContext),
    ).rejects.toThrow('service registry unavailable');
  });
});
