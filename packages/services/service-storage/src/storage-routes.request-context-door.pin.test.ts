// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling record 6227928430, letter A item 2] The storage door, proven on the
 * one request-to-`ExecutionContext` composition by this pin plus its existing
 * ones.
 *
 * The storage door is the download authorizer `composeStorageRoutes` binds
 * (`buildFileReadAuthorizer` in `storage-service-plugin.ts`): it resolves the
 * caller of a parent-governed download and hands the caller's context to the
 * read that decides the verdict. Every route of the family is mounted behind
 * the family's ADR-0069 gate reader, which runs first. The two answers a door
 * owes before any other are pinned here on the real download route
 * (`GET /files/:fileId/url`, a private field-owned file), with the plugin
 * booted for real and no seam captured, and read where the route's own work
 * happens: the read of the record that owns the file (which context reached
 * it) and the storage adapter (whether a capability was minted).
 *
 *  - ADR-0096: a request that resolves no principal never reaches the owner
 *    read. The door answers `401 AUTH_REQUIRED`. A session read that fails
 *    resolved no caller, so with no gate active it is the same refusal and not
 *    an outage, and a refused API key never falls through to the cookie beside
 *    it.
 *  - ADR-0069: the family's gate reader runs before the door. A session the
 *    policy holds is refused `403` with its posture while a gate is active, and
 *    a session read that fails while a gate is active is the `503` outage. A key
 *    answers for its own owner's `account`-scope posture, whatever cookie rides
 *    beside it. With no gate active nothing is re-read and the held session is
 *    served, and the context the door hands on carries the posture that the
 *    admitting read decided.
 *
 * The CONTROL rows prove the door admits somebody: an ungated session (whose
 * context carries the session bearer), and an API key on a host whose auth
 * service exposes no session read (the key door stays open without one). The
 * last row is the door's wiring fact: a host with no auth service binds no
 * download authorizer, so the download is served without asking anyone (the
 * declared bare-kernel behaviour).
 *
 * Every row was green on the door's hand-written composition and is green on
 * the shared one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
  hashApiKey,
} from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { StorageServicePlugin } from './storage-service-plugin.js';

const BASE_PATH = '/api/v1/storage';
const ORG = 'org_alpha';
const COOKIE = 'better-auth.session_token=tok_storage_door.c2ln';
const HELD_COOKIE = 'better-auth.session_token=tok_storage_door_held.c2ln';
const STRANGER_COOKIE = 'better-auth.session_token=tok_storage_door_unknown.c2ln';
const KEY = 'osk_storage_door_key';
const EX_MEMBER_KEY = 'osk_storage_door_ex_member';
const HELD_OWNER_KEY = 'osk_storage_door_held_owner';
const FUTURE = '2999-01-01T00:00:00Z';

/** The subject: a private file owned by one `contract` record, uploaded by nobody any row signs in as. */
const FILE_ID = 'file_storage_door';
const OWNER_RECORD = 'rec_storage_door';

const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' };
const MFA_REQUIRED = { code: 'MFA_REQUIRED', message: 'Multi-factor authentication is required.' };

interface Host {
  /** The auth service: a full one, one exposing no session read, or none at all. */
  auth: 'session' | 'no-session-api' | 'none';
  /** What the auth service's gate probe answers (default: active). */
  gateActive?: boolean;
  /** The auth service's session read throws for every request. */
  sessionReadFails?: boolean;
}

/** The caller context each read of the owner record received. */
type OwnerRead = { userId?: string; tenantId?: string; accessToken?: string; authGate?: unknown };

/**
 * One deployment: a walled (`isolated`) posture, an engine answering the
 * permission tables, `sys_file` and the owner record, and the host's auth
 * service. The owner record is readable by every principal a row resolves, so
 * the record's visibility never decides a row: only the door does.
 */
function services(host: Host, ownerReads: OwnerRead[]): Record<string, unknown> {
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
    sys_file: [
      {
        id: FILE_ID, key: 'files/door.pdf', name: 'door.pdf', mime_type: 'application/pdf', size: 12,
        scope: 'record', status: 'committed', acl: 'private', owner_id: 'u_uploader',
        ref_object: 'contract', ref_id: OWNER_RECORD, ref_field: 'attachment',
      },
    ],
  };
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fixture: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object') {
        const list = (v as { $in?: unknown[] }).$in;
        if (!Array.isArray(list)) throw new Error(`fixture: unsupported operator on ${k}`);
        return list.includes(row[k]);
      }
      return (v ?? null) === (row[k] ?? null);
    });
  const objectql = {
    async find(object: string, q: { where?: Record<string, unknown>; limit?: number; context?: OwnerRead } = {}) {
      if (object === 'contract') {
        ownerReads.push(q.context ?? {});
        return q.context?.userId ? [{ id: OWNER_RECORD }] : [];
      }
      const rows = (tables[object] ?? []).filter((row) => matches(row, q.where));
      return typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    async findOne(object: string, q: { where?: Record<string, unknown> } = {}) {
      return (tables[object] ?? []).find((row) => matches(row, q.where)) ?? null;
    },
  };

  const registered: Record<string, unknown> = { objectql, tenancy: { posture: 'isolated' } };
  if (host.auth !== 'none') {
    const sessions: Record<string, { user: Record<string, unknown>; session: Record<string, unknown> }> = {
      [COOKIE]: { user: { id: 'u_ses' }, session: { id: 'sess_ses', userId: 'u_ses', token: 'bearer_ses', activeOrganizationId: ORG } },
      [HELD_COOKIE]: {
        user: { id: 'u_held', authGate: PASSWORD_EXPIRED },
        session: { id: 'sess_held', userId: 'u_held', token: 'bearer_held', activeOrganizationId: ORG },
      },
    };
    registered.auth = {
      ...(host.auth === 'session'
        ? {
          api: {
            async getSession(input: { headers: Headers }) {
              if (host.sessionReadFails) throw new Error('session backend unavailable');
              return sessions[input.headers.get('cookie') ?? ''] ?? undefined;
            },
          },
        }
        : {}),
      isAuthGateActive: () => host.gateActive ?? true,
      // `MFA_REQUIRED` is an `account`-scope posture: it holds every credential of its user.
      resolveUserAuthGates: async (userId: string) => (userId === 'u_mfa' ? [MFA_REQUIRED] : []),
    };
  }
  return registered;
}

let rootDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of rootDirs) await fs.rm(dir, { recursive: true, force: true });
  rootDirs = [];
});

/** Boot the real plugin on `host` and answer one `GET /files/:fileId/url`. */
async function download(host: Host, headers: Record<string, string>) {
  const rootDir = join(tmpdir(), `os-23217-s4-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  rootDirs.push(rootDir);

  const routes = new Map<string, RouteHandler>();
  const add = (verb: string) => (path: string, handler: RouteHandler) => { routes.set(`${verb} ${path}`, handler); };
  const http = {
    get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), patch: add('PATCH'),
    use() {}, async listen() {}, async close() {},
  };
  const ownerReads: OwnerRead[] = [];
  const registered: Record<string, unknown> = { ...services(host, ownerReads), 'http-server': http };
  const readyHooks: Array<() => Promise<void> | void> = [];
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: (name: string, value: unknown) => { registered[name] = value; },
    getService: (name: string) => {
      const value = registered[name];
      if (value === undefined) throw new Error(`service '${name}' not registered`);
      return value;
    },
    hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') readyHooks.push(fn); },
    // The async registry the door reads the posture through.
    getKernel: () => ({ getServiceAsync: async (name: string) => registered[name] }),
  } as unknown as PluginContext;

  const plugin = new StorageServicePlugin({
    adapter: 'local',
    basePath: BASE_PATH,
    local: { rootDir, signingSecret: 'test-secret-23217-s4' },
    bindToSettings: false,
  });
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const hook of readyHooks) await hook();

  const storage = registered.storage as { getPresignedDownload: (key: string, ttl: number, opts?: unknown) => Promise<unknown> };
  const mint = vi.spyOn(storage, 'getPresignedDownload');
  const handler = routes.get(`GET ${BASE_PATH}/files/:fileId/url`);
  if (!handler) throw new Error('fixture: the download route was not mounted');
  const answer: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { answer.body = data; return res; },
    send() { return res; },
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: { fileId: FILE_ID }, query: {}, headers, method: 'GET', path: `${BASE_PATH}/files/:fileId/url` } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return { answer, ownerReads, minted: mint.mock.calls.length };
}

const ANONYMOUS = { status: 401, code: 'AUTH_REQUIRED' };

const ROWS: Array<{
  name: string;
  host: Host;
  headers: Record<string, string>;
  status: number;
  code?: string;
  message?: string;
  /** Who the owner read was asked as; absent: it was never asked. */
  principal?: string;
  /** The session bearer the context carried to the owner read. */
  accessToken?: string;
  /** The posture the context carried to the owner read. */
  authGate?: { code: string; message: string };
  /** Served with no read of the owner record at all (no authorizer is bound). */
  ungated?: true;
}> = [
  {
    name: 'ADR-0096: no credential is refused 401, and the owner record is never read',
    host: { auth: 'session' }, headers: {}, ...ANONYMOUS,
  },
  {
    name: 'ADR-0096: a cookie the auth service does not recognise is refused 401',
    host: { auth: 'session' }, headers: { cookie: STRANGER_COOKIE }, ...ANONYMOUS,
  },
  {
    name: 'ADR-0096: with no gate active, a session read that fails resolved no caller, so it is 401 and not an outage',
    host: { auth: 'session', gateActive: false, sessionReadFails: true }, headers: { cookie: COOKIE }, ...ANONYMOUS,
  },
  {
    name: "ADR-0096: an ex-member's organization-stamped key under the walled posture is refused 401, and the cookie beside it never answers for it",
    host: { auth: 'session' }, headers: { 'x-api-key': EX_MEMBER_KEY, cookie: COOKIE }, ...ANONYMOUS,
  },
  {
    name: 'ADR-0069: a held session is refused 403 with its posture, and the owner record is never read',
    host: { auth: 'session' }, headers: { cookie: HELD_COOKIE },
    status: 403, code: PASSWORD_EXPIRED.code, message: PASSWORD_EXPIRED.message,
  },
  {
    name: 'ADR-0069: a session read that fails while a gate is active is the 503 outage',
    host: { auth: 'session', sessionReadFails: true }, headers: { cookie: COOKIE },
    status: AUTHZ_STORE_UNAVAILABLE_STATUS, code: AUTHZ_STORE_UNAVAILABLE_CODE,
  },
  {
    name: "ADR-0069: a key whose owner holds an account-scope posture is refused 403 with the owner's posture",
    host: { auth: 'session' }, headers: { 'x-api-key': HELD_OWNER_KEY },
    status: 403, code: MFA_REQUIRED.code, message: MFA_REQUIRED.message,
  },
  {
    name: 'ADR-0069: a key beside the held cookie answers for its own owner, never for the cookie',
    host: { auth: 'session' }, headers: { 'x-api-key': KEY, cookie: HELD_COOKIE },
    status: 200, principal: 'u_key',
  },
  {
    name: 'ADR-0069: with no gate active the held session is served, and its context carries the posture the admitting read decided',
    host: { auth: 'session', gateActive: false }, headers: { cookie: HELD_COOKIE },
    status: 200, principal: 'u_held', accessToken: 'bearer_held', authGate: PASSWORD_EXPIRED,
  },
  {
    name: 'CONTROL: an ungated session is admitted, and the owner record is read as that principal, bearer and all',
    host: { auth: 'session' }, headers: { cookie: COOKIE },
    status: 200, principal: 'u_ses', accessToken: 'bearer_ses',
  },
  {
    name: 'CONTROL: an API key on a host whose auth service exposes no session read is admitted as its owner',
    host: { auth: 'no-session-api' }, headers: { 'x-api-key': KEY },
    status: 200, principal: 'u_key',
  },
  {
    name: 'WIRING: a host with no auth service binds no download authorizer, so the download is served without a read',
    host: { auth: 'none' }, headers: { 'x-api-key': KEY },
    status: 200, ungated: true,
  },
];

describe('[ruling 6227928430 item 2] the storage door: the ADR-0096 principal-less refusal and the ADR-0069 gate on the download route', () => {
  it.each(ROWS)('$name', async (row) => {
    const { answer, ownerReads, minted } = await download(row.host, row.headers);

    expect(answer.status).toBe(row.status);
    if (row.code !== undefined) expect(answer.body?.error?.code).toBe(row.code);
    if (row.message !== undefined) expect(answer.body?.error?.message).toBe(row.message);
    if (row.ungated) {
      expect(ownerReads).toHaveLength(0);
      expect(minted).toBe(1);
      return;
    }
    if (row.principal === undefined) {
      expect(ownerReads).toHaveLength(0);
      expect(minted).toBe(0);
      return;
    }
    expect(minted).toBe(1);
    expect(ownerReads).toHaveLength(1);
    const context = ownerReads[0]!;
    expect(context.userId).toBe(row.principal);
    expect(context.tenantId).toBe(ORG);
    expect(context.accessToken).toBe(row.accessToken);
    expect(context.authGate).toEqual(row.authGate);
  });
});
