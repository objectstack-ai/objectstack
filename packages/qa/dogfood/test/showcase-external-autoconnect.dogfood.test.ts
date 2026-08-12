// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0062 D1/D8 — the showcase declares its `external` datasource with NO
// `onEnable` driver wiring (only fixture provisioning remains). This proves the
// declared external datasource AUTO-CONNECTS at boot and its federated objects
// are queryable end-to-end through the real REST stack — zero app code. Guards
// against a regression where dropping the `onEnable` bridge would leave the
// external objects unrouted ("Datasource 'showcase_external' is not registered").

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

function listOf(body: unknown): Array<Record<string, unknown>> {
  const b = body as { records?: unknown[]; data?: unknown[] } | unknown[];
  if (Array.isArray(b)) return b as Array<Record<string, unknown>>;
  return ((b as { records?: unknown[] }).records ?? (b as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
}

describe('showcase: external datasource auto-connects with no onEnable bridge (ADR-0062 D8)', () => {
  let stack: VerifyStack;
  let admin: string;

  beforeAll(async () => {
    // Stand up the "remote" database (the showcase's onEnable fixture provisioner).
    // The verify harness imports only the stack's default export, so its onEnable
    // never runs here — we invoke it ourselves to create the remote customers/orders
    // tables, exactly as `os dev` does at boot. Crucially this does NOT register a
    // driver (ADR-0062 D8); auto-connect (below, during bootStack) does that.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootStack(showcaseStack);
    admin = await stack.signIn();
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('federated customer object is queryable (auto-connected, seeded fixture rows returned)', async () => {
    const res = await stack.apiAs(admin, 'GET', '/data/showcase_ext_customer');
    expect(res.status, 'federated object must be queryable — driver auto-connected').toBe(200);
    const rows = listOf(await res.json());
    // [#7834] ⛔ THIS ASSERTION IS NOT ORG-WALL COVERAGE — read this before
    // treating a green run of this file as proof of anything about tenancy.
    //
    // What it DOES cover (real, which is why this test is not skipped): the
    // ADR-0062 D8 auto-connect path — a declared external datasource connects
    // at boot with no `onEnable` driver bridge, and its federated objects
    // answer a genuine authenticated read through the real REST stack.
    //
    // What it does NOT cover: the organization wall. `bootStack(showcaseStack)`
    // above passes NO options, and `bootStack` requests
    // `OS_TENANCY_POSTURE = 'isolated'` only when `opts.multiTenant` is truthy
    // (`packages/verify/src/harness.ts`, `requestIsolatedPosture`). It also
    // boots AuthPlugin with `autoDefaultOrganization: false` and registers no
    // organization plugin. So this fixture boots posture `single` — the boot
    // log says so: `[security] tenancy posture 'single' — Layer 0 is inert` —
    // with no active org. `execCtx.tenantId` is therefore undefined, which is
    // the FIRST conjunct of `hasTenant` in `ObjectQLEngine.buildDriverOptions`
    // (`packages/objectql/src/engine.ts`); it short-circuits false before the
    // `isFederated` exemption is even reached, and the driver is handed no
    // `tenantId` to scope by. **The org predicate is never emitted here, in
    // either direction.** Measured on #7738: `engine.ts` was checked back out
    // at pre-fix `main`, `@objectstack/objectql` rebuilt, and this file re-run
    // — 3 passed / 3 both WITH the fix and WITHOUT it. This assertion sat green
    // while a correctly-bound federated object answered 0 rows under a real
    // org wall, and it cannot catch a regression of that.
    //
    // Where the regression defence actually lives: the seam pin in
    // `packages/objectql/src/engine-external-tenant-scope.test.ts` (#7833). It
    // asserts on `DriverOptions` in both directions — an external object gets
    // no `tenantId`/`tenantIds`, an ordinary one still does — and is reachable
    // without the enterprise package. ⛔ That is a UNIT/SEAM pin, not
    // end-to-end proof: it pins what the engine hands the driver, never what a
    // walled deployment returns over HTTP.
    //
    // Why this is deliberately left as-is (maintainer ruling, 2026-08-12 on
    // #7834): the federated-read × org-walled intersection is accepted as
    // covered at the unit/seam tier ONLY. The single honest walled harness is
    // `multiTenant: true` with the cloud-private `@objectstack/organizations`
    // (`'posture-only'` stamps nothing and scopes no query — see
    // `BootOptions.multiTenant` — so it would assert nothing here); its
    // feasibility in this repo is untested, and one intersection does not
    // justify building that fixture. ⛔ Do not "fix" this by asserting tenancy
    // on this single-tenant boot — that pins the inert path and makes the
    // false reading of coverage worse.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.map((r) => r.name)).toContain('Aurora Labs');
  });

  it('federated order object (remoteName remap) is queryable too', async () => {
    const res = await stack.apiAs(admin, 'GET', '/data/showcase_ext_order');
    expect(res.status).toBe(200);
    const rows = listOf(await res.json());
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it('region filter pushes down to the remote table', async () => {
    const res = await stack.apiAs(admin, 'GET', '/data/showcase_ext_customer?region=EU');
    expect(res.status).toBe(200);
    const rows = listOf(await res.json());
    expect(rows.every((r) => r.region === 'EU')).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
