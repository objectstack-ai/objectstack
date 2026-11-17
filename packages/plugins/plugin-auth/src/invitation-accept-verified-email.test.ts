// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#34272] `POST /organization/accept-invitation` refuses an UNVERIFIED
// session while this deployment delivers mail, and only then.
//
// These run the REAL better-auth pipeline through a REAL `AuthManager` (the
// organization plugin, the audience-gate invitation carve-out, the membership
// reconciler, the ObjectQL adapter), the same shape as
// `list-user-invitations-verification.test.ts`. "Mail is live" is the one
// reader the rule asks, `IEmailService.isConfigured()`, swapped between
// requests: sign-ups run with mail off so every fixture account starts
// UNVERIFIED (asserted), then each leg sets the deployment it measures.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager } from './auth-manager';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import {
  ACCEPT_INVITATION_PATH,
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION,
  refuseUnverifiedAcceptWhileMailIsLive,
} from './invitation-accept-verified-email';
import { ACCEPT_INVITATION_ONE_STEP_PATH } from './invitation-mailbox-proof';
import { LIST_USER_INVITATIONS_PATH } from './list-user-invitations-verification';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const DEFAULT_ORG = 'org_default';
const PARTNER_ORG = 'org_partner';
const PASSWORD = 'S3cure!Passw0rd-34272';
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
 * member). Every account is created with mail NOT live, so unverified.
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

  return { engine, manager, mail, owner, b, c, bInvitation, cInvitation, invite, accept };
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

describe('#34272 — the refusal is the vendor’s own', () => {
  it('the local fallback equals better-auth’s own $ERROR_CODES entry (a vendor rename turns this red)', async () => {
    const { organization } = await import('better-auth/plugins/organization');
    const plugin: any = organization({});
    const vendor = plugin.$ERROR_CODES?.[REFUSAL_CODE];
    expect({ code: vendor?.code, message: vendor?.message }).toEqual(EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION);
  });

  it('PREMISE (measured): the vendor’s own accept route still lets an unverified session through with the option declared false', async () => {
    // The vendor gate this module stands beside is the declared option; with
    // it `false` the vendor never asks. If an upstream release starts asking
    // on its own, this leg and the no-mail legs below disagree and say so.
    const { b, bInvitation, accept, engine } = await boot();
    const res = await answerOf(await accept(bInvitation.id, { cookie: b.cookie }));
    expect(res.status, res.text).toBe(200);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(1);
  });
});

describe('#34272 — while mail is live, an unverified session may not accept', () => {
  it('the reported hole: an unverified invitee is refused 403 with the vendor’s code, and nothing is written', async () => {
    const { engine, manager, mail, b, bInvitation, accept } = await boot();
    manager.setEmailService(mail.service as never);
    mail.state.mode = 'live';

    const res = await answerOf(await accept(bInvitation.id, { cookie: b.cookie }));
    expect(res.status, res.text).toBe(403);
    expect(res.body).toMatchObject(EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(0);
    expect(invitationRow(engine, bInvitation.id)?.status).toBe('pending');
  });

  it('a bearer-token session is refused alike', async () => {
    const { engine, manager, mail, b, bInvitation, accept } = await boot();
    expect(b.bearer, 'sign-up handed out no bearer token').toBeTruthy();
    manager.setEmailService(mail.service as never);
    mail.state.mode = 'live';

    const res = await answerOf(await accept(bInvitation.id, { bearer: b.bearer }));
    expect(res.status, res.text).toBe(403);
    expect(res.body?.code).toBe(REFUSAL_CODE);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(0);
  });

  it('once the address is verified, the same invitation is accepted', async () => {
    const { engine, manager, mail, b, bInvitation, accept } = await boot();
    manager.setEmailService(mail.service as never);
    mail.state.mode = 'live';
    expect((await accept(bInvitation.id, { cookie: b.cookie })).status).toBe(403);

    userRow(engine, 'b@example.com')!.email_verified = true;
    // A fresh sign-in, as after following the verification link.
    const signIn = await request(manager, 'POST', '/sign-in/email', {
      body: { email: 'b@example.com', password: PASSWORD },
    });
    expect(signIn.status, await signIn.clone().text()).toBe(200);

    const res = await answerOf(await accept(bInvitation.id, { cookie: cookieFrom(signIn) }));
    expect(res.status, res.text).toBe(200);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(1);
    expect(invitationRow(engine, bInvitation.id)?.status).toBe('accepted');
  });

  it('ORDER PIN: a session that is not the recipient still gets the vendor’s recipient refusal, not this one', async () => {
    const { manager, mail, c, bInvitation, accept } = await boot();
    manager.setEmailService(mail.service as never);
    mail.state.mode = 'live';

    const res = await answerOf(await accept(bInvitation.id, { cookie: c.cookie }));
    expect(res.status, res.text).toBe(403);
    expect(res.body?.code).toBe('YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION');
  });

  it('ONLY ACCEPT: the same unverified invitee still reads, lists and declines', async () => {
    const { engine, manager, mail, b, bInvitation } = await boot();
    manager.setEmailService(mail.service as never);
    mail.state.mode = 'live';

    const got = await request(manager, 'GET', `/organization/get-invitation?id=${bInvitation.id}`, { cookie: b.cookie });
    expect(got.status, await got.clone().text()).toBe(200);

    const listed = await request(manager, 'GET', LIST_USER_INVITATIONS_PATH, { cookie: b.cookie });
    expect(listed.status, await listed.clone().text()).toBe(200);
    expect(((await listed.json()) as any[]).map((i) => i.id)).toContain(bInvitation.id);

    const rejected = await request(manager, 'POST', '/organization/reject-invitation', {
      body: { invitationId: bInvitation.id },
      cookie: b.cookie,
    });
    expect(rejected.status, await rejected.clone().text()).toBe(200);
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

describe('#34272 — while mail is not live, accept is unchanged', () => {
  it('no email service at all: the unverified invitee accepts', async () => {
    const { engine, b, bInvitation, accept } = await boot();
    const res = await answerOf(await accept(bInvitation.id, { cookie: b.cookie }));
    expect(res.status, res.text).toBe(200);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(1);
  });

  it('a log transport (isConfigured() false): the unverified invitee accepts', async () => {
    const { engine, manager, mail, b, bInvitation, accept } = await boot();
    manager.setEmailService(mail.service as never);
    mail.state.mode = 'log';
    const res = await answerOf(await accept(bInvitation.id, { cookie: b.cookie }));
    expect(res.status, res.text).toBe(200);
    expect(membersOf(engine, PARTNER_ORG, b.userId)).toHaveLength(1);
  });

  it('read per request: mail going live between two requests closes the door for the next one', async () => {
    const { engine, manager, mail, b, c, bInvitation, cInvitation, accept } = await boot();
    manager.setEmailService(mail.service as never);
    mail.state.mode = 'live';
    expect((await accept(bInvitation.id, { cookie: b.cookie })).status).toBe(403);
    mail.state.mode = 'log';
    expect((await accept(bInvitation.id, { cookie: b.cookie })).status).toBe(200);
    mail.state.mode = 'live';
    expect((await accept(cInvitation.id, { cookie: c.cookie })).status).toBe(403);
    expect(membersOf(engine, PARTNER_ORG, c.userId)).toHaveLength(0);
  });
});

describe('#34272 — refuseUnverifiedAcceptWhileMailIsLive', () => {
  it('a verified user passes without asking whether mail is live', async () => {
    const isEmailDeliveryLive = vi.fn(() => true);
    await expect(refuseUnverifiedAcceptWhileMailIsLive({ emailVerified: true }, { isEmailDeliveryLive })).resolves.toBeUndefined();
    expect(isEmailDeliveryLive).not.toHaveBeenCalled();
  });

  it('an unverified user passes while mail is not live', async () => {
    await expect(
      refuseUnverifiedAcceptWhileMailIsLive({ emailVerified: false }, { isEmailDeliveryLive: () => false }),
    ).resolves.toBeUndefined();
  });

  it('an unverified (or unknown) user is refused while mail is live, with the entry the caller hands in', async () => {
    for (const user of [{ emailVerified: false }, {}, null, undefined]) {
      await expect(
        refuseUnverifiedAcceptWhileMailIsLive(user, { isEmailDeliveryLive: () => true }),
      ).rejects.toMatchObject({ statusCode: 403, body: { code: REFUSAL_CODE } });
    }
    const vendorEntry = { code: REFUSAL_CODE, message: 'vendor sentence' };
    await expect(
      refuseUnverifiedAcceptWhileMailIsLive(
        { emailVerified: false },
        { isEmailDeliveryLive: () => true, verificationRequired: vendorEntry },
      ),
    ).rejects.toMatchObject({ body: { message: 'vendor sentence' } });
  });
});
