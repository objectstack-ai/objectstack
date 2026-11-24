// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `POST /organization/accept-invitation` and `POST /organization/reject-invitation`
// refuse a session whose address is not verified, on every deployment;
// `GET /organization/get-invitation` stays open.
//
// These run the REAL better-auth pipeline through a REAL `AuthManager` (the
// organization plugin, the audience-gate invitation carve-out, the membership
// reconciler, the ObjectQL adapter), the same shape as
// `list-user-invitations-verification.test.ts`. Every fixture account starts
// UNVERIFIED (asserted). The door-level matrix over account kinds and mail
// transport states lives in `invitation-acceptance-verified-address.test.ts`;
// this file pins the hooks' order, the bearer path and the function.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager } from './auth-manager';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import {
  ACCEPT_INVITATION_PATH,
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION,
  REJECT_INVITATION_PATH,
  refuseUnverifiedInvitationAnswer,
} from './invitation-accept-verified-email';
import { ACCEPT_INVITATION_ONE_STEP_PATH } from './invitation-mailbox-proof';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const DEFAULT_ORG = 'org_default';
const PARTNER_ORG = 'org_partner';
const PASSWORD = 'S3cure!Passw0rd-verified-answer';
const REFUSAL_CODE = 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION';

type MemoryEngine = ReturnType<typeof createMemoryEngine>;

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

const request = (
  manager: AuthManager,
  method: 'GET' | 'POST',
  path: string,
  { body, cookie, bearer }: { body?: unknown; cookie?: string; bearer?: string } = {},
) =>
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

/**
 * The email service: `mode` is what `isConfigured()` answers, read on every
 * call; `'absent'` means no service at all. Every send is recorded.
 */
const mailer = () => {
  const sent: any[] = [];
  const state: { mode: 'live' | 'log' } = { mode: 'log' };
  const service = {
    async send() { return { id: 'e', status: 'sent' }; },
    async sendTemplate(input: any) {
      sent.push(input);
      return { id: `e${sent.length}`, status: 'sent' };
    },
    isConfigured: () => state.mode === 'live',
  };
  return { sent, state, service };
};

const userRow = (engine: MemoryEngine, email: string) =>
  (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);

const membersOf = (engine: MemoryEngine, organizationId: string, userId: string) =>
  (engine.tables.get('sys_member') ?? []).filter(
    (m: any) => m.organization_id === organizationId && m.user_id === userId,
  );

const invitationRow = (engine: MemoryEngine, id: string) =>
  (engine.tables.get('sys_invitation') ?? []).find((r: any) => r.id === id);

/**
 * An owner of the partner organization, and invitations to b@ and c@ issued
 * BEFORE they sign up (`invite-member` refuses an address that is already a
 * member). Every account is created unverified. Each invitee's address is
 * marked verified where a case says so, as completing the verification mail
 * does.
 */
const boot = async () => {
  const engine = createMemoryEngine();
  engine.tables.set('sys_organization', [
    { id: DEFAULT_ORG, name: 'Default', slug: 'default' },
    { id: PARTNER_ORG, name: 'Partner', slug: 'partner' },
  ]);
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as any,
    membershipPolicy: 'auto',
    getTenancy: () => singleOrgTenancy(),
  });
  const mail = mailer();

  const signUp = async (email: string) => {
    const invitationId = await inviteForAudienceGate(engine, email);
    const res = await request(manager, 'POST', '/sign-up/email', {
      body: { email, password: PASSWORD, name: email, invitationId },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const user = userRow(engine, email);
    expect(user, `sign-up did not create ${email}`).toBeDefined();
    expect(Boolean(user!.email_verified), `${email} should start unverified`).toBe(false);
    return {
      cookie: cookieFrom(res),
      bearer: res.headers.get('set-auth-token') ?? undefined,
      userId: String(user!.id),
    };
  };

  const owner = await signUp('owner@example.com');
  await engine.insert('sys_member', {
    id: 'mem_owner_partner',
    organization_id: PARTNER_ORG,
    user_id: owner.userId,
    role: 'owner',
    created_at: new Date(),
  });
  const invite = async (email: string) => {
    const res = await request(manager, 'POST', '/organization/invite-member', {
      body: { email, role: 'member', organizationId: PARTNER_ORG },
      cookie: owner.cookie,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as { id: string };
  };
  const bInvitation = await invite('b@example.com');
  const cInvitation = await invite('c@example.com');
  const b = await signUp('b@example.com');
  const c = await signUp('c@example.com');

  const accept = (invitationId: string, as: { cookie?: string; bearer?: string }) =>
    request(manager, 'POST', ACCEPT_INVITATION_PATH, { body: { invitationId }, ...as });
  const decline = (invitationId: string, as: { cookie?: string; bearer?: string }) =>
    request(manager, 'POST', REJECT_INVITATION_PATH, { body: { invitationId }, ...as });
  const verify = (email: string) => {
    userRow(engine, email)!.email_verified = true;
  };

  return { engine, manager, mail, owner, b, c, bInvitation, cInvitation, invite, accept, decline, verify };
};

/** The refusal's status and body, read once. */
const answerOf = async (res: Response) => {
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
};

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the refusal is the vendor’s own', () => {
  it('the local fallback equals better-auth’s own $ERROR_CODES entry (a vendor rename turns this red)', async () => {
    const { organization } = await import('better-auth/plugins/organization');
    const plugin: any = organization({});
    const vendor = plugin.$ERROR_CODES?.[REFUSAL_CODE];
    expect({ code: vendor?.code, message: vendor?.message }).toEqual(EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION);
  });
});

describe('an unverified session may neither accept nor decline an invitation, and may read it', () => {
  it('accept: refused 403 with the vendor’s code, and nothing is written', async () => {
    const { engine, b, bInvitation, accept } = await boot();
    const res = await answerOf(await accept(bInvitation.id, { cookie: b.cookie }));
    expect(res.status, res.text).toBe(403);
    expect(res.body).toMatchObject(EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(0);
    expect(invitationRow(engine, bInvitation.id)?.status).toBe('pending');
  });

  it('decline: refused 403 with the vendor’s code, and the invitation stays pending', async () => {
    const { engine, b, bInvitation, decline } = await boot();
    const res = await answerOf(await decline(bInvitation.id, { cookie: b.cookie }));
    expect(res.status, res.text).toBe(403);
    expect(res.body).toMatchObject(EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION);
    expect(invitationRow(engine, bInvitation.id)?.status).toBe('pending');
  });

  it('a bearer-token session is refused alike at accept and decline', async () => {
    const { engine, b, bInvitation, accept, decline } = await boot();
    expect(b.bearer, 'sign-up handed out no bearer token').toBeTruthy();
    for (const answer of [accept, decline]) {
      const res = await answerOf(await answer(bInvitation.id, { bearer: b.bearer }));
      expect(res.status, res.text).toBe(403);
      expect(res.body?.code).toBe(REFUSAL_CODE);
    }
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(0);
    expect(invitationRow(engine, bInvitation.id)?.status).toBe('pending');
  });

  it('get-invitation stays open to the unverified recipient', async () => {
    const { manager, b, bInvitation } = await boot();
    const got = await request(manager, 'GET', `/organization/get-invitation?id=${bInvitation.id}`, { cookie: b.cookie });
    expect(got.status, await got.clone().text()).toBe(200);
    expect(((await got.json()) as { id?: unknown }).id).toBe(bInvitation.id);
  });

  it('ORDER PIN: a session that is not the recipient still gets the vendor’s recipient refusal at accept and decline, not this one', async () => {
    const { c, bInvitation, accept, decline } = await boot();
    for (const answer of [accept, decline]) {
      const res = await answerOf(await answer(bInvitation.id, { cookie: c.cookie }));
      expect(res.status, res.text).toBe(403);
      expect(res.body?.code).toBe('YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION');
    }
  });

  it('CONTROL: once the address is verified, the same session accepts', async () => {
    const { engine, b, bInvitation, accept, verify } = await boot();
    expect((await accept(bInvitation.id, { cookie: b.cookie })).status).toBe(403);
    verify('b@example.com');
    const res = await answerOf(await accept(bInvitation.id, { cookie: b.cookie }));
    expect(res.status, res.text).toBe(200);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(1);
    expect(invitationRow(engine, bInvitation.id)?.status).toBe('accepted');
  });

  it('CONTROL: once the address is verified, the same session declines', async () => {
    const { engine, b, bInvitation, decline, verify } = await boot();
    expect((await decline(bInvitation.id, { cookie: b.cookie })).status).toBe(403);
    verify('b@example.com');
    const res = await answerOf(await decline(bInvitation.id, { cookie: b.cookie }));
    expect(res.status, res.text).toBe(200);
    expect(invitationRow(engine, bInvitation.id)?.status).toBe('rejected');
  });

  it('the one-step door still accepts with the mail’s proof: it verifies the address before it accepts', async () => {
    const { engine, manager, mail, invite } = await boot();
    manager.setEmailService(mail.service as never);
    mail.state.mode = 'live';

    const invitation = await invite('newcomer@example.com');
    const sentMail = [...mail.sent].reverse().find(
      (m) => m.template === 'auth.invitation' && m.to === 'newcomer@example.com',
    );
    expect(sentMail, 'no invitation mail').toBeDefined();
    const match = /#proof=([^&]+)$/.exec(String(sentMail.deliverOnlyData?.acceptUrl ?? ''));
    expect(match, 'the mail carries no proof').not.toBeNull();

    const res = await answerOf(
      await request(manager, 'POST', ACCEPT_INVITATION_ONE_STEP_PATH, {
        body: { invitationId: invitation.id, proof: decodeURIComponent(match![1]!), name: 'Newcomer', password: PASSWORD },
      }),
    );
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ success: true, data: { outcome: 'accepted', organizationId: PARTNER_ORG } });
    const user = userRow(engine, 'newcomer@example.com');
    expect(user?.email_verified).toBeTruthy();
    expect(membersOf(engine, PARTNER_ORG, String(user!.id))).toHaveLength(1);
  });
});

describe('refuseUnverifiedInvitationAnswer', () => {
  it('a verified user passes', async () => {
    await expect(refuseUnverifiedInvitationAnswer({ emailVerified: true })).resolves.toBeUndefined();
  });

  it('an unverified (or unknown) user is refused, with the entry the caller hands in', async () => {
    for (const user of [{ emailVerified: false }, {}, null, undefined]) {
      await expect(refuseUnverifiedInvitationAnswer(user)).rejects.toMatchObject({ statusCode: 403, body: { code: REFUSAL_CODE } });
    }
    const vendorEntry = { code: REFUSAL_CODE, message: 'vendor sentence' };
    await expect(
      refuseUnverifiedInvitationAnswer({ emailVerified: false }, { verificationRequired: vendorEntry }),
    ).rejects.toMatchObject({ body: { message: 'vendor sentence' } });
  });
});
