// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21197] The dispatcher's share-link resolve probe on a REAL engine, with
 * `sys_share_link.password_hash` declared `internal: true`.
 *
 * The probe reads the link row to choose between the unknown-link answer and
 * `401 NEEDS_PASSWORD` / `WRONG_PASSWORD`. The engine's read path omits an
 * internal column, so a probe reading `row.password_hash` off that row would
 * answer every protected link with the unknown-link shape: the password prompt
 * never appears, and a client that asks first can never open the link. The
 * probe recovers the hash through objectql's `readInternalColumn`, fail-closed.
 *
 * `share-links-enforcement-context.test.ts` drives this route over an
 * in-memory engine double that never strips, so it cannot see this; the
 * engine here is a real `ObjectQL` over `@objectstack/driver-sql` +
 * better-sqlite3, with the shipped `sys_share_link` definition.
 *
 * Pinned: an unknown token answers the unknown-link shape; a protected link
 * without a password answers `NEEDS_PASSWORD`, a wrong one `WRONG_PASSWORD`,
 * and the right one opens it; the generic read carries no hash.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ShareLinkService, SysShareLink } from '@objectstack/plugin-sharing';
import { apiErrorResponse } from '../error-envelope.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { handleShareLinksRequest } from './share-links.js';

const SHARED = 'pin_doc';
/** The system context, erased once here; the options bags that carry it stay typed. */
const SYS_CTX = { isSystem: true } as any;
const RECORD = 'doc_1';
const PASSWORD = 'open sesame 21197';

const TARGET = {
  name: SHARED,
  label: 'Pinned Doc',
  publicSharing: { enabled: true, allowedAudiences: ['link_only'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

/** The dispatcher's REAL thrown-error mapper, as the sibling suite borrows it. */
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
  const resolve = async (token: string, password?: string) => {
    const res = await handleShareLinksRequest(
      deps,
      `/${token}/resolve`,
      'GET',
      undefined,
      password ? { password } : {},
      { executionContext: undefined } as unknown as HttpProtocolContext,
    );
    if (!res.handled || !res.response) throw new Error('resolve was not handled');
    return res.response as { status: number; body: any };
  };
  return { engine, svc, resolve };
}

describe('[#21197] dispatcher share-link resolve probe: the internal password hash', () => {
  it('unknown token, protected link without, with a wrong and with the right password', async () => {
    const { engine, svc, resolve } = await harness();
    const link = await svc.createLink(
      { object: SHARED, recordId: RECORD, password: PASSWORD },
      { isSystem: true, userId: 'usr_creator' } as any,
    );

    const generic = (await engine.find('sys_share_link', { context: SYS_CTX } satisfies EngineQueryOptions)) as Array<Record<string, unknown>>;
    expect(generic).toHaveLength(1);
    expect(generic[0], 'the generic read carries no hash').not.toHaveProperty('password_hash');

    const unknown = await resolve('no-such-token-21197');
    expect(unknown.status).toBe(404);
    expect(unknown.body?.error?.code).toBe('INVALID_OR_EXPIRED');

    const bare = await resolve(link.token);
    expect(bare.status).toBe(401);
    expect(bare.body?.error?.code).toBe('NEEDS_PASSWORD');

    const wrong = await resolve(link.token, 'not it');
    expect(wrong.status).toBe(401);
    expect(wrong.body?.error?.code).toBe('WRONG_PASSWORD');

    const right = await resolve(link.token, PASSWORD);
    expect(right.status).toBe(200);
    expect(right.body?.data?.record?.id).toBe(RECORD);
    expect(right.body?.data?.link?.token).toBe(link.token);
  });
});
