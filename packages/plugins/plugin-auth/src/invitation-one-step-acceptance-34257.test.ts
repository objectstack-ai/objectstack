// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #34257 — one-step invitation acceptance with a mailbox-only proof.
//
// The real better-auth pipeline through a real `AuthManager` (organization
// plugin, audience gate, membership reconciler, ObjectQL adapter), over the
// same minimal engine double the other end-to-end auth-manager suites use.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { getAuthTables } from 'better-auth/db';
import { resetCloudManagedForTesting } from '@objectstack/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { createCopyInvitationLinkHandler } from './invitation-link-action';
import {
  ACCEPT_INVITATION_ONE_STEP_PATH,
  ONE_STEP_SIGN_IN_STATES,
  STANDING_GRANTS,
  STANDING_GRANT_OBJECTS,
  USER_KEYED_STORES,
  USER_ROW_COLUMNS,
  USER_ROW_SIGN_IN,
  invitationProofIdentifier,
  oneStepSignInState,
  readUserRowSignIn,
  type OneStepAccountReading,
  type OneStepSignInState,
  type StandingGrantObject,
  type StandingGrantReading,
} from './invitation-mailbox-proof';
import { authIdentityManifest } from './manifest';
import { BREACH_CHECK_VENDOR_DEFAULT_PATHS } from './auth-manager-plugin-list';
import { INTERACTIVE_REVOKE_REASON } from './session-tombstone';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const DEFAULT_ORG = 'org_default';
const PARTNER_ORG = 'org_partner';
const PASSWORD = 'S3cure!Passw0rd-34257';
const NEW_PASSWORD = 'N3w!Passw0rd-34257x';

const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}): boolean =>
    Object.entries(where).every(([k, v]): boolean => {
      if (k === '$and' && Array.isArray(v)) return v.every((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > v.$gt;
        if ('$gte' in v) return actual >= v.$gte;
        if ('$lt' in v) return actual < v.$lt;
        if ('$lte' in v) return actual <= v.$lte;
      }
      return eq(actual, v);
    });
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      assertEngineFindOnePredicate(name, q);
      const found = rows(name).find((r) => matches(r, q.where));
      return found ? { ...found } : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      const order = q.orderBy?.[0];
      if (order) {
        out = [...out].sort(
          (a, b) => (a[order.field] > b[order.field] ? 1 : -1) * (order.order === 'desc' ? -1 : 1),
        );
      }
      if (typeof q.offset === 'number') out = out.slice(q.offset);
      if (typeof q.limit === 'number') out = out.slice(0, q.limit);
      return out.map((r) => ({ ...r }));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      if (options?.multi) {
        const hit = rows(name).filter((r) => matches(r, options.where));
        const { id: _ignored, ...fields } = patch;
        for (const r of hit) Object.assign(r, fields);
        return hit.length;
      }
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};
type MemoryEngine = ReturnType<typeof createMemoryEngine>;

interface SentMail {
  template: string;
  to: string;
  data: Record<string, any>;
  deliverOnlyData?: Record<string, any>;
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

const post = (manager: AuthManager, path: string, body: unknown, cookie?: string, remoteAddress?: string) =>
  manager.handleRequest(
    new Request(`${BASE}/api/v1/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    remoteAddress ? { remoteAddress } : undefined,
  );

const sessionUser = async (manager: AuthManager, cookie: string) => {
  const res = await manager.handleRequest(
    new Request(`${BASE}/api/v1/auth/get-session`, { headers: { cookie } }),
  );
  const body: any = await res.json().catch(() => null);
  return body?.user ?? null;
};

const signUp = async (manager: AuthManager, engine: MemoryEngine, email: string) => {
  const invitationId = await inviteForAudienceGate(engine, email);
  const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: email, invitationId });
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u) => u.email === email);
  return { cookie: cookieFrom(res), userId: String(user!.id) };
};

const userRow = (engine: MemoryEngine, email: string) =>
  (engine.tables.get('sys_user') ?? []).find((u) => u.email === email);

const membersOf = (engine: MemoryEngine, organizationId: string, userId: string) =>
  (engine.tables.get('sys_member') ?? []).filter(
    (m) => m.organization_id === organizationId && m.user_id === userId,
  );

const invitationOf = (engine: MemoryEngine, email: string) =>
  (engine.tables.get('sys_invitation') ?? []).find(
    (i) => i.email === email && i.organization_id === PARTNER_ORG,
  );

const proofOf = (mail: SentMail): string => {
  const link = String(mail.deliverOnlyData?.acceptUrl ?? '');
  const match = /#proof=([^&]+)$/.exec(link);
  expect(match, `the mail's link carries no proof: ${link}`).not.toBeNull();
  return decodeURIComponent(match![1]!);
};

const boot = async (options: Record<string, unknown> = {}) => {
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
    ...options,
  });
  const sent: SentMail[] = [];
  manager.setEmailService({
    sendTemplate: async (input: SentMail) => {
      sent.push(input);
      return { id: `mail_${sent.length}`, status: 'sent' };
    },
  } as never);
  const owner = await signUp(manager, engine, 'owner@example.com');
  await engine.insert('sys_member', { id: 'mem_owner_partner', organization_id: PARTNER_ORG, user_id: owner.userId, role: 'owner' });
  const invite = async (email: string, resend = false) => {
    const res = await post(
      manager,
      '/organization/invite-member',
      { email, role: 'member', organizationId: PARTNER_ORG, ...(resend ? { resend: true } : {}) },
      owner.cookie,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const mail = [...sent].reverse().find((m) => m.template === 'auth.invitation' && m.to === email);
    expect(mail, `no invitation mail to ${email}`).toBeDefined();
    return { invitation: invitationOf(engine, email)!, mail: mail!, proof: proofOf(mail!) };
  };
  return { engine, manager, owner, sent, invite };
};

const door = (manager: AuthManager, body: Record<string, unknown>, cookie?: string, remoteAddress?: string) =>
  post(manager, ACCEPT_INVITATION_ONE_STEP_PATH, body, cookie, remoteAddress);

const expectRefused = async (res: Response) => {
  const text = await res.clone().text();
  expect(res.status, text).toBe(400);
  const body: any = JSON.parse(text);
  expect(body.code).toBe('INVALID_TOKEN');
};

describe('#34257 — the invitation mail carries a mailbox-only proof', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('the mail delivers the proof only as a deliver-only value, never in the logged template data', async () => {
    const { invite } = await boot();
    const { mail, proof } = await invite('invitee@example.com');
    expect(JSON.stringify(mail.data)).not.toContain(proof);
    expect(String(mail.deliverOnlyData?.acceptUrl).startsWith(`${mail.data.acceptUrl}#`)).toBe(true);
  });

  it('the proof is never at rest in clear', async () => {
    const { engine, invite } = await boot();
    const { proof } = await invite('invitee@example.com');
    const everyRow = JSON.stringify([...engine.tables.entries()]);
    expect(everyRow).not.toContain(proof);
  });

  it('the copy action answers the link without the proof', async () => {
    const { engine, manager, owner, invite } = await boot();
    const { invitation, mail, proof } = await invite('invitee@example.com');
    const handler = createCopyInvitationLinkHandler({
      engine: engine as never,
      consoleUrl: (path) => manager.getConsoleUrl(path),
    });
    const answer = await handler({ params: { recordId: String(invitation.id) }, session: { userId: owner.userId } });
    expect(answer.acceptUrl).not.toContain(proof);
    expect(answer.acceptUrl).toBe(mail.data.acceptUrl);
  });
});

describe('#34257 — accepting with the proof', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('the proof creates the account, verifies the address, accepts and signs in, in one request', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('newcomer@example.com');

    const res = await door(manager, { invitationId: invitation.id, proof, name: 'Newcomer', password: PASSWORD });
    const text = await res.clone().text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toEqual({ success: true, data: { outcome: 'accepted', organizationId: PARTNER_ORG } });

    const user = userRow(engine, 'newcomer@example.com');
    expect(user?.email_verified).toBeTruthy();
    expect(invitationOf(engine, 'newcomer@example.com')?.status).toBe('accepted');
    expect(membersOf(engine, PARTNER_ORG, String(user!.id))).toHaveLength(1);
    expect((await sessionUser(manager, cookieFrom(res)))?.email).toBe('newcomer@example.com');

    const signIn = await post(manager, '/sign-in/email', { email: 'newcomer@example.com', password: PASSWORD });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
  });

  it('a link without the proof neither verifies an address nor accepts for an unverified account', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation } = await invite('unverified@example.com');
    const holder = await signUp(manager, engine, 'unverified@example.com');

    const res = await door(manager, { invitationId: invitation.id }, holder.cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).data).toEqual({ outcome: 'verify_email' });

    const anonymous = await door(manager, { invitationId: invitation.id, name: 'X', password: PASSWORD });
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).code).toBe('UNAUTHENTICATED');

    expect(userRow(engine, 'unverified@example.com')?.email_verified).toBeFalsy();
    expect(invitationOf(engine, 'unverified@example.com')?.status).toBe('pending');
  });

  it('a proof is single-use', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('once@example.com');
    const proofRows = () =>
      (engine.tables.get('sys_verification') ?? []).filter(
        (row) => row.identifier === invitationProofIdentifier(String(invitation.id)),
      );
    expect(proofRows()).toHaveLength(1);
    const first = await door(manager, { invitationId: invitation.id, proof, name: 'Once', password: PASSWORD });
    expect(first.status, await first.clone().text()).toBe(200);
    expect(proofRows()).toHaveLength(0);
    await expectRefused(await door(manager, { invitationId: invitation.id, proof, name: 'Once', password: PASSWORD }));
  });

  it('a proof that does not match is refused, creates nothing and leaves the real proof usable', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('guarded@example.com');
    await expectRefused(
      await door(manager, { invitationId: invitation.id, proof: `${proof.slice(0, -1)}${proof.endsWith('x') ? 'y' : 'x'}`, name: 'G', password: PASSWORD }),
    );
    expect(userRow(engine, 'guarded@example.com')).toBeUndefined();
    const good = await door(manager, { invitationId: invitation.id, proof, name: 'G', password: PASSWORD });
    expect(good.status, await good.clone().text()).toBe(200);
  });

  it("another invitation's proof is refused", async () => {
    const { manager, invite } = await boot();
    const a = await invite('first@example.com');
    const b = await invite('second@example.com');
    await expectRefused(await door(manager, { invitationId: a.invitation.id, proof: b.proof, name: 'A', password: PASSWORD }));
  });

  it('a proof for an expired invitation is refused', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('late@example.com');
    invitationOf(engine, 'late@example.com')!.expires_at = new Date(Date.now() - 1000);
    await expectRefused(await door(manager, { invitationId: invitation.id, proof, name: 'L', password: PASSWORD }));
    expect(userRow(engine, 'late@example.com')).toBeUndefined();
  });

  it('a resend retires the earlier proof', async () => {
    const { manager, invite } = await boot();
    const first = await invite('again@example.com');
    const second = await invite('again@example.com', true);
    expect(second.proof).not.toBe(first.proof);
    await expectRefused(await door(manager, { invitationId: first.invitation.id, proof: first.proof, name: 'A', password: PASSWORD }));
    const res = await door(manager, { invitationId: second.invitation.id, proof: second.proof, name: 'A', password: PASSWORD });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('an unverified account gets the typed password in place of its own and loses every session', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('squatted@example.com');
    const earlier = await signUp(manager, engine, 'squatted@example.com');
    expect(await sessionUser(manager, earlier.cookie)).not.toBeNull();

    const res = await door(manager, { invitationId: invitation.id, proof, name: 'Owner', password: NEW_PASSWORD });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).data).toMatchObject({ outcome: 'accepted' });

    expect(await sessionUser(manager, earlier.cookie)).toBeNull();
    // Each session it ended records the reason a password reset records.
    const ended = (engine.tables.get('sys_session') ?? []).filter((row) => row.user_id === earlier.userId && row.revoked_at);
    expect(ended.length).toBeGreaterThan(0);
    expect(ended.map((row) => row.revoke_reason)).toEqual(ended.map(() => 'password_reset'));
    expect(userRow(engine, 'squatted@example.com')?.email_verified).toBeTruthy();
    const oldPassword = await post(manager, '/sign-in/email', { email: 'squatted@example.com', password: PASSWORD });
    expect(oldPassword.status).not.toBe(200);
    const newPassword = await post(manager, '/sign-in/email', { email: 'squatted@example.com', password: NEW_PASSWORD });
    expect(newPassword.status, await newPassword.clone().text()).toBe(200);
  });

  it('an unverified account with a linked provider account signs in as today, its password and the proof untouched', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('linked@example.com');
    const holder = await signUp(manager, engine, 'linked@example.com');
    await engine.insert('sys_account', {
      id: 'acc_linked_google',
      user_id: holder.userId,
      provider_id: 'google',
      account_id: 'google-sub-1',
    });

    const res = await door(manager, { invitationId: invitation.id, proof, name: 'L', password: NEW_PASSWORD });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).data).toEqual({ outcome: 'sign_in' });

    expect(await sessionUser(manager, holder.cookie)).not.toBeNull();
    expect(invitationOf(engine, 'linked@example.com')?.status).toBe('pending');
    const samePassword = await post(manager, '/sign-in/email', { email: 'linked@example.com', password: PASSWORD });
    expect(samePassword.status, await samePassword.clone().text()).toBe(200);
    // Unspent: the same proof answers again.
    const again = await door(manager, { invitationId: invitation.id, proof, name: 'L', password: NEW_PASSWORD });
    expect((await again.json()).data).toEqual({ outcome: 'sign_in' });
  });

  it('the door is rate-limited per invitation', async () => {
    const { manager, invite } = await boot();
    const { invitation } = await invite('limited@example.com');
    for (let i = 0; i < 10; i++) {
      await expectRefused(await door(manager, { invitationId: invitation.id, proof: `wrong-${i}`, name: 'L', password: PASSWORD }));
    }
    const over = await door(manager, { invitationId: invitation.id, proof: 'wrong-x', name: 'L', password: PASSWORD });
    expect(over.status).toBe(429);
    expect((await over.json()).code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('a verified account signs in as today and the proof stays unspent', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('verified@example.com');
    await signUp(manager, engine, 'verified@example.com');
    userRow(engine, 'verified@example.com')!.email_verified = true;

    const res = await door(manager, { invitationId: invitation.id, proof, name: 'V', password: NEW_PASSWORD });
    expect((await res.json()).data).toEqual({ outcome: 'sign_in' });
    const again = await door(manager, { invitationId: invitation.id, proof, name: 'V', password: NEW_PASSWORD });
    expect((await again.json()).data).toEqual({ outcome: 'sign_in' });
    expect(invitationOf(engine, 'verified@example.com')?.status).toBe('pending');
  });
});

describe('#34257 — a signed-in return accepts only a verified address', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a session whose invited address is verified accepts', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation } = await invite('social@example.com');
    const person = await signUp(manager, engine, 'social@example.com');
    userRow(engine, 'social@example.com')!.email_verified = true;

    const res = await door(manager, { invitationId: invitation.id }, person.cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).data).toMatchObject({ outcome: 'accepted', organizationId: PARTNER_ORG });
    expect(membersOf(engine, PARTNER_ORG, person.userId)).toHaveLength(1);
  });

  it('a session whose address is not verified is asked to verify, and nothing is accepted', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation } = await invite('unsure@example.com');
    const person = await signUp(manager, engine, 'unsure@example.com');

    const res = await door(manager, { invitationId: invitation.id }, person.cookie);
    expect((await res.json()).data).toEqual({ outcome: 'verify_email' });
    expect(membersOf(engine, PARTNER_ORG, person.userId)).toHaveLength(0);
    expect(invitationOf(engine, 'unsure@example.com')?.status).toBe('pending');
  });
});


// The tables a redemption writes: the account, its credential, its sessions,
// the membership, the invitation and the proof row; and the standing grants
// the judge reads, which nothing here writes.
const WRITTEN_TABLES = [
  'sys_user',
  'sys_account',
  'sys_session',
  'sys_member',
  'sys_invitation',
  'sys_verification',
  ...STANDING_GRANT_OBJECTS,
];
const writtenState = (engine: MemoryEngine) =>
  JSON.stringify(WRITTEN_TABLES.map((table) => [table, engine.tables.get(table) ?? []]));

const expectAnswer = async (res: Response, status: number, code: string) => {
  const text = await res.clone().text();
  expect(res.status, text).toBe(status);
  expect(JSON.parse(text).code, text).toBe(code);
};

const expectSignIn = async (res: Response) => {
  const text = await res.clone().text();
  expect(res.status, text).toBe(200);
  expect(JSON.parse(text).data).toEqual({ outcome: 'sign_in' });
};

const expectAccepted = async (res: Response) => {
  const text = await res.clone().text();
  expect(res.status, text).toBe(200);
  expect(JSON.parse(text).data).toEqual({ outcome: 'accepted', organizationId: PARTNER_ORG });
};

const quietConsole = () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetCloudManagedForTesting();
  });
};

describe('#34257 — every gate refuses before anything is written, and the proof stays usable', () => {
  quietConsole();

  it('a new address is refused where email sign-up is switched off', async () => {
    const { engine, manager, invite } = await boot({ emailAndPassword: { disableSignUp: true } });
    const { invitation, proof } = await invite('closed@example.com');
    const before = writtenState(engine);

    await expectAnswer(await door(manager, { invitationId: invitation.id, proof, name: 'C', password: PASSWORD }), 403, 'PERMISSION_DENIED');
    expect(writtenState(engine)).toBe(before);

    manager.applyConfigPatch({ emailAndPassword: { disableSignUp: false } } as never);
    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'C', password: PASSWORD }));
  });

  it('a new address is refused in SSO-only mode', async () => {
    const { engine, manager, invite } = await boot({ ssoOnlyMode: true });
    const { invitation, proof } = await invite('sso-new@example.com');
    const before = writtenState(engine);

    await expectAnswer(await door(manager, { invitationId: invitation.id, proof, name: 'S', password: PASSWORD }), 403, 'PERMISSION_DENIED');
    expect(writtenState(engine)).toBe(before);

    manager.applyConfigPatch({ ssoOnlyMode: false } as never);
    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'S', password: PASSWORD }));
  });

  it('a password under the minimum length is refused', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('short@example.com');
    const before = writtenState(engine);

    await expectAnswer(await door(manager, { invitationId: invitation.id, proof, name: 'S', password: 'Ab1!' }), 400, 'PASSWORD_POLICY_VIOLATION');
    expect(writtenState(engine)).toBe(before);

    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'S', password: PASSWORD }));
  });

  it('a password the complexity policy refuses is refused', async () => {
    const { engine, manager, invite } = await boot({ passwordRequireComplexity: true });
    const { invitation, proof } = await invite('simple@example.com');
    const before = writtenState(engine);

    await expectAnswer(
      await door(manager, { invitationId: invitation.id, proof, name: 'S', password: 'onlylowercaseletters' }),
      400,
      'PASSWORD_POLICY_VIOLATION',
    );
    expect(writtenState(engine)).toBe(before);

    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'S', password: PASSWORD }));
  });

  it('a breached password is refused, and the proof stays usable', async () => {
    const BREACHED = 'Br3ached!Passw0rd-list';
    const digest = createHash('sha1').update(BREACHED).digest('hex').toUpperCase();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://api.pwnedpasswords.com/range/')) throw new Error(`unexpected fetch: ${url}`);
      const listed = url.endsWith(`/${digest.slice(0, 5)}`) ? `${digest.slice(5)}:42` : '0000000000000000000000000000000000A:1';
      return new Response(listed, { status: 200, headers: { 'content-type': 'text/plain' } });
    });
    const { engine, manager, invite } = await boot({ plugins: { passwordRejectBreached: true } });
    const { invitation, proof } = await invite('breached@example.com');
    const before = writtenState(engine);

    await expectAnswer(await door(manager, { invitationId: invitation.id, proof, name: 'B', password: BREACHED }), 400, 'PASSWORD_COMPROMISED');
    expect(writtenState(engine)).toBe(before);

    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'B', password: PASSWORD }));
  });

  it('the breach check covers the vendor default doors and this door, and the vendor list is the installed one', () => {
    const vendorFile = createRequire(import.meta.url).resolve('better-auth/plugins/haveibeenpwned');
    const source = readFileSync(vendorFile, 'utf8');
    const literal = /options\?\.paths\s*\|\|\s*\[([^\]]*)\]/.exec(source);
    expect(literal, `no default path list found in ${vendorFile}`).not.toBeNull();
    const vendorDefault = [...literal![1]!.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    expect(vendorDefault.length).toBeGreaterThan(0);
    expect([...BREACH_CHECK_VENDOR_DEFAULT_PATHS]).toEqual(vendorDefault);
    expect(vendorDefault).not.toContain(ACCEPT_INVITATION_ONE_STEP_PATH);
  });

  it('a new address the audience admission refuses is refused', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('refused@example.com');
    // A posture outside the vocabulary refuses every self-serve creation. The
    // entry validation refuses one at the door, so it is set behind it.
    const config = (manager as unknown as { config: Record<string, unknown> }).config;
    const standing = config.audience;
    config.audience = { posture: 'not_a_posture' };
    const before = writtenState(engine);

    await expectAnswer(await door(manager, { invitationId: invitation.id, proof, name: 'R', password: PASSWORD }), 403, 'AUTH_CONFIG_ERROR');
    expect(writtenState(engine)).toBe(before);

    config.audience = standing;
    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'R', password: PASSWORD }));
  });

  it('a new address with no name is refused', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('nameless@example.com');
    const before = writtenState(engine);

    await expectAnswer(await door(manager, { invitationId: invitation.id, proof, name: '  ', password: PASSWORD }), 400, 'VALIDATION_ERROR');
    expect(writtenState(engine)).toBe(before);

    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'Named', password: PASSWORD }));
  });

  it('the window per client network address refuses, and the proof stays usable from another address', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('windowed@example.com');
    for (let i = 0; i < 10; i++) {
      await expectRefused(await door(manager, { invitationId: `inv_unknown_${i}`, proof: 'wrong', name: 'W', password: PASSWORD }, undefined, '203.0.113.7'));
    }
    const before = writtenState(engine);

    await expectAnswer(
      await door(manager, { invitationId: invitation.id, proof, name: 'W', password: PASSWORD }, undefined, '203.0.113.7'),
      429,
      'RATE_LIMIT_EXCEEDED',
    );
    expect(writtenState(engine)).toBe(before);

    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'W', password: PASSWORD }, undefined, '203.0.113.8'));
  });

  it('a cloud-managed environment refuses a proof, and the proof stays usable where it is not', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('managed@example.com');
    vi.stubEnv('OS_CLOUD_MANAGED', '1');
    resetCloudManagedForTesting();
    const before = writtenState(engine);

    await expectAnswer(await door(manager, { invitationId: invitation.id, proof, name: 'M', password: PASSWORD }), 409, 'RESOURCE_CONFLICT');
    expect(writtenState(engine)).toBe(before);

    vi.unstubAllEnvs();
    resetCloudManagedForTesting();
    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'M', password: PASSWORD }));
  });

  it('two concurrent redemptions of one proof: exactly one is accepted', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('raced@example.com');
    const answers = await Promise.all([
      door(manager, { invitationId: invitation.id, proof, name: 'One', password: PASSWORD }),
      door(manager, { invitationId: invitation.id, proof, name: 'Two', password: NEW_PASSWORD }),
    ]);
    const statuses = answers.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 400]);
    await expectRefused(answers.find((res) => res.status === 400)!);
    expect((engine.tables.get('sys_user') ?? []).filter((u) => u.email === 'raced@example.com')).toHaveLength(1);
  });
});

describe('#34257 — the door sets a password on an existing account only where it reads no claim', () => {
  quietConsole();

  type Booted = Awaited<ReturnType<typeof boot>>;
  interface StateCase {
    options?: Record<string, unknown>;
    /** Put the account into the state, and answer how to take it out again. */
    enter(booted: Booted, email: string): Promise<() => Promise<void> | void>;
  }
  const findThrowsFor = (engine: MemoryEngine, object: string, error: Error) => {
    const find = engine.find.bind(engine);
    engine.find = async (name: string, q: any = {}) => {
      if (name === object) throw error;
      return find(name, q);
    };
    return () => {
      engine.find = find;
    };
  };
  // Give the account a row in one standing-grant object; answers how to take it away.
  const holdGrant = async (engine: MemoryEngine, object: StandingGrantObject, email: string, extra: Record<string, unknown> = {}) => {
    const id = `${object}_${email}`;
    await engine.insert(object, { id, user_id: userRow(engine, email)!.id, ...extra });
    return () => {
      engine.tables.set(object, (engine.tables.get(object) ?? []).filter((row) => row.id !== id));
    };
  };
  const findThrowsForUserRowSignIn = (engine: MemoryEngine) => {
    const find = engine.find.bind(engine);
    engine.find = async (name: string, q: any = {}) => {
      if (name === 'sys_user' && Array.isArray(q.fields) && q.fields.includes('phone_number')) throw new Error('store unavailable');
      return find(name, q);
    };
    return () => {
      engine.find = find;
    };
  };
  const findThrowsForSource = (engine: MemoryEngine) => {
    const find = engine.find.bind(engine);
    engine.find = async (name: string, q: any = {}) => {
      if (name === 'sys_user' && Array.isArray(q.fields) && q.fields.includes('source')) throw new Error('store unavailable');
      return find(name, q);
    };
    return () => {
      engine.find = find;
    };
  };

  // Typed as a Record over the states, so a state added to the rule without a
  // case here fails to compile, and the test below fails at run time.
  const CASES: Record<OneStepSignInState, StateCase> = {
    verified: {
      enter: async ({ engine }, email) => {
        userRow(engine, email)!.email_verified = true;
        return () => {
          userRow(engine, email)!.email_verified = false;
        };
      },
    },
    linked_provider: {
      enter: async ({ engine }, email) => {
        await engine.insert('sys_account', { id: `acc_${email}`, user_id: userRow(engine, email)!.id, provider_id: 'google', account_id: `google-${email}` });
        return () => {
          engine.tables.set('sys_account', (engine.tables.get('sys_account') ?? []).filter((a) => a.id !== `acc_${email}`));
        };
      },
    },
    second_factor: {
      options: { plugins: { twoFactor: true } },
      enter: async ({ engine }, email) => {
        userRow(engine, email)!.two_factor_enabled = true;
        return () => {
          userRow(engine, email)!.two_factor_enabled = false;
        };
      },
    },
    verified_phone: {
      options: { plugins: { phoneNumber: true } },
      enter: async ({ engine }, email) => {
        userRow(engine, email)!.phone_number = '+15550134257';
        userRow(engine, email)!.phone_number_verified = true;
        return () => {
          userRow(engine, email)!.phone_number = null;
          userRow(engine, email)!.phone_number_verified = false;
        };
      },
    },
    // A sign-in phone number on the user row, not verified, with phone
    // sign-in not mounted: read from the stored row all the same.
    phone_number: {
      enter: async ({ engine }, email) => {
        userRow(engine, email)!.phone_number = '+15550134258';
        userRow(engine, email)!.phone_number_verified = false;
        return () => {
          userRow(engine, email)!.phone_number = null;
        };
      },
    },
    identity_unreadable: {
      enter: async ({ engine }) => findThrowsForUserRowSignIn(engine),
    },
    // A standing grant counts as a claim, a revoked or expired one included.
    api_key: { enter: async ({ engine }, email) => holdGrant(engine, 'sys_api_key', email, { revoked: true }) },
    oauth_consent: {
      enter: async ({ engine }, email) => holdGrant(engine, 'sys_oauth_consent', email, { client_id: 'client_34257', scopes: '["openid"]' }),
    },
    oauth_token: {
      enter: async ({ engine }, email) => holdGrant(engine, 'sys_oauth_refresh_token', email, { client_id: 'client_34257', revoked: new Date() }),
    },
    oauth_client: { enter: async ({ engine }, email) => holdGrant(engine, 'sys_oauth_application', email, { client_id: 'client_34257' }) },
    device_code: {
      enter: async ({ engine }, email) => holdGrant(engine, 'sys_device_code', email, { status: 'approved', expires_at: new Date(0) }),
    },
    sso_provider: { enter: async ({ engine }, email) => holdGrant(engine, 'sys_sso_provider', email, { provider_id: 'sso_34257' }) },
    scim_credential: {
      enter: async ({ engine }, email) => holdGrant(engine, 'sys_scim_connection_credential', email, { revoked_at: new Date() }),
    },
    idp_linked: { enter: async ({ engine }, email) => holdGrant(engine, 'sys_scim_user', email, { connection_user_key: 'scim-34257' }) },
    grant_unreadable: {
      enter: async ({ engine }) => findThrowsFor(engine, 'sys_oauth_consent', new Error('store unavailable')),
    },
    idp_provisioned: {
      enter: async ({ engine }, email) => {
        userRow(engine, email)!.source = 'idp_provisioned';
        return () => {
          userRow(engine, email)!.source = null;
        };
      },
    },
    pending_sso: {
      enter: async ({ engine }, email) => {
        userRow(engine, email)!.source = 'idp_pending';
        return () => {
          userRow(engine, email)!.source = null;
        };
      },
    },
    source_unreadable: {
      enter: async ({ engine }) => findThrowsForSource(engine),
    },
    sso_only: {
      enter: async ({ manager }) => {
        manager.applyConfigPatch({ ssoOnlyMode: true } as never);
        return () => manager.applyConfigPatch({ ssoOnlyMode: false } as never);
      },
    },
    email_password_off: {
      enter: async ({ manager }) => {
        manager.applyConfigPatch({ emailAndPassword: { enabled: false } } as never);
        return () => manager.applyConfigPatch({ emailAndPassword: { enabled: true } } as never);
      },
    },
    // An identity source no rule names: a mark the judge cannot read as local.
    unrecognised: {
      enter: async ({ engine }, email) => {
        userRow(engine, email)!.source = 'directory_federated';
        return () => {
          userRow(engine, email)!.source = 'env_native';
        };
      },
    },
  };

  // The allow-list read: the one reading that lets the password be set, and
  // one step off it on each value the judge reads answers a reason.
  const ALLOWED: OneStepAccountReading = {
    emailVerified: false,
    accountProviders: ['credential'],
    twoFactorEnabled: false,
    phoneNumberVerified: undefined,
    userRowSignIn: { ok: true, values: { phone_number: null } },
    standingGrants: Object.fromEntries(STANDING_GRANT_OBJECTS.map((object) => [object, { ok: true, held: false }])) as Record<
      StandingGrantObject,
      StandingGrantReading
    >,
    source: { ok: true, value: 'env_native' },
    ssoOnly: false,
    emailPasswordEnabled: true,
  };

  it('the judge lets the password be set only on the reading that carries no claim', () => {
    expect(oneStepSignInState(ALLOWED)).toBeUndefined();
    expect(
      oneStepSignInState({
        ...ALLOWED,
        accountProviders: [],
        source: { ok: true, value: null },
        twoFactorEnabled: null,
        userRowSignIn: { ok: true, values: {} },
      }),
    ).toBeUndefined();
  });

  it.each<[string, Partial<OneStepAccountReading>, OneStepSignInState]>([
    ['an address verified', { emailVerified: true }, 'verified'],
    ['a verified flag stored in no form the judge reads', { emailVerified: 0 }, 'unrecognised'],
    ['a provider account', { accountProviders: ['credential', 'github'] }, 'linked_provider'],
    ['an account with no provider recorded', { accountProviders: [undefined] }, 'linked_provider'],
    ['a second factor', { twoFactorEnabled: true }, 'second_factor'],
    ['a second-factor flag stored in no form the judge reads', { twoFactorEnabled: 'true' }, 'unrecognised'],
    ['a verified phone number', { phoneNumberVerified: true }, 'verified_phone'],
    ['a phone flag stored in no form the judge reads', { phoneNumberVerified: 1 }, 'unrecognised'],
    ['a phone number on the user row, not verified', { userRowSignIn: { ok: true, values: { phone_number: '+15550134257' } } }, 'phone_number'],
    ['a phone number on the user row, verified flag unread', { phoneNumberVerified: undefined, userRowSignIn: { ok: true, values: { phone_number: '+1 555 013' } } }, 'phone_number'],
    ['a phone number stored in no form the judge reads', { userRowSignIn: { ok: true, values: { phone_number: 15550134257 } } }, 'unrecognised'],
    ['an empty phone number', { userRowSignIn: { ok: true, values: { phone_number: ' ' } } }, 'unrecognised'],
    ['a user row that cannot be read', { userRowSignIn: { ok: false } }, 'identity_unreadable'],
    ['a user row reading that is missing', { userRowSignIn: undefined as never }, 'identity_unreadable'],
    ['an identity-provider source', { source: { ok: true, value: 'idp_provisioned' } }, 'idp_provisioned'],
    ['a pending single sign-on', { source: { ok: true, value: 'idp_pending' } }, 'pending_sso'],
    ['an unreadable source', { source: { ok: false } }, 'source_unreadable'],
    ['a source no rule names', { source: { ok: true, value: 'directory_federated' } }, 'unrecognised'],
    ['SSO-only mode', { ssoOnly: true }, 'sso_only'],
    ['email and password off', { emailPasswordEnabled: false }, 'email_password_off'],
    ['email and password not declared on', { emailPasswordEnabled: undefined }, 'email_password_off'],
  ])('the judge answers sign_in for %s', (_label, change, reason) => {
    expect(oneStepSignInState({ ...ALLOWED, ...change })).toBe(reason);
  });

  // The claim stores, written out: each standing-grant object and the reason
  // its row answers. The module derives what it reads from its classification
  // table; this list pins that table's claims, so a store moved out of the
  // claims turns its cases below red.
  const CLAIM_STORES: ReadonlyArray<readonly [StandingGrantObject, OneStepSignInState]> = [
    ['sys_api_key', 'api_key'],
    ['sys_oauth_consent', 'oauth_consent'],
    ['sys_oauth_access_token', 'oauth_token'],
    ['sys_oauth_refresh_token', 'oauth_token'],
    ['sys_oauth_application', 'oauth_client'],
    ['sys_device_code', 'device_code'],
    ['sys_two_factor', 'second_factor'],
    ['sys_sso_provider', 'sso_provider'],
    ['sys_scim_connection_credential', 'scim_credential'],
    ['sys_scim_user', 'idp_linked'],
    ['sys_scim_subject', 'idp_linked'],
    ['sys_scim_projection_grant', 'idp_linked'],
    ['sys_scim_identity_tombstone', 'idp_linked'],
  ];

  it('the standing grants the door reads are the claim stores', () => {
    expect(STANDING_GRANTS.map(({ object, reason }) => [object, reason])).toEqual(CLAIM_STORES.map(([o, r]) => [o, r]));
  });

  const withGrant = (object: StandingGrantObject, reading: StandingGrantReading | undefined): Partial<OneStepAccountReading> => ({
    standingGrants: { ...ALLOWED.standingGrants, [object]: reading } as Record<StandingGrantObject, StandingGrantReading>,
  });

  it.each(CLAIM_STORES)(
    'the judge answers sign_in for a row of %s, as %s, and as grant_unreadable when it cannot be read or was not read',
    (object, reason) => {
      expect(oneStepSignInState({ ...ALLOWED, ...withGrant(object, { ok: true, held: true }) })).toBe(reason);
      expect(oneStepSignInState({ ...ALLOWED, ...withGrant(object, { ok: false }) })).toBe('grant_unreadable');
      expect(oneStepSignInState({ ...ALLOWED, ...withGrant(object, undefined) })).toBe('grant_unreadable');
    },
  );

  it('every user-keyed store the plugin mounts is classified, as a claim the judge reads or as no claim', () => {
    // Derived from the manifest the plugin registers: every column that
    // references sys_user or whose name ends in user_id, on its objects and on
    // the fields it adds to them. It finds a user column by that reference or
    // that name only, so a store holding a user's id in a plain column under
    // another name would pass it unclassified; and it reads this plugin's
    // manifest only, so a store another package mounts is outside it.
    const manifest = authIdentityManifest();
    const userKeyed = (fields: Record<string, any>) =>
      Object.entries(fields ?? {})
        .filter(([name, field]) => field?.reference === 'sys_user' || name.endsWith('user_id'))
        .map(([name]) => name);
    const mounted = [
      ...manifest.objects.flatMap((object: any) => userKeyed(object.fields).map((column) => `${object.name}.${column}`)),
      ...manifest.objectExtensions.flatMap((extension: any) => userKeyed(extension.fields).map((column) => `${extension.extend}.${column}`)),
    ];
    expect([...new Set(mounted)].sort()).toEqual(Object.keys(USER_KEYED_STORES).sort());
    // Each claim store is read by an indexed lookup on its user column.
    for (const object of STANDING_GRANT_OBJECTS) {
      const declared = manifest.objects.find((o: any) => o.name === object);
      expect(declared?.fields?.user_id, object).toBeDefined();
      expect((declared?.indexes ?? []).some((index: any) => index.fields?.[0] === 'user_id'), `${object} has no index led by user_id`).toBe(true);
    }
  });

  // Every plugin flag the plugin list reads, on, plus the two mounts gated by
  // configuration rather than a flag: generic OAuth providers and the
  // one-time token's app scheme.
  const EVERY_PLUGIN_ON = {
    plugins: {
      organization: true,
      twoFactor: true,
      passwordRejectBreached: true,
      passkeys: true,
      magicLink: true,
      oidcProvider: true,
      deviceAuthorization: true,
      admin: true,
      phoneNumber: true,
      sso: true,
      ssoDomainVerification: true,
      scim: true,
    },
    oidcProviders: [{ providerId: 'idp34257', clientId: 'client34257', clientSecret: 'secret34257', discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration' }],
    trustedAppSchemes: ['com.example.app34257'],
  };

  it('every column of the vendor user model with every plugin mounted is classified, and the judge reads each sign-in identity', async () => {
    // The flags the plugin list reads: each one is on in EVERY_PLUGIN_ON, so
    // a flag added later reds here until it is.
    const listSource = readFileSync(new URL('./auth-manager-plugin-list.ts', import.meta.url), 'utf8');
    const enabledBlock = /const enabled = \{([\s\S]*?)\n  \};/.exec(listSource)?.[1] ?? '';
    const flags = [...enabledBlock.matchAll(/^\s{4}([A-Za-z]+):/gm)].map(([, flag]) => flag);
    expect(flags.length, 'the scan of the plugin list found no flag').toBeGreaterThan(5);
    expect(flags.filter((flag) => (EVERY_PLUGIN_ON.plugins as Record<string, boolean>)[flag] !== true)).toEqual([]);

    // The composed instance: what the plugin list mounts with all of them on.
    const engine = createMemoryEngine();
    const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as any, ...EVERY_PLUGIN_ON } as any);
    const auth: any = await manager.getAuthInstance();
    const ids = (auth.options.plugins ?? []).map((plugin: any) => plugin.id);
    for (const id of ['two-factor', 'admin', 'phone-number', 'magic-link', 'generic-oauth', 'oauth-provider', 'sso', 'scim', 'device-authorization', 'one-time-token']) {
      expect(ids, id).toContain(id);
    }
    const userFields = (getAuthTables(auth.options) as any).user.fields as Record<string, { fieldName?: string }>;
    const columns = Object.entries(userFields).map(([key, field]) => field.fieldName ?? key);
    expect([...new Set(columns)].sort()).toEqual(Object.keys(USER_ROW_COLUMNS).sort());

    // The classification, written out: the sign-in identities the door reads
    // off the stored row, and the values the judge reads off the vendor's user.
    expect(USER_ROW_SIGN_IN.map(({ column, reason }) => [column, reason])).toEqual([['phone_number', 'phone_number']]);
    expect(
      Object.entries(USER_ROW_COLUMNS)
        .filter(([, cls]) => 'judged' in cls)
        .map(([column, cls]) => [column, (cls as { judged: string }).judged])
        .sort(),
    ).toEqual([
      ['email_verified', 'verified'],
      ['phone_number_verified', 'verified_phone'],
      ['two_factor_enabled', 'second_factor'],
    ]);
  });

  it('the user row reading is ok only for the one stored row; no read surface, a failed read or no row is not', async () => {
    const engine = createMemoryEngine();
    await engine.insert('sys_user', { id: 'u_row', email: 'row@example.com', phone_number: '+15550134260' });
    await engine.insert('sys_user', { id: 'u_bare', email: 'bare@example.com' });
    expect(await readUserRowSignIn(engine, 'u_row')).toEqual({ ok: true, values: { phone_number: '+15550134260' } });
    expect(await readUserRowSignIn(engine, 'u_bare')).toEqual({ ok: true, values: { phone_number: undefined } });
    expect(await readUserRowSignIn(engine, 'u_missing')).toEqual({ ok: false });
    expect(await readUserRowSignIn(undefined, 'u_row')).toEqual({ ok: false });
    const leave = findThrowsForUserRowSignIn(engine);
    expect(await readUserRowSignIn(engine, 'u_row')).toEqual({ ok: false });
    leave();
    // The door reads the row as the system, so no caller's permissions narrow it.
    const seen: unknown[] = [];
    const find = engine.find.bind(engine);
    engine.find = async (name: string, q: any = {}, options?: unknown) => {
      seen.push(options);
      return find(name, q);
    };
    await readUserRowSignIn(engine, 'u_row');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ context: { isSystem: true } });
  });

  it('a phone number on the user row answers sign_in with phone sign-in mounted, and is accepted once it is cleared', async () => {
    const { engine, manager, invite } = await boot({ plugins: { phoneNumber: true } });
    const email = 'phone-mounted@example.com';
    const { invitation, proof } = await invite(email);
    await signUp(manager, engine, email);
    userRow(engine, email)!.phone_number = '+15550134259';
    userRow(engine, email)!.phone_number_verified = false;
    const before = writtenState(engine);

    await expectSignIn(await door(manager, { invitationId: invitation.id, proof, name: 'P', password: NEW_PASSWORD }));
    expect(writtenState(engine)).toBe(before);

    userRow(engine, email)!.phone_number = null;
    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'P', password: NEW_PASSWORD }));
  });

  // One boot for every store: each store has its own invitation, account and
  // client address, so no window counts another's requests.
  let shared: Promise<Awaited<ReturnType<typeof boot>>> | undefined;
  it.each(CLAIM_STORES.map(([object], i) => [object, i] as const))(
    'an unverified account holding a row of %s signs in as today, and is accepted once the row is gone',
    async (object, i) => {
      shared ??= boot();
      const { engine, manager, invite } = await shared;
      const email = `grant-${object.replace(/_/g, '-')}@example.com`;
      const address = `198.51.100.${i + 1}`;
      const { invitation, proof } = await invite(email);
      await signUp(manager, engine, email);
      const leave = await holdGrant(engine, object, email);
      const before = writtenState(engine);

      await expectSignIn(await door(manager, { invitationId: invitation.id, proof, name: 'G', password: NEW_PASSWORD }, undefined, address));
      expect(writtenState(engine)).toBe(before);

      leave();
      await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'G', password: NEW_PASSWORD }, undefined, address));
    },
  );

  it('a grant table that does not exist holds no grant: the account is accepted', async () => {
    const booted = await boot();
    const { engine, manager, invite } = booted;
    const email = 'grants-absent@example.com';
    const { invitation, proof } = await invite(email);
    await signUp(manager, engine, email);
    const find = engine.find.bind(engine);
    engine.find = async (name: string, q: any = {}) => {
      if ((STANDING_GRANT_OBJECTS as readonly string[]).includes(name)) throw new Error(`SQLITE_ERROR: no such table: ${name}`);
      return find(name, q);
    };
    try {
      await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'G', password: NEW_PASSWORD }));
    } finally {
      engine.find = find;
    }
  });

  it('every state the closing rule names has a case, and no case names another state', () => {
    expect(Object.keys(CASES).sort()).toEqual([...ONE_STEP_SIGN_IN_STATES].sort());
  });

  it.each([...ONE_STEP_SIGN_IN_STATES])('an unverified account in state %s signs in as today, and the proof stays unspent', async (state) => {
    const testCase = CASES[state];
    const booted = await boot(testCase.options);
    const { engine, manager, invite } = booted;
    const email = `state-${state.replace(/_/g, '-')}@example.com`;
    const { invitation, proof } = await invite(email);
    await signUp(manager, engine, email);
    const leave = await testCase.enter(booted, email);
    const before = writtenState(engine);

    await expectSignIn(await door(manager, { invitationId: invitation.id, proof, name: 'S', password: NEW_PASSWORD }));
    expect(writtenState(engine)).toBe(before);

    await leave();
    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'S', password: NEW_PASSWORD }));
  });

  // The readings are taken again once the sessions are revoked: a grant made
  // after the first reading, or a reading that fails on the second take,
  // answers sign_in with no password written and the proof unspent.
  it.each(['a grant appears', 'a reading fails'] as const)(
    'when %s between the first reading and the write, the door answers sign_in, writes no password and leaves the proof unspent',
    async (race) => {
      const { engine, manager, invite } = await boot();
      const email = `raced-${race.replace(/ /g, '-')}@example.com`;
      const { invitation, proof } = await invite(email);
      const { userId, cookie } = await signUp(manager, engine, email);
      const credential = () => (engine.tables.get('sys_account') ?? []).find((a) => a.user_id === userId && a.provider_id === 'credential');
      const password = credential()!.password;
      const find = engine.find.bind(engine);
      let reads = 0;
      let leave = () => {};
      engine.find = async (name: string, q: any = {}) => {
        if (name !== 'sys_api_key') return find(name, q);
        reads += 1;
        if (race === 'a reading fails' && reads > 1) throw new Error('store unavailable');
        const rows = await find(name, q);
        if (race === 'a grant appears' && reads === 1) leave = await holdGrant(engine, 'sys_api_key', email);
        return rows;
      };

      await expectSignIn(await door(manager, { invitationId: invitation.id, proof, name: 'R', password: NEW_PASSWORD }));
      expect(credential()!.password).toBe(password);
      expect(userRow(engine, email)!.email_verified).toBeFalsy();
      // The sessions were revoked before the second reading, and stay revoked.
      expect(await sessionUser(manager, cookie)).toBeNull();

      engine.find = find;
      leave();
      await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'R', password: NEW_PASSWORD }));
    },
  );

  it('a proof spent by another redemption after this one was admitted revokes no session and writes no password', async () => {
    const { engine, manager, invite } = await boot();
    const email = 'raced-spent@example.com';
    const { invitation, proof } = await invite(email);
    const { userId, cookie } = await signUp(manager, engine, email);
    const credential = () => (engine.tables.get('sys_account') ?? []).find((a) => a.user_id === userId && a.provider_id === 'credential');
    const password = credential()!.password;
    const find = engine.find.bind(engine);
    engine.find = async (name: string, q: any = {}) => {
      const rows = await find(name, q);
      if (name === 'sys_api_key') {
        const identifier = invitationProofIdentifier(invitation.id);
        engine.tables.set('sys_verification', (engine.tables.get('sys_verification') ?? []).filter((v) => v.identifier !== identifier));
      }
      return rows;
    };

    await expectRefused(await door(manager, { invitationId: invitation.id, proof, name: 'R', password: NEW_PASSWORD }));
    engine.find = find;
    expect(credential()!.password).toBe(password);
    expect(await sessionUser(manager, cookie)).not.toBeNull();
  });
});

describe('#34257 — a password the door sets starts the password-age clock and clears a forced change', () => {
  quietConsole();

  it('a new account is stamped', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('aged-new@example.com');
    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'N', password: PASSWORD }));
    const user = userRow(engine, 'aged-new@example.com')!;
    expect(user.password_changed_at).toBeInstanceOf(Date);
    expect(user.must_change_password).toBe(false);
  });

  it('an unverified account under a forced change is stamped and the forced change cleared', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('aged-held@example.com');
    await signUp(manager, engine, 'aged-held@example.com');
    const user = userRow(engine, 'aged-held@example.com')!;
    user.must_change_password = true;
    user.password_changed_at = new Date('2020-01-01T00:00:00Z');

    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'H', password: NEW_PASSWORD }));
    expect(user.must_change_password).toBe(false);
    expect(new Date(user.password_changed_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('a password in the history is refused with the proof unspent, and the replaced one is recorded', async () => {
    const { engine, manager, invite } = await boot({ passwordHistoryCount: 3 });
    const { invitation, proof } = await invite('history@example.com');
    const { userId } = await signUp(manager, engine, 'history@example.com');
    const credential = () => (engine.tables.get('sys_account') ?? []).find((a) => a.user_id === userId && a.provider_id === 'credential');
    const replacedHash = credential()!.password;
    const before = writtenState(engine);

    await expectAnswer(await door(manager, { invitationId: invitation.id, proof, name: 'H', password: PASSWORD }), 400, 'PASSWORD_REUSE');
    expect(writtenState(engine)).toBe(before);

    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'H', password: NEW_PASSWORD }));
    expect(JSON.parse(credential()!.previous_password_hashes)).toEqual([replacedHash]);
  });

  it('the sessions are revoked before the password is written, which matches the vendor\'s order', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('ordered@example.com');
    await signUp(manager, engine, 'ordered@example.com');
    const writes: string[] = [];
    for (const op of ['insert', 'update', 'delete'] as const) {
      const original = (engine as any)[op].bind(engine);
      (engine as any)[op] = async (name: string, ...rest: unknown[]) => {
        writes.push(name);
        return original(name, ...rest);
      };
    }

    await expectAccepted(await door(manager, { invitationId: invitation.id, proof, name: 'O', password: NEW_PASSWORD }));
    const sessionsRevoked = writes.indexOf('sys_session');
    const passwordWritten = writes.indexOf('sys_account');
    expect(sessionsRevoked, writes.join(' ')).toBeGreaterThanOrEqual(0);
    expect(passwordWritten, writes.join(' ')).toBeGreaterThan(sessionsRevoked);
  });

  it('the sessions the door ends are ledgered with the reason a password reset records', () => {
    expect(INTERACTIVE_REVOKE_REASON[ACCEPT_INVITATION_ONE_STEP_PATH]).toBe('password_reset');
  });
});

describe('a credential change ends access issued before it — the one-step door', () => {
  quietConsole();

  it('a session opened before the door writes the password is ended, and the session the door opens stands', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('raced@example.com');
    await signUp(manager, engine, 'raced@example.com');
    const internal = (await manager.getAuthContext()).internalAdapter;
    const original = internal.updatePassword.bind(internal);
    let opened: string | undefined;
    vi.spyOn(internal, 'updatePassword').mockImplementation(async (...args: unknown[]) => {
      if (opened === undefined) {
        const res = await post(manager, '/sign-in/email', { email: 'raced@example.com', password: PASSWORD });
        opened = res.status === 200 ? cookieFrom(res) : '';
      }
      return (original as (...a: unknown[]) => Promise<unknown>)(...args);
    });

    const res = await door(manager, { invitationId: invitation.id, proof, name: 'R', password: NEW_PASSWORD });
    await expectAccepted(res);

    expect(opened, 'a sign-in ran before the password write').toBeTruthy();
    expect(await sessionUser(manager, opened!)).toBeNull();
    expect(await sessionUser(manager, cookieFrom(res))).toMatchObject({ email: 'raced@example.com' });
  });
});

// #35107 — a host that calls the organization plugin's `sendInvitationEmail`
// from its own code (no better-auth endpoint around the call) gets the same
// mail: the proof is minted through the manager's own auth context.
describe('#35107 — an invitation mail sent outside an endpoint carries the proof', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  /** The plugin's own `sendInvitationEmail`, as a host reaches it on the built instance. */
  const hostSend = async (manager: AuthManager) => {
    const auth: any = await manager.getAuthInstance();
    const plugin = (auth.options.plugins as any[]).find((p) => p?.id === 'organization');
    const send = plugin?.options?.sendInvitationEmail;
    expect(typeof send).toBe('function');
    return send as (data: Record<string, unknown>) => Promise<void>;
  };

  /** A pending invitation written the way a host writes one: through the manager's adapter. */
  const hostInvitation = async (manager: AuthManager, ownerId: string, email: string) => {
    const ctx: any = await manager.getAuthContext();
    return ctx.adapter.create({
      model: 'invitation',
      data: {
        organizationId: PARTNER_ORG,
        email,
        role: 'member',
        status: 'pending',
        inviterId: ownerId,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        createdAt: new Date(),
      },
    });
  };

  const sendFromHost = async (manager: AuthManager, ownerId: string, email: string) => {
    const send = await hostSend(manager);
    const invitation = await hostInvitation(manager, ownerId, email);
    const { tryGetCurrentAuthEndpointContext } = await import('@better-auth/core/context');
    expect(tryGetCurrentAuthEndpointContext()).toBeUndefined();
    await send({
      id: invitation.id,
      email,
      role: 'member',
      invitation,
      organization: { id: PARTNER_ORG, name: 'Partner', slug: 'partner' },
      inviter: { user: { name: 'Owner', email: 'owner@example.com' } },
    });
    return invitation;
  };

  it('the delivered mail carries a proof the one-step door redeems, and no stored row holds it', async () => {
    const { engine, manager, owner, sent } = await boot();
    const invitation = await sendFromHost(manager, owner.userId, 'hosted@example.com');

    const mail = [...sent].reverse().find((m) => m.template === 'auth.invitation' && m.to === 'hosted@example.com');
    expect(mail, 'no invitation mail').toBeDefined();
    const proof = proofOf(mail!);
    expect(JSON.stringify(mail!.data)).not.toContain(proof);
    expect(JSON.stringify([...engine.tables.entries()])).not.toContain(proof);

    const res = await door(manager, { invitationId: invitation.id, proof, name: 'Hosted', password: PASSWORD });
    const text = await res.clone().text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toEqual({ success: true, data: { outcome: 'accepted', organizationId: PARTNER_ORG } });
    expect(userRow(engine, 'hosted@example.com')?.email_verified).toBeTruthy();
    expect(invitationOf(engine, 'hosted@example.com')?.status).toBe('accepted');
  });

  it('the manager context is read at send time and only outside an endpoint (CONTROL: the in-endpoint send reads the endpoint store)', async () => {
    const { manager, owner, invite } = await boot();
    const read = vi.spyOn(manager, 'getAuthContext');

    // CONTROL: the console's invite runs inside the endpoint and mints there.
    const { proof } = await invite('console@example.com');
    expect(proof).toBeTruthy();
    expect(read).not.toHaveBeenCalled();

    const send = await hostSend(manager);
    const invitation = await hostInvitation(manager, owner.userId, 'outside@example.com');
    read.mockClear();
    await send({
      id: invitation.id,
      email: 'outside@example.com',
      role: 'member',
      invitation,
      organization: { id: PARTNER_ORG, name: 'Partner', slug: 'partner' },
      inviter: { user: { name: 'Owner', email: 'owner@example.com' } },
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('building the auth instance never reads the manager context for the mail, so the send cannot wait on its own build', async () => {
    const manager = new AuthManager({
      secret: SECRET,
      baseUrl: BASE,
      dataEngine: createMemoryEngine() as any,
      membershipPolicy: 'auto',
      getTenancy: () => singleOrgTenancy(),
    });
    const read = vi.spyOn(manager, 'getAuthContext');
    await manager.getAuthInstance();
    expect(read).not.toHaveBeenCalled();
  });
});
