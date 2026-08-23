// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10243 — the BLAST-RADIUS half of the toggle card, measured over HTTP.
 *
 * ## ⛔ What this file is, and what it deliberately is not
 *
 * It **records a measurement**. It does **not** rule. Whether
 * `POST /automation/:name/toggle` belongs in the `manage_metadata` write set is
 * a product and security decision for the maintainer, and nothing here argues
 * either way — no severity, no recommendation. When the ruling lands, this file
 * is one of the two places it lands (the other is the ungated-execution audit
 * block in `packages/runtime/src/domains/automation-write-capability-gate.test.ts`):
 * a ruling that toggle IS an authoring write flips these expectations to a 403,
 * and the flip is the point — an unrecorded verdict cannot be revisited.
 *
 * ## The question, and why only half of it was open
 *
 * #10145 gated the automation DEFINITION writes (`POST /automation`,
 * `PUT /automation/:name`, `DELETE /automation/:name`) on `manage_metadata` and
 * deliberately left `toggle` ungated, on the rule that authoring and executing
 * are different questions. Two separable facts follow from that, and only the
 * second was ever open:
 *
 *   1. `toggle` is reachable by any authenticated caller with no authoring
 *      capability — MEASURED and pinned by #10145's audit block.
 *   2. flow ENABLEMENT is environment-scoped, so one tenant's toggle reaches
 *      every organization — asserted from the scoping #10145 measured for flow
 *      DEFINITIONS, and never reproduced for enablement itself.
 *
 * This file is (2): toggle as tenant A, read the enabled state back as tenant B
 * and as the platform admin — the same three principals and the same read-back
 * table #10145's report used for definitions.
 *
 * ## ⚠️ The vacuity trap this harness has to stay clear of, stated up front
 *
 * `multiTenant: 'posture-only'` activates the tenancy POSTURE and no row wall
 * (see `BootOptions.multiTenant`) — the enterprise `@objectstack/organizations`
 * runtime is cloud-private and genuinely absent from this workspace. A fixture
 * that booted this way and asserted *isolation* would assert nothing and pass.
 * The mirror image is just as real and is the trap for THIS file: in a stack
 * with no wall, "tenant B saw tenant A's write" is true of everything, and
 * would prove nothing about a walled deployment.
 *
 * What keeps the measurement honest is that the bit under test never reaches
 * the plane a wall operates on. An organization wall scopes ROWS. The enabled
 * bit is not a row: `toggleFlow(name, enabled)` writes the automation engine's
 * in-process `flowEnabled` map, keyed by flow name and nothing else, and
 * `getFlowRuntimeStates()` reads that same map with no caller, no organization
 * and no argument at all. `it('mutates ENGINE state, not the persisted
 * definition')` below measures exactly that discriminator over HTTP — after the
 * toggle the flow's persisted `status` is still `active` while its runtime
 * `enabled` is `false` — and it is the leg that would fail, loudly, if
 * enablement ever became org-stamped state that a wall could scope. Until it
 * does, no wall has anything to scope, which is why the result does not depend
 * on the stand-in.
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

describe('#10243 — cross-organization reach of POST /automation/:name/toggle', () => {
  let stack: VerifyStack;
  /** Platform admin — the seeded first user. #10145's `founder`. */
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

  it('MEASURED: tenant A toggles the flow off, and tenant B and the platform admin both read it off', async () => {
    const toggle = await stack.apiAs(tenantAToken, 'POST', `/automation/${FLOW}/toggle`, { enabled: false });
    expect(toggle.status, `toggle as tenant A: ${await toggle.clone().text()}`).toBe(200);
    expect((await toggle.json()) as unknown).toMatchObject({ data: { name: FLOW, enabled: false } });

    // The read-back table. Tenant B holds no membership of tenant A's
    // organization and the platform admin is org-less; both nevertheless
    // observe the actor's mutation.
    expect((await readEnabled(stack, tenantBToken)).enabled, 'tenant B after A toggled off').toBe(false);
    expect((await readEnabled(stack, adminToken)).enabled, 'platform admin after A toggled off').toBe(false);
    expect((await readEnabled(stack, tenantAToken)).enabled, 'tenant A after A toggled off').toBe(false);
  });

  it('mutates ENGINE state, not the persisted definition — the bit an organization wall has nothing to scope', async () => {
    // Runs after the toggle above (file order is the sequence). The persisted
    // `status` — the flow's authored metadata, the thing an org overlay could
    // carry — is untouched, while the runtime `enabled` bit is off. That
    // divergence is where the state lives, and it is what makes the read-back
    // above independent of whether a row wall is installed.
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

  it('symmetric: tenant A switches it back on, and the other two read it on again', async () => {
    const toggle = await stack.apiAs(tenantAToken, 'POST', `/automation/${FLOW}/toggle`, { enabled: true });
    expect(toggle.status).toBe(200);

    expect((await readEnabled(stack, tenantBToken)).enabled, 'tenant B after A re-enabled').toBe(true);
    expect((await readEnabled(stack, adminToken)).enabled, 'platform admin after A re-enabled').toBe(true);
  });
});
