// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #26020 — the signed-out invitation preview (ruling 6413975861, Q1 A).
//
// ── What is pinned ──────────────────────────────────────────────────────────
//
//  • the projection is EXACTLY the three keys, asserted with `toEqual` on the
//    whole body, address masked;
//  • a signed-in caller (the inviter, and the invitee) gets the identical body,
//    never an extra field;
//  • unknown, expired, accepted, rejected and cancelled ids answer the
//    IDENTICAL status and body;
//  • the rate limit trips, per established address, and counts malformed
//    probes too;
//  • the closed query set { id }.
//
// ── Why every leg drives the REAL mount chain ───────────────────────────────
//
// The route is a raw-app mount ahead of the better-auth catch-all, so a test
// driving `AuthManager.handleRequest` would never reach it (the
// `admin-has-permission-endpoint.test.ts` reading). The fixture mounts
// `AuthPlugin.registerAuthRoutes` on a real Hono app in front of a real
// `AuthManager` on the installed better-auth, and the invitations are issued,
// accepted, rejected and cancelled through the vendor's own routes, so the
// columns the preview reads are the columns the product writes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import {
  INVITATION_PREVIEW_NOT_FOUND,
  INVITATION_PREVIEW_RATE_LIMIT,
  maskInvitedEmail,
} from './invitation-preview';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-26020';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const ROUTE = '/organization/invitation-preview';
const DEFAULT_ORG = 'org_default';
const ACME_ORG = 'org_acme';

type MemoryEngine = ReturnType<typeof createMemoryEngine>;

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

const singleOrgTenancy = () =>
  ({
    posture: 'single',
    requestedPosture: 'single',
    isolationActive: false,
    requested: false,
    degraded: false,
    defaultOrgId: async () => DEFAULT_ORG,
  }) as any;

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

async function answerOf(res: Response): Promise<{ status: number; json: any; text: string }> {
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

/**
 * One deployment: `Alice Owner` owns the default organization and `Acme Corp`,
 * served through the REAL mount chain. `trustProxy` lets a leg name distinct
 * client addresses through `x-forwarded-for`.
 */
async function stage(opts: { trustProxy?: boolean } = {}) {
  const engine: MemoryEngine = createMemoryEngine();
  engine.tables.set('sys_organization', [
    { id: DEFAULT_ORG, name: 'Default', slug: 'default' },
    { id: ACME_ORG, name: 'Acme Corp', slug: 'acme' },
  ]);
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as any,
    membershipPolicy: 'auto',
    getTenancy: () => singleOrgTenancy(),
    ...(opts.trustProxy ? { trustProxy: true } : {}),
  } as any);

  const direct = (method: 'GET' | 'POST', path: string, body?: unknown, cookie?: string) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );

  const signUp = async (email: string, name: string) => {
    await inviteForAudienceGate(engine, email);
    const res = await direct('POST', '/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
    const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
    expect(user, `sign-up did not create ${email}`).toBeDefined();
    return { cookie: cookieFrom(res), userId: String(user!.id) };
  };

  const owner = await signUp('alice.owner@example.com', 'Alice Owner');
  const ownerDefault = (engine.tables.get('sys_member') ?? []).find(
    (m: any) => m.organization_id === DEFAULT_ORG && m.user_id === owner.userId,
  );
  expect(ownerDefault, 'the reconciler did not bind the owner to the default organization').toBeDefined();
  ownerDefault!.role = 'owner';
  await engine.insert('sys_member', {
    id: 'mem_owner_acme',
    organization_id: ACME_ORG,
    user_id: owner.userId,
    role: 'owner',
    created_at: new Date(),
  });

  /** Issue an invitation through the vendor's own route; returns its id. */
  const invite = async (email: string): Promise<string> => {
    const res = await direct('POST', '/organization/invite-member', { email, role: 'member', organizationId: ACME_ORG }, owner.cookie);
    expect(res.status, `invite ${email}: ${await res.clone().text()}`).toBe(200);
    const body: any = await res.json();
    expect(body.id, 'invite-member answered without an id').toBeTruthy();
    return String(body.id);
  };

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const preview = async (query: string, headers: Record<string, string> = {}) =>
    answerOf(await app.request(`${ORIGIN}${BASE}${ROUTE}${query}`, { method: 'GET', headers }));

  const invitationRow = (id: string) =>
    (engine.tables.get('sys_invitation') ?? []).find((r: any) => r.id === id) as Record<string, any>;

  return { engine, manager, app, direct, signUp, invite, owner, preview, invitationRow };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('#26020 — the signed-out invitation preview', () => {
  it('PREMISE (measured): the vendor get-invitation refuses a caller with no session, so this read is the plugin\'s own', async () => {
    const { direct, invite } = await stage();
    const id = await invite('bob.builder@acme.test');
    const res = await direct('GET', `/organization/get-invitation?id=${id}`);
    expect(res.status, await res.clone().text()).toBe(401);
  });

  it('answers a signed-out caller with EXACTLY the three keys, the address masked', async () => {
    const { invite, preview } = await stage();
    const id = await invite('bob.builder@acme.test');

    const answer = await preview(`?id=${encodeURIComponent(id)}`);
    expect(answer.status, answer.text).toBe(200);
    expect(answer.json).toEqual({
      success: true,
      data: { organizationName: 'Acme Corp', inviterName: 'Alice Owner', email: 'b***@acme.test' },
    });
  });

  it('a signed-in caller — the inviter, or the invitee — gets the identical projection, never extra fields', async () => {
    const { invite, preview, owner, signUp } = await stage();
    const id = await invite('bob.builder@acme.test');
    const bob = await signUp('bob.builder@acme.test', 'Bob Builder');

    const anonymous = await preview(`?id=${id}`);
    const asInviter = await preview(`?id=${id}`, { cookie: owner.cookie, origin: ORIGIN });
    const asInvitee = await preview(`?id=${id}`, { cookie: bob.cookie, origin: ORIGIN });
    expect(anonymous.status, anonymous.text).toBe(200);
    expect(asInviter).toEqual(anonymous);
    expect(asInvitee).toEqual(anonymous);
  });

  it('unknown, expired, accepted, rejected and cancelled ids all answer the identical not-found', async () => {
    const { direct, invite, preview, owner, signUp, invitationRow } = await stage();

    const expired = await invite('expired@acme.test');
    invitationRow(expired).expires_at = new Date(Date.now() - 60_000);

    const expiredByStatus = await invite('lapsed@acme.test');
    invitationRow(expiredByStatus).status = 'expired';

    const accepted = await invite('accepted@acme.test');
    const acceptor = await signUp('accepted@acme.test', 'Acceptor');
    const acceptRes = await direct('POST', '/organization/accept-invitation', { invitationId: accepted }, acceptor.cookie);
    expect(acceptRes.status, await acceptRes.clone().text()).toBe(200);
    expect(invitationRow(accepted).status).toBe('accepted');

    const rejected = await invite('rejected@acme.test');
    const rejector = await signUp('rejected@acme.test', 'Rejector');
    const rejectRes = await direct('POST', '/organization/reject-invitation', { invitationId: rejected }, rejector.cookie);
    expect(rejectRes.status, await rejectRes.clone().text()).toBe(200);
    expect(invitationRow(rejected).status).toBe('rejected');

    const cancelled = await invite('cancelled@acme.test');
    const cancelRes = await direct('POST', '/organization/cancel-invitation', { invitationId: cancelled }, owner.cookie);
    expect(cancelRes.status, await cancelRes.clone().text()).toBe(200);
    expect(invitationRow(cancelled).status).toBe('canceled');

    // Control: a live invitation on the same staging still answers, so the
    // refusals below are about each state, not a broken fixture.
    const live = await invite('live@acme.test');
    expect((await preview(`?id=${live}`)).status).toBe(200);

    const answers = await Promise.all(
      ['inv_never_issued', expired, expiredByStatus, accepted, rejected, cancelled].map((id) => preview(`?id=${id}`)),
    );
    for (const answer of answers) {
      expect(answer.status, answer.text).toBe(404);
      expect(answer.json).toEqual(INVITATION_PREVIEW_NOT_FOUND);
      expect(answer.text).toBe(answers[0]!.text);
    }
  });

  it('an organization that no longer exists answers the same not-found; an inviter that no longer exists reads as a null name', async () => {
    const { engine, invite, preview, invitationRow } = await stage();
    const orphanedOrg = await invite('org-gone@acme.test');
    invitationRow(orphanedOrg).organization_id = 'org_deleted';
    const noInviter = await invite('inviter-gone@acme.test');
    invitationRow(noInviter).inviter_id = 'usr_deleted';

    const orgGone = await preview(`?id=${orphanedOrg}`);
    expect(orgGone.status, orgGone.text).toBe(404);
    expect(orgGone.json).toEqual(INVITATION_PREVIEW_NOT_FOUND);

    const inviterGone = await preview(`?id=${noInviter}`);
    expect(inviterGone.status, inviterGone.text).toBe(200);
    expect(inviterGone.json).toEqual({
      success: true,
      data: { organizationName: 'Acme Corp', inviterName: null, email: 'i***@acme.test' },
    });
    expect(engine.tables.get('sys_user')?.some((u: any) => u.id === 'usr_deleted')).toBe(false);
  });

  it('the rate limit trips per established address, counting malformed probes too', async () => {
    const { invite, preview } = await stage({ trustProxy: true });
    const id = await invite('bob.builder@acme.test');
    const from = (address: string) => ({ 'x-forwarded-for': address });

    // Half the budget on malformed probes: they spend it like real reads.
    const half = Math.floor(INVITATION_PREVIEW_RATE_LIMIT.max / 2);
    for (let i = 0; i < half; i++) {
      expect((await preview('', from('203.0.113.7'))).status).toBe(400);
    }
    for (let i = half; i < INVITATION_PREVIEW_RATE_LIMIT.max; i++) {
      expect((await preview(`?id=${id}`, from('203.0.113.7'))).status).toBe(200);
    }

    const tripped = await preview(`?id=${id}`, from('203.0.113.7'));
    expect(tripped.status, tripped.text).toBe(429);
    expect(tripped.json).toEqual({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: expect.any(String) },
    });
    // Another address keeps its own window.
    expect((await preview(`?id=${id}`, from('198.51.100.9'))).status).toBe(200);
  });

  it('the 429 carries Retry-After within the window', async () => {
    const { invite, app } = await stage({ trustProxy: true });
    const id = await invite('bob.builder@acme.test');
    const fire = () =>
      app.request(`${ORIGIN}${BASE}${ROUTE}?id=${id}`, { method: 'GET', headers: { 'x-forwarded-for': '192.0.2.44' } });
    for (let i = 0; i < INVITATION_PREVIEW_RATE_LIMIT.max; i++) expect((await fire()).status).toBe(200);
    const res = await fire();
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get('retry-after'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(INVITATION_PREVIEW_RATE_LIMIT.window);
  });

  it('the closed query set { id }: an unknown name, a repeated id and a missing id are each a located 400', async () => {
    const { invite, preview } = await stage();
    const id = await invite('bob.builder@acme.test');

    const unknown = await preview(`?id=${id}&organizationId=${ACME_ORG}`);
    expect(unknown.status, unknown.text).toBe(400);
    expect(unknown.json.error.code).toBe('VALIDATION_ERROR');
    expect(unknown.json.error.message).toContain('"organizationId"');
    expect(unknown.json).not.toHaveProperty('data');

    const repeated = await preview(`?id=${id}&id=${id}`);
    expect(repeated.status, repeated.text).toBe(400);
    expect(repeated.json.error.code).toBe('VALIDATION_ERROR');

    for (const query of ['', '?id=', '?id=%20']) {
      const missing = await preview(query);
      expect(missing.status, `${query}: ${missing.text}`).toBe(400);
      expect(missing.json.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('maskInvitedEmail', () => {
  it.each([
    ['alice@acme.com', 'a***@acme.com'],
    ['a@acme.com', 'a***@acme.com'],
    ['bob.builder@sub.acme.co.uk', 'b***@sub.acme.co.uk'],
    ['no-at-sign', '***'],
    ['@acme.com', '***'],
    ['alice@', '***'],
    ['', '***'],
  ])('%s → %s', (input, masked) => {
    expect(maskInvitedEmail(input)).toBe(masked);
  });

  it('does not reveal the local part\'s length', () => {
    expect(maskInvitedEmail('al@acme.com')).toBe(maskInvitedEmail('alexandria@acme.com'));
  });
});
