// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `GET /organization/accepted-invitation` (`invitation-accepted-answer.ts`):
// the signed-in, verified recipient of an ALREADY-ACCEPTED invitation reads the
// organization it joined them to; every other caller and every other state
// answers one uniform 404, and the vendor's `get-invitation` and the
// signed-out `invitation-preview` answer exactly as they did before the route
// existed.
//
// The REAL better-auth pipeline through a REAL `AuthManager` (the organization
// plugin, the audience-gate invitation carve-out, the ObjectQL adapter), the
// same shape as `invitation-accept-verified-email.test.ts`. The invitations
// are issued, accepted, declined and canceled through the vendor's own routes;
// only the two expired states are written to the row, as
// `invitation-expired-supersede.ts` and the clock do.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AuthManager } from './auth-manager';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import {
  ACCEPTED_INVITATION_NOT_FOUND,
  ACCEPTED_INVITATION_PATH,
  ACCEPTED_INVITATION_UNAUTHENTICATED,
  isVerifiedRecipient,
} from './invitation-accepted-answer';
import { INVITATION_PREVIEW_NOT_FOUND, runInvitationPreview } from './invitation-preview';
import { InProcessCounterStore } from './rate-limit-storage';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const DEFAULT_ORG = 'org_default';
const PASSWORD = 'S3cure!Passw0rd-accepted-answer';
const ORGS = ['acc', 'rej', 'can', 'exp', 'old', 'pen'] as const;

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

type Caller = { cookie?: string; bearer?: string };

const request = (manager: AuthManager, method: 'GET' | 'POST', path: string, { body, cookie, bearer }: Caller & { body?: unknown } = {}) =>
  manager.handleRequest(
    new Request(`${BASE}/api/v1/auth${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );

const answerOf = async (res: Response) => {
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
};

/**
 * One owner of six organizations, and one invitation per organization to
 * rec@ — issued before rec@ signs up — then driven into each state: accepted
 * and declined by rec@, canceled by the owner, one moved to `expired` and one
 * left pending with its expiry in the past. `pen` stays pending. Every account
 * is verified, as the verification mail leaves it.
 */
const boot = async () => {
  const engine = createMemoryEngine();
  engine.tables.set('sys_organization', [
    { id: DEFAULT_ORG, name: 'Default', slug: 'default' },
    ...ORGS.map((o) => ({ id: `org_${o}`, name: `Org ${o}`, slug: o })),
  ]);
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as any,
    membershipPolicy: 'auto',
    getTenancy: () => singleOrgTenancy(),
  });
  const userRow = (email: string) => (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
  const signUp = async (email: string) => {
    const invitationId = await inviteForAudienceGate(engine, email);
    const res = await request(manager, 'POST', '/sign-up/email', { body: { email, password: PASSWORD, name: email, invitationId } });
    expect(res.status, await res.clone().text()).toBe(200);
    userRow(email)!.email_verified = true;
    return { cookie: cookieFrom(res), bearer: res.headers.get('set-auth-token') ?? undefined, userId: String(userRow(email)!.id) };
  };

  const owner = await signUp('owner@example.com');
  for (const o of ORGS) {
    await engine.insert('sys_member', { id: `mem_owner_${o}`, organization_id: `org_${o}`, user_id: owner.userId, role: 'owner', created_at: new Date() });
  }
  const ids = {} as Record<(typeof ORGS)[number], string>;
  for (const o of ORGS) {
    const res = await request(manager, 'POST', '/organization/invite-member', {
      body: { email: 'rec@example.com', role: 'member', organizationId: `org_${o}` },
      cookie: owner.cookie,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    ids[o] = ((await res.json()) as { id: string }).id;
  }
  const rec = await signUp('rec@example.com');
  const other = await signUp('other@example.com');
  const row = (id: string) => (engine.tables.get('sys_invitation') ?? []).find((r: any) => r.id === id);

  expect((await request(manager, 'POST', '/organization/accept-invitation', { body: { invitationId: ids.acc }, cookie: rec.cookie })).status).toBe(200);
  expect((await request(manager, 'POST', '/organization/reject-invitation', { body: { invitationId: ids.rej }, cookie: rec.cookie })).status).toBe(200);
  expect((await request(manager, 'POST', '/organization/cancel-invitation', { body: { invitationId: ids.can }, cookie: owner.cookie })).status).toBe(200);
  row(ids.exp).status = 'expired';
  row(ids.old).expires_at = new Date(Date.now() - 60_000);
  expect(row(ids.acc).status).toBe('accepted');
  expect(row(ids.rej).status).toBe('rejected');
  expect(row(ids.can).status).toBe('canceled');

  const states: Record<string, string> = {
    accepted: ids.acc,
    rejected: ids.rej,
    canceled: ids.can,
    'expired (status)': ids.exp,
    'expired (past expiresAt)': ids.old,
    pending: ids.pen,
    unknown: 'inv_does_not_exist',
  };
  const readAccepted = async (id: string, as: Caller) =>
    answerOf(await request(manager, 'GET', `${ACCEPTED_INVITATION_PATH}?id=${encodeURIComponent(id)}`, as));
  return { engine, manager, owner, rec, other, ids, states, row, userRow, readAccepted };
};

let fx: Awaited<ReturnType<typeof boot>>;
beforeAll(async () => {
  for (const k of ['info', 'warn', 'log', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => {});
  fx = await boot();
}, 60_000);
afterAll(() => {
  vi.restoreAllMocks();
});

/** The measured "before": better-auth 1.7.12 `get-invitation`, read on origin/main before this route existed. */
const GET_INVITATION_NOT_FOUND = '{"message":"Invitation not found!"}';
const GET_INVITATION_UNAUTHENTICATED = '{"message":"Not authenticated"}';
const GET_INVITATION_NOT_RECIPIENT = '{"message":"You are not the recipient of the invitation","code":"YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION"}';
const NON_PENDING = ['accepted', 'rejected', 'canceled', 'expired (status)', 'expired (past expiresAt)', 'unknown'];

describe('the recipient of an accepted invitation reads the organization it joined them to', () => {
  it('cookie session: 200 with the organization, and the person is still a member', async () => {
    const res = await fx.readAccepted(fx.ids.acc, { cookie: fx.rec.cookie });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        invitationId: fx.ids.acc,
        status: 'accepted',
        organizationId: 'org_acc',
        organizationName: 'Org acc',
        organizationSlug: 'acc',
        isMember: true,
      },
    });
  });

  it('bearer session: the same answer', async () => {
    expect(fx.rec.bearer, 'sign-up handed out no bearer token').toBeTruthy();
    const res = await fx.readAccepted(fx.ids.acc, { bearer: fx.rec.bearer });
    expect(res.status, res.text).toBe(200);
    expect(res.body?.data?.organizationName).toBe('Org acc');
  });
});

describe('CONTROLS: every other caller and every other state answers one uniform 404', () => {
  it('another signed-in user on the same accepted id: the uniform 404, byte for byte the unknown id’s', async () => {
    const unknown = await fx.readAccepted('inv_does_not_exist', { cookie: fx.other.cookie });
    const res = await fx.readAccepted(fx.ids.acc, { cookie: fx.other.cookie });
    expect(res.status, res.text).toBe(404);
    expect(res.body).toEqual(ACCEPTED_INVITATION_NOT_FOUND);
    expect(res.text).toBe(unknown.text);
    expect(unknown.status).toBe(404);
  });

  it('another signed-in user on every state answers the same bytes', async () => {
    const answers = await Promise.all(Object.values(fx.states).map((id) => fx.readAccepted(id, { cookie: fx.other.cookie })));
    for (const a of answers) {
      expect(a.status, a.text).toBe(404);
      expect(a.text).toBe(answers[0]!.text);
    }
  });

  it('a signed-out caller: 401 UNAUTHENTICATED, whatever the id', async () => {
    for (const id of Object.values(fx.states)) {
      const res = await fx.readAccepted(id, {});
      expect(res.status, res.text).toBe(401);
      expect(res.body).toEqual(ACCEPTED_INVITATION_UNAUTHENTICATED);
    }
  });

  it('the recipient’s rejected, canceled, expired, pending and unknown ids: the same 404 bytes as an unknown id', async () => {
    const unknown = await fx.readAccepted('inv_does_not_exist', { cookie: fx.rec.cookie });
    expect(unknown.status).toBe(404);
    for (const state of ['rejected', 'canceled', 'expired (status)', 'expired (past expiresAt)', 'pending', 'unknown']) {
      const res = await fx.readAccepted(fx.states[state]!, { cookie: fx.rec.cookie });
      expect(res.status, `${state}: ${res.text}`).toBe(404);
      expect(res.text, state).toBe(unknown.text);
    }
  });

  it('the recipient whose address is not verified: the same 404 (the id is no proof of the mailbox)', async () => {
    const user = fx.userRow('rec@example.com')!;
    user.email_verified = false;
    try {
      const res = await fx.readAccepted(fx.ids.acc, { cookie: fx.rec.cookie });
      expect(res.status, res.text).toBe(404);
      expect(res.body).toEqual(ACCEPTED_INVITATION_NOT_FOUND);
    } finally {
      user.email_verified = true;
    }
  });

  it('every refused case is decided after the same reads: one invitation read, no organization or membership read', async () => {
    const counted = ['sys_invitation', 'sys_organization', 'sys_member'];
    const engine: any = fx.engine;
    const readsDuring = async (run: () => Promise<unknown>) => {
      const tally: Record<string, number> = { sys_invitation: 0, sys_organization: 0, sys_member: 0 };
      const original = { findOne: engine.findOne, find: engine.find, count: engine.count };
      for (const m of ['findOne', 'find', 'count'] as const) {
        engine[m] = (name: string, ...rest: unknown[]) => {
          if (counted.includes(name)) tally[name]! += 1;
          return original[m].call(engine, name, ...rest);
        };
      }
      try { await run(); } finally { Object.assign(engine, original); }
      return tally;
    };
    const refused: Array<[string, Caller]> = [
      [fx.ids.acc, { cookie: fx.other.cookie }],
      ['inv_does_not_exist', { cookie: fx.other.cookie }],
      ['inv_does_not_exist', { cookie: fx.rec.cookie }],
      [fx.ids.rej, { cookie: fx.rec.cookie }],
      [fx.ids.pen, { cookie: fx.rec.cookie }],
      [fx.ids.old, { cookie: fx.rec.cookie }],
    ];
    const tallies = [];
    for (const [id, as] of refused) tallies.push(await readsDuring(() => fx.readAccepted(id, as)));
    for (const t of tallies) expect(t).toEqual({ sys_invitation: 1, sys_organization: 0, sys_member: 0 });
  });

  it('the query set is closed: an unknown name, a repeated id and a missing id are 400 VALIDATION_ERROR', async () => {
    for (const qs of [`id=${fx.ids.acc}&organizationId=org_acc`, `id=${fx.ids.acc}&id=${fx.ids.acc}`, '', 'id=%20']) {
      const res = await answerOf(await request(fx.manager, 'GET', `${ACCEPTED_INVITATION_PATH}?${qs}`, { cookie: fx.rec.cookie }));
      expect(res.status, `${qs}: ${res.text}`).toBe(400);
      expect(res.body?.code, qs).toBe('VALIDATION_ERROR');
    }
  });
});

describe('UNCHANGED: get-invitation answers exactly the measured "before"', () => {
  it('every non-pending state and the unknown id: recipient and another user get the code-less 400, signed out the 401', async () => {
    for (const state of NON_PENDING) {
      const id = fx.states[state]!;
      for (const [who, as] of [['recipient', { cookie: fx.rec.cookie }], ['other user', { cookie: fx.other.cookie }]] as const) {
        const res = await answerOf(await request(fx.manager, 'GET', `/organization/get-invitation?id=${id}`, as));
        expect([res.status, res.text], `${state} / ${who}`).toEqual([400, GET_INVITATION_NOT_FOUND]);
      }
      const out = await answerOf(await request(fx.manager, 'GET', `/organization/get-invitation?id=${id}`));
      expect([out.status, out.text], `${state} / signed out`).toEqual([401, GET_INVITATION_UNAUTHENTICATED]);
    }
  });

  it('the pending invitation: 200 to the recipient, the vendor’s 403 to another user, 401 signed out', async () => {
    const mine = await answerOf(await request(fx.manager, 'GET', `/organization/get-invitation?id=${fx.ids.pen}`, { cookie: fx.rec.cookie }));
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body).toMatchObject({ id: fx.ids.pen, status: 'pending', organizationName: 'Org pen' });
    const theirs = await answerOf(await request(fx.manager, 'GET', `/organization/get-invitation?id=${fx.ids.pen}`, { cookie: fx.other.cookie }));
    expect([theirs.status, theirs.text]).toEqual([403, GET_INVITATION_NOT_RECIPIENT]);
    const out = await answerOf(await request(fx.manager, 'GET', `/organization/get-invitation?id=${fx.ids.pen}`));
    expect([out.status, out.text]).toEqual([401, GET_INVITATION_UNAUTHENTICATED]);
  });
});

describe('UNCHANGED: the signed-out invitation-preview stays uniform and session-blind', () => {
  const preview = (id: string) =>
    runInvitationPreview(
      { queries: { id: [id] }, clientAddress: '203.0.113.9' },
      { getDataEngine: () => fx.engine as any, counterStore: async () => new InProcessCounterStore() },
    );

  it('every non-pending state and the unknown id: the one 404 body', async () => {
    for (const state of NON_PENDING) {
      const answer = await preview(fx.states[state]!);
      expect(answer, state).toEqual({ status: 404, body: INVITATION_PREVIEW_NOT_FOUND });
    }
  });

  it('the pending invitation: the three-key projection, address masked', async () => {
    expect(await preview(fx.ids.pen)).toEqual({
      status: 200,
      body: { success: true, data: { organizationName: 'Org pen', inviterName: 'owner@example.com', email: 'r***@example.com' } },
    });
  });
});

describe('isVerifiedRecipient — the vendor’s address comparison plus the verified rule', () => {
  it('matches case-insensitively, and only a verified address', () => {
    expect(isVerifiedRecipient({ email: 'rec@example.com' }, { email: 'REC@Example.com', emailVerified: true })).toBe(true);
    expect(isVerifiedRecipient({ email: 'rec@example.com' }, { email: 'rec@example.com', emailVerified: false })).toBe(false);
    expect(isVerifiedRecipient({ email: 'rec@example.com' }, { email: 'rec@example.com' })).toBe(false);
    expect(isVerifiedRecipient({ email: 'rec@example.com' }, { email: 'other@example.com', emailVerified: true })).toBe(false);
    expect(isVerifiedRecipient(null, { email: 'rec@example.com', emailVerified: true })).toBe(false);
    expect(isVerifiedRecipient({ email: 'rec@example.com' }, null)).toBe(false);
  });
});

describe('a recipient who has left the organization since', () => {
  it('still reads the accepted invitation, with isMember false', async () => {
    const members = fx.engine.tables.get('sys_member') ?? [];
    const mine = members.filter((m: any) => m.organization_id === 'org_acc' && m.user_id === fx.rec.userId);
    expect(mine).toHaveLength(1);
    fx.engine.tables.set('sys_member', members.filter((m: any) => !mine.includes(m)));
    try {
      const res = await fx.readAccepted(fx.ids.acc, { cookie: fx.rec.cookie });
      expect(res.status, res.text).toBe(200);
      expect(res.body?.data).toMatchObject({ organizationId: 'org_acc', isMember: false });
    } finally {
      fx.engine.tables.set('sys_member', [...(fx.engine.tables.get('sys_member') ?? []), ...mine]);
    }
  });
});
