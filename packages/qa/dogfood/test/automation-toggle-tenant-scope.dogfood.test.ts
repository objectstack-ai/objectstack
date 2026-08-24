// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10243 — the toggle card, now RULED: `POST /automation/:name/toggle` is
 * gated on `manage_metadata`, and this file pins the closed door over HTTP.
 *
 * ## ⭐ This file was re-pointed, and the re-pointing is the record
 *
 * It first landed (PR #10996) as a pure MEASUREMENT of the open half of the
 * card: whether one tenant's ungated toggle reached every organization. It
 * did — and it said, in this docblock, that a ruling *"flips these expectations
 * to a 403, and the flip is the point — an unrecorded verdict cannot be
 * revisited."* The ruling landed on 2026-08-23 (option A: toggle joins the
 * `manage_metadata` write set, one arm on the existing `isFlowAuthoringWrite`,
 * ⛔ no new capability name), so the flip is now taken, deliberately and in the
 * same PR as the predicate change rather than left to go silently red.
 *
 * ## What was measured BEFORE the gate — the reason the ruling went this way
 *
 * On this same harness, with a real non-degraded `isolated` posture and two org
 * owners in DIFFERENT organizations: tenant A — holding `organization_admin`,
 * demonstrably NOT `manage_metadata`, and answered 403 by `PUT /meta/...`,
 * `POST /automation` and `DELETE /automation/:name` at the same session —
 * switched the CRM app's shipped flow off with a 200, and tenant B and the
 * platform admin both read it off. Symmetrically, in both directions.
 *
 * Mitigating but not exculpating: the override is process-local, so a cold boot
 * on the same database reads `enabled: true` again.
 *
 * ## Which legs changed, and which deliberately did NOT
 *
 * The cross-tenant read-back was a CONSEQUENCE of the route being reachable, so
 * it is not what this file pins any more — the unprivileged tenant is now
 * refused at the door and never reaches the toggle at all. What survives
 * untouched is the leg that measures WHERE THE STATE LIVES, because that fact
 * is unchanged by the gate and is the one that made the result independent of
 * this harness's admitted limitation:
 *
 * `multiTenant: 'posture-only'` activates the tenancy POSTURE and no row wall
 * (see `BootOptions.multiTenant`) — the enterprise `@objectstack/organizations`
 * runtime is cloud-private and genuinely absent from this workspace. An
 * organization wall scopes ROWS, and the enabled bit is not a row:
 * `toggleFlow(name, enabled)` writes the automation engine's in-process
 * `flowEnabled` map, keyed by flow name and nothing else, `getFlowRuntimeStates()`
 * reads that same map with no caller, no organization and no argument at all,
 * and the automation service is ONE instance per environment. `it('mutates
 * ENGINE state, not the persisted definition')` below still measures exactly
 * that discriminator over HTTP — and it is still the leg that would fail,
 * loudly, if enablement ever became org-stamped state a wall could scope. It is
 * simply driven by an ENTITLED caller now, since an unentitled one no longer
 * gets that far.
 *
 * ## ⚠️ The vacuity trap, restated for the new shape
 *
 * A gate test that only ever asserts refusals passes just as well when the
 * route is broken, missing, or refusing everyone — which is not what was ruled.
 * So the positive control is load-bearing here, not decoration: a caller WITH
 * `manage_metadata` still toggles, 200, in both directions, and the engine
 * state actually moves. Refusal and permission are both asserted, or neither
 * means anything.
 *
 * ## The harness
 *
 *   - app: `@objectstack/example-crm`, whose shipped `crm_convert_lead_wizard`
 *     stands in for #10145's HotCRM `lead_auto_assignment`.
 *   - boot: `bootStack(crm, { automation: true, multiTenant: 'posture-only' })`
 *     — a real, non-degraded `isolated` posture (the deployment shape #10145
 *     measured, `OS_TENANCY_POSTURE=isolated`), with the automation service
 *     registered so the routes resolve an engine instead of 501.
 *   - principals: platform admin (seeded first user), and two org owners who
 *     each create their OWN organization over
 *     `POST /auth/organization/create` — so the two tenants carry genuinely
 *     different `activeOrganizationId`s, which the first test asserts rather
 *     than assumes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';

/** The CRM app's own shipped flow — a real definition, not one this test injects. */
const FLOW = 'crm_convert_lead_wizard';

interface RuntimeFlowState {
  name: string;
  enabled: boolean;
  bound: boolean;
  status?: string;
}

interface AutomationEngineShape {
  getFlowRuntimeStates(): RuntimeFlowState[];
}

/**
 * Read one flow's runtime state out of `GET /automation/_status`.
 *
 * Pulls the entry out explicitly and fails on its absence rather than folding a
 * missing row into `enabled: false` — a `?? false` here would report "the route
 * stopped listing this flow" as "the flow is disabled", which is the one
 * confusion this whole file exists to avoid.
 */
async function readEnabled(stack: VerifyStack, token: string): Promise<RuntimeFlowState> {
  const res = await stack.apiAs(token, 'GET', '/automation/_status');
  const text = await res.clone().text();
  expect(res.status, `/automation/_status returned ${res.status}: ${text}`).toBe(200);
  const body = (await res.json()) as { data?: { flows?: RuntimeFlowState[] } };
  const flows = body.data?.flows;
  expect(flows, `no flows array in /automation/_status: ${text}`).toBeDefined();
  const entry = flows!.find((f) => f.name === FLOW);
  expect(entry, `flow '${FLOW}' absent from /automation/_status: ${text}`).toBeDefined();
  return entry!;
}

describe('#10243 — POST /automation/:name/toggle demands `manage_metadata`', () => {
  let stack: VerifyStack;
  /**
   * Platform admin — the seeded first user. #10145's `founder`, and now also
   * this file's ENTITLED principal: the positive control and the
   * where-the-state-lives leg are driven through it.
   */
  let adminToken: string;
  /** Tenant A org owner — the actor. #10145's `northwind`. */
  let tenantAToken: string;
  /** Tenant B org owner — an unrelated tenant. #10145's `contoso`. */
  let tenantBToken: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, { automation: true, multiTenant: 'posture-only' });
    adminToken = await stack.signIn();

    tenantAToken = await stack.signUp('tenant-a-owner@issue10243.test');
    tenantBToken = await stack.signUp('tenant-b-owner@issue10243.test');

    const createA = await stack.apiAs(tenantAToken, 'POST', '/auth/organization/create', {
      name: 'Tenant A', slug: 'tenant-a-10243',
    });
    expect(createA.status, `org A create: ${await createA.clone().text()}`).toBe(200);
    orgAId = ((await createA.json()) as { id: string }).id;

    const createB = await stack.apiAs(tenantBToken, 'POST', '/auth/organization/create', {
      name: 'Tenant B', slug: 'tenant-b-10243',
    });
    expect(createB.status, `org B create: ${await createB.clone().text()}`).toBe(200);
    orgBId = ((await createB.json()) as { id: string }).id;

    // better-auth binds the creator to the new org, but the ACTIVE org is what
    // rides the session into the execution context — set it explicitly so the
    // two tenants are org-bound in the only field that reaches `ExecutionContext`.
    for (const [token, slug] of [[tenantAToken, 'tenant-a-10243'], [tenantBToken, 'tenant-b-10243']] as const) {
      const res = await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
      expect(res.status, `set-active ${slug}: ${await res.clone().text()}`).toBe(200);
    }
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard the guard: a real walled posture, and three genuinely distinct principals', async () => {
    // If the stand-in ever stopped activating the posture, every read-back
    // below would still agree — and would be measuring a single-tenant stack.
    const tenancy = await stack.kernel.getServiceAsync<{
      posture: string; requestedPosture: string; isolationActive: boolean; degraded: boolean;
    }>('tenancy');
    expect(tenancy.requestedPosture).toBe('isolated');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(tenancy.degraded).toBe(false);

    // Two DIFFERENT organizations. Asserted, not assumed: if both tenants
    // landed in one org (or in none), "B saw A's toggle" would be a statement
    // about one tenant, not about a tenant wall.
    expect(orgAId).toBeTruthy();
    expect(orgBId).toBeTruthy();
    expect(orgAId).not.toBe(orgBId);

    const sessionOf = async (token: string) => {
      const res = await stack.apiAs(token, 'GET', '/auth/get-session');
      expect(res.status).toBe(200);
      return (await res.json()) as {
        user: { isPlatformAdmin: boolean; positions: string[] };
        session: { activeOrganizationId: string | null };
      };
    };

    const a = await sessionOf(tenantAToken);
    const b = await sessionOf(tenantBToken);
    const admin = await sessionOf(adminToken);

    expect(a.session.activeOrganizationId).toBe(orgAId);
    expect(b.session.activeOrganizationId).toBe(orgBId);
    expect(a.user.isPlatformAdmin).toBe(false);
    expect(b.user.isPlatformAdmin).toBe(false);
    expect(admin.user.isPlatformAdmin).toBe(true);
  });

  it('control: tenant A is genuinely unprivileged — the gated neighbours refuse it', async () => {
    // The same control #10145's report used to prove the account is not
    // secretly entitled. Asserts `code` AND `status` — the repo's minimum for a
    // refusal case, since a bare "it threw" passes for the wrong reasons.
    //
    // ⛔ `POST /:name/toggle` is deliberately NOT in this list even though it
    // now belongs to the same write set: this control has to be independent of
    // the route under test, or "tenant A is unprivileged" would be established
    // by the very gate the next test measures.
    const meta = await stack.apiAs(tenantAToken, 'PUT', '/meta/object/crm_lead', { name: 'crm_lead' });
    expect(meta.status).toBe(403);
    expect(((await meta.json()) as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');

    for (const [method, path] of [['POST', '/automation'], ['DELETE', `/automation/${FLOW}`]] as const) {
      const body = method === 'POST'
        ? { name: 'probe_flow_10243', label: 'Probe', type: 'autolaunched', nodes: [], edges: [] }
        : undefined;
      const res = await stack.apiAs(tenantAToken, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('PERMISSION_DENIED');
    }
  });

  it('baseline: all three principals read the shipped flow as enabled', async () => {
    for (const [who, token] of [['admin', adminToken], ['tenantA', tenantAToken], ['tenantB', tenantBToken]] as const) {
      const state = await readEnabled(stack, token);
      expect(state.enabled, `${who} baseline`).toBe(true);
    }
  });

  it('[#10243 FLIPPED] tenant A is REFUSED at the door — 403 PERMISSION_DENIED, in both directions', async () => {
    // ⭐ This is the assertion the ruling inverted. It read `.toBe(200)` with a
    // cross-organization read-back table under it; that table measured a
    // CONSEQUENCE of the route being reachable, and the route is not reachable
    // for this principal any more. Both directions are driven because the
    // measurement that produced the ruling was symmetric — a gate that only
    // refused "off" would leave the same environment-wide reach one boolean away.
    for (const enabled of [false, true]) {
      const res = await stack.apiAs(tenantAToken, 'POST', `/automation/${FLOW}/toggle`, { enabled });
      expect(res.status, `toggle {enabled:${enabled}} as tenant A: ${await res.clone().text()}`).toBe(403);
      expect(
        ((await res.json()) as { error?: { code?: string } }).error?.code,
        'ADR-0112 wants both halves — a 403 carrying no code satisfies exactly half the contract',
      ).toBe('PERMISSION_DENIED');
    }

    // THE POINT, and the reason this is not a status-only assertion: the
    // refusal has to land BEFORE the engine is touched. "Toggle first, refuse
    // second" would satisfy the two assertions above and still be the
    // cross-tenant defect. All three principals still read the flow ENABLED.
    for (const [who, token] of [['tenantA', tenantAToken], ['tenantB', tenantBToken], ['admin', adminToken]] as const) {
      expect((await readEnabled(stack, token)).enabled, `${who} after A was refused`).toBe(true);
    }
  });

  it('[#10243] positive control: a `manage_metadata` holder still toggles, 200 — the gate does not refuse everyone', async () => {
    // ⚠️ Load-bearing, not decoration. Every assertion in the test above passes
    // just as well against a route that is broken, unmounted, or refusing
    // every caller — none of which is what was ruled. The capability holder's
    // 200 is the half that says a gate was installed rather than a door welded
    // shut, and it is what leaves the following leg something to measure.
    const toggle = await stack.apiAs(adminToken, 'POST', `/automation/${FLOW}/toggle`, { enabled: false });
    expect(toggle.status, `toggle as the entitled admin: ${await toggle.clone().text()}`).toBe(200);
    expect((await toggle.json()) as unknown).toMatchObject({ data: { name: FLOW, enabled: false } });

    expect((await readEnabled(stack, adminToken)).enabled, 'admin after the entitled toggle').toBe(false);
  });

  it('mutates ENGINE state, not the persisted definition — the bit an organization wall has nothing to scope', async () => {
    // ⭐ KEPT, deliberately: the gate changed WHO may toggle, not WHERE the
    // mutated bit lives, and this leg measures the latter. It is what made the
    // original cross-tenant result independent of this harness's missing row
    // wall, and it is what would fail — loudly — if enablement ever became
    // org-stamped state a wall could scope. Only its driver changed: it runs
    // after the ENTITLED toggle above (file order is the sequence), because an
    // unentitled caller no longer gets far enough to move anything.
    //
    // The persisted `status` — the flow's authored metadata, the thing an org
    // overlay could carry — is untouched, while the runtime `enabled` bit is off.
    const state = await readEnabled(stack, adminToken);
    expect(state.enabled).toBe(false);
    expect(state.status).toBe('active');

    const definition = await stack.apiAs(adminToken, 'GET', `/automation/${FLOW}`);
    expect(definition.status).toBe(200);
    const body = (await definition.json()) as { data?: { status?: string } };
    expect(body.data?.status, 'the authored definition was not modified by the toggle').toBe('active');

    // One engine for the whole environment: the same service instance the HTTP
    // route mutated, reachable from the kernel, reporting the same bit through
    // a method that takes no caller and no organization.
    const engine = await stack.kernel.getServiceAsync<AutomationEngineShape>('automation');
    const again = await stack.kernel.getServiceAsync<AutomationEngineShape>('automation');
    expect(engine, 'the automation service is one instance per environment').toBe(again);
    const fromEngine = engine.getFlowRuntimeStates().find((f) => f.name === FLOW);
    expect(fromEngine?.enabled, 'engine state after the HTTP toggle').toBe(false);
  });

  it('symmetric: the entitled caller switches it back on, and all three read it on again', async () => {
    const toggle = await stack.apiAs(adminToken, 'POST', `/automation/${FLOW}/toggle`, { enabled: true });
    expect(toggle.status).toBe(200);

    // The environment-wide reach of the bit is unchanged and still visible —
    // that was never the defect. WHO may reach it is what the ruling narrowed,
    // so the same three-principal read-back is now evidence that an ENTITLED
    // toggle still behaves exactly as it did.
    for (const [who, token] of [['tenantA', tenantAToken], ['tenantB', tenantBToken], ['admin', adminToken]] as const) {
      expect((await readEnabled(stack, token)).enabled, `${who} after the entitled re-enable`).toBe(true);
    }
  });

  it('[#10243] the EXECUTION door beside it did not move — tenant A can still trigger', async () => {
    // ⛔ The over-block this ruling deliberately did not make. If the gate had
    // been spelled one segment too wide, an ordinary member would lose the
    // ability to RUN the flows built for them — the mistake #7968 records for
    // the paused-run screen read. Asserted as "not 403": what this pins is the
    // authorization verdict, not the flow's business outcome.
    const res = await stack.apiAs(tenantAToken, 'POST', `/automation/${FLOW}/trigger`, {});
    expect(res.status, `trigger as tenant A: ${await res.clone().text()}`).not.toBe(403);
  });
});
