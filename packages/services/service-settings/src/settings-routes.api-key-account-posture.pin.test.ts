// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ item 3] The settings family judges an API key by the
 * answer the shared key-admission seam gives for its OWNER.
 *
 * ## What was open
 *
 * `SettingsServicePlugin`'s resolver put the posture of the session user it
 * read on the context. An API key admits its owner without a session, so the
 * context carried no posture and the family's door served a key whose owner
 * owes MFA enrolment.
 *
 * ## What is pinned, through the booted plugin's own resolver
 *
 *  - a key whose owner holds `MFA_REQUIRED` (scope `account`) → the context
 *    carries it, and every mounted route answers `403 MFA_REQUIRED` with the
 *    session's message;
 *  - a key whose owner holds only `PASSWORD_EXPIRED` (scope `credential`) →
 *    the context resolves the owner with no posture;
 *  - the refusal is not a revocation: the same key resolves with no posture
 *    once it clears.
 *
 * The boot is `settings-routes.auth-gate.pin.test.ts`'s producer half, with a
 * data engine that knows the key.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import type { SettingsContext } from './settings-service.types.js';

const captured = vi.hoisted(() => ({ contextFromRequest: undefined as
  | ((req: IHttpRequest) => SettingsContext | Promise<SettingsContext>)
  | undefined }));

vi.mock('./settings-routes.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./settings-routes.js')>();
  return {
    ...real,
    registerSettingsRoutes: (http: any, service: any, opts: any = {}) => {
      captured.contextFromRequest = opts.contextFromRequest;
      return real.registerSettingsRoutes(http, service, opts);
    },
  };
});

const { SettingsServicePlugin } = await import('./settings-service-plugin.js');

const KEY = 'osk_settings_account_posture_pin';
const OWNER = 'usr_key_owner';

const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' };

interface Registered { verb: string; path: string; handler: RouteHandler }

class MockHttp implements IHttpServer {
  routes: Registered[] = [];
  private add(verb: string, path: string, handler: RouteHandler) { this.routes.push({ verb, path, handler }); }
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
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  const keyHash = hashApiKey(KEY);
  const services: Record<string, unknown> = {
    'http-server': http,
    auth: {
      api: { getSession: async () => undefined },
      resolveUserAuthGates: async (userId: string) => postures[userId] ?? [],
    },
    objectql: {
      find: async (object: string, q: any) => (
        object === 'sys_api_key' && q?.where?.key === keyHash
          ? [{ id: 'key_1', key: keyHash, user_id: OWNER, revoked: false, scopes: '[]' }]
          : []
      ),
    },
  };
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: () => {},
    getService: (name: string) => services[name],
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    getKernel: () => kernel,
  };
  captured.contextFromRequest = undefined;
  const plugin = new SettingsServicePlugin({ manifests: [], env: {}, actionHandlers: {} });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();
  const contextFromRequest = captured.contextFromRequest as
    | ((req: IHttpRequest) => SettingsContext | Promise<SettingsContext>)
    | undefined;
  if (!contextFromRequest) throw new Error('fixture: the settings routes were not registered');
  return { http, contextFromRequest };
}

const keyRequest = { headers: { 'x-api-key': KEY }, method: 'GET', path: '/' } as unknown as IHttpRequest;

async function drive(route: Registered) {
  const answer: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  const params: Record<string, string> = {};
  for (const seg of route.path.split('/')) if (seg.startsWith(':')) params[seg.slice(1)] = 'branding';
  await route.handler(
    { params, query: {}, body: route.verb === 'GET' ? undefined : { workspace_name: 'x' }, headers: { 'x-api-key': KEY }, method: route.verb, path: route.path } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return answer;
}

describe('settings family — a key answers as its owner\'s session does (#23287, ruling C′)', () => {
  it('a key whose owner holds MFA_REQUIRED is refused 403 MFA_REQUIRED on every mounted route', async () => {
    const { http, contextFromRequest } = await bootPlugin({ [OWNER]: [MFA_REQUIRED] });
    const context = await contextFromRequest(keyRequest);
    expect(context.userId).toBe(OWNER);
    expect(context.authGate).toEqual(MFA_REQUIRED);
    expect(http.routes.length).toBeGreaterThan(0);
    for (const route of http.routes) {
      const answer = await drive(route);
      expect(answer.status, `${route.verb} ${route.path}`).toBe(403);
      expect(answer.body?.error?.code).toBe('MFA_REQUIRED');
      expect(answer.body?.error?.message).toBe(MFA_REQUIRED.message);
    }
  });

  it('a key whose owner holds only a credential-scope posture resolves with no posture', async () => {
    const { contextFromRequest } = await bootPlugin({ [OWNER]: [PASSWORD_EXPIRED] });
    const context = await contextFromRequest(keyRequest);
    expect(context.userId).toBe(OWNER);
    expect('authGate' in context).toBe(false);
  });

  it('the refusal is not a revocation: the same key resolves with no posture once it clears', async () => {
    const postures: Record<string, Array<{ code: string; message: string }>> = { [OWNER]: [MFA_REQUIRED] };
    const { contextFromRequest } = await bootPlugin(postures);
    expect((await contextFromRequest(keyRequest)).authGate).toEqual(MFA_REQUIRED);
    postures[OWNER] = [];
    const again = await contextFromRequest(keyRequest);
    expect(again.userId).toBe(OWNER);
    expect('authGate' in again).toBe(false);
  });
});
