// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// Minimal IHttpServer / protocol stubs — we only exercise enforceAuth().
const server: any = {
  get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
  use: vi.fn(), listen: vi.fn(), close: vi.fn(),
};
const protocol: any = {};

const makeRes = () => {
  const state: any = { status: 200, body: undefined };
  const res: any = {
    status: (c: number) => { state.status = c; return res; },
    json: (b: any) => { state.body = b; },
    header: () => res,
    send: () => {},
  };
  return { res, state };
};

const rest = new RestServer(server, protocol, { api: { requireAuth: false } } as any);

describe('RestServer.enforceAuth — ADR-0069 auth-policy gate', () => {
  const gate = (req: any, context: any) => {
    const { res, state } = makeRes();
    const blocked = (rest as any).enforceAuth(req, res, context);
    return { blocked, state };
  };

  it('blocks a gated session (authGate) on a protected path with 403 + code', () => {
    const r = gate(
      { method: 'GET', path: '/api/v1/data/sys_user' },
      { userId: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'change it' } },
    );
    expect(r.blocked).toBe(true);
    expect(r.state.status).toBe(403);
    expect(r.state.body.error.code).toBe('PASSWORD_EXPIRED');
  });

  it('lets a gated session through on an allow-listed (auth/remediation) path', () => {
    const r = gate(
      { method: 'POST', path: '/api/v1/auth/change-password' },
      { userId: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'x' } },
    );
    expect(r.blocked).toBe(false);
  });

  it('does not gate a normal authenticated session (no authGate)', () => {
    const r = gate({ method: 'GET', path: '/api/v1/data/sys_user' }, { userId: 'u1' });
    expect(r.blocked).toBe(false);
  });

  it('ignores OPTIONS preflight even when gated', () => {
    const r = gate(
      { method: 'OPTIONS', path: '/api/v1/data/sys_user' },
      { userId: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'x' } },
    );
    expect(r.blocked).toBe(false);
  });
});

// #7432 — a request carrying NO path must not be exempt from the gate.
//
// `isAuthGateAllowlisted(undefined)` returns `true` (it treats "no path" as
// allow-listed), so passing `req.path` through raw made a pathless request read
// as allow-listed on every route and the gate silently did not fire. These pin
// the CONSEQUENCE — blocked / not blocked — rather than the guard expression, so
// they stay meaningful if the guard is rewritten. Removing the guard turns the
// first two red; they are the reverse-verification target.
describe('#7432 — enforceAuth exempts only a REAL path from the ADR-0069 gate', () => {
  const gate = (req: any, context: any) => {
    const { res, state } = makeRes();
    const blocked = (rest as any).enforceAuth(req, res, context);
    return { blocked, state };
  };
  const GATED = { userId: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'change it' } };

  it('blocks a gated session when `path` is ABSENT', () => {
    const r = gate({ method: 'GET' }, GATED);
    expect(r.blocked).toBe(true);
    expect(r.state.status).toBe(403);
    expect(r.state.body.error.code).toBe('PASSWORD_EXPIRED');
  });

  it('blocks a gated session when `path` is the EMPTY STRING', () => {
    const r = gate({ method: 'GET', path: '' }, GATED);
    expect(r.blocked).toBe(true);
    expect(r.state.status).toBe(403);
    expect(r.state.body.error.code).toBe('PASSWORD_EXPIRED');
  });

  // The load-bearing half: a guard that fixes the bypass by blocking everything
  // is not a fix. The allow-list must still allow, and an ungated session must
  // still be ungated — including on the pathless requests above, where the gate
  // branch is now reached but has no gate to apply.
  it('still lets a gated session reach every allow-listed path shape', () => {
    for (const path of [
      '/api/v1/auth/change-password',            // ALLOW_PREFIXES
      '/auth/two-factor/enable',                 // dispatcher path shape
      '/api/v1/environments/env1/auth/sign-out', // embedded `/auth/` segment
      '/api/v1/health',                          // ALLOW_SUFFIXES
      '/api/v1/me/apps',                         // UI-bootstrap read
    ]) {
      expect(gate({ method: 'GET', path }, GATED).blocked).toBe(false);
    }
  });

  it('still blocks an ordinary gated request on a protected path', () => {
    const r = gate({ method: 'GET', path: '/api/v1/data/sys_user' }, GATED);
    expect(r.blocked).toBe(true);
    expect(r.state.status).toBe(403);
  });

  it('does not block an UNGATED session that happens to carry no path', () => {
    // The guard tightens the exemption, not the gate: with no `authGate` there
    // is nothing to enforce, so a pathless authenticated request passes exactly
    // as it did before. (`shouldDenyAnonymous` sees `userId`, so no 401 either.)
    expect(gate({ method: 'GET' }, { userId: 'u1' }).blocked).toBe(false);
    expect(gate({ method: 'GET', path: '' }, { userId: 'u1' }).blocked).toBe(false);
  });

  it('still ignores OPTIONS preflight when gated and pathless', () => {
    expect(gate({ method: 'OPTIONS' }, GATED).blocked).toBe(false);
  });
});
