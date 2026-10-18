// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resolveRequestExecutionContext` (ruling record 6227928430, letter A): the
 * one request-to-ExecutionContext composition. One battery per choice and per
 * named parameter. Every reading is paired with the control that separates it
 * from the parameter's other value, so a composition that ignored the
 * parameter fails here rather than passing on both sides.
 *
 * The engine double answers `find` from tables and counts every read; the
 * auth service double counts every session read it serves.
 */

import { describe, it, expect } from 'vitest';

import { ObjectKernel } from '../kernel.js';

import { hashApiKey } from './api-key.js';
import type { OAuthTokenProvenance } from './assemble-execution-context.js';
import { isAuthzStoreUnavailableError } from './authz-store-unavailable.js';
import {
  resolveRequestExecutionContext,
  type RequestAdmission,
  type RequestAuthService,
  type RequestExecutionContextInput,
} from './request-execution-context.js';
import { bindStaticSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const ORG = 'org_only';
const GUEST_SET = 'storefront_reader';
const KEY = 'osk_request_ctx_key';
const EX_MEMBER_KEY = 'osk_request_ctx_ex_member';
const REVOKED_KEY = 'osk_request_ctx_revoked';
const COOKIE = 'better-auth.session_token=tok3n.c2ln';
const FUTURE = '2999-01-01T00:00:00Z';

/** Equality and `$in` per field; a combinator it does not implement is refused. */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k.startsWith('$')) throw new Error('fakeEngine.find: unsupported logical operator ' + k);
    const hit = v && typeof v === 'object' && '$in' in v ? (v as { $in: unknown[] }).$in.includes(row[k]) : row[k] === v;
    if (!hit) return false;
  }
  return true;
}

function fakeEngine() {
  const reads: string[] = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_organization: [{ id: ORG }],
    sys_metadata_activation: [],
    sys_api_key: [
      { id: 'k_live', key: hashApiKey(KEY), revoked: false, user_id: 'u_key', active_organization_id: ORG, expires_at: FUTURE },
      // Stamped with ORG; its owner is a member of no organization.
      { id: 'k_ex', key: hashApiKey(EX_MEMBER_KEY), revoked: false, user_id: 'u_ex', active_organization_id: ORG, expires_at: FUTURE },
      { id: 'k_revoked', key: hashApiKey(REVOKED_KEY), revoked: true, user_id: 'u_key', expires_at: FUTURE },
    ],
    sys_member: [
      { user_id: 'u_key', organization_id: ORG, role: 'member' },
      { user_id: 'u_ses', organization_id: ORG, role: 'member' },
    ],
    sys_user_position: [],
    sys_user_permission_set: [],
  };
  const registered = new Set(Object.keys(tables));
  const engine = {
    registry: { getObject: (name: string) => (registered.has(name) ? { name } : undefined) },
    async find(object: string, q: { where?: Record<string, unknown>; limit?: number } | undefined) {
      reads.push(object);
      const rows = (tables[object] ?? []).filter((r) => matchesWhere(r, q?.where ?? {}));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  };
  bindStaticSecurityCatalog(engine, {
    positions: [{ name: 'guest', permissionSets: [GUEST_SET] }, { name: 'everyone', permissionSets: ['member_default'] }],
    permissions: [{ name: GUEST_SET }, { name: 'member_default' }],
  });
  return { engine, reads };
}

interface SessionUser { id: string; email?: string; authGate?: unknown }

/** An auth service double whose session read answers `user` and counts every read. */
function fakeAuth(user: SessionUser | undefined, opts: { gateActive?: boolean | 'throws'; rereadFails?: boolean; lazy?: boolean; ownerGates?: unknown[] } = {}) {
  const sessionReads: unknown[] = [];
  const api = {
    async getSession(input: { headers: unknown; query?: { disableRefresh?: boolean } }) {
      sessionReads.push(input);
      if (opts.rereadFails && sessionReads.length > 1) throw new Error('session store down');
      if (!user) return undefined;
      return { user, session: { id: 'sess_1', userId: user.id, token: 'sess_tok', activeOrganizationId: ORG } };
    },
  };
  const service: RequestAuthService = {
    ...(opts.lazy ? { getApi: async () => api } : { api }),
    isAuthGateActive: () => {
      if (opts.gateActive === 'throws') throw new Error('probe faulted');
      return opts.gateActive === true;
    },
    ...(opts.ownerGates ? { resolveUserAuthGates: async () => opts.ownerGates as never } : {}),
  };
  return { service, sessionReads };
}

/** The runtime / MCP dispatcher's parameter set, the baseline every case edits one key of. */
function input(over: Partial<RequestExecutionContextInput> & { headers?: Headers }): RequestExecutionContextInput {
  return {
    headers: new Headers(),
    ql: undefined,
    authService: undefined,
    tenancy: undefined,
    anonymous: 'fail-closed',
    authGate: 'withhold',
    credentials: 'api-key-and-session',
    sessionApi: 'optional',
    session: 'request',
    localization: 'withhold',
    requestLocale: undefined,
    accessToken: 'withhold',
    oauth: undefined,
    onAdmission: undefined,
    ...over,
  };
}

const sessionHeaders = () => new Headers({ cookie: COOKIE });
const keyHeaders = (raw = KEY) => new Headers({ 'x-api-key': raw });
const rejectionOf = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e as any);

describe('choice 1 — the anonymous entry', () => {
  it("'fail-closed': a request with no credential yields no context; 'guest' yields the guest envelope with the guest anchor's grants", async () => {
    const { engine } = fakeEngine();
    const failClosed = await resolveRequestExecutionContext(input({ ql: engine }));
    expect(failClosed).toBeUndefined();

    const guest = await resolveRequestExecutionContext(input({ ql: engine, anonymous: 'guest' }));
    expect(guest).toEqual({
      positions: ['guest'],
      permissions: [GUEST_SET],
      systemPermissions: [],
      isSystem: false,
      principalKind: 'guest',
      tenantId: ORG,
      org_user_ids: [],
      accessible_org_ids: [],
    });
  });

  it('an authenticated request is the same human principal under either entry', async () => {
    const { engine } = fakeEngine();
    const failClosed = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders() }));
    const guest = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(), anonymous: 'guest' }));
    expect(failClosed).toMatchObject({ userId: 'u_key', principalKind: 'human' });
    expect(guest).toEqual(failClosed);
  });
});

describe('the session read', () => {
  it("'request' reads the auth service's session under the in-process rule (a session cookie reads without renewal), through `.api` or `getApi()`", async () => {
    for (const lazy of [false, true]) {
      const { engine } = fakeEngine();
      const auth = fakeAuth({ id: 'u_ses' }, { lazy });
      const ctx = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers: sessionHeaders() }));
      expect(ctx?.userId).toBe('u_ses');
      expect(auth.sessionReads).toHaveLength(1);
      expect(auth.sessionReads[0]).toMatchObject({ query: { disableRefresh: true } });
    }
  });

  it("'none' answers no session — the cookie beside the failed credential included", async () => {
    const { engine } = fakeEngine();
    const auth = fakeAuth({ id: 'u_ses' });
    const ctx = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers: sessionHeaders(), session: 'none' }));
    expect(ctx).toBeUndefined();
    expect(auth.sessionReads).toHaveLength(0);
  });

  it('{ established } resolves the principal the door established, its organization vetted like a session\'s', async () => {
    const { engine } = fakeEngine();
    const auth = fakeAuth({ id: 'u_cookie' });
    const established = (userId: string) => ({ established: { user: { id: userId }, session: { userId, activeOrganizationId: ORG } } });
    const tenancy = () => ({ posture: 'isolated' as const });

    const member = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers: sessionHeaders(), session: established('u_ses'), tenancy }));
    expect(member).toMatchObject({ userId: 'u_ses', tenantId: ORG });
    // The organization is a claim: a user no membership backs keeps no organization.
    const stranger = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers: sessionHeaders(), session: established('u_stranger'), tenancy }));
    expect(stranger?.userId).toBe('u_stranger');
    expect(stranger?.tenantId).toBeUndefined();
    // The cookie beside it never answered.
    expect(auth.sessionReads).toHaveLength(0);
  });
});

describe('credentials and sessionApi', () => {
  it("'api-key-and-session' admits a key; 'session-only' never reads it", async () => {
    const { engine } = fakeEngine();
    const admitted = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders() }));
    expect(admitted?.userId).toBe('u_key');
    const sessionOnly = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(), credentials: 'session-only' }));
    expect(sessionOnly).toBeUndefined();

    // 'session-only' still reads the session, over the request's own headers.
    const auth = fakeAuth({ id: 'u_ses' });
    const headers = new Headers({ cookie: COOKIE, 'x-api-key': KEY });
    const session = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers, credentials: 'session-only' }));
    expect(session?.userId).toBe('u_ses');
    expect((auth.sessionReads[0] as { headers: unknown }).headers).toBe(headers);
  });

  it("'required': no session API authenticates nobody, the API-key door included, and reads nothing; 'optional' still admits the key", async () => {
    const optional = fakeEngine();
    const admitted = await resolveRequestExecutionContext(input({ ql: optional.engine, headers: keyHeaders() }));
    expect(admitted?.userId).toBe('u_key');

    const required = fakeEngine();
    const tenancyReads: string[] = [];
    const refused = await resolveRequestExecutionContext(input({
      ql: required.engine,
      headers: keyHeaders(),
      sessionApi: 'required',
      tenancy: () => { tenancyReads.push('tenancy'); return { posture: 'isolated' as const }; },
    }));
    expect(refused).toBeUndefined();
    expect(required.reads).toEqual([]);
    expect(tenancyReads).toEqual([]);

    // An auth service exposing no session read is the same as none.
    const noRead = await resolveRequestExecutionContext(input({ ql: required.engine, headers: keyHeaders(), sessionApi: 'required', authService: {} }));
    expect(noRead).toBeUndefined();
  });

  it("'required' with a session API admits a key and a session as 'optional' does", async () => {
    const { engine } = fakeEngine();
    const auth = fakeAuth({ id: 'u_ses' }, { lazy: true });
    const key = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers: keyHeaders(), sessionApi: 'required' }));
    expect(key?.userId).toBe('u_key');
    const session = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers: sessionHeaders(), sessionApi: 'required' }));
    expect(session?.userId).toBe('u_ses');
  });
});

describe('tenancy — the classification of the door\'s own resolution', () => {
  it('undefined reads no posture; a walled posture refuses the key its owner no longer backs', async () => {
    const { engine } = fakeEngine();
    const noPosture = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(EX_MEMBER_KEY) }));
    expect(noPosture).toMatchObject({ userId: 'u_ex', tenantId: ORG });
    const walled = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(EX_MEMBER_KEY), tenancy: () => ({ posture: 'isolated' as const }) }));
    expect(walled).toBeUndefined();
  });

  it('a service never registered is quiet; one that failed to build is the 503 outage', async () => {
    const kernel = new ObjectKernel({ logger: { level: 'error' }, gracefulShutdown: false, skipSystemValidation: true });
    kernel.registerServiceFactory('tenancy', () => { throw new Error('tenancy backend unavailable'); });
    const { engine } = fakeEngine();

    const unregistered = new ObjectKernel({ logger: { level: 'error' }, gracefulShutdown: false, skipSystemValidation: true });
    const quiet = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(EX_MEMBER_KEY), tenancy: () => unregistered.getServiceAsync('tenancy') as never }));
    expect(quiet?.userId).toBe('u_ex');

    const err = await rejectionOf(resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(EX_MEMBER_KEY), tenancy: () => kernel.getServiceAsync('tenancy') as never })));
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
    expect(err?.code).toBe('SERVICE_UNAVAILABLE');
    expect(err?.status).toBe(503);
    expect(err?.object).toBe('tenancy');
  });
});

describe('choice 2 — the ADR-0069 gate', () => {
  const GATED = { id: 'u_ses', authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } };
  const POSTURE = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' };

  it("'withhold' never carries the posture; 'resolved' carries the admitting read's, with no second read", async () => {
    const { engine } = fakeEngine();
    const withheld = fakeAuth(GATED);
    const w = await resolveRequestExecutionContext(input({ ql: engine, authService: withheld.service, headers: sessionHeaders() }));
    expect(w?.userId).toBe('u_ses');
    expect(w?.authGate).toBeUndefined();

    const resolved = fakeAuth(GATED);
    const r = await resolveRequestExecutionContext(input({ ql: engine, authService: resolved.service, headers: sessionHeaders(), authGate: 'resolved' }));
    expect(r?.authGate).toEqual(POSTURE);
    expect(resolved.sessionReads).toHaveLength(1);
  });

  it("'reread-when-active': an inactive gate (or a probe that throws) reads once and carries none; an active one reads again and carries it", async () => {
    const { engine } = fakeEngine();
    for (const gateActive of [false, 'throws'] as const) {
      const auth = fakeAuth(GATED, { gateActive });
      const ctx = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers: sessionHeaders(), authGate: 'reread-when-active' }));
      expect(ctx?.authGate).toBeUndefined();
      expect(auth.sessionReads).toHaveLength(1);
    }
    const active = fakeAuth(GATED, { gateActive: true });
    const ctx = await resolveRequestExecutionContext(input({ ql: engine, authService: active.service, headers: sessionHeaders(), authGate: 'reread-when-active' }));
    expect(ctx?.authGate).toEqual(POSTURE);
    expect(active.sessionReads).toHaveLength(2);
  });

  it("'reread-when-active': a declared-active gate whose re-read fails is the 503 outage, never a silent admission", async () => {
    const { engine } = fakeEngine();
    const auth = fakeAuth(GATED, { gateActive: true, rereadFails: true });
    const err = await rejectionOf(resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers: sessionHeaders(), authGate: 'reread-when-active' })));
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
    expect(err?.code).toBe('SERVICE_UNAVAILABLE');
    expect(err?.status).toBe(503);
    expect(err?.object).toBe('auth_gate');
  });

  it("an API key is judged by its owner's posture from the admission, never by the session beside it", async () => {
    const { engine } = fakeEngine();
    const auth = fakeAuth(GATED, { gateActive: true, ownerGates: [{ code: 'MFA_REQUIRED', message: 'Set up MFA.' }] });
    const headers = new Headers({ cookie: COOKIE, 'x-api-key': KEY });
    const ctx = await resolveRequestExecutionContext(input({ ql: engine, authService: auth.service, headers, authGate: 'reread-when-active' }));
    expect(ctx?.userId).toBe('u_key');
    expect(ctx?.authGate).toEqual({ code: 'MFA_REQUIRED', message: 'Set up MFA.' });
    expect(auth.sessionReads).toHaveLength(0);
  });

  it('onAdmission is told the credential and the posture; never for an anonymous request', async () => {
    const { engine } = fakeEngine();
    const seen: RequestAdmission[] = [];
    const onAdmission = (a: RequestAdmission) => { seen.push(a); };
    await resolveRequestExecutionContext(input({ ql: engine, authService: fakeAuth(GATED).service, headers: sessionHeaders(), onAdmission }));
    await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(), onAdmission }));
    await resolveRequestExecutionContext(input({ ql: engine, onAdmission, anonymous: 'guest' }));
    expect(seen).toEqual([
      { credential: 'session', authGate: POSTURE },
      { credential: 'api_key', authGate: undefined },
    ]);
  });
});

describe('localization, the request locale and the session bearer', () => {
  const settingsService = {
    async get(_ns: string, key: string) {
      return { value: ({ timezone: 'Europe/Paris', locale: 'fr-FR', currency: 'EUR' } as Record<string, string>)[key], source: 'tenant' };
    },
  };

  it('the settings lookup localizes a resolved principal; the request locale wins; withheld or anonymous reads nothing', async () => {
    const { engine } = fakeEngine();
    let lookups = 0;
    const localization = { settings: () => { lookups += 1; return settingsService; } };

    const ctx = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(), localization }));
    expect(ctx).toMatchObject({ timezone: 'Europe/Paris', locale: 'fr-FR', currency: 'EUR' });
    const preferred = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(), localization, requestLocale: 'zh-CN' }));
    expect(preferred?.locale).toBe('zh-CN');
    expect(lookups).toBe(2);

    const withheld = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders() }));
    expect(withheld?.timezone).toBeUndefined();
    const anonymous = await resolveRequestExecutionContext(input({ ql: engine, localization, anonymous: 'guest' }));
    expect(anonymous?.timezone).toBeUndefined();
    expect(lookups).toBe(2);
  });

  it('a settings lookup that rejects reads as no service: the defaults stand', async () => {
    const { engine } = fakeEngine();
    const ctx = await resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(), localization: { settings: () => Promise.reject(new Error('down')) } }));
    expect(ctx).toMatchObject({ timezone: 'UTC', locale: 'en-US' });
  });

  it("'carry' puts the session bearer on the envelope; 'withhold' does not", async () => {
    const { engine } = fakeEngine();
    const carried = await resolveRequestExecutionContext(input({ ql: engine, authService: fakeAuth({ id: 'u_ses' }).service, headers: sessionHeaders(), accessToken: 'carry' }));
    expect(carried?.accessToken).toBe('sess_tok');
    const withheld = await resolveRequestExecutionContext(input({ ql: engine, authService: fakeAuth({ id: 'u_ses' }).service, headers: sessionHeaders() }));
    expect(withheld?.userId).toBe('u_ses');
    expect(withheld?.accessToken).toBeUndefined();
  });
});

describe('OAuth provenance and fault propagation', () => {
  it('an OAuth provenance naming a client makes the principal an agent on behalf of the user', async () => {
    const { engine } = fakeEngine();
    const oauth: OAuthTokenProvenance = { userId: 'u_ses', scopes: ['data:read'], clientId: 'agent-1', scopePermissions: ['agent_read'], delegatesActions: false };
    const session = { established: { user: { id: 'u_ses' }, session: { userId: 'u_ses' } } };
    const ctx = await resolveRequestExecutionContext(input({ ql: engine, session, oauth }));
    expect(ctx).toMatchObject({ principalKind: 'agent', userId: 'u_ses', permissions: ['agent_read'], oauthScopes: ['data:read'] });
    expect(ctx?.onBehalfOf).toEqual({ userId: 'u_ses', principalKind: 'human' });
    const human = await resolveRequestExecutionContext(input({ ql: engine, session }));
    expect(human?.principalKind).toBe('human');
  });

  it('a key its own lifecycle refuses rejects with its declared code and status; the composition never swallows it', async () => {
    const { engine } = fakeEngine();
    const err = await rejectionOf(resolveRequestExecutionContext(input({ ql: engine, headers: keyHeaders(REVOKED_KEY), anonymous: 'guest' })));
    expect(err?.code).toBe('API_KEY_REVOKED');
    expect(err?.status).toBe(403);
  });
});
