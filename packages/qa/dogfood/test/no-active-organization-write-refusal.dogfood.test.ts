// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0123 D2 / #8208] The HTTP-level proof that an authenticated caller with
// NO active organization cannot land a tenant-scoped row.
//
// ## Why this file exists — it makes a measurement DELIBERATE that arrived by
// accident
//
// #8208 was filed from a booted showcase stack: a seeded platform admin, whose
// resolved authz context carries no `tenantId` at all, created a record through
// the real HTTP path under an ACTIVE Layer 0 wall. The write answered 2xx, the
// row was stored with `organization_id: null`, and the read wall then hid it
// from every reader — including the admin who had just created it:
//
//     POST /api/v1/data/showcase_private_note   -> 2xx, row created
//       stored row: { owner_id: 'PK07N5…', organization_id: null }
//     GET  /api/v1/data/showcase_private_note   -> 200 {"records":[],"total":0}
//     GET  /api/v1/data/showcase_private_note/:id -> 404
//
// The ADR-0123 D2 refusal closes that by refusing the write. When it landed,
// the FIRST evidence that it fires over real HTTP was a sibling dogfood fixture
// going red on its own setup step (`federated-phantom-share-grant`, whose
// `beforeAll` created exactly this control note as this exact caller). That is
// a real measurement, but it is a fragile place to keep one: the next author to
// touch that fixture would silently delete it, and a fixture that is green
// again carries no record of what it was red FOR.
//
// So the measurement moves here, as an assertion that exists to hold it.
//
// ## Anti-vacuity
//
// Three ways this file could pass while proving nothing, each closed by a pin:
//
//  1. **The wall might not be on.** Then every write is ordinary and a refusal
//     would mean something else entirely. PRECONDITION 1 asserts the posture in
//     force is a walled one.
//  2. **The admin might actually HAVE an organization.** Then the refusal under
//     test could never fire and a green file would be measuring nothing.
//     PRECONDITION 2 asserts the resolved context carries no `tenantId` — the
//     exact fact #8208 reported, re-measured rather than assumed.
//  3. **The 403 might be any other 403.** `showcase_private_note` is an
//     owner-private object behind a CRUD gate that also answers 403
//     `PERMISSION_DENIED`; a status-only assertion cannot tell them apart. So
//     the refusal is pinned on its MESSAGE (it must name the missing active
//     organization), and — the decisive leg — the SAME caller, on the SAME
//     object, through the SAME route, SUCCEEDS once a `sys_member` row exists.
//     One fact differs between the refusal and the success: the organization.
//
// @proof: no-active-organization-write-refusal

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { resolveAuthzContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/** The owner-private LOCAL object #8208 measured on. */
const LOCAL = 'showcase_private_note';
const SYS = { isSystem: true } as ExecutionContext;
const ORG = 'org_8208_pin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

describe('[ADR-0123 D2 / #8208] a tenant-scoped write with no active organization is refused over HTTP', () => {
  let stack: VerifyStack;
  let ql: IObjectQLEngine;
  let adminToken: string;
  let adminId: string;
  /** The admin's tenant as the session resolved it BEFORE any membership. */
  let tenantBefore: unknown;

  beforeAll(async () => {
    // `posture-only` is the mode #8208 measured on: it requests the `isolated`
    // posture (the wall is ACTIVE) without the enterprise organizations runtime.
    stack = await bootStack(showcaseStack, { multiTenant: 'posture-only' });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    adminToken = await stack.signIn();

    const adminCtx = await resolveAuthzContext({
      ql,
      headers: new Headers({ authorization: `Bearer ${adminToken}` }),
      getSession: async (h: unknown) => {
        const authService = await stack.kernel.getServiceAsync<{
          api?: { getSession?(a: { headers: unknown }): Promise<unknown> };
          getApi?(): Promise<{ getSession?(a: { headers: unknown }): Promise<unknown> }>;
        }>('auth');
        const api = authService?.api ?? (await authService?.getApi?.());
        return api?.getSession?.({ headers: h });
      },
    } as never) as ExecutionContext;
    adminId = String(adminCtx.userId);
    tenantBefore = (adminCtx as unknown as { tenantId?: unknown }).tenantId;
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  // ── preconditions: both halves of the state, measured not assumed ────────

  it('PRECONDITION: a real signed-in admin principal', () => {
    expect(adminId, 'a real signed-in admin principal').toBeTruthy();
  });

  it('PRECONDITION: the Layer 0 wall is ACTIVE on this boot', async () => {
    // Asked of the `tenancy` service — the declared single source of truth for
    // "what posture is this deployment in?" (ADR-0093 D4 / ADR-0105 D1), and
    // the same fact Layer 0 switches on. A DEGRADED boot resolves to `single`,
    // and under `single` Layer 0 contributes nothing at all: every case below
    // would then be measuring an unwalled deployment where the refusal could
    // never fire, and the file would be vacuous while green.
    const tenancy = await stack.kernel.getServiceAsync<{
      posture: string;
      isolationActive: boolean;
      degraded: boolean;
    }>('tenancy');
    expect(tenancy?.posture, 'tenancy posture in force').toBe('isolated');
    expect(tenancy?.isolationActive, 'the organization wall is actually enforced').toBe(true);
    // `degraded` is the trap this pair exists to catch: a walled posture that
    // was REQUESTED but cannot be enforced resolves to `single` and sets this,
    // so asking only what was requested would let the file pass on a boot with
    // no wall at all.
    expect(tenancy?.degraded, 'the wall is not degraded').toBe(false);
  });

  it("PRECONDITION: the admin's session carries NO active organization — #8208's own fact", () => {
    // Re-measured, not assumed. `posture-only` requests a walled posture, and
    // the open default-org bootstrap deliberately abstains under every walled
    // posture — so nothing binds this admin and nothing can stamp their session.
    expect(tenantBefore ?? null, "the admin's resolved tenantId").toBeNull();
  });

  // ── the refusal, over the real HTTP path ────────────────────────────────

  it('POST is refused 403, and the refusal NAMES the missing active organization', async () => {
    const res = await stack.apiAs(adminToken, 'POST', `/data/${LOCAL}`, {
      title: '#8208 refusal pin', body: 'must not land',
    });
    expect(res.status, 'the org-less write must be refused').toBe(403);

    const body = await res.json() as { error?: string; code?: string };
    // The ADR-0112 envelope, both halves — a status alone cannot distinguish a
    // conforming refusal from any other 403 on this route.
    expect(body.code).toBe('PERMISSION_DENIED');
    // ADR-0123 D4: the refusal states WHAT IS MISSING. Without this the message
    // is indistinguishable from a permission denial and sends whoever is
    // debugging to audit permission sets that are perfectly fine.
    expect(body.error ?? '').toMatch(/no active organization/i);
    expect(body.error ?? '').toMatch(/organization to place the record in/i);
  });

  it('and NOTHING was written — the refusal is not a 403 after the fact', async () => {
    // #8208's defect was a write that SUCCEEDED and then hid. A refusal that
    // still landed the row would reproduce it exactly while looking fixed, so
    // the store is asked under a SYSTEM context, which no wall narrows.
    const rows = rowsOf(await ql.find(LOCAL, {
      where: { title: '#8208 refusal pin' }, limit: 5, context: SYS,
    }));
    expect(rows, 'no row may exist for the refused write').toHaveLength(0);
  });

  // ── the decisive control: ONE fact differs ──────────────────────────────

  it('CONTROL: the SAME caller, object and route SUCCEED once a membership exists', async () => {
    // This is what makes the refusal above attributable to the missing
    // organization rather than to this object's CRUD/ownership gates, which
    // answer 403 PERMISSION_DENIED on the very same route.
    //
    // The membership is inserted by hand on purpose: `bootStack`'s `orgContext`
    // option REFUSES to compose with `multiTenant` (it would be a no-op under a
    // walled posture, which is the vacuity #7762 closed), so an org-bound caller
    // under `posture-only` has no harness answer today.
    await ql.insert('sys_organization', { id: ORG, name: 'Pin Org', slug: ORG }, { context: SYS });
    await ql.insert(
      'sys_member',
      { id: 'mem_8208_pin', organization_id: ORG, user_id: adminId, role: 'owner' },
      { context: SYS },
    );

    // A FRESH session: `session.create.before` resolves the active organization
    // at mint time, so the existing token cannot pick the membership up.
    const boundToken = await stack.signIn();
    const res = await stack.apiAs(boundToken, 'POST', `/data/${LOCAL}`, {
      title: '#8208 control note', body: 'must land',
    });
    expect(res.status, 'the org-bound write must land').toBeLessThan(300);

    const rows = rowsOf(await ql.find(LOCAL, {
      where: { title: '#8208 control note' }, limit: 5, context: SYS,
    }));
    expect(rows, 'the control row exists').toHaveLength(1);
    expect(rows[0]?.owner_id, 'owned by its creator').toBe(adminId);
  });
});
