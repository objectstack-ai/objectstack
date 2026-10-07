// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22049] The dispatcher's two PUBLIC share-link routes read the password
 * header as `X-Share-Password-Encoding` declares it — the same reading
 * (`readSharePasswordHeader`, `@objectstack/types`) the plugin-sharing mount
 * uses, pinned there in `plugin-sharing/src/share-link-password.test.ts`:
 *
 *  - `utf-8`: the header carries the password percent-encoded, so a CJK and an
 *    emoji password resolve on `/resolve` and `/messages`;
 *  - absent: the header is read raw, so a Latin-1 password and a raw one
 *    containing `%` resolve unchanged, and an encoded value is NOT guessed at;
 *  - a declared encoding that does not hold, or any other encoding: `400
 *    VALIDATION_FAILED` in the ADR-0112 envelope, before the token is looked
 *    up, ⛔ never a raw compare.
 *
 * Driven over a REAL `ObjectQL` + `@objectstack/driver-sql` + better-sqlite3,
 * the harness `share-links-public-cache-headers.test.ts` uses, with the request
 * headers on `context.request` the way the dispatcher plugin hands them over.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
import { ShareLinkService, SysShareLink } from '@objectstack/plugin-sharing';
import { apiErrorResponse } from '../error-envelope.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { handleShareLinksRequest } from './share-links.js';

const CJK = '分享密码二二零四九';
const EMOJI = 'open 🔐🦊 sesame';
const LATIN1 = 'Déjà vu ½ ÿ 22049';
const RAW_PERCENT = 'grade 100% %zz 22049';
const RAW_PERCENT_ESCAPE = '50%25 off 22049';

const CONVERSATIONS = {
  name: 'ai_conversations',
  label: 'Conversation',
  publicSharing: { enabled: true, allowedAudiences: ['link_only'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

const MESSAGES = {
  name: 'ai_messages',
  label: 'Message',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    conversation_id: { name: 'conversation_id', label: 'Conversation', type: 'text' },
    content: { name: 'content', label: 'Content', type: 'text' },
    created_at: { name: 'created_at', label: 'Created', type: 'text' },
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
  vi.restoreAllMocks();
  while (engines.length) {
    try {
      await engines.pop()!.destroy();
    } catch {
      /* noop */
    }
  }
});

type Answer = { status: number; body?: any; headers?: Record<string, string> };
type Route = 'resolve' | 'messages';

async function harness(password: string) {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, CONVERSATIONS, MESSAGES]) engine.registry.registerObject(o as any, '@objectstack/runtime-test');
  await engine.syncSchemas();
  const sys = { context: { isSystem: true } } as any;
  await engine.insert('ai_conversations', { id: 'conv_1', title: 'Chat' }, sys);
  await engine.insert(
    'ai_messages',
    { id: 'msg_1', conversation_id: 'conv_1', content: 'hello', created_at: '2026-01-01T00:00:00Z' },
    sys,
  );
  const svc = new ShareLinkService({ engine: engine as any });
  const deps = makeDeps(engine, svc);
  const link = await svc.createLink(
    { object: 'ai_conversations', recordId: 'conv_1', password },
    { isSystem: true, userId: 'usr_creator' } as any,
  );
  /** A public GET, with the request headers on `context.request` as the dispatcher plugin passes them. */
  const call = async (
    route: Route,
    headers: Record<string, string> | Headers = {},
    query: Record<string, string> = {},
  ): Promise<Answer> => {
    const res = await handleShareLinksRequest(deps, `/${link.token}/${route}`, 'GET', undefined, query, {
      request: { headers },
    } as unknown as HttpProtocolContext);
    if (!res.handled || !res.response) throw new Error(`GET /${route} was not handled`);
    return res.response as Answer;
  };
  return { call, svc };
}

function expectServed(route: Route, answer: Answer, label: string) {
  expect(answer.status, label).toBe(200);
  expect(answer.body?.success, label).toBe(true);
  if (route === 'messages') expect(answer.body?.data?.map((m: any) => m.id), label).toEqual(['msg_1']);
  else expect(answer.body?.data?.record?.id, label).toBe('conv_1');
}

const UTF8 = { 'x-share-password-encoding': 'utf-8' };

describe('[#22049] dispatcher: X-Share-Password-Encoding: utf-8 carries any password', () => {
  it.each([
    ['resolve', 'CJK', CJK],
    ['resolve', 'emoji', EMOJI],
    ['messages', 'CJK', CJK],
    ['messages', 'emoji', EMOJI],
  ] as const)('/%s serves a %s password sent percent-encoded', async (route, label, password) => {
    const { call } = await harness(password);
    expectServed(route, await call(route, { 'x-share-password': encodeURIComponent(password), ...UTF8 }), label);
  });

  it('reads the pair from a Fetch `Headers` too, case-insensitively', async () => {
    const { call } = await harness(EMOJI);
    const headers = new Headers({ 'X-Share-Password': encodeURIComponent(EMOJI), 'X-Share-Password-Encoding': 'UTF-8' });
    expectServed('resolve', await call('resolve', headers), 'Headers');
  });

  it.each([
    ['resolve', 401, 'WRONG_PASSWORD'],
    ['messages', 404, 'NOT_FOUND'],
  ] as const)('/%s does not guess: the encoded value with no encoding header is compared raw', async (route, status, code) => {
    const { call } = await harness(CJK);
    const answer = await call(route, { 'x-share-password': encodeURIComponent(CJK) });
    expect(answer.status).toBe(status);
    expect(answer.body?.error?.code).toBe(code);
  });
});

describe('[#22049] dispatcher: without the encoding header the value is read raw, unchanged', () => {
  it.each([
    ['resolve', 'Latin-1', LATIN1],
    ['resolve', 'raw with a stray %', RAW_PERCENT],
    ['resolve', 'raw with a %-escape', RAW_PERCENT_ESCAPE],
    ['messages', 'Latin-1', LATIN1],
    ['messages', 'raw with a stray %', RAW_PERCENT],
    ['messages', 'raw with a %-escape', RAW_PERCENT_ESCAPE],
  ] as const)('/%s serves a %s password sent raw', async (route, label, password) => {
    const { call } = await harness(password);
    expectServed(route, await call(route, { 'x-share-password': password }), label);
  });
});

describe('[#22049] dispatcher: a declared encoding that does not hold is refused, never compared raw', () => {
  it.each([
    ['resolve', 'a truncated UTF-8 sequence', { 'x-share-password': '%E5%88', ...UTF8 }],
    ['resolve', 'an octet that is not UTF-8', { 'x-share-password': '%FF', ...UTF8 }],
    ['resolve', 'an encoding the server does not read', { 'x-share-password': encodeURIComponent(CJK), 'x-share-password-encoding': 'latin1' }],
    ['messages', 'a truncated UTF-8 sequence', { 'x-share-password': '%E5%88', ...UTF8 }],
    ['messages', 'an octet that is not UTF-8', { 'x-share-password': '%FF', ...UTF8 }],
    ['messages', 'an encoding the server does not read', { 'x-share-password': encodeURIComponent(CJK), 'x-share-password-encoding': 'latin1' }],
  ] as const)('/%s answers %s 400 VALIDATION_FAILED, before the token is looked up', async (route, _label, headers) => {
    const { call, svc } = await harness(CJK);
    const resolveToken = vi.spyOn(svc, 'resolveToken');
    const answer = await call(route, { ...headers });
    expect(answer.status).toBe(400);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('VALIDATION_FAILED');
    expect(answer.body?.error?.message).toContain('X-Share-Password');
    expect(JSON.stringify(answer.body)).not.toContain(headers['x-share-password']);
    expect(answer.headers?.['Cache-Control']).toBe('no-store');
    expect(answer.headers?.Vary).toBe('X-Share-Password, X-Share-Password-Encoding');
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'messages'] as const)(
    '/%s: an undecodable value that IS the raw password is still refused once utf-8 is declared',
    async (route) => {
      const rawPassword = '%E5%88 22049';
      const { call } = await harness(rawPassword);
      expectServed(route, await call(route, { 'x-share-password': rawPassword }), 'the raw form, undeclared');
      const declared = await call(route, { 'x-share-password': rawPassword, ...UTF8 });
      expect(declared.status).toBe(400);
      expect(declared.body?.error?.code).toBe('VALIDATION_FAILED');
    },
  );

  it.each(['resolve', 'messages'] as const)('/%s: the ?password= form still wins, and the header pair is then not read', async (route) => {
    const { call } = await harness(CJK);
    const answer = await call(route, { 'x-share-password': '%FF', 'x-share-password-encoding': 'latin1' }, { password: CJK });
    expectServed(route, answer, 'query wins');
  });
});
