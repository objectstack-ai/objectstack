// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Accepting an organization invitation requires a verified email address.
 *
 * A password account verifies by the mail round trip; an account a social
 * provider made counts only when the provider verified the address. Holding
 * the invitation's id, which its accept link and its copied link carry,
 * proves nothing about the mailbox.
 *
 * The real `AuthManager` over a real driver (`@objectstack/driver-sql` on
 * better-sqlite3 `:memory:`, plugin-auth's own identity objects), driven
 * through `AuthManager.handleRequest` at every acceptance door: the vendor's
 * `POST /organization/accept-invitation`, its decline, read and listing
 * siblings, and the one-step door (`invitation-mailbox-proof.ts`). The
 * invitation is into an organization that is not the deployment's default
 * one, so a membership in it can only come from an acceptance.
 */

import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { SIGN_UP_INVITATION_ID_FIELD } from './presented-invitation.js';
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
const READ_OR_LIST_REFUSED = 'EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION';

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

function makeManager(engine: ObjectQL, sent: SentMail[], config: Record<string, unknown> = {}): AuthManager {
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
  manager.setEmailService({
    isConfigured: () => true,
    sendTemplate: async (input: SentMail) => {
      sent.push(input);
      return { id: `mail_${sent.length}`, status: 'sent' };
    },
  } as never);
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
 * A deployment whose first account owns the partner organization and has
 * invited {@link INVITEE} into it as `admin`. `config` reaches the manager
 * that serves every request.
 */
async function deployment(config: Record<string, unknown> = {}) {
  const engine = await bootEngine();
  const sent: SentMail[] = [];
  const manager = makeManager(engine, sent, config);
  const first = await send(manager, 'POST', '/sign-up/email', { email: OWNER, password: PASSWORD, name: 'Owner' });
  expect(first.status, `the first account enters without an invitation: ${await first.clone().text()}`).toBe(200);
  const [owner] = await rows(engine, 'sys_user', { email: OWNER });
  await engine.update('sys_user', { id: owner.id, email_verified: true } as never, SYSTEM);
  const signIn = await send(manager, 'POST', '/sign-in/email', { email: OWNER, password: PASSWORD });
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  const ownerCookie = cookieFrom(signIn);
  await engine.insert(
    'sys_member',
    { id: 'mem_owner_partner', organization_id: PARTNER_ORG, user_id: owner.id, role: 'owner', created_at: new Date() },
    SYSTEM,
  );
  const invited = await send(
    manager,
    'POST',
    '/organization/invite-member',
    { email: INVITEE, role: 'admin', organizationId: PARTNER_ORG },
    ownerCookie,
  );
  expect(invited.status, await invited.clone().text()).toBe(200);
  const invitationId = String(((await invited.json()) as { id: unknown }).id);
  const invitation = async () => (await rows(engine, 'sys_invitation', { id: invitationId }))[0];
  const partnerMembership = async () => {
    const [user] = await rows(engine, 'sys_user', { email: INVITEE });
    return user ? rows(engine, 'sys_member', { user_id: user.id, organization_id: PARTNER_ORG }) : [];
  };
  const inviteeRow = async () => (await rows(engine, 'sys_user', { email: INVITEE }))[0];
  return { engine, manager, sent, invitationId, invitation, partnerMembership, inviteeRow };
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

/** Every door refuses the session, and the invitation stays pending with no membership written. */
async function expectEveryDoorRefuses(d: Deployment, cookie: string) {
  const accept = await send(d.manager, 'POST', '/organization/accept-invitation', { invitationId: d.invitationId }, cookie);
  expect(await verdict(accept), await accept.clone().text()).toEqual({ status: 403, code: ACCEPT_OR_DECLINE_REFUSED });

  const oneStep = await send(d.manager, 'POST', ACCEPT_INVITATION_ONE_STEP_PATH, { invitationId: d.invitationId }, cookie);
  expect(oneStep.status, await oneStep.clone().text()).toBe(200);
  expect(((await oneStep.json()) as { data: unknown }).data).toEqual({ outcome: 'verify_email' });

  const decline = await send(d.manager, 'POST', '/organization/reject-invitation', { invitationId: d.invitationId }, cookie);
  expect(await verdict(decline), await decline.clone().text()).toEqual({ status: 403, code: ACCEPT_OR_DECLINE_REFUSED });

  const read = await send(d.manager, 'GET', `/organization/get-invitation?id=${d.invitationId}`, undefined, cookie);
  expect(await verdict(read), await read.clone().text()).toEqual({ status: 403, code: READ_OR_LIST_REFUSED });

  const list = await send(d.manager, 'GET', '/organization/list-user-invitations', undefined, cookie);
  const listed = await list.clone().text();
  expect(await verdict(list), listed).toEqual({ status: 403, code: READ_OR_LIST_REFUSED });
  expect(listed).not.toContain(d.invitationId);

  expect((await d.invitation())?.status).toBe('pending');
  expect(await d.partnerMembership()).toEqual([]);
}

/** The vendor route accepts for the session, with the invited role. */
async function expectAccepted(d: Deployment, cookie: string) {
  const accept = await send(d.manager, 'POST', '/organization/accept-invitation', { invitationId: d.invitationId }, cookie);
  expect(accept.status, await accept.clone().text()).toBe(200);
  expect((await d.invitation())?.status).toBe('accepted');
  expect((await d.partnerMembership()).map((m) => m.role)).toEqual(['admin']);
}

describe('accepting an organization invitation requires a verified email address', () => {
  it('a password account that never verified its address cannot accept, decline, read or list the invitation at any door', async () => {
    const d = await deployment();
    await expectEveryDoorRefuses(d, await unverifiedPasswordSession(d));
  });

  it('a password account accepts once it completes the verification mail round trip', async () => {
    const d = await deployment();
    const cookie = await unverifiedPasswordSession(d);
    await expectEveryDoorRefuses(d, cookie);

    const asked = await send(d.manager, 'POST', '/send-verification-email', { email: INVITEE }, cookie);
    expect(asked.status, await asked.clone().text()).toBe(200);
    const mail = [...d.sent].reverse().find((m) => m.template === 'auth.verify_email');
    expect(mail, 'the verification mail was sent').toBeDefined();
    const verified = await send(d.manager, 'GET', String(mail!.data.verificationUrl));
    expect(verified.status, await verified.clone().text()).toBeLessThan(400);
    expect(Boolean((await d.inviteeRow())?.email_verified)).toBe(true);

    await expectAccepted(d, cookie);
  });

  it('an account whose social provider asserted the address unverified cannot accept at any door', async () => {
    const d = await deployment({ audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' } });
    await expectEveryDoorRefuses(d, await socialSession(d, false));
  });

  it('an account whose social provider verified the address accepts', async () => {
    const d = await deployment({ audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' } });
    await expectAccepted(d, await socialSession(d, true));
  });

  it('the one-step door accepts for a signed-in account only once its address is verified', async () => {
    const d = await deployment({ audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' } });
    const cookie = await socialSession(d, false);
    await expectEveryDoorRefuses(d, cookie);

    // The provider now asserts the address verified; the next sign-in records it.
    providerProfile = { sub: 'google-u', email: INVITEE, email_verified: true };
    const again = await send(d.manager, 'POST', '/sign-in/social', { provider: 'google', idToken: { token: 'synthetic' } });
    expect(again.status, await again.clone().text()).toBe(200);
    expect(Boolean((await d.inviteeRow())?.email_verified)).toBe(true);

    const oneStep = await send(d.manager, 'POST', ACCEPT_INVITATION_ONE_STEP_PATH, { invitationId: d.invitationId }, cookieFrom(again));
    expect(oneStep.status, await oneStep.clone().text()).toBe(200);
    expect(((await oneStep.json()) as { data: unknown }).data).toEqual({ outcome: 'accepted', organizationId: PARTNER_ORG });
    expect((await d.partnerMembership()).map((m) => m.role)).toEqual(['admin']);
  });

  it('the one-step door accepts with the proof the invitation mail carries, which verifies the address', async () => {
    const d = await deployment();
    const mail = [...d.sent].reverse().find((m) => m.template === 'auth.invitation');
    const link = String(mail?.deliverOnlyData?.acceptUrl ?? '');
    const match = /#proof=([^&]+)$/.exec(link);
    expect(match, `the invitation mail's link carries the proof: ${link}`).not.toBeNull();

    const res = await send(d.manager, 'POST', ACCEPT_INVITATION_ONE_STEP_PATH, {
      invitationId: d.invitationId,
      proof: decodeURIComponent(match![1]!),
      name: 'Invitee',
      password: PASSWORD,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ outcome: 'accepted', organizationId: PARTNER_ORG });
    expect(Boolean((await d.inviteeRow())?.email_verified)).toBe(true);
    expect((await d.partnerMembership()).map((m) => m.role)).toEqual(['admin']);
  });
});
