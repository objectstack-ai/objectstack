// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling record 6227928430, letter A item 2] The settings door, proven on the
 * one request-to-`ExecutionContext` composition by this pin plus its existing
 * ones.
 *
 * `SettingsServicePlugin`'s `verifiedContextFromRequest` resolves the caller
 * for every `/api/settings` route. The two answers a door owes before any other
 * are pinned here on the real listing route (`GET /api/settings`), with the
 * plugin booted for real and no seam captured, and read at the settings
 * service, the route's own work:
 *
 *  - ADR-0096: a request that resolves no principal never reaches the service.
 *    The family answers it at its anonymous floor (`401 UNAUTHENTICATED`). A
 *    session read that fails resolved no caller, so it is the same refusal and
 *    not an outage, and a refused API key never falls through to the cookie
 *    beside it.
 *  - ADR-0069: a principal the authentication policy holds is refused `403`
 *    with its posture. The door carries the posture decided off the read that
 *    admitted the caller and reads no second time, so a held session is
 *    refused whatever the auth service's gate probe says; a key answers for its
 *    own owner's `account`-scope posture, whatever cookie rides beside it.
 *
 * The CONTROL rows prove the door admits somebody: an ungated session, and an
 * API key on a host with no auth service (the key door stays open without a
 * session API).
 *
 * Every row was green on the door's hand-written composition and is green on
 * the shared one.
 */

import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  hashApiKey,
} from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import type { SettingsContext } from './settings-service.types.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

const ORG = 'org_alpha';
const COOKIE = 'better-auth.session_token=tok_settings_door.c2ln';
const HELD_COOKIE = 'better-auth.session_token=tok_settings_door_held.c2ln';
const STRANGER_COOKIE = 'better-auth.session_token=tok_settings_door_unknown.c2ln';
const KEY = 'osk_settings_door_key';
const EX_MEMBER_KEY = 'osk_settings_door_ex_member';
const HELD_OWNER_KEY = 'osk_settings_door_held_owner';
const FUTURE = '2999-01-01T00:00:00Z';

const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' };
const MFA_REQUIRED = { code: 'MFA_REQUIRED', message: 'Multi-factor authentication is required.' };

interface Host {
  /** Whether an auth service is registered at all. */
  auth: boolean;
  /** What the auth service's gate probe answers (the door never asks it). */
  gateActive?: boolean;
  /** The auth service's session read throws for every request. */
  sessionReadFails?: boolean;
}

/** One deployment: a walled (`isolated`) posture, an engine answering the permission tables, an auth service. */
function services(host: Host): Record<string, unknown> {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_api_key: [
      { id: 'k_live', key: hashApiKey(KEY), revoked: false, user_id: 'u_key', active_organization_id: ORG, expires_at: FUTURE },
      { id: 'k_ex', key: hashApiKey(EX_MEMBER_KEY), revoked: false, user_id: 'u_ex', active_organization_id: ORG, expires_at: FUTURE },
      { id: 'k_held', key: hashApiKey(HELD_OWNER_KEY), revoked: false, user_id: 'u_mfa', active_organization_id: ORG, expires_at: FUTURE },
    ],
    sys_member: [
      { user_id: 'u_key', organization_id: ORG, role: 'member' },
      { user_id: 'u_mfa', organization_id: ORG, role: 'member' },
      { user_id: 'u_ses', organization_id: ORG, role: 'member' },
      { user_id: 'u_held', organization_id: ORG, role: 'member' },
    ],
  };
  const objectql = bindCatalogFromTables({
    async find(object: string, q: { where?: Record<string, unknown>; limit?: number } | undefined) {
      const rows = (tables[object] ?? []).filter((row) => Object.entries(q?.where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fixture: unsupported combinator ${k}`);
        if (v !== null && typeof v === 'object') {
          return Array.isArray((v as { $in?: unknown[] }).$in) ? (v as { $in: unknown[] }).$in.includes(row[k]) : true;
        }
        return (v ?? null) === (row[k] ?? null);
      }));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  }, tables);

  const registered: Record<string, unknown> = { objectql, tenancy: { posture: 'isolated' } };
  if (host.auth) {
    const sessions: Record<string, { user: Record<string, unknown>; session: Record<string, unknown> }> = {
      [COOKIE]: { user: { id: 'u_ses' }, session: { id: 'sess_ses', userId: 'u_ses', activeOrganizationId: ORG } },
      [HELD_COOKIE]: {
        user: { id: 'u_held', authGate: PASSWORD_EXPIRED },
        session: { id: 'sess_held', userId: 'u_held', activeOrganizationId: ORG },
      },
    };
    registered.auth = {
      api: {
        async getSession(input: { headers: Headers }) {
          if (host.sessionReadFails) throw new Error('session backend unavailable');
          return sessions[input.headers.get('cookie') ?? ''] ?? undefined;
        },
      },
      isAuthGateActive: () => host.gateActive ?? true,
      // `MFA_REQUIRED` is an `account`-scope posture: it holds every credential of its user.
      resolveUserAuthGates: async (userId: string) => (userId === 'u_mfa' ? [MFA_REQUIRED] : []),
    };
  }
  return registered;
}

/** Boot the real plugin on `host` and answer one `GET /api/settings`. */
async function listing(host: Host, headers: Record<string, string>) {
  const routes = new Map<string, RouteHandler>();
  const add = (verb: string) => (path: string, handler: RouteHandler) => { routes.set(`${verb} ${path}`, handler); };
  const http = {
    get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), patch: add('PATCH'),
    use() {}, async listen() {}, async close() {},
  };
  const registered: Record<string, unknown> = { ...services(host), 'http-server': http };
  let readyHook: (() => Promise<void>) | undefined;
  let service: { listManifests(ctx: SettingsContext): unknown } | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: (name: string, value: unknown) => { if (name === 'settings') service = value as typeof service; },
    getService: (name: string) => registered[name],
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    // The async registry the door reads the posture through; every name but
    // `tenancy` is registered or not exactly as `getService` answers it.
    getKernel: () => ({ getServiceAsync: async (name: string) => registered[name] }),
  };
  const plugin = new SettingsServicePlugin({ manifests: [], env: {}, actionHandlers: {} });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();
  if (!service) throw new Error('fixture: the settings service was not registered');

  // The route's own work, read where it happens: which context reached it.
  const seen: SettingsContext[] = [];
  const listManifests = service.listManifests.bind(service);
  service.listManifests = (context: SettingsContext) => { seen.push(context); return listManifests(context); };

  const handler = routes.get('GET /api/settings');
  if (!handler) throw new Error('fixture: the listing route was not mounted');
  const answer: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: {}, query: {}, headers, method: 'GET', path: '/api/settings' } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return { answer, seen };
}

const ANONYMOUS = { status: ANONYMOUS_DENY_STATUS, code: ANONYMOUS_DENY_CODE, message: ANONYMOUS_DENY_MESSAGE };

const ROWS: Array<{
  name: string;
  host: Host;
  headers: Record<string, string>;
  status: number;
  code?: string;
  message?: string;
  principal?: string;
}> = [
  {
    name: 'ADR-0096: no credential is refused at the anonymous floor, and the service is never asked',
    host: { auth: true }, headers: {}, ...ANONYMOUS,
  },
  {
    name: 'ADR-0096: a cookie the auth service does not recognise is refused at the anonymous floor',
    host: { auth: true }, headers: { cookie: STRANGER_COOKIE }, ...ANONYMOUS,
  },
  {
    name: 'ADR-0096: a session read that fails resolved no caller, so it is the anonymous floor, not an outage',
    host: { auth: true, sessionReadFails: true }, headers: { cookie: COOKIE }, ...ANONYMOUS,
  },
  {
    name: "ADR-0096: an ex-member's organization-stamped key under the walled posture is refused, and the cookie beside it never answers for it",
    host: { auth: true }, headers: { 'x-api-key': EX_MEMBER_KEY, cookie: COOKIE }, ...ANONYMOUS,
  },
  {
    name: 'ADR-0069: a held session is refused 403 with its posture, and the service is never asked',
    host: { auth: true }, headers: { cookie: HELD_COOKIE },
    status: 403, code: PASSWORD_EXPIRED.code, message: PASSWORD_EXPIRED.message,
  },
  {
    name: 'ADR-0069: the same held session is refused while the gate probe says no gate is active (the posture is the admitting read\'s)',
    host: { auth: true, gateActive: false }, headers: { cookie: HELD_COOKIE },
    status: 403, code: PASSWORD_EXPIRED.code, message: PASSWORD_EXPIRED.message,
  },
  {
    name: "ADR-0069: a key whose owner holds an account-scope posture is refused 403 with the owner's posture",
    host: { auth: true }, headers: { 'x-api-key': HELD_OWNER_KEY },
    status: 403, code: MFA_REQUIRED.code, message: MFA_REQUIRED.message,
  },
  {
    name: 'ADR-0069: a key beside the held cookie answers for its own owner, never for the cookie',
    host: { auth: true }, headers: { 'x-api-key': KEY, cookie: HELD_COOKIE },
    status: 200, principal: 'u_key',
  },
  {
    name: 'CONTROL: an ungated session is admitted, and the service is asked as that principal',
    host: { auth: true }, headers: { cookie: COOKIE },
    status: 200, principal: 'u_ses',
  },
  {
    name: 'CONTROL: an API key on a host with no auth service is admitted as its owner',
    host: { auth: false }, headers: { 'x-api-key': KEY },
    status: 200, principal: 'u_key',
  },
];

describe("[ruling 6227928430 item 2] the settings door: the ADR-0096 principal-less refusal and the ADR-0069 gate on the listing route", () => {
  it.each(ROWS)('$name', async (row) => {
    const { answer, seen } = await listing(row.host, row.headers);

    expect(answer.status).toBe(row.status);
    if (row.code !== undefined) expect(answer.body?.error?.code).toBe(row.code);
    if (row.message !== undefined) expect(answer.body?.error?.message).toBe(row.message);
    if (row.principal === undefined) {
      expect(seen).toHaveLength(0);
      return;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]!.userId).toBe(row.principal);
    expect(seen[0]!.tenantId).toBe(ORG);
    expect(seen[0]!.enforced).toBe(true);
    expect('authGate' in seen[0]!).toBe(false);
  });
});
