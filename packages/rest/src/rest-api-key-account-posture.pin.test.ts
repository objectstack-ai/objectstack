// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ item 3] The REST face judges a key-admitted request by
 * the KEY's answer.
 *
 * ## What was open
 *
 * `computeExecCtx` re-read the session cookie for the ADR-0069 gate whatever
 * had admitted the caller. So a key sent alone was admitted with no question
 * asked of its owner, and the same key sent beside a held cookie was refused
 * with the COOKIE's posture (another credential's, possibly another user's).
 *
 * ## What is pinned
 *
 *  - a key whose owner holds `MFA_REQUIRED` (scope `account`) → `403
 *    MFA_REQUIRED`, the session's code and message, through the real
 *    `enforceAuth`;
 *  - a key whose owner holds only `PASSWORD_EXPIRED` / `PASSWORD_RESET_REQUIRED`
 *    (scope `credential`) → served;
 *  - a held cookie beside an un-held owner's key → served, and the gate's
 *    cookie re-read never runs;
 *  - the refusal is not a revocation: the same key is served again once the
 *    posture clears;
 *  - control: a held SESSION (no key) is still refused through the re-read.
 *
 * The harness is the constructor seams only, the shape
 * `auth-gate-allowlist-fault-window.measurement.test.ts` drives.
 */

import { describe, it, expect } from 'vitest';
import { hashApiKey } from '@objectstack/core';
import { RestServer } from './rest-server.js';

const HTTP_STUB = {
  get: () => {}, post: () => {}, put: () => {}, delete: () => {}, patch: () => {},
  use: () => {}, listen: async () => {}, close: async () => {},
} as any;

const KEY = 'osk_rest_account_posture_pin';
const OWNER = 'u_key_owner';
const COOKIE_USER = 'u_cookie_holder';

const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' };
const PASSWORD_RESET_REQUIRED = { code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' };

function serverWith(authService: any, ql: any): RestServer {
  return new RestServer(
    HTTP_STUB,
    {} as any,
    {} as any,
    undefined,                       // kernelManager
    undefined,                       // envRegistry
    undefined,                       // defaultEnvironmentIdProvider
    async () => authService,         // authServiceProvider — the single-kernel wiring
    async () => ql,                  // objectQLProvider
  );
}

function matchesWhere(row: any, where: any): boolean {
  for (const [field, cond] of Object.entries(where ?? {})) {
    if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!(cond as any).$in.includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

function qlFixture() {
  const tables: Record<string, any[]> = {
    sys_api_key: [{ id: 'key_1', key: hashApiKey(KEY), user_id: OWNER, revoked: false, scopes: '[]' }],
    sys_member: [],
    sys_user: [{ id: OWNER, email: 'owner@example.com' }, { id: COOKIE_USER, email: 'cookie@example.com' }],
    sys_user_permission_set: [],
    sys_permission_set: [],
  };
  return {
    find: async (object: string, q: any = {}) => {
      const rows = (tables[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  };
}

/**
 * An ACTIVE gate. The cookie resolves to `COOKIE_USER`, held by `cookieGate`;
 * the posture computation answers `postures[userId]`.
 */
function authWith(postures: Record<string, Array<{ code: string; message: string }>>, cookieGate?: object) {
  const rec = { sessionReads: 0 };
  return {
    rec,
    postures,
    auth: {
      isAuthGateActive: () => true,
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          rec.sessionReads++;
          if (!headers.get('cookie')) return null;
          return { user: { id: COOKIE_USER, ...(cookieGate ? { authGate: cookieGate } : {}) } };
        },
      },
      resolveUserAuthGates: async (userId: string) => postures[userId] ?? [],
    },
  };
}

async function drive(rest: RestServer, headers: Record<string, string>) {
  const req = { params: {}, query: {}, headers, method: 'GET', path: '/api/v1/data/account' };
  const state: any = { status: 0, body: undefined };
  const res: any = {
    status: (c: number) => { state.status = c; return res; },
    json: (b: any) => { state.body = b; },
    header: () => res, send: () => {},
  };
  const ctx = await rest.resolvePackageRouteExecutionContext(req);
  const blocked = (rest as any).enforceAuth(req, res, ctx);
  return { ctx, blocked, state };
}

describe('REST face — a key answers as its owner\'s session does (#23287, ruling C′)', () => {
  it('REFUSES a key whose owner holds MFA_REQUIRED with the session\'s 403 code and message', async () => {
    const { auth } = authWith({ [OWNER]: [MFA_REQUIRED] });
    const r = await drive(serverWith(auth, qlFixture()), { 'x-api-key': KEY });
    expect(r.ctx?.userId).toBe(OWNER);
    expect(r.blocked).toBe(true);
    expect(r.state.status).toBe(403);
    expect(r.state.body.error.code).toBe('MFA_REQUIRED');
    expect(r.state.body.error.message).toBe(MFA_REQUIRED.message);
  });

  it('SERVES a key whose owner holds only credential-scope postures', async () => {
    const { auth } = authWith({ [OWNER]: [PASSWORD_RESET_REQUIRED, PASSWORD_EXPIRED] });
    const r = await drive(serverWith(auth, qlFixture()), { 'x-api-key': KEY });
    expect(r.ctx?.userId).toBe(OWNER);
    expect(r.ctx?.authGate).toBeUndefined();
    expect(r.blocked).toBe(false);
  });

  it('judges the KEY, not a held cookie beside it, and never re-reads the cookie for it', async () => {
    const { auth, rec } = authWith({ [OWNER]: [] }, MFA_REQUIRED);
    const r = await drive(serverWith(auth, qlFixture()), { 'x-api-key': KEY, cookie: 'session=held' });
    expect(r.ctx?.userId).toBe(OWNER);
    expect(r.blocked).toBe(false);
    expect(rec.sessionReads).toBe(0);
  });

  it('the refusal is not a revocation: the same key is served again once the posture clears', async () => {
    const { auth, postures } = authWith({ [OWNER]: [MFA_REQUIRED] });
    const rest = serverWith(auth, qlFixture());
    expect((await drive(rest, { 'x-api-key': KEY })).state.status).toBe(403);
    postures[OWNER] = [];
    const again = await drive(rest, { 'x-api-key': KEY });
    expect(again.ctx?.userId).toBe(OWNER);
    expect(again.blocked).toBe(false);
  });

  it('control: a held SESSION, no key, is still refused through the gate\'s re-read', async () => {
    const { auth, rec } = authWith({}, PASSWORD_EXPIRED);
    const r = await drive(serverWith(auth, qlFixture()), { cookie: 'session=held' });
    expect(r.ctx?.userId).toBe(COOKIE_USER);
    expect(r.state.status).toBe(403);
    expect(r.state.body.error.code).toBe('PASSWORD_EXPIRED');
    expect(rec.sessionReads).toBe(2);
  });
});
