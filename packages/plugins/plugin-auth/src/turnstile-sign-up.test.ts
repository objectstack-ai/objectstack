// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Opt-in Cloudflare Turnstile on email sign-up (`turnstile-sign-up.ts`).
 *
 *  - ① ON (both keys set): a sign-up with no token is refused before anything
 *    is written; a token is verified with Cloudflare (a stubbed `fetch`, no
 *    network) and the sign-up then runs; a token Cloudflare rejects is
 *    refused; a verification that cannot complete fails closed, and neither
 *    the answer nor any log line carries the secret.
 *  - ② the challenge guards sign-up only: password sign-in and the password
 *    reset request are answered as before, with no token.
 *  - ③ OFF (neither key, or only one): sign-up is answered with no token and
 *    no call to Cloudflare, the public config carries no site key, and a
 *    half-configured deployment is told which variable is missing — by name.
 *  - ④ the public config serves the site key, and never the secret, and the
 *    key is one the spec's registry declares.
 *
 * Real engine, the harness `signup-existing-address-success-shape.test.ts`
 * uses: the sign-up must actually create the account when the token passes.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS } from '@objectstack/spec/kernel';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';
import { TURNSTILE_SECRET_KEY_ENV, TURNSTILE_SITE_KEY_ENV } from './turnstile-sign-up.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-turnstile';
const PASSWORD = 'S3cure!Passw0rd-turnstile';
const SITE_KEY = '0x4AAAAAAA-site-key-public';
const TURNSTILE_SECRET = '0x4AAAAAAA-secret-never-served';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SYSTEM = { context: { isSystem: true } } as never;

const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

const OPEN = { audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' } };

const engines: ObjectQL[] = [];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of [TURNSTILE_SITE_KEY_ENV, TURNSTILE_SECRET_KEY_ENV]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  while (engines.length) {
    const engine = engines.pop();
    try {
      await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

function turnOn(): void {
  process.env[TURNSTILE_SITE_KEY_ENV] = SITE_KEY;
  process.env[TURNSTILE_SECRET_KEY_ENV] = TURNSTILE_SECRET;
}

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  engine.registry.registerObject(sysPermissionSet as never, '@objectstack/plugin-security');
  engine.registry.registerObject(sysUserPermissionSet as never, '@objectstack/plugin-security');
  await engine.syncSchemas();
  await relaxTenantColumns(engine, ['sys_permission_set']);
  const bound = await bindTestSecurityCatalog(engine, { permissions: [{ name: 'member_default' }] });
  await (engine as any).getDriver('sys_permission_set').create(
    'sys_permission_set',
    { id: 'ps_member_default', name: 'member_default', label: 'member_default', active: true },
  );
  return bound;
}

/** Everything the manager and the vendor write, at every level. */
function recordingLogger(): { lines: string[]; logger: Record<string, unknown> } {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a ?? {})))).join(' '));
  };
  return { lines, logger: { error: record, warn: record, info: record, debug: record } };
}

async function makeManager(extra: Record<string, unknown> = {}): Promise<{ manager: AuthManager; engine: ObjectQL }> {
  const engine = await bootEngine();
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never, ...OPEN, ...extra } as never);
  manager.setEmailService({
    async send() { return { id: 'e', status: 'sent' }; },
    async sendTemplate() { return { id: 'e', status: 'sent' }; },
    isConfigured: () => true,
  } as never);
  await manager.getAuthInstance();
  return { manager, engine };
}

/**
 * Stub Cloudflare's siteverify. `answer` is what it replies, or `'unreachable'`
 * to reject the request as a network failure. Every other URL is a test bug.
 */
function stubSiteverify(answer: Record<string, unknown> | 'unreachable') {
  const calls: Array<Record<string, unknown>> = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== SITEVERIFY) throw new Error(`unexpected fetch in test: ${url}`);
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (answer === 'unreachable') throw new TypeError('fetch failed (simulated)');
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchStub);
  return { calls, fetchStub };
}

function signUp(manager: AuthManager, email: string, token?: string): Promise<Response> {
  return manager.handleRequest(
    new Request(`${AUTH}/sign-up/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        ...(token ? { 'x-captcha-response': token } : {}),
      },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Someone' }),
    }),
  );
}

async function userCount(engine: ObjectQL, email: string): Promise<number> {
  const rows = await engine.find('sys_user', { where: { email }, limit: 10 }, SYSTEM);
  return (Array.isArray(rows) ? rows : []).length;
}

describe('① Turnstile ON: sign-up needs a token Cloudflare verifies', () => {
  it('refuses a sign-up with no token, before Cloudflare is asked and before anything is written', async () => {
    turnOn();
    const { calls } = stubSiteverify({ success: true });
    const { manager, engine } = await makeManager();

    const res = await signUp(manager, 'no-token@corp.example');

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('MISSING_RESPONSE');
    expect(calls).toHaveLength(0);
    expect(await userCount(engine, 'no-token@corp.example')).toBe(0);
  });

  it('verifies the token with Cloudflare, with the secret, and then runs the sign-up', async () => {
    turnOn();
    const { calls } = stubSiteverify({ success: true, hostname: 'localhost' });
    const { manager, engine } = await makeManager();

    const res = await signUp(manager, 'with-token@corp.example', 'token-from-widget');

    expect(res.status, `the verified sign-up was refused: ${await res.clone().text()}`).toBeLessThan(300);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ secret: TURNSTILE_SECRET, response: 'token-from-widget' });
    expect(await userCount(engine, 'with-token@corp.example')).toBe(1);
  });

  it('refuses a token Cloudflare rejects, and writes nothing', async () => {
    turnOn();
    stubSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    const { manager, engine } = await makeManager();

    const res = await signUp(manager, 'rejected@corp.example', 'forged-token');

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe('VERIFICATION_FAILED');
    expect(await userCount(engine, 'rejected@corp.example')).toBe(0);
  });

  it('fails closed when Cloudflare cannot be reached, and the secret is in neither the answer nor a log line', async () => {
    turnOn();
    stubSiteverify('unreachable');
    const { lines, logger } = recordingLogger();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    try {
      const { manager, engine } = await makeManager({ logger });

      const res = await signUp(manager, 'unreachable@corp.example', 'token-from-widget');
      const body = await res.text();

      expect(res.status).toBe(500);
      expect(body).not.toContain(TURNSTILE_SECRET);
      expect(lines.join('\n')).not.toContain(TURNSTILE_SECRET);
      expect(await userCount(engine, 'unreachable@corp.example')).toBe(0);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('② the challenge guards sign-up only', () => {
  it('answers password sign-in and the password-reset request with no token, as before', async () => {
    turnOn();
    const { calls } = stubSiteverify({ success: true });
    const { manager } = await makeManager();

    const signIn = await manager.handleRequest(
      new Request(`${AUTH}/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: 'nobody@corp.example', password: PASSWORD }),
      }),
    );
    expect(((await signIn.json()) as { code?: string }).code).not.toBe('MISSING_RESPONSE');
    expect(signIn.status).not.toBe(400);

    const reset = await manager.handleRequest(
      new Request(`${AUTH}/request-password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: 'nobody@corp.example', redirectTo: '/reset' }),
      }),
    );
    expect(((await reset.json()) as { code?: string }).code).not.toBe('MISSING_RESPONSE');
    expect(calls).toHaveLength(0);
  });
});

describe('③ Turnstile OFF: sign-up is unchanged', () => {
  for (const [label, env] of [
    ['neither key', {}],
    ['the site key alone', { [TURNSTILE_SITE_KEY_ENV]: SITE_KEY }],
    ['the secret alone', { [TURNSTILE_SECRET_KEY_ENV]: TURNSTILE_SECRET }],
    ['a blank secret', { [TURNSTILE_SITE_KEY_ENV]: SITE_KEY, [TURNSTILE_SECRET_KEY_ENV]: '   ' }],
  ] as const) {
    it(`${label}: sign-up with no token succeeds, Cloudflare is never asked, no site key is served`, async () => {
      Object.assign(process.env, env);
      const { fetchStub } = stubSiteverify({ success: false });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { manager, engine } = await makeManager();

        const res = await signUp(manager, 'plain@corp.example');

        expect(res.status, `sign-up was refused with the challenge off: ${await res.clone().text()}`).toBeLessThan(300);
        expect(fetchStub).not.toHaveBeenCalled();
        expect(await userCount(engine, 'plain@corp.example')).toBe(1);
        expect(manager.getPublicConfig().features).not.toHaveProperty('turnstileSiteKey');
      } finally {
        warnSpy.mockRestore();
      }
    });
  }

  it('tells a half-configured deployment which variable is missing, by name and never by value', async () => {
    process.env[TURNSTILE_SITE_KEY_ENV] = SITE_KEY;
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => { warnings.push(a.map(String).join(' ')); });
    try {
      await makeManager();
    } finally {
      warnSpy.mockRestore();
    }
    const line = warnings.find((w) => w.includes(TURNSTILE_SECRET_KEY_ENV));
    expect(line, warnings.join('\n')).toBeDefined();
    expect(line).toContain('OFF');
    expect(warnings.join('\n')).not.toContain(SITE_KEY);
  });

  it('says nothing about Turnstile when neither variable is set', async () => {
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => { warnings.push(a.map(String).join(' ')); });
    try {
      await makeManager();
    } finally {
      warnSpy.mockRestore();
    }
    expect(warnings.join('\n')).not.toMatch(/turnstile/i);
  });
});

describe('④ the public config serves the site key, never the secret', () => {
  it('serves features.turnstileSiteKey while on, a key the spec registry declares, and no trace of the secret', async () => {
    turnOn();
    const { manager } = await makeManager();

    const config = manager.getPublicConfig();

    expect(config.features).toHaveProperty('turnstileSiteKey', SITE_KEY);
    expect(PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS).toContain('turnstileSiteKey');
    expect(JSON.stringify(config)).not.toContain(TURNSTILE_SECRET);
  });
});
