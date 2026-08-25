// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11767] The audience gate's BOOTSTRAP BYPASS, pinned at the seam that
 * carries it — over a REAL `ObjectQL` engine.
 *
 * ## What shipped, and why every existing test stayed green
 *
 * #11739 made `invite_only` the default audience posture and enforced it at
 * better-auth's `user.validateUserInfo` seam. The declared carve-out is that a
 * fresh install never locks its operator out: with no users yet, the first
 * account is admitted under every posture. `decideAudienceAdmission` (pure)
 * implemented that correctly and a full matrix pinned it. The WIRING did not,
 * and the wiring had no pin of its own:
 *
 *   `isBootstrapCreation` probed `ctx.context.adapter.findOne({ model: 'user',
 *   where: [] })`. `where: []` lowers to an empty filter, and the real engine's
 *   `requireFindOnePredicate` (#4419) REFUSES a `findOne` that selects no
 *   particular record — it throws rather than returning an arbitrary row. The
 *   surrounding `catch { return false; }` turned that refusal into "not
 *   bootstrap", so EVERY bootstrap creation was refused with
 *   `SELF_REGISTRATION_CLOSED`, including the dev-admin seed's own.
 *
 * The in-memory engine double used by the sibling matrix has no such guard: it
 * treats an absent filter as "match everything", returns `null` on an empty
 * table, and reports bootstrap correctly. So the defect was invisible to every
 * unit suite and surfaced only when the Dogfood Regression Gate and the verify
 * harness booted real stacks whose fixtures all start from `stack.signIn()` on
 * the seeded dev admin.
 *
 * ## Why this file uses a real engine, and drives the SERVER-SIDE lane
 *
 * Two deliberate choices, each aimed at one half of what went unmeasured:
 *
 *  1. **A real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3
 *     `:memory:`** — the same backend the at-rest pins use. `requireFindOnePredicate`
 *     is the mechanism that broke this; a fake without it cannot pin the fix.
 *     Case ⓪ asserts that mechanism directly, so the reason these cases are
 *     non-vacuous is itself under test rather than merely asserted in prose.
 *  2. **`api.signUpEmail({ body })`, not an HTTP request** — that is the exact
 *     call the dev-admin seed makes (`auth-plugin.ts` `maybeSeedDevAdmin`), and
 *     it reaches `validateUserInfo` through better-auth's server-side endpoint
 *     context rather than a request. Case ① is that lane; case ② keeps the HTTP
 *     lane beside it so a future change cannot fix one and break the other.
 *
 * ## The population question, pinned as a decision
 *
 * "Bootstrap" counts NON-SYSTEM HUMANS, not `sys_user` rows — see
 * {@link isHumanUserRow} for the argument. Case ④ is that decision's pin: a
 * database still carrying the legacy `usr_system` service row (no longer
 * provisioned, but present in every DB an older runtime created) is still a
 * bootstrap, because plugin-security's first-user detection and the dev seed's
 * own precondition both say so — and a gate that disagreed with them would
 * refuse the very sign-up plugin-security stands ready to promote.
 *
 * Case ③ is the control that keeps the bypass honest: it must not have become
 * "always admit".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { SELF_REGISTRATION_CLOSED, isHumanUserRow } from './audience-posture.js';
import {
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
} from '@objectstack/platform-objects';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-11767';
const PASSWORD = 'S3cure!Passw0rd-11767';

const AUTH_OBJECTS = [
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  for (const object of AUTH_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return engine;
}

function makeManager(engine: ObjectQL, config: Record<string, unknown> = {}): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    ...config,
  } as never);
}

/** Every `sys_user` row, read below the gate. */
async function readUsers(engine: ObjectQL): Promise<Record<string, unknown>[]> {
  const rows = await engine.find(
    'sys_user',
    { limit: 100 },
    { context: { isSystem: true } } as never,
  );
  return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
}

/**
 * The dev-admin seed's OWN lane: better-auth's server-side API, not an HTTP
 * request (`auth-plugin.ts` → `api.signUpEmail({ body })`).
 */
async function seedLaneSignUp(
  manager: AuthManager,
  email: string,
): Promise<{ ok: boolean; message: string }> {
  const api = (await manager.getApi()) as unknown as {
    signUpEmail(input: { body: Record<string, unknown> }): Promise<unknown>;
  };
  try {
    await api.signUpEmail({ body: { email, password: PASSWORD, name: 'Bootstrap Operator' } });
    return { ok: true, message: '' };
  } catch (error: unknown) {
    const e = error as { message?: string; body?: { message?: string; code?: string } };
    return { ok: false, message: e?.body?.message ?? e?.message ?? String(error) };
  }
}

/** The HTTP lane, for the same question. */
function httpSignUp(manager: AuthManager, email: string): Promise<Response> {
  return manager.handleRequest(
    new Request(`${AUTH}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Bootstrap Operator' }),
    }),
  );
}

describe('[#11767] the bootstrap bypass fires at the real seam', () => {
  it('⓪ the MECHANISM: the real engine REFUSES a predicate-less findOne (#4419) — which is why a fake cannot pin this', async () => {
    const engine = await bootEngine();
    // This is the shape `isBootstrapCreation` used to ask through the
    // better-auth adapter. It does not answer "no users"; it throws — and a
    // `catch` around it reads as "users exist".
    await expect(
      engine.findOne('sys_user', { where: {} }, { context: { isSystem: true } } as never),
    ).rejects.toThrow(/selects no particular record/i);
    // The answerable form the fix uses, on the same empty table.
    const page = await engine.find(
      'sys_user',
      { limit: 50 },
      { context: { isSystem: true } } as never,
    );
    expect(page).toEqual([]);
  });

  it('① THE DEFECT: the dev-seed lane (server-side api.signUpEmail) is ADMITTED on a zero-user database', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);

    const result = await seedLaneSignUp(manager, 'admin@objectos.ai');

    expect(result.ok, `the operator's own first account was refused: ${result.message}`).toBe(true);
    expect(result.message).not.toContain('Self-registration is closed');
    const users = await readUsers(engine);
    expect(users.map((u) => u.email)).toEqual(['admin@objectos.ai']);
  });

  it('② the HTTP lane answers the same on a zero-user database', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);

    const res = await httpSignUp(manager, 'owner@example.com');

    expect(res.status, `sign-up/email refused: ${await res.clone().text()}`).toBeLessThan(300);
    expect((await readUsers(engine)).length).toBe(1);
  });

  it('③ CONTROL: the bypass did not become "always admit" — a second self-serve signup is still refused 403', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);

    expect((await seedLaneSignUp(manager, 'admin@objectos.ai')).ok).toBe(true);
    const res = await httpSignUp(manager, 'stranger@example.com');

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string; message?: string };
    expect(body.code).toBe(SELF_REGISTRATION_CLOSED);
    // The refusal really refused.
    expect((await readUsers(engine)).length).toBe(1);
  });

  it('④ THE POPULATION DECISION: a legacy usr_system row is not a human — the first human sign-up is still bootstrap', async () => {
    const engine = await bootEngine();
    // The service account an older runtime provisioned. It is NOT a human, and
    // plugin-security's first-user detection agrees (it would still promote the
    // next sign-up to platform admin).
    await engine.insert(
      'sys_user',
      { id: 'usr_system', email: 'system@localhost', name: 'System', role: 'system' },
      { context: { isSystem: true } } as never,
    );
    const manager = makeManager(engine);

    const result = await seedLaneSignUp(manager, 'admin@objectos.ai');

    expect(result.ok, `a legacy usr_system row locked the operator out: ${result.message}`).toBe(
      true,
    );
    const users = await readUsers(engine);
    expect(users.filter(isHumanUserRow).map((u) => u.email)).toEqual(['admin@objectos.ai']);
    // …and now that a human exists, the gate closes again.
    const second = await httpSignUp(manager, 'stranger@example.com');
    expect(second.status).toBe(403);
    expect(((await second.json()) as { code?: string }).code).toBe(SELF_REGISTRATION_CLOSED);
  });

  it('⑤ the SIBLING bypass — disableSignUp — fires on the same probe, and re-closes once the operator exists', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine, { emailAndPassword: { disableSignUp: true } });

    const first = await httpSignUp(manager, 'owner@example.com');
    expect(first.status, `the disableSignUp bootstrap bypass did not fire: ${await first.clone().text()}`).toBeLessThan(300);

    const second = await httpSignUp(manager, 'stranger@example.com');
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect((await readUsers(engine)).length).toBe(1);
  });
});
