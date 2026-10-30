// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #27843 (ruling E on #27797) — an invite on a deployment that does not
// deliver mail, the server half. The card's four pins:
//
//  (a) invite-member (invite and resend) answers `outcome: 'link_only'` when
//      the transport does not deliver (no email service, or the `log`
//      transport's `isConfigured() === false`) and `outcome: 'sent'` when it
//      does, read at call time, beside the invitation row; a refusal carries
//      none. The declared `link_only` copy saying nothing about "sent" is
//      pinned beside the metadata (platform-objects
//      `invitation-delivery-copy.test.ts`).
//  (b) `sys_invitation.copy_invitation_link` answers the very URL the
//      invitation mail carries for the same invitation, the canonical origin
//      and the Console mount `uiBasePath` included.
//  (c) the action is refused for a caller outside the invite reach and for a
//      non-pending row.
//  (d) the action is refused while the environment is cloud-managed (the
//      declaration hides it there too, pinned in platform-objects).
//
// Every invitation is issued, resent, canceled and accepted through the
// vendor's own routes on a real `AuthManager` over the installed better-auth,
// so the rows the handler reads are the rows the product writes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { resetCloudManagedForTesting } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { CLOUD_MANAGED_REFUSAL_MESSAGES } from './cloud-managed';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import {
  COPY_INVITATION_LINK_ACTION,
  INVITATION_OBJECT,
  createCopyInvitationLinkHandler,
} from './invitation-link-action';
import { AUTH_PLUGIN_ID } from './manifest';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-27843';
// A canonical origin and a Console mount other than the defaults, so the
// link's two composed halves are both measured, not assumed.
const ORIGIN = 'https://crm.acme.test';
const UI_BASE = '/console';
const BASE = '/api/v1/auth';
const DEFAULT_ORG = 'org_default';
const ACME_ORG = 'org_acme';
const MANAGED_ENV = 'OS_CLOUD_MANAGED';

/**
 * A recording email service. `live` is what `isConfigured()` answers, read on
 * every call so a leg can swap it between requests; `'absent'` leaves the
 * member off.
 */
function recordingEmail(initial: boolean | 'absent') {
  const sent: any[] = [];
  const state = { live: initial };
  const service: Record<string, unknown> = {
    async send() { return { id: 'e', status: 'sent' }; },
    async sendTemplate(input: any) {
      sent.push(input);
      return { id: `e${sent.length}`, status: 'sent' };
    },
  };
  if (initial !== 'absent') service.isConfigured = () => state.live === true;
  return { sent, state, service };
}

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

/**
 * One deployment: `Alice Owner` owns `Acme Corp`; Dana is its delegated admin,
 * Mo a plain member, and Olga owns only the default organization.
 */
async function stage() {
  const engine = createMemoryEngine();
  engine.tables.set('sys_organization', [
    { id: DEFAULT_ORG, name: 'Default', slug: 'default' },
    { id: ACME_ORG, name: 'Acme Corp', slug: 'acme' },
  ]);
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    uiBasePath: UI_BASE,
    dataEngine: engine as any,
    membershipPolicy: 'auto',
    getTenancy: () => singleOrgTenancy(),
  } as any);

  const direct = (method: 'GET' | 'POST', path: string, body?: unknown, cookie?: string) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
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
  const bind = (userId: string, organizationId: string, role: string) =>
    engine.insert('sys_member', {
      id: `mem_${userId}_${organizationId}`,
      organization_id: organizationId,
      user_id: userId,
      role,
      created_at: new Date(),
    });

  const owner = await signUp('alice.owner@example.com', 'Alice Owner');
  const ownerDefault = (engine.tables.get('sys_member') ?? []).find(
    (m: any) => m.organization_id === DEFAULT_ORG && m.user_id === owner.userId,
  );
  expect(ownerDefault, 'the reconciler did not bind the owner to the default organization').toBeDefined();
  ownerDefault!.role = 'owner';
  await bind(owner.userId, ACME_ORG, 'owner');
  const delegate = await signUp('dana.delegate@example.com', 'Dana Delegate');
  await bind(delegate.userId, ACME_ORG, 'delegated_admin');
  const member = await signUp('mo.member@example.com', 'Mo Member');
  await bind(member.userId, ACME_ORG, 'member');
  const outsider = await signUp('olga.outsider@example.com', 'Olga Outsider');

  /** Invite (or resend) through the vendor's own route, as the owner. */
  const invite = async (email: string, extra: Record<string, unknown> = {}) => {
    const res = await direct(
      'POST',
      '/organization/invite-member',
      { email, role: 'member', organizationId: ACME_ORG, ...extra },
      owner.cookie,
    );
    const text = await res.clone().text();
    return { status: res.status, body: JSON.parse(text), text };
  };

  const handler = createCopyInvitationLinkHandler({
    engine: engine as any,
    consoleUrl: (path) => manager.getConsoleUrl(path),
  });
  /** The platform action door's context for the handler: the caller's session, the row's id. */
  const copyLink = (invitationId: string, callerId: string | undefined) =>
    handler({
      record: { id: invitationId },
      session: callerId ? { userId: callerId } : undefined,
      params: { recordId: invitationId, objectName: INVITATION_OBJECT },
    });

  const invitationRow = (id: string) =>
    (engine.tables.get('sys_invitation') ?? []).find((r: any) => r.id === id) as Record<string, any>;

  return { engine, manager, direct, signUp, invite, owner, delegate, member, outsider, copyLink, invitationRow };
}

/** A handler refusal's status and ADR-0112 code. */
async function refusalOf(call: Promise<unknown>): Promise<{ status: unknown; code: unknown; message: string }> {
  try {
    await call;
  } catch (err: any) {
    return { status: err?.status, code: err?.code, message: String(err?.message) };
  }
  throw new Error('the handler answered instead of refusing');
}

let savedManaged: string | undefined;
beforeEach(() => {
  savedManaged = process.env[MANAGED_ENV];
  delete process.env[MANAGED_ENV];
  resetCloudManagedForTesting();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  if (savedManaged === undefined) delete process.env[MANAGED_ENV];
  else process.env[MANAGED_ENV] = savedManaged;
  resetCloudManagedForTesting();
  vi.restoreAllMocks();
});

describe('#27843 (a) — invite-member answers its delivery outcome', () => {
  it('no email service at all: link_only, beside the invitation row', async () => {
    const { invite } = await stage();
    const answer = await invite('bob.builder@acme.test');
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body.outcome).toBe('link_only');
    // The row the answer already carried is untouched: `{{ result.email }}` keeps reading.
    expect(answer.body.email).toBe('bob.builder@acme.test');
    expect(answer.body.id).toBeTruthy();
  });

  it('the log transport (isConfigured() false) is not delivery: link_only, and no mail was handed over', async () => {
    const { manager, invite } = await stage();
    const email = recordingEmail(false);
    manager.setEmailService(email.service as never);
    const answer = await invite('bob.builder@acme.test');
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body.outcome).toBe('link_only');
  });

  it('an email service without isConfigured() is unknown, so not delivery: link_only', async () => {
    const { manager, invite } = await stage();
    manager.setEmailService(recordingEmail('absent').service as never);
    expect((await invite('bob.builder@acme.test')).body.outcome).toBe('link_only');
  });

  it('a configured transport: sent, and the mail went out', async () => {
    const { manager, invite } = await stage();
    const email = recordingEmail(true);
    manager.setEmailService(email.service as never);
    const answer = await invite('bob.builder@acme.test');
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body.outcome).toBe('sent');
    expect(email.sent.map((m) => m.template)).toEqual(['auth.invitation']);
  });

  it('a resend answers it too, by the transport at call time', async () => {
    const { manager, invite } = await stage();
    const email = recordingEmail(false);
    manager.setEmailService(email.service as never);
    const first = await invite('bob.builder@acme.test');
    expect(first.body.outcome).toBe('link_only');

    email.state.live = true;
    const resent = await invite('bob.builder@acme.test', { resend: true });
    expect(resent.status, resent.text).toBe(200);
    expect(resent.body.id).toBe(first.body.id);
    expect(resent.body.outcome).toBe('sent');

    email.state.live = false;
    expect((await invite('bob.builder@acme.test', { resend: true })).body.outcome).toBe('link_only');
  });

  it('a refusal carries no outcome (the unknown-role refusal keeps its code)', async () => {
    const { invite } = await stage();
    const refused = await invite('bob.builder@acme.test', { role: 'no_such_role' });
    expect(refused.status, refused.text).toBe(400);
    expect(refused.body.code).toBe('ROLE_NOT_FOUND');
    expect(refused.body).not.toHaveProperty('outcome');
  });
});

describe('#27843 (b) — copy_invitation_link answers the link the mail carries', () => {
  it('the same URL, canonical origin and Console mount included', async () => {
    const { manager, invite, owner, copyLink } = await stage();
    const email = recordingEmail(true);
    manager.setEmailService(email.service as never);
    const { body } = await invite('bob.builder@acme.test');
    const mailed = email.sent[0]?.data?.acceptUrl;
    expect(mailed, 'the invitation mail carries an accept URL').toBeTruthy();

    const answer = await copyLink(String(body.id), owner.userId);
    expect(answer).toEqual({ acceptUrl: mailed });
    expect(answer.acceptUrl).toBe(`${ORIGIN}${UI_BASE}/accept-invitation/${body.id}`);
  });

  it('never logs the link', async () => {
    const { invite, owner, copyLink } = await stage();
    const { body } = await invite('bob.builder@acme.test');
    const spies = (['info', 'warn', 'error', 'log', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    for (const spy of spies) spy.mockClear();
    const { acceptUrl } = await copyLink(String(body.id), owner.userId);
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(acceptUrl);
    }
  });
});

describe('#27843 (c) — copy_invitation_link is answered only inside the invite reach, on a pending row', () => {
  it('the owner and a delegated admin of the invitation\'s organization are admitted', async () => {
    const { invite, owner, delegate, copyLink } = await stage();
    const { body } = await invite('bob.builder@acme.test');
    const asOwner = await copyLink(String(body.id), owner.userId);
    expect(asOwner.acceptUrl).toContain(`/accept-invitation/${body.id}`);
    expect(await copyLink(String(body.id), delegate.userId)).toEqual(asOwner);
  });

  it('a plain member of the organization is refused 403 PERMISSION_DENIED', async () => {
    const { invite, member, copyLink } = await stage();
    const { body } = await invite('bob.builder@acme.test');
    const v = await refusalOf(copyLink(String(body.id), member.userId));
    expect([v.status, v.code]).toEqual([403, 'PERMISSION_DENIED']);
  });

  it('an owner of ANOTHER organization is refused 403: reach is the invitation\'s own organization', async () => {
    const { invite, outsider, copyLink } = await stage();
    const { body } = await invite('bob.builder@acme.test');
    const v = await refusalOf(copyLink(String(body.id), outsider.userId));
    expect([v.status, v.code]).toEqual([403, 'PERMISSION_DENIED']);
  });

  it('a caller with no session is refused 401', async () => {
    const { invite, copyLink } = await stage();
    const { body } = await invite('bob.builder@acme.test');
    const v = await refusalOf(copyLink(String(body.id), undefined));
    expect([v.status, v.code]).toEqual([401, 'UNAUTHENTICATED']);
  });

  it('a canceled invitation is refused 409, and so is an accepted one', async () => {
    const { direct, invite, owner, signUp, copyLink, invitationRow } = await stage();
    const canceled = (await invite('carl.canceled@acme.test')).body.id as string;
    const cancelRes = await direct('POST', '/organization/cancel-invitation', { invitationId: canceled }, owner.cookie);
    expect(cancelRes.status, await cancelRes.clone().text()).toBe(200);
    expect(invitationRow(canceled).status).toBe('canceled');

    const accepted = (await invite('ada.accepted@acme.test')).body.id as string;
    const acceptor = await signUp('ada.accepted@acme.test', 'Ada Accepted');
    const acceptRes = await direct('POST', '/organization/accept-invitation', { invitationId: accepted }, acceptor.cookie);
    expect(acceptRes.status, await acceptRes.clone().text()).toBe(200);
    expect(invitationRow(accepted).status).toBe('accepted');

    for (const id of [canceled, accepted]) {
      const v = await refusalOf(copyLink(id, owner.userId));
      expect([v.status, v.code], id).toEqual([409, 'RESOURCE_CONFLICT']);
    }
  });

  it('reach is judged before status: a plain member learns nothing about a canceled row', async () => {
    const { direct, invite, owner, member, copyLink } = await stage();
    const canceled = (await invite('carl.canceled@acme.test')).body.id as string;
    await direct('POST', '/organization/cancel-invitation', { invitationId: canceled }, owner.cookie);
    const v = await refusalOf(copyLink(canceled, member.userId));
    expect([v.status, v.code]).toEqual([403, 'PERMISSION_DENIED']);
  });

  it('an unknown invitation is refused 404', async () => {
    const { owner, copyLink } = await stage();
    const v = await refusalOf(copyLink('inv_never_issued', owner.userId));
    expect([v.status, v.code]).toEqual([404, 'RECORD_NOT_FOUND']);
  });
});

describe('#27843 (d) — copy_invitation_link on a cloud-managed environment', () => {
  it('is refused 409 with the cloud-managed sentence, even for the owner of a pending row', async () => {
    const { invite, owner, copyLink } = await stage();
    const { body } = await invite('bob.builder@acme.test');
    process.env[MANAGED_ENV] = '1';
    resetCloudManagedForTesting();
    const v = await refusalOf(copyLink(String(body.id), owner.userId));
    expect([v.status, v.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(v.message).toBe(CLOUD_MANAGED_REFUSAL_MESSAGES.invitationLink);
  });
});

describe('#27843 — AuthPlugin registers the handler on the engine', () => {
  it('start() registers sys_invitation.copy_invitation_link under plugin-auth\'s package id', async () => {
    const registerAction = vi.fn();
    const ql = { registerAction, registerHook: vi.fn() };
    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'objectql') return ql;
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn(),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    const plugin = new AuthPlugin({ secret: SECRET, baseUrl: ORIGIN, uiBasePath: UI_BASE } as any);
    await plugin.init(ctx);
    await plugin.start(ctx);

    const calls = registerAction.mock.calls.filter(([object, name]) => object === INVITATION_OBJECT && name === COPY_INVITATION_LINK_ACTION);
    expect(calls).toHaveLength(1);
    expect(typeof calls[0][2]).toBe('function');
    expect(calls[0][3]).toBe(AUTH_PLUGIN_ID);
  });
});
