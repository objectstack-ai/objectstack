// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ item 3] The storage family's door judges a request that
 * carries an API key by the answer the shared key-admission seam gives for the
 * key's OWNER.
 *
 * ## What was open
 *
 * The door asked the ADR-0069 gate about a session it read on its own. A key
 * carries no session, so a key whose owner owes MFA enrolment passed the door
 * and reached the download authorizer, which admits keys; and a key sent
 * beside a held session was refused with the SESSION's posture.
 *
 * ## What is pinned, on every route of the composed mount
 *
 *  - a key whose owner holds `MFA_REQUIRED` (scope `account`) → `403
 *    MFA_REQUIRED` with the session's message, storage never touched;
 *  - a key whose owner holds only `PASSWORD_EXPIRED` (scope `credential`) →
 *    never the gate's answer;
 *  - [#24366] the family gate and the route judge the same credential: a
 *    session the gate holds is refused `403` with its own posture whatever
 *    else the request carries, storage never touched;
 *  - the refusal is not a revocation: the same key passes once it clears.
 *
 * The composition is `storage-routes.auth-gate.pin.test.ts`'s, with a data
 * engine that knows the key.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { mountStorageRoutes } from './mount-storage-routes.js';
import { STORAGE_ROUTE_LEDGER } from './storage-route-ledger.js';

const BASE = '/api/v1/storage';
const KEY = 'osk_storage_account_posture_pin';
const OWNER = 'u_key_owner';

const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' };
const POSTURE_CODES = ['MFA_REQUIRED', 'PASSWORD_EXPIRED', 'PASSWORD_RESET_REQUIRED'];

type Gate = { code: string; message: string };

/** An ACTIVE gate. A session per `x-test-user`, held by `x-test-hold`; postures per user for the key arm. */
function makeAuth(postures: Record<string, Gate[]>, sessionReads: { n: number }) {
  return {
    isAuthGateActive: () => true,
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        sessionReads.n++;
        const userId = headers.get('x-test-user');
        if (!userId) return undefined;
        const authGate = headers.get('x-test-hold') === 'MFA_REQUIRED' ? MFA_REQUIRED : undefined;
        return { user: { id: userId, ...(authGate ? { authGate } : {}) }, session: {} };
      },
    },
    resolveUserAuthGates: async (userId: string) => postures[userId] ?? [],
  };
}

let rootDirs: string[] = [];
afterEach(async () => {
  for (const dir of rootDirs) await fs.rm(dir, { recursive: true, force: true });
  rootDirs = [];
});

async function mount(postures: Record<string, Gate[]>) {
  const rootDir = join(tmpdir(), `os-23287-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  rootDirs.push(rootDir);
  const adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret-23287' });
  const calls: string[] = [];
  const storage = new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function'
        ? (...args: unknown[]) => { calls.push(String(prop)); return value.apply(target, args); }
        : value;
    },
  });
  const keyHash = hashApiKey(KEY);
  const sessionReads = { n: 0 };
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
  kernel.registerService('storage', storage);
  kernel.registerService('auth', makeAuth(postures, sessionReads));
  kernel.registerService('objectql', {
    find: async (object: string, q: any) => (
      object === 'sys_api_key' && q?.where?.key === keyHash
        ? [{ id: 'key_1', key: keyHash, user_id: OWNER, revoked: false, scopes: '[]' }]
        : []
    ),
  });
  const routes = new Map<string, RouteHandler>();
  const http = {
    get: (path: string, handler: RouteHandler) => { routes.set(`GET ${path}`, handler); },
    post: (path: string, handler: RouteHandler) => { routes.set(`POST ${path}`, handler); },
    put: (path: string, handler: RouteHandler) => { routes.set(`PUT ${path}`, handler); },
    delete: () => {}, patch: () => {}, use: () => {},
    listen: async () => {}, close: async () => {},
  };
  mountStorageRoutes(http as any, kernel, { basePath: BASE, logger: { info: () => {}, warn: () => {} } });
  calls.length = 0;
  return { routes, calls, sessionReads };
}

const PARAMS: Record<string, string> = { uploadId: 'up_23287', chunkIndex: '0', fileId: 'file_23287', token: 'tok_23287' };

async function drive(routes: Map<string, RouteHandler>, key: string, headers: Record<string, string>) {
  const handler = routes.get(key);
  if (!handler) throw new Error(`no handler for ${key}`);
  const method = key.slice(0, key.indexOf(' '));
  const path = key.slice(key.indexOf(' ') + 1);
  const params: Record<string, string> = {};
  for (const seg of path.split('/')) if (seg.startsWith(':')) params[seg.slice(1)] = PARAMS[seg.slice(1)] ?? 'x';
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { captured.body = data; return res; },
    send() { return res; },
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  try {
    await handler({ params, query: {}, body: method === 'GET' ? undefined : {}, headers, method, path } as unknown as IHttpRequest, res as IHttpResponse);
  } catch {
    // A route's own fault past the door is not the gate's answer; the gate's
    // refusal is always WRITTEN, never thrown.
  }
  return { status: captured.status, code: captured.body?.error?.code as string | undefined, body: captured.body };
}

const census = STORAGE_ROUTE_LEDGER.map((row) => row.route);

describe('storage family — a key answers as its owner\'s session does (#23287, ruling C′)', () => {
  it.each(census)('%s · key, owner held by MFA_REQUIRED → 403 MFA_REQUIRED, storage never touched', async (route) => {
    const { routes, calls } = await mount({ [OWNER]: [MFA_REQUIRED] });
    const answer = await drive(routes, route, { 'x-api-key': KEY });
    expect(answer.status).toBe(403);
    expect(answer.code).toBe('MFA_REQUIRED');
    expect(answer.body?.error?.message).toBe(MFA_REQUIRED.message);
    expect(calls).toEqual([]);
  });

  it.each(census)('%s · key, owner held only by PASSWORD_EXPIRED (credential scope) → never the gate', async (route) => {
    const { routes } = await mount({ [OWNER]: [PASSWORD_EXPIRED] });
    const answer = await drive(routes, route, { 'x-api-key': KEY });
    expect(POSTURE_CODES).not.toContain(answer.code);
  });

  it.each(census)('%s · [#24366] a held session is refused with its own posture whatever else the request carries', async (route) => {
    const { routes, calls } = await mount({ [OWNER]: [] });
    const answer = await drive(routes, route, { 'x-api-key': KEY, 'x-test-user': 'u_cookie', 'x-test-hold': 'MFA_REQUIRED' });
    expect(answer.status).toBe(403);
    expect(answer.code).toBe('MFA_REQUIRED');
    expect(answer.body?.error?.message).toBe(MFA_REQUIRED.message);
    expect(calls).toEqual([]);
  });

  it('the refusal is not a revocation: the same key passes the door once the posture clears', async () => {
    const postures: Record<string, Gate[]> = { [OWNER]: [MFA_REQUIRED] };
    const { routes } = await mount(postures);
    const route = census[0]!;
    expect((await drive(routes, route, { 'x-api-key': KEY })).code).toBe('MFA_REQUIRED');
    postures[OWNER] = [];
    expect(POSTURE_CODES).not.toContain((await drive(routes, route, { 'x-api-key': KEY })).code);
  });
});
