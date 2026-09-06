// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Three-way agreement on platform-admin standing (#15136, contract review).
//
// Three predicates answer "is this principal a platform operator?", and all
// three are reachable from one request:
//
//   1. `session.user.isPlatformAdmin` — the payload alias `customSession` emits;
//   2. `judgePlatformAdmin(session)` — the gate on the `/admin/*` mount
//      (`auth-plugin.ts` `gateAdmin`), fed by that same payload;
//   3. `hasPlatformAdminStanding(engine, userId)` — the ADR-0095 D3 posture
//      rung, used by `/sso/register` and `/admin/impersonate-user`.
//
// ⭐ WHY THIS SUITE EXISTS, and what it is NOT. Ruling A moved `positions[]` to
// the security axis, which carries ADR-0057 D4 `sys_user_position` names. That
// table is `apiEnabled`: a tenant-level admin passes the ADR-0090 D12 gate
// outright, and a delegate holding `manageAssignments` passes
// `assertAssignmentWrite`'s `boundSets.every(...)` VACUOUSLY for a position that
// carries no position-bound set. So a tenant can cause the string
// `platform_admin` to appear in their own `positions[]`.
//
// Any predicate that reads that NAME therefore stopped being an authorization
// answer the moment ruling A landed — which is exactly what
// `resolve-authz-context.ts` warns about at `hasPlatformAdminStanding`:
//
//   ⛔ Read the RUNG — never `positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN)`.
//   The positions list is wider on purpose: an ADR-0057 D4 `sys_user_position`
//   row may spell that very name, and a platform-RBAC assignment is not the D2
//   capability grant.
//
// ⚠️ POPULATION OF THIS PIN, stated because a pin proves only what it covers:
// it covers the D4-spelled-built-in-name shape and a genuine-grant control. It
// does NOT cover the ADR-0091 validity window, the ADR-0049 catalogue flag, or
// the catalogue-page shapes — those are `platform-admin-standing.consolidation.
// test.ts`'s population, and that suite passing is NOT evidence about this one.
// It was green throughout the window in which this escalation was live.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { hasPlatformAdminStanding } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { judgePlatformAdmin, isPlatformAdminUser } from './platform-admin-gate';
// Sibling-test import for the engine double — the precedent documented at
// `platform-admin-standing.consolidation.test.ts`'s own import of it.
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-15136';
const BASE = 'http://localhost:3000/api/v1/auth';
const ORG = 'org_rung';
const PS_ADMIN = 'ps_admin_full_access';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
  } as any);

const signUp = (manager: AuthManager, email: string, name: string) => {
  inviteForAudienceGate(manager, email);
  return manager.handleRequest(
    new Request(`${BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );
};

const signIn = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request(`${BASE}/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );

const bearerFrom = (response: Response): string => {
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('no set-auth-token on the response');
  return token;
};

const userIdFor = (engine: any, email: string): string => {
  const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/** The whole SESSION object, not just `user` — `judgePlatformAdmin` takes the envelope. */
const sessionFor = async (manager: AuthManager, bearer: string) => {
  const auth: any = await manager.getAuthInstance();
  return auth.api
    .getSession({ headers: new Headers({ authorization: `Bearer ${bearer}` }) })
    .catch(() => null);
};

/**
 * `shape: 'name-only'` — the escalation: a plain org member plus a D4 row
 * SPELLING the built-in name, and no capability grant behind it.
 * `shape: 'genuine'`   — the control: a real unscoped `admin_full_access` grant.
 */
const arrange = async (shape: 'name-only' | 'genuine') => {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);

  await signUp(manager, 'subject@example.com', 'Subject');
  const userId = userIdFor(engine, 'subject@example.com');

  await engine.insert('sys_organization', { id: ORG, name: 'Rung Org', slug: 'rung-org' });
  await engine.insert('sys_member', { organization_id: ORG, user_id: userId, role: 'member' });

  if (shape === 'name-only') {
    // Exactly what a tenant admin can write through the `apiEnabled`
    // `sys_user_position` surface: a position whose NAME is the built-in.
    await engine.insert('sys_position', { id: 'pos_pa', name: 'platform_admin', label: 'Platform Admin' });
    await engine.insert('sys_user_position', {
      user_id: userId,
      position: 'platform_admin',
      organization_id: null,
    });
  } else {
    await engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
    await engine.insert('sys_user_permission_set', {
      user_id: userId,
      permission_set_id: PS_ADMIN,
      organization_id: null,
    });
  }

  const bearer = bearerFrom(await signIn(manager, 'subject@example.com'));
  return { engine, manager, userId, bearer };
};

/** All three answers, read off one arranged principal. */
const verdicts = async (shape: 'name-only' | 'genuine') => {
  const { engine, manager, userId, bearer } = await arrange(shape);
  const session = await sessionFor(manager, bearer);
  return {
    positions: (session?.user?.positions ?? []) as string[],
    alias: session?.user?.isPlatformAdmin === true,
    gate: judgePlatformAdmin(session).ok,
    rung: await hasPlatformAdminStanding(engine as any, userId),
  };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('a `sys_user_position` row spelling `platform_admin` confers NO platform standing', () => {
  it('the name IS in positions[] — the premise, without which the rest is vacuous', async () => {
    const v = await verdicts('name-only');
    expect(v.positions, JSON.stringify(v.positions)).toContain('platform_admin');
  });

  it('all three answers are FALSE, and they agree with each other', async () => {
    const v = await verdicts('name-only');
    expect(
      { alias: v.alias, gate: v.gate, rung: v.rung },
      `positions=${JSON.stringify(v.positions)}`,
    ).toEqual({ alias: false, gate: false, rung: false });
  });

  it('the /admin/* mount gate refuses it 403 PERMISSION_DENIED', async () => {
    const { manager, bearer } = await arrange('name-only');
    const verdict = judgePlatformAdmin(await sessionFor(manager, bearer));
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.refusal.status).toBe(403);
    expect(!verdict.ok && verdict.refusal.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('`isPlatformAdminUser` refuses the payload directly', async () => {
    const { manager, bearer } = await arrange('name-only');
    const session = await sessionFor(manager, bearer);
    expect(isPlatformAdminUser(session?.user)).toBe(false);
  });
});

describe('CONTROL — a genuine unscoped admin_full_access grant still admits', () => {
  it('all three answers are TRUE, and they agree with each other', async () => {
    const v = await verdicts('genuine');
    expect(
      { alias: v.alias, gate: v.gate, rung: v.rung },
      `positions=${JSON.stringify(v.positions)}`,
    ).toEqual({ alias: true, gate: true, rung: true });
  });

  it('the derived built-in is projected into positions[] as before', async () => {
    const v = await verdicts('genuine');
    expect(v.positions).toContain('platform_admin');
  });
});

describe('the two shapes are INDISTINGUISHABLE by name and separable only by the rung', () => {
  it('both carry `platform_admin` in positions[]; only the granted one has standing', async () => {
    const escalation = await verdicts('name-only');
    const genuine = await verdicts('genuine');

    // Identical on the axis a name-reading predicate would consult …
    expect(escalation.positions).toContain('platform_admin');
    expect(genuine.positions).toContain('platform_admin');

    // … and opposite on the axis that actually decides. This is the whole
    // finding: `positions.includes('platform_admin')` cannot tell these apart.
    expect(escalation.rung).toBe(false);
    expect(genuine.rung).toBe(true);
    expect(escalation.gate).toBe(false);
    expect(genuine.gate).toBe(true);
  });
});
