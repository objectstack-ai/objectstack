// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #34257 — one-step invitation acceptance with a mailbox-only proof.
//
// The real better-auth pipeline through a real `AuthManager` (organization
// plugin, audience gate, membership reconciler, ObjectQL adapter), over the
// same minimal engine double the other end-to-end auth-manager suites use.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { createCopyInvitationLinkHandler } from './invitation-link-action';
import { ACCEPT_INVITATION_WITH_PROOF_PATH } from './invitation-mailbox-proof';

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
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
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
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
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
  deliverOnly?: Record<string, any>;
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

const post = (manager: AuthManager, path: string, body: unknown, cookie?: string) =>
  manager.handleRequest(
    new Request(`${BASE}/api/v1/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
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
  const link = String(mail.deliverOnly?.acceptUrl ?? '');
  const match = /#proof=([^&]+)$/.exec(link);
  expect(match, `the mail's link carries no proof: ${link}`).not.toBeNull();
  return decodeURIComponent(match![1]!);
};

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

const door = (manager: AuthManager, body: Record<string, unknown>, cookie?: string) =>
  post(manager, ACCEPT_INVITATION_WITH_PROOF_PATH, body, cookie);

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
    expect(String(mail.deliverOnly?.acceptUrl).startsWith(`${mail.data.acceptUrl}#`)).toBe(true);
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
    expect(JSON.parse(text)).toMatchObject({ outcome: 'accepted', organizationId: PARTNER_ORG });

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
    expect(await res.json()).toEqual({ outcome: 'verify_email' });

    const anonymous = await door(manager, { invitationId: invitation.id, name: 'X', password: PASSWORD });
    expect(anonymous.status).toBe(401);

    expect(userRow(engine, 'unverified@example.com')?.email_verified).toBeFalsy();
    expect(invitationOf(engine, 'unverified@example.com')?.status).toBe('pending');
  });

  it('a proof is single-use', async () => {
    const { manager, invite } = await boot();
    const { invitation, proof } = await invite('once@example.com');
    const first = await door(manager, { invitationId: invitation.id, proof, name: 'Once', password: PASSWORD });
    expect(first.status, await first.clone().text()).toBe(200);
    await expectRefused(await door(manager, { invitationId: invitation.id, proof, name: 'Once', password: PASSWORD }));
  });

  it('a proof that does not match is refused, creates nothing and leaves the real proof usable', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('guarded@example.com');
    await expectRefused(
      await door(manager, { invitationId: invitation.id, proof: `${proof.slice(0, -1)}x`, name: 'G', password: PASSWORD }),
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
    expect(await res.json()).toMatchObject({ outcome: 'accepted' });

    expect(await sessionUser(manager, earlier.cookie)).toBeNull();
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
    expect(await res.json()).toEqual({ outcome: 'sign_in' });

    expect(await sessionUser(manager, holder.cookie)).not.toBeNull();
    expect(invitationOf(engine, 'linked@example.com')?.status).toBe('pending');
    const samePassword = await post(manager, '/sign-in/email', { email: 'linked@example.com', password: PASSWORD });
    expect(samePassword.status, await samePassword.clone().text()).toBe(200);
    // Unspent: the same proof answers again.
    const again = await door(manager, { invitationId: invitation.id, proof, name: 'L', password: NEW_PASSWORD });
    expect(await again.json()).toEqual({ outcome: 'sign_in' });
  });

  it('the door is rate-limited per invitation', async () => {
    const { manager, invite } = await boot();
    const { invitation } = await invite('limited@example.com');
    for (let i = 0; i < 10; i++) {
      await expectRefused(await door(manager, { invitationId: invitation.id, proof: `wrong-${i}`, name: 'L', password: PASSWORD }));
    }
    const over = await door(manager, { invitationId: invitation.id, proof: 'wrong-x', name: 'L', password: PASSWORD });
    expect(over.status).toBe(429);
    expect((await over.json()).code).toBe('RATE_LIMITED');
  });

  it('a verified account signs in as today and the proof stays unspent', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation, proof } = await invite('verified@example.com');
    await signUp(manager, engine, 'verified@example.com');
    userRow(engine, 'verified@example.com')!.email_verified = true;

    const res = await door(manager, { invitationId: invitation.id, proof, name: 'V', password: NEW_PASSWORD });
    expect(await res.json()).toEqual({ outcome: 'sign_in' });
    const again = await door(manager, { invitationId: invitation.id, proof, name: 'V', password: NEW_PASSWORD });
    expect(await again.json()).toEqual({ outcome: 'sign_in' });
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
    expect(await res.json()).toMatchObject({ outcome: 'accepted', organizationId: PARTNER_ORG });
    expect(membersOf(engine, PARTNER_ORG, person.userId)).toHaveLength(1);
  });

  it('a session whose address is not verified is asked to verify, and nothing is accepted', async () => {
    const { engine, manager, invite } = await boot();
    const { invitation } = await invite('unsure@example.com');
    const person = await signUp(manager, engine, 'unsure@example.com');

    const res = await door(manager, { invitationId: invitation.id }, person.cookie);
    expect(await res.json()).toEqual({ outcome: 'verify_email' });
    expect(membersOf(engine, PARTNER_ORG, person.userId)).toHaveLength(0);
    expect(invitationOf(engine, 'unsure@example.com')?.status).toBe('pending');
  });
});
