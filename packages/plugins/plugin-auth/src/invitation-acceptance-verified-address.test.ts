// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Accepting, declining and listing an organization invitation require a
 * verified email address, on every deployment; reading one stays open.
 *
 * A password account verifies by the mail round trip; an account a social
 * provider made counts only when the provider verified the address. Holding
 * the invitation's id, which its accept link and its copied link carry,
 * proves nothing about the mailbox — and, under `invite_only`, a sign-up
 * admitted by the id it presents is not bound into the deployment's
 * organization while its address is unverified.
 *
 * The real `AuthManager` over a real driver (`@objectstack/driver-sql` on
 * better-sqlite3 `:memory:`, plugin-auth's own identity objects), driven
 * through `AuthManager.handleRequest` at every door: the vendor's accept,
 * decline, read and listing routes, and the one-step door
 * (`invitation-mailbox-proof.ts`). Unless a case says otherwise the invitation
 * is into an organization that is not the deployment's default one, so a
 * membership in it can only come from an acceptance.
 */

import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { SIGN_UP_INVITATION_ID_FIELD } from './presented-invitation.js';
import { operatorProvisioningField } from './audience-gate-test-support';
import { ACCEPT_INVITATION_ONE_STEP_PATH } from './invitation-mailbox-proof.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-verified-accept';
const PASSWORD = 'S3cure!Passw0rd-verified-accept';
const SYSTEM = { context: { isSystem: true } } as never;
const DEFAULT_ORG = 'org_default';
const PARTNER_ORG = 'org_partner';
const OWNER = 'owner@acme.example';
const INVITEE = 'invitee@acme.example';

/** The vendor's refusal codes for a session whose address is not verified. */
const ACCEPT_OR_DECLINE_REFUSED = 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION';
const LIST_REFUSED = 'EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION';

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

interface SentMail {
  template: string;
  to: string | { address: string };
  data: Record<string, any>;
  deliverOnlyData?: Record<string, any>;
}

/** What the social provider asserts about the person signing in. */
let providerProfile: { sub: string; email: string; email_verified: boolean } | null = null;

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default', slug: 'default' }, SYSTEM);
  await engine.insert('sys_organization', { id: PARTNER_ORG, name: 'Partner', slug: 'partner' }, SYSTEM);
  return engine;
}

const singleTenancy = () =>
  ({
    posture: 'single',
    requestedPosture: 'single',
    isolationActive: false,
    requested: false,
    degraded: false,
    defaultOrgId: async () => DEFAULT_ORG,
  }) as never;

/**
 * The deployment's mail transport: `live` (`isConfigured()` true), `log`
 * (false), `none` (no email service), `unknown` (a service with no
 * `isConfigured`) and `throws` (one whose `isConfigured` throws).
 */
type MailState = 'live' | 'log' | 'none' | 'unknown' | 'throws';

function makeManager(engine: ObjectQL, sent: SentMail[], config: Record<string, unknown> = {}, mail: MailState = 'live'): AuthManager {
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    membershipPolicy: 'auto',
    getTenancy: singleTenancy,
    socialProviders: {
      google: {
        clientId: 'google-client',
        clientSecret: 'google-secret',
        // The id token is synthetic: the profile is the one the test sets.
        verifyIdToken: async () => true,
        getUserInfo: async () =>
          providerProfile
            ? {
                user: {
                  id: providerProfile.sub,
                  email: providerProfile.email,
                  emailVerified: providerProfile.email_verified,
                  name: 'Social Person',
                },
                data: { ...providerProfile },
              }
            : null,
      },
    },
    ...config,
  } as never);
  if (mail === 'none') return manager;
  const sendTemplate = async (input: SentMail) => {
    sent.push(input);
    return { id: `mail_${sent.length}`, status: 'sent' };
  };
  const isConfigured =
    mail === 'live' ? () => true
      : mail === 'log' ? () => false
        : mail === 'throws' ? () => { throw new Error('transport state unreadable'); }
          : undefined;
  manager.setEmailService({ sendTemplate, ...(isConfigured ? { isConfigured } : {}) } as never);
  return manager;
}

const cookieFrom = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

function send(manager: AuthManager, method: 'GET' | 'POST', path: string, body?: unknown, cookie?: string) {
  return manager.handleRequest(
    new Request(path.startsWith('http') ? path : `${AUTH}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

async function rows(engine: ObjectQL, object: string, where: Record<string, unknown> = {}) {
  const found = await engine.find(object, { where, limit: 100 }, SYSTEM);
  return (Array.isArray(found) ? found : []) as Array<Record<string, unknown>>;
}

/** Status and code of a refusal, in either envelope. */
async function verdict(res: Response): Promise<{ status: number; code?: unknown }> {
  const body = (await res.clone().json().catch(() => ({}))) as { code?: unknown; error?: { code?: unknown } };
  return { status: res.status, code: body?.error?.code ?? body?.code };
}

/**
 * A deployment whose first account owns the partner organization (and the
 * default one) and has invited {@link INVITEE} as `admin` into `into`.
 * `config` reaches the manager that serves every request; `mail` is its mail
 * transport.
 */
async function deployment(
  config: Record<string, unknown> = {},
  { mail = 'live', into = PARTNER_ORG }: { mail?: MailState; into?: string } = {},
) {
  const engine = await bootEngine();
  const sent: SentMail[] = [];
  const manager = makeManager(engine, sent, config, mail);
  const first = await send(manager, 'POST', '/sign-up/email', { email: OWNER, password: PASSWORD, name: 'Owner' });
  expect(first.status, `the first account enters without an invitation: ${await first.clone().text()}`).toBe(200);
  const [owner] = await rows(engine, 'sys_user', { email: OWNER });
  await engine.update('sys_user', { id: owner.id, email_verified: true } as never, SYSTEM);
  const signIn = await send(manager, 'POST', '/sign-in/email', { email: OWNER, password: PASSWORD });
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  const ownerCookie = cookieFrom(signIn);
  const [ownerDefault] = await rows(engine, 'sys_member', { user_id: owner.id, organization_id: DEFAULT_ORG });
  expect(ownerDefault, 'the first account is bound to the default organization').toBeDefined();
  await engine.update('sys_member', { id: ownerDefault.id, role: 'owner' } as never, SYSTEM);
  await engine.insert(
    'sys_member',
    { id: 'mem_owner_partner', organization_id: PARTNER_ORG, user_id: owner.id, role: 'owner', created_at: new Date() },
    SYSTEM,
  );
  const invited = await send(
    manager,
    'POST',
    '/organization/invite-member',
    { email: INVITEE, role: 'admin', organizationId: into },
    ownerCookie,
  );
  expect(invited.status, await invited.clone().text()).toBe(200);
  const invitationId = String(((await invited.json()) as { id: unknown }).id);
  const invitation = async () => (await rows(engine, 'sys_invitation', { id: invitationId }))[0];
  const membershipsIn = async (organizationId: string) => {
    const [user] = await rows(engine, 'sys_user', { email: INVITEE });
    return user ? rows(engine, 'sys_member', { user_id: user.id, organization_id: organizationId }) : [];
  };
  const allMemberships = async () => {
    const [user] = await rows(engine, 'sys_user', { email: INVITEE });
    return user ? rows(engine, 'sys_member', { user_id: user.id }) : [];
  };
  const inviteeRow = async () => (await rows(engine, 'sys_user', { email: INVITEE }))[0];
  return { engine, manager, sent, into, invitationId, invitation, membershipsIn, allMemberships, inviteeRow };
}

type Deployment = Awaited<ReturnType<typeof deployment>>;

/** The invitee signs up presenting the invitation's id, and never verifies. */
async function unverifiedPasswordSession(d: Deployment): Promise<string> {
  const res = await send(d.manager, 'POST', '/sign-up/email', {
    email: INVITEE,
    password: PASSWORD,
    name: 'Invitee',
    [SIGN_UP_INVITATION_ID_FIELD]: d.invitationId,
  });
  expect(res.status, await res.clone().text()).toBe(200);
  expect(Boolean((await d.inviteeRow())?.email_verified)).toBe(false);
  const cookie = cookieFrom(res);
  expect(cookie, 'the unverified sign-up is signed in').not.toBe('');
  return cookie;
}

/** The invitee signs in through the social provider, which asserts the address. */
async function socialSession(d: Deployment, verified: boolean): Promise<string> {
  providerProfile = { sub: `google-${verified ? 'v' : 'u'}`, email: INVITEE, email_verified: verified };
  const res = await send(d.manager, 'POST', '/sign-in/social', { provider: 'google', idToken: { token: 'synthetic' } });
  expect(res.status, await res.clone().text()).toBe(200);
  expect(Boolean((await d.inviteeRow())?.email_verified)).toBe(verified);
  const cookie = cookieFrom(res);
  expect(cookie, 'the social sign-in is signed in').not.toBe('');
  return cookie;
}


/** The answer the one-step door gives a signed-in session (no proof). */
async function oneStepAnswer(d: Deployment, cookie: string): Promise<unknown> {
  const res = await send(d.manager, 'POST', ACCEPT_INVITATION_ONE_STEP_PATH, { invitationId: d.invitationId }, cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { data: unknown }).data;
}

/**
 * The session is refused at accept, decline and the listing, and the one-step
 * door asks it to verify; reading the invitation still answers. The invitation
 * stays pending and no membership is written in the invited organization.
 */
async function expectAnswerRefusedReadOpen(d: Deployment, cookie: string) {
  const accept = await send(d.manager, 'POST', '/organization/accept-invitation', { invitationId: d.invitationId }, cookie);
  expect(await verdict(accept), await accept.clone().text()).toEqual({ status: 403, code: ACCEPT_OR_DECLINE_REFUSED });

  expect(await oneStepAnswer(d, cookie)).toEqual({ outcome: 'verify_email' });

  const decline = await send(d.manager, 'POST', '/organization/reject-invitation', { invitationId: d.invitationId }, cookie);
  expect(await verdict(decline), await decline.clone().text()).toEqual({ status: 403, code: ACCEPT_OR_DECLINE_REFUSED });

  const list = await send(d.manager, 'GET', '/organization/list-user-invitations', undefined, cookie);
  const listed = await list.clone().text();
  expect(await verdict(list), listed).toEqual({ status: 403, code: LIST_REFUSED });
  expect(listed).not.toContain(d.invitationId);

  const read = await send(d.manager, 'GET', `/organization/get-invitation?id=${d.invitationId}`, undefined, cookie);
  expect(read.status, await read.clone().text()).toBe(200);
  expect(((await read.json()) as { id?: unknown }).id).toBe(d.invitationId);

  expect((await d.invitation())?.status).toBe('pending');
  expect(await d.membershipsIn(d.into)).toEqual([]);
}

/** The listing names the invitation, and the vendor route accepts it with the invited role. */
async function expectAccepted(d: Deployment, cookie: string) {
  const list = await send(d.manager, 'GET', '/organization/list-user-invitations', undefined, cookie);
  expect(list.status, await list.clone().text()).toBe(200);
  expect(((await list.json()) as Array<{ id: unknown }>).map((i) => i.id)).toContain(d.invitationId);

  const accept = await send(d.manager, 'POST', '/organization/accept-invitation', { invitationId: d.invitationId }, cookie);
  expect(accept.status, await accept.clone().text()).toBe(200);
  expect((await d.invitation())?.status).toBe('accepted');
  expect((await d.membershipsIn(d.into)).map((m) => m.role)).toEqual(['admin']);
}

/** The vendor route declines it. */
async function expectDeclined(d: Deployment, cookie: string) {
  const decline = await send(d.manager, 'POST', '/organization/reject-invitation', { invitationId: d.invitationId }, cookie);
  expect(decline.status, await decline.clone().text()).toBe(200);
  expect((await d.invitation())?.status).toBe('rejected');
  expect(await d.membershipsIn(d.into)).toEqual([]);
}

/** Complete the verification mail round trip for the signed-in invitee. */
async function verifyByMail(d: Deployment, cookie: string) {
  const asked = await send(d.manager, 'POST', '/send-verification-email', { email: INVITEE }, cookie);
  expect(asked.status, await asked.clone().text()).toBe(200);
  const mail = [...d.sent].reverse().find((m) => m.template === 'auth.verify_email');
  expect(mail, 'the verification mail was sent').toBeDefined();
  const verified = await send(d.manager, 'GET', String(mail!.data.verificationUrl));
  expect(verified.status, await verified.clone().text()).toBeLessThan(400);
  expect(Boolean((await d.inviteeRow())?.email_verified)).toBe(true);
}

const OPEN = { audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' } };

describe('accepting, declining and listing an invitation require a verified email address; reading it does not', () => {
  it('a password account that never verified its address is refused at accept, decline and the listing, and can read the invitation', async () => {
    const d = await deployment();
    await expectAnswerRefusedReadOpen(d, await unverifiedPasswordSession(d));
  });

  it('a password account accepts once it completes the verification mail round trip', async () => {
    const d = await deployment();
    const cookie = await unverifiedPasswordSession(d);
    await expectAnswerRefusedReadOpen(d, cookie);
    await verifyByMail(d, cookie);
    await expectAccepted(d, cookie);
  });

  it('a password account declines once its address is verified', async () => {
    const d = await deployment();
    const cookie = await unverifiedPasswordSession(d);
    await verifyByMail(d, cookie);
    await expectDeclined(d, cookie);
  });

  it('an account whose social provider asserted the address unverified is refused at accept, decline and the listing', async () => {
    const d = await deployment(OPEN);
    await expectAnswerRefusedReadOpen(d, await socialSession(d, false));
  });

  it('an account whose social provider verified the address accepts', async () => {
    const d = await deployment(OPEN);
    await expectAccepted(d, await socialSession(d, true));
  });

  it('an account whose social provider verified the address declines', async () => {
    const d = await deployment(OPEN);
    await expectDeclined(d, await socialSession(d, true));
  });

  it('the one-step door accepts for a signed-in account only once its address is verified', async () => {
    const d = await deployment(OPEN);
    const cookie = await socialSession(d, false);
    await expectAnswerRefusedReadOpen(d, cookie);

    // The provider now asserts the address verified; the next sign-in records it.
    providerProfile = { sub: 'google-u', email: INVITEE, email_verified: true };
    const again = await send(d.manager, 'POST', '/sign-in/social', { provider: 'google', idToken: { token: 'synthetic' } });
    expect(again.status, await again.clone().text()).toBe(200);
    expect(Boolean((await d.inviteeRow())?.email_verified)).toBe(true);

    expect(await oneStepAnswer(d, cookieFrom(again))).toEqual({ outcome: 'accepted', organizationId: PARTNER_ORG });
    expect((await d.membershipsIn(PARTNER_ORG)).map((m) => m.role)).toEqual(['admin']);
  });

  it('the one-step door accepts with the proof the invitation mail carries, which verifies the address', async () => {
    const d = await deployment();
    const res = await send(d.manager, 'POST', ACCEPT_INVITATION_ONE_STEP_PATH, {
      invitationId: d.invitationId,
      proof: proofFromMail(d),
      name: 'Invitee',
      password: PASSWORD,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ outcome: 'accepted', organizationId: PARTNER_ORG });
    expect(Boolean((await d.inviteeRow())?.email_verified)).toBe(true);
    expect((await d.membershipsIn(PARTNER_ORG)).map((m) => m.role)).toEqual(['admin']);
  });
});

describe('the rule holds whatever the state of the mail transport', () => {
  const states: Array<[MailState, string]> = [
    ['live', 'mail is live'],
    ['log', 'the transport only logs'],
    ['none', 'no email service is wired'],
    ['unknown', 'the email service cannot say whether it delivers'],
    ['throws', 'the email service throws when asked whether it delivers'],
  ];
  for (const [mail, label] of states) {
    it(`${label}: an unverified password account is refused at accept, decline and the listing, and can read the invitation`, async () => {
      const d = await deployment({}, { mail });
      await expectAnswerRefusedReadOpen(d, await unverifiedPasswordSession(d));
    });

    it(`${label}: an unverified social account is refused at accept, decline and the listing`, async () => {
      const d = await deployment(OPEN, { mail });
      await expectAnswerRefusedReadOpen(d, await socialSession(d, false));
    });

    it(`${label}: a verified account accepts`, async () => {
      const d = await deployment(OPEN, { mail });
      await expectAccepted(d, await socialSession(d, true));
    });
  }
});

describe('under invite_only, a sign-up admitted by the invitation it presents joins only by accepting it once verified', () => {
  const sessionOrganization = async (d: Deployment, cookie: string) => {
    const res = await d.manager.handleRequest(new Request(`${AUTH}/get-session`, { headers: { cookie } }));
    const body = (await res.json().catch(() => null)) as { session?: { activeOrganizationId?: unknown } } | null;
    return body?.session?.activeOrganizationId ?? null;
  };

  it('the unverified sign-up holds no membership, not even in the default organization, and its session has no active organization', async () => {
    const d = await deployment({}, { into: DEFAULT_ORG });
    const cookie = await unverifiedPasswordSession(d);
    expect(await d.allMemberships()).toEqual([]);
    expect(await sessionOrganization(d, cookie)).toBeNull();
    await expectAnswerRefusedReadOpen(d, cookie);
    expect(await d.allMemberships()).toEqual([]);
  });

  it('verifying the address binds nothing by itself; accepting the invitation then writes its membership with the invited role', async () => {
    const d = await deployment({}, { into: DEFAULT_ORG });
    const cookie = await unverifiedPasswordSession(d);
    await verifyByMail(d, cookie);
    expect(await d.allMemberships()).toEqual([]);
    await expectAccepted(d, cookie);
    expect((await d.allMemberships()).map((m) => [m.organization_id, m.role])).toEqual([[DEFAULT_ORG, 'admin']]);
  });

  it('the same sign-up with no mail transport holds no membership', async () => {
    const d = await deployment({}, { mail: 'none', into: DEFAULT_ORG });
    await unverifiedPasswordSession(d);
    expect(await d.allMemberships()).toEqual([]);
  });

  it('CONTROL: a sign-up the invitation mail proof verifies is bound to the default organization at creation, and accepts the invited role', async () => {
    // Invited into the partner organization: a default-organization row can
    // only come from the bind at creation, and the partner row only from the
    // acceptance.
    const d = await deployment();
    const res = await send(d.manager, 'POST', ACCEPT_INVITATION_ONE_STEP_PATH, {
      invitationId: d.invitationId,
      proof: proofFromMail(d),
      name: 'Invitee',
      password: PASSWORD,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const held = (await d.allMemberships()).map((m) => [m.organization_id, m.role]).sort();
    expect(held).toEqual([[DEFAULT_ORG, 'member'], [PARTNER_ORG, 'admin']].sort());
  });

  it('CONTROL: an unrelated address an operator provisions while an invitation sign-up is in flight is bound to the default organization', async () => {
    const d = await deployment({}, { into: DEFAULT_ORG });
    const other = 'provisioned@acme.example';
    const [invitee, provisioned] = await Promise.all([
      send(d.manager, 'POST', '/sign-up/email', {
        email: INVITEE, password: PASSWORD, name: 'Invitee', [SIGN_UP_INVITATION_ID_FIELD]: d.invitationId,
      }),
      send(d.manager, 'POST', '/sign-up/email', {
        email: other, password: PASSWORD, name: 'Provisioned', ...operatorProvisioningField(d.manager, other),
      }),
    ]);
    expect(invitee.status, await invitee.clone().text()).toBe(200);
    expect(provisioned.status, await provisioned.clone().text()).toBe(200);
    const [user] = await rows(d.engine, 'sys_user', { email: other });
    expect((await rows(d.engine, 'sys_member', { user_id: user.id })).map((m) => [m.organization_id, m.role])).toEqual([[DEFAULT_ORG, 'member']]);
    expect(await d.allMemberships()).toEqual([]);
  });

  it('CONTROL: the same address, created again through the operator door after an invitation sign-up of it, is bound to the default organization', async () => {
    const d = await deployment({}, { into: DEFAULT_ORG });
    await unverifiedPasswordSession(d);
    expect(await d.allMemberships()).toEqual([]);
    // The invitation sign-up's account is removed, and an operator provisions
    // the address afresh, moments later.
    const first = await d.inviteeRow();
    for (const object of ['sys_session', 'sys_account']) {
      await d.engine.delete(object, { where: { user_id: first.id }, multi: true, context: { isSystem: true } } as never);
    }
    await d.engine.delete('sys_user', { where: { id: first.id }, context: { isSystem: true } } as never);
    expect(await d.inviteeRow()).toBeUndefined();

    const res = await send(d.manager, 'POST', '/sign-up/email', {
      email: INVITEE, password: PASSWORD, name: 'Invitee', ...operatorProvisioningField(d.manager, INVITEE),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await d.allMemberships()).map((m) => [m.organization_id, m.role])).toEqual([[DEFAULT_ORG, 'member']]);
  });

  it('CONTROL: the first account of the deployment is still bound to the default organization', async () => {
    const d = await deployment({}, { into: DEFAULT_ORG });
    const [owner] = await rows(d.engine, 'sys_user', { email: OWNER });
    expect((await rows(d.engine, 'sys_member', { user_id: owner.id, organization_id: DEFAULT_ORG })).length).toBe(1);
  });
});

/** The proof the invitation mail's own link carries. */
function proofFromMail(d: Deployment): string {
  const mail = [...d.sent].reverse().find((m) => m.template === 'auth.invitation');
  const link = String(mail?.deliverOnlyData?.acceptUrl ?? '');
  const match = /#proof=([^&]+)$/.exec(link);
  expect(match, `the invitation mail's link carries the proof: ${link}`).not.toBeNull();
  return decodeURIComponent(match![1]!);
}
