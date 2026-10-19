// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23772] The shared fixture of the principal-session mint pins: a REAL
 * `AuthManager` (the installed better-auth) over the in-memory engine the
 * impersonation pins use, one signed-up human user, and readers for what a
 * pin judges — the `sys_session` row straight off the engine's table, and
 * `GET /get-session` through the manager's real request seam on each lane.
 * Test-only; nothing in the package imports it.
 */

import { AuthManager } from './auth-manager.js';
import { inviteForAudienceGate } from './audience-gate-test-support.js';
import type { PrincipalSession } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

export const MINT_SECRET = 'test-secret-at-least-32-chars-long!!';
export const MINT_BASE = '/api/v1/auth';
const PASSWORD = 'S3cure!Passw0rd-23772';

/** The in-memory engine of `impersonation-bearer-rotation.test.ts`, as far as these pins read it. */
export interface MintFixtureEngine {
  tables: Map<string, Array<Record<string, unknown>>>;
}

export interface MintFixture {
  manager: AuthManager;
  engine: MintFixtureEngine;
  origin: string;
  userId: string;
  /** The user's own context, as the HTTP entry assembles it for a session. */
  human(extra?: Partial<ExecutionContext>): ExecutionContext;
  /** The `sys_session` row whose token is `token`, or `undefined`. */
  row(token: string): Record<string, unknown> | undefined;
  /** `GET /get-session` carrying `headers`, answered by the real request seam. */
  getSession(headers: Record<string, string>): Promise<{ status: number; body: any }>;
}

export async function bootMintFixture(
  createEngine: () => MintFixtureEngine,
  options: { origin?: string; advanced?: Record<string, unknown> } = {},
): Promise<MintFixture> {
  const origin = options.origin ?? 'http://localhost:3000';
  const engine = createEngine();
  const manager = new AuthManager({
    secret: MINT_SECRET,
    baseUrl: origin,
    dataEngine: engine,
    plugins: { admin: true },
    ...(options.advanced ? { advanced: options.advanced } : {}),
  } as any);

  const email = 'mint.23772@example.com';
  await inviteForAudienceGate(manager, email);
  const res = await manager.handleRequest(
    new Request(`${origin}${MINT_BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Mint Human' }),
    }),
  );
  if (res.status !== 200) throw new Error(`fixture sign-up answered ${res.status}: ${await res.text()}`);
  const user = (engine.tables.get('sys_user') ?? []).find((r) => r.email === email);
  if (!user) throw new Error('fixture sign-up wrote no sys_user row');
  const userId = String(user.id);

  return {
    manager,
    engine,
    origin,
    userId,
    human: (extra = {}) => ({ userId, positions: [], permissions: [], isSystem: false, ...extra }),
    row: (token) => (engine.tables.get('sys_session') ?? []).find((r) => r.token === token),
    getSession: async (headers) => {
      const r = await manager.handleRequest(
        new Request(`${origin}${MINT_BASE}/get-session`, { method: 'GET', headers: { origin, ...headers } }),
      );
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    },
  };
}

/** The raw token of a minted session, read back out of its signed value. */
export function rawTokenOf(minted: PrincipalSession): string {
  return decodeURIComponent(minted.token).split('.')[0];
}

/** The stored `expires_at` of a row, in ms. */
export function expiresAtMs(row: Record<string, unknown> | undefined): number {
  if (!row) throw new Error('pin: the session row is gone');
  return new Date(row.expires_at as string | Date).getTime();
}
