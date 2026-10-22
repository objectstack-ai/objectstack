// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25111] SSO domain verification accepts the TXT record the platform tells
 * the operator to publish.
 *
 * `POST /admin/sso/request-domain-verification` answers the record to publish:
 * name `_better-auth-token-PROVIDER.DOMAIN`, value
 * `_better-auth-token-PROVIDER=TOKEN` (`register-sso-provider.ts`). The vendor
 * route `POST /sso/verify-domain` (`@better-auth/sso`) accepts a TXT record at
 * that name whose value is EITHER `IDENTIFIER=VALUE` OR the bare `VALUE`, and it
 * builds `IDENTIFIER` from the verification row it read back through the
 * storage adapter (`activeVerification.identifier`). `sys_verification.identifier`
 * is declared `internal`, so the engine strips it from that row, and until the
 * read-back seam (`internal-field-readback.ts`) re-attached it the vendor
 * compared the instructed record against `undefined=TOKEN`: the instructed
 * record answered 502 `DOMAIN_VERIFICATION_FAILED`, and a record literally
 * spelling `undefined=TOKEN` verified.
 *
 * Real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3 with this
 * plugin's own manifest (the strip is live), a real `AuthManager` with the real
 * `sso({ domainVerification })` plugin, and the plugin's REAL route
 * registration on a real Hono app for the bridge door. Only DNS is a double:
 * `node:dns/promises.resolveTxt` answers from a table this file writes. The
 * vendor loads that builtin natively (vitest does not transform it), so the
 * double is installed on the builtin's exports object and published to ES
 * importers with `syncBuiltinESMExports()`, the way
 * `__tests__/scrypt-memo.testkit.ts` reaches `node:crypto`.
 *
 * Pinned, on both doors (the vendor route and the plugin's bridge):
 *  - the instructed record verifies, and the provider row is marked verified;
 *  - a wrong token, a wrong provider label in the value, the instructed value
 *    at another provider's NAME, and the `undefined=TOKEN` record the strip
 *    made the vendor expect are each refused with `code` + `status`, and leave
 *    the provider unverified.
 * Beside them, the vendor's own second form (the bare token) is pinned as the
 * vendor designed it, so a later change to what this door accepts is visible.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import dnsPromises from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects } from './manifest.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit.js';

const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-25111';
const PASSWORD = 'S3cure!Passw0rd-25111';
const DOMAIN = 'acme-25111.example.com';
const SYS = { context: { isSystem: true } } as const;

type Row = Record<string, unknown>;

// ── The DNS double ─────────────────────────────────────────────────────────

/** TXT records by fully-qualified name, as `resolveTxt` returns them (chunks per record). */
const published = new Map<string, string[][]>();
/** Every name the vendor asked for, in order: the positive control that the double is reached. */
const queried: string[] = [];
const dnsExports = dnsPromises as unknown as { resolveTxt: typeof dnsPromises.resolveTxt };
const originalResolveTxt = dnsExports.resolveTxt;

function installDnsDouble(): void {
  dnsExports.resolveTxt = (async (name: string) => {
    queried.push(name);
    const records = published.get(name);
    if (records) return records;
    throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND', hostname: name });
  }) as typeof dnsPromises.resolveTxt;
  syncBuiltinESMExports();
}

function restoreDns(): void {
  dnsExports.resolveTxt = originalResolveTxt;
  syncBuiltinESMExports();
}

/** Publish exactly one TXT record at `name`, replacing whatever was there. */
function publish(name: string, value: string): void {
  published.clear();
  published.set(name, [[value]]);
}

// ── The stack ──────────────────────────────────────────────────────────────

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

interface Driver {
  find(object: string, query: unknown): Promise<Row[]>;
  create(object: string, data: Row): Promise<Row>;
  update(object: string, id: string, data: Row): Promise<Row | null>;
}

let engine: ObjectQL;
let driver: Driver;
let manager: AuthManager;
let app: Hono;
let bearer: string;
let adminId: string;
const scrypt = memoizeScrypt();

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  installDnsDouble();

  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  driver = (engine as unknown as { getDriver(o: string): Driver }).getDriver('sys_verification');

  manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    plugins: { admin: true, sso: true, ssoDomainVerification: true },
  } as never);

  const email = 'admin.25111@example.com';
  const signUp = await vendor('/sign-up/email', { email, password: PASSWORD, name: 'Platform Admin' });
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);
  const [admin] = (await driver.find('sys_user', { where: { email } })) as Row[];
  adminId = String(admin!.id);
  // The legacy scalar `isPlatformAdminUser` accepts, so the bridge's `gateAdmin` admits.
  await driver.update('sys_user', adminId, { role: 'admin' });

  const signIn = await vendor('/sign-in/email', { email, password: PASSWORD });
  expect(signIn.status, `sign-in: ${await signIn.clone().text()}`).toBe(200);
  bearer = String(signIn.headers.get('set-auth-token') ?? '');
  if (!bearer) throw new Error('sign-in emitted no set-auth-token');

  app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
}, 120_000);

afterAll(async () => {
  restoreDns();
  scrypt.restore();
  vi.restoreAllMocks();
  try {
    await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
  } catch {
    /* noop */
  }
});

/** A request straight at better-auth's handler: the vendor door. */
function vendor(path: string, body: unknown, withBearer = false): Promise<Response> {
  return manager.handleRequest(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...(withBearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

/** A request at the plugin's mounted `/admin/sso/*` route: the bridge door. */
async function bridge(door: 'request-domain-verification' | 'verify-domain', body: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(
    new Request(`${ORIGIN}${BASE}/admin/sso/${door}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
}

/** An org-less provider the admin registered (`checkProviderAccess` grants the registrar), unverified. */
async function seedProvider(providerId: string): Promise<void> {
  const now = new Date().toISOString();
  await driver.create('sys_sso_provider', {
    id: `ssop_${providerId}`,
    provider_id: providerId,
    issuer: `https://idp.${DOMAIN}`,
    domain: DOMAIN,
    user_id: adminId,
    organization_id: null,
    domain_verified: false,
    created_at: now,
    updated_at: now,
  });
}

async function domainVerified(providerId: string): Promise<boolean> {
  const [row] = (await driver.find('sys_sso_provider', { where: { provider_id: providerId } })) as Row[];
  return row?.domain_verified === true || row?.domain_verified === 1;
}

/** Ask the bridge for the record to publish, the way the admin's action does. */
async function instructedRecord(providerId: string): Promise<{ name: string; value: string; token: string }> {
  const { status, json } = await bridge('request-domain-verification', { providerId, domain: DOMAIN });
  expect(status, JSON.stringify(json)).toBe(200);
  expect(json.data.dnsRecordType).toBe('TXT');
  return { name: json.data.dnsRecordName, value: json.data.dnsRecordValue, token: json.data.token };
}

/** One verify call on either door, normalised to status + error code. */
async function verify(door: 'vendor' | 'bridge', providerId: string): Promise<{ status: number; code: string | undefined; body: unknown }> {
  if (door === 'vendor') {
    const res = await vendor('/sso/verify-domain', { providerId }, true);
    const text = await res.text();
    const body = text ? JSON.parse(text) : undefined;
    return { status: res.status, code: body?.code, body };
  }
  const { status, json } = await bridge('verify-domain', { providerId });
  return { status, code: json?.error?.code, body: json };
}

// ── Preconditions ──────────────────────────────────────────────────────────

describe('[#25111] preconditions — the strip is live and the record names the provider', () => {
  it('the generic read omits `identifier` from the verification row; storage holds it', async () => {
    const providerId = 'p25111-precondition';
    await seedProvider(providerId);
    const record = await instructedRecord(providerId);
    const label = `_better-auth-token-${providerId}`;
    expect(record.name).toBe(`${label}.${DOMAIN}`);
    expect(record.value).toBe(`${label}=${record.token}`);

    const generic = ((await (engine as any).find('sys_verification', { ...SYS })) as Row[]).filter(
      (r) => r.id !== undefined,
    );
    expect(generic.length).toBeGreaterThan(0);
    for (const row of generic) expect(row, 'the generic read omits the column').not.toHaveProperty('identifier');
    const atRest = await driver.find('sys_verification', { where: { identifier: label } });
    expect(atRest, 'storage holds the row keyed by the provider label').toHaveLength(1);
    expect(atRest[0]!.value).toBe(record.token);
  });
});

// ── The pins, per door ─────────────────────────────────────────────────────

for (const door of ['vendor', 'bridge'] as const) {
  const accepted = door === 'vendor' ? 204 : 200;

  describe(`[#25111] ${door} door — POST ${door === 'vendor' ? '/sso/verify-domain' : '/admin/sso/verify-domain'}`, () => {
    const providerId = `p25111-${door}`;
    let record: { name: string; value: string; token: string };

    beforeAll(async () => {
      await seedProvider(providerId);
      record = await instructedRecord(providerId);
    });

    const refusals: Array<[string, () => [string, string]]> = [
      ['a wrong token under the right label', () => [record.name, `_better-auth-token-${providerId}=${'x'.repeat(record.token.length)}`]],
      ['the right token under another provider’s label', () => [record.name, `_better-auth-token-p25111-other=${record.token}`]],
      ['the instructed value published at another provider’s name', () => [`_better-auth-token-p25111-other.${DOMAIN}`, record.value]],
    ];

    for (const [label, recordFor] of refusals) {
      it(`refuses ${label}: 502 DOMAIN_VERIFICATION_FAILED, provider left unverified`, async () => {
        const [name, value] = recordFor();
        publish(name, value);
        queried.length = 0;
        const res = await verify(door, providerId);
        expect(res.status, JSON.stringify(res.body)).toBe(502);
        expect(res.code, JSON.stringify(res.body)).toBe('DOMAIN_VERIFICATION_FAILED');
        expect(queried, 'the vendor asked DNS for the instructed name').toEqual([record.name]);
        expect(await domainVerified(providerId)).toBe(false);
      });
    }

    // Its own provider: on a store that hands the vendor the stripped row this
    // record VERIFIES, and a verified provider would turn every later case on
    // the shared one into 409 DOMAIN_VERIFIED instead of the answer it pins.
    it('refuses `undefined=TOKEN`, the record the stripped row made the vendor expect: 502 DOMAIN_VERIFICATION_FAILED, provider left unverified', async () => {
      const own = `${providerId}-undefined`;
      await seedProvider(own);
      const ownRecord = await instructedRecord(own);
      publish(ownRecord.name, `undefined=${ownRecord.token}`);
      const res = await verify(door, own);
      expect(res.status, JSON.stringify(res.body)).toBe(502);
      expect(res.code, JSON.stringify(res.body)).toBe('DOMAIN_VERIFICATION_FAILED');
      expect(await domainVerified(own)).toBe(false);
    });

    it(`accepts the instructed record: ${accepted}, and the provider is marked verified`, async () => {
      publish(record.name, record.value);
      queried.length = 0;
      const res = await verify(door, providerId);
      expect(res.status, JSON.stringify(res.body)).toBe(accepted);
      if (door === 'bridge') expect((res.body as any).data.verified).toBe(true);
      expect(queried).toEqual([record.name]);
      expect(await domainVerified(providerId), 'the provider row is verified at rest').toBe(true);
    });
  });
}

describe('[#25111] the vendor’s second form, unchanged by this card', () => {
  it('the bare token at the instructed name verifies (the vendor accepts `VALUE` beside `IDENTIFIER=VALUE`)', async () => {
    const providerId = 'p25111-bare';
    await seedProvider(providerId);
    const record = await instructedRecord(providerId);
    publish(record.name, record.token);
    const res = await verify('vendor', providerId);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    expect(await domainVerified(providerId)).toBe(true);
  });
});
