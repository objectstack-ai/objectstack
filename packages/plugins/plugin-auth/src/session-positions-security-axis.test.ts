// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The session payload's `positions[]` is the SECURITY axis (#15136).
//
// `EvalUserSchema` (`packages/spec/src/identity/eval-user.zod.ts`) declares one
// contract for the whole platform: the signed-in user is "exposed to every
// predicate surface (server formula, server RLS, client UI gates) under the
// canonical variable name `current_user` ... with an IDENTICAL shape", and its
// `positions` field is "built-in identity names + POSITION names". The Console
// binds that root straight from the `get-session` payload (objectui
// `packages/app-shell/src/providers/expressionUser.ts` — `positions:
// user.positions ?? []`, a pass-through), so whatever `customSession` derives
// IS `current_user.positions` for every client-side `visible` / `visibleWhen`
// gate.
//
// It derived the wrong axis. The union was the better-auth `sys_user.role`
// scalar split on commas, plus the active membership mapped to `org_*`, plus
// `platform_admin` — and NOTHING from `sys_user_position`, the ADR-0057 D4
// table that is the source of truth for custom positions. A user genuinely
// holding `demo_reviewer` got `["user","org_member"]`, so a button narrowed by
// that position vanished for EVERYONE, including its holder.
//
// ⭐ Why the failure is silent, and why that is the whole defect: the root IS
// bound and the key IS present, so `has(current_user.positions)` is true, CEL
// raises nothing, and the predicate simply answers FALSE. A faulting predicate
// fails OPEN in the shell (objectui `evaluateVisibility`) and would at least
// have shown the button; a successful FALSE shows nothing and reports nothing.
// The documented example survived because `org_admin` happens to sit on BOTH
// axes — the one name that could not reveal the split.
//
// The pins below drive the REAL pipeline in both halves: a real better-auth
// instance over a real `AuthManager` answering a real `getSession()`, and the
// real `celEngine` from `@objectstack/formula` — the same engine the server
// evaluates formulas and RLS with — over the payload that session returns. No
// fixture stands in for either side, because the defect lived exactly in the
// seam between them.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { AuthManager } from './auth-manager';
// Imported from a sibling TEST file for the reason `platform-admin-standing.
// consolidation.test.ts` documents at its own import: re-registering that
// file's `describe`s here is cheaper than minting a second engine double (a
// second looseness risk plus new `check:engine-double-contract` ledger rows).
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-15136';
const BASE = 'http://localhost:3000/api/v1/auth';
const ORG = 'org_15136';

/** The card's own position name, verbatim. */
const POSITION = 'demo_reviewer';

/**
 * The card's own `action.visible` predicate, verbatim minus the `record` half
 * (this suite is about the identity root; the record half is another axis).
 */
const VISIBLE = `'${POSITION}' in current_user.positions`;

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

/** The REAL session payload, through a real better-auth `getSession()`. */
const payloadFor = async (manager: AuthManager, bearer: string) => {
  const auth: any = await manager.getAuthInstance();
  const session = await auth.api
    .getSession({ headers: new Headers({ authorization: `Bearer ${bearer}` }) })
    .catch(() => null);
  return session?.user ?? null;
};

/**
 * Evaluate a predicate exactly as a shell gate does: bind the session payload
 * as `current_user` and run it through the real CEL engine.
 *
 * Returns the discriminated result rather than a boolean, so a FAULT can never
 * be read as a `false` — telling those two apart is the point of the suite.
 */
const evaluateVisible = (source: string, user: any) =>
  celEngine.evaluate<boolean>({ dialect: 'cel', source } as any, { user });

/**
 * Two principals over one engine, both members of the same organization. Only
 * `holder` is assigned the position — `bystander` is the in-test control that
 * keeps every "the button shows" assertion from passing vacuously.
 */
const arrange = async (opts: { assignPosition?: boolean } = {}) => {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);

  await signUp(manager, 'holder@example.com', 'Position Holder');
  await signUp(manager, 'bystander@example.com', 'Bystander');

  const holderId = userIdFor(engine, 'holder@example.com');
  const bystanderId = userIdFor(engine, 'bystander@example.com');

  await engine.insert('sys_organization', { id: ORG, name: 'Card Org', slug: 'card-org' });
  await engine.insert('sys_member', { organization_id: ORG, user_id: holderId, role: 'member' });
  await engine.insert('sys_member', { organization_id: ORG, user_id: bystanderId, role: 'member' });

  // The security-layer position, and the ADR-0057 D4 assignment row that is its
  // source of truth. `organization_id: null` = a global assignment, so the
  // fixture does not also depend on the session carrying an active org.
  await engine.insert('sys_position', { id: 'pos_reviewer', name: POSITION, label: 'Demo Reviewer' });
  if (opts.assignPosition !== false) {
    await engine.insert('sys_user_position', {
      user_id: holderId,
      position: POSITION,
      organization_id: null,
    });
  }

  const holderBearer = bearerFrom(await signIn(manager, 'holder@example.com'));
  const bystanderBearer = bearerFrom(await signIn(manager, 'bystander@example.com'));
  return { engine, manager, holderId, bystanderId, holderBearer, bystanderBearer };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
// PIN 1 — the card, inverted. The holder sees the button; the bystander does
// not. Asserted as the ruled behaviour, not as the defect.
// ───────────────────────────────────────────────────────────────────────────
describe('a position-narrowed `visible` predicate resolves on the session payload', () => {
  it('carries the assigned security position into the payload', async () => {
    const { manager, holderBearer } = await arrange();
    const user = await payloadFor(manager, holderBearer);
    expect(user?.positions, JSON.stringify(user?.positions)).toContain(POSITION);
  });

  it('shows the button to the holder — and hides it from the bystander on the same engine', async () => {
    const { manager, holderBearer, bystanderBearer } = await arrange();

    const held = evaluateVisible(VISIBLE, await payloadFor(manager, holderBearer));
    expect(held, JSON.stringify(held)).toMatchObject({ ok: true, value: true });

    // The control. Without it, a predicate that answered `true` for everyone
    // (an evaluator bug, a scope that binds nothing) would score green above.
    const notHeld = evaluateVisible(VISIBLE, await payloadFor(manager, bystanderBearer));
    expect(notHeld, JSON.stringify(notHeld)).toMatchObject({ ok: true, value: false });
  });

  it('hides it from the holder once the assignment row is gone (the axis is the ROW, not the name)', async () => {
    const { manager, holderBearer } = await arrange({ assignPosition: false });
    const v = evaluateVisible(VISIBLE, await payloadFor(manager, holderBearer));
    expect(v, JSON.stringify(v)).toMatchObject({ ok: true, value: false });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PIN 2 — the silence itself. The root and the key are bound in EVERY case, so
// a regression can only ever show up as a wrong verdict, never as a fault. This
// is what made the defect invisible, and it is pinned so a future "fix" that
// merely makes the predicate fault (which fails OPEN in the shell, showing the
// button to everyone) cannot be mistaken for a repair.
// ───────────────────────────────────────────────────────────────────────────
describe('the predicate root stays bound — the failure mode was a FALSE, never a fault', () => {
  it('`has(current_user.positions)` is true for holder and bystander alike', async () => {
    const { manager, holderBearer, bystanderBearer } = await arrange();
    for (const bearer of [holderBearer, bystanderBearer]) {
      const v = evaluateVisible('has(current_user.positions)', await payloadFor(manager, bearer));
      expect(v, JSON.stringify(v)).toMatchObject({ ok: true, value: true });
    }
  });

  it('the position-narrowed predicate never FAULTS — it answers, one way or the other', async () => {
    const { manager, holderBearer, bystanderBearer } = await arrange();
    for (const bearer of [holderBearer, bystanderBearer]) {
      const v = evaluateVisible(VISIBLE, await payloadFor(manager, bearer));
      expect(v.ok, JSON.stringify(v)).toBe(true);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PIN 3 — ADR-0068 D1 parity, which is the contract the card actually broke:
// the payload's `positions` must be the SAME axis `/auth/me/permissions` and
// every server-side evaluator resolve, i.e. the one `resolveUserAuthzGrants`
// yields. Pinned as a set comparison against the authority itself rather than
// against a literal list, so it keeps holding as that authority grows.
// ───────────────────────────────────────────────────────────────────────────
describe('the payload agrees with the ONE authorization authority, set for set', () => {
  it('matches `resolveUserAuthzGrants` for the position holder', async () => {
    const { engine, manager, holderId, holderBearer } = await arrange();
    const { resolveUserAuthzGrants } = await import('@objectstack/core');

    const payload = await payloadFor(manager, holderBearer);
    const grants = await resolveUserAuthzGrants(engine as any, holderId);

    expect([...(payload?.positions ?? [])].sort()).toEqual([...grants.positions].sort());
    // Not vacuous: the authority really did resolve the position.
    expect(grants.positions).toContain(POSITION);
  });

  it('carries the ADR-0090 D5 `everyone` anchor the authority adds', async () => {
    const { manager, holderBearer } = await arrange();
    const user = await payloadFor(manager, holderBearer);
    expect(user?.positions, JSON.stringify(user?.positions)).toContain('everyone');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PIN 4 — ADR-0068 D2 is untouched. `platform_admin` reaches the payload the
// way it always did, and the stored `role` scalar is still never overwritten.
// Without this the change could quietly drop a derivation the gates depend on.
// ───────────────────────────────────────────────────────────────────────────
describe('the platform-admin derivation and the stored role scalar are unchanged', () => {
  it('a plain member is not a platform admin and keeps its role scalar', async () => {
    const { manager, holderBearer } = await arrange();
    const user = await payloadFor(manager, holderBearer);
    expect(user?.isPlatformAdmin).toBe(false);
    expect(user?.positions ?? []).not.toContain('platform_admin');
    expect(user?.role ?? 'user').not.toBe('admin');
  });
});
