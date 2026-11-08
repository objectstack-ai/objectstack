// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under the `invite_only` audience posture, a self-serve sign-up is admitted
 * only by the invitation it presents (`presented-invitation.ts`).
 *
 * The real `AuthManager` over a real driver: `@objectstack/driver-sql` on
 * better-sqlite3 `:memory:`, plugin-auth's own identity objects, the vendor's
 * own organization plugin, driven through `AuthManager.handleRequest`. The
 * invitations are the ones `/organization/invite-member` writes, so every id
 * here is one the product hands an invitee.
 *
 * Two creation doors are asked of the admission gate directly, with the
 * `{ user, source }` the vendor's `internalAdapter.createUser` hands it: a
 * magic-link creation and an OAuth one. Each reaches that one seam after its
 * own exchange (a mailbox, an identity provider), and the gate is where the
 * rule for each is decided.
 */

import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { signUpEmail } from 'better-auth/api';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { SELF_REGISTRATION_CLOSED } from './audience-posture.js';
import { createCopyInvitationLinkHandler } from './invitation-link-action.js';
import { SIGN_UP_INVITATION_ID_FIELD } from './presented-invitation.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-presented';
const PASSWORD = 'S3cure!Passw0rd-presented';
const SYSTEM = { context: { isSystem: true } } as never;
const ORG = 'org_acme';

const OWNER = 'owner@acme.example';
const INVITEE = 'invitee@acme.example';
const STRANGER = 'stranger@acme.example';

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
  await engine.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme' }, SYSTEM);
  return engine;
}

const singleTenancy = () =>
  ({
    posture: 'single',
    requestedPosture: 'single',
    isolationActive: false,
    requested: false,
    degraded: false,
    defaultOrgId: async () => ORG,
  }) as never;

function makeManager(engine: ObjectQL, config: Record<string, unknown> = {}): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    membershipPolicy: 'auto',
    getTenancy: singleTenancy,
    ...config,
  } as never);
}

const cookieFrom = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

function send(manager: AuthManager, method: 'GET' | 'POST', path: string, body?: unknown, cookie?: string) {
  return manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

const signUp = (manager: AuthManager, email: string, extra: Record<string, unknown> = {}) =>
  send(manager, 'POST', '/sign-up/email', { email, password: PASSWORD, name: email.split('@')[0], ...extra });

async function rows(engine: ObjectQL, object: string, where: Record<string, unknown> = {}) {
  const found = await engine.find(object, { where, limit: 100 }, SYSTEM);
  return (Array.isArray(found) ? found : []) as Array<Record<string, unknown>>;
}

/** Status, code and message of a refusal, in either envelope. */
async function verdict(res: Response): Promise<{ status: number; code?: unknown; message?: unknown }> {
  const body = (await res.clone().json().catch(() => ({}))) as {
    code?: unknown;
    message?: unknown;
    error?: { code?: unknown; message?: unknown };
  };
  return { status: res.status, code: body?.error?.code ?? body?.code, message: body?.error?.message ?? body?.message };
}

/**
 * A deployment with its first account (the organization's owner) and one
 * pending invitation written by `/organization/invite-member`.
 */
async function deployment(config: Record<string, unknown> = {}) {
  const engine = await bootEngine();
  const manager = makeManager(engine, config);
  const first = await signUp(manager, OWNER);
  expect(first.status, `the first account enters without an invitation: ${await first.clone().text()}`).toBe(200);
  const ownerCookie = cookieFrom(first);
  const [owner] = await rows(engine, 'sys_user', { email: OWNER });
  const [membership] = await rows(engine, 'sys_member', { user_id: owner.id });
  expect(membership, 'the reconciler bound the first account to the organization').toBeDefined();
  await engine.update('sys_member', { id: membership.id, role: 'owner' } as never, SYSTEM);
  const invite = async (email: string, role = 'member') => {
    const res = await send(manager, 'POST', '/organization/invite-member', { email, role, organizationId: ORG }, ownerCookie);
    expect(res.status, `invite ${email}: ${await res.clone().text()}`).toBe(200);
    return String(((await res.json()) as { id: unknown }).id);
  };
  return { engine, manager, ownerId: String(owner.id), ownerCookie, invite };
}

describe('under invite_only, a self-serve sign-up is admitted only by the invitation it presents', () => {
  it('admits the sign-up that presents its invitation, and the invitee accepts it with the invited role', async () => {
    const d = await deployment();
    const invitationId = await d.invite(INVITEE, 'admin');

    const res = await signUp(d.manager, INVITEE, { [SIGN_UP_INVITATION_ID_FIELD]: invitationId });
    expect(res.status, await res.clone().text()).toBe(200);
    const [invitee] = await rows(d.engine, 'sys_user', { email: INVITEE });
    expect(invitee).toBeDefined();
    // The presented id never becomes a column of the account.
    expect(Object.keys(invitee)).not.toContain(SIGN_UP_INVITATION_ID_FIELD);

    const accept = await send(d.manager, 'POST', '/organization/accept-invitation', { invitationId }, cookieFrom(res));
    expect(accept.status, await accept.clone().text()).toBe(200);
    const members = await rows(d.engine, 'sys_member', { user_id: invitee.id, organization_id: ORG });
    expect(members.map((m) => m.role)).toEqual(['admin']);
  });

  it('admits the first account and the boot command seed without an invitation', async () => {
    // The first account is `deployment()`'s own sign-up; the seed is the
    // deployment's operator class, the one in-process door.
    const d = await deployment();
    const seed = 'seeded.admin@acme.example';
    const ticket = d.manager.stageOperatorProvisioning(seed);
    try {
      const res = await signUp(d.manager, seed, { [AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD]: ticket });
      expect(res.status, await res.clone().text()).toBe(200);
    } finally {
      d.manager.clearOperatorProvisioning(seed);
    }
    expect(await rows(d.engine, 'sys_user', { email: seed })).toHaveLength(1);
  });

  it('refuses an address alone, a wrong, expired, non-pending or another address\'s invitation alike, and writes nothing', async () => {
    const d = await deployment();
    const pendingId = await d.invite(INVITEE);
    const expiredId = await d.invite('expired@acme.example');
    await d.engine.update('sys_invitation', { id: expiredId, expires_at: new Date(Date.now() - 60_000) } as never, SYSTEM);
    const canceledId = await d.invite('canceled@acme.example');
    const cancel = await send(d.manager, 'POST', '/organization/cancel-invitation', { invitationId: canceledId }, d.ownerCookie);
    expect(cancel.status, await cancel.clone().text()).toBe(200);
    expect((await rows(d.engine, 'sys_invitation', { id: canceledId }))[0]?.status).toBe('canceled');
    const usersBefore = (await rows(d.engine, 'sys_user')).length;
    const accountsBefore = (await rows(d.engine, 'sys_account')).length;
    const membersBefore = (await rows(d.engine, 'sys_member')).length;

    const cases: Array<[string, string, Record<string, unknown>]> = [
      ['an address with no invitation', 'nobody@acme.example', {}],
      ['an invited address alone', INVITEE, {}],
      ['an id no invitation carries', INVITEE, { invitationId: 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp' }],
      ['an expired invitation', 'expired@acme.example', { invitationId: expiredId }],
      ['an invitation that is no longer pending', 'canceled@acme.example', { invitationId: canceledId }],
      ["another address's invitation", STRANGER, { invitationId: pendingId }],
      ['an invitation id that is not a string', INVITEE, { invitationId: [pendingId] }],
      ['an empty invitation id', INVITEE, { invitationId: '' }],
    ];
    const answers = [];
    for (const [label, email, extra] of cases) {
      const res = await signUp(d.manager, email, extra);
      answers.push({ label, ...(await verdict(res)), text: await res.text() });
    }

    for (const answer of answers) {
      expect(answer.status, answer.label).toBe(403);
      expect(answer.code, answer.label).toBe(SELF_REGISTRATION_CLOSED);
      // One answer for every case: the message and the whole body are the
      // uninvited one, so the refusal says nothing about any invitation.
      expect(answer.message, answer.label).toBe(answers[0].message);
      expect(answer.text, answer.label).toBe(answers[0].text);
    }
    expect((await rows(d.engine, 'sys_user')).length).toBe(usersBefore);
    expect((await rows(d.engine, 'sys_account')).length).toBe(accountsBefore);
    expect((await rows(d.engine, 'sys_member')).length).toBe(membersBefore);
  });

  it("matches the presented invitation's address with both sides trimmed and lowercased", async () => {
    const d = await deployment();
    const invitationId = await d.invite(INVITEE);
    const res = await signUp(d.manager, 'Invitee@ACME.example', { invitationId });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('the invitee still signs up with the link after a stranger tried the address alone, and accepts', async () => {
    const d = await deployment();
    const invitationId = await d.invite(INVITEE);

    const stranger = await signUp(d.manager, INVITEE);
    expect(await verdict(stranger)).toMatchObject({ status: 403, code: SELF_REGISTRATION_CLOSED });
    expect(await rows(d.engine, 'sys_user', { email: INVITEE })).toEqual([]);

    const invitee = await signUp(d.manager, INVITEE, { invitationId });
    expect(invitee.status, await invitee.clone().text()).toBe(200);
    const accept = await send(d.manager, 'POST', '/organization/accept-invitation', { invitationId }, cookieFrom(invitee));
    expect(accept.status, await accept.clone().text()).toBe(200);
    expect((await rows(d.engine, 'sys_invitation', { id: invitationId }))[0]?.status).toBe('accepted');
  });

  it('a copied invitation link carries the id that admits the invitee', async () => {
    const d = await deployment();
    const invitationId = await d.invite(INVITEE);
    const copy = createCopyInvitationLinkHandler({
      engine: d.engine as never,
      consoleUrl: (path) => d.manager.getConsoleUrl(path),
    });
    const { acceptUrl } = await copy({ params: { recordId: invitationId }, session: { userId: d.ownerId } });
    const path = new URL(acceptUrl).pathname;
    expect(path).toMatch(/\/accept-invitation\/[^/]+$/);
    const presented = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));

    const res = await signUp(d.manager, INVITEE, { invitationId: presented });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('a pending invitation lists in the session it admitted, its own and another organization\'s alike', async () => {
    const d = await deployment();
    const invitationId = await d.invite(INVITEE);
    await d.engine.insert('sys_organization', { id: 'org_partner', name: 'Partner', slug: 'partner' }, SYSTEM);
    await d.engine.insert(
      'sys_invitation',
      {
        id: 'inv_partner_presented',
        email: INVITEE,
        status: 'pending',
        organization_id: 'org_partner',
        role: 'member',
        inviter_id: d.ownerId,
        expires_at: new Date(Date.now() + 3_600_000),
      },
      SYSTEM,
    );
    const invitee = await signUp(d.manager, INVITEE, { invitationId });
    expect(invitee.status, await invitee.clone().text()).toBe(200);

    const listed = await send(d.manager, 'GET', '/organization/list-user-invitations', undefined, cookieFrom(invitee));
    expect(listed.status, await listed.clone().text()).toBe(200);
    const ids = ((await listed.json()) as Array<{ id: string }>).map((i) => i.id).sort();
    expect(ids).toEqual([invitationId, 'inv_partner_presented'].sort());
  });

  it('an invitation id is 32 characters of [a-zA-Z0-9], and two invitations never share one', async () => {
    const d = await deployment();
    const first = await d.invite(INVITEE);
    const second = await d.invite(STRANGER);
    for (const id of [first, second]) expect(id).toMatch(/^[a-zA-Z0-9]{32}$/);
    expect(first).not.toBe(second);
  });

  it('the vendor sign-up body keeps a key it does not declare, which is how the id reaches the gate', () => {
    const body = (signUpEmail() as unknown as { options: { body: { safeParse(v: unknown): { success: boolean; data?: any } } } })
      .options.body;
    const parsed = body.safeParse({ name: 'n', email: 'n@acme.example', password: PASSWORD, invitationId: 'kept' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.invitationId).toBe('kept');
  });
});

describe('under invite_only, the other creation doors', () => {
  const gate = (manager: AuthManager, user: Record<string, unknown>, source: Record<string, unknown>) =>
    (manager as unknown as {
      validateAudienceAdmission(data: unknown, ctx?: unknown): Promise<{ error: string } | undefined>;
    }).validateAudienceAdmission({ user, source: { action: 'create-user', ...source } }, { body: {} });

  it('a magic-link creation is admitted by a pending invitation addressed to it', async () => {
    const d = await deployment();
    await d.invite(INVITEE);
    expect(await gate(d.manager, { email: INVITEE }, { method: 'magic-link' })).toBeUndefined();
    expect((await gate(d.manager, { email: STRANGER }, { method: 'magic-link' }))?.error).toBe(SELF_REGISTRATION_CLOSED);
  });

  it('an OAuth creation is admitted by its invitation only when the identity provider verified the address', async () => {
    const d = await deployment();
    await d.invite(INVITEE);
    const oauth = { method: 'oauth', oauth: { providerId: 'github' } };
    expect((await gate(d.manager, { email: INVITEE, emailVerified: false }, oauth))?.error).toBe(SELF_REGISTRATION_CLOSED);
    expect((await gate(d.manager, { email: INVITEE }, oauth))?.error).toBe(SELF_REGISTRATION_CLOSED);
    expect(await gate(d.manager, { email: INVITEE, emailVerified: true }, oauth)).toBeUndefined();
  });
});

describe('open and email_domain match an invitation by address, as before', () => {
  const gate = (manager: AuthManager, email: string) =>
    (manager as unknown as {
      validateAudienceAdmission(data: unknown, ctx?: unknown): Promise<{ error: string } | undefined>;
    }).validateAudienceAdmission(
      { user: { email }, source: { action: 'create-user', method: 'email-password' } },
      { body: {} },
    );

  // Under `open` an uninvited sign-up is admitted WITH the declared set, which
  // this store cannot resolve (it would answer AUTH_CONFIG_ERROR), and under
  // `email_domain` this address is off the list: so `undefined` below can only
  // be the invitation carve-out, matched by address.
  for (const audience of [
    { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
    { posture: 'email_domain', allowedEmailDomains: ['elsewhere.example'], selfRegistrationPermissionSet: 'member_default' },
  ]) {
    it(`${audience.posture}: an email-and-password sign-up holding an invitation is admitted with no id`, async () => {
      const d = await deployment();
      await d.invite(INVITEE);
      const manager = makeManager(d.engine, { audience });
      expect(await gate(manager, INVITEE)).toBeUndefined();
      expect((await gate(manager, STRANGER))?.error).not.toBeUndefined();
    });
  }
});
