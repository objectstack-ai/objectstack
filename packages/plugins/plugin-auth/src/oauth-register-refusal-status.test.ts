// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24773] `POST /api/v1/auth/sys-oauth-application/register` answers a
 * refused registration with the status the refusal DECLARED — a client error
 * is a coded 4xx (`OAUTH_REGISTER_FAILED`, ADR-0112), never 500 — and a throw
 * that declares no status stays 500.
 *
 * The defect, measured against the installed better-auth: every refusal
 * better-auth raises is better-call's `APIError`, which carries its status
 * twice — the NUMBER `statusCode` (400) and the NAME `status` ('BAD_REQUEST').
 * The wrapper read only a numeric `status`, so each named refusal answered 500:
 * an `http://localhost` redirect URI on a `web` client (the vendor's
 * `invalid_redirect_uri`), and a request with no session (`UNAUTHORIZED`).
 * The body-schema `ValidationError`, whose `status` IS the number 400, answered
 * 400 from the same door — one door, two answers for the same class.
 *
 * This file pins the STATUS only. Which redirect URIs a client may register is
 * the vendor's acceptance rule and is not changed here: the loopback refusals
 * below are the vendor's own answer, used as the fixture's named-status
 * refusal.
 *
 * Driven against REAL better-auth (the installed version, OIDC provider on)
 * behind the plugin's REAL route registration on a real Hono app — the
 * `in-process-session-renewal.pin.test.ts` harness: a real `AuthManager` over
 * the shared in-memory engine. Each refusal asserts the ADR-0112 envelope
 * (`code` + `status`), the vendor's discriminator in `details`, and that no
 * `sys_oauth_application` row was written.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { envelopeViolations } from '@objectstack/spec/api';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-24773';
const EMAIL = 'owner.24773@example.com';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const DOOR = '/sys-oauth-application/register';
const CLIENTS = 'sys_oauth_application';

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as unknown as PluginContext;

let engine: ReturnType<typeof createMemoryEngine>;
let manager: AuthManager;
let app: Hono;
let cookie: string;

const clientRows = (): number => (engine.tables.get(CLIENTS) ?? []).length;

const register = (body: unknown, withSession = true) =>
  app.request(`${ORIGIN}${BASE}${DOOR}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(withSession ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

type Answer = {
  success: boolean;
  data?: { client?: { client_id?: unknown } };
  error?: { code: string; message: string; details?: { upstreamError?: string } };
};

/** The refusal envelope: ADR-0112 `code` + `status`, and nothing persisted. */
async function expectRefused(res: Response, status: number, rowsBefore: number, upstreamError?: string) {
  const body = (await res.json()) as Answer;
  expect(res.status, JSON.stringify(body)).toBe(status);
  expect(envelopeViolations(body)).toEqual([]);
  expect(body.success).toBe(false);
  expect(body.error?.code).toBe('OAUTH_REGISTER_FAILED');
  if (upstreamError) expect(body.error?.details?.upstreamError).toBe(upstreamError);
  expect(clientRows(), 'a refused registration wrote a client row').toBe(rowsBefore);
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  engine = createMemoryEngine();
  manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { oidcProvider: true },
  } as ConstructorParameters<typeof AuthManager>[0]);

  const direct = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const signUp = await direct('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Client Owner' });
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);
  const signIn = await direct('/sign-in/email', { email: EMAIL, password: PASSWORD });
  expect(signIn.status, `sign-in: ${await signIn.clone().text()}`).toBe(200);
  const staged = signIn.headers.getSetCookie().find((c) => /(?:^|\.)session_token=/.test(c.split(';')[0]));
  if (!staged) throw new Error('sign-in staged no session cookie');
  cookie = staged.split(';')[0];

  app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as unknown as { authManager: AuthManager }).authManager = manager;
  (plugin as unknown as {
    registerAuthRoutes(server: unknown, ctx: PluginContext): void;
  }).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
});

afterAll(() => vi.restoreAllMocks());

describe('[#24773] precondition — the fixture refusal is a NAMED-status APIError', () => {
  it('better-auth refuses a loopback redirect URI on a web client with status "BAD_REQUEST" / statusCode 400', async () => {
    // Without this, a vendor that switched to a numeric `status` would let the
    // pins below pass on the pre-fix wrapper too, and prove nothing.
    const api = (await manager.getApi()) as unknown as {
      createOAuthClient(input: unknown): Promise<unknown>;
    };
    const thrown = await api
      .createOAuthClient({
        body: { client_name: 'precondition', redirect_uris: ['http://localhost:4001/callback'], application_type: 'web' },
        headers: new Headers({ cookie }),
      })
      .then(() => undefined, (e: unknown) => e as { name?: unknown; status?: unknown; statusCode?: unknown; body?: { error?: unknown } });
    expect(thrown, 'the vendor accepted the fixture URI — nothing below is a refusal').toBeDefined();
    expect(thrown?.name).toBe('APIError');
    expect(thrown?.status).toBe('BAD_REQUEST');
    expect(thrown?.statusCode).toBe(400);
    expect(thrown?.body?.error).toBe('invalid_redirect_uri');
  });
});

describe('[#24773] a refusal answers the status it declared, never 500', () => {
  it('http://localhost redirect URI on a web client: 400 OAUTH_REGISTER_FAILED, invalid_redirect_uri', async () => {
    const before = clientRows();
    const res = await register({ name: 'Local Dev', redirectURLs: 'http://localhost:4001/callback', type: 'web' });
    await expectRefused(res, 400, before, 'invalid_redirect_uri');
  });

  it('http://127.0.0.1 redirect URI on a web client: 400 OAUTH_REGISTER_FAILED, invalid_redirect_uri', async () => {
    const before = clientRows();
    const res = await register({ name: 'Local Dev', redirectURLs: 'http://127.0.0.1:4001/callback', type: 'web' });
    await expectRefused(res, 400, before, 'invalid_redirect_uri');
  });

  it('no session: the vendor\'s UNAUTHORIZED answers 401 OAUTH_REGISTER_FAILED', async () => {
    const before = clientRows();
    const res = await register({ name: 'Anonymous', redirectURLs: 'https://app.example.com/callback' }, false);
    await expectRefused(res, 401, before);
  });

  it('preserved: the body-schema refusal (numeric status) still answers 400', async () => {
    const before = clientRows();
    const res = await register({ name: 'Plain HTTP', redirectURLs: 'http://app.example.com/callback' });
    await expectRefused(res, 400, before);
  });
});

describe('[#24773] a throw that declares no status is a server fault: 500', () => {
  it('a storage fault while persisting the client answers 500, not a client error', async () => {
    const before = clientRows();
    const insert = engine.insert;
    engine.insert = async (name: string, data: unknown) => {
      if (name === CLIENTS) throw new Error('storage fault (test)');
      return insert(name, data);
    };
    try {
      const res = await register({ name: 'Fault', redirectURLs: 'https://app.example.com/callback' });
      await expectRefused(res, 500, before);
    } finally {
      engine.insert = insert;
    }
  });
});

describe('[#24773] control — an accepted registration', () => {
  it('https redirect URI on a web client: 200 with the minted client, one row written', async () => {
    const before = clientRows();
    const res = await register({ name: 'Production', redirectURLs: 'https://app.example.com/callback', type: 'web' });
    const body = (await res.json()) as Answer;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(envelopeViolations(body)).toEqual([]);
    expect(typeof body.data?.client?.client_id).toBe('string');
    expect(clientRows()).toBe(before + 1);
  });
});
