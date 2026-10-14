// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ item 3] The share-link family judges an API key by the
 * answer the shared key-admission seam gives for its OWNER.
 *
 * ## What was open
 *
 * `SharingServicePlugin`'s resolver lifted the posture off the session user it
 * read. An API key admits its owner without a session, so the envelope carried
 * no posture and the family's door served a key whose owner owes MFA
 * enrolment.
 *
 * ## What is pinned, through the booted plugin's own resolver
 *
 *  - a key whose owner holds `MFA_REQUIRED` (scope `account`) → `403
 *    MFA_REQUIRED` with the session's message;
 *  - a key whose owner holds only `PASSWORD_RESET_REQUIRED` (scope
 *    `credential`) → served;
 *  - the refusal is not a revocation: the same key is served once the posture
 *    clears.
 *
 * The harness is `share-link-routes.auth-gate.pin.test.ts`'s producer half,
 * with a data engine that knows the key.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SharingServicePlugin } from './sharing-plugin.js';

const BASE = '/api/v1/share-links';
const KEY = 'osk_share_link_account_posture_pin';
const OWNER = 'u_key_owner';

const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_RESET_REQUIRED = { code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' };

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

async function bootPlugin(postures: Record<string, Array<{ code: string; message: string }>>) {
  const http = new MockHttp();
  const keyHash = hashApiKey(KEY);
  const engine = {
    async find(object: string, q: any) {
      if (object === 'sys_api_key' && q?.where?.key === keyHash) {
        return [{ id: 'key_1', key: keyHash, user_id: OWNER, revoked: false, scopes: '[]' }];
      }
      return [];
    },
    async insert(_o: string, row: any) { return row; },
    getSchema(object: string) { return { name: object }; },
  };
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const auth = {
    api: { getSession: async () => undefined },
    resolveUserAuthGates: async (userId: string) => postures[userId] ?? [],
  };
  const ctx = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    hook: (event: string, handler: () => Promise<void> | void) => { (hooks[event] ??= []).push(handler); },
    getService: <T>(name: string): T => {
      if (name === 'objectql') return engine as unknown as T;
      if (name === 'http.server') return http as unknown as T;
      if (name === 'auth') return auth as unknown as T;
      return kernel.getService<T>(name);
    },
    registerService: vi.fn(),
    getKernel: () => kernel,
  };
  const plugin = new SharingServicePlugin({ enforce: false });
  await plugin.start(ctx as unknown as PluginContext);
  for (const handler of hooks['kernel:ready'] ?? []) await handler();
  return http;
}

async function listWithKey(http: MockHttp) {
  const handler = http.routes.get(`GET ${BASE}`);
  if (!handler) throw new Error(`no handler for GET ${BASE}`);
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res: IHttpResponse = {
    json: vi.fn((data: any) => { captured.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  const req = { params: {}, query: {}, headers: { 'x-api-key': KEY }, method: 'GET', path: BASE } as unknown as IHttpRequest;
  await handler(req, res);
  return captured;
}

describe('share-link family — a key answers as its owner\'s session does (#23287, ruling C′)', () => {
  it('REFUSES a key whose owner holds MFA_REQUIRED with the session\'s 403 code and message', async () => {
    const answer = await listWithKey(await bootPlugin({ [OWNER]: [MFA_REQUIRED] }));
    expect(answer.status).toBe(403);
    expect(answer.body?.error?.code).toBe('MFA_REQUIRED');
    expect(answer.body?.error?.message).toBe(MFA_REQUIRED.message);
  });

  it('SERVES a key whose owner holds only a credential-scope posture', async () => {
    const answer = await listWithKey(await bootPlugin({ [OWNER]: [PASSWORD_RESET_REQUIRED] }));
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
  });

  it('the refusal is not a revocation: the same key is served once the posture clears', async () => {
    const postures: Record<string, Array<{ code: string; message: string }>> = { [OWNER]: [MFA_REQUIRED] };
    const http = await bootPlugin(postures);
    expect((await listWithKey(http)).status).toBe(403);
    postures[OWNER] = [];
    expect((await listWithKey(http)).status).toBe(200);
  });
});
