// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24366] The storage family's ADR-0069 gate and the route judge the SAME
 * credential.
 *
 * ## The rule
 *
 * A session the authentication policy HOLDS (an expired password, enforced MFA
 * not yet enrolled) is gated out of every protected resource until it
 * remediates, and every route of the storage family is one. The family door
 * fronts routes that serve different credentials — the upload routes and the
 * unclaimed-file download identify their caller by the session, the
 * parent-governed download serves the one composition's principal — so the
 * gate judges every credential a route can serve: a held session is refused
 * `403` with its own posture whatever else the request carries, and a held
 * key's owner is refused through the shared key-admission seam.
 *
 * ## What is pinned
 *
 * On the download routes (an unclaimed file and a parent-governed file) and an
 * upload route (the start route): a held session is refused `403` with the
 * gate's code whatever else the request carries, and storage is never touched.
 *
 * ## Controls
 *
 * - an un-held session is SERVED (the gate is not firing for everyone);
 * - a held owner's key alone is refused as today — through the key arm, with
 *   the owner's posture.
 *
 * The composition is `mountStorageRoutes` over a real `ObjectKernel`, the same
 * one the plugin's own mount calls, with an engine that knows the key and the
 * files.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { mountStorageRoutes } from './mount-storage-routes.js';

const BASE = '/api/v1/storage';
const ORG = 'org_alpha';
const FUTURE = '2999-01-01T00:00:00Z';

/** A held user whose session carries the posture; an un-held user; a separate key owner. */
const HELD_USER = 'u_held';
const OK_USER = 'u_ok';
const KEY_OWNER = 'u_key_owner';
const MFA_OWNER = 'u_mfa_owner';

/** An admitted key owned by someone NOT the held session. */
const OTHER_KEY = 'osk_family_gate_other_owner';
/** A key whose own owner is held (the key arm's control). */
const HELD_OWNER_KEY = 'osk_family_gate_held_owner';

const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' };
const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const POSTURE_CODES = ['MFA_REQUIRED', 'PASSWORD_EXPIRED', 'PASSWORD_RESET_REQUIRED'];

/** An unclaimed file (no attachments scope, no field owner): a signed-in caller is all it needs. */
const UNCLAIMED_FILE = 'file_family_gate_unclaimed';
/** A parent-governed file: access derives from the record its field owns. */
const GOVERNED_FILE = 'file_family_gate_governed';
const GOVERNED_RECORD = 'rec_family_gate';

type Gate = { code: string; message: string };

function services(sessionReads: { n: number }) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_api_key: [
      { id: 'k_other', key: hashApiKey(OTHER_KEY), revoked: false, user_id: KEY_OWNER, active_organization_id: ORG, expires_at: FUTURE },
      { id: 'k_mfa', key: hashApiKey(HELD_OWNER_KEY), revoked: false, user_id: MFA_OWNER, active_organization_id: ORG, expires_at: FUTURE },
    ],
    sys_member: [
      { user_id: HELD_USER, organization_id: ORG, role: 'member' },
      { user_id: OK_USER, organization_id: ORG, role: 'member' },
      { user_id: KEY_OWNER, organization_id: ORG, role: 'member' },
      { user_id: MFA_OWNER, organization_id: ORG, role: 'member' },
    ],
    sys_file: [
      {
        id: UNCLAIMED_FILE, key: 'files/unclaimed.txt', name: 'unclaimed.txt', mime_type: 'text/plain', size: 3,
        scope: 'user', status: 'committed', acl: 'private', owner_id: 'u_uploader',
      },
      {
        id: GOVERNED_FILE, key: 'files/governed.pdf', name: 'governed.pdf', mime_type: 'application/pdf', size: 3,
        scope: 'record', status: 'committed', acl: 'private', owner_id: 'u_uploader',
        ref_object: 'contract', ref_id: GOVERNED_RECORD, ref_field: 'attachment',
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
    async find(object: string, q: any = {}) {
      // The owner record is readable by every principal that resolves one, so
      // only the gate decides a held case.
      if (object === 'contract') return q?.context?.userId ? [{ id: GOVERNED_RECORD }] : [];
      const rows = (tables[object] ?? []).filter((row) => matches(row, q?.where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    async findOne(object: string, q: any = {}) {
      return (tables[object] ?? []).find((row) => matches(row, q?.where)) ?? null;
    },
    async insert(_object: string, row: any) { return row; },
    async update(_object: string, row: any) { return row; },
  };
  const sessions: Record<string, Gate | undefined> = { [HELD_USER]: PASSWORD_EXPIRED, [OK_USER]: undefined };
  return {
    objectql,
    tenancy: { posture: 'isolated' },
    auth: {
      isAuthGateActive: () => true,
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          sessionReads.n++;
          const userId = headers.get('x-test-user');
          if (!userId) return undefined;
          const authGate = sessions[userId];
          return {
            user: { id: userId, ...(authGate ? { authGate } : {}) },
            session: { id: `s_${userId}`, userId, token: `b_${userId}`, activeOrganizationId: ORG },
          };
        },
      },
      // The key owner is clean; MFA_OWNER holds an account-scope posture.
      resolveUserAuthGates: async (userId: string) => (userId === MFA_OWNER ? [MFA_REQUIRED] : []),
    },
  } as Record<string, unknown>;
}

let rootDirs: string[] = [];
afterEach(async () => {
  for (const dir of rootDirs) await fs.rm(dir, { recursive: true, force: true });
  rootDirs = [];
});

async function mount() {
  const rootDir = join(tmpdir(), `os-24366-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  rootDirs.push(rootDir);
  const adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret-24366' });
  const calls: string[] = [];
  const storage = new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function'
        ? (...args: unknown[]) => { calls.push(String(prop)); return value.apply(target, args); }
        : value;
    },
  });
  const sessionReads = { n: 0 };
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
  kernel.registerService('storage', storage);
  kernel.registerService('tenancy', (services(sessionReads) as any).tenancy);
  kernel.registerService('auth', (services(sessionReads) as any).auth);
  kernel.registerService('objectql', (services(sessionReads) as any).objectql);
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

async function drive(routes: Map<string, RouteHandler>, key: string, headers: Record<string, string>, body?: unknown) {
  const handler = routes.get(key);
  if (!handler) throw new Error(`no handler for ${key}`);
  const method = key.slice(0, key.indexOf(' '));
  const path = key.slice(key.indexOf(' ') + 1);
  const params: Record<string, string> = {};
  const fileId = path.includes('files/') ? (path.includes(':fileId') ? headers['x-test-file'] ?? UNCLAIMED_FILE : '') : '';
  for (const seg of path.split('/')) if (seg.startsWith(':')) params[seg.slice(1)] = seg === ':fileId' ? fileId : 'x';
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    json(data: unknown) { captured.body = data; return res; },
    send() { return res; },
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params, query: {}, body: method === 'GET' ? undefined : body, headers, method, path } as unknown as IHttpRequest,
    res as IHttpResponse,
  );
  return { status: captured.status, code: captured.body?.error?.code as string | undefined, body: captured.body };
}

const PRESIGNED = `POST ${BASE}/upload/presigned`;
const DL_URL = `GET ${BASE}/files/:fileId/url`;
const UPLOAD_BODY = { filename: 'a.txt', mimeType: 'text/plain', size: 3 };

/** The three route kinds the card names, driven on a concrete file where they read one. */
const ROUTES: Array<{ name: string; route: string; file?: string; body?: unknown }> = [
  { name: 'upload start', route: PRESIGNED, body: UPLOAD_BODY },
  { name: 'download — unclaimed file', route: DL_URL, file: UNCLAIMED_FILE },
  { name: 'download — parent-governed file', route: DL_URL, file: GOVERNED_FILE },
];

describe('[#24366] the storage family gate and the route judge the same credential', () => {
  for (const { name, route, file, body } of ROUTES) {
    const held = { 'x-test-user': HELD_USER, ...(file ? { 'x-test-file': file } : {}) };

    it(`${name} · a held session is refused 403 with its posture, storage never touched`, async () => {
      const { routes, calls } = await mount();
      const answer = await drive(routes, route, held, body);
      expect(answer.status).toBe(403);
      expect(answer.code).toBe(PASSWORD_EXPIRED.code);
      expect(answer.body?.error?.message).toBe(PASSWORD_EXPIRED.message);
      expect(calls).toEqual([]);
    });

    it(`${name} · a held session is refused 403 whatever else the request carries (an admitted key beside it)`, async () => {
      const { routes, calls } = await mount();
      const answer = await drive(routes, route, { ...held, 'x-api-key': OTHER_KEY }, body);
      expect(answer.status).toBe(403);
      expect(answer.code).toBe(PASSWORD_EXPIRED.code);
      expect(answer.body?.error?.message).toBe(PASSWORD_EXPIRED.message);
      expect(calls).toEqual([]);
    });
  }

  it('CONTROL · an un-held session is served the upload start route', async () => {
    const { routes, calls } = await mount();
    const answer = await drive(routes, PRESIGNED, { 'x-test-user': OK_USER }, UPLOAD_BODY);
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('CONTROL · an un-held session is served the unclaimed download', async () => {
    const { routes } = await mount();
    const answer = await drive(routes, DL_URL, { 'x-test-user': OK_USER, 'x-test-file': UNCLAIMED_FILE });
    expect(answer.status).toBe(200);
    expect(answer.body?.data?.url).toBeTruthy();
  });

  it('CONTROL · a held owner\'s key alone is refused as today — the key arm, with the owner\'s posture', async () => {
    const { routes, calls } = await mount();
    const answer = await drive(routes, PRESIGNED, { 'x-api-key': HELD_OWNER_KEY }, UPLOAD_BODY);
    expect(answer.status).toBe(403);
    expect(answer.code).toBe(MFA_REQUIRED.code);
    expect(answer.body?.error?.message).toBe(MFA_REQUIRED.message);
    expect(calls).toEqual([]);
  });

  it('CONTROL · an un-held owner\'s key alone is NOT refused by the gate (no posture code)', async () => {
    const { routes } = await mount();
    const answer = await drive(routes, PRESIGNED, { 'x-api-key': OTHER_KEY }, UPLOAD_BODY);
    expect(POSTURE_CODES).not.toContain(answer.code);
  });
});
