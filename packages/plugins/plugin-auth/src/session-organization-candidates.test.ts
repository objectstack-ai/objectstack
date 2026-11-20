// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0069 TL;DR 6, D5 · ADR-0093 D9 — a host's `session.create.before` may
// hand plugin-auth an ORDERED list of candidate organizations
// (`session-organization-candidates.ts`); the session is scoped to the first
// one the organization's own allowed IP ranges admit, and none admitted is the
// refusal a single choice gets (`SESSION_SCOPING_REFUSAL`).
//
// Driven for real: a password sign-in through `AuthManager.handleRequest` with
// the transport peer as the established client address, a host hook composed
// through `databaseHooks`, and the `sys_session` row the sign-in wrote.
//
// ADR-0112 is `code` AND `status`; every refusal assertion carries both.

import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import type { AuthSessionAuditEventInput } from './auth-session-audit';
import type { SessionCreateBeforeResult } from './session-organization-candidates';
import { orderActiveOrganizationCandidates, readActiveOrganizationCandidates } from './session-organization-candidates';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-35829';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';

const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';
const ORG_C = 'org_gamma';
const IN_A = '10.1.0.7';
const IN_B = '10.2.0.7';
const IN_NONE = '10.9.0.7';

const REFUSED = { status: 403, code: 'IP_NOT_ALLOWED' };

type HostHook = (session: Record<string, any>) => Promise<SessionCreateBeforeResult | undefined | void>;

const post = (manager: AuthManager, path: string, body: unknown, remoteAddress: string) =>
  manager.handleRequest(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': 'probe/35829' },
      body: JSON.stringify(body),
    }),
    { remoteAddress },
  );

async function verdict(res: Response): Promise<{ status: number; code?: string }> {
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, code: body?.error?.code ?? body?.code };
}

/**
 * Alpha admits only 10.1.0.0/16, Beta only 10.2.0.0/16, Gamma only
 * 10.3.0.0/16; Alice is a member of all three. The host's hook is whatever
 * the test hands in, read when a session is created.
 */
async function deployment(options: { autoActiveOrganization?: boolean } = {}) {
  const events: AuthSessionAuditEventInput[] = [];
  const sink = { recordAuthEvent: vi.fn(async (e: AuthSessionAuditEventInput) => { events.push(e); }) };
  const engine = createMemoryEngine();
  let hostHook: HostHook | undefined;
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    getAuditSink: () => sink,
    ...(options.autoActiveOrganization === false ? { autoActiveOrganization: false } : {}),
    databaseHooks: {
      session: { create: { before: async (session: any) => (hostHook ? hostHook(session) : undefined) } },
    },
  } as any);
  vi.spyOn(manager as any, 'selfRegistrationSetResolvable').mockResolvedValue(true);
  const policies: Record<string, Record<string, unknown>> = {
    [ORG_A]: { allowed_ip_ranges: '10.1.0.0/16' },
    [ORG_B]: { allowed_ip_ranges: '10.2.0.0/16' },
    [ORG_C]: { allowed_ip_ranges: '10.3.0.0/16' },
  };
  manager.setOrganizationAccessPolicySource({
    read: async (id) => policies[id] ?? {},
    anyOrganizationRequiresMfa: async () => false,
  });
  const email = 'alice@candidates.test';
  const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: email }, '127.0.0.1');
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
  for (const [id, name] of [[ORG_A, 'Alpha'], [ORG_B, 'Beta'], [ORG_C, 'Gamma']]) {
    await engine.insert('sys_organization', { id, name, slug: name.toLowerCase() });
  }
  engine.tables.set('sys_member', (engine.tables.get('sys_member') ?? []).filter((m: any) => m.user_id !== user.id));
  await engine.insert('sys_member', { user_id: user.id, organization_id: ORG_A, role: 'member', created_at: new Date(Date.now() - 120_000) });
  await engine.insert('sys_member', { user_id: user.id, organization_id: ORG_B, role: 'member', created_at: new Date(Date.now() - 60_000) });
  await engine.insert('sys_member', { user_id: user.id, organization_id: ORG_C, role: 'member', created_at: new Date() });
  engine.tables.set('sys_session', []);
  events.length = 0;

  const signIn = (remoteAddress: string) => post(manager, '/sign-in/email', { email, password: PASSWORD }, remoteAddress);
  const host = (hook: HostHook | undefined) => { hostHook = hook; };
  /** The sessions the sign-ins wrote, oldest first. */
  const sessions = () => (engine.tables.get('sys_session') ?? []) as any[];
  const scopedTo = (row: any) => row?.active_organization_id ?? row?.activeOrganizationId;
  return { manager, engine, events, signIn, host, sessions, scopedTo, userId: String(user.id) };
}

describe('[#35829] a host\'s ordered organization candidates at session creation', () => {
  it('the first candidate refused by its IP list, the second admitted: the session lands on the second', async () => {
    const d = await deployment();
    d.host(async (session) => ({
      data: { ...session, activeOrganizationId: ORG_A },
      activeOrganizationCandidates: [ORG_B, ORG_C],
    }));

    const res = await d.signIn(IN_B);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(d.sessions()).toHaveLength(1);
    expect(d.scopedTo(d.sessions()[0])).toBe(ORG_B);
    // The list never reaches better-auth's write: only the chosen organization lands.
    expect(JSON.stringify(d.sessions()[0])).not.toContain('activeOrganizationCandidates');
    expect(d.events.map((e) => e.action)).toEqual(['login']);
    expect(d.events[0]?.organizationId).toBe(ORG_B);
  });

  it('the host\'s first choice admitted: it wins, the list is not consulted', async () => {
    const d = await deployment();
    d.host(async (session) => ({
      data: { ...session, activeOrganizationId: ORG_A },
      activeOrganizationCandidates: [ORG_B],
    }));
    expect((await d.signIn(IN_A)).status).toBe(200);
    expect(d.scopedTo(d.sessions()[0])).toBe(ORG_A);
  });

  it('a list with no data.activeOrganizationId: judged in its own order', async () => {
    const d = await deployment();
    d.host(async () => ({ activeOrganizationCandidates: [ORG_A, ORG_B] }));
    expect((await d.signIn(IN_B)).status).toBe(200);
    expect(d.scopedTo(d.sessions()[0])).toBe(ORG_B);
  });

  it('every candidate refused: the sign-in is refused as today, the row naming the host\'s first choice', async () => {
    const d = await deployment();
    d.host(async (session) => ({
      data: { ...session, activeOrganizationId: ORG_A },
      activeOrganizationCandidates: [ORG_B, ORG_C],
    }));

    const res = await d.signIn(IN_NONE);
    expect(await verdict(res)).toEqual(REFUSED);
    expect(d.sessions()).toEqual([]);
    expect(d.events).toEqual([
      expect.objectContaining({
        action: 'login_failed',
        userId: d.userId,
        organizationId: ORG_A,
        ipAddress: IN_NONE,
        context: expect.objectContaining({ reason: 'IP_NOT_ALLOWED', rule: 'ip_allow_list', attempts: 1 }),
      }),
    ]);
  });

  it('no candidates given: the single choice is judged and refused exactly as before', async () => {
    const d = await deployment();
    d.host(async (session) => ({ data: { ...session, activeOrganizationId: ORG_A } }));
    expect(await verdict(await d.signIn(IN_B))).toEqual(REFUSED);
    expect(d.sessions()).toEqual([]);
    expect((await d.signIn(IN_A)).status).toBe(200);
    expect(d.scopedTo(d.sessions()[0])).toBe(ORG_A);
  });

  it('an empty list is no list: refused as the single choice is', async () => {
    const d = await deployment();
    d.host(async (session) => ({ data: { ...session, activeOrganizationId: ORG_A }, activeOrganizationCandidates: [] }));
    expect(await verdict(await d.signIn(IN_B))).toEqual(REFUSED);
    expect(d.sessions()).toEqual([]);
  });

  it('no host choice at all: the framework\'s default organization, judged as before', async () => {
    const d = await deployment();
    d.host(undefined);
    // ADR-0093 D9: no owner row ⇒ the oldest membership, Alpha; Beta's address is refused.
    expect(await verdict(await d.signIn(IN_B))).toEqual(REFUSED);
    expect((await d.signIn(IN_A)).status).toBe(200);
    expect(d.scopedTo(d.sessions()[0])).toBe(ORG_A);
  });

  it('autoActiveOrganization: false — the host hook is the whole choice, and its list is honoured the same way', async () => {
    const d = await deployment({ autoActiveOrganization: false });
    d.host(async (session) => ({
      data: { ...session, activeOrganizationId: ORG_A },
      activeOrganizationCandidates: [ORG_B],
    }));
    expect((await d.signIn(IN_B)).status).toBe(200);
    expect(d.scopedTo(d.sessions()[0])).toBe(ORG_B);
    expect(await verdict(await d.signIn(IN_NONE))).toEqual(REFUSED);
  });

  it('a malformed list is a host bug and fails the creation loudly: no session', async () => {
    const d = await deployment();
    d.host(async (session) => ({
      data: { ...session, activeOrganizationId: ORG_A },
      activeOrganizationCandidates: [ORG_B, ''] as string[],
    }));
    const res = await d.signIn(IN_B);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(d.sessions()).toEqual([]);
  });
});

describe('[#35829] reading and ordering the host\'s candidates', () => {
  it('absent, undefined or empty reads as no list', () => {
    expect(readActiveOrganizationCandidates(undefined)).toBeUndefined();
    expect(readActiveOrganizationCandidates({ data: {} })).toBeUndefined();
    expect(readActiveOrganizationCandidates({ activeOrganizationCandidates: undefined })).toBeUndefined();
    expect(readActiveOrganizationCandidates({ activeOrganizationCandidates: [] })).toBeUndefined();
  });

  it('anything but an array of non-empty strings is refused', () => {
    for (const bad of ['org_a', [1], [''], [null], {}]) {
      expect(() => readActiveOrganizationCandidates({ activeOrganizationCandidates: bad })).toThrow(TypeError);
    }
  });

  it('the host\'s first choice leads, the list follows, a repeat is judged once', () => {
    expect(orderActiveOrganizationCandidates(ORG_A, [ORG_B, ORG_A, ORG_C, ORG_B])).toEqual([ORG_A, ORG_B, ORG_C]);
    expect(orderActiveOrganizationCandidates(undefined, [ORG_B, ORG_C])).toEqual([ORG_B, ORG_C]);
  });
});
