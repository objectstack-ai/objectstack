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
